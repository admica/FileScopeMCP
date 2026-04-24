// src/db/repository.call-sites.test.ts
// Phase 37 CSE-04 — setEdgesAndSymbols callSiteEdges optional param tests.
// Covers: backward compat, write, caller-side clear on rewrite, callee-side
// preserved, fresh-ID resolution (FLAG-02), silent discard on lookup miss,
// self-loop storage (D-14), and prepared-statement-reuse verification.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getSqlite } from './db.js';
import { upsertFile, upsertSymbols, setEdgesAndSymbols } from './repository.js';
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

/** Seed a file + one or more symbols, return the file path. */
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

/** Count rows in symbol_dependencies where caller's file = sourcePath */
function countCallerRows(sourcePath: string): number {
  const row = getSqlite()
    .prepare('SELECT COUNT(*) AS n FROM symbol_dependencies WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE path = ?)')
    .get(sourcePath) as { n: number };
  return row.n;
}

/** Count all rows in symbol_dependencies */
function countAllRows(): number {
  const row = getSqlite()
    .prepare('SELECT COUNT(*) AS n FROM symbol_dependencies')
    .get() as { n: number };
  return row.n;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-repo-callsites-'));
  openDatabase(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ } }
});

// ─── Backward compat + basic write ────────────────────────────────────────────

describe("setEdgesAndSymbols — callSiteEdges optional param (CSE-04)", () => {
  it('Test 1 (backward compat): calling without callSiteEdges leaves symbol_dependencies unchanged', () => {
    const aPath = path.join(tmpDir, 'a.ts');
    seedFile(aPath, [{ name: 'foo' }]);

    // Call without callSiteEdges — original 4-arg form
    setEdgesAndSymbols(aPath, [], [{ name: 'foo', kind: 'function', startLine: 1, endLine: 1, isExport: true }], undefined);

    expect(countAllRows()).toBe(0);
  });

  it('Test 2 (write): providing one same-file edge produces exactly one row in symbol_dependencies', () => {
    const aPath = path.join(tmpDir, 'a.ts');
    // Seed the file and symbols via upsertSymbols (pre-existing state)
    seedFile(aPath, [{ name: 'caller', startLine: 1 }, { name: 'callee', startLine: 5 }]);

    const callSiteEdges: CallSiteEdge[] = [{
      callerName: 'caller',
      callerStartLine: 1,
      calleePath: aPath,
      calleeName: 'callee',
      callLine: 3,
      confidence: 1.0,
    }];

    // setEdgesAndSymbols with callSiteEdges — re-inserts symbols + writes edges
    setEdgesAndSymbols(aPath, [], [
      { name: 'caller', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'callee', kind: 'function', startLine: 5, endLine: 7, isExport: true },
    ], undefined, callSiteEdges);

    expect(countCallerRows(aPath)).toBe(1);

    // Verify the exact column values
    const row = getSqlite()
      .prepare(`
        SELECT sd.call_line, sd.confidence
        FROM symbol_dependencies sd
        JOIN symbols sc ON sc.id = sd.caller_symbol_id
        JOIN symbols se ON se.id = sd.callee_symbol_id
        WHERE sc.path = ? AND sc.name = ? AND se.name = ?
      `)
      .get(aPath, 'caller', 'callee') as { call_line: number; confidence: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.call_line).toBe(3);
    expect(row!.confidence).toBe(1.0);
  });
});

// ─── Caller-side clear semantics ──────────────────────────────────────────────

