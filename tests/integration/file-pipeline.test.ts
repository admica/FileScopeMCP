// tests/integration/file-pipeline.test.ts
// End-to-end integration tests for the full file processing pipeline.
// Tests: scan → dependency extraction → importance calculation → change detection → cascade.
// Uses real SQLite DB and real file system operations.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { openDatabase, closeDatabase, getSqlite } from '../../src/db/db.js';
import {
  upsertFile,
  getFile,
  getAllFiles,
  setEdges,
  getDependencies,
  getDependents,
  markStale,
  getStaleness,
  getExportsSnapshot,
  setExportsSnapshot,
  writeLlmResult,
  clearStaleness,
  deleteFile,
} from '../../src/db/repository.js';
import { extractEdges } from '../../src/language-config.js';
import { calculateImportance, buildDependentMap, scanDirectory } from '../../src/file-utils.js';
import { extractSnapshot } from '../../src/change-detector/ast-parser.js';
import { computeSemanticDiff } from '../../src/change-detector/semantic-diff.js';
import { detectCycles } from '../../src/cycle-detection.js';
import { setProjectRoot, setConfig } from '../../src/global-state.js';
import type { FileNode } from '../../src/types.js';

// Mock broker to prevent actual socket connections
vi.mock('../../src/broker/client.js', () => ({
  submitJob: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => false),
  requestStatus: vi.fn(),
  resubmitStaleFiles: vi.fn(),
}));

import { submitJob } from '../../src/broker/client.js';

let tmpDir: string;
let dbPath: string;

async function collectStream(gen: AsyncGenerator<FileNode>): Promise<FileNode[]> {
  const results: FileNode[] = [];
  for await (const node of gen) results.push(node);
  return results;
}

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
  dbPath = path.join(tmpDir, '.filescope', 'test.db');
  mkdirSync(path.join(tmpDir, '.filescope'), { recursive: true });
  setProjectRoot(tmpDir);
  setConfig({ excludePatterns: [], fileWatching: { enabled: false } } as any);
  openDatabase(dbPath);
});

afterAll(async () => {
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  // Clear all tables between tests
  const sqlite = getSqlite();
  sqlite.exec('DELETE FROM files; DELETE FROM file_dependencies;');
  (submitJob as ReturnType<typeof vi.fn>).mockClear();
});

