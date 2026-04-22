import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase } from './db.js';
import {
  getFile,
  upsertFile,
  deleteFile,
  getChildren,
  getDependencies,
  getDependents,
  setDependencies,
  getAllFiles,
  getAllLocalImportEdges,
  purgeRecordsMatching,
} from './repository.js';
import type { FileNode, PackageDependency } from '../types.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-repo-test-'));
  return path.join(tmpDir, 'test.db');
}

function makeFile(overrides: Partial<FileNode> = {}): FileNode {
  const node = new (class implements FileNode {
    path = '/project/src/foo.ts';
    name = 'foo.ts';
    isDirectory = false;
    importance = 5;
    summary = 'A test file';
    mtime = 1700000000000;
  })();
  return Object.assign(node, overrides) as FileNode;
}

beforeEach(() => {
  const dbPath = makeTmpDb();
  openDatabase(dbPath);
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
});

describe('upsertFile / getFile', () => {
  it('inserts a new row and retrieves it as a FileNode', () => {
    const node = makeFile();
    upsertFile(node);
    const retrieved = getFile(node.path);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.path).toBe(node.path);
    expect(retrieved!.name).toBe(node.name);
    expect(retrieved!.isDirectory).toBe(false);
    expect(retrieved!.importance).toBe(5);
    expect(retrieved!.summary).toBe('A test file');
    expect(retrieved!.mtime).toBe(1700000000000);
  });

  it('updates an existing row on re-upsert (no duplicates)', () => {
    const node = makeFile();
    upsertFile(node);
    const updated = makeFile({ summary: 'Updated summary', importance: 8 });
    upsertFile(updated);

    const all = getAllFiles();
    // Should only have 1 row with the path
    const matching = all.filter(f => f.path === node.path);
    expect(matching).toHaveLength(1);
    expect(matching[0].summary).toBe('Updated summary');
    expect(matching[0].importance).toBe(8);
  });

  it('correctly maps importance=0 (not null or undefined)', () => {
    const node = makeFile({ importance: 0 });
    upsertFile(node);
    const retrieved = getFile(node.path);
    expect(retrieved!.importance).toBe(0);
  });

  it('getFile returns null for non-existent path', () => {
    const result = getFile('/does/not/exist.ts');
    expect(result).toBeNull();
  });
});

describe('deleteFile', () => {
  it('removes the row; getFile returns null after deletion', () => {
    const node = makeFile();
    upsertFile(node);
    deleteFile(node.path);
    expect(getFile(node.path)).toBeNull();
  });

  it('also deletes dependency rows for the deleted file', () => {
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));
    upsertFile(makeFile({ path: '/project/b.ts', name: 'b.ts' }));
    setDependencies('/project/a.ts', ['/project/b.ts'], []);
    deleteFile('/project/a.ts');
    // No dependencies should remain for a.ts
    expect(getDependencies('/project/a.ts')).toHaveLength(0);
  });
});

describe('getChildren', () => {
  it('returns immediate children only (one level deep)', () => {
    upsertFile(makeFile({ path: '/project', name: 'project', isDirectory: true }));
    upsertFile(makeFile({ path: '/project/src', name: 'src', isDirectory: true }));
    upsertFile(makeFile({ path: '/project/src/foo.ts', name: 'foo.ts' }));
    upsertFile(makeFile({ path: '/project/src/bar.ts', name: 'bar.ts' }));
    upsertFile(makeFile({ path: '/project/src/nested/deep.ts', name: 'deep.ts' }));

    const children = getChildren('/project/src');
    expect(children).toHaveLength(2); // foo.ts and bar.ts only
    const paths = children.map(c => c.path).sort();
    expect(paths).toEqual(['/project/src/bar.ts', '/project/src/foo.ts']);
  });

  it('returns empty array for non-existent directory', () => {
    const result = getChildren('/does/not/exist');
    expect(result).toEqual([]);
  });

  it('does not include the directory itself', () => {
    upsertFile(makeFile({ path: '/project/src', name: 'src', isDirectory: true }));
    upsertFile(makeFile({ path: '/project/src/foo.ts', name: 'foo.ts' }));

    const children = getChildren('/project/src');
    const paths = children.map(c => c.path);
    expect(paths).not.toContain('/project/src');
  });
});

