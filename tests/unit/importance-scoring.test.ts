// tests/unit/importance-scoring.test.ts
// Comprehensive tests for the importance scoring algorithm.
// Tests file type bonuses, location bonuses, name bonuses,
// dependent count scaling, and min/max bounds.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { calculateImportance, buildDependentMap, scanDirectory } from '../../src/file-utils.js';
import { FileNode } from '../../src/types.js';
import { setProjectRoot, setConfig } from '../../src/global-state.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(filePath: string, overrides: Partial<FileNode> = {}): FileNode {
  const node = new FileNode();
  node.path = filePath;
  node.name = path.basename(filePath);
  node.isDirectory = false;
  node.dependencies = [];
  node.dependents = [];
  return Object.assign(node, overrides);
}

function makeDir(dirPath: string, children: FileNode[]): FileNode {
  const node = new FileNode();
  node.path = dirPath;
  node.name = path.basename(dirPath);
  node.isDirectory = true;
  node.children = children;
  return node;
}

async function collectStream(gen: AsyncGenerator<FileNode>): Promise<FileNode[]> {
  const results: FileNode[] = [];
  for await (const node of gen) results.push(node);
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// File type bonuses
// ═══════════════════════════════════════════════════════════════════════════════

describe('File type importance bonuses', () => {
  it('TypeScript files (.ts) get higher base importance than unknown types', () => {
    const tsFile = makeFile('/project/src/app.ts');
    const txtFile = makeFile('/project/src/notes.txt');

    const root = makeDir('/project/src', [tsFile, txtFile]);
    calculateImportance(root);

    expect(tsFile.importance).toBeGreaterThan(txtFile.importance!);
  });

  it('.tsx files get same bonus as .ts', () => {
    const ts = makeFile('/project/src/a.ts');
    const tsx = makeFile('/project/src/b.tsx');

    const root = makeDir('/project/src', [ts, tsx]);
    calculateImportance(root);

    expect(ts.importance).toBe(tsx.importance);
  });

  it('.js files get appropriate bonus', () => {
    const js = makeFile('/project/src/app.js');
    const txt = makeFile('/project/src/readme.txt');

    const root = makeDir('/project/src', [js, txt]);
    calculateImportance(root);

    expect(js.importance).toBeGreaterThan(txt.importance!);
  });

  it('config files get high importance', () => {
    const pkg = makeFile('/project/package.json');
    const regular = makeFile('/project/data.json');

    const root = makeDir('/project', [pkg, regular]);
    calculateImportance(root);

    expect(pkg.importance).toBeGreaterThan(regular.importance!);
  });

  it('.go files get language bonus', () => {
    const goFile = makeFile('/project/main.go');
    const txtFile = makeFile('/project/notes.txt');

    const root = makeDir('/project', [goFile, txtFile]);
    calculateImportance(root);

    expect(goFile.importance).toBeGreaterThan(txtFile.importance!);
  });

  it('.rb files get language bonus', () => {
    const rb = makeFile('/project/app.rb');
    const txt = makeFile('/project/data.txt');

    const root = makeDir('/project', [rb, txt]);
    calculateImportance(root);

    expect(rb.importance).toBeGreaterThan(txt.importance!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Location bonuses
// ═══════════════════════════════════════════════════════════════════════════════

describe('Location importance bonuses', () => {
  it('src/ files get location bonus', () => {
    const srcFile = makeFile('/project/src/app.ts');
    const otherFile = makeFile('/project/docs/guide.ts');

    const src = makeDir('/project/src', [srcFile]);
    const docs = makeDir('/project/docs', [otherFile]);
    const root = makeDir('/project', [src, docs]);
    calculateImportance(root);

    expect(srcFile.importance).toBeGreaterThan(otherFile.importance!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Significant name bonuses
// ═══════════════════════════════════════════════════════════════════════════════

describe('Significant name importance bonuses', () => {
  const significantNames = ['index', 'main', 'server', 'app', 'config', 'types', 'utils'];

  for (const name of significantNames) {
    it(`"${name}.ts" gets name bonus`, () => {
      const significant = makeFile(`/project/src/${name}.ts`);
      const regular = makeFile('/project/src/helper-random-xyz.ts');

      const root = makeDir('/project/src', [significant, regular]);
      calculateImportance(root);

      expect(significant.importance).toBeGreaterThan(regular.importance!);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Dependent count scaling
// ═══════════════════════════════════════════════════════════════════════════════

describe('Dependent count importance scaling', () => {
  it('file with dependents gets higher importance than file without', () => {
    const dep = makeFile('/project/src/dep.ts', {
      dependents: ['/project/src/a.ts', '/project/src/b.ts'],
    });
    const noDep = makeFile('/project/src/isolated.ts', { dependents: [] });

    const root = makeDir('/project/src', [dep, noDep]);
    calculateImportance(root);

    expect(dep.importance).toBeGreaterThan(noDep.importance!);
  });

  it('more dependents = higher importance (3 vs 1)', () => {
    const manyDeps = makeFile('/project/src/core.ts', {
      dependents: ['/project/src/a.ts', '/project/src/b.ts', '/project/src/c.ts'],
    });
    const oneDep = makeFile('/project/src/helper.ts', {
      dependents: ['/project/src/a.ts'],
    });

    const root = makeDir('/project/src', [manyDeps, oneDep]);
    calculateImportance(root);

    expect(manyDeps.importance).toBeGreaterThan(oneDep.importance!);
  });

  it('outgoing dependencies contribute to importance', () => {
    const importer = makeFile('/project/src/importer.ts', {
      dependencies: ['/project/src/a.ts', '/project/src/b.ts'],
    });
    const noImports = makeFile('/project/src/standalone.ts', { dependencies: [] });

    const root = makeDir('/project/src', [importer, noImports]);
    calculateImportance(root);

    expect(importer.importance).toBeGreaterThanOrEqual(noImports.importance!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Bounds
// ═══════════════════════════════════════════════════════════════════════════════

describe('Importance bounds', () => {
  it('importance is always between 0 and 10', () => {
    const files = Array.from({ length: 20 }, (_, i) =>
      makeFile(`/project/src/file${i}.ts`, {
        dependents: Array.from({ length: i * 2 }, (_, j) => `/project/src/dep${j}.ts`),
        dependencies: Array.from({ length: i }, (_, j) => `/project/src/import${j}.ts`),
      })
    );

    const root = makeDir('/project/src', files);
    calculateImportance(root);

    for (const file of files) {
      expect(file.importance).toBeDefined();
      expect(file.importance!).toBeGreaterThanOrEqual(0);
      expect(file.importance!).toBeLessThanOrEqual(10);
    }
  });

  it('isolated file with no bonuses has importance >= 0', () => {
    const isolated = makeFile('/project/random.txt');
    const root = makeDir('/project', [isolated]);
    calculateImportance(root);

    expect(isolated.importance).toBeDefined();
    expect(isolated.importance!).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildDependentMap
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildDependentMap', () => {
  it('populates dependents from dependencies', () => {
    const a = makeFile('/project/a.ts', { dependencies: ['/project/b.ts'] });
    const b = makeFile('/project/b.ts');

    const root = makeDir('/project', [a, b]);
    buildDependentMap(root);

    expect(b.dependents).toContain('/project/a.ts');
  });

  it('handles chain: A->B->C populates C.dependents with B', () => {
    const a = makeFile('/project/a.ts', { dependencies: ['/project/b.ts'] });
    const b = makeFile('/project/b.ts', { dependencies: ['/project/c.ts'] });
    const c = makeFile('/project/c.ts');

    const root = makeDir('/project', [a, b, c]);
    buildDependentMap(root);

    expect(c.dependents).toContain('/project/b.ts');
    expect(b.dependents).toContain('/project/a.ts');
  });

  it('handles circular dependencies without infinite loop', () => {
    const a = makeFile('/project/a.ts', { dependencies: ['/project/b.ts'] });
    const b = makeFile('/project/b.ts', { dependencies: ['/project/a.ts'] });

    const root = makeDir('/project', [a, b]);

    // Should not hang or throw
    expect(() => buildDependentMap(root)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// scanDirectory importance calculation
// ═══════════════════════════════════════════════════════════════════════════════

describe('scanDirectory initial importance', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'importance-scan-'));
    setProjectRoot(tempDir);
    setConfig({ excludePatterns: [] } as any);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('package.json gets importance >= 3', async () => {
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{}');
    const nodes = await collectStream(scanDirectory(tempDir));
    const pkg = nodes.find(n => n.name === 'package.json');
    expect(pkg).toBeDefined();
    expect(pkg!.importance).toBeGreaterThanOrEqual(3);
  });

  it('tsconfig.json gets importance >= 3', async () => {
    fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
    const nodes = await collectStream(scanDirectory(tempDir));
    const tsconfig = nodes.find(n => n.name === 'tsconfig.json');
    expect(tsconfig).toBeDefined();
    expect(tsconfig!.importance).toBeGreaterThanOrEqual(3);
  });

  it('README.md gets importance >= 2', async () => {
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Readme');
    const nodes = await collectStream(scanDirectory(tempDir));
    const readme = nodes.find(n => n.name === 'README.md');
    expect(readme).toBeDefined();
    expect(readme!.importance).toBeGreaterThanOrEqual(2);
  });

  it('index.ts gets importance >= 4 (name bonus + type bonus + location bonus)', async () => {
    const src = path.join(tempDir, 'src');
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, 'index.ts'), 'export const x = 1;');
    const nodes = await collectStream(scanDirectory(tempDir));
    const index = nodes.find(n => n.name === 'index.ts');
    expect(index).toBeDefined();
    expect(index!.importance).toBeGreaterThanOrEqual(4);
  });

  it('go.mod gets config file bonus >= 3', async () => {
    fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module test\n\ngo 1.21');
    const nodes = await collectStream(scanDirectory(tempDir));
    const gomod = nodes.find(n => n.name === 'go.mod');
    expect(gomod).toBeDefined();
    expect(gomod!.importance).toBeGreaterThanOrEqual(3);
  });

  it('Gemfile gets config file bonus >= 3', async () => {
    fs.writeFileSync(path.join(tempDir, 'Gemfile'), "source 'https://rubygems.org'");
    const nodes = await collectStream(scanDirectory(tempDir));
    const gemfile = nodes.find(n => n.name === 'Gemfile');
    expect(gemfile).toBeDefined();
    expect(gemfile!.importance).toBeGreaterThanOrEqual(3);
  });
});
