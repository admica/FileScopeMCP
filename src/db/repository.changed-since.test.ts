// src/db/repository.changed-since.test.ts
// Phase 35 (CHG-02, CHG-03, WTC-02) — unit tests for getFilesChangedSince,
// getFilesByPaths, and the extended deleteFile cascade.
// Harness pattern from src/db/repository.symbols.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getSqlite } from './db.js';
import {
  upsertFile,
  getFile,
  getFilesChangedSince,
  getFilesByPaths,
  deleteFile,
  upsertSymbols,
  getSymbolsForFile,
} from './repository.js';
import type { Symbol as SymbolRow } from './symbol-types.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-changed-since-'));
  return path.join(tmpDir, 'test.db');
}

beforeEach(() => {
  const dbPath = makeTmpDb();
  openDatabase(dbPath);
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
});

/**
 * Insert a file row with an explicit mtime (and optional is_directory).
 * upsertFile() accepts mtime on the FileNode, but raw SQL is used here
 * for precise NULL vs number control without fighting optional fields.
 */
function seedFile(filePath: string, mtime: number | null, isDirectory = false): void {
  // Use raw INSERT directly so we fully control all columns including mtime.
  getSqlite().prepare(
    'INSERT OR REPLACE INTO files (path, name, is_directory, mtime, importance) VALUES (?, ?, ?, ?, ?)'
  ).run(filePath, path.basename(filePath), isDirectory ? 1 : 0, mtime, 1);
}

function makeSymbol(overrides: Partial<SymbolRow> = {}): SymbolRow {
  return { name: 'foo', kind: 'function', startLine: 1, endLine: 5, isExport: true, ...overrides };
}

// ─── getFilesChangedSince ──────────────────────────────────────────────────

describe('getFilesChangedSince', () => {
  it('returns rows with mtime > since, ordered mtime DESC', () => {
    seedFile('/a.ts', 1000);
    seedFile('/b.ts', 2000);
    seedFile('/c.ts', 500);
    const rows = getFilesChangedSince(999);
    // c excluded (mtime=500 < 999); result is b then a (mtime DESC)
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ path: '/b.ts', mtime: 2000 });
    expect(rows[1]).toEqual({ path: '/a.ts', mtime: 1000 });
  });

  it('applies strict > boundary', () => {
    seedFile('/a.ts', 1000);
    // Exactly equal — should NOT appear (strict >)
    expect(getFilesChangedSince(1000)).toEqual([]);
    // One below — should appear
    const rows = getFilesChangedSince(999);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/a.ts');
  });

  it('excludes rows with mtime IS NULL', () => {
    seedFile('/null.ts', null);
    seedFile('/present.ts', 1000);
    const rows = getFilesChangedSince(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/present.ts');
  });

  it('excludes rows with is_directory = 1', () => {
    seedFile('/dir', 5000, true);
    seedFile('/file.ts', 100);
    const rows = getFilesChangedSince(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/file.ts');
  });

  it('returns [] on empty DB', () => {
    expect(getFilesChangedSince(0)).toEqual([]);
  });
});

// ─── getFilesByPaths ───────────────────────────────────────────────────────

describe('getFilesByPaths', () => {
  it('returns [] immediately for empty input', () => {
    // No seeding — proves no DB query is attempted and empty array is returned
    expect(getFilesByPaths([])).toEqual([]);
  });

  it('returns rows for matching paths and drops missing paths', () => {
    seedFile('/a.ts', 100);
    seedFile('/b.ts', 200);
    const rows = getFilesByPaths(['/a.ts', '/ghost.ts', '/b.ts']);
    expect(rows).toHaveLength(2);
    const paths = rows.map(r => r.path).sort();
    expect(paths).toEqual(['/a.ts', '/b.ts']);
  });

  it('handles batching above 500 paths', () => {
    // Seed 501 files
    for (let i = 0; i <= 500; i++) {
      seedFile(`/f${i}.ts`, i);
    }
    const allPaths = Array.from({ length: 501 }, (_, i) => `/f${i}.ts`);
    const rows = getFilesByPaths(allPaths);
    expect(rows).toHaveLength(501);
    // Verify all seeded paths appear in the result
    const resultPaths = new Set(rows.map(r => r.path));
    for (const p of allPaths) {
      expect(resultPaths.has(p)).toBe(true);
    }
  });

  it('preserves null mtime in result rows', () => {
    seedFile('/x.ts', null);
    const rows = getFilesByPaths(['/x.ts']);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/x.ts');
    expect(rows[0].mtime).toBeNull();
  });
});

// ─── extended deleteFile (WTC-02 cascade) ─────────────────────────────────

describe('deleteFile — WTC-02 symbols cascade', () => {
  it('cascades symbols on deleteFile — WTC-02', () => {
    seedFile('/a.ts', 100);
    upsertSymbols('/a.ts', [
      makeSymbol({ name: 'foo', kind: 'function', startLine: 1, endLine: 2, isExport: true }),
      makeSymbol({ name: 'bar', kind: 'const',    startLine: 3, endLine: 3, isExport: false }),
    ]);
    // Confirm symbols exist before deletion
    expect(getSymbolsForFile('/a.ts')).toHaveLength(2);

    deleteFile('/a.ts');

    // getSymbolsForFile returns empty
    expect(getSymbolsForFile('/a.ts')).toHaveLength(0);
    // Paranoid orphan-row guard: raw COUNT(*) must also be 0
    const count = getSqlite()
      .prepare('SELECT COUNT(*) AS n FROM symbols WHERE path = ?')
      .get('/a.ts') as { n: number };
    expect(count.n).toBe(0);
    // files row gone
    expect(getFile('/a.ts')).toBeNull();
  });
});