describe('setDependencies / getDependencies / getDependents', () => {
  it('inserts dependency rows; getDependencies returns target paths', () => {
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));
    upsertFile(makeFile({ path: '/project/b.ts', name: 'b.ts' }));
    upsertFile(makeFile({ path: '/project/c.ts', name: 'c.ts' }));
    setDependencies('/project/a.ts', ['/project/b.ts', '/project/c.ts'], []);
    const deps = getDependencies('/project/a.ts');
    expect(deps).toHaveLength(2);
    expect(deps).toContain('/project/b.ts');
    expect(deps).toContain('/project/c.ts');
  });

  it('getDependents returns source paths of files that depend on target', () => {
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));
    upsertFile(makeFile({ path: '/project/b.ts', name: 'b.ts' }));
    upsertFile(makeFile({ path: '/project/shared.ts', name: 'shared.ts' }));
    setDependencies('/project/a.ts', ['/project/shared.ts'], []);
    setDependencies('/project/b.ts', ['/project/shared.ts'], []);
    const dependents = getDependents('/project/shared.ts');
    expect(dependents).toHaveLength(2);
    expect(dependents).toContain('/project/a.ts');
    expect(dependents).toContain('/project/b.ts');
  });

  it('setDependencies replaces old dependencies (delete then insert)', () => {
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));
    upsertFile(makeFile({ path: '/project/b.ts', name: 'b.ts' }));
    upsertFile(makeFile({ path: '/project/c.ts', name: 'c.ts' }));
    setDependencies('/project/a.ts', ['/project/b.ts'], []);
    // Now replace with different deps
    setDependencies('/project/a.ts', ['/project/c.ts'], []);
    const deps = getDependencies('/project/a.ts');
    expect(deps).toHaveLength(1);
    expect(deps).toContain('/project/c.ts');
    expect(deps).not.toContain('/project/b.ts');
  });
});

describe('PackageDependency round-trip', () => {
  it('preserves package_name, package_version, is_dev_dependency through setDependencies/getDependencies', () => {
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));

    const pkgDep: PackageDependency = {
      name: 'react',
      version: '^18.0.0',
      path: '/project/node_modules/react',
      scope: undefined,
      isDevDependency: false,
    } as unknown as PackageDependency;

    setDependencies('/project/a.ts', [], [pkgDep]);

    // Verify via direct repository (getFile should expose packageDependencies)
    const retrieved = getFile('/project/a.ts');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.packageDependencies).toBeDefined();
    expect(retrieved!.packageDependencies).toHaveLength(1);
    const pkg = retrieved!.packageDependencies![0];
    expect(pkg.name).toBe('react');
    expect(pkg.version).toBe('^18.0.0');
    expect(pkg.path).toBe('/project/node_modules/react');
    expect(pkg.isDevDependency).toBe(false);
  });
});

describe('getAllFiles', () => {
  it('returns all file rows as FileNode objects', () => {
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));
    upsertFile(makeFile({ path: '/project/b.ts', name: 'b.ts' }));
    upsertFile(makeFile({ path: '/project/c.ts', name: 'c.ts' }));
    const all = getAllFiles();
    expect(all).toHaveLength(3);
    const paths = all.map(f => f.path).sort();
    expect(paths).toEqual(['/project/a.ts', '/project/b.ts', '/project/c.ts']);
  });

  it('returns empty array when no files exist', () => {
    const all = getAllFiles();
    expect(all).toHaveLength(0);
  });
});

