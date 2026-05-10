// src/db/repository.find-callers-warning.test.ts
// P1 stopgap — when getCallers / getCallees is asked about an indexed symbol
// but returns 0 edges, surface a `warning` field so agents know to verify with
// grep instead of silently trusting "no callers." This compensates for parser
// gaps (e.g., React hook export patterns) until the underlying fix lands.
//
// Surfaced: docs/known-issues/find-callers-react-hooks.md
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase } from './db.js';
import {
  upsertFile,
  upsertSymbols,
  setEdgesAndSymbols,
  getCallers,
  getCallees,
} from './repository.js';
import type { CallSiteEdge } from '../change-detector/types.js';
import type { FileNode } from '../types.js';

let tmpDir: string;

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

function seedFile(filePath: string, symbols: Array<{ name: string; startLine?: number; endLine?: number }>): void {
  upsertFile(makeFileNode(filePath));
  upsertSymbols(filePath, symbols.map(s => ({
    name: s.name,
    kind: 'function' as const,
    startLine: s.startLine ?? 1,
    endLine: s.endLine ?? 1,
    isExport: true,
  })));
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-find-callers-warning-'));
  openDatabase(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ } }
});

// ─── getCallers ───────────────────────────────────────────────────────────────

describe('getCallers — warning field', () => {
  it('symbol not indexed: returns empty, no warning (true negative — name does not exist)', () => {
    const result = getCallers('nonexistent');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect((result as { warning?: string }).warning).toBeUndefined();
  });

  it('symbol indexed with callers: returns results, no warning', () => {
    const aPath = path.join(tmpDir, 'a.ts');
    setEdgesAndSymbols(aPath, [], [
      { name: 'caller', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'callee', kind: 'function', startLine: 5, endLine: 7, isExport: true },
    ], undefined, [{
      callerName: 'caller', callerStartLine: 1,
      calleePath: aPath, calleeName: 'callee',
      callLine: 2, confidence: 1.0,
    }] as CallSiteEdge[]);

    const result = getCallers('callee');
    expect(result.items.length).toBe(1);
    expect(result.items[0].name).toBe('caller');
    expect(result.total).toBe(1);
    expect((result as { warning?: string }).warning).toBeUndefined();
  });

  it('symbol indexed without callers: returns empty, WITH warning (suspected parser miss)', () => {
    const aPath = path.join(tmpDir, 'a.ts');
    seedFile(aPath, [{ name: 'useSportsGames', startLine: 20 }]);

    const result = getCallers('useSportsGames');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    const warning = (result as { warning?: string }).warning;
    expect(warning).toBeDefined();
    expect(warning).toMatch(/grep/i);
  });
});

// ─── getCallees ───────────────────────────────────────────────────────────────

describe('getCallees — warning field', () => {
  it('symbol not indexed: returns empty, no warning', () => {
    const result = getCallees('nonexistent');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    expect((result as { warning?: string }).warning).toBeUndefined();
  });

  it('symbol indexed with callees: returns results, no warning', () => {
    const aPath = path.join(tmpDir, 'a.ts');
    setEdgesAndSymbols(aPath, [], [
      { name: 'caller', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'callee', kind: 'function', startLine: 5, endLine: 7, isExport: true },
    ], undefined, [{
      callerName: 'caller', callerStartLine: 1,
      calleePath: aPath, calleeName: 'callee',
      callLine: 2, confidence: 1.0,
    }] as CallSiteEdge[]);

    const result = getCallees('caller');
    expect(result.items.length).toBe(1);
    expect(result.items[0].name).toBe('callee');
    expect(result.total).toBe(1);
    expect((result as { warning?: string }).warning).toBeUndefined();
  });

  it('symbol indexed without callees: returns empty, WITH warning', () => {
    const aPath = path.join(tmpDir, 'a.ts');
    seedFile(aPath, [{ name: 'isolatedFn', startLine: 1 }]);

    const result = getCallees('isolatedFn');
    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
    const warning = (result as { warning?: string }).warning;
    expect(warning).toBeDefined();
    expect(warning).toMatch(/grep/i);
  });
});
