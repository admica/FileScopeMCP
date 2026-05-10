// src/language-config.tsconfig-paths-integration.test.ts
// Integration test for the tsconfig path-alias fix in resolveTsJsImport.
// Reproduces the original tradewarrior `@/hooks/useSports` symptom in a
// minimal synthetic project and verifies the resolver now produces:
//   - a local (isPackage: false) import edge to the hook file
//   - a call-site edge from the consumer to the hook
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { extractTsJsFileParse } from './language-config.js';
import { clearTsConfigCache } from './tsconfig-paths.js';
import { openDatabase, closeDatabase } from './db/db.js';
import { setRepoProjectRoot, clearRepoProjectRoot, upsertFile, upsertSymbols } from './db/repository.js';
import type { FileNode } from './types.js';

let projectRoot: string;

function write(rel: string, content: string): void {
  const full = path.join(projectRoot, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-tsconfig-int-'));
  clearTsConfigCache();
  openDatabase(path.join(projectRoot, 'test.db'));
  setRepoProjectRoot(projectRoot);
});

afterEach(() => {
  clearRepoProjectRoot();
  try { closeDatabase(); } catch { /* ignore */ }
  clearTsConfigCache();
  if (projectRoot) { try { fs.rmSync(projectRoot, { recursive: true }); } catch { /* ignore */ } }
});

describe('extractTsJsFileParse — tsconfig path-alias resolution', () => {
  it('resolves an @/-aliased import to a LOCAL edge (not a package)', async () => {
    write('tsconfig.json', JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
    }));
    write('src/hooks/useSports.ts', `
export function useSportsGames(sport?: string) { return sport; }
`);
    const consumerPath = path.join(projectRoot, 'src/pages/TownSquarePage.tsx');
    write('src/pages/TownSquarePage.tsx', `
import { useSportsGames } from '@/hooks/useSports'

export function TownSquarePage() {
  const data = useSportsGames();
  return data;
}
`);

    const result = await extractTsJsFileParse(
      consumerPath,
      fs.readFileSync(consumerPath, 'utf-8'),
      projectRoot,
    );

    expect(result).not.toBeNull();
    const importEdges = result!.edges.filter(e => e.edgeType === 'imports');
    expect(importEdges.length).toBe(1);
    const useSportsEdge = importEdges[0];

    // The headline assertion — pre-fix this would be isPackage:true.
    expect(useSportsEdge.isPackage).toBe(false);
    // Target should be the resolved hook file path (with .ts extension probed).
    expect(useSportsEdge.target).toBe(path.join(projectRoot, 'src/hooks/useSports.ts'));
  });

  it('produces a call-site edge from consumer to aliased hook', async () => {
    // Same setup as above; this test verifies the downstream consequence —
    // that the call graph picks up the aliased call site (the actual bug
    // that surfaced in the invocation-baseline run).
    write('tsconfig.json', JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
    }));
    write('src/hooks/useSports.ts', `
export function useSportsGames(sport?: string) { return sport; }
`);
    const consumerPath = path.join(projectRoot, 'src/pages/TownSquarePage.tsx');
    write('src/pages/TownSquarePage.tsx', `
import { useSportsGames } from '@/hooks/useSports'

export function TownSquarePage() {
  const data = useSportsGames();
  return data;
}
`);

    // Seed the symbols table so importedSymbolIndex can match the import.
    const hookPath = path.join(projectRoot, 'src/hooks/useSports.ts');
    upsertFile({
      path: hookPath, name: 'useSports.ts', isDirectory: false,
      importance: 1, summary: null, mtime: Date.now(),
      dependencies: [], dependents: [], packageDependencies: [],
    } as unknown as FileNode);
    upsertSymbols(hookPath, [{
      name: 'useSportsGames', kind: 'function',
      startLine: 2, endLine: 2, isExport: true,
    }]);

    const result = await extractTsJsFileParse(
      consumerPath,
      fs.readFileSync(consumerPath, 'utf-8'),
      projectRoot,
    );

    expect(result).not.toBeNull();
    const callSiteEdges = result!.callSiteEdges;
    const useSportsCalls = callSiteEdges.filter(e => e.calleeName === 'useSportsGames');

    // The headline — pre-fix this was 0 (the bug). Post-fix should be 1.
    expect(useSportsCalls.length).toBe(1);
    expect(useSportsCalls[0].calleePath).toBe(path.join(projectRoot, 'src/hooks/useSports.ts'));
  });

  it('still classifies real npm @scoped packages as packages', async () => {
    // Negative control — ensure the fix doesn't break npm scoped-package
    // detection (e.g., @anthropic-ai/sdk, @tanstack/react-query).
    write('tsconfig.json', JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
    }));
    fs.mkdirSync(path.join(projectRoot, 'node_modules/@tanstack/react-query'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'node_modules/@tanstack/react-query/package.json'),
      JSON.stringify({ name: '@tanstack/react-query', version: '5.0.0' }),
    );
    const consumerPath = path.join(projectRoot, 'src/App.tsx');
    write('src/App.tsx', `
import { useQuery } from '@tanstack/react-query'
export function App() { return useQuery; }
`);

    const result = await extractTsJsFileParse(
      consumerPath,
      fs.readFileSync(consumerPath, 'utf-8'),
      projectRoot,
    );

    expect(result).not.toBeNull();
    const importEdges = result!.edges.filter(e => e.edgeType === 'imports');
    expect(importEdges.length).toBe(1);
    expect(importEdges[0].isPackage).toBe(true);
    expect(importEdges[0].packageName).toBe('@tanstack/react-query');
  });
});
