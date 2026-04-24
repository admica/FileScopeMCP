// tests/unit/tool-outputs.test.ts
// Contract tests for MCP tool response shapes.
// Agents depend on stable output schemas — these tests prevent regressions.
// Tests the response construction logic WITHOUT starting the MCP server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { openDatabase, closeDatabase, getSqlite } from '../../src/db/db.js';
import {
  getFile,
  upsertFile,
  getAllFiles,
  getDependencies,
  getDependenciesWithEdgeMetadata,
  getDependents,
  getStaleness,
  markStale,
  searchFiles,
  getLlmProgress,
  writeLlmResult,
  clearStaleness,
  markAllStale,
  findSymbols,
  getDependentsWithImports,
  getSymbolsForFile,
  getFilesChangedSince,
  getFilesByPaths,
} from '../../src/db/repository.js';

let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-outputs-test-'));
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
      exports_snapshot TEXT,
      concepts TEXT,
      change_impact TEXT
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
      weight REAL DEFAULT 1.0,
      imported_names TEXT,
      import_line INTEGER
    );
    CREATE TABLE IF NOT EXISTS file_communities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      community_id INTEGER NOT NULL,
      file_path TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      is_export INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
    CREATE INDEX IF NOT EXISTS idx_symbols_path ON symbols(path);
  `);
});

afterAll(async () => {
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function clear(): void {
  const sqlite = getSqlite();
  sqlite.exec('DELETE FROM files; DELETE FROM file_dependencies; DELETE FROM file_communities; DELETE FROM symbols;');
}

function insertFile(filePath: string, opts: Record<string, any> = {}): void {
  const sqlite = getSqlite();
  const name = filePath.split('/').pop() ?? filePath;
  sqlite
    .prepare('INSERT OR REPLACE INTO files (path, name, is_directory, importance, summary, concepts, change_impact, summary_stale_since, concepts_stale_since, change_impact_stale_since) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?)')
    .run(
      filePath, name,
      opts.importance ?? 0,
      opts.summary ?? null,
      opts.concepts ?? null,
      opts.change_impact ?? null,
      opts.summary_stale_since ?? null,
      opts.concepts_stale_since ?? null,
      opts.change_impact_stale_since ?? null,
    );
}

function insertDep(src: string, tgt: string, opts: Record<string, any> = {}): void {
  const sqlite = getSqlite();
  sqlite.prepare(
    'INSERT INTO file_dependencies (source_path, target_path, dependency_type, edge_type, confidence, confidence_source, package_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    src, tgt,
    opts.dependency_type ?? 'local_import',
    opts.edge_type ?? 'imports',
    opts.confidence ?? 0.8,
    opts.confidence_source ?? 'inferred',
    opts.package_name ?? null,
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// get_file_summary response shape
// ═══════════════════════════════════════════════════════════════════════════════

describe('get_file_summary response contract', () => {
  it('returns path, importance, dependencies, dependents, summary', () => {
    clear();
    insertFile('/src/main.ts', { importance: 8, summary: 'Entry point' });
    insertFile('/src/utils.ts', { importance: 5 });
    insertDep('/src/main.ts', '/src/utils.ts');

    const node = getFile('/src/main.ts');
    const deps = getDependenciesWithEdgeMetadata('/src/main.ts');
    const staleness = getStaleness('/src/main.ts');

    // Simulate the response construction from mcp-server.ts
    const response = {
      path: node!.path,
      importance: node!.importance || 0,
      dependencies: deps.map(d => ({
        path: d.target_path,
        edgeType: d.edge_type,
        confidence: d.confidence,
      })),
      dependents: node!.dependents || [],
      summary: node!.summary || null,
      ...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
      ...(staleness.conceptsStale !== null && { conceptsStale: staleness.conceptsStale }),
      ...(staleness.changeImpactStale !== null && { changeImpactStale: staleness.changeImpactStale }),
    };

    expect(response.path).toBe('/src/main.ts');
    expect(response.importance).toBe(8);
    expect(response.dependencies).toHaveLength(1);
    expect(response.dependencies[0]).toEqual({
      path: '/src/utils.ts',
      edgeType: 'imports',
      confidence: 0.8,
    });
    expect(response.summary).toBe('Entry point');
    expect(response).not.toHaveProperty('summaryStale');
  });

  it('includes staleness fields when file is stale', () => {
    clear();
    insertFile('/src/stale.ts', {
      summary_stale_since: 1000,
      concepts_stale_since: 2000,
      change_impact_stale_since: 3000,
    });

    const staleness = getStaleness('/src/stale.ts');
    const response: Record<string, unknown> = {
      path: '/src/stale.ts',
      ...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
      ...(staleness.conceptsStale !== null && { conceptsStale: staleness.conceptsStale }),
      ...(staleness.changeImpactStale !== null && { changeImpactStale: staleness.changeImpactStale }),
    };

    expect(response.summaryStale).toBe(1000);
    expect(response.conceptsStale).toBe(2000);
    expect(response.changeImpactStale).toBe(3000);
  });

  it('omits staleness fields when file is fresh', () => {
    clear();
    insertFile('/src/fresh.ts');

    const staleness = getStaleness('/src/fresh.ts');
    const response: Record<string, unknown> = {
      path: '/src/fresh.ts',
      ...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
      ...(staleness.conceptsStale !== null && { conceptsStale: staleness.conceptsStale }),
      ...(staleness.changeImpactStale !== null && { changeImpactStale: staleness.changeImpactStale }),
    };

    expect(response).not.toHaveProperty('summaryStale');
    expect(response).not.toHaveProperty('conceptsStale');
    expect(response).not.toHaveProperty('changeImpactStale');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// list_files / find_important_files response shape
// ═══════════════════════════════════════════════════════════════════════════════

describe('list_files response contract', () => {
  it('flat list mode: files sorted by importance DESC', () => {
    clear();
    insertFile('/a.ts', { importance: 3 });
    insertFile('/b.ts', { importance: 8 });
    insertFile('/c.ts', { importance: 5 });

    const allFiles = getAllFiles().filter(f => !f.isDirectory);
    const sorted = allFiles.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    const results = sorted.slice(0, 2);

    const response = {
      files: results.map(f => ({
        path: f.path,
        importance: f.importance || 0,
        hasSummary: !!f.summary,
      })),
      truncated: true,
      totalCount: sorted.length,
    };

    expect(response.files[0].importance).toBe(8);
    expect(response.files[1].importance).toBe(5);
    expect(response.truncated).toBe(true);
    expect(response.totalCount).toBe(3);
  });
});

describe('find_important_files response contract', () => {
  it('includes dependentCount and dependencyCount', () => {
    clear();
    insertFile('/src/core.ts', { importance: 9 });
    insertFile('/src/helper.ts', { importance: 3 });
    insertDep('/src/helper.ts', '/src/core.ts');

    const node = getFile('/src/core.ts');
    const item = {
      path: node!.path,
      importance: node!.importance || 0,
      dependentCount: getDependents('/src/core.ts').length,
      dependencyCount: getDependencies('/src/core.ts').length,
      hasSummary: !!node!.summary,
    };

    expect(item.dependentCount).toBe(1);
    expect(item.dependencyCount).toBe(0);
    expect(typeof item.hasSummary).toBe('boolean');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// search response contract
// ═══════════════════════════════════════════════════════════════════════════════

describe('search response contract', () => {
  it('returns results with path, importance, purpose, matchRank', () => {
    clear();
    insertFile('/src/auth.ts', {
      importance: 7,
      concepts: JSON.stringify({
        functions: ['authenticate'],
        classes: [],
        interfaces: [],
        exports: [],
        purpose: 'authentication layer',
      }),
    });

    const result = searchFiles('authenticate');

    expect(result.results).toHaveLength(1);
    const r = result.results[0];
    expect(r).toHaveProperty('path');
    expect(r).toHaveProperty('importance');
    expect(r).toHaveProperty('purpose');
    expect(r).toHaveProperty('matchRank');
    expect(r.matchRank).toBe(100); // symbol match
  });

  it('empty query returns empty results', () => {
    expect(searchFiles('').results).toEqual([]);
    expect(searchFiles('   ').results).toEqual([]);
  });

  it('truncated flag set when results exceed maxItems', () => {
    clear();
    insertFile('/a.ts', { summary: 'test file' });
    insertFile('/b.ts', { summary: 'test file' });
    insertFile('/c.ts', { summary: 'test file' });

    const result = searchFiles('test', 2);
    expect(result.results).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('ranking: symbol(100) > purpose(50) > summary(20) > path(10)', () => {
    clear();
    insertFile('/broker.ts', { importance: 1 }); // path match = 10
    insertFile('/summary.ts', { importance: 2, summary: 'broker connection' }); // summary = 20
    insertFile('/purpose.ts', {
      importance: 3,
      concepts: JSON.stringify({ functions: [], classes: [], interfaces: [], exports: [], purpose: 'broker layer' }),
    }); // purpose = 50
    insertFile('/symbol.ts', {
      importance: 4,
      concepts: JSON.stringify({ functions: ['initBroker'], classes: [], interfaces: [], exports: [], purpose: '' }),
    }); // symbol = 100

    const result = searchFiles('broker');
    expect(result.results[0].matchRank).toBe(100);
    expect(result.results[1].matchRank).toBe(50);
    expect(result.results[2].matchRank).toBe(20);
    expect(result.results[3].matchRank).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// status response contract
// ═══════════════════════════════════════════════════════════════════════════════

describe('status response contract (LLM progress)', () => {
  it('getLlmProgress returns totalFiles, withSummary, withConcepts, pending counts', () => {
    clear();
    insertFile('/a.ts', { summary: 'has summary', concepts: '{}' });
    insertFile('/b.ts', { summary_stale_since: 1000, concepts_stale_since: 1000 });
    insertFile('/c.ts');

    const progress = getLlmProgress();
    expect(progress.totalFiles).toBe(3);
    expect(progress.withSummary).toBe(1);
    expect(progress.withConcepts).toBe(1);
    expect(progress.pendingSummary).toBe(1);
    expect(progress.pendingConcepts).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// writeLlmResult / clearStaleness contract
// ═══════════════════════════════════════════════════════════════════════════════

describe('writeLlmResult and clearStaleness', () => {
  it('writeLlmResult writes summary to correct column', () => {
    clear();
    insertFile('/src/a.ts');
    writeLlmResult('/src/a.ts', 'summary', 'This file does X');

    const node = getFile('/src/a.ts');
    expect(node!.summary).toBe('This file does X');
  });

  it('writeLlmResult writes concepts to correct column', () => {
    clear();
    insertFile('/src/a.ts');
    const conceptsJson = JSON.stringify({ functions: ['foo'], classes: [], interfaces: [], exports: [], purpose: 'test' });
    writeLlmResult('/src/a.ts', 'concepts', conceptsJson);

    const sqlite = getSqlite();
    const row = sqlite.prepare('SELECT concepts FROM files WHERE path = ?').get('/src/a.ts') as { concepts: string };
    expect(row.concepts).toBe(conceptsJson);
  });

  it('clearStaleness clears the correct column', () => {
    clear();
    insertFile('/src/a.ts');
    markStale(['/src/a.ts'], 5000);

    clearStaleness('/src/a.ts', 'summary');
    const staleness = getStaleness('/src/a.ts');
    expect(staleness.summaryStale).toBeNull();
    expect(staleness.conceptsStale).toBe(5000); // untouched
    expect(staleness.changeImpactStale).toBe(5000); // untouched
  });

  it('writeLlmResult throws for unknown jobType', () => {
    clear();
    insertFile('/src/a.ts');
    expect(() => writeLlmResult('/src/a.ts', 'invalid_type', 'data')).toThrow();
  });

  it('clearStaleness throws for unknown jobType', () => {
    clear();
    insertFile('/src/a.ts');
    expect(() => clearStaleness('/src/a.ts', 'invalid_type')).toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// markAllStale contract
// ═══════════════════════════════════════════════════════════════════════════════

describe('markAllStale', () => {
  it('marks files at or above minImportance', () => {
    clear();
    insertFile('/high.ts', { importance: 8 });
    insertFile('/low.ts', { importance: 1 });

    const count = markAllStale(Date.now(), 5);
    expect(count).toBe(1); // Only high.ts

    const highStale = getStaleness('/high.ts');
    const lowStale = getStaleness('/low.ts');
    expect(highStale.summaryStale).not.toBeNull();
    expect(lowStale.summaryStale).toBeNull();
  });

  it('remaining_only=true skips files that already have summaries', () => {
    clear();
    insertFile('/summarized.ts', { importance: 8, summary: 'already done' });
    insertFile('/unsummarized.ts', { importance: 8 });

    const count = markAllStale(Date.now(), 1, true);
    expect(count).toBe(1); // Only unsummarized

    const summarizedStale = getStaleness('/summarized.ts');
    expect(summarizedStale.summaryStale).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// find_symbol response contract (Phase 34)
// ═══════════════════════════════════════════════════════════════════════════════

describe('find_symbol response contract (Phase 34)', () => {
  it('returns {items: [], total: 0} with no truncated key on zero match', () => {
    clear();
    const { items, total } = findSymbols({ name: 'Nothing', exportedOnly: true, limit: 50 });
    const truncated = items.length < total;
    const response: Record<string, unknown> = {
      items: items.map(s => ({ path: s.path, name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine, isExport: s.isExport })),
      total,
      ...(truncated && { truncated: true }),
    };
    expect(response.items).toEqual([]);
    expect(response.total).toBe(0);
    expect('truncated' in response).toBe(false);
  });

  it('returns items with expected shape keys and omits truncated on full match', () => {
    clear();
    const sqlite = getSqlite();
    sqlite.prepare('INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)')
      .run('/src/a.ts', 'foo', 'function', 1, 5, 1);
    const { items, total } = findSymbols({ name: 'foo', exportedOnly: true, limit: 50 });
    const truncated = items.length < total;
    const response: Record<string, unknown> = {
      items: items.map(s => ({ path: s.path, name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine, isExport: s.isExport })),
      total,
      ...(truncated && { truncated: true }),
    };
    expect((response.items as any[])[0]).toEqual({ path: '/src/a.ts', name: 'foo', kind: 'function', startLine: 1, endLine: 5, isExport: true });
    expect(response.total).toBe(1);
    expect('truncated' in response).toBe(false);
  });

  it('includes truncated: true when items.length < total', () => {
    clear();
    const sqlite = getSqlite();
    for (let i = 0; i < 5; i++) {
      sqlite.prepare('INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)')
        .run(`/src/f${i}.ts`, 'foo', 'function', 1, 5, 1);
    }
    const { items, total } = findSymbols({ name: 'foo', exportedOnly: true, limit: 2 });
    const truncated = items.length < total;
    const response: Record<string, unknown> = {
      items,
      total,
      ...(truncated && { truncated: true }),
    };
    expect(response.total).toBe(5);
    expect(response.truncated).toBe(true);
    expect((response.items as any[]).length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// get_file_summary Phase 34 enrichment contract
// ═══════════════════════════════════════════════════════════════════════════════

describe('get_file_summary response contract — Phase 34 enrichment', () => {
  it('exports is an empty array when the file has no symbols', () => {
    clear();
    insertFile('/src/go.go', { importance: 5 });
    const exports = getSymbolsForFile('/src/go.go')
      .filter(s => s.isExport)
      .sort((a, b) => a.startLine - b.startLine)
      .map(s => ({ name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine }));
    expect(exports).toEqual([]);
  });

  it('exports is populated from symbols table, isExport=true only, sorted by startLine', () => {
    clear();
    insertFile('/src/mod.ts', { importance: 5 });
    const sqlite = getSqlite();
    sqlite.prepare('INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)')
      .run('/src/mod.ts', 'zebra', 'function', 30, 35, 1);
    sqlite.prepare('INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)')
      .run('/src/mod.ts', 'apple', 'class', 10, 15, 1);
    sqlite.prepare('INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)')
      .run('/src/mod.ts', '_priv', 'function', 20, 25, 0);
    const exports = getSymbolsForFile('/src/mod.ts')
      .filter(s => s.isExport)
      .sort((a, b) => a.startLine - b.startLine)
      .map(s => ({ name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine }));
    expect(exports.map(e => e.name)).toEqual(['apple', 'zebra']);
  });

  it('dependents[0] has shape {path, importedNames, importLines}', () => {
    clear();
    insertFile('/src/target.ts', { importance: 5 });
    insertFile('/src/user.ts', { importance: 5 });
    const sqlite = getSqlite();
    sqlite.prepare(
      'INSERT INTO file_dependencies (source_path, target_path, dependency_type, edge_type, confidence, confidence_source, imported_names, import_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('/src/user.ts', '/src/target.ts', 'local_import', 'imports', 0.8, 'inferred', JSON.stringify(['foo']), 3);
    const dependents = getDependentsWithImports('/src/target.ts');
    expect(dependents).toEqual([
      { path: '/src/user.ts', importedNames: ['foo'], importLines: [3] },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// list_changed_since response contract (Phase 35)
// ═══════════════════════════════════════════════════════════════════════════════

function insertFileWithMtime(p: string, mtime: number | null): void {
  const sqlite = getSqlite();
  const name = p.split('/').pop() ?? p;
  sqlite
    .prepare('INSERT OR REPLACE INTO files (path, name, is_directory, importance, mtime) VALUES (?, ?, 0, ?, ?)')
    .run(p, name, 0, mtime);
}

describe('list_changed_since response contract (Phase 35)', () => {
  it('returns {items: [], total: 0} with no truncated key on empty result', () => {
    clear();
    const rows = getFilesChangedSince(9999999);
    const sorted = rows.map(r => ({ path: r.path, mtime: r.mtime ?? 0 }));
    const limit = 50;
    const total = sorted.length;
    const items = sorted.slice(0, limit);
    const truncated = items.length < total;
    const response: Record<string, unknown> = {
      items,
      total,
      ...(truncated && { truncated: true }),
    };
    expect(response.items).toEqual([]);
    expect(response.total).toBe(0);
    expect('truncated' in response).toBe(false);
  });

  it('item shape is {path, mtime} only — no extra keys leak through', () => {
    clear();
    insertFileWithMtime('/src/a.ts', 2000);
    const rows = getFilesChangedSince(1000);
    const projected = rows.map(r => ({ path: r.path, mtime: r.mtime ?? 0 }));
    expect(projected).toEqual([{ path: '/src/a.ts', mtime: 2000 }]);
    expect(Object.keys(projected[0]).sort()).toEqual(['mtime', 'path']);
  });

  it('includes truncated: true when items.length < total', () => {
    clear();
    for (let i = 0; i < 5; i++) {
      insertFileWithMtime(`/src/f${i}.ts`, 2000 + i);
    }
    const rows = getFilesChangedSince(1000);
    const limit = 2;
    const sorted = rows.map(r => ({ path: r.path, mtime: r.mtime ?? 0 })).sort((a, b) => b.mtime - a.mtime);
    const total = sorted.length;
    const items = sorted.slice(0, limit);
    const truncated = items.length < total;
    const response: Record<string, unknown> = {
      items,
      total,
      ...(truncated && { truncated: true }),
    };
    expect(response.total).toBe(5);
    expect(response.truncated).toBe(true);
    expect((response.items as any[]).length).toBe(2);
  });

  it('SHA-mode intersection returns only DB-present paths', () => {
    clear();
    insertFileWithMtime('/src/present.ts', 1000);
    const gitOutput = ['/src/present.ts', '/src/deleted.ts'];
    const rows = getFilesByPaths(gitOutput);
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe('/src/present.ts');
  });

  it('null mtime coerces to 0 in response projection (D-15)', () => {
    clear();
    insertFileWithMtime('/src/nullm.ts', null);
    const rows = getFilesByPaths(['/src/nullm.ts']);
    const projected = rows.map(r => ({ path: r.path, mtime: r.mtime ?? 0 }));
    expect(projected[0].mtime).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool name registry
// ═══════════════════════════════════════════════════════════════════════════════

describe('MCP tool name registry', () => {
  it('all 15 expected tool names exist in mcp-server.ts source', async () => {
    const src = await fs.readFile(
      path.join(process.cwd(), 'src/mcp-server.ts'),
      'utf-8'
    );

    const expectedTools = [
      'set_base_directory',
      'list_files',
      'find_important_files',
      'get_file_summary',
      'set_file_summary',
      'set_file_importance',
      'scan_all',
      'search',
      'status',
      'exclude_and_remove',
      'detect_cycles',
      'get_cycles_for_file',
      'get_communities',
      'find_symbol',
      'list_changed_since',
    ];

    for (const tool of expectedTools) {
      expect(src).toContain(`server.registerTool("${tool}"`);
    }
  });
});
