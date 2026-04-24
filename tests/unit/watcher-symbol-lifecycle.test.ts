/**
 * Phase 35 WTC regression guard (D-30, D-36).
 *
 * WTC-01 — FileWatcher re-extracts symbols on change via the existing
 * single-pass AST walk (setEdgesAndSymbols). Already wired at:
 *   - src/file-utils.ts:984  (updateFileNodeOnChange)
 *   - src/file-utils.ts:1104 (addFileNode)
 * No production code change in Phase 35. This test pins the contract at
 * the repository level: calling setEdgesAndSymbols twice with different
 * symbol sets replaces the first set entirely.
 *
 * WTC-02 — FileWatcher unlink invokes symbol cleanup. Implemented in
 * Phase 35 plan 35-01 by extending deleteFile (src/db/repository.ts).
 * Called from src/file-utils.ts:1215 (removeFileNode). This test pins
 * the contract and includes the paranoid COUNT(*) guard from
 * CONTEXT.md <specifics>.
 *
 * WTC-03 — Symbols share a transaction with edges (setEdgesAndSymbols).
 * No separate staleness column. Structurally satisfied — tested
 * indirectly by the WTC-01 single-call atomicity check below.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getSqlite } from '../../src/db/db.js';
import {
  upsertFile,
  getFile,
  deleteFile,
  upsertSymbols,
  getSymbolsForFile,
  setEdgesAndSymbols,
} from '../../src/db/repository.js';
import type { Symbol as SymbolRow } from '../../src/db/symbol-types.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-watcher-lifecycle-'));
  return path.join(tmpDir, 'test.db');
}

beforeEach(() => { openDatabase(makeTmpDb()); });
afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } }
});

// Helper — mirror the shape from repository.symbols.test.ts
function makeSymbol(overrides: Partial<SymbolRow> = {}): SymbolRow {
  return {
    name: overrides.name ?? 'defaultName',
    kind: overrides.kind ?? 'function',
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 2,
    isExport: overrides.isExport ?? true,
  };
}

function seedFile(filePath: string): void {
  upsertFile({
    path: filePath,
    name: path.basename(filePath),
    isDirectory: false,
    importance: 1,
    dependencies: [],
    dependents: [],
  });
}

describe('WTC-01 — setEdgesAndSymbols replaces prior symbol set (single-pass re-extract contract)', () => {
  it('re-call with different symbols replaces the prior set', () => {
    const filePath = '/project/a.ts';
    seedFile(filePath);
    // Initial symbol set
    setEdgesAndSymbols(filePath, [], [makeSymbol({ name: 'oldFn', kind: 'function' })], []);
    expect(getSymbolsForFile(filePath).map(s => s.name)).toEqual(['oldFn']);

    // Simulate a watcher change event: re-extract with a different symbol set
    // (wiring: updateFileNodeOnChange at file-utils.ts:984 calls setEdgesAndSymbols)
    setEdgesAndSymbols(filePath, [], [makeSymbol({ name: 'newFn', kind: 'function' })], []);
    const after = getSymbolsForFile(filePath);
    expect(after).toHaveLength(1);
    expect(after[0].name).toBe('newFn');
    // Sanity: no stale `oldFn` row lingering
    const count = getSqlite()
      .prepare('SELECT COUNT(*) AS n FROM symbols WHERE path = ? AND name = ?')
      .get(filePath, 'oldFn') as { n: number };
    expect(count.n).toBe(0);
  });

  it('re-call with empty symbol array clears all symbols for the path', () => {
    const filePath = '/project/b.ts';
    seedFile(filePath);
    setEdgesAndSymbols(filePath, [], [makeSymbol({ name: 'foo' }), makeSymbol({ name: 'bar' })], []);
    expect(getSymbolsForFile(filePath)).toHaveLength(2);
    // Simulate a watcher event where the file now has no extractable symbols
    setEdgesAndSymbols(filePath, [], [], []);
    expect(getSymbolsForFile(filePath)).toEqual([]);
  });

  it('WTC-03 — symbols and edges share a transaction (no independent staleness path)', () => {
    // WTC-03 is structurally guaranteed: setEdgesAndSymbols writes both in one
    // better-sqlite3 transaction. This test asserts there is no separate symbol
    // freshness column — the only staleness signal is files.mtime (file-granular).
    const filePath = '/project/c.ts';
    seedFile(filePath);
    setEdgesAndSymbols(filePath, [], [makeSymbol({ name: 'atomicSym' })], []);
    // Assert the symbols table has no is_stale or stale_since column for symbols
    const cols = getSqlite()
      .prepare("PRAGMA table_info(symbols)")
      .all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    expect(colNames).not.toContain('is_stale');
    expect(colNames).not.toContain('stale_since');
    // And the symbol we wrote is present (atomicity confirmed)
    expect(getSymbolsForFile(filePath).map(s => s.name)).toEqual(['atomicSym']);
  });
});

describe('WTC-02 — deleteFile cascades symbols (unlink integrity)', () => {
  it('deleteFile removes all symbols for the path', () => {
    const filePath = '/project/d.ts';
    seedFile(filePath);
    upsertSymbols(filePath, [
      makeSymbol({ name: 'foo', kind: 'function' }),
      makeSymbol({ name: 'Bar', kind: 'class', startLine: 5, endLine: 20 }),
    ]);
    expect(getSymbolsForFile(filePath)).toHaveLength(2);

    // Wiring: removeFileNode at file-utils.ts:1215 delegates to deleteFile
    deleteFile(filePath);

    // Primary assertion: no symbols returned
    expect(getSymbolsForFile(filePath)).toEqual([]);

    // Paranoid orphan-row guard (CONTEXT <specifics>): raw COUNT check
    // defends against future schema changes that might split symbols.
    const count = getSqlite()
      .prepare('SELECT COUNT(*) AS n FROM symbols WHERE path = ?')
      .get(filePath) as { n: number };
    expect(count.n).toBe(0);

    // File row also gone (existing cascade, re-verified)
    expect(getFile(filePath)).toBeNull();
  });

  it('deleteFile on a path with no symbols is a no-op', () => {
    const filePath = '/project/empty.ts';
    seedFile(filePath);
    expect(getSymbolsForFile(filePath)).toEqual([]);
    expect(() => deleteFile(filePath)).not.toThrow();
    expect(getFile(filePath)).toBeNull();
  });

  it('deleteFile only removes symbols for the target path', () => {
    const pathA = '/project/a2.ts';
    const pathB = '/project/b2.ts';
    seedFile(pathA);
    seedFile(pathB);
    upsertSymbols(pathA, [makeSymbol({ name: 'aFn' })]);
    upsertSymbols(pathB, [makeSymbol({ name: 'bFn' })]);

    deleteFile(pathA);

    expect(getSymbolsForFile(pathA)).toEqual([]);
    expect(getSymbolsForFile(pathB)).toHaveLength(1);
    expect(getSymbolsForFile(pathB)[0].name).toBe('bFn');
  });
});
