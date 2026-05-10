// src/tsconfig-paths.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { loadTsConfigPaths, resolveTsConfigAlias, clearTsConfigCache } from './tsconfig-paths.js';

let tmpDir: string;

function writeTsConfig(content: string): void {
  fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), content);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-tsconfig-paths-'));
  clearTsConfigCache();
});

afterEach(() => {
  clearTsConfigCache();
  if (tmpDir) { try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ } }
});

// ─── loadTsConfigPaths ────────────────────────────────────────────────────────

describe('loadTsConfigPaths', () => {
  it('returns null when tsconfig.json does not exist', () => {
    expect(loadTsConfigPaths(tmpDir)).toBeNull();
  });

  it('returns null when tsconfig has no compilerOptions.paths', () => {
    writeTsConfig(JSON.stringify({ compilerOptions: { target: 'ES2020' } }));
    expect(loadTsConfigPaths(tmpDir)).toBeNull();
  });

  it('returns null when paths is empty object', () => {
    writeTsConfig(JSON.stringify({ compilerOptions: { paths: {} } }));
    expect(loadTsConfigPaths(tmpDir)).toBeNull();
  });

  it('returns null when paths replacement values are not strings', () => {
    writeTsConfig(JSON.stringify({ compilerOptions: { paths: { '@/*': [123] } } }));
    expect(loadTsConfigPaths(tmpDir)).toBeNull();
  });

  it('returns null on malformed JSON', () => {
    writeTsConfig('{ this is not json');
    expect(loadTsConfigPaths(tmpDir)).toBeNull();
  });

  it('parses standard tradewarrior-style alias config', () => {
    writeTsConfig(JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['./src/*'] },
      },
    }));
    const config = loadTsConfigPaths(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.baseUrl).toBe(path.resolve(tmpDir, '.'));
    expect(config!.paths.get('@/*')).toBe('./src/*');
  });

  it('defaults baseUrl to projectRoot when not specified', () => {
    writeTsConfig(JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }));
    const config = loadTsConfigPaths(tmpDir);
    expect(config!.baseUrl).toBe(path.resolve(tmpDir, '.'));
  });

  it('strips // line comments and /* */ block comments (JSONC)', () => {
    writeTsConfig(`{
  // This is a TypeScript config
  "compilerOptions": {
    /* path alias for src */
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"] // matches Vite alias
    }
  }
}`);
    const config = loadTsConfigPaths(tmpDir);
    expect(config).not.toBeNull();
    expect(config!.paths.get('@/*')).toBe('./src/*');
  });

  it('takes only the first replacement when multiple are provided', () => {
    writeTsConfig(JSON.stringify({
      compilerOptions: { paths: { '@/*': ['./src/*', './fallback/*'] } },
    }));
    const config = loadTsConfigPaths(tmpDir);
    expect(config!.paths.get('@/*')).toBe('./src/*');
  });

  it('caches results — second call does not re-read the file', () => {
    writeTsConfig(JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }));
    const first = loadTsConfigPaths(tmpDir);

    // Mutate the file on disk; cache should hide the change.
    writeTsConfig(JSON.stringify({ compilerOptions: { paths: { '@/*': ['./changed/*'] } } }));
    const second = loadTsConfigPaths(tmpDir);

    expect(second!.paths.get('@/*')).toBe(first!.paths.get('@/*'));
    expect(second!.paths.get('@/*')).toBe('./src/*');
  });
});

// ─── resolveTsConfigAlias ────────────────────────────────────────────────────

describe('resolveTsConfigAlias', () => {
  it('returns null when no tsconfig is present', () => {
    expect(resolveTsConfigAlias('@/foo', tmpDir)).toBeNull();
  });

  it('resolves a wildcard alias against the tradewarrior pattern', () => {
    writeTsConfig(JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } },
    }));
    const resolved = resolveTsConfigAlias('@/hooks/useSports', tmpDir);
    expect(resolved).toBe(path.resolve(tmpDir, './src/hooks/useSports'));
  });

  it('returns null when import does not match any configured pattern', () => {
    writeTsConfig(JSON.stringify({
      compilerOptions: { paths: { '@/*': ['./src/*'] } },
    }));
    expect(resolveTsConfigAlias('react', tmpDir)).toBeNull();
    expect(resolveTsConfigAlias('@anthropic-ai/sdk', tmpDir)).toBeNull();
    expect(resolveTsConfigAlias('./relative', tmpDir)).toBeNull();
  });

  it('matches longer-prefix aliases (e.g., ~components/*)', () => {
    writeTsConfig(JSON.stringify({
      compilerOptions: { paths: { '~components/*': ['./src/components/*'] } },
    }));
    expect(resolveTsConfigAlias('~components/Button', tmpDir))
      .toBe(path.resolve(tmpDir, './src/components/Button'));
  });

  it('handles exact (non-wildcard) alias patterns', () => {
    writeTsConfig(JSON.stringify({
      compilerOptions: { paths: { '@app/config': ['./src/config/index.ts'] } },
    }));
    expect(resolveTsConfigAlias('@app/config', tmpDir))
      .toBe(path.resolve(tmpDir, './src/config/index.ts'));
    // Different path under same prefix should NOT match an exact pattern.
    expect(resolveTsConfigAlias('@app/config/sub', tmpDir)).toBeNull();
  });

  it('does not falsely match @-scoped npm packages', () => {
    writeTsConfig(JSON.stringify({
      compilerOptions: { paths: { '@/*': ['./src/*'] } },
    }));
    // @anthropic-ai/sdk does NOT start with `@/`, so it must not match.
    expect(resolveTsConfigAlias('@anthropic-ai/sdk', tmpDir)).toBeNull();
    expect(resolveTsConfigAlias('@tanstack/react-query', tmpDir)).toBeNull();
  });
});
