// src/migrate/bulk-symbol-extract.test.ts
// Phase 33 SYM-05 integration test — one-shot bulk extraction at first boot.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { openDatabase, closeDatabase, getSqlite } from '../db/db.js';
import {
  upsertFile,
  setEdges,
  getKvState,
  getSymbolsForFile,
} from '../db/repository.js';
import type { FileNode } from '../types.js';
import type { EdgeResult } from '../language-config.js';
import { runSymbolsBulkExtractionIfNeeded } from './bulk-symbol-extract.js';

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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-bulk-'));
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

describe('runSymbolsBulkExtractionIfNeeded — first boot', () => {
  it('populates symbols table for every tracked TS/JS file', async () => {
    const aPath = path.join(projectRoot, 'a.ts');
    const bPath = path.join(projectRoot, 'b.ts');

    await writeFile(aPath, `export function foo() {}\nexport class Bar {}`);
    await writeFile(bPath, `import { foo } from './a.js';\nexport const X = 1;`);

    const now = Date.now();
    upsertFile(makeFile(aPath, now));
    upsertFile(makeFile(bPath, now));

    await runSymbolsBulkExtractionIfNeeded(projectRoot);

    expect(getSymbolsForFile(aPath).map(s => s.name).sort()).toEqual(['Bar', 'foo']);
    expect(getSymbolsForFile(bPath).map(s => s.name).sort()).toEqual(['X']);
  });

  it('populates imported_names + import_line on existing file_dependencies rows (OQ-4)', async () => {
    const aPath = path.join(projectRoot, 'a.ts');
    const bPath = path.join(projectRoot, 'b.ts');

    await writeFile(aPath, `export function foo() {}`);
    await writeFile(bPath, `import { foo } from './a.js';`);

    const now = Date.now();
    upsertFile(makeFile(aPath, now));
    upsertFile(makeFile(bPath, now));

    // Seed a pre-v1.6-style edge row (no imported_names / import_line).
    const preExistingEdge: EdgeResult = {
      target: aPath,
      edgeType: 'imports',
      confidence: 1.0,
      confidenceSource: 'extracted',
      weight: 1,
      isPackage: false,
    };
    setEdges(bPath, [preExistingEdge]);

    // Confirm pre-condition: imported_names IS NULL before bulk run.
    const before = getSqlite()
      .prepare('SELECT imported_names, import_line FROM file_dependencies WHERE source_path = ?')
      .get(bPath) as { imported_names: string | null; import_line: number | null };
    expect(before.imported_names).toBeNull();
    expect(before.import_line).toBeNull();

    await runSymbolsBulkExtractionIfNeeded(projectRoot);

    const after = getSqlite()
      .prepare('SELECT imported_names, import_line FROM file_dependencies WHERE source_path = ?')
      .get(bPath) as { imported_names: string | null; import_line: number | null };
    expect(after.imported_names).toBe('["foo"]');
    expect(after.import_line).toBe(1);
  });

  it('sets symbols_bulk_extracted kv_state flag to an ISO timestamp', async () => {
    await writeFile(path.join(projectRoot, 'a.ts'), `export function foo() {}`);
    upsertFile(makeFile(path.join(projectRoot, 'a.ts'), Date.now()));

    await runSymbolsBulkExtractionIfNeeded(projectRoot);

    const ts = getKvState('symbols_bulk_extracted');
    expect(ts).not.toBeNull();
    expect(() => new Date(ts!).toISOString()).not.toThrow();
  });

  it('skips non-TS/JS files', async () => {
    const goPath = path.join(projectRoot, 'main.go');
    await writeFile(goPath, `package main\nfunc Foo() {}`);
    upsertFile(makeFile(goPath, Date.now()));

    await runSymbolsBulkExtractionIfNeeded(projectRoot);

    expect(getSymbolsForFile(goPath)).toEqual([]);
  });

  it('per-file failure does not abort the pass (D-12 log + continue)', async () => {
    const goodPath = path.join(projectRoot, 'good.ts');
    const missingPath = path.join(projectRoot, 'missing.ts');  // upserted but not written to disk

    await writeFile(goodPath, `export function good() {}`);
    const now = Date.now();
    upsertFile(makeFile(goodPath, now));
    upsertFile(makeFile(missingPath, now));   // readFile on this will throw ENOENT

    await expect(runSymbolsBulkExtractionIfNeeded(projectRoot)).resolves.not.toThrow();

    expect(getSymbolsForFile(goodPath).map(s => s.name)).toEqual(['good']);
    expect(getSymbolsForFile(missingPath)).toEqual([]);
  });
});

describe('runSymbolsBulkExtractionIfNeeded — second boot (idempotent)', () => {
  it('becomes a no-op after first successful run', async () => {
    const aPath = path.join(projectRoot, 'a.ts');
    await writeFile(aPath, `export function foo() {}`);
    upsertFile(makeFile(aPath, Date.now()));

    await runSymbolsBulkExtractionIfNeeded(projectRoot);
    const firstCount = getSqlite()
      .prepare('SELECT COUNT(*) as n FROM symbols').get() as { n: number };
    expect(firstCount.n).toBeGreaterThan(0);

    // Append a second declaration on disk — the bulk pass should NOT re-run.
    await writeFile(aPath, `export function foo() {}\nexport function bar() {}`);

    await runSymbolsBulkExtractionIfNeeded(projectRoot);

    // symbols table should match the first-run snapshot (bar NOT added, since bulk was skipped).
    const symsAfter = getSymbolsForFile(aPath).map(s => s.name).sort();
    expect(symsAfter).toEqual(['foo']);   // NOT ['bar', 'foo']
  });
});
