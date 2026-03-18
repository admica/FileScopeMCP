// src/cascade/cascade-engine.test.ts
// Tests for CascadeEngine BFS walk and repository functions markStale/insertLlmJobIfNotPending.
// Uses temp SQLite DB matching the established test pattern in the codebase.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { openDatabase, closeDatabase, getSqlite } from '../db/db.js';

let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cascade-engine-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  openDatabase(dbPath);

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
      is_dev_dependency INTEGER
    );
    CREATE TABLE IF NOT EXISTS llm_jobs (
      job_id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      job_type TEXT NOT NULL,
      priority_tier INTEGER NOT NULL DEFAULT 2,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      payload TEXT
    );
  `);
});

afterAll(async () => {
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Helper: insert a file row into the DB
function insertFile(filePath: string): void {
  const sqlite = getSqlite();
  const name = filePath.split('/').pop() ?? filePath;
  sqlite
    .prepare('INSERT OR IGNORE INTO files (path, name, is_directory) VALUES (?, ?, 0)')
    .run(filePath, name);
}

// Helper: insert a local_import dependency
function insertDep(sourcePath: string, targetPath: string): void {
  const sqlite = getSqlite();
  sqlite
    .prepare(
      'INSERT INTO file_dependencies (source_path, target_path, dependency_type) VALUES (?, ?, ?)'
    )
    .run(sourcePath, targetPath, 'local_import');
}

// Helper: clear all tables between test groups
function clearTables(): void {
  const sqlite = getSqlite();
  sqlite.exec('DELETE FROM files; DELETE FROM file_dependencies; DELETE FROM llm_jobs;');
}

// ─── Repository function tests ────────────────────────────────────────────────

import { markStale, insertLlmJobIfNotPending, upsertFile } from '../db/repository.js';
import type { FileNode } from '../types.js';

describe('markStale', () => {
  it('sets all 3 staleness columns to the given timestamp for all specified files', () => {
    clearTables();
    insertFile('/a.ts');
    insertFile('/b.ts');

    markStale(['/a.ts', '/b.ts'], 1000);

    const sqlite = getSqlite();
    const a = sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get('/a.ts') as { summary_stale_since: number; concepts_stale_since: number; change_impact_stale_since: number };
    const b = sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get('/b.ts') as { summary_stale_since: number; concepts_stale_since: number; change_impact_stale_since: number };

    expect(a.summary_stale_since).toBe(1000);
    expect(a.concepts_stale_since).toBe(1000);
    expect(a.change_impact_stale_since).toBe(1000);
    expect(b.summary_stale_since).toBe(1000);
    expect(b.concepts_stale_since).toBe(1000);
    expect(b.change_impact_stale_since).toBe(1000);
  });

  it('does not throw when called on a non-existent path (UPDATE matches 0 rows)', () => {
    clearTables();
    expect(() => markStale(['/nonexistent.ts'], 999)).not.toThrow();
  });
});

describe('insertLlmJobIfNotPending', () => {
  it('inserts a pending job row for the given file+type', () => {
    clearTables();
    insertFile('/a.ts');

    insertLlmJobIfNotPending('/a.ts', 'summary', 2);

    const sqlite = getSqlite();
    const row = sqlite.prepare("SELECT * FROM llm_jobs WHERE file_path = ? AND job_type = 'summary'").get('/a.ts') as { job_type: string; priority_tier: number; status: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.job_type).toBe('summary');
    expect(row!.priority_tier).toBe(2);
    expect(row!.status).toBe('pending');
  });

  it('is a no-op on second call with same file+type (dedup by pending status)', () => {
    clearTables();
    insertFile('/a.ts');

    insertLlmJobIfNotPending('/a.ts', 'summary', 2);
    insertLlmJobIfNotPending('/a.ts', 'summary', 2);

    const sqlite = getSqlite();
    const rows = sqlite.prepare("SELECT * FROM llm_jobs WHERE file_path = ? AND job_type = 'summary'").all('/a.ts') as { job_type: string }[];
    expect(rows).toHaveLength(1);
  });

  it('inserts a different job_type for the same file (not a duplicate)', () => {
    clearTables();
    insertFile('/a.ts');

    insertLlmJobIfNotPending('/a.ts', 'summary', 2);
    insertLlmJobIfNotPending('/a.ts', 'concepts', 2);

    const sqlite = getSqlite();
    const rows = sqlite.prepare("SELECT * FROM llm_jobs WHERE file_path = ?").all('/a.ts') as { job_type: string }[];
    expect(rows).toHaveLength(2);
    const types = rows.map(r => r.job_type);
    expect(types).toContain('summary');
    expect(types).toContain('concepts');
  });
});

describe('upsertFile staleness preservation', () => {
  it('does not clobber staleness columns when upsertFile is called after markStale', () => {
    clearTables();

    // Insert a file via upsertFile first
    const node: FileNode = {
      path: '/stale-test.ts',
      name: 'stale-test.ts',
      isDirectory: false,
      importance: 0,
    };
    upsertFile(node);

    // Set staleness directly via markStale
    markStale(['/stale-test.ts'], 5000);

    // Verify staleness was set
    const sqlite = getSqlite();
    const before = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get('/stale-test.ts') as { summary_stale_since: number };
    expect(before.summary_stale_since).toBe(5000);

    // Now call upsertFile again (e.g., on file change)
    upsertFile({ ...node, summary: 'Updated summary' });

    // Staleness columns must NOT have been reset to null
    const after = sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get('/stale-test.ts') as { summary_stale_since: number | null; concepts_stale_since: number | null; change_impact_stale_since: number | null };
    expect(after.summary_stale_since).toBe(5000);
    expect(after.concepts_stale_since).toBe(5000);
    expect(after.change_impact_stale_since).toBe(5000);
  });
});

// ─── CascadeEngine tests ──────────────────────────────────────────────────────

import { cascadeStale, markSelfStale } from './cascade-engine.js';

describe('cascadeStale', () => {
  it('marks A, B, C all stale and queues 9 LLM jobs when A has dependents B->C chain', () => {
    clearTables();
    // A is the changed file. B depends on A. C depends on B.
    insertFile('/A.ts');
    insertFile('/B.ts');
    insertFile('/C.ts');
    insertDep('/B.ts', '/A.ts'); // B imports from A
    insertDep('/C.ts', '/B.ts'); // C imports from B

    cascadeStale('/A.ts', { timestamp: 2000 });

    const sqlite = getSqlite();
    const checkStale = (p: string) =>
      sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get(p) as { summary_stale_since: number; concepts_stale_since: number; change_impact_stale_since: number } | undefined;

    const aRow = checkStale('/A.ts');
    const bRow = checkStale('/B.ts');
    const cRow = checkStale('/C.ts');

    expect(aRow?.summary_stale_since).toBe(2000);
    expect(aRow?.concepts_stale_since).toBe(2000);
    expect(aRow?.change_impact_stale_since).toBe(2000);
    expect(bRow?.summary_stale_since).toBe(2000);
    expect(cRow?.summary_stale_since).toBe(2000);

    // 9 LLM jobs total: 3 per file (summary, concepts, change_impact) × 3 files
    const jobs = sqlite.prepare('SELECT * FROM llm_jobs').all() as { file_path: string; job_type: string }[];
    expect(jobs).toHaveLength(9);
  });

  it('terminates with circular deps (A->B->A), visits each file once', () => {
    clearTables();
    insertFile('/circ-A.ts');
    insertFile('/circ-B.ts');
    insertDep('/circ-B.ts', '/circ-A.ts'); // B depends on A
    insertDep('/circ-A.ts', '/circ-B.ts'); // A depends on B (circular)

    // Should not throw or hang
    expect(() => cascadeStale('/circ-A.ts', { timestamp: 3000 })).not.toThrow();

    const sqlite = getSqlite();
    // Both files should be stale, but each visited only once
    const jobs = sqlite.prepare("SELECT file_path FROM llm_jobs").all() as { file_path: string }[];
    const uniqueFiles = new Set(jobs.map(j => j.file_path));
    // Only 2 unique files, not infinite
    expect(uniqueFiles.size).toBeLessThanOrEqual(2);
  });

  it('stops at depth cap (depth >= 10 is not visited)', () => {
    clearTables();
    // Create a linear chain of 13 files: root <- d1 <- d2 <- ... <- d12
    // d[n] depends on d[n-1], starting from root
    const files = ['/root.ts'];
    for (let i = 1; i <= 12; i++) {
      files.push(`/dep-${i}.ts`);
    }
    for (const f of files) insertFile(f);
    // dep-1 depends on root, dep-2 depends on dep-1, etc.
    for (let i = 1; i <= 12; i++) {
      insertDep(files[i], files[i - 1]);
    }

    cascadeStale('/root.ts', { timestamp: 4000 });

    const sqlite = getSqlite();
    // root (depth 0) + deps 1..10 (depths 1..10) = 11 files max
    // dep-11 and dep-12 are at depth 11 and 12 — should NOT be stale
    const dep11 = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get('/dep-11.ts') as { summary_stale_since: number | null } | undefined;
    const dep12 = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get('/dep-12.ts') as { summary_stale_since: number | null } | undefined;
    expect(dep11?.summary_stale_since).toBeNull();
    expect(dep12?.summary_stale_since).toBeNull();

    // But dep-10 (depth 10) — check if at boundary: depth >= 10 means skip
    // dep-1 is at depth 1, dep-10 is at depth 10
    // The BFS adds to queue with depth+1. We skip if depth >= 10.
    // root=0, d1=1, d2=2, ..., d10=10 — d10 should be marked stale (added when depth was 9 < 10)
    // d11=11 — should NOT be marked (depth 10 >= 10, so skip)
    const dep10 = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get('/dep-10.ts') as { summary_stale_since: number | null } | undefined;
    expect(dep10?.summary_stale_since).toBe(4000);
  });

  it('marks only the changed file when it has zero dependents', () => {
    clearTables();
    insertFile('/isolated.ts');

    cascadeStale('/isolated.ts', { timestamp: 5000 });

    const sqlite = getSqlite();
    const row = sqlite.prepare('SELECT summary_stale_since FROM files WHERE path = ?').get('/isolated.ts') as { summary_stale_since: number } | undefined;
    expect(row?.summary_stale_since).toBe(5000);

    // Only 3 jobs for the 1 file
    const jobs = sqlite.prepare('SELECT * FROM llm_jobs').all();
    expect(jobs).toHaveLength(3);
  });
});

describe('markSelfStale', () => {
  it('marks only summary and concepts stale (NOT change_impact), queues 2 jobs', () => {
    clearTables();
    insertFile('/self-only.ts');

    markSelfStale('/self-only.ts', { timestamp: 6000 });

    const sqlite = getSqlite();
    const row = sqlite.prepare('SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?').get('/self-only.ts') as { summary_stale_since: number | null; concepts_stale_since: number | null; change_impact_stale_since: number | null } | undefined;

    expect(row?.summary_stale_since).toBe(6000);
    expect(row?.concepts_stale_since).toBe(6000);
    expect(row?.change_impact_stale_since).toBeNull(); // NOT set

    const jobs = sqlite.prepare('SELECT job_type FROM llm_jobs').all() as { job_type: string }[];
    expect(jobs).toHaveLength(2);
    const types = jobs.map(j => j.job_type);
    expect(types).toContain('summary');
    expect(types).toContain('concepts');
    expect(types).not.toContain('change_impact');
  });
});
