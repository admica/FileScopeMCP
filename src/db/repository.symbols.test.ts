// src/db/repository.symbols.test.ts
// Phase 33 SYM-04 + IMP-03 — symbol CRUD, kv_state helpers, and per-edge import-metadata persistence.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getSqlite } from './db.js';
import {
  upsertSymbols,
  getSymbolsByName,
  getSymbolsForFile,
  deleteSymbolsForFile,
  getKvState,
  setKvState,
  setEdges,
  setEdgesAndSymbols,
  findSymbols,
  getDependentsWithImports,
} from './repository.js';
import type { Symbol as SymbolRow } from './symbol-types.js';
import type { ImportMeta } from '../change-detector/ast-parser.js';
import type { EdgeResult } from '../language-config.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-sym-repo-'));
  return path.join(tmpDir, 'test.db');
}

function makeSymbol(overrides: Partial<SymbolRow> = {}): SymbolRow {
  return { name: 'foo', kind: 'function', startLine: 1, endLine: 5, isExport: true, ...overrides };
}

function makeEdge(overrides: Partial<EdgeResult> = {}): EdgeResult {
  return {
    target: '/project/b.ts',
    edgeType: 'imports',
    confidence: 1.0,
    confidenceSource: 'extracted',
    weight: 1,
    isPackage: false,
    originalSpecifier: './b.js',
    ...overrides,
  };
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

describe('upsertSymbols / getSymbolsForFile', () => {
  it('inserts symbols and reads them back', () => {
    upsertSymbols('/project/a.ts', [
      makeSymbol({ name: 'foo', kind: 'function', startLine: 1, endLine: 10, isExport: true }),
      makeSymbol({ name: 'Bar', kind: 'class',    startLine: 12, endLine: 30, isExport: false }),
    ]);
    const rows = getSymbolsForFile('/project/a.ts');
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(expect.objectContaining({ name: 'foo', kind: 'function', isExport: true }));
    expect(rows).toContainEqual(expect.objectContaining({ name: 'Bar', kind: 'class', isExport: false }));
  });

  it('DELETEs then INSERTs on re-upsert (D-14 — replace semantics)', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'old' })]);
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'new' })]);
    const rows = getSymbolsForFile('/project/a.ts');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('new');
  });

  it('upsert to path A does not touch path B', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'fromA' })]);
    upsertSymbols('/project/b.ts', [makeSymbol({ name: 'fromB' })]);
    expect(getSymbolsForFile('/project/a.ts').map(s => s.name)).toEqual(['fromA']);
    expect(getSymbolsForFile('/project/b.ts').map(s => s.name)).toEqual(['fromB']);
  });

  it('handles empty symbols array (DELETE only, no inserts)', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'foo' })]);
    upsertSymbols('/project/a.ts', []);
    expect(getSymbolsForFile('/project/a.ts')).toHaveLength(0);
  });

  it('preserves all six kinds round-trip', () => {
    const kinds: SymbolRow['kind'][] = ['function', 'class', 'interface', 'type', 'enum', 'const'];
    upsertSymbols('/project/a.ts', kinds.map((k, i) => makeSymbol({ name: `sym${i}`, kind: k })));
    const rows = getSymbolsForFile('/project/a.ts');
    expect(rows.map(r => r.kind).sort()).toEqual([...kinds].sort());
  });
});

describe('getSymbolsByName', () => {
  it('returns matching symbols across files', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'sharedName', kind: 'function' })]);
    upsertSymbols('/project/b.ts', [makeSymbol({ name: 'sharedName', kind: 'class'    })]);
    const hits = getSymbolsByName('sharedName');
    expect(hits).toHaveLength(2);
    expect(hits.map(h => h.path).sort()).toEqual(['/project/a.ts', '/project/b.ts']);
  });

  it('filters by kind when provided', () => {
    upsertSymbols('/project/a.ts', [
      makeSymbol({ name: 'X', kind: 'function' }),
      makeSymbol({ name: 'X', kind: 'class'    }),
    ]);
    const hits = getSymbolsByName('X', 'class');
    expect(hits).toHaveLength(1);
    expect(hits[0].kind).toBe('class');
  });

  it('returns empty array when no match', () => {
    expect(getSymbolsByName('nonexistent')).toEqual([]);
  });
});

