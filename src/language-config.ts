// src/language-config.ts
// LanguageConfig registry: dispatches file extensions to the correct dependency extractor.
//
// Dispatch table:
//   .ts/.tsx/.js/.jsx  → extractTsJsEdges()  (AST via tree-sitter, confidence = EXTRACTED 1.0)
//   .go                → extractGoEdges()     (specialized Go resolver, confidence = INFERRED 0.8)
//   .rb                → extractRubyEdges()   (specialized Ruby resolver, confidence = INFERRED 0.8)
//   all IMPORT_PATTERNS → buildRegexExtractor() (generic regex, confidence = INFERRED 0.8)
//   unknown extension  → returns []
//
// After this module, all dependency extraction flows through extractEdges() and all
// edge writes use setEdges() with enriched metadata. This is the integration seam
// that makes Phase 26 a "just add grammar + registry entry" operation.

import * as path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { log } from './logger.js';
import { EXTRACTED, INFERRED, CONFIDENCE_SOURCE_EXTRACTED, CONFIDENCE_SOURCE_INFERRED } from './confidence.js';
import type { ConfidenceSource } from './confidence.js';
import { extractSnapshot } from './change-detector/ast-parser.js';
import {
  IMPORT_PATTERNS,
  resolveImportPath,
  isUnresolvedTemplateLiteral,
  resolveGoImports,
  resolveRubyImports,
  extractPackageVersion,
  readGoModuleName,
  normalizePath,
} from './file-utils.js';
import { PackageDependency } from './types.js';

// ─── Public types ──────────────────────────────────────────────────────────────

/**
 * A single resolved dependency edge from a source file.
 * Carries enriched metadata for the new edge columns in file_dependencies.
 */
export interface EdgeResult {
  /** Resolved absolute path (local) or node_modules path (package). */
  target: string;
  /** Edge type — currently always 'imports'. */
  edgeType: string;
  /** Confidence score: 1.0 (AST) or 0.8 (regex/inferred). */
  confidence: number;
  /** Confidence source label: 'extracted' or 'inferred'. */
  confidenceSource: ConfidenceSource;
  /** Edge weight — currently always 1. */
  weight: number;
  /** True if this is a package dependency (node_modules, gem, stdlib, etc.). */
  isPackage: boolean;
  /** Package name — only present for package deps. */
  packageName?: string;
  /** Package version string — only present if resolved from package.json. */
  packageVersion?: string;
}

// ─── Internal registry type ────────────────────────────────────────────────────

interface LanguageConfig {
  grammarLoader: (() => unknown) | null;
  usesRegexFallback: boolean;
  extract: (filePath: string, content: string, projectRoot: string) => Promise<EdgeResult[]>;
}

// ─── Go module name cache ──────────────────────────────────────────────────────

// Lazy-loaded Go module name, keyed by projectRoot.
// Avoids re-reading go.mod for every Go file in the bulk scan.
const goModuleCache = new Map<string, string | null>();

async function getGoModuleName(projectRoot: string): Promise<string | null> {
  if (goModuleCache.has(projectRoot)) {
    return goModuleCache.get(projectRoot)!;
  }
  const name = await readGoModuleName(projectRoot);
  goModuleCache.set(projectRoot, name);
  return name;
}

// ─── TS/JS AST extractor ───────────────────────────────────────────────────────

/**
 * Extracts dependency edges from a TypeScript/JavaScript file using the AST.
 * Delegates to extractSnapshot() from ast-parser.ts, then resolves and classifies
 * each import path into local (EdgeResult.isPackage=false) or package edges.
 *
 * Multi-extension probing for local files: the resolved path is tried first,
 * then with .ts/.tsx/.js/.jsx appended, matching the behavior in the coordinator
 * bulk-scan pass 2.
 *
 * Confidence: EXTRACTED (1.0) — AST-derived edges are structurally certain.
 */
