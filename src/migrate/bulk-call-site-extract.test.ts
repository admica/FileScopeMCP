// src/migrate/bulk-call-site-extract.test.ts
// Phase 37 CSE-06 — integration tests for runCallSiteEdgesBulkExtractionIfNeeded.
// Covers: gate-set no-op, three precondition-unset abort scenarios, first-boot
// populate + subsequent no-op, per-file failure continue.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { openDatabase, closeDatabase, getSqlite } from '../db/db.js';
import { upsertFile, getKvState, setKvState } from '../db/repository.js';
import { runCallSiteEdgesBulkExtractionIfNeeded } from './bulk-call-site-extract.js';
import type { FileNode } from '../types.js';

let tmpDir: string;
let projectRoot: string;

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

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-bulk-cse-'));
  projectRoot = path.join(tmpDir, 'project');
  await fsp.mkdir(projectRoot, { recursive: true });
  openDatabase(path.join(tmpDir, 'test.db'));
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ } }
});

function setAllPhase36Gates(): void {
  setKvState('symbols_py_bulk_extracted', new Date().toISOString());
  setKvState('symbols_go_bulk_extracted', new Date().toISOString());
  setKvState('symbols_rb_bulk_extracted', new Date().toISOString());
}

describe('runCallSiteEdgesBulkExtractionIfNeeded — gate already set (no-op)', () => {
  it('is a no-op when call_site_edges_bulk_extracted gate is already set', async () => {
    setKvState('call_site_edges_bulk_extracted', new Date().toISOString());
    setAllPhase36Gates();
    // Write a file that would produce edges if the function ran
    const fx = path.join(projectRoot, 'x.ts');
    await fsp.writeFile(fx, `function a() { b(); } function b() {}`, 'utf-8');
    upsertFile(makeFileNode(fx));
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    const deps = getSqlite().prepare('SELECT COUNT(*) AS n FROM symbol_dependencies').get() as { n: number };
    expect(deps.n).toBe(0);
  });
});

describe('runCallSiteEdgesBulkExtractionIfNeeded — precondition gates unset (abort without gate-write)', () => {
  it('aborts without setting gate when symbols_py_bulk_extracted is not set', async () => {
    setKvState('symbols_go_bulk_extracted', 't');
    setKvState('symbols_rb_bulk_extracted', 't');
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    expect(getKvState('call_site_edges_bulk_extracted')).toBeNull();
  });
  it('aborts without setting gate when symbols_go_bulk_extracted is not set', async () => {
    setKvState('symbols_py_bulk_extracted', 't');
    setKvState('symbols_rb_bulk_extracted', 't');
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    expect(getKvState('call_site_edges_bulk_extracted')).toBeNull();
  });
  it('aborts without setting gate when symbols_rb_bulk_extracted is not set', async () => {
    setKvState('symbols_py_bulk_extracted', 't');
    setKvState('symbols_go_bulk_extracted', 't');
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    expect(getKvState('call_site_edges_bulk_extracted')).toBeNull();
  });
  it('aborts when all three preconditions are unset', async () => {
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    expect(getKvState('call_site_edges_bulk_extracted')).toBeNull();
  });
});

describe('runCallSiteEdgesBulkExtractionIfNeeded — first boot (preconditions set)', () => {
  it('runs, populates symbol_dependencies, and writes the gate', async () => {
    setAllPhase36Gates();
    const fx = path.join(projectRoot, 'x.ts');
    await fsp.writeFile(fx, `function a() { b(); }\nfunction b() {}\n`, 'utf-8');
    upsertFile(makeFileNode(fx));
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    const deps = getSqlite().prepare('SELECT COUNT(*) AS n FROM symbol_dependencies').get() as { n: number };
    expect(deps.n).toBeGreaterThan(0);
    expect(getKvState('call_site_edges_bulk_extracted')).not.toBeNull();
  });
  it('subsequent call is a no-op (idempotent)', async () => {
    setAllPhase36Gates();
    const fx = path.join(projectRoot, 'y.ts');
    await fsp.writeFile(fx, `function a() { b(); }\nfunction b() {}\n`, 'utf-8');
    upsertFile(makeFileNode(fx));
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    const firstGate = getKvState('call_site_edges_bulk_extracted');
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    // Gate value unchanged (proves second call returned at the first gate-check)
    expect(getKvState('call_site_edges_bulk_extracted')).toBe(firstGate);
  });
});

describe('runCallSiteEdgesBulkExtractionIfNeeded — per-file failure does not abort pass', () => {
  it('continues past a missing file (ENOENT during fs.readFile), writes gate', async () => {
    setAllPhase36Gates();
    // Upsert a file path that does NOT exist on disk — read will ENOENT
    const fghost = path.join(projectRoot, 'does-not-exist.ts');
    upsertFile(makeFileNode(fghost));
    // Also upsert a real file so there's at least one success
    const fok = path.join(projectRoot, 'ok.ts');
    await fsp.writeFile(fok, `function a() {}\n`, 'utf-8');
    upsertFile(makeFileNode(fok));
    await runCallSiteEdgesBulkExtractionIfNeeded(projectRoot);
    expect(getKvState('call_site_edges_bulk_extracted')).not.toBeNull();
  });
});