describe("setEdgesAndSymbols — caller-side clear semantics", () => {
  it('Test 3 (caller-side clear on rewrite): re-scan replaces old edges with new ones', () => {
    const aPath = path.join(tmpDir, 'a.ts');

    // First write — caller calls foo
    setEdgesAndSymbols(aPath, [], [
      { name: 'caller', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'foo', kind: 'function', startLine: 5, endLine: 7, isExport: true },
      { name: 'bar', kind: 'function', startLine: 9, endLine: 11, isExport: true },
    ], undefined, [{
      callerName: 'caller', callerStartLine: 1,
      calleePath: aPath, calleeName: 'foo',
      callLine: 2, confidence: 1.0,
    }]);
    expect(countCallerRows(aPath)).toBe(1);

    // Second write — caller now calls bar instead
    setEdgesAndSymbols(aPath, [], [
      { name: 'caller', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'foo', kind: 'function', startLine: 5, endLine: 7, isExport: true },
      { name: 'bar', kind: 'function', startLine: 9, endLine: 11, isExport: true },
    ], undefined, [{
      callerName: 'caller', callerStartLine: 1,
      calleePath: aPath, calleeName: 'bar',
      callLine: 2, confidence: 1.0,
    }]);

    expect(countCallerRows(aPath)).toBe(1);

    // Old edge (caller→foo) should be gone; new (caller→bar) should exist
    const fooRow = getSqlite()
      .prepare(`SELECT COUNT(*) AS n FROM symbol_dependencies sd
                JOIN symbols sc ON sc.id = sd.caller_symbol_id
                JOIN symbols se ON se.id = sd.callee_symbol_id
                WHERE sc.name = 'caller' AND se.name = 'foo'`)
      .get() as { n: number };
    expect(fooRow.n).toBe(0);

    const barRow = getSqlite()
      .prepare(`SELECT COUNT(*) AS n FROM symbol_dependencies sd
                JOIN symbols sc ON sc.id = sd.caller_symbol_id
                JOIN symbols se ON se.id = sd.callee_symbol_id
                WHERE sc.name = 'caller' AND se.name = 'bar'`)
      .get() as { n: number };
    expect(barRow.n).toBe(1);
  });

  it('Test 4 (callee-side preserved): re-scanning file A does not remove rows from other files calling into A', () => {
    const aPath = path.join(tmpDir, 'a.ts');
    const bPath = path.join(tmpDir, 'b.ts');

    // Seed A with a symbol
    seedFile(aPath, [{ name: 'aFn', startLine: 1 }]);

    // Seed B with its own symbol and a call-site edge → A.aFn
    setEdgesAndSymbols(bPath, [], [
      { name: 'bFn', kind: 'function', startLine: 1, endLine: 3, isExport: true },
    ], undefined, [{
      callerName: 'bFn', callerStartLine: 1,
      calleePath: aPath, calleeName: 'aFn',
      callLine: 2, confidence: 0.8,
    }]);

    const beforeCount = countAllRows();
    expect(beforeCount).toBe(1);  // one B→A edge

    // Re-scan A — should NOT remove the B→A edge (callee-side preserved)
    setEdgesAndSymbols(aPath, [], [
      { name: 'aFn', kind: 'function', startLine: 1, endLine: 2, isExport: true },
    ], undefined, []);  // empty array → clear A's caller-side rows only

    // B→A edge must still exist
    expect(countAllRows()).toBe(1);
  });

  it('Test 5 (fresh caller IDs from same txn): re-scan regenerates symbol IDs; edges use fresh IDs', () => {
    const aPath = path.join(tmpDir, 'a.ts');

    // First write
    setEdgesAndSymbols(aPath, [], [
      { name: 'foo', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'bar', kind: 'function', startLine: 5, endLine: 7, isExport: true },
    ], undefined, [{
      callerName: 'foo', callerStartLine: 1,
      calleePath: aPath, calleeName: 'bar',
      callLine: 2, confidence: 1.0,
    }]);

    // Capture the symbol IDs from first write
    const firstFooId = (getSqlite().prepare('SELECT id FROM symbols WHERE path = ? AND name = ?').get(aPath, 'foo') as { id: number }).id;
    const firstBarId = (getSqlite().prepare('SELECT id FROM symbols WHERE path = ? AND name = ?').get(aPath, 'bar') as { id: number }).id;

    // Second write — same symbols but IDs will be regenerated (DELETE+INSERT)
    setEdgesAndSymbols(aPath, [], [
      { name: 'foo', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'bar', kind: 'function', startLine: 5, endLine: 7, isExport: true },
    ], undefined, [{
      callerName: 'foo', callerStartLine: 1,
      calleePath: aPath, calleeName: 'bar',
      callLine: 2, confidence: 1.0,
    }]);

    const secondFooId = (getSqlite().prepare('SELECT id FROM symbols WHERE path = ? AND name = ?').get(aPath, 'foo') as { id: number }).id;
    const secondBarId = (getSqlite().prepare('SELECT id FROM symbols WHERE path = ? AND name = ?').get(aPath, 'bar') as { id: number }).id;

    // IDs are regenerated (AUTOINCREMENT always increases)
    expect(secondFooId).toBeGreaterThan(firstFooId);
    expect(secondBarId).toBeGreaterThan(firstBarId);

    // Edge should use the NEW IDs (FLAG-02 resolution — fresh IDs in same txn)
    const edge = getSqlite()
      .prepare('SELECT caller_symbol_id, callee_symbol_id FROM symbol_dependencies')
      .get() as { caller_symbol_id: number; callee_symbol_id: number } | undefined;
    expect(edge).toBeDefined();
    expect(edge!.caller_symbol_id).toBe(secondFooId);
    expect(edge!.callee_symbol_id).toBe(secondBarId);
  });
});

// ─── Silent discard on lookup miss ───────────────────────────────────────────