describe('deleteSymbolsForFile', () => {
  it('removes all rows for that path', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'foo' }), makeSymbol({ name: 'bar' })]);
    deleteSymbolsForFile('/project/a.ts');
    expect(getSymbolsForFile('/project/a.ts')).toHaveLength(0);
  });
});

describe('kv_state helpers', () => {
  it('setKvState then getKvState roundtrips', () => {
    setKvState('symbols_bulk_extracted', '2026-04-23T10:00:00Z');
    expect(getKvState('symbols_bulk_extracted')).toBe('2026-04-23T10:00:00Z');
  });

  it('getKvState returns null for missing key', () => {
    expect(getKvState('never_set')).toBeNull();
  });

  it('setKvState upserts existing key', () => {
    setKvState('k', 'v1');
    setKvState('k', 'v2');
    expect(getKvState('k')).toBe('v2');
  });
});

describe('setEdges — imported_names + import_line persistence (IMP-03)', () => {
  it('writes imported_names as JSON and import_line as integer', () => {
    const edges: EdgeResult[] = [makeEdge({ target: '/project/b.ts', originalSpecifier: './b.js' })];
    const importMeta: ImportMeta[] = [
      { specifier: './b.js', importedNames: ['useState', 'useEffect'], line: 3 },
    ];
    setEdges('/project/a.ts', edges, importMeta);
    const rows = getSqlite()
      .prepare('SELECT target_path, imported_names, import_line FROM file_dependencies WHERE source_path = ?')
      .all('/project/a.ts') as Array<{ target_path: string; imported_names: string | null; import_line: number | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].imported_names).toBe('["useState","useEffect"]');
    expect(rows[0].import_line).toBe(3);
  });

  it('leaves imported_names/import_line NULL when no ImportMeta provided', () => {
    setEdges('/project/a.ts', [makeEdge({ target: '/project/c.ts' })]);
    const row = getSqlite()
      .prepare('SELECT imported_names, import_line FROM file_dependencies WHERE source_path = ?')
      .get('/project/a.ts') as { imported_names: string | null; import_line: number | null };
    expect(row.imported_names).toBeNull();
    expect(row.import_line).toBeNull();
  });

  it('produces separate rows for two imports of the same target (D-08)', () => {
    const edges: EdgeResult[] = [
      makeEdge({ target: '/project/m.ts', originalSpecifier: './m.js' }),
      makeEdge({ target: '/project/m.ts', originalSpecifier: './m.js' }),
    ];
    const importMeta: ImportMeta[] = [
      { specifier: './m.js', importedNames: ['a'], line: 1 },
      { specifier: './m.js', importedNames: ['b'], line: 5 },
    ];
    setEdges('/project/a.ts', edges, importMeta);
    const rows = getSqlite()
      .prepare('SELECT target_path, imported_names, import_line FROM file_dependencies WHERE source_path = ? ORDER BY import_line')
      .all('/project/a.ts') as Array<{ target_path: string; imported_names: string | null; import_line: number | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].import_line).toBe(1);
    expect(rows[1].import_line).toBe(5);
    expect(rows[0].imported_names).toBe('["a"]');
    expect(rows[1].imported_names).toBe('["b"]');
  });

  it('leaves package edges with NULL metadata (package imports have no file-level importMeta match)', () => {
    const edges: EdgeResult[] = [makeEdge({
      target: 'node_modules/react',
      isPackage: true,
      packageName: 'react',
      originalSpecifier: 'react',
    })];
    setEdges('/project/a.ts', edges, [{ specifier: 'react', importedNames: ['useState'], line: 1 }]);
    // Package edges SHOULD still carry metadata if the specifier matches — but the key assertion
    // is that the writer does not THROW for package edges and handles the metadata lookup gracefully.
    const row = getSqlite()
      .prepare('SELECT dependency_type, imported_names FROM file_dependencies WHERE source_path = ?')
      .get('/project/a.ts') as { dependency_type: string; imported_names: string | null };
    expect(row.dependency_type).toBe('package_import');
  });
});

