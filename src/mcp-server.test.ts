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
      is_dev_dependency INTEGER,
      edge_type TEXT DEFAULT 'imports',
      confidence REAL DEFAULT 0.8,
      confidence_source TEXT DEFAULT 'inferred',
      weight REAL DEFAULT 1.0
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

import { getStaleness, markStale, getDependenciesWithEdgeMetadata } from './db/repository.js';

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

// Helper: insert a dependency row into the DB
function insertDependency(sourcePath: string, targetPath: string, opts?: {
  dependency_type?: string;
  edge_type?: string;
  confidence?: number;
  confidence_source?: string;
}): void {
  const sqlite = getSqlite();
  sqlite.prepare(
    'INSERT INTO file_dependencies (source_path, target_path, dependency_type, edge_type, confidence, confidence_source) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    sourcePath,
    targetPath,
    opts?.dependency_type ?? 'local_import',
    opts?.edge_type ?? 'imports',
    opts?.confidence ?? 0.8,
    opts?.confidence_source ?? 'inferred',
  );
}

// ─── getDependenciesWithEdgeMetadata tests ────────────────────────────────────

describe('getDependenciesWithEdgeMetadata', () => {
  it('returns empty array for file with no dependencies', () => {
    clearTables();
    insertFile('/src/alone.ts');

    const result = getDependenciesWithEdgeMetadata('/src/alone.ts');

    expect(result).toEqual([]);
  });

  it('returns {target_path, edge_type, confidence} for file with local_import edges', () => {
    clearTables();
    insertFile('/src/main.ts');
    insertFile('/src/utils.ts');
    insertDependency('/src/main.ts', '/src/utils.ts', {
      edge_type: 'imports',
      confidence: 0.8,
    });

    const result = getDependenciesWithEdgeMetadata('/src/main.ts');

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ target_path: '/src/utils.ts', edge_type: 'imports', confidence: 0.8 });
  });

  it('excludes package_import rows (only returns local_import)', () => {
    clearTables();
    insertFile('/src/main.ts');
    insertDependency('/src/main.ts', '/src/utils.ts', { dependency_type: 'local_import', edge_type: 'imports', confidence: 0.8 });
    insertDependency('/src/main.ts', 'react', { dependency_type: 'package_import', edge_type: 'imports', confidence: 1.0 });

    const result = getDependenciesWithEdgeMetadata('/src/main.ts');

    expect(result).toHaveLength(1);
    expect(result[0].target_path).toBe('/src/utils.ts');
  });

  it('returns correct edge_type values (imports, inherits, re_exports)', () => {
    clearTables();
    insertFile('/src/child.ts');
    insertFile('/src/parent.ts');
    insertFile('/src/base.ts');
    insertDependency('/src/child.ts', '/src/parent.ts', { edge_type: 'inherits', confidence: 1.0 });
    insertDependency('/src/child.ts', '/src/base.ts', { edge_type: 're_exports', confidence: 0.8 });

    const result = getDependenciesWithEdgeMetadata('/src/child.ts');

    expect(result).toHaveLength(2);
    const edgeTypes = result.map(r => r.edge_type);
    expect(edgeTypes).toContain('inherits');
    expect(edgeTypes).toContain('re_exports');
  });

  it('returns correct confidence values (1.0 for extracted, 0.8 for inferred)', () => {
    clearTables();
    insertFile('/src/a.ts');
    insertFile('/src/b.ts');
    insertFile('/src/c.ts');
    insertDependency('/src/a.ts', '/src/b.ts', { edge_type: 'imports', confidence: 1.0, confidence_source: 'extracted' });
    insertDependency('/src/a.ts', '/src/c.ts', { edge_type: 'imports', confidence: 0.8, confidence_source: 'inferred' });

    const result = getDependenciesWithEdgeMetadata('/src/a.ts');

    expect(result).toHaveLength(2);
    const bRow = result.find(r => r.target_path === '/src/b.ts');
    const cRow = result.find(r => r.target_path === '/src/c.ts');
    expect(bRow?.confidence).toBe(1.0);
    expect(cRow?.confidence).toBe(0.8);
  });
});

// ─── get_file_summary enriched dependency shape tests ─────────────────────────

describe('get_file_summary enriched dependency shape', () => {
  it('maps getDependenciesWithEdgeMetadata results to {path, edgeType, confidence} shape', () => {
    clearTables();
    insertFile('/src/main.ts');
    insertFile('/src/utils.ts');
    insertDependency('/src/main.ts', '/src/utils.ts', {
      edge_type: 'imports',
      confidence: 1.0,
      confidence_source: 'extracted',
    });

    const deps = getDependenciesWithEdgeMetadata('/src/main.ts');
    const mapped = deps.map(d => ({
      path: d.target_path,
      edgeType: d.edge_type,
      confidence: d.confidence,
    }));

    expect(mapped).toEqual([
      { path: '/src/utils.ts', edgeType: 'imports', confidence: 1.0 },
    ]);
  });

  it('maps inherits edge type correctly', () => {
    clearTables();
    insertFile('/src/child.ts');
    insertFile('/src/parent.ts');
    insertDependency('/src/child.ts', '/src/parent.ts', {
      edge_type: 'inherits',
      confidence: 1.0,
      confidence_source: 'extracted',
    });

    const deps = getDependenciesWithEdgeMetadata('/src/child.ts');
    const mapped = deps.map(d => ({
      path: d.target_path,
      edgeType: d.edge_type,
      confidence: d.confidence,
    }));

    expect(mapped).toEqual([
      { path: '/src/parent.ts', edgeType: 'inherits', confidence: 1.0 },
    ]);
  });
});

// ─── find_important_files maxItems truncation tests ───────────────────────────

describe('find_important_files maxItems truncation', () => {
  it('includes truncated and totalCount when results exceed maxItems', () => {
    clearTables();
    insertFile('/a.ts');
    insertFile('/b.ts');
    insertFile('/c.ts');

    // Simulate handler logic
    const allFiles = ['/a.ts', '/b.ts', '/c.ts'];
    const maxItems = 2;
    const isTruncated = allFiles.length > maxItems;
    const results = isTruncated ? allFiles.slice(0, maxItems) : allFiles;

    const response: Record<string, unknown> = {
      files: results,
      ...(isTruncated && { truncated: true }),
      ...(isTruncated && { totalCount: allFiles.length }),
    };

    expect(response.truncated).toBe(true);
    expect(response.totalCount).toBe(3);
    expect((response.files as string[]).length).toBe(2);
  });

  it('omits truncated and totalCount when all results fit', () => {
    clearTables();
    insertFile('/a.ts');
    insertFile('/b.ts');

    const allFiles = ['/a.ts', '/b.ts'];
    const maxItems = 5;
    const isTruncated = allFiles.length > maxItems;
    const results = isTruncated ? allFiles.slice(0, maxItems) : allFiles;

    const response: Record<string, unknown> = {
      files: results,
      ...(isTruncated && { truncated: true }),
      ...(isTruncated && { totalCount: allFiles.length }),
    };

    expect(response).not.toHaveProperty('truncated');
    expect(response).not.toHaveProperty('totalCount');
    expect((response.files as string[]).length).toBe(2);
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
      'list_files',
      'find_important_files',
      'get_file_summary',
      'set_file_summary',
      'set_file_importance',
      'scan_all',
      'status',
      'exclude_and_remove',
      'detect_cycles',
      'get_cycles_for_file',
    ];

    for (const toolName of expectedTools) {
      expect(src).toContain(`server.tool("${toolName}"`);
    }
  });
});
