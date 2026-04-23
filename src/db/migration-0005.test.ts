// src/db/migration-0005.test.ts
// Phase 33 SYM-03 / IMP-03 — verify migration 0005 creates the new tables/columns
// and preserves existing file_dependencies rows when applied to a non-empty DB.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getSqlite } from './db.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-mig05-'));
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
});

function hasTable(name: string): boolean {
  const row = getSqlite()
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return row?.name === name;
}

function hasColumn(table: string, column: string): boolean {
  const rows = getSqlite()
    .prepare(`PRAGMA table_info(${table})`)
    .all() as Array<{ name: string }>;
  return rows.some(r => r.name === column);
}

function hasIndex(name: string): boolean {
  const row = getSqlite()
    .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
    .get(name) as { name: string } | undefined;
  return row?.name === name;
}

describe('migration 0005 — fresh DB', () => {
  it('creates the symbols table with all expected columns', () => {
    openDatabase(path.join(tmpDir, 'fresh.db'));
    expect(hasTable('symbols')).toBe(true);
    expect(hasColumn('symbols', 'path')).toBe(true);
    expect(hasColumn('symbols', 'name')).toBe(true);
    expect(hasColumn('symbols', 'kind')).toBe(true);
    expect(hasColumn('symbols', 'start_line')).toBe(true);
    expect(hasColumn('symbols', 'end_line')).toBe(true);
    expect(hasColumn('symbols', 'is_export')).toBe(true);
  });

  it('creates the symbols indexes', () => {
    openDatabase(path.join(tmpDir, 'fresh.db'));
    expect(hasIndex('symbols_name_idx')).toBe(true);
    expect(hasIndex('symbols_path_idx')).toBe(true);
  });

  it('creates the kv_state table', () => {
    openDatabase(path.join(tmpDir, 'fresh.db'));
    expect(hasTable('kv_state')).toBe(true);
    expect(hasColumn('kv_state', 'key')).toBe(true);
    expect(hasColumn('kv_state', 'value')).toBe(true);
  });

  it('adds imported_names and import_line columns to file_dependencies', () => {
    openDatabase(path.join(tmpDir, 'fresh.db'));
    expect(hasColumn('file_dependencies', 'imported_names')).toBe(true);
    expect(hasColumn('file_dependencies', 'import_line')).toBe(true);
  });
});

describe('migration 0005 — existing pre-v1.6 DB simulation', () => {
  it('applies migration without error when file_dependencies already has rows', () => {
    const dbPath = path.join(tmpDir, 'existing.db');
    openDatabase(dbPath);

    // Insert a pre-v1.6-style row (imported_names / import_line not populated).
    getSqlite().prepare(
      `INSERT INTO file_dependencies (source_path, target_path, dependency_type)
       VALUES (?, ?, 'local_import')`
    ).run('/project/a.ts', '/project/b.ts');

    closeDatabase();

    // Re-open — migrate() is idempotent; should not throw.
    expect(() => openDatabase(dbPath)).not.toThrow();

    const rows = getSqlite()
      .prepare('SELECT source_path, target_path, imported_names, import_line FROM file_dependencies')
      .all() as Array<{ source_path: string; target_path: string; imported_names: string | null; import_line: number | null }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].source_path).toBe('/project/a.ts');
    expect(rows[0].imported_names).toBeNull();
    expect(rows[0].import_line).toBeNull();
  });
});
