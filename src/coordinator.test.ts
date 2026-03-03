// src/coordinator.test.ts
// Tests for ServerCoordinator class — verifies it works without MCP transport (STOR-05)
// and without LLM configured (COMPAT-03).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ServerCoordinator } from './coordinator.js';
import { getAllFiles, getFile } from './db/repository.js';
import { closeDatabase } from './db/db.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-coordinator-test-'));
}

function makeTmpProject(): string {
  const dir = makeTmpDir();
  // Create a minimal project structure
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const hello = "world";\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'src', 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test Project\n', 'utf-8');
  return dir;
}

function removeTmpDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ServerCoordinator', () => {
  let coordinator: ServerCoordinator;
  let tmpDir: string;

  beforeEach(() => {
    coordinator = new ServerCoordinator();
  });

  afterEach(async () => {
    // Always shut down to clean up timers and DB connections
    if (coordinator.isInitialized()) {
      await coordinator.shutdown();
    } else {
      // If not initialized, still ensure DB is closed (may have been opened by init attempt)
      try { closeDatabase(); } catch { /* ignore */ }
    }
    if (tmpDir) {
      removeTmpDir(tmpDir);
    }
  });

  // ─── Test 1: init() opens DB and sets initialized ──────────────────────────

  it('init() opens DB and sets isInitialized() to true', async () => {
    tmpDir = makeTmpProject();

    expect(coordinator.isInitialized()).toBe(false);

    const result = await coordinator.init(tmpDir);

    expect(coordinator.isInitialized()).toBe(true);
    expect(result.isError).toBeFalsy();

    // Verify SQLite has the scanned files
    const dbFiles = getAllFiles();
    expect(dbFiles.length).toBeGreaterThan(0);

    // Verify the project root is set
    expect(coordinator.getProjectRoot()).toBe(tmpDir);
  });

  // ─── Test 2: init() runs migration for existing JSON tree ──────────────────

  it('init() runs migration for existing JSON tree', async () => {
    tmpDir = makeTmpProject();

    // Create a minimal JSON tree file that migration would pick up
    const treeFilename = `FileScopeMCP-tree-${path.basename(tmpDir)}.json`;
    const jsonTree = {
      fileTree: {
        path: tmpDir,
        name: path.basename(tmpDir),
        isDirectory: true,
        children: [
          {
            path: path.join(tmpDir, 'README.md'),
            name: 'README.md',
            isDirectory: false,
            importance: 5,
            summary: 'Migrated readme',
            mtime: Date.now()
          }
        ]
      },
      config: {
        filename: treeFilename,
        baseDirectory: tmpDir,
        projectRoot: tmpDir,
        lastUpdated: new Date().toISOString()
      }
    };
    fs.writeFileSync(path.join(tmpDir, treeFilename), JSON.stringify(jsonTree), 'utf-8');

    await coordinator.init(tmpDir);

    // The JSON file should be renamed to .bak after migration
    const bakPath = path.join(tmpDir, treeFilename + '.bak');
    expect(fs.existsSync(bakPath)).toBe(true);

    // The original JSON file should no longer exist
    const jsonPath = path.join(tmpDir, treeFilename);
    expect(fs.existsSync(jsonPath)).toBe(false);
  });

  // ─── Test 3: getFileTree() returns nested tree from DB ─────────────────────

  it('getFileTree() returns nested FileNode tree from DB', async () => {
    tmpDir = makeTmpProject();

    await coordinator.init(tmpDir);

    const tree = coordinator.getFileTree();

    // Root should be a directory
    expect(tree.isDirectory).toBe(true);
    expect(tree.path).toBeTruthy();

    // Tree should have children
    expect(tree.children).toBeDefined();
    expect(tree.children!.length).toBeGreaterThan(0);

    // At least one child should be the 'src' directory or a file
    const allPaths = getAllFiles().map(f => f.path);
    expect(allPaths.length).toBeGreaterThan(0);

    // Verify tree root path matches what we initialized with
    expect(tree.path).toContain(path.basename(tmpDir));
  });

  // ─── Test 4: shutdown() cleans up resources ────────────────────────────────

  it('shutdown() sets isInitialized() to false and closes database', async () => {
    tmpDir = makeTmpProject();

    await coordinator.init(tmpDir);
    expect(coordinator.isInitialized()).toBe(true);

    await coordinator.shutdown();

    expect(coordinator.isInitialized()).toBe(false);

    // After shutdown, calling getDb() should throw because the database is closed
    const { getDb } = await import('./db/db.js');
    expect(() => getDb()).toThrow();
  });

  // ─── Test 5: Works with no LLM configured (COMPAT-03) ─────────────────────

  it('works with no LLM configured (COMPAT-03): files have valid importance without LLM summaries', async () => {
    tmpDir = makeTmpProject();

    // No LLM is configured in test environment — this is the COMPAT-03 scenario
    await coordinator.init(tmpDir);

    expect(coordinator.isInitialized()).toBe(true);

    const dbFiles = getAllFiles();
    const fileNodes = dbFiles.filter(f => !f.isDirectory);

    // Should have actual file nodes
    expect(fileNodes.length).toBeGreaterThan(0);

    // No LLM-generated summaries — all summaries should be null/undefined
    for (const node of fileNodes) {
      expect(node.summary === null || node.summary === undefined).toBe(true);
    }

    // File tree should be queryable
    const tree = coordinator.getFileTree();
    expect(tree).toBeDefined();
    expect(tree.isDirectory).toBe(true);

    // Importance values should be numeric (0 or higher) — computed by static analysis
    for (const node of fileNodes) {
      const importance = node.importance ?? 0;
      expect(typeof importance).toBe('number');
      expect(importance).toBeGreaterThanOrEqual(0);
    }

    // Dependencies and dependents are arrays (may be empty for simple test project)
    for (const node of fileNodes) {
      expect(Array.isArray(node.dependencies ?? [])).toBe(true);
      expect(Array.isArray(node.dependents ?? [])).toBe(true);
    }
  });
});
