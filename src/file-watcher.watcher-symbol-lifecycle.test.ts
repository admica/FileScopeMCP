// src/file-watcher.watcher-symbol-lifecycle.test.ts
// Phase 37 CSE-05 — Regression tests for the five-step deleteFile cascade and
// the caller-side-clear change scenario.
// Uses direct repository calls (no chokidar watcher) so the tests are unit-level
// and deterministic (37-RESEARCH §Item 9 "test harness approach").

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { openDatabase, closeDatabase, getSqlite } from './db/db.js';
import { upsertFile, setEdgesAndSymbols, deleteFile, setRepoProjectRoot, clearRepoProjectRoot } from './db/repository.js';
import { extractTsJsFileParse } from './language-config.js';
import type { FileNode } from './types.js';

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-watcher-lifecycle-'));
  projectRoot = path.join(tmpDir, 'project');
  await fsp.mkdir(projectRoot, { recursive: true });
  openDatabase(path.join(tmpDir, 'test.db'));
  // extractTsJsFileParse and the repo's relative-paths layout must agree on
  // projectRoot for cross-file symbol resolution to find rows.
  setRepoProjectRoot(projectRoot);
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  clearRepoProjectRoot();
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ } }
});

describe('watcher-symbol-lifecycle — unlink cascade (CSE-05)', () => {
  it('symbol_dependencies, symbols, and files all empty after deleteFile', async () => {
    const fx = path.join(projectRoot, 'x.ts');
    await fsp.writeFile(fx, `function a() { b(); }\nfunction b() {}\n`, 'utf-8');
    upsertFile(makeFileNode(fx));
    const parsed = (await extractTsJsFileParse(fx, await fsp.readFile(fx, 'utf-8'), projectRoot))!;
    setEdgesAndSymbols(fx, parsed.edges, parsed.symbols, parsed.importMeta, parsed.callSiteEdges);

    // pre-assertion: at least one symbol_dependencies row exists
    const pre = getSqlite().prepare('SELECT COUNT(*) AS n FROM symbol_dependencies').get() as { n: number };
    expect(pre.n).toBeGreaterThan(0);

    deleteFile(fx);

    // post-assertion: ALL symbol_dependencies rows are gone (no orphaned rows remain)
    const depsTotal = getSqlite()
      .prepare('SELECT COUNT(*) AS n FROM symbol_dependencies')
      .get() as { n: number };
    expect(depsTotal.n).toBe(0);

    const syms = getSqlite().prepare('SELECT COUNT(*) AS n FROM symbols WHERE path = ?').get(fx) as { n: number };
    expect(syms.n).toBe(0);

    const fileRow = getSqlite().prepare('SELECT COUNT(*) AS n FROM files WHERE path = ?').get(fx) as { n: number };
    expect(fileRow.n).toBe(0);
  });

  it('deleteFile removes callee-side rows pointing to the deleted file from OTHER files', async () => {
    // File B defines b(); File A calls B.b(). Delete B → A→B row is gone.
    const fb = path.join(projectRoot, 'b.ts');
    await fsp.writeFile(fb, `export function b() {}\n`, 'utf-8');
    upsertFile(makeFileNode(fb));
    const pb = (await extractTsJsFileParse(fb, await fsp.readFile(fb, 'utf-8'), projectRoot))!;
    setEdgesAndSymbols(fb, pb.edges, pb.symbols, pb.importMeta, pb.callSiteEdges);

    const fa = path.join(projectRoot, 'a.ts');
    await fsp.writeFile(fa, `import { b } from './b.js';\nexport function a() { b(); }\n`, 'utf-8');
    upsertFile(makeFileNode(fa));
    const pa = (await extractTsJsFileParse(fa, await fsp.readFile(fa, 'utf-8'), projectRoot))!;
    setEdgesAndSymbols(fa, pa.edges, pa.symbols, pa.importMeta, pa.callSiteEdges);

    const pre = getSqlite().prepare('SELECT COUNT(*) AS n FROM symbol_dependencies').get() as { n: number };
    expect(pre.n).toBeGreaterThan(0);  // at least one A→B edge

    deleteFile(fb);

    // Both-sides cascade: A→B row is gone because B's symbol id is in callee_symbol_id IN (...)
    const post = getSqlite().prepare('SELECT COUNT(*) AS n FROM symbol_dependencies WHERE callee_symbol_id IN (SELECT id FROM symbols WHERE path = ?)').get(fb) as { n: number };
    expect(post.n).toBe(0);
  });

  it('deleteFile on a file with zero symbols does not throw (empty symbolIds guard)', async () => {
    const fe = path.join(projectRoot, 'empty.ts');
    await fsp.writeFile(fe, `// empty file\n`, 'utf-8');
    upsertFile(makeFileNode(fe));
    expect(() => deleteFile(fe)).not.toThrow();
  });
});

describe('watcher-symbol-lifecycle — change (caller-side clear) (D-24)', () => {
  it('rewriting file clears old caller-side rows and writes new ones', async () => {
    const fx = path.join(projectRoot, 'x.ts');
    await fsp.writeFile(fx, `function a() { y(); }\nfunction y() {}\nfunction z() {}\n`, 'utf-8');
    upsertFile(makeFileNode(fx));
    let parsed = (await extractTsJsFileParse(fx, await fsp.readFile(fx, 'utf-8'), projectRoot))!;
    setEdgesAndSymbols(fx, parsed.edges, parsed.symbols, parsed.importMeta, parsed.callSiteEdges);

    // Rewrite: a() now calls z() instead of y()
    await fsp.writeFile(fx, `function a() { z(); }\nfunction y() {}\nfunction z() {}\n`, 'utf-8');
    parsed = (await extractTsJsFileParse(fx, await fsp.readFile(fx, 'utf-8'), projectRoot))!;
    setEdgesAndSymbols(fx, parsed.edges, parsed.symbols, parsed.importMeta, parsed.callSiteEdges);

    // Only the new edge should remain. Repo stores paths relative to
    // projectRoot; the raw query bypasses translation so the WHERE clause
    // must match the stored relative form.
    const rows = getSqlite()
      .prepare(`SELECT s1.name AS caller, s2.name AS callee
                FROM symbol_dependencies sd
                JOIN symbols s1 ON s1.id = sd.caller_symbol_id
                JOIN symbols s2 ON s2.id = sd.callee_symbol_id
                WHERE s1.path = ?`)
      .all(path.relative(projectRoot, fx)) as Array<{ caller: string; callee: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ caller: 'a', callee: 'z' });
  });
});