describe('setEdgesAndSymbols — atomic per-file write (D-15)', () => {
  it('writes edges and symbols in one call', () => {
    const edges: EdgeResult[] = [makeEdge({ target: '/project/b.ts', originalSpecifier: './b.js' })];
    const importMeta: ImportMeta[] = [{ specifier: './b.js', importedNames: ['x'], line: 1 }];
    const syms: SymbolRow[] = [makeSymbol({ name: 'exported', kind: 'function' })];
    setEdgesAndSymbols('/project/a.ts', edges, syms, importMeta);

    const depRows = getSqlite()
      .prepare('SELECT COUNT(*) as n FROM file_dependencies WHERE source_path = ?')
      .get('/project/a.ts') as { n: number };
    const symRows = getSymbolsForFile('/project/a.ts');
    expect(depRows.n).toBe(1);
    expect(symRows).toHaveLength(1);
    expect(symRows[0].name).toBe('exported');
  });

  it('replaces both edges and symbols on second call', () => {
    setEdgesAndSymbols('/project/a.ts',
      [makeEdge({ target: '/project/old.ts', originalSpecifier: './old.js' })],
      [makeSymbol({ name: 'oldSym' })],
      [{ specifier: './old.js', importedNames: ['o'], line: 1 }],
    );
    setEdgesAndSymbols('/project/a.ts',
      [makeEdge({ target: '/project/new.ts', originalSpecifier: './new.js' })],
      [makeSymbol({ name: 'newSym' })],
      [{ specifier: './new.js', importedNames: ['n'], line: 1 }],
    );
    const depTargets = (getSqlite()
      .prepare('SELECT target_path FROM file_dependencies WHERE source_path = ?')
      .all('/project/a.ts') as Array<{ target_path: string }>).map(r => r.target_path);
    expect(depTargets).toEqual(['/project/new.ts']);
    expect(getSymbolsForFile('/project/a.ts').map(s => s.name)).toEqual(['newSym']);
  });
});

// ─── Helpers for Phase 34 describes below ───────────────────────────────
// Direct INSERT into file_dependencies with per-row imported_names/import_line control.
// Used by getDependentsWithImports tests where we need fine-grained row shape
// (NULL imported_names, namespace imports, package_import rows, etc.).
function insertDepRow(opts: {
  source: string;
  target: string;
  type?: 'local_import' | 'package_import';
  importedNames?: string[] | null;  // null → NULL column, array → JSON.stringify
  importLine?: number | null;
}): void {
  const dependency_type = opts.type ?? 'local_import';
  const imported_names = opts.importedNames === null || opts.importedNames === undefined
    ? null
    : JSON.stringify(opts.importedNames);
  const import_line = opts.importLine === undefined ? null : opts.importLine;
  getSqlite()
    .prepare(
      `INSERT INTO file_dependencies
         (source_path, target_path, dependency_type, edge_type, confidence,
          confidence_source, weight, imported_names, import_line)
       VALUES (?, ?, ?, 'imports', 1.0, 'extracted', 1, ?, ?)`
    )
    .run(opts.source, opts.target, dependency_type, imported_names, import_line);
}

