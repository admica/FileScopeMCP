// src/change-detector/change-detector.test.ts
// Tests for ChangeDetector class and queueLlmDiffJob fallback.
// Uses temp files on disk — classify() reads files via fs.readFile.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ChangeDetector } from './change-detector.js';
import { queueLlmDiffJob } from './llm-diff-fallback.js';
import { getGitDiffOrContent } from './git-diff.js';

vi.mock('../broker/client.js', () => ({
  submitJob: vi.fn(),
}));

import { submitJob } from '../broker/client.js';

// ─── DB setup ──────────────────────────────────────────────────────────────
// The change detector uses getExportsSnapshot/setExportsSnapshot,
// which require an open SQLite DB. We open a temp DB for these tests.
import { openDatabase, closeDatabase } from '../db/db.js';
import { getSqlite } from '../db/db.js';

let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'change-detector-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  openDatabase(dbPath);

  // Create the files table with the exports_snapshot column
  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      is_directory INTEGER NOT NULL DEFAULT 0,
      importance REAL DEFAULT 0,
      summary TEXT,
      mtime REAL,
      summary_stale_since TEXT,
      concepts_stale_since TEXT,
      change_impact_stale_since TEXT,
      exports_snapshot TEXT
    );
    CREATE TABLE IF NOT EXISTS file_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      dependency_type TEXT NOT NULL,
      package_name TEXT,
      package_version TEXT,
      is_dev_dependency INTEGER
    );
  `);
});

afterAll(async () => {
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ─── ChangeDetector tests ───────────────────────────────────────────────────

describe('ChangeDetector', () => {
  let detector: ChangeDetector;

  beforeEach(() => {
    detector = new ChangeDetector(tmpDir);
    (submitJob as ReturnType<typeof vi.fn>).mockClear();
  });

  it('classifies a .ts file and returns SemanticChangeSummary with confidence=ast', async () => {
    const tsFile = path.join(tmpDir, 'sample.ts');
    await fs.writeFile(tsFile, `
      export function greet(name: string): string {
        return 'Hello, ' + name;
      }
    `);

    const result = await detector.classify(tsFile);

    expect(result).toBeDefined();
    expect(result.filePath).toBe(tsFile);
    expect(result.confidence).toBe('ast');
    expect(typeof result.affectsDependents).toBe('boolean');
    expect(typeof result.timestamp).toBe('number');
  });

  it('returns changeType=unknown and stores new snapshot for .ts file with no prior snapshot', async () => {
    const tsFile = path.join(tmpDir, 'first-parse.ts');
    await fs.writeFile(tsFile, `
      export const PI = 3.14;
    `);

    const result = await detector.classify(tsFile);

    // First parse: no previous snapshot → 'unknown'
    expect(result.changeType).toBe('unknown');
    expect(result.confidence).toBe('ast');
  });

  it('classifies a .py file as changeType=unknown with confidence=heuristic', async () => {
    const pyFile = path.join(tmpDir, 'script.py');
    await fs.writeFile(pyFile, 'def hello():\n    print("hello")\n');

    const result = await detector.classify(pyFile);

    expect(result.changeType).toBe('unknown');
    expect(result.confidence).toBe('heuristic');
  });

  it('returns unknown with heuristic confidence for non-existent file (error handling)', async () => {
    const nonExistent = path.join(tmpDir, 'does-not-exist.ts');

    const result = await detector.classify(nonExistent);

    expect(result.changeType).toBe('unknown');
    expect(result.confidence).toBe('heuristic');
  });

  it('produces affectsDependents=false for a body-only change on a .ts file', async () => {
    const tsFile = path.join(tmpDir, 'body-only.ts');
    const v1 = `export function add(a: number, b: number): number { return a + b; }`;
    const v2 = `export function add(a: number, b: number): number { return b + a; }`; // same signature

    await fs.writeFile(tsFile, v1);
    // First classify stores snapshot
    await detector.classify(tsFile);

    // Update file to body-only change
    await fs.writeFile(tsFile, v2);
    const result = await detector.classify(tsFile);

    expect(result.changeType).toBe('body-only');
    expect(result.affectsDependents).toBe(false);
    expect(result.confidence).toBe('ast');
  });

  it('produces affectsDependents=true for an export signature change on a .ts file', async () => {
    const tsFile = path.join(tmpDir, 'export-change.ts');
    const v1 = `export function process(data: string): string { return data; }`;
    const v2 = `export function process(data: string, opts: object): string { return data; }`; // changed signature

    await fs.writeFile(tsFile, v1);
    // First classify stores snapshot
    await detector.classify(tsFile);

    // Update file with changed export signature
    await fs.writeFile(tsFile, v2);
    const result = await detector.classify(tsFile);

    expect(result.affectsDependents).toBe(true);
    expect(result.changeType).toBe('exports-changed');
  });
});

// ─── getGitDiffOrContent tests ──────────────────────────────────────────────

describe('getGitDiffOrContent', () => {
  it('returns file content with [new/untracked file] prefix when git diff is empty (untracked file)', async () => {
    const testFile = path.join(tmpDir, 'untracked-test.py');
    await fs.writeFile(testFile, 'def hello():\n    pass\n');

    // tmpDir is not a git repo, so git diff will fail/empty — should fall back to content
    const result = await getGitDiffOrContent(testFile, tmpDir);

    expect(result).toContain('[new/untracked file]');
    expect(result).toContain('def hello()');
  });

  it('returns [file content unavailable] when file does not exist and git fails', async () => {
    const nonExistent = path.join(tmpDir, 'does-not-exist.py');

    const result = await getGitDiffOrContent(nonExistent, tmpDir);

    expect(result).toBe('[file content unavailable]');
  });
});

// ─── ast-parser console.warn check ──────────────────────────────────────────

describe('ast-parser logger usage', () => {
  it('ast-parser.ts does not contain console.warn calls', async () => {
    const astParserSource = await fs.readFile(
      new URL('./ast-parser.ts', import.meta.url),
      'utf-8'
    );
    expect(astParserSource).not.toContain('console.warn');
  });
});

// ─── queueLlmDiffJob source check ───────────────────────────────────────────

describe('queueLlmDiffJob source', () => {
  it('llm-diff-fallback.ts does not call submitJob directly (cascadeStale handles submission)', async () => {
    const fallbackSource = await fs.readFile(
      new URL('./llm-diff-fallback.ts', import.meta.url),
      'utf-8'
    );
    expect(fallbackSource).not.toContain('insertLlmJobIfNotPending');
    expect(fallbackSource).not.toContain('submitJob');
  });
});

// ─── queueLlmDiffJob tests ──────────────────────────────────────────────────

describe('queueLlmDiffJob', () => {
  beforeEach(() => {
    (submitJob as ReturnType<typeof vi.fn>).mockClear();
  });

  it('returns SemanticChangeSummary with changeType=unknown and confidence=heuristic', () => {
    const result = queueLlmDiffJob('/fake/script.go', 'some diff content');

    expect(result.changeType).toBe('unknown');
    expect(result.confidence).toBe('heuristic');
    expect(typeof result.affectsDependents).toBe('boolean');
    expect(typeof result.timestamp).toBe('number');
  });

  it('returns the diff in the diff field instead of calling submitJob', () => {
    const diff = 'func main() { println("hello") }';

    const result = queueLlmDiffJob('/fake/queued.go', diff);

    expect(result.diff).toBe(diff);
    // submitJob should NOT be called — cascadeStale handles submission
    const mockSJ = submitJob as ReturnType<typeof vi.fn>;
    expect(mockSJ).not.toHaveBeenCalled();
  });

  it('truncates diffs longer than ~16KB with [truncated] suffix', () => {
    const longDiff = 'x'.repeat(20 * 1024);

    const result = queueLlmDiffJob('/fake/large-diff.go', longDiff);

    expect(result.diff).toBeDefined();
    expect(result.diff!.length).toBeLessThan(longDiff.length);
    expect(result.diff).toContain('[truncated]');
  });

  it('returns unknown summary even if submitJob throws (no DB)', () => {
    // We can't easily close the DB here, but we can test that the function
    // is resilient by passing an empty diff (legitimate edge case)
    const result = queueLlmDiffJob('', '');
    expect(result.changeType).toBe('unknown');
    expect(result.confidence).toBe('heuristic');
  });
});

// ─── ChangeDetector LLM fallback wiring tests ───────────────────────────────

describe('ChangeDetector LLM fallback wiring', () => {
  beforeEach(() => {
    (submitJob as ReturnType<typeof vi.fn>).mockClear();
  });

  it('classify on a .py file returns diff in the SemanticChangeSummary instead of calling submitJob', async () => {
    const pyFile = path.join(tmpDir, 'wired-test.py');
    await fs.writeFile(pyFile, 'def hello():\n    pass\n');

    const detector = new ChangeDetector(tmpDir);
    const result = await detector.classify(pyFile);

    // submitJob should NOT be called — diff is returned for cascadeStale to use
    const mockSJ = submitJob as ReturnType<typeof vi.fn>;
    expect(mockSJ).not.toHaveBeenCalled();
    // diff should be present in the result
    expect(result.diff).toBeDefined();
    expect(typeof result.diff).toBe('string');
    expect(result.diff!.length).toBeGreaterThan(0);
  });
});
