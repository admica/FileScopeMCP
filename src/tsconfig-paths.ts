// src/tsconfig-paths.ts
// Reads `compilerOptions.baseUrl` + `compilerOptions.paths` from a project's
// tsconfig.json so the TS/JS import resolver can map path-aliased imports
// (e.g., `import { x } from '@/foo/bar'`) to real file paths instead of
// silently treating them as npm packages.
//
// Surfaced by docs/known-issues/find-callers-react-hooks.md — the React-hook
// caller-discovery gap was actually a path-alias gap that affected every
// modern Vite/Webpack/Next project using tsconfig `paths`.
//
// Scope: handles the common case (single tsconfig.json at projectRoot, paths
// with single-replacement values, `*` wildcard pattern). Does NOT yet follow
// `extends` chains, multiple replacements, or non-`.` baseUrl. Add when
// needed; the scope here is intentionally minimal so the fix lands.

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface TsConfigPaths {
  /** Absolute base directory — `compilerOptions.baseUrl` resolved against tsconfig.json's directory. Defaults to projectRoot when not set. */
  baseUrl: string;
  /** Patterns from `compilerOptions.paths`. Map of pattern → first replacement. Empty if none configured. */
  paths: Map<string, string>;
}

// Module-level cache keyed by projectRoot. Cleared via clearTsConfigCache().
const cache = new Map<string, TsConfigPaths | null>();

/**
 * Strip `//` line comments and `/* *\/` block comments from a JSONC string.
 * tsconfig.json supports these per the TypeScript spec; standard JSON.parse
 * does not. Naive but correct for tsconfig content (no comments inside strings
 * is the convention; we don't try to handle that pathological edge).
 */
function stripJsonComments(src: string): string {
  // Block comments first (so `// inside /* */` doesn't confuse the line stripper).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments — only outside strings. We use a simple heuristic: only strip
  // `//` that is not preceded by an odd number of unescaped quotes on its line.
  // For tsconfig, the simpler "strip any // through end-of-line" is safe enough
  // since tsconfig path strings don't contain `//`.
  out = out.replace(/(^|[^:])\/\/.*$/gm, '$1');
  return out;
}

/**
 * Load and cache `compilerOptions.baseUrl` + `compilerOptions.paths` from
 * `<projectRoot>/tsconfig.json`. Returns null when no tsconfig exists or no
 * paths are configured. Idempotent — repeated calls with the same projectRoot
 * hit the cache.
 */
export function loadTsConfigPaths(projectRoot: string): TsConfigPaths | null {
  if (cache.has(projectRoot)) return cache.get(projectRoot) ?? null;

  const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
  let raw: string;
  try {
    raw = fs.readFileSync(tsconfigPath, 'utf-8');
  } catch {
    cache.set(projectRoot, null);
    return null;
  }

  let parsed: { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  try {
    parsed = JSON.parse(stripJsonComments(raw));
  } catch {
    cache.set(projectRoot, null);
    return null;
  }

  const compilerOptions = parsed.compilerOptions ?? {};
  const rawPaths = compilerOptions.paths;
  if (!rawPaths || typeof rawPaths !== 'object') {
    cache.set(projectRoot, null);
    return null;
  }

  // baseUrl is relative to the tsconfig.json's directory (here = projectRoot).
  // Default per TypeScript spec is the directory of tsconfig.json itself.
  const baseUrlRel = compilerOptions.baseUrl ?? '.';
  const baseUrl = path.resolve(projectRoot, baseUrlRel);

  const paths = new Map<string, string>();
  for (const [pattern, replacements] of Object.entries(rawPaths)) {
    if (!Array.isArray(replacements) || replacements.length === 0) continue;
    const first = replacements[0];
    if (typeof first !== 'string') continue;
    paths.set(pattern, first);
  }

  if (paths.size === 0) {
    cache.set(projectRoot, null);
    return null;
  }

  const config = { baseUrl, paths };
  cache.set(projectRoot, config);
  return config;
}

/**
 * Try to resolve `importPath` via tsconfig path-alias mapping. Returns the
 * absolute target path on success, null on no-match or no-config. The returned
 * path may not exist on disk — callers should still probe with extensions.
 *
 * Wildcard semantics: a pattern ending in `/*` matches any importPath whose
 * prefix matches; the captured `*` portion is substituted into the
 * replacement's `*` position. A pattern without `*` is treated as exact match.
 */
export function resolveTsConfigAlias(importPath: string, projectRoot: string): string | null {
  const config = loadTsConfigPaths(projectRoot);
  if (!config) return null;

  for (const [pattern, replacement] of config.paths) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1); // keep the trailing slash, drop the *
      if (importPath.startsWith(prefix)) {
        const captured = importPath.slice(prefix.length);
        const expanded = replacement.replace(/\*$/, captured);
        return path.resolve(config.baseUrl, expanded);
      }
    } else if (pattern === importPath) {
      return path.resolve(config.baseUrl, replacement);
    }
  }
  return null;
}

/** Clear the per-projectRoot cache. For tests and reload scenarios. */
export function clearTsConfigCache(): void {
  cache.clear();
}
