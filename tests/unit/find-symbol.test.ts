// tests/unit/find-symbol.test.ts
// Phase 34 FIND-01..05 unit tests. Exercises findSymbols + the handler-layer
// clamp/projection/envelope logic WITHOUT starting the MCP server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, closeDatabase } from '../../src/db/db.js';
import { findSymbols, upsertSymbols } from '../../src/db/repository.js';
import type { Symbol as SymbolRow, SymbolKind } from '../../src/db/symbol-types.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-symbol-test-'));
  return path.join(tmpDir, 'test.db');
}

function makeSymbol(overrides: Partial<SymbolRow> = {}): SymbolRow {
  return { name: 'foo', kind: 'function', startLine: 1, endLine: 5, isExport: true, ...overrides };
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

// Small helper that mirrors the handler-level clamp + envelope assembly so
// tests assert on the SAME projection agents see.
function simulateFindSymbolResponse(args: { name: string; kind?: string; exportedOnly?: boolean; maxItems?: number }) {
  const limit = Math.max(1, Math.min(500, args.maxItems ?? 50));
  const exportedOnly = args.exportedOnly ?? true;
  const kindFilter = args.kind as SymbolKind | undefined;
  const { items, total } = findSymbols({ name: args.name, kind: kindFilter, exportedOnly, limit });
  const truncated = items.length < total;
  return {
    items: items.map(s => ({
      path: s.path, name: s.name, kind: s.kind,
      startLine: s.startLine, endLine: s.endLine, isExport: s.isExport,
    })),
    total,
    ...(truncated && { truncated: true }),
  };
}

describe('find_symbol handler — Phase 34', () => {
  describe('exact match (FIND-01, FIND-02)', () => {
    it('returns the single matching row when name matches exactly', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'React', kind: 'function', startLine: 10, endLine: 20, isExport: true })]);
      const response = simulateFindSymbolResponse({ name: 'React' });
      expect(response.items.length).toBe(1);
      expect(response.total).toBe(1);
      expect(response.items[0].name).toBe('React');
      expect('truncated' in response).toBe(false);
    });

    it('is case-sensitive (React and react treated as distinct)', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'React' })]);
      upsertSymbols('/b.ts', [makeSymbol({ name: 'react' })]);
      const response = simulateFindSymbolResponse({ name: 'React' });
      expect(response.total).toBe(1);
      expect(response.items[0].name).toBe('React');
    });

    it('returns {items:[], total:0} on zero match — not an error (FIND-05)', () => {
      const response = simulateFindSymbolResponse({ name: 'Nothing' });
      expect(response).toEqual({ items: [], total: 0 });
    });
  });

  describe('prefix match — trailing * (FIND-02, D-01)', () => {
    it('returns all names starting with the prefix', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'React' })]);
      upsertSymbols('/b.ts', [makeSymbol({ name: 'ReactDOM' })]);
      upsertSymbols('/c.ts', [makeSymbol({ name: 'Reactive' })]);
      upsertSymbols('/d.ts', [makeSymbol({ name: 'Red' })]);
      const response = simulateFindSymbolResponse({ name: 'React*' });
      expect(response.total).toBe(3);
      expect(response.items.map(i => i.name).sort()).toEqual(['React', 'ReactDOM', 'Reactive']);
    });

    it('is case-sensitive via GLOB', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'React' })]);
      upsertSymbols('/b.ts', [makeSymbol({ name: 'react' })]);
      upsertSymbols('/c.ts', [makeSymbol({ name: 'ReactDOM' })]);
      const response = simulateFindSymbolResponse({ name: 'React*' });
      expect(response.total).toBe(2);
      expect(response.items.map(i => i.name).sort()).toEqual(['React', 'ReactDOM']);
    });
  });

  describe('exportedOnly (FIND-03)', () => {
    it('defaults to true — non-exported symbols are excluded when the arg is undefined', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'foo', isExport: true })]);
      upsertSymbols('/b.ts', [makeSymbol({ name: 'foo', isExport: false })]);
      const response = simulateFindSymbolResponse({ name: 'foo' });
      expect(response.total).toBe(1);
      expect(response.items[0].path).toBe('/a.ts');
      expect(response.items[0].isExport).toBe(true);
    });

    it('exportedOnly=false includes private helpers', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'foo', isExport: true })]);
      upsertSymbols('/b.ts', [makeSymbol({ name: 'foo', isExport: false })]);
      const response = simulateFindSymbolResponse({ name: 'foo', exportedOnly: false });
      expect(response.total).toBe(2);
    });
  });

  describe('kind filter (D-06)', () => {
    it('narrows to matching kind', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'foo', kind: 'function' })]);
      upsertSymbols('/b.ts', [makeSymbol({ name: 'foo', kind: 'class' })]);
      const response = simulateFindSymbolResponse({ name: 'foo', kind: 'function' });
      expect(response.total).toBe(1);
      expect(response.items[0].kind).toBe('function');
    });

    it('unknown kind returns {items:[], total:0} — not an error', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'foo' })]);
      const response = simulateFindSymbolResponse({ name: 'foo', kind: 'widget' });
      expect(response).toEqual({ items: [], total: 0 });
    });
  });

  describe('maxItems clamp (D-04)', () => {
    it('default 50 when undefined', () => {
      for (let i = 0; i < 60; i++) {
        upsertSymbols(`/p${i}.ts`, [makeSymbol({ name: 'foo' })]);
      }
      const response = simulateFindSymbolResponse({ name: 'foo' });
      expect(response.items.length).toBe(50);
      expect(response.total).toBe(60);
      expect(response.truncated).toBe(true);
    });

    it('clamps 0 to 1', () => {
      upsertSymbols('/a.ts', [makeSymbol({ name: 'foo' })]);
      upsertSymbols('/b.ts', [makeSymbol({ name: 'foo' })]);
      upsertSymbols('/c.ts', [makeSymbol({ name: 'foo' })]);
      const response = simulateFindSymbolResponse({ name: 'foo', maxItems: 0 });
      expect(response.items.length).toBe(1);
    });

    it('clamps 10000 to 500', () => {
      for (let i = 0; i < 501; i++) {
        upsertSymbols(`/p${i}.ts`, [makeSymbol({ name: 'foo' })]);
      }
      const response = simulateFindSymbolResponse({ name: 'foo', maxItems: 10000 });
      expect(response.items.length).toBe(500);
      expect(response.total).toBe(501);
    });
  });

  describe('truncated envelope key (D-07)', () => {
    it('truncated is absent when items.length === total', () => {
      for (let i = 0; i < 5; i++) {
        upsertSymbols(`/p${i}.ts`, [makeSymbol({ name: 'foo' })]);
      }
      const response = simulateFindSymbolResponse({ name: 'foo', maxItems: 50 });
      expect('truncated' in response).toBe(false);
    });

    it('truncated: true is present when items.length < total', () => {
      for (let i = 0; i < 100; i++) {
        upsertSymbols(`/p${i}.ts`, [makeSymbol({ name: 'foo' })]);
      }
      const response = simulateFindSymbolResponse({ name: 'foo', maxItems: 3 });
      expect(response.truncated).toBe(true);
    });
  });
});
