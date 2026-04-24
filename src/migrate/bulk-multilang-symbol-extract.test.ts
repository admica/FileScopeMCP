// src/migrate/bulk-multilang-symbol-extract.test.ts
// Phase 36 MLS-05 integration test — three-sub-pass bulk extraction at first boot
// for Python / Go / Ruby. Mirrors bulk-symbol-extract.test.ts shape.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { openDatabase, closeDatabase } from '../db/db.js';
import {
  upsertFile,
  getKvState,
  getSymbolsForFile,
} from '../db/repository.js';
import type { FileNode } from '../types.js';
import { runMultilangSymbolsBulkExtractionIfNeeded } from './bulk-multilang-symbol-extract.js';

let tmpDir: string;
let projectRoot: string;

function makeFile(p: string, mtime: number): FileNode {
  return {
    path: p, name: path.basename(p), isDirectory: false,
    importance: 1, summary: null, mtime,
    dependencies: [], dependents: [], packageDependencies: [],
  } as unknown as FileNode;
}

async function writeFile(p: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content, 'utf-8');
}

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-bulk-ml-'));
  projectRoot = path.join(tmpDir, 'project');
  await fsp.mkdir(projectRoot, { recursive: true });
  openDatabase(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
});

describe('runMultilangSymbolsBulkExtractionIfNeeded — first boot', () => {
  it('populates symbols for every tracked Python file', async () => {
    const aPath = path.join(projectRoot, 'a.py');
    await writeFile(aPath, `def foo(): pass\nclass Bar: pass`);
    upsertFile(makeFile(aPath, Date.now()));

    await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);

    expect(getSymbolsForFile(aPath).map(s => s.name).sort()).toEqual(['Bar', 'foo']);
  });

  it('populates symbols for every tracked Go file', async () => {
    const aPath = path.join(projectRoot, 'a.go');
    await writeFile(aPath, `package main\n\nfunc Hello() {}\n`);
    upsertFile(makeFile(aPath, Date.now()));

    await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);

    const syms = getSymbolsForFile(aPath);
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('Hello');
    expect(syms[0].kind).toBe('function');
  });

  it('populates symbols for every tracked Ruby file', async () => {
    const aPath = path.join(projectRoot, 'a.rb');
    await writeFile(aPath, `class Foo\nend\n`);
    upsertFile(makeFile(aPath, Date.now()));

    await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);

    const syms = getSymbolsForFile(aPath);
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('Foo');
    expect(syms[0].kind).toBe('class');
  });

  it('sets all three language gates after running', async () => {
    // No files to process — pass still completes and writes all three gates (D-28).
    await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);

    expect(getKvState('symbols_py_bulk_extracted')).not.toBeNull();
    expect(getKvState('symbols_go_bulk_extracted')).not.toBeNull();
    expect(getKvState('symbols_rb_bulk_extracted')).not.toBeNull();
  });

  it('per-file failure does not abort the Python sub-pass (D-27 log + continue)', async () => {
    const goodPath = path.join(projectRoot, 'good.py');
    const missingPath = path.join(projectRoot, 'missing.py'); // upserted but not on disk

    await writeFile(goodPath, `def good(): pass`);
    upsertFile(makeFile(goodPath, Date.now()));
    upsertFile(makeFile(missingPath, Date.now())); // readFile throws ENOENT

    await expect(runMultilangSymbolsBulkExtractionIfNeeded(projectRoot)).resolves.not.toThrow();

    expect(getSymbolsForFile(goodPath).map(s => s.name)).toEqual(['good']);
    expect(getSymbolsForFile(missingPath)).toEqual([]);
    // Gate still written after loop since the pass didn't throw.
    expect(getKvState('symbols_py_bulk_extracted')).not.toBeNull();
  });
});

describe('runMultilangSymbolsBulkExtractionIfNeeded — kv_state key independence', () => {
  it('does NOT skip Python pass when v1.6 symbols_bulk_extracted flag is set', async () => {
    // Simulate an existing v1.6 repo upgrading to v1.7.
    const { setKvState } = await import('../db/repository.js');
    setKvState('symbols_bulk_extracted', new Date().toISOString());

    const aPath = path.join(projectRoot, 'a.py');
    await writeFile(aPath, `def foo(): pass`);
    upsertFile(makeFile(aPath, Date.now()));

    await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);

    // Pitfall-17 guard: Python pass MUST still run even though v1.6 gate is set.
    expect(getSymbolsForFile(aPath).map(s => s.name)).toEqual(['foo']);
    expect(getKvState('symbols_py_bulk_extracted')).not.toBeNull();
  });
});

describe('runMultilangSymbolsBulkExtractionIfNeeded — second boot (idempotent)', () => {
  it('becomes a no-op for all three languages after first run', async () => {
    const aPath = path.join(projectRoot, 'a.py');

    // First run — populate with one symbol.
    await writeFile(aPath, `def foo(): pass`);
    upsertFile(makeFile(aPath, Date.now()));
    await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);

    expect(getSymbolsForFile(aPath).map(s => s.name).sort()).toEqual(['foo']);

    // Modify the file on disk between runs — the bulk pass must NOT re-extract.
    await writeFile(aPath, `def foo(): pass\ndef bar(): pass`);
    await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);

    // Symbols reflect the FIRST run (gate prevented re-extraction).
    expect(getSymbolsForFile(aPath).map(s => s.name).sort()).toEqual(['foo']);
  });
});