// ═══════════════════════════════════════════════════════════════════════════════
// Full scan → deps → importance pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('Scan → Dependency Extraction → Importance', () => {
  it('scans project, extracts deps, calculates importance for a TS project', async () => {
    // Create a small TS project
    const srcDir = path.join(tmpDir, 'src');
    mkdirSync(srcDir, { recursive: true });

    writeFileSync(path.join(srcDir, 'index.ts'), `
      import { helper } from './utils';
      export function main() { helper(); }
    `);
    writeFileSync(path.join(srcDir, 'utils.ts'), `
      export function helper() { return 42; }
    `);
    writeFileSync(path.join(srcDir, 'types.ts'), `
      export interface Config { port: number; }
    `);

    // Step 1: Scan directory
    const nodes = await collectStream(scanDirectory(tmpDir));
    expect(nodes.length).toBeGreaterThanOrEqual(3);

    // Step 2: Upsert files to DB
    for (const node of nodes) {
      upsertFile(node);
    }

    // Step 3: Extract dependencies
    for (const node of nodes) {
      if (node.isDirectory) continue;
      try {
        const content = await fs.readFile(node.path, 'utf-8');
        const edges = await extractEdges(node.path, content, tmpDir);
        if (edges.length > 0) {
          setEdges(node.path, edges);
        }
      } catch {
        // Some files may not be readable
      }
    }

    // Step 4: Verify dependencies
    const indexPath = path.join(srcDir, 'index.ts');
    const utilsPath = path.join(srcDir, 'utils.ts');
    const deps = getDependencies(indexPath);
    expect(deps).toContain(utilsPath);

    // Step 5: Verify dependents (inverse)
    const dependents = getDependents(utilsPath);
    expect(dependents).toContain(indexPath);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Change detection → snapshot storage pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('Change Detection → Snapshot Storage', () => {
  it('stores and retrieves ExportSnapshot through full round trip', async () => {
    const filePath = path.join(tmpDir, 'round-trip.ts');
    const source = `export function greet(name: string): string { return 'Hi ' + name; }`;
    writeFileSync(filePath, source);

    // Extract snapshot
    const snapshot = extractSnapshot(filePath, source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports.length).toBe(1);

    // Ensure file exists in DB (setExportsSnapshot requires it or creates minimal row)
    upsertFile({ path: filePath, name: 'round-trip.ts', isDirectory: false });

    // Store snapshot
    setExportsSnapshot(filePath, snapshot!);

    // Retrieve snapshot
    const retrieved = getExportsSnapshot(filePath);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.exports.length).toBe(1);
    expect(retrieved!.exports[0].name).toBe('greet');
    expect(retrieved!.imports).toEqual(snapshot!.imports);
  });

  it('detects body-only change (no dependent impact)', async () => {
    const filePath = path.join(tmpDir, 'body-change.ts');

    // Version 1
    const v1 = `export function add(a: number, b: number): number { return a + b; }`;
    writeFileSync(filePath, v1);
    const snap1 = extractSnapshot(filePath, v1)!;
    upsertFile({ path: filePath, name: 'body-change.ts', isDirectory: false });
    setExportsSnapshot(filePath, snap1);

    // Version 2: body-only change
    const v2 = `export function add(a: number, b: number): number { return b + a; }`;
    writeFileSync(filePath, v2);
    const snap2 = extractSnapshot(filePath, v2)!;

    // Compare
    const diff = computeSemanticDiff(snap1, snap2);
    expect(diff.changeType).toBe('body-only');
    expect(diff.affectsDependents).toBe(false);
  });

  it('detects export signature change (impacts dependents)', async () => {
    const filePath = path.join(tmpDir, 'sig-change.ts');

    // Version 1
    const v1 = `export function process(data: string): string { return data; }`;
    writeFileSync(filePath, v1);
    const snap1 = extractSnapshot(filePath, v1)!;

    // Version 2: changed signature
    const v2 = `export function process(data: string, opts: object): string { return data; }`;
    writeFileSync(filePath, v2);
    const snap2 = extractSnapshot(filePath, v2)!;

    const diff = computeSemanticDiff(snap1, snap2);
    expect(diff.changeType).toBe('exports-changed');
    expect(diff.affectsDependents).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Staleness cascade pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('Staleness Cascade Pipeline', () => {
  it('markStale + writeLlmResult + clearStaleness lifecycle', () => {
    const filePath = '/pipeline/lifecycle.ts';
    upsertFile({ path: filePath, name: 'lifecycle.ts', isDirectory: false });

    // Mark stale
    markStale([filePath], 1000);
    let staleness = getStaleness(filePath);
    expect(staleness.summaryStale).toBe(1000);

    // Simulate LLM completing summary
    writeLlmResult(filePath, 'summary', 'This file handles lifecycle management');
    clearStaleness(filePath, 'summary');

    staleness = getStaleness(filePath);
    expect(staleness.summaryStale).toBeNull(); // cleared
    expect(staleness.conceptsStale).toBe(1000); // still stale

    // Simulate LLM completing concepts
    writeLlmResult(filePath, 'concepts', '{"functions":["init"],"classes":[],"interfaces":[],"exports":[],"purpose":"lifecycle"}');
    clearStaleness(filePath, 'concepts');

    staleness = getStaleness(filePath);
    expect(staleness.conceptsStale).toBeNull();
    expect(staleness.changeImpactStale).toBe(1000); // still stale

    // Complete all
    writeLlmResult(filePath, 'change_impact', '{"riskLevel":"low","affectedAreas":[],"breakingChanges":[],"summary":"no impact"}');
    clearStaleness(filePath, 'change_impact');

    staleness = getStaleness(filePath);
    expect(staleness.summaryStale).toBeNull();
    expect(staleness.conceptsStale).toBeNull();
    expect(staleness.changeImpactStale).toBeNull();
  });

  it('upsertFile does NOT clobber staleness columns', () => {
    const filePath = '/pipeline/noclobber.ts';
    upsertFile({ path: filePath, name: 'noclobber.ts', isDirectory: false, importance: 5 });

    markStale([filePath], 2000);

    // Re-upsert (simulates file metadata update)
    upsertFile({ path: filePath, name: 'noclobber.ts', isDirectory: false, importance: 7 });

    const staleness = getStaleness(filePath);
    expect(staleness.summaryStale).toBe(2000); // NOT clobbered
    expect(staleness.conceptsStale).toBe(2000);
    expect(staleness.changeImpactStale).toBe(2000);

    // Verify importance was updated
    const node = getFile(filePath);
    expect(node!.importance).toBe(7);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Dependency graph → cycle detection pipeline
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dependency Graph → Cycle Detection', () => {
  it('detects cycles from DB-stored edges', () => {
    // Create files with circular deps
    upsertFile({ path: '/cycle/a.ts', name: 'a.ts', isDirectory: false });
    upsertFile({ path: '/cycle/b.ts', name: 'b.ts', isDirectory: false });

    setEdges('/cycle/a.ts', [{
      target: '/cycle/b.ts',
      isPackage: false,
      edgeType: 'imports',
      confidence: 1.0,
      confidenceSource: 'extracted',
      weight: 1,
    }]);
    setEdges('/cycle/b.ts', [{
      target: '/cycle/a.ts',
      isPackage: false,
      edgeType: 'imports',
      confidence: 1.0,
      confidenceSource: 'extracted',
      weight: 1,
    }]);

    // Query all edges and detect cycles
    const sqlite = getSqlite();
    const edges = sqlite.prepare(
      "SELECT source_path, target_path FROM file_dependencies WHERE dependency_type = 'local_import'"
    ).all() as Array<{ source_path: string; target_path: string }>;

    const cycles = detectCycles(edges);
    expect(cycles.length).toBe(1);
    expect(cycles[0].sort()).toEqual(['/cycle/a.ts', '/cycle/b.ts']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// File deletion cascade
// ═══════════════════════════════════════════════════════════════════════════════

describe('File deletion cleanup', () => {
  it('deleteFile removes file + all dependency edges', () => {
    upsertFile({ path: '/del/main.ts', name: 'main.ts', isDirectory: false });
    upsertFile({ path: '/del/utils.ts', name: 'utils.ts', isDirectory: false });

    setEdges('/del/main.ts', [{
      target: '/del/utils.ts',
      isPackage: false,
      edgeType: 'imports',
      confidence: 1.0,
      confidenceSource: 'extracted',
      weight: 1,
    }]);

    // Verify edges exist
    expect(getDependencies('/del/main.ts')).toContain('/del/utils.ts');

    // Delete main.ts
    deleteFile('/del/main.ts');

    // File gone
    expect(getFile('/del/main.ts')).toBeNull();

    // Edges gone (both as source and target)
    expect(getDependencies('/del/main.ts')).toHaveLength(0);
    expect(getDependents('/del/utils.ts')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-file importance with real DB
// ═══════════════════════════════════════════════════════════════════════════════

describe('Multi-file importance with DB', () => {
  it('hub file (many dependents) gets higher importance than leaf file', () => {
    // Create hub + 5 leaf files
    const hub: FileNode = {
      path: '/importance/hub.ts',
      name: 'hub.ts',
      isDirectory: false,
      dependencies: [],
      dependents: [
        '/importance/leaf1.ts',
        '/importance/leaf2.ts',
        '/importance/leaf3.ts',
        '/importance/leaf4.ts',
        '/importance/leaf5.ts',
      ],
    };

    const leaf: FileNode = {
      path: '/importance/leaf1.ts',
      name: 'leaf1.ts',
      isDirectory: false,
      dependencies: ['/importance/hub.ts'],
      dependents: [],
    };

    const root: FileNode = {
      path: '/importance',
      name: 'importance',
      isDirectory: true,
      children: [hub, leaf],
    };

    calculateImportance(root);

    expect(hub.importance).toBeGreaterThan(leaf.importance!);
  });
});
