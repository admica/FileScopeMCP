// src/migrate/json-to-sqlite.test.ts
// TDD tests for the JSON-to-SQLite migration runner.
// Covers all behaviors specified in Plan 01-02.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { openDatabase, closeDatabase, getSqlite } from '../db/db.js';
import { getFile, getDependencies, getDependents, upsertFile } from '../db/repository.js';
import { migrateJsonToSQLite, runMigrationIfNeeded } from './json-to-sqlite.js';
import type { FileTreeStorage, FileNode } from '../types.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-migrate-test-'));
}

function writeJsonTree(dir: string, filename: string, storage: FileTreeStorage): string {
  const jsonPath = path.join(dir, filename);
  fs.writeFileSync(jsonPath, JSON.stringify(storage), 'utf-8');
  return jsonPath;
}

function makeSimpleStorage(): FileTreeStorage {
  const root: FileNode = {
    path: '/project',
    name: 'project',
    isDirectory: true,
    children: [
      {
        path: '/project/src',
        name: 'src',
        isDirectory: true,
        children: [
          {
            path: '/project/src/index.ts',
            name: 'index.ts',
            isDirectory: false,
            importance: 8,
            summary: 'Entry point',
            mtime: 1700000000000,
            dependencies: ['/project/src/utils.ts'],
            packageDependencies: [
              { name: 'react', path: '/project/node_modules/react', version: '18.0.0', scope: undefined, isDevDependency: false }
            ],
            dependents: ['/project/src/other.ts'], // Should NOT be inserted
          },
          {
            path: '/project/src/utils.ts',
            name: 'utils.ts',
            isDirectory: false,
            importance: 5,
            summary: undefined,
            mtime: undefined,
            dependencies: [],
            packageDependencies: [],
            dependents: [],
          }
        ]
      }
    ]
  };

  return {
    config: {
      filename: 'FileScopeMCP-tree-test.json',
      baseDirectory: '/project',
      projectRoot: '/project',
      lastUpdated: new Date(),
    },
    fileTree: root
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('migrateJsonToSQLite', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    dbPath = path.join(tmpDir, '.filescope.db');
    openDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('inserts all FileNodes from the JSON tree into SQLite', () => {
    const storage = makeSimpleStorage();
    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-test.json', storage);

    migrateJsonToSQLite(jsonPath, dbPath);

    // All 4 nodes (root dir + src dir + index.ts + utils.ts) should exist
    expect(getFile('/project')).not.toBeNull();
    expect(getFile('/project/src')).not.toBeNull();
    expect(getFile('/project/src/index.ts')).not.toBeNull();
    expect(getFile('/project/src/utils.ts')).not.toBeNull();
  });

  it('renames the JSON file to .bak after successful migration', () => {
    const storage = makeSimpleStorage();
    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-test.json', storage);

    migrateJsonToSQLite(jsonPath, dbPath);

    expect(fs.existsSync(jsonPath)).toBe(false);
    expect(fs.existsSync(jsonPath + '.bak')).toBe(true);
  });

  it('preserves all FileNode fields (path, name, isDirectory, importance, summary, mtime)', () => {
    const storage = makeSimpleStorage();
    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-test.json', storage);

    migrateJsonToSQLite(jsonPath, dbPath);

    const node = getFile('/project/src/index.ts');
    expect(node).not.toBeNull();
    expect(node!.path).toBe('/project/src/index.ts');
    expect(node!.name).toBe('index.ts');
    expect(node!.isDirectory).toBe(false);
    expect(node!.importance).toBe(8);
    expect(node!.summary).toBe('Entry point');
    expect(node!.mtime).toBe(1700000000000);
  });

  it('migrates local dependencies as file_dependency rows', () => {
    const storage = makeSimpleStorage();
    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-test.json', storage);

    migrateJsonToSQLite(jsonPath, dbPath);

    const deps = getDependencies('/project/src/index.ts');
    expect(deps).toContain('/project/src/utils.ts');
    expect(deps).toHaveLength(1);
  });

  it('migrates packageDependencies as package_import rows', () => {
    const storage = makeSimpleStorage();
    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-test.json', storage);

    migrateJsonToSQLite(jsonPath, dbPath);

    // Package deps are stored as package_import rows
    const node = getFile('/project/src/index.ts');
    expect(node).not.toBeNull();
    expect(node!.packageDependencies).toBeDefined();
    expect(node!.packageDependencies!.length).toBe(1);
    expect(node!.packageDependencies![0].name).toBe('react');
  });

  it('does NOT insert dependents as rows (they are derived at query time)', () => {
    const storage = makeSimpleStorage();
    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-test.json', storage);

    migrateJsonToSQLite(jsonPath, dbPath);

    // index.ts has dependents: ['/project/src/other.ts']
    // But other.ts does NOT exist in the tree, so there should be no dependency row
    // for 'other.ts -> index.ts'. getDependents returns files that have a dep ON this file.
    // Only files that were migrated (with actual dependency entries) should appear.
    const dependents = getDependents('/project/src/index.ts');
    // Dependents should only include files that have index.ts in their dependencies
    // utils.ts has no deps, so dependents should be empty
    expect(dependents).toHaveLength(0);
  });



  it('flattens nested children (directories with subdirectories) into files table', () => {
    const deepStorage: FileTreeStorage = {
      config: { filename: 'test.json', baseDirectory: '/', projectRoot: '/', lastUpdated: new Date() },
      fileTree: {
        path: '/root',
        name: 'root',
        isDirectory: true,
        children: [{
          path: '/root/a',
          name: 'a',
          isDirectory: true,
          children: [{
            path: '/root/a/b',
            name: 'b',
            isDirectory: true,
            children: [{
              path: '/root/a/b/file.ts',
              name: 'file.ts',
              isDirectory: false,
            }]
          }]
        }]
      }
    };

    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-deep.json', deepStorage);
    migrateJsonToSQLite(jsonPath, dbPath);

    expect(getFile('/root')).not.toBeNull();
    expect(getFile('/root/a')).not.toBeNull();
    expect(getFile('/root/a/b')).not.toBeNull();
    expect(getFile('/root/a/b/file.ts')).not.toBeNull();
  });

  it('handles empty children arrays and missing optional fields', () => {
    const minimalStorage: FileTreeStorage = {
      config: { filename: 'test.json', baseDirectory: '/', projectRoot: '/', lastUpdated: new Date() },
      fileTree: {
        path: '/root',
        name: 'root',
        isDirectory: true,
        children: [{
          path: '/root/bare.ts',
          name: 'bare.ts',
          isDirectory: false,
          // No importance, no summary, no mtime, no deps
        }]
      }
    };

    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-minimal.json', minimalStorage);
    migrateJsonToSQLite(jsonPath, dbPath);

    const node = getFile('/root/bare.ts');
    expect(node).not.toBeNull();
    // importance defaults to 0 when undefined
    expect(node!.importance).toBe(0);
    expect(node!.summary).toBeUndefined();
    expect(node!.mtime).toBeUndefined();
  });

  it('leaves JSON file untouched if migration fails (malformed JSON)', () => {
    // Write malformed JSON (not parseable) — JSON.parse will throw before any transaction
    const badJsonPath = path.join(tmpDir, 'FileScopeMCP-tree-bad.json');
    fs.writeFileSync(badJsonPath, '{ this is not valid json }', 'utf-8');

    expect(() => migrateJsonToSQLite(badJsonPath, dbPath)).toThrow();

    // JSON should NOT be renamed — it's still there untouched
    expect(fs.existsSync(badJsonPath)).toBe(true);
    expect(fs.existsSync(badJsonPath + '.bak')).toBe(false);
  });
});

describe('runMigrationIfNeeded', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    closeDatabase();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does nothing when no JSON files are present (fresh install)', () => {
    // Open DB first (coordinator pattern), then call migration
    const dbPath = path.join(tmpDir, '.filescope.db');
    openDatabase(dbPath);
    // No JSON files in tmpDir
    expect(() => runMigrationIfNeeded(tmpDir, getSqlite())).not.toThrow();
  });

  it('does nothing when DB already has data (already migrated)', () => {
    // Open DB, insert a file row to simulate already-migrated state
    const dbPath = path.join(tmpDir, '.filescope.db');
    openDatabase(dbPath);
    upsertFile({ path: '/sentinel', name: 'sentinel', isDirectory: false });

    // Write a JSON file too — it should be ignored since DB has data
    const storage = makeSimpleStorage();
    writeJsonTree(tmpDir, 'FileScopeMCP-tree-test.json', storage);

    // Should not throw and should not migrate (DB has data)
    expect(() => runMigrationIfNeeded(tmpDir, getSqlite())).not.toThrow();

    // JSON should still exist (not renamed) since migration was skipped
    expect(fs.existsSync(path.join(tmpDir, 'FileScopeMCP-tree-test.json'))).toBe(true);

    // Sentinel row still present, and the /project nodes were NOT inserted
    expect(getFile('/sentinel')).not.toBeNull();
    expect(getFile('/project')).toBeNull();
  });

  it('triggers migration when JSON file exists and DB has no data', () => {
    const dbPath = path.join(tmpDir, '.filescope.db');
    openDatabase(dbPath);

    const storage = makeSimpleStorage();
    const jsonPath = writeJsonTree(tmpDir, 'FileScopeMCP-tree-test.json', storage);

    runMigrationIfNeeded(tmpDir, getSqlite());

    // DB should have data now
    expect(getFile('/project')).not.toBeNull();
    // JSON should be renamed to .bak
    expect(fs.existsSync(jsonPath)).toBe(false);
    expect(fs.existsSync(jsonPath + '.bak')).toBe(true);
  });
});