describe('getAllLocalImportEdges', () => {
  it('returns only local_import edges, excluding package_import edges', () => {
    // Insert file rows required by the dependency schema expectations
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));
    upsertFile(makeFile({ path: '/project/b.ts', name: 'b.ts' }));
    upsertFile(makeFile({ path: '/project/c.ts', name: 'c.ts' }));
    upsertFile(makeFile({ path: '/project/d.ts', name: 'd.ts' }));

    // Insert 3 local_import edges directly via setDependencies
    setDependencies('/project/a.ts', ['/project/b.ts', '/project/c.ts'], []);
    setDependencies('/project/b.ts', ['/project/d.ts'], []);

    // Insert 1 package_import edge
    const pkgDep = {
      name: 'lodash',
      version: '^4.0.0',
      path: '/project/node_modules/lodash',
      scope: undefined,
      isDevDependency: false,
    } as unknown as import('../types.js').PackageDependency;
    setDependencies('/project/c.ts', [], [pkgDep]);

    const edges = getAllLocalImportEdges();

    // Should return exactly 3 local_import rows (not the package_import)
    expect(edges).toHaveLength(3);

    // All rows must have source_path and target_path string properties
    for (const edge of edges) {
      expect(typeof edge.source_path).toBe('string');
      expect(typeof edge.target_path).toBe('string');
    }

    // The package_import edge must NOT appear in the result
    const targetPaths = edges.map(e => e.target_path);
    expect(targetPaths).not.toContain('/project/node_modules/lodash');

    // All returned edges should be local_import edges we inserted
    const sourcePaths = edges.map(e => e.source_path);
    expect(sourcePaths).toContain('/project/a.ts');
    expect(sourcePaths).toContain('/project/b.ts');
  });

  it('returns empty array when no local_import edges exist', () => {
    const edges = getAllLocalImportEdges();
    expect(edges).toEqual([]);
  });
});

describe('purgeRecordsMatching', () => {
  it('deletes files whose path satisfies the predicate', () => {
    upsertFile(makeFile({ path: '/project/src/keep.ts', name: 'keep.ts' }));
    upsertFile(makeFile({ path: '/project/.claude/worktrees/agent/file.ts', name: 'file.ts' }));
    upsertFile(makeFile({ path: '/project/.claude/worktrees/agent/other.ts', name: 'other.ts' }));

    const result = purgeRecordsMatching((p) => p.includes('/.claude/worktrees/'));

    expect(result.files).toBe(2);
    expect(getFile('/project/src/keep.ts')).not.toBeNull();
    expect(getFile('/project/.claude/worktrees/agent/file.ts')).toBeNull();
    expect(getFile('/project/.claude/worktrees/agent/other.ts')).toBeNull();
  });

  it('deletes dependency edges where source or target matches', () => {
    upsertFile(makeFile({ path: '/project/keep.ts', name: 'keep.ts' }));
    upsertFile(makeFile({ path: '/project/.claude/worktrees/w1.ts', name: 'w1.ts' }));
    upsertFile(makeFile({ path: '/project/.claude/worktrees/w2.ts', name: 'w2.ts' }));
    setDependencies('/project/keep.ts', ['/project/.claude/worktrees/w1.ts'], []);
    setDependencies('/project/.claude/worktrees/w1.ts', ['/project/.claude/worktrees/w2.ts'], []);

    const result = purgeRecordsMatching((p) => p.includes('/.claude/worktrees/'));

    expect(result.files).toBe(2);
    expect(result.deps).toBeGreaterThanOrEqual(2);
    expect(getDependencies('/project/keep.ts')).toHaveLength(0);
    expect(getDependencies('/project/.claude/worktrees/w1.ts')).toHaveLength(0);
  });

  it('returns zero counts when no paths match', () => {
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));
    const result = purgeRecordsMatching(() => false);
    expect(result.files).toBe(0);
    expect(result.deps).toBe(0);
    expect(getFile('/project/a.ts')).not.toBeNull();
  });
});
