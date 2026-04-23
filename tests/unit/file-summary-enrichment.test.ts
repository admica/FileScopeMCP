// tests/unit/file-summary-enrichment.test.ts
// Phase 34 SUM-01..04 unit tests. Exercises the get_file_summary enrichment
// logic (exports + rich dependents) WITHOUT starting the MCP server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, closeDatabase, getSqlite } from '../../src/db/db.js';
import { getDependentsWithImports, getSymbolsForFile, upsertSymbols } from '../../src/db/repository.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-summary-enrich-'));
  return path.join(tmpDir, 'test.db');
}

// Seed an edge with imported_names JSON + import_line directly.
function insertEdge(
  source: string,
  target: string,
  importedNames: string[] | null,
  importLine: number | null,
  kind: 'local_import' | 'package_import' = 'local_import',
): void {
  const sqlite = getSqlite();
  sqlite.prepare(
    'INSERT INTO file_dependencies (source_path, target_path, dependency_type, edge_type, confidence, confidence_source, package_name, imported_names, import_line) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    source, target, kind,
    'imports', 0.8, 'inferred', null,
    importedNames === null ? null : JSON.stringify(importedNames),
    importLine,
  );
}

// Simulate the handler-layer projection for exports (mcp-server.ts get_file_summary).
function projectExports(filePath: string) {
  return getSymbolsForFile(filePath)
    .filter(s => s.isExport)
    .sort((a, b) => a.startLine - b.startLine)
    .map(s => ({ name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine }));
}

beforeEach(() => {
  openDatabase(makeTmpDb());
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('get_file_summary Phase 34 enrichment', () => {
  describe('exports[] (SUM-01, D-09..D-11)', () => {
    it('returns only exported symbols, sorted by startLine', () => {
      upsertSymbols('/src/mod.ts', [
        { name: 'zebra', kind: 'function', startLine: 30, endLine: 35, isExport: true },
        { name: 'apple', kind: 'class',    startLine: 10, endLine: 15, isExport: true },
        { name: '_private', kind: 'function', startLine: 20, endLine: 25, isExport: false },
      ]);
      const exports = projectExports('/src/mod.ts');
      expect(exports).toEqual([
        { name: 'apple', kind: 'class',    startLine: 10, endLine: 15 },
        { name: 'zebra', kind: 'function', startLine: 30, endLine: 35 },
      ]);
    });

    it('returns [] for a path with no symbol rows (SUM-04)', () => {
      expect(projectExports('/src/no-symbols-here.go')).toEqual([]);
    });

    it('returns [] when a file has only non-exported symbols', () => {
      upsertSymbols('/src/mod.ts', [
        { name: '_a', kind: 'function', startLine: 1, endLine: 2, isExport: false },
      ]);
      expect(projectExports('/src/mod.ts')).toEqual([]);
    });

    it('projection shape omits path and isExport fields', () => {
      upsertSymbols('/src/mod.ts', [
        { name: 'foo', kind: 'function', startLine: 1, endLine: 2, isExport: true },
      ]);
      const exports = projectExports('/src/mod.ts');
      expect(Object.keys(exports[0]).sort()).toEqual(['endLine', 'kind', 'name', 'startLine']);
    });
  });

  describe('dependents[] enriched (SUM-02, D-12..D-15)', () => {
    it('returns [] when no dependents exist', () => {
      expect(getDependentsWithImports('/src/target.ts')).toEqual([]);
    });

    it('aggregates multiple edges from the same source into one entry', () => {
      insertEdge('/src/a.ts', '/src/target.ts', ['useState', 'useEffect'], 5);
      insertEdge('/src/a.ts', '/src/target.ts', ['useState', 'useMemo'], 10);
      const result = getDependentsWithImports('/src/target.ts');
      expect(result).toEqual([
        { path: '/src/a.ts', importedNames: ['useEffect', 'useMemo', 'useState'], importLines: [5, 10] },
      ]);
    });

    it('NULL imported_names is coerced to [] (SUM-04)', () => {
      insertEdge('/src/a.ts', '/src/target.ts', null, null);
      const result = getDependentsWithImports('/src/target.ts');
      expect(result).toEqual([{ path: '/src/a.ts', importedNames: [], importLines: [] }]);
    });

    it('namespace imports (["*"]) pass through (IMP-02)', () => {
      insertEdge('/src/a.ts', '/src/target.ts', ['*'], 5);
      const result = getDependentsWithImports('/src/target.ts');
      expect(result[0].importedNames).toEqual(['*']);
    });

    it('two distinct sources produce two entries sorted by path ASC (D-15)', () => {
      insertEdge('/src/x.ts', '/src/target.ts', ['foo'], 1);
      insertEdge('/src/a.ts', '/src/target.ts', ['bar'], 2);
      const result = getDependentsWithImports('/src/target.ts');
      expect(result.map(r => r.path)).toEqual(['/src/a.ts', '/src/x.ts']);
    });

    it('package_import rows are excluded', () => {
      insertEdge('/src/a.ts', '/src/target.ts', ['foo'], 1, 'package_import');
      expect(getDependentsWithImports('/src/target.ts')).toEqual([]);
    });
  });
});
