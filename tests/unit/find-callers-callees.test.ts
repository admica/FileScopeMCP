// tests/unit/find-callers-callees.test.ts
// Phase 38-01 unit tests for getCallers() and getCallees() repository helpers.
// Validates query logic against a real SQLite DB without starting the MCP server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, closeDatabase, getSqlite } from '../../src/db/db.js';
import { upsertFile, upsertSymbols, getCallers, getCallees, setEdgesAndSymbols } from '../../src/db/repository.js';
import type { CallSiteEdge } from '../../src/change-detector/types.js';
import type { FileNode } from '../../src/types.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-callers-callees-test-'));
  return path.join(tmpDir, 'test.db');
}

function makeFileNode(p: string): FileNode {
  return {
    path: p,
    name: path.basename(p),
    isDirectory: false,
    importance: 1,
    summary: null,
    mtime: Date.now(),
    dependencies: [],
    dependents: [],
    packageDependencies: [],
  } as unknown as FileNode;
}

/** Seed a file + one or more symbols. */
function seedFile(filePath: string, symbols: Array<{ name: string; startLine?: number; endLine?: number }>): void {
  upsertFile(makeFileNode(filePath));
  upsertSymbols(filePath, symbols.map(s => ({
    name: s.name,
    kind: 'function' as const,
    startLine: s.startLine ?? 1,
    endLine: s.endLine ?? 10,
    isExport: true,
  })));
}

/**
 * Seed call-site edges from a caller file to a callee file.
 * Uses setEdgesAndSymbols so that symbol IDs are resolved inside the transaction.
 * Caller file's symbols must be provided; callee file must already be seeded in DB.
 */
function seedCallSiteEdges(
  callerPath: string,
  callerSymbols: Array<{ name: string; startLine?: number; endLine?: number }>,
  callSiteEdges: CallSiteEdge[]
): void {
  setEdgesAndSymbols(
    callerPath,
    [],
    callerSymbols.map(s => ({
      name: s.name,
      kind: 'function' as const,
      startLine: s.startLine ?? 1,
      endLine: s.endLine ?? 10,
      isExport: true,
    })),
    undefined,
    callSiteEdges
  );
}

// Handler-layer simulate helpers (mirror the tool handler's clamp logic)
function simulateGetCallersResponse(args: { name: string; filePath?: string; maxItems?: number }) {
  const limit = Math.max(1, Math.min(500, args.maxItems ?? 50));
  return getCallers(args.name, args.filePath, limit);
}