async function extractTsJsEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  const snapshot = extractSnapshot(filePath, content);
  if (!snapshot) return [];

  log(`[language-config] [AST] Found ${snapshot.imports.length} imports in ${filePath}`);

  const edges: EdgeResult[] = [];

  for (const importPath of snapshot.imports) {
    if (isUnresolvedTemplateLiteral(importPath)) {
      log(`[language-config] Skipping unresolved template literal: ${importPath}`);
      continue;
    }

    try {
      const resolvedPath = resolveImportPath(importPath, filePath, projectRoot);
      const normalizedResolvedPath = normalizePath(resolvedPath);

      const isPackage =
        normalizedResolvedPath.includes('node_modules') ||
        (!importPath.startsWith('.') && !importPath.startsWith('/'));

      if (isPackage) {
        const pkgDep = PackageDependency.fromPath(normalizedResolvedPath);
        if (!pkgDep.name) {
          if (importPath.startsWith('@')) {
            const parts = importPath.split('/');
            if (parts.length >= 2) {
              pkgDep.scope = parts[0];
              pkgDep.name = `${parts[0]}/${parts[1]}`;
            }
          } else if (importPath.includes('/')) {
            pkgDep.name = importPath.split('/')[0];
          } else {
            pkgDep.name = importPath;
          }
        }

        if (isUnresolvedTemplateLiteral(pkgDep.name)) continue;

        const version = await extractPackageVersion(pkgDep.name, projectRoot);

        edges.push({
          target: normalizedResolvedPath,
          edgeType: 'imports',
          confidence: EXTRACTED,
          confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
          weight: 1,
          isPackage: true,
          packageName: pkgDep.name || undefined,
          packageVersion: version,
        });
      } else {
        // Multi-extension probe: try exact path first, then with common extensions
        const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', ''];
        let resolvedTarget: string | null = null;

        // First try the normalized resolved path directly
        try {
          await fsPromises.access(normalizedResolvedPath);
          resolvedTarget = normalizedResolvedPath;
        } catch {
          // Try with extensions appended
          for (const ext of possibleExtensions) {
            if (ext === '') continue; // Already tried bare path above
            const pathToCheck = normalizedResolvedPath + ext;
            try {
              await fsPromises.access(pathToCheck);
              resolvedTarget = pathToCheck;
              break;
            } catch { /* try next extension */ }
          }
        }

        if (resolvedTarget) {
          edges.push({
            target: resolvedTarget,
            edgeType: 'imports',
            confidence: EXTRACTED,
            confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
            weight: 1,
            isPackage: false,
          });
        }
      }
    } catch (resolveError) {
      log(`[language-config] Error resolving TS/JS import '${importPath}' in ${filePath}: ${resolveError}`);
    }
  }

  return edges;
}

// ─── Go extractor ─────────────────────────────────────────────────────────────

/**
 * Extracts dependency edges from a Go file using the specialized Go resolver.
 * Confidence: INFERRED (0.8) — regex-based Go import parsing.
 */
async function extractGoEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  const moduleName = await getGoModuleName(projectRoot);
  const { dependencies, packageDependencies } = await resolveGoImports(
    content,
    filePath,
    projectRoot,
    moduleName
  );

  const edges: EdgeResult[] = [];

  for (const dep of dependencies) {
    edges.push({
      target: dep,
      edgeType: 'imports',
      confidence: INFERRED,
      confidenceSource: CONFIDENCE_SOURCE_INFERRED,
      weight: 1,
      isPackage: false,
    });
  }

  for (const pkg of packageDependencies) {
    edges.push({
      target: pkg.path,
      edgeType: 'imports',
      confidence: INFERRED,
      confidenceSource: CONFIDENCE_SOURCE_INFERRED,
      weight: 1,
      isPackage: true,
      packageName: pkg.name || undefined,
      packageVersion: pkg.version,
    });
  }

  return edges;
}

// ─── Ruby extractor ────────────────────────────────────────────────────────────