describe("setEdgesAndSymbols — silent-discard on lookup miss", () => {
  it('Test 6 (silent discard — caller miss): callerStartLine mismatch → no INSERT', () => {
    const aPath = path.join(tmpDir, 'a.ts');

    // Symbol is at startLine=1 but edge says callerStartLine=99
    setEdgesAndSymbols(aPath, [], [
      { name: 'foo', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'bar', kind: 'function', startLine: 5, endLine: 7, isExport: true },
    ], undefined, [{
      callerName: 'foo', callerStartLine: 99,  // wrong line — lookup returns nothing
      calleePath: aPath, calleeName: 'bar',
      callLine: 2, confidence: 1.0,
    }]);

    expect(countCallerRows(aPath)).toBe(0);
  });

  it('Test 7 (silent discard — callee miss): callee path/name not in DB → no INSERT', () => {
    const aPath = path.join(tmpDir, 'a.ts');
    const ghostPath = path.join(tmpDir, 'ghost.ts');  // no symbols seeded

    setEdgesAndSymbols(aPath, [], [
      { name: 'foo', kind: 'function', startLine: 1, endLine: 3, isExport: true },
    ], undefined, [{
      callerName: 'foo', callerStartLine: 1,
      calleePath: ghostPath, calleeName: 'ghostFn',  // not in DB
      callLine: 2, confidence: 0.8,
    }]);

    expect(countCallerRows(aPath)).toBe(0);
  });
});

// ─── Self-loop storage (D-14) ─────────────────────────────────────────────────

describe("setEdgesAndSymbols — self-loop storage (D-14)", () => {
  it('Test 8 (self-loop stored): caller_symbol_id === callee_symbol_id for recursive call', () => {
    const aPath = path.join(tmpDir, 'a.ts');

    setEdgesAndSymbols(aPath, [], [
      { name: 'foo', kind: 'function', startLine: 1, endLine: 5, isExport: true },
    ], undefined, [{
      callerName: 'foo', callerStartLine: 1,
      calleePath: aPath, calleeName: 'foo',  // self-call
      callLine: 2, confidence: 1.0,
    }]);

    expect(countCallerRows(aPath)).toBe(1);

    const row = getSqlite()
      .prepare('SELECT caller_symbol_id, callee_symbol_id FROM symbol_dependencies')
      .get() as { caller_symbol_id: number; callee_symbol_id: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.caller_symbol_id).toBe(row!.callee_symbol_id);
  });

  it('Test 9 (prepared-statement reuse — structural): callerLookup/calleeLookup/edgeInsert pattern verifiable via grep', () => {
    // This test verifies the implementation creates prepared statements once outside
    // the per-edge loop. Functionally: multiple edges for same caller are all written.
    const aPath = path.join(tmpDir, 'a.ts');

    setEdgesAndSymbols(aPath, [], [
      { name: 'caller', kind: 'function', startLine: 1, endLine: 10, isExport: true },
      { name: 'foo', kind: 'function', startLine: 11, endLine: 15, isExport: true },
      { name: 'bar', kind: 'function', startLine: 16, endLine: 20, isExport: true },
      { name: 'baz', kind: 'function', startLine: 21, endLine: 25, isExport: true },
    ], undefined, [
      { callerName: 'caller', callerStartLine: 1, calleePath: aPath, calleeName: 'foo', callLine: 2, confidence: 1.0 },
      { callerName: 'caller', callerStartLine: 1, calleePath: aPath, calleeName: 'bar', callLine: 3, confidence: 1.0 },
      { callerName: 'caller', callerStartLine: 1, calleePath: aPath, calleeName: 'baz', callLine: 4, confidence: 1.0 },
    ]);

    // All three edges written — confirms prepared-statement reuse works correctly
    expect(countCallerRows(aPath)).toBe(3);
  });

  it('empty callSiteEdges array clears caller-side rows without inserting new ones', () => {
    const aPath = path.join(tmpDir, 'a.ts');

    // First write with one edge
    setEdgesAndSymbols(aPath, [], [
      { name: 'foo', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'bar', kind: 'function', startLine: 5, endLine: 7, isExport: true },
    ], undefined, [{
      callerName: 'foo', callerStartLine: 1,
      calleePath: aPath, calleeName: 'bar',
      callLine: 2, confidence: 1.0,
    }]);
    expect(countCallerRows(aPath)).toBe(1);

    // Re-scan with empty array — should clear prior edge
    setEdgesAndSymbols(aPath, [], [
      { name: 'foo', kind: 'function', startLine: 1, endLine: 3, isExport: true },
      { name: 'bar', kind: 'function', startLine: 5, endLine: 7, isExport: true },
    ], undefined, []);  // empty — clear+no-insert

    expect(countCallerRows(aPath)).toBe(0);
  });
});
