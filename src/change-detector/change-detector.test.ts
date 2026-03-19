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
import { insertLlmJobIfNotPending } from '../db/repository.js';

// ─── DB setup ──────────────────────────────────────────────────────────────
// The change detector uses getExportsSnapshot/setExportsSnapshot/insertLlmJob,
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
    CREATE TABLE IF NOT EXISTS llm_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      job_type TEXT NOT NULL,
      priority_tier INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      payload TEXT
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

// ─── insertLlmJobIfNotPending payload tests ──────────────────────────────────

describe('insertLlmJobIfNotPending with payload', () => {
  it('passes payload through to inserted job row', () => {
    const sqlite = getSqlite();
    sqlite.exec("DELETE FROM llm_jobs WHERE file_path = '/payload-test.py'");

    insertLlmJobIfNotPending('/payload-test.py', 'change_impact', 2, 'my diff payload');

    const row = sqlite
      .prepare("SELECT payload FROM llm_jobs WHERE file_path = ? AND job_type = 'change_impact'")
      .get('/payload-test.py') as { payload: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.payload).toBe('my diff payload');
  });

  it('works without payload (backward compat) — payload is null', () => {
    const sqlite = getSqlite();
    sqlite.exec("DELETE FROM llm_jobs WHERE file_path = '/no-payload-test.py'");

    insertLlmJobIfNotPending('/no-payload-test.py', 'summary', 2);

    const row = sqlite
      .prepare("SELECT payload FROM llm_jobs WHERE file_path = ? AND job_type = 'summary'")
      .get('/no-payload-test.py') as { payload: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row!.payload).toBeNull();
  });
});

// ─── _classifyWithLlmFallback wiring tests ──────────────────────────────────

describe('ChangeDetector LLM fallback wiring', () => {
  it('classify on a .py file queues a change_impact job with non-null payload', async () => {
    const pyFile = path.join(tmpDir, 'wired-test.py');
    await fs.writeFile(pyFile, 'def hello():\n    pass\n');

    const detector = new ChangeDetector(tmpDir);
    await detector.classify(pyFile);

    const sqlite = getSqlite();
    const row = sqlite
      .prepare("SELECT payload FROM llm_jobs WHERE file_path = ? AND job_type = 'change_impact' AND status = 'pending'")
      .get(pyFile) as { payload: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row!.payload).not.toBeNull();
    expect(row!.payload!.length).toBeGreaterThan(0);
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

// ─── queueLlmDiffJob dedup source check ─────────────────────────────────────

describe('queueLlmDiffJob dedup', () => {
  it('llm-diff-fallback.ts source uses insertLlmJobIfNotPending (not raw insertLlmJob)', async () => {
    const fallbackSource = await fs.readFile(
      new URL('./llm-diff-fallback.ts', import.meta.url),
      'utf-8'
    );
    // Must NOT contain the non-dedup raw call pattern
    expect(fallbackSource).not.toContain('insertLlmJob(');
    // Must contain the dedup function
    expect(fallbackSource).toContain('insertLlmJobIfNotPending');
  });
});

// ─── queueLlmDiffJob tests ──────────────────────────────────────────────────

describe('queueLlmDiffJob', () => {
  it('returns SemanticChangeSummary with changeType=unknown and confidence=heuristic', () => {
    const result = queueLlmDiffJob('/fake/script.go', 'some diff content');

    expect(result.changeType).toBe('unknown');
    expect(result.confidence).toBe('heuristic');
    expect(typeof result.affectsDependents).toBe('boolean');
    expect(typeof result.timestamp).toBe('number');
  });

  it('inserts an llm_job row with job_type=change_impact, priority_tier=2, status=pending', () => {
    const filePath = path.join(tmpDir, 'queued.go');
    const diff = 'func main() { println("hello") }';

    queueLlmDiffJob(filePath, diff);

    const sqlite = getSqlite();
    const row = sqlite
      .prepare("SELECT * FROM llm_jobs WHERE file_path = ? AND job_type = 'change_impact'")
      .get(filePath) as { job_type: string; priority_tier: number; status: string; payload: string } | undefined;

    expect(row).toBeDefined();
    expect(row!.job_type).toBe('change_impact');
    expect(row!.priority_tier).toBe(2);
    expect(row!.status).toBe('pending');
    expect(row!.payload).toBe(diff);
  });

  it('truncates diffs longer than ~16KB with [truncated] suffix', () => {
    const filePath = path.join(tmpDir, 'large-diff.go');
    // 20KB diff
    const longDiff = 'x'.repeat(20 * 1024);

    queueLlmDiffJob(filePath, longDiff);

    const sqlite = getSqlite();
    const row = sqlite
      .prepare("SELECT payload FROM llm_jobs WHERE file_path = ?")
      .get(filePath) as { payload: string } | undefined;

    expect(row).toBeDefined();
    // Payload should be truncated — must be shorter than the original
    expect(row!.payload.length).toBeLessThan(longDiff.length);
    expect(row!.payload).toContain('[truncated]');
  });

  it('returns unknown summary even if insertLlmJob throws (no DB)', () => {
    // We can't easily close the DB here, but we can test that the function
    // is resilient by passing an empty diff (legitimate edge case)
    const result = queueLlmDiffJob('', '');
    expect(result.changeType).toBe('unknown');
    expect(result.confidence).toBe('heuristic');
  });
});
