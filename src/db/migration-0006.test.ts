// src/db/migration-0006.test.ts
// Phase 36 CSE-01 — verify migration 0006 creates the empty symbol_dependencies
// table with its two indexes and remains idempotent when re-opened on a DB that
// already holds user data (symbols rows).
//
// Table ships EMPTY in Phase 36 (D-29c): zero write paths in this phase; population
// lands in Phase 37. No physical FOREIGN KEY per D-29b (symbols.id resets on
// re-scan per Pitfall 7).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getSqlite } from './db.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-mig06-'));
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

describe('migration 0006 — fresh DB', () => {
  it('creates the symbol_dependencies table with all expected columns', () => {
    openDatabase(path.join(tmpDir, 'fresh.db'));
    expect(hasTable('symbol_dependencies')).toBe(true);
    expect(hasColumn('symbol_dependencies', 'id')).toBe(true);
    expect(hasColumn('symbol_dependencies', 'caller_symbol_id')).toBe(true);
    expect(hasColumn('symbol_dependencies', 'callee_symbol_id')).toBe(true);
    expect(hasColumn('symbol_dependencies', 'call_line')).toBe(true);
    expect(hasColumn('symbol_dependencies', 'confidence')).toBe(true);
  });

  it('creates the symbol_dependencies indexes', () => {
    openDatabase(path.join(tmpDir, 'fresh.db'));
    expect(hasIndex('symbol_deps_caller_idx')).toBe(true);
    expect(hasIndex('symbol_deps_callee_idx')).toBe(true);
  });

  it('table ships empty — Phase 36 writes nothing', () => {
    openDatabase(path.join(tmpDir, 'fresh.db'));
    const rows = getSqlite()
      .prepare('SELECT COUNT(*) as n FROM symbol_dependencies')
      .get() as { n: number };
    expect(rows.n).toBe(0);
  });
});

describe('migration 0006 — idempotent re-open', () => {
  it('does not throw on a DB with existing symbols rows', () => {
    const dbPath = path.join(tmpDir, 'existing.db');
    openDatabase(dbPath);

    // Pre-populate the symbols table with one row (pre-v1.7 data shape).
    getSqlite().prepare(
      `INSERT INTO symbols (path, name, kind, start_line, end_line, is_export)
       VALUES (?, ?, 'function', 10, 20, 1)`
    ).run('/project/a.ts', 'doThing');

    closeDatabase();

    // Re-open — Drizzle migrator is idempotent; should not throw.
    expect(() => openDatabase(dbPath)).not.toThrow();

    // Existing symbols row preserved.
    const symbolRows = getSqlite()
      .prepare('SELECT path, name, kind FROM symbols')
      .all() as Array<{ path: string; name: string; kind: string }>;
    expect(symbolRows).toHaveLength(1);
    expect(symbolRows[0].path).toBe('/project/a.ts');
    expect(symbolRows[0].name).toBe('doThing');

    // symbol_dependencies table present after re-open and remains empty.
    expect(hasTable('symbol_dependencies')).toBe(true);
    const deps = getSqlite()
      .prepare('SELECT COUNT(*) as n FROM symbol_dependencies')
      .get() as { n: number };
    expect(deps.n).toBe(0);
  });
});