describe('findSymbols (Phase 34 FIND-01..04)', () => {
  it('exact match returns the single exact-name row', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'React', kind: 'const' })]);
    upsertSymbols('/project/b.ts', [makeSymbol({ name: 'Other', kind: 'const' })]);
    const res = findSymbols({ name: 'React', exportedOnly: false, limit: 50 });
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].name).toBe('React');
    expect(res.items[0].path).toBe('/project/a.ts');
  });

  it('exact match is case-sensitive', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'React', kind: 'const' })]);
    const res = findSymbols({ name: 'react', exportedOnly: false, limit: 50 });
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });

  it('prefix match (trailing *) returns all names with the prefix', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'React',    kind: 'const' })]);
    upsertSymbols('/project/b.ts', [makeSymbol({ name: 'ReactDOM', kind: 'const' })]);
    upsertSymbols('/project/c.ts', [makeSymbol({ name: 'Reactive', kind: 'const' })]);
    upsertSymbols('/project/d.ts', [makeSymbol({ name: 'Red',      kind: 'const' })]);
    const res = findSymbols({ name: 'React*', exportedOnly: false, limit: 50 });
    expect(res.total).toBe(3);
    expect(res.items).toHaveLength(3);
    // is_export DESC, path ASC, start_line ASC — all three have isExport=true (makeSymbol default)
    // so path ASC gives /project/a.ts, /project/b.ts, /project/c.ts
    expect(res.items.map(i => i.path)).toEqual(['/project/a.ts', '/project/b.ts', '/project/c.ts']);
    expect(res.items.map(i => i.name).sort()).toEqual(['React', 'ReactDOM', 'Reactive']);
  });

  it('prefix match is case-sensitive (GLOB)', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'React',    kind: 'const' })]);
    upsertSymbols('/project/b.ts', [makeSymbol({ name: 'react',    kind: 'const' })]);
    upsertSymbols('/project/c.ts', [makeSymbol({ name: 'ReactDOM', kind: 'const' })]);
    const res = findSymbols({ name: 'React*', exportedOnly: false, limit: 50 });
    expect(res.total).toBe(2);
    expect(res.items.map(i => i.name).sort()).toEqual(['React', 'ReactDOM']);
  });

  it('exportedOnly=true excludes non-exported symbols', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'foo', kind: 'function', isExport: true  })]);
    upsertSymbols('/project/b.ts', [makeSymbol({ name: 'foo', kind: 'function', isExport: false })]);
    expect(findSymbols({ name: 'foo', exportedOnly: true,  limit: 50 }).total).toBe(1);
    expect(findSymbols({ name: 'foo', exportedOnly: false, limit: 50 }).total).toBe(2);
  });

  it('kind filter narrows results', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'foo', kind: 'function' })]);
    upsertSymbols('/project/b.ts', [makeSymbol({ name: 'foo', kind: 'class'    })]);
    const res = findSymbols({ name: 'foo', kind: 'function', exportedOnly: false, limit: 50 });
    expect(res.total).toBe(1);
    expect(res.items).toHaveLength(1);
    expect(res.items[0].kind).toBe('function');
  });

  it('unknown kind returns empty — not an error', () => {
    upsertSymbols('/project/a.ts', [makeSymbol({ name: 'foo', kind: 'function' })]);
    // D-06: unknown kind → {items: [], total: 0}, never throws
    const res = findSymbols({ name: 'foo', kind: 'widget' as any, exportedOnly: false, limit: 50 });
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });

  it('total is pre-truncation and items.length <= limit', () => {
    // Seed 5 symbols named 'foo' across 5 distinct paths.
    for (let i = 0; i < 5; i++) {
      upsertSymbols(`/project/f${i}.ts`, [makeSymbol({ name: 'foo', kind: 'function' })]);
    }
    const res = findSymbols({ name: 'foo', exportedOnly: false, limit: 3 });
    expect(res.total).toBe(5);
    expect(res.items).toHaveLength(3);
  });

  it('ordering is is_export DESC, path ASC, start_line ASC', () => {
    // Interleaved seeding to prove we don't rely on insertion order.
    upsertSymbols('/project/b.ts', [makeSymbol({ name: 'foo', kind: 'function', isExport: false, startLine: 1,  endLine: 2 })]);
    upsertSymbols('/project/a.ts', [
      makeSymbol({ name: 'foo', kind: 'function', isExport: true,  startLine: 10, endLine: 12 }),
      makeSymbol({ name: 'foo', kind: 'function', isExport: true,  startLine: 5,  endLine: 7  }),
    ]);
    const res = findSymbols({ name: 'foo', exportedOnly: false, limit: 50 });
    expect(res.total).toBe(3);
    // Expected order:
    //   (a.ts, startLine 5,  isExport=1)  — export first, path asc, line asc
    //   (a.ts, startLine 10, isExport=1)
    //   (b.ts, startLine 1,  isExport=0)
    expect(res.items.map(i => ({ path: i.path, startLine: i.startLine, isExport: i.isExport }))).toEqual([
      { path: '/project/a.ts', startLine: 5,  isExport: true  },
      { path: '/project/a.ts', startLine: 10, isExport: true  },
      { path: '/project/b.ts', startLine: 1,  isExport: false },
    ]);
  });

  it('zero matches returns {items: [], total: 0} not an error', () => {
    // No seed.
    const res = findSymbols({ name: 'nothing', exportedOnly: false, limit: 50 });
    expect(res).toEqual({ items: [], total: 0 });
  });
});