/**
 * Extracts dependency edges from a Ruby file using the specialized Ruby resolver.
 * Confidence: INFERRED (0.8) — regex-based Ruby require parsing.
 */
async function extractRubyEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  const { dependencies, packageDependencies } = await resolveRubyImports(
    content,
    filePath,
    projectRoot
  );

  const edges: EdgeResult[] = [];

  for (const dep of dependencies) {
    edges.push({
      target: dep,
      edgeType: 'imports',
      confidence: INFERRED,
      confidenceSource: CONFIDENCE_SOURCE_INFERRED,
      weight: 1,
      isPackage: false,
    });
  }

  for (const pkg of packageDependencies) {
    edges.push({
      target: pkg.path,
      edgeType: 'imports',
      confidence: INFERRED,
      confidenceSource: CONFIDENCE_SOURCE_INFERRED,
      weight: 1,
      isPackage: true,
      packageName: pkg.name || undefined,
      packageVersion: pkg.version,
    });
  }

  return edges;
}

// ─── Generic regex extractor factory ──────────────────────────────────────────

/**
 * Builds a generic regex-based edge extractor for languages with IMPORT_PATTERNS entries.
 * Each call creates a fresh RegExp to reset lastIndex (the patterns use the /g flag).
 * C/C++ angled-include detection classifies <header.h> includes as package/system deps.
 *
 * Confidence: INFERRED (0.8) — regex-based extraction.
 */
function buildRegexExtractor(
  ext: string
): (filePath: string, content: string, projectRoot: string) => Promise<EdgeResult[]> {
  const cppExts = new Set(['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx']);

  return async (filePath: string, content: string, projectRoot: string): Promise<EdgeResult[]> => {
    const pattern = IMPORT_PATTERNS[ext];
    if (!pattern) return [];

    // Create a fresh RegExp each call to reset lastIndex (critical for /g flag)
    const re = new RegExp(pattern.source, pattern.flags);
    const isCppFile = cppExts.has(ext);
    const edges: EdgeResult[] = [];

    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const importPath = match[1] || match[2] || match[3];
      if (!importPath) continue;
      if (isUnresolvedTemplateLiteral(importPath)) continue;

      try {
        const resolvedPath = path.resolve(path.dirname(filePath), importPath);
        const normalizedResolvedPath = normalizePath(resolvedPath);

        const isPackage =
          normalizedResolvedPath.includes('node_modules') ||
          (isCppFile && match[0].includes('<')) ||
          (!isCppFile && !importPath.startsWith('.') && !importPath.startsWith('/'));

        if (isPackage) {
          const pkgDep = PackageDependency.fromPath(normalizedResolvedPath);

          if (isUnresolvedTemplateLiteral(pkgDep.name)) {
            log(`[language-config] Skipping package with template literal name: ${pkgDep.name}`);
            continue;
          }

          const version = await extractPackageVersion(pkgDep.name, projectRoot);
          if (version) pkgDep.version = version;

          edges.push({
            target: normalizedResolvedPath,
            edgeType: 'imports',
            confidence: INFERRED,
            confidenceSource: CONFIDENCE_SOURCE_INFERRED,
            weight: 1,
            isPackage: true,
            packageName: pkgDep.name || undefined,
            packageVersion: pkgDep.version,
          });
        } else {
          try {
            await fsPromises.access(normalizedResolvedPath);
            edges.push({
              target: normalizedResolvedPath,
              edgeType: 'imports',
              confidence: INFERRED,
              confidenceSource: CONFIDENCE_SOURCE_INFERRED,
              weight: 1,
              isPackage: false,
            });
          } catch { /* file not found — skip */ }
        }
      } catch (resolveError) {
        log(`[language-config] Error resolving regex import '${importPath}' in ${filePath}: ${resolveError}`);
      }
    }

    return edges;
  };
}

// ─── Phase 26 readiness: AST extractor builder ────────────────────────────────