function simulateGetCalleesResponse(args: { name: string; filePath?: string; maxItems?: number }) {
  const limit = Math.max(1, Math.min(500, args.maxItems ?? 50));
  return getCallees(args.name, args.filePath, limit);
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

// ─── getCallers tests ──────────────────────────────────────────────────────────

describe('getCallers — Phase 38-01', () => {
  describe('basic caller resolution', () => {
    it('returns callers with correct envelope shape when edges exist', () => {
      const helperPath = path.join(tmpDir, 'helper.ts');
      const greetPath = path.join(tmpDir, 'greet.ts');

      // Seed callee file first
      seedFile(helperPath, [{ name: 'helper', startLine: 1 }]);

      // Seed caller + edge in one transaction
      seedCallSiteEdges(
        greetPath,
        [{ name: 'greet', startLine: 1 }],
        [{
          callerName: 'greet',
          callerStartLine: 1,
          calleePath: helperPath,
          calleeName: 'helper',
          callLine: 5,
          confidence: 0.8,
        }]
      );

      const result = simulateGetCallersResponse({ name: 'helper' });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.unresolvedCount).toBe(0);

      const item = result.items[0];
      expect(item.name).toBe('greet');
      expect(typeof item.path).toBe('string');
      expect(typeof item.kind).toBe('string');
      expect(typeof item.startLine).toBe('number');
      expect(typeof item.confidence).toBe('number');
    });

    it('returns {items:[], total:0, unresolvedCount:0} for unknown symbol', () => {
      const result = getCallers('no_such_symbol_xyz');
      expect(result).toEqual({ items: [], total: 0, unresolvedCount: 0 });
    });
  });

  describe('filePath filter (D-04)', () => {
    it('restricts target to the specified defining file', () => {
      const fileA = path.join(tmpDir, 'a.ts');
      const fileB = path.join(tmpDir, 'b.ts');
      const callerA = path.join(tmpDir, 'caller_a.ts');
      const callerB = path.join(tmpDir, 'caller_b.ts');

      // Both files define 'process'
      seedFile(fileA, [{ name: 'process', startLine: 1 }]);
      seedFile(fileB, [{ name: 'process', startLine: 1 }]);

      // callerA calls process from fileA
      seedCallSiteEdges(
        callerA,
        [{ name: 'callerFnA', startLine: 1 }],
        [{
          callerName: 'callerFnA',
          callerStartLine: 1,
          calleePath: fileA,
          calleeName: 'process',
          callLine: 2,
          confidence: 1.0,
        }]
      );

      // callerB calls process from fileB
      seedCallSiteEdges(
        callerB,
        [{ name: 'callerFnB', startLine: 1 }],
        [{
          callerName: 'callerFnB',
          callerStartLine: 1,
          calleePath: fileB,
          calleeName: 'process',
          callLine: 2,
          confidence: 1.0,
        }]
      );

      // With filePath = fileA, only callerA's callers should appear
      const result = simulateGetCallersResponse({ name: 'process', filePath: fileA });
      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('callerFnA');
    });
  });

  describe('self-loop exclusion', () => {
    it('excludes recursive self-calls from getCallers results', () => {
      const recurseFile = path.join(tmpDir, 'recurse.ts');

      // Seed the file first so the callee symbol exists for the self-loop
      seedFile(recurseFile, [{ name: 'recurse', startLine: 1 }]);

      // Write a self-loop: recurse calls itself
      seedCallSiteEdges(
        recurseFile,
        [{ name: 'recurse', startLine: 1 }],
        [{
          callerName: 'recurse',
          callerStartLine: 1,
          calleePath: recurseFile,
          calleeName: 'recurse',
          callLine: 3,
          confidence: 1.0,
        }]
      );

      const result = getCallers('recurse');
      // Self-loop must be excluded
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('maxItems clamping', () => {
    it('clamps maxItems=0 to 1 — does not throw', () => {
      const helperPath = path.join(tmpDir, 'h.ts');
      seedFile(helperPath, [{ name: 'helper', startLine: 1 }]);

      const callerPath = path.join(tmpDir, 'c.ts');
      seedCallSiteEdges(
        callerPath,
        [{ name: 'caller', startLine: 1 }],
        [{
          callerName: 'caller',
          callerStartLine: 1,
          calleePath: helperPath,
          calleeName: 'helper',
          callLine: 2,
          confidence: 0.8,
        }]
      );

      const result = simulateGetCallersResponse({ name: 'helper', maxItems: 0 });
      expect(result.items.length).toBeLessThanOrEqual(1);
    });

    it('clamps maxItems=1000 to 500', () => {
      const helperPath = path.join(tmpDir, 'h.ts');
      seedFile(helperPath, [{ name: 'helper', startLine: 1 }]);

      const result = simulateGetCallersResponse({ name: 'helper', maxItems: 1000 });
      expect(result.items.length).toBeLessThanOrEqual(500);
    });
  });

  describe('unresolvedCount (D-06)', () => {
    it('reports dangling caller references when caller symbol is deleted', () => {
      const helperPath = path.join(tmpDir, 'helper2.ts');
      const callerPath = path.join(tmpDir, 'caller2.ts');

      seedFile(helperPath, [{ name: 'helper2', startLine: 1 }]);
      seedCallSiteEdges(
        callerPath,
        [{ name: 'greet2', startLine: 1 }],
        [{
          callerName: 'greet2',
          callerStartLine: 1,
          calleePath: helperPath,
          calleeName: 'helper2',
          callLine: 2,
          confidence: 0.8,
        }]
      );

      // Delete caller symbols to simulate a stale edge
      getSqlite().prepare('DELETE FROM symbols WHERE path = ?').run(callerPath);

      const result = getCallers('helper2');
      expect(result.unresolvedCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ─── getCallees tests ──────────────────────────────────────────────────────────

describe('getCallees — Phase 38-01', () => {
  describe('basic callee resolution', () => {
    it('returns callees with correct envelope shape when edges exist', () => {
      const helperPath = path.join(tmpDir, 'helper3.ts');
      const greetPath = path.join(tmpDir, 'greet3.ts');

      seedFile(helperPath, [{ name: 'helper3', startLine: 1 }]);
      seedCallSiteEdges(
        greetPath,
        [{ name: 'greet3', startLine: 1 }],
        [{
          callerName: 'greet3',
          callerStartLine: 1,
          calleePath: helperPath,
          calleeName: 'helper3',
          callLine: 5,
          confidence: 0.8,
        }]
      );

      const result = simulateGetCalleesResponse({ name: 'greet3' });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.unresolvedCount).toBe(0);

      const item = result.items[0];
      expect(item.name).toBe('helper3');
      expect(typeof item.path).toBe('string');
      expect(typeof item.kind).toBe('string');
      expect(typeof item.startLine).toBe('number');
      expect(typeof item.confidence).toBe('number');
    });

    it('returns {items:[], total:0, unresolvedCount:0} for unknown symbol', () => {
      const result = getCallees('no_such_symbol_xyz');
      expect(result).toEqual({ items: [], total: 0, unresolvedCount: 0 });
    });
  });

  describe('self-loop exclusion', () => {
    it('excludes recursive self-calls from getCallees results', () => {
      const recurseFile = path.join(tmpDir, 'recurse2.ts');

      seedFile(recurseFile, [{ name: 'recurse2', startLine: 1 }]);

      // Write a self-loop
      seedCallSiteEdges(
        recurseFile,
        [{ name: 'recurse2', startLine: 1 }],
        [{
          callerName: 'recurse2',
          callerStartLine: 1,
          calleePath: recurseFile,
          calleeName: 'recurse2',
          callLine: 3,
          confidence: 1.0,
        }]
      );

      const result = getCallees('recurse2');
      // Self-loop must be excluded
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });

  describe('maxItems clamping', () => {
    it('clamps maxItems=0 to 1 — does not throw', () => {
      const helperPath = path.join(tmpDir, 'h4.ts');
      const callerPath = path.join(tmpDir, 'c4.ts');

      seedFile(helperPath, [{ name: 'helper4', startLine: 1 }]);
      seedCallSiteEdges(
        callerPath,
        [{ name: 'caller4', startLine: 1 }],
        [{
          callerName: 'caller4',
          callerStartLine: 1,
          calleePath: helperPath,
          calleeName: 'helper4',
          callLine: 2,
          confidence: 0.8,
        }]
      );

      const result = simulateGetCalleesResponse({ name: 'caller4', maxItems: 0 });
      expect(result.items.length).toBeLessThanOrEqual(1);
    });

    it('clamps maxItems=1000 to 500', () => {
      const result = simulateGetCalleesResponse({ name: 'noop', maxItems: 1000 });
      expect(result.items.length).toBeLessThanOrEqual(500);
    });
  });

  describe('unresolvedCount (D-06, reversed direction)', () => {
    it('reports dangling callee references when callee symbol is deleted', () => {
      const helperPath = path.join(tmpDir, 'helper5.ts');
      const callerPath = path.join(tmpDir, 'caller5.ts');

      seedFile(helperPath, [{ name: 'helper5', startLine: 1 }]);
      seedCallSiteEdges(
        callerPath,
        [{ name: 'greet5', startLine: 1 }],
        [{
          callerName: 'greet5',
          callerStartLine: 1,
          calleePath: helperPath,
          calleeName: 'helper5',
          callLine: 2,
          confidence: 0.8,
        }]
      );

      // Delete callee symbols to simulate a stale edge (callee-side eventual consistency)
      getSqlite().prepare('DELETE FROM symbols WHERE path = ?').run(helperPath);

      const result = getCallees('greet5');
      expect(result.unresolvedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('filePath filter (D-04)', () => {
    it('restricts caller lookup to the specified file', () => {
      const fileA = path.join(tmpDir, 'fa.ts');
      const fileB = path.join(tmpDir, 'fb.ts');
      const targetA = path.join(tmpDir, 'target_a.ts');
      const targetB = path.join(tmpDir, 'target_b.ts');

      // Two files each define 'dispatch'
      seedFile(targetA, [{ name: 'targetFnA', startLine: 1 }]);
      seedFile(targetB, [{ name: 'targetFnB', startLine: 1 }]);

      // fileA's dispatch calls targetFnA
      seedCallSiteEdges(
        fileA,
        [{ name: 'dispatch', startLine: 1 }],
        [{
          callerName: 'dispatch',
          callerStartLine: 1,
          calleePath: targetA,
          calleeName: 'targetFnA',
          callLine: 2,
          confidence: 1.0,
        }]
      );

      // fileB's dispatch calls targetFnB
      seedCallSiteEdges(
        fileB,
        [{ name: 'dispatch', startLine: 1 }],
        [{
          callerName: 'dispatch',
          callerStartLine: 1,
          calleePath: targetB,
          calleeName: 'targetFnB',
          callLine: 2,
          confidence: 1.0,
        }]
      );

      // With filePath = fileA, only dispatch in fileA's callees should appear
      const result = simulateGetCalleesResponse({ name: 'dispatch', filePath: fileA });
      expect(result.total).toBe(1);
      expect(result.items[0].name).toBe('targetFnA');
    });
  });
});
