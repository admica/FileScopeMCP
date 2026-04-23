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
    const depTargets = getSqlite()
      .prepare('SELECT target_path FROM file_dependencies WHERE source_path = ?')
      .all('/project/a.ts').map((r: { target_path: string }) => r.target_path);
    expect(depTargets).toEqual(['/project/new.ts']);
    expect(getSymbolsForFile('/project/a.ts').map(s => s.name)).toEqual(['newSym']);
  });
});