/**
 * Builds an extractor that tries a grammar-based AST approach first, falling back
 * to the provided regex extractor if the grammar fails to load.
 *
 * Phase 26 will plug real grammar-based extraction into the try block.
 * For now this path is not reachable — no registry entries use grammarLoader.
 *
 * The `grammarFailed` flag is per-entry (closure), so one bad grammar doesn't
 * affect other languages.
 */
function buildAstExtractor(
  loadGrammar: () => unknown,
  regexFallback: (f: string, c: string, r: string) => Promise<EdgeResult[]>
): (filePath: string, content: string, projectRoot: string) => Promise<EdgeResult[]> {
  let grammarFailed = false;
  return async (filePath: string, content: string, projectRoot: string): Promise<EdgeResult[]> => {
    if (grammarFailed) return regexFallback(filePath, content, projectRoot);
    try {
      const _grammar = loadGrammar();
      // Phase 26 will add actual AST extraction here using the grammar
      // For now this path is not reachable (no entries use grammarLoader)
      void _grammar;
      return regexFallback(filePath, content, projectRoot);
    } catch (err) {
      log(`[language-config] Grammar load failed for ${path.extname(filePath)}: ${err}. Falling back to regex.`);
      grammarFailed = true;
      return regexFallback(filePath, content, projectRoot);
    }
  };
}

// ─── Registry initialization ───────────────────────────────────────────────────

const registry = new Map<string, LanguageConfig>();

// TS/JS: delegate to existing ast-parser.ts extractSnapshot()
for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
  registry.set(ext, {
    grammarLoader: null,
    usesRegexFallback: false,
    extract: extractTsJsEdges,
  });
}

// Go: specialized resolver
registry.set('.go', {
  grammarLoader: null,
  usesRegexFallback: true,
  extract: extractGoEdges,
});

// Ruby: specialized resolver
registry.set('.rb', {
  grammarLoader: null,
  usesRegexFallback: true,
  extract: extractRubyEdges,
});

// All IMPORT_PATTERNS languages: generic regex extractor
// Covers: .py, .c, .cpp, .cc, .cxx, .h, .hpp, .hh, .hxx, .rs, .lua, .zig, .php, .cs, .java
// Populated lazily on first extractEdges() call to avoid circular import issues
// (file-utils.ts imports extractEdges, language-config.ts imports IMPORT_PATTERNS)
let _regexExtractorsLoaded = false;
function ensureRegexExtractors(): void {
  if (_regexExtractorsLoaded) return;
  _regexExtractorsLoaded = true;
  for (const ext of Object.keys(IMPORT_PATTERNS)) {
    if (!registry.has(ext)) {
      registry.set(ext, {
        grammarLoader: null,
        usesRegexFallback: true,
        extract: buildRegexExtractor(ext),
      });
    }
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Dispatches file extension to the correct extractor and returns enriched edge results.
 *
 * - .ts/.tsx/.js/.jsx → AST extraction (EXTRACTED confidence 1.0)
 * - .go → Go resolver (INFERRED confidence 0.8)
 * - .rb → Ruby resolver (INFERRED confidence 0.8)
 * - all IMPORT_PATTERNS languages → regex extractor (INFERRED confidence 0.8)
 * - unknown extension → empty array (no crash)
 *
 * @param filePath   Absolute path to the file being analyzed.
 * @param content    File contents (caller reads once to avoid double I/O).
 * @param projectRoot Absolute project root for resolving relative imports.
 * @returns Array of EdgeResult objects, each representing one dependency edge.
 */
export async function extractEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  ensureRegexExtractors();
  const ext = path.extname(filePath).toLowerCase();
  const config = registry.get(ext);
  if (!config) return [];
  try {
    return await config.extract(filePath, content, projectRoot);
  } catch (err) {
    log(`[language-config] extractEdges failed for ${filePath}: ${err}`);
    return [];
  }
}

// Export buildAstExtractor so Phase 26 can compose custom entries without modifying this file.
export { buildAstExtractor };
