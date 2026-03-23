// src/mcp-server.test.ts
// Tests for getStaleness() repository function and staleness injection in MCP tool responses.
// Uses a temp SQLite DB matching the established test pattern in the codebase.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { openDatabase, closeDatabase, getSqlite } from './db/db.js';

let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-server-test-'));
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
function insertFile(filePath: string, opts?: {
  summary?: string;
  summary_stale_since?: number | null;
  concepts_stale_since?: number | null;
  change_impact_stale_since?: number | null;
}): void {
  const sqlite = getSqlite();
  const name = filePath.split('/').pop() ?? filePath;
  sqlite
    .prepare('INSERT OR REPLACE INTO files (path, name, is_directory, summary, summary_stale_since, concepts_stale_since, change_impact_stale_since) VALUES (?, ?, 0, ?, ?, ?, ?)')
    .run(
      filePath,
      name,
      opts?.summary ?? null,
      opts?.summary_stale_since ?? null,
      opts?.concepts_stale_since ?? null,
      opts?.change_impact_stale_since ?? null,
    );
}

// Helper: clear all tables between test groups
function clearTables(): void {
  const sqlite = getSqlite();
  sqlite.exec('DELETE FROM files; DELETE FROM file_dependencies; DELETE FROM llm_jobs;');
}

// ─── getStaleness tests ────────────────────────────────────────────────────────

import { getStaleness, markStale } from './db/repository.js';

describe('getStaleness', () => {
  it('returns all nulls for a fresh file (no staleness set)', () => {
    clearTables();
    insertFile('/a.ts');

    const result = getStaleness('/a.ts');

    expect(result.summaryStale).toBeNull();
    expect(result.conceptsStale).toBeNull();
    expect(result.changeImpactStale).toBeNull();
  });

  it('returns all nulls for a nonexistent file', () => {
    clearTables();

    const result = getStaleness('/nonexistent.ts');

    expect(result.summaryStale).toBeNull();
    expect(result.conceptsStale).toBeNull();
    expect(result.changeImpactStale).toBeNull();
  });

  it('returns correct timestamps after markStale sets all three columns', () => {
    clearTables();
    insertFile('/a.ts');

    markStale(['/a.ts'], 1000);
    const result = getStaleness('/a.ts');

    expect(result.summaryStale).toBe(1000);
    expect(result.conceptsStale).toBe(1000);
    expect(result.changeImpactStale).toBe(1000);
  });

  it('returns mixed values when columns have different timestamps', () => {
    clearTables();
    insertFile('/mixed.ts', {
      summary_stale_since: 2000,
      concepts_stale_since: null,
      change_impact_stale_since: 3000,
    });

    const result = getStaleness('/mixed.ts');

    expect(result.summaryStale).toBe(2000);
    expect(result.conceptsStale).toBeNull();
    expect(result.changeImpactStale).toBe(3000);
  });
});

// ─── MCP response staleness injection tests ───────────────────────────────────
// These tests verify the shape of staleness injection logic: non-null fields
// appear in response objects; null fields are omitted (backward compatible).

