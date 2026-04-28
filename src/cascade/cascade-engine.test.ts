// src/cascade/cascade-engine.test.ts
// Tests for CascadeEngine BFS walk and repository functions markStale.
// Uses temp SQLite DB matching the established test pattern in the codebase.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeFileSync } from 'fs';
import { openDatabase, closeDatabase, getSqlite } from '../db/db.js';
import { setRepoProjectRoot, clearRepoProjectRoot } from '../db/repository.js';
import { relativizePath } from '../file-utils.js';

vi.mock('../broker/client.js', () => ({
  submitJob: vi.fn(),
}));

let tmpDir: string;
let dbPath: string;

// Helper: get a path under tmpDir for test files (they must exist on disk for cascade-engine)
function p(name: string): string {
  return path.join(tmpDir, name);
}

// Tests must exercise the same code path production runs: paths in repo public
// API are absolute, but the DB stores them relative to projectRoot (host
// portability). Without this binding the tests would default to identity-
// passthrough and miss bugs in code that bypasses repository.ts to issue raw
// SQL with WHERE path = ? (e.g. cascade-engine.ts:144 markSelfStale).
function rawRel(p: string): string {
  return relativizePath(p, tmpDir);
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-engine-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  openDatabase(dbPath);
  setRepoProjectRoot(tmpDir);

  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      is_directory INTEGER NOT NULL DEFAULT 0,
      importance REAL DEFAULT 0,
      summary TEXT,
      mtime REAL,
      summary_stale_since INTEGER,
      concepts_stale_since INTEGER,
      change_impact_stale_since INTEGER,
      exports_snapshot TEXT
    );
    CREATE TABLE IF NOT EXISTS file_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_path TEXT NOT NULL,
      target_path TEXT NOT NULL,
      dependency_type TEXT NOT NULL,
      package_name TEXT,
      package_version TEXT,
      is_dev_dependency INTEGER,
      edge_type TEXT DEFAULT 'imports',
      confidence REAL DEFAULT 0.8,
      confidence_source TEXT DEFAULT 'inferred',
      weight REAL DEFAULT 1.0
    );
  `);
});

afterAll(async () => {
  closeDatabase();
  clearRepoProjectRoot();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Helper: insert a file row into the DB and create the file on disk
function insertFile(filePath: string, content = 'export const x = 1;'): void {
  const sqlite = getSqlite();
  const name = path.basename(filePath);
  sqlite
    .prepare('INSERT OR IGNORE INTO files (path, name, is_directory) VALUES (?, ?, 0)')
    .run(rawRel(filePath), name);
  writeFileSync(filePath, content);
}

// Helper: insert a local_import dependency
function insertDep(sourcePath: string, targetPath: string): void {
  const sqlite = getSqlite();
  sqlite
    .prepare(
      'INSERT INTO file_dependencies (source_path, target_path, dependency_type) VALUES (?, ?, ?)'
    )
    .run(rawRel(sourcePath), rawRel(targetPath), 'local_import');
}

// Helper: clear all tables between test groups
function clearTables(): void {
  const sqlite = getSqlite();
  sqlite.exec('DELETE FROM files; DELETE FROM file_dependencies;');
}

// ─── Repository function tests ────────────────────────────────────────────────

import { markStale, upsertFile } from '../db/repository.js';
import { submitJob } from '../broker/client.js';
import type { FileNode } from '../types.js';

describe('markStale', () => {
  it('sets all 3 staleness columns to the given timestamp for all specified files', () => {
    clearTables();
    const aPath = p('markstale-a.ts');
    const bPath = p('markstale-b.ts');
    insertFile(aPath);
    insertFile(bPath);

    markStale([aPath, bPath], 1000);

    const sqlite = getSqlite();
    const a = sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get(rawRel(aPath)) as { summary_stale_since: number; concepts_stale_since: number; change_impact_stale_since: number };
    const b = sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get(rawRel(bPath)) as { summary_stale_since: number; concepts_stale_since: number; change_impact_stale_since: number };

    expect(a.summary_stale_since).toBe(1000);
    expect(a.concepts_stale_since).toBe(1000);
    expect(a.change_impact_stale_since).toBe(1000);
    expect(b.summary_stale_since).toBe(1000);
    expect(b.concepts_stale_since).toBe(1000);
    expect(b.change_impact_stale_since).toBe(1000);
  });

  it('does not throw when called on a non-existent path (UPDATE matches 0 rows)', () => {
    clearTables();
    expect(() => markStale([p('nonexistent.ts')], 999)).not.toThrow();
  });
});

describe('upsertFile staleness preservation', () => {
  it('does not clobber staleness columns when upsertFile is called after markStale', () => {
    clearTables();
    const filePath = p('stale-test.ts');
    writeFileSync(filePath, 'export const x = 1;');

    // Insert a file via upsertFile first
    const node: FileNode = {
      path: filePath,
      name: 'stale-test.ts',
      isDirectory: false,
      importance: 0,
    };
    upsertFile(node);

    // Set staleness directly via markStale
    markStale([filePath], 5000);

    // Verify staleness was set
    const sqlite = getSqlite();
    const before = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get(rawRel(filePath)) as { summary_stale_since: number };
    expect(before.summary_stale_since).toBe(5000);

    // Now call upsertFile again (e.g., on file change)
    upsertFile({ ...node, summary: 'Updated summary' });

    // Staleness columns must NOT have been reset to null
    const after = sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get(rawRel(filePath)) as { summary_stale_since: number | null; concepts_stale_since: number | null; change_impact_stale_since: number | null };
    expect(after.summary_stale_since).toBe(5000);
    expect(after.concepts_stale_since).toBe(5000);
    expect(after.change_impact_stale_since).toBe(5000);
  });
});

// ─── CascadeEngine tests ──────────────────────────────────────────────────────

import { cascadeStale, markSelfStale } from './cascade-engine.js';

describe('cascadeStale', () => {
  beforeEach(() => {
    clearTables();
    (submitJob as ReturnType<typeof vi.fn>).mockClear();
  });

  it('marks A, B, C all stale and queues 9 LLM jobs when A has dependents B->C chain', () => {
    // A is the changed file. B depends on A. C depends on B.
    const aPath = p('cascade-A.ts');
    const bPath = p('cascade-B.ts');
    const cPath = p('cascade-C.ts');
    insertFile(aPath);
    insertFile(bPath);
    insertFile(cPath);
    insertDep(bPath, aPath); // B imports from A
    insertDep(cPath, bPath); // C imports from B

    cascadeStale(aPath, { timestamp: 2000 });

    const sqlite = getSqlite();
    const checkStale = (fp: string) =>
      sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get(rawRel(fp)) as { summary_stale_since: number; concepts_stale_since: number; change_impact_stale_since: number } | undefined;

    const aRow = checkStale(aPath);
    const bRow = checkStale(bPath);
    const cRow = checkStale(cPath);

    expect(aRow?.summary_stale_since).toBe(2000);
    expect(aRow?.concepts_stale_since).toBe(2000);
    expect(aRow?.change_impact_stale_since).toBe(2000);
    expect(bRow?.summary_stale_since).toBe(2000);
    expect(cRow?.summary_stale_since).toBe(2000);

    // 9 submitJob calls: 3 per file (summary, concepts, change_impact) x 3 files
    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    expect(mockSubmitJob).toHaveBeenCalledTimes(9);
  });

  it('terminates with circular deps (A->B->A), visits each file once', () => {
    const circAPath = p('circ-A.ts');
    const circBPath = p('circ-B.ts');
    insertFile(circAPath);
    insertFile(circBPath);
    insertDep(circBPath, circAPath); // B depends on A
    insertDep(circAPath, circBPath); // A depends on B (circular)

    // Should not throw or hang
    expect(() => cascadeStale(circAPath, { timestamp: 3000 })).not.toThrow();

    // Both files should be stale, but each visited only once
    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    const calledFiles = mockSubmitJob.mock.calls.map((c: unknown[]) => c[0]);
    const uniqueFiles = new Set(calledFiles);
    // Only 2 unique files, not infinite
    expect(uniqueFiles.size).toBeLessThanOrEqual(2);
  });

  it('stops at depth cap (depth >= 10 is not visited)', () => {
    // Create a linear chain of 13 files: root <- d1 <- d2 <- ... <- d12
    const fileList: string[] = [p('depth-root.ts')];
    for (let i = 1; i <= 12; i++) {
      fileList.push(p(`depth-dep-${i}.ts`));
    }
    for (const f of fileList) insertFile(f);
    // dep-1 depends on root, dep-2 depends on dep-1, etc.
    for (let i = 1; i <= 12; i++) {
      insertDep(fileList[i], fileList[i - 1]);
    }

    cascadeStale(fileList[0], { timestamp: 4000 });

    const sqlite = getSqlite();
    // dep-11 and dep-12 should NOT be stale
    const dep11 = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get(rawRel(fileList[11])) as { summary_stale_since: number | null } | undefined;
    const dep12 = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get(rawRel(fileList[12])) as { summary_stale_since: number | null } | undefined;
    expect(dep11?.summary_stale_since).toBeNull();
    expect(dep12?.summary_stale_since).toBeNull();

    // dep-10 (depth 10) should be marked stale
    const dep10 = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get(rawRel(fileList[10])) as { summary_stale_since: number | null } | undefined;
    expect(dep10?.summary_stale_since).toBe(4000);
  });

  it('marks only the changed file when it has zero dependents', () => {
    const isolatedPath = p('isolated.ts');
    insertFile(isolatedPath);

    cascadeStale(isolatedPath, { timestamp: 5000 });

    const sqlite = getSqlite();
    const row = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get(rawRel(isolatedPath)) as { summary_stale_since: number } | undefined;
    expect(row?.summary_stale_since).toBe(5000);

    // Only 3 submitJob calls for the 1 file
    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    expect(mockSubmitJob).toHaveBeenCalledTimes(3);
  });
});

describe('cascadeStale with changeContext', () => {
  beforeEach(() => {
    clearTables();
    (submitJob as ReturnType<typeof vi.fn>).mockClear();
  });

  it('passes directPayload to change_impact job for the root changed file', () => {
    const rootPath = p('root-with-ctx.ts');
    insertFile(rootPath);

    cascadeStale(rootPath, {
      timestamp: 7000,
      changeContext: {
        directPayload: 'diff content for root file',
        changeType: 'exports-changed',
        changedFilePath: rootPath,
      },
    });

    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    // Find the change_impact call for the root file
    const changeImpactCall = mockSubmitJob.mock.calls.find(
      (c: unknown[]) => c[0] === rootPath && c[1] === 'change_impact'
    );
    expect(changeImpactCall).toBeDefined();
    expect(changeImpactCall![4]).toBe('diff content for root file');
  });

  it('builds dependent payload for cascade dependents containing upstream change info', async () => {
    const depPath = p('dep-file.ts');
    const changedRootPath = p('changed-root.ts');
    await fs.writeFile(depPath, 'export function depFn() {}');
    insertFile(changedRootPath);
    // insertFile calls writeFileSync, so depPath is already written above
    const sqlite = getSqlite();
    const depName = path.basename(depPath);
    sqlite.prepare('INSERT OR IGNORE INTO files (path, name, is_directory) VALUES (?, ?, 0)').run(depPath, depName);
    insertDep(depPath, changedRootPath); // depPath depends on changedRootPath

    cascadeStale(changedRootPath, {
      timestamp: 7100,
      changeContext: {
        directPayload: 'root diff',
        changeType: 'exports-changed',
        changedFilePath: changedRootPath,
      },
    });

    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    const depChangeImpactCall = mockSubmitJob.mock.calls.find(
      (c: unknown[]) => c[0] === depPath && c[1] === 'change_impact'
    );
    expect(depChangeImpactCall).toBeDefined();
    const payload = depChangeImpactCall![4] as string;
    expect(payload).not.toBeNull();
    expect(payload).toContain(`[upstream change: ${changedRootPath} (exports-changed)]`);
    expect(payload).toContain('[assessing dependent:');
    expect(payload).toContain('export function depFn');
  });

  it('produces null payload for change_impact jobs when changeContext is absent (backward compat)', () => {
    const noCtxPath = p('no-ctx.ts');
    insertFile(noCtxPath);

    cascadeStale(noCtxPath, { timestamp: 7200 });

    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    const changeImpactCall = mockSubmitJob.mock.calls.find(
      (c: unknown[]) => c[0] === noCtxPath && c[1] === 'change_impact'
    );
    expect(changeImpactCall).toBeDefined();
    // 5th argument should be undefined (no changeContext)
    expect(changeImpactCall![4]).toBeUndefined();
  });

  it('truncates large dependent file content at 14KB in dependent payload', async () => {
    const largePath = p('large-dep.ts');
    // 20KB of content
    await fs.writeFile(largePath, 'x'.repeat(20 * 1024));
    const changedForLargePath = p('changed-for-large.ts');
    insertFile(changedForLargePath);
    const sqlite = getSqlite();
    const largeName = path.basename(largePath);
    sqlite.prepare('INSERT OR IGNORE INTO files (path, name, is_directory) VALUES (?, ?, 0)').run(largePath, largeName);
    insertDep(largePath, changedForLargePath);

    cascadeStale(changedForLargePath, {
      timestamp: 7300,
      changeContext: {
        directPayload: 'small root diff',
        changeType: 'exports-changed',
        changedFilePath: changedForLargePath,
      },
    });

    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    const depCall = mockSubmitJob.mock.calls.find(
      (c: unknown[]) => c[0] === largePath && c[1] === 'change_impact'
    );
    expect(depCall).toBeDefined();
    const payload = depCall![4] as string;
    expect(payload).not.toBeNull();
    // Content should be truncated
    expect(payload).toContain('[truncated]');
    expect(payload.length).toBeLessThan(20 * 1024);
  });

  it('queues summary and concepts jobs WITHOUT payload even with changeContext', () => {
    const ctxJobPath = p('ctx-job-types.ts');
    insertFile(ctxJobPath);

    cascadeStale(ctxJobPath, {
      timestamp: 7400,
      changeContext: {
        directPayload: 'diff',
        changeType: 'exports-changed',
        changedFilePath: ctxJobPath,
      },
    });

    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    const summaryCall = mockSubmitJob.mock.calls.find(
      (c: unknown[]) => c[0] === ctxJobPath && c[1] === 'summary'
    );
    const conceptsCall = mockSubmitJob.mock.calls.find(
      (c: unknown[]) => c[0] === ctxJobPath && c[1] === 'concepts'
    );
    expect(summaryCall).toBeDefined();
    expect(conceptsCall).toBeDefined();
    // summary and concepts have no payload (5th arg undefined)
    expect(summaryCall![4]).toBeUndefined();
    expect(conceptsCall![4]).toBeUndefined();
  });
});

describe('markSelfStale', () => {
  beforeEach(() => {
    clearTables();
    (submitJob as ReturnType<typeof vi.fn>).mockClear();
  });

  it('marks only summary and concepts stale (NOT change_impact), queues 2 jobs', () => {
    const selfPath = p('self-only.ts');
    insertFile(selfPath);

    markSelfStale(selfPath, { timestamp: 6000 });

    const sqlite = getSqlite();
    const row = sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get(rawRel(selfPath)) as { summary_stale_since: number | null; concepts_stale_since: number | null; change_impact_stale_since: number | null } | undefined;

    expect(row?.summary_stale_since).toBe(6000);
    expect(row?.concepts_stale_since).toBe(6000);
    expect(row?.change_impact_stale_since).toBeNull(); // NOT set

    const mockSubmitJob = submitJob as ReturnType<typeof vi.fn>;
    expect(mockSubmitJob).toHaveBeenCalledTimes(2);
    const jobTypes = mockSubmitJob.mock.calls.map((c: unknown[]) => c[1]);
    expect(jobTypes).toContain('summary');
    expect(jobTypes).toContain('concepts');
    expect(jobTypes).not.toContain('change_impact');
  });
});
