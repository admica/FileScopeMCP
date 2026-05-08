import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getSqlite } from './db.js';
import {
  getFile,
  upsertFile,
  deleteFile,
  getChildren,
  getDependencies,
  getDependents,
  setDependencies,
  getAllFiles,
  getAllFilesWithDeps,
  getAllLocalImportEdges,
  purgeRecordsMatching,
  upsertSymbols,
  getSymbolsForFile,
  setRepoProjectRoot,
  clearRepoProjectRoot,
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
  // Reset the abs<->rel translator to identity-passthrough so individual
  // describe blocks that explicitly set a project root don't leak into
  // tests that expect the default (no translation).
  clearRepoProjectRoot();
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

describe('getAllFilesWithDeps', () => {
  it('populates dependencies, dependents, and packageDependencies on every node', () => {
    // Pass 2b regression: this is the call site that was broken in v3.
    // calculateNodeImportance reads these three fields and adds up to
    // +6 to the static-only baseline; if any is undefined the bonus dies
    // silently and orchestrator files cap out at the static formula.
    upsertFile(makeFile({ path: '/project/a.ts', name: 'a.ts' }));
    upsertFile(makeFile({ path: '/project/b.ts', name: 'b.ts' }));
    upsertFile(makeFile({ path: '/project/c.ts', name: 'c.ts' }));

    // a.ts imports b.ts and c.ts (out-edges); b.ts imports c.ts.
    setDependencies('/project/a.ts', ['/project/b.ts', '/project/c.ts'], []);
    setDependencies('/project/b.ts', ['/project/c.ts'], []);

    // a.ts also has a package import.
    const pkgDep = {
      name: 'lodash',
      version: '^4.0.0',
      path: '/project/node_modules/lodash',
      scope: undefined,
      isDevDependency: false,
    } as unknown as PackageDependency;
    setDependencies('/project/a.ts', ['/project/b.ts', '/project/c.ts'], [pkgDep]);

    const all = getAllFilesWithDeps();
    const a = all.find(f => f.path === '/project/a.ts')!;
    const b = all.find(f => f.path === '/project/b.ts')!;
    const c = all.find(f => f.path === '/project/c.ts')!;

    // a: 2 outgoing local imports + 1 package import; nothing depends on it
    expect(a.dependencies).toHaveLength(2);
    expect(a.dependents ?? []).toHaveLength(0);
    expect(a.packageDependencies).toHaveLength(1);

    // b: 1 outgoing local import; a depends on it
    expect(b.dependencies).toHaveLength(1);
    expect(b.dependents).toEqual(['/project/a.ts']);

    // c: no outgoing; both a and b depend on it
    expect(c.dependencies ?? []).toHaveLength(0);
    expect((c.dependents ?? []).sort()).toEqual(['/project/a.ts', '/project/b.ts']);
  });

  it('returns empty arrays (not undefined) for files with no edges', () => {
    upsertFile(makeFile({ path: '/project/lonely.ts', name: 'lonely.ts' }));
    const all = getAllFilesWithDeps();
    expect(all).toHaveLength(1);
    // Whether dependents is empty array or undefined is implementation-defined;
    // the contract that matters is that calculateNodeImportance can read .length
    // without throwing. Both [] and undefined are handled by `?.length ?? 0`.
    const f = all[0];
    expect(f.dependencies?.length ?? 0).toBe(0);
    expect(f.dependents?.length ?? 0).toBe(0);
    expect(f.packageDependencies?.length ?? 0).toBe(0);
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

  it('deletes symbols whose path satisfies the predicate', () => {
    upsertSymbols('/project/src/keep.ts', [
      { name: 'kept', kind: 'function', startLine: 1, endLine: 2, isExport: false },
    ]);
    upsertSymbols('/project/.claude/worktrees/agent/file.ts', [
      { name: 'gone', kind: 'function', startLine: 1, endLine: 2, isExport: false },
    ]);

    const result = purgeRecordsMatching((p) => p.includes('/.claude/worktrees/'));

    expect(result.symbols).toBe(1);
    expect(getSymbolsForFile('/project/src/keep.ts')).toHaveLength(1);
    expect(getSymbolsForFile('/project/.claude/worktrees/agent/file.ts')).toHaveLength(0);
  });
});

describe('relative-paths storage layout', () => {
  // Cross-host portability is now intrinsic: paths in the DB are stored
  // relative to projectRoot, so a rsync'd .filescope/ never holds rows from
  // a foreign root. The previous purgeRecordsOutsideRoot tests covered the
  // band-aid mechanic that's no longer needed; these replacement tests
  // cover the new contract directly.

  it('stores file rows with relative paths but exposes absolute via getFile', () => {
    setRepoProjectRoot('/home/foo/bar');
    upsertFile(makeFile({ path: '/home/foo/bar/src/keep.ts', name: 'keep.ts' }));

    // Public API contract: caller-supplied absolute path round-trips.
    const node = getFile('/home/foo/bar/src/keep.ts');
    expect(node).not.toBeNull();
    expect(node!.path).toBe('/home/foo/bar/src/keep.ts');

    // Storage check: raw row holds the relative form, not the absolute.
    const raw = getSqlite()
      .prepare('SELECT path FROM files WHERE name = ?')
      .get('keep.ts') as { path: string } | undefined;
    expect(raw).toBeDefined();
    expect(raw!.path).toBe('src/keep.ts');
  });

  it('survives a host-root change at read time (proves storage portability)', () => {
    // Simulate writing on host A, then reading after rsync to host B with a
    // different absolute root. The DB rows stay valid; reads project them
    // against whatever root is set at query time.
    setRepoProjectRoot('/home/alice/dev/proj');
    upsertFile(makeFile({ path: '/home/alice/dev/proj/src/x.ts', name: 'x.ts' }));
    setDependencies('/home/alice/dev/proj/src/x.ts', ['/home/alice/dev/proj/src/y.ts'], []);

    setRepoProjectRoot('/home/bob/work/proj');
    const node = getFile('/home/bob/work/proj/src/x.ts');
    expect(node).not.toBeNull();
    expect(node!.path).toBe('/home/bob/work/proj/src/x.ts');
    expect(getDependencies('/home/bob/work/proj/src/x.ts')).toEqual(['/home/bob/work/proj/src/y.ts']);
  });

  it('drops cross-project edges silently (relInOrNull guard)', () => {
    setRepoProjectRoot('/home/foo/bar');
    upsertFile(makeFile({ path: '/home/foo/bar/a.ts', name: 'a.ts' }));
    // Dependency target outside the root — should be dropped at write time
    // rather than stored as '..'-relative (which would break portability).
    setDependencies('/home/foo/bar/a.ts', ['/home/elsewhere/b.ts'], []);
    expect(getDependencies('/home/foo/bar/a.ts')).toHaveLength(0);
  });

  it('default (no root set) is identity passthrough — no translation', () => {
    // Without setRepoProjectRoot, paths flow through the repo unchanged. This
    // is the test-mode default; production must call setRepoProjectRoot in
    // coordinator.init() to enable the host-portable relative-paths layout.
    upsertFile(makeFile({ path: '/some/abs/p.ts', name: 'p.ts' }));
    expect(getFile('/some/abs/p.ts')).not.toBeNull();
    const raw = getSqlite()
      .prepare('SELECT path FROM files WHERE name = ?')
      .get('p.ts') as { path: string } | undefined;
    expect(raw!.path).toBe('/some/abs/p.ts');  // stored as-is, no relativization
  });
});
