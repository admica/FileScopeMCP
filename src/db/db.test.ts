import { describe, it, expect, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getDb } from './db.js';

let tmpDir: string;
let dbPath: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-test-'));
  return path.join(tmpDir, 'test.db');
}

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore if not open */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
});

describe('openDatabase', () => {
  it('creates a .db file at the specified path', () => {
    dbPath = makeTmpDb();
    openDatabase(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it('returns a usable db instance (getDb() does not throw)', () => {
    dbPath = makeTmpDb();
    openDatabase(dbPath);
    expect(() => getDb()).not.toThrow();
  });

  it('enables WAL mode (journal_mode = wal)', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const result = sqlite.pragma('journal_mode', { simple: true });
    expect(result).toBe('wal');
  });

  it('enables foreign_keys pragma', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const fk = sqlite.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });

  it('creates files table after migration', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('files');
  });

  it('creates file_dependencies table after migration', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('file_dependencies');
  });

  it('creates llm_jobs table after migration', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('llm_jobs');
  });

  it('creates schema_version table after migration', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const tableNames = tables.map(t => t.name);
    expect(tableNames).toContain('schema_version');
  });

  it('files table has required columns', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const cols = sqlite.prepare("PRAGMA table_info(files)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    const expected = [
      'path', 'name', 'is_directory', 'importance', 'summary', 'mtime',
      'summary_stale_since', 'concepts_stale_since', 'change_impact_stale_since'
    ];
    for (const col of expected) {
      expect(colNames).toContain(col);
    }
  });

  it('file_dependencies table has required columns', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const cols = sqlite.prepare("PRAGMA table_info(file_dependencies)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    expect(colNames).toContain('id');
    expect(colNames).toContain('source_path');
    expect(colNames).toContain('target_path');
    expect(colNames).toContain('dependency_type');
  });

  it('llm_jobs table has required columns', () => {
    dbPath = makeTmpDb();
    const { sqlite } = openDatabase(dbPath);
    const cols = sqlite.prepare("PRAGMA table_info(llm_jobs)").all() as { name: string }[];
    const colNames = cols.map(c => c.name);
    const expected = ['job_id', 'file_path', 'job_type', 'priority_tier', 'status',
                      'created_at', 'started_at', 'completed_at', 'error_message', 'retry_count'];
    for (const col of expected) {
      expect(colNames).toContain(col);
    }
  });
});

describe('closeDatabase', () => {
  it('closes the connection without error', () => {
    dbPath = makeTmpDb();
    openDatabase(dbPath);
    expect(() => closeDatabase()).not.toThrow();
  });

  it('getDb() throws after closeDatabase()', () => {
    dbPath = makeTmpDb();
    openDatabase(dbPath);
    closeDatabase();
    expect(() => getDb()).toThrow();
  });
});