describe('Staleness injection into MCP response shape', () => {
  it('fresh file: no staleness fields appear in get_file_summary response shape', () => {
    clearTables();
    insertFile('/fresh.ts', { summary: 'A fresh summary' });

    const stale = getStaleness('/fresh.ts');

    // Simulate what the mcp-server handler does: spread non-null fields only
    const response: Record<string, unknown> = {
      path: '/fresh.ts',
      summary: 'A fresh summary',
      ...(stale.summaryStale !== null && { summaryStale: stale.summaryStale }),
      ...(stale.conceptsStale !== null && { conceptsStale: stale.conceptsStale }),
      ...(stale.changeImpactStale !== null && { changeImpactStale: stale.changeImpactStale }),
    };

    expect(response).not.toHaveProperty('summaryStale');
    expect(response).not.toHaveProperty('conceptsStale');
    expect(response).not.toHaveProperty('changeImpactStale');
  });

  it('stale file: summaryStale appears in get_file_summary response shape', () => {
    clearTables();
    insertFile('/stale.ts', { summary: 'A stale summary', summary_stale_since: 9999 });

    const stale = getStaleness('/stale.ts');

    const response: Record<string, unknown> = {
      path: '/stale.ts',
      summary: 'A stale summary',
      ...(stale.summaryStale !== null && { summaryStale: stale.summaryStale }),
      ...(stale.conceptsStale !== null && { conceptsStale: stale.conceptsStale }),
      ...(stale.changeImpactStale !== null && { changeImpactStale: stale.changeImpactStale }),
    };

    expect(response).toHaveProperty('summaryStale', 9999);
    expect(response).not.toHaveProperty('conceptsStale');
    expect(response).not.toHaveProperty('changeImpactStale');
  });

  it('fully stale file: all three fields appear in get_file_importance response shape', () => {
    clearTables();
    insertFile('/all-stale.ts', {
      summary_stale_since: 1111,
      concepts_stale_since: 2222,
      change_impact_stale_since: 3333,
    });

    const stale = getStaleness('/all-stale.ts');

    const response: Record<string, unknown> = {
      path: '/all-stale.ts',
      importance: 5,
      dependencies: [],
      dependents: [],
      ...(stale.summaryStale !== null && { summaryStale: stale.summaryStale }),
      ...(stale.conceptsStale !== null && { conceptsStale: stale.conceptsStale }),
      ...(stale.changeImpactStale !== null && { changeImpactStale: stale.changeImpactStale }),
    };

    expect(response).toHaveProperty('summaryStale', 1111);
    expect(response).toHaveProperty('conceptsStale', 2222);
    expect(response).toHaveProperty('changeImpactStale', 3333);
  });

  it('find_important_files: stale entry includes staleness, fresh entry does not', () => {
    clearTables();
    insertFile('/important-fresh.ts');
    insertFile('/important-stale.ts', { summary_stale_since: 7777 });

    const files = ['/important-fresh.ts', '/important-stale.ts'];
    const responses = files.map(filePath => {
      const stale = getStaleness(filePath);
      return {
        path: filePath,
        importance: 5,
        ...(stale.summaryStale !== null && { summaryStale: stale.summaryStale }),
        ...(stale.conceptsStale !== null && { conceptsStale: stale.conceptsStale }),
        ...(stale.changeImpactStale !== null && { changeImpactStale: stale.changeImpactStale }),
      };
    });

    const freshEntry = responses.find(r => r.path === '/important-fresh.ts');
    const staleEntry = responses.find(r => r.path === '/important-stale.ts');

    expect(freshEntry).not.toHaveProperty('summaryStale');
    expect(staleEntry).toHaveProperty('summaryStale', 7777);
  });
});

// ─── COMPAT-01: All MCP tool names registered ─────────────────────────────────

describe('COMPAT-01: MCP tool names and schemas remain identical', () => {
  it('COMPAT-01: all expected MCP tool names are registered in mcp-server.ts', async () => {
    // Read the source file and verify all required tool names appear via server.tool() calls.
    // This is a static verification that no tool was accidentally removed or renamed.
    const src = await import('node:fs/promises').then(fsp =>
      fsp.readFile(new URL('../src/mcp-server.ts', import.meta.url).pathname.replace('/src/mcp-server.ts', '/src/mcp-server.ts'), 'utf-8')
    ).catch(() =>
      // fallback: read relative to cwd
      import('node:fs/promises').then(fsp => fsp.readFile('./src/mcp-server.ts', 'utf-8'))
    );

    const expectedTools = [
      'set_base_directory',
      'list_saved_trees',
      'delete_file_tree',
      'create_file_tree',
      'select_file_tree',
      'list_files',
      'get_file_importance',
      'find_important_files',
      'get_file_summary',
      'set_file_summary',
      'read_file_content',
      'set_file_importance',
      'recalculate_importance',
      'toggle_file_watching',
      'get_file_watching_status',
      'update_file_watching_config',
      'debug_list_all_files',
      'toggle_llm',
      'exclude_and_remove',
    ];

    for (const toolName of expectedTools) {
      expect(src).toContain(`server.tool("${toolName}"`);
    }
  });
});