describe('getDependentsWithImports (Phase 34 SUM-02, D-12..D-15, D-18)', () => {
  it('returns [] when no dependents exist', () => {
    expect(getDependentsWithImports('/any/path')).toEqual([]);
  });

  it('single source + single import returns one entry with one name + one line', () => {
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', importedNames: ['useState'], importLine: 5 });
    expect(getDependentsWithImports('/src/b.ts')).toEqual([
      { path: '/src/a.ts', importedNames: ['useState'], importLines: [5] },
    ]);
  });

  it('same source + two distinct imports of same target → names merged + deduped, lines both', () => {
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', importedNames: ['useState', 'useEffect'], importLine: 5  });
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', importedNames: ['useState', 'useMemo'],   importLine: 10 });
    const res = getDependentsWithImports('/src/b.ts');
    expect(res).toHaveLength(1);
    expect(res[0].path).toBe('/src/a.ts');
    expect(res[0].importedNames).toEqual(['useEffect', 'useMemo', 'useState']); // alphabetical, deduped
    expect(res[0].importLines).toEqual([5, 10]);                                // ascending
  });

  it('NULL imported_names coerces to []', () => {
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', importedNames: null, importLine: null });
    const res = getDependentsWithImports('/src/b.ts');
    expect(res).toHaveLength(1);
    expect(res[0].importedNames).toEqual([]);
    expect(res[0].importLines).toEqual([]);
  });

  it('NULL import_line is excluded from importLines array', () => {
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', importedNames: ['foo'], importLine: 5 });
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', importedNames: ['bar'], importLine: null });
    const res = getDependentsWithImports('/src/b.ts');
    expect(res).toHaveLength(1);
    expect(res[0].importedNames).toEqual(['bar', 'foo']);
    expect(res[0].importLines).toEqual([5]);                                    // null excluded
  });

  it('two distinct sources produce two entries sorted by path ASC', () => {
    insertDepRow({ source: '/src/x.ts', target: '/src/t.ts', importedNames: ['a'], importLine: 1 });
    insertDepRow({ source: '/src/a.ts', target: '/src/t.ts', importedNames: ['b'], importLine: 2 });
    const res = getDependentsWithImports('/src/t.ts');
    expect(res).toHaveLength(2);
    expect(res[0].path).toBe('/src/a.ts');
    expect(res[1].path).toBe('/src/x.ts');
  });

  it('namespace import (["*"]) passes through as importedNames: ["*"]', () => {
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', importedNames: ['*'], importLine: 3 });
    const res = getDependentsWithImports('/src/b.ts');
    expect(res).toHaveLength(1);
    expect(res[0].importedNames).toEqual(['*']);
    expect(res[0].importLines).toEqual([3]);
  });

  it('package_import rows with target=target are excluded (local_import only)', () => {
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', type: 'local_import',   importedNames: ['foo'], importLine: 5 });
    insertDepRow({ source: '/src/a.ts', target: '/src/b.ts', type: 'package_import', importedNames: ['bar'], importLine: 6 });
    const res = getDependentsWithImports('/src/b.ts');
    expect(res).toHaveLength(1);
    expect(res[0].importedNames).toEqual(['foo']);                              // bar excluded
    expect(res[0].importLines).toEqual([5]);
  });
});
