// src/language-config.ts
// LanguageConfig registry: dispatches file extensions to the correct dependency extractor.
//
// Dispatch table:
//   .ts/.tsx/.js/.jsx  → extractTsJsEdges()     (AST via tree-sitter, confidence = EXTRACTED 1.0)
//   .py                → extractPythonEdges()    (AST via tree-sitter-python, confidence = EXTRACTED 1.0)
//   .rs                → extractRustEdges()      (AST via tree-sitter-rust, confidence = EXTRACTED 1.0)
//   .c/.h              → makeIncludeExtractor()  (AST via tree-sitter-c, confidence = EXTRACTED 1.0)
//   .cpp/.cc/etc       → makeIncludeExtractor()  (AST via tree-sitter-cpp, confidence = EXTRACTED 1.0)
//   .go                → extractGoEdges()        (specialized Go resolver, confidence = INFERRED 0.8)
//   .rb                → extractRubyEdges()      (specialized Ruby resolver, confidence = INFERRED 0.8)
//   all IMPORT_PATTERNS → buildRegexExtractor()  (generic regex, confidence = INFERRED 0.8)
//   unknown extension  → returns []
//
// After this module, all dependency extraction flows through extractEdges() and all
// edge writes use setEdges() with enriched metadata. This is the integration seam
// that makes Phase 26 a "just add grammar + registry entry" operation.

import * as path from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { createRequire } from 'node:module';
import { log } from './logger.js';
import { EXTRACTED, INFERRED, CONFIDENCE_SOURCE_EXTRACTED, CONFIDENCE_SOURCE_INFERRED } from './confidence.js';
import type { ConfidenceSource } from './confidence.js';
import { extractRicherEdges } from './change-detector/ast-parser.js';
import { relativizePath, absolutifyPath } from './file-utils.js';
import type { CallSiteEdge } from './change-detector/types.js';

const _require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Parser = _require('tree-sitter') as any;

// Grammar loading — each in a try/catch so one bad grammar doesn't block others
let PythonLang: unknown = null;
let RustLang: unknown = null;
let CLang: unknown = null;
let CppLang: unknown = null;
// Phase 36 MLS-02/MLS-03 — Go + Ruby grammars for symbol extraction (D-14, D-18).
// Note: Go edges still use regex via extractGoEdges (D-06 reversed only for symbols).
let GoLang: unknown = null;
let RubyLang: unknown = null;

try { PythonLang = _require('tree-sitter-python'); } catch (e) { log(`[language-config] Failed to load tree-sitter-python: ${e}`); }
try { RustLang = _require('tree-sitter-rust'); } catch (e) { log(`[language-config] Failed to load tree-sitter-rust: ${e}`); }
try { CLang = _require('tree-sitter-c'); } catch (e) { log(`[language-config] Failed to load tree-sitter-c: ${e}`); }
try { CppLang = _require('tree-sitter-cpp'); } catch (e) { log(`[language-config] Failed to load tree-sitter-cpp: ${e}`); }
try { GoLang = _require('tree-sitter-go'); } catch (e) { log(`[language-config] Failed to load tree-sitter-go: ${e}`); }
try { RubyLang = _require('tree-sitter-ruby'); } catch (e) { log(`[language-config] Failed to load tree-sitter-ruby: ${e}`); }

// Parser instances — one per grammar (parser is stateful)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createParser(lang: unknown): any | null {
  if (!lang) return null;
  try {
    const p = new Parser();
    p.setLanguage(lang);
    return p;
  } catch (e) {
    log(`[language-config] Failed to create parser: ${e}`);
    return null;
  }
}

const pythonParser = createParser(PythonLang);
const rustParser = createParser(RustLang);
const cParser = createParser(CLang);
const cppParser = createParser(CppLang);
// Phase 36 MLS-02/MLS-03 — eager module-level singletons (D-04 one-parse-per-call invariant).
const goParser = createParser(GoLang);
const rubyParser = createParser(RubyLang);
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
// Phase 36 MLS-01..03 — Symbol/SymbolKind for per-language symbol extractors.
import type { Symbol, SymbolKind } from './db/symbol-types.js';

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
  /** Raw import specifier string (e.g. './utils.js', 'react'). Phase 33 IMP-03. */
  originalSpecifier?: string;
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

// ─── Python AST extractor ─────────────────────────────────────────────────────

async function handlePythonModule(
  moduleName: string,
  filePath: string,
  projectRoot: string,
  edges: EdgeResult[]
): Promise<void> {
  void projectRoot; // projectRoot reserved for future use (e.g. resolve installed packages)
  if (!moduleName || moduleName === '.') return;
  // Relative import: starts with '.'
  if (moduleName.startsWith('.')) {
    const resolved = path.resolve(path.dirname(filePath), moduleName);
    const normalized = normalizePath(resolved);
    try {
      await fsPromises.access(normalized);
      edges.push({
        target: normalized,
        edgeType: 'imports',
        confidence: EXTRACTED,
        confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
        weight: 1,
        isPackage: false,
      });
    } catch { /* file not found — skip */ }
  } else {
    // Absolute module: package dependency
    const topLevel = moduleName.split('.')[0];
    const resolved = path.resolve(path.dirname(filePath), moduleName);
    const normalized = normalizePath(resolved);
    edges.push({
      target: normalized,
      edgeType: 'imports',
      confidence: EXTRACTED,
      confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
      weight: 1,
      isPackage: true,
      packageName: topLevel,
    });
  }
}

async function extractPythonEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree = (pythonParser as any).parse(content);
  const edges: EdgeResult[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visitNode(node: any): void {
    if (node.type === 'import_statement') {
      // "import os" or "import os, json" — multiple dotted_name/aliased_import children
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        const moduleName: string = child.type === 'aliased_import'
          ? (child.childForFieldName('name')?.text ?? '')
          : child.text;
        if (moduleName) {
          void handlePythonModule(moduleName, filePath, projectRoot, edges);
        }
      }
    } else if (node.type === 'import_from_statement') {
      const modNameNode = node.childForFieldName('module_name');
      if (modNameNode) {
        void handlePythonModule(modNameNode.text as string, filePath, projectRoot, edges);
      }
    }
    for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
  }

  visitNode(tree.rootNode);
  // Collect all async handlePythonModule calls — they were fired with void, edges are pushed synchronously
  // for package imports. For relative imports we do fsPromises.access, but they are not awaited above.
  // Re-implement with proper async collection:
  const asyncEdgePromises: Promise<void>[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visitNodeAsync(node: any): void {
    if (node.type === 'import_statement') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        const moduleName: string = child.type === 'aliased_import'
          ? (child.childForFieldName('name')?.text ?? '')
          : child.text;
        if (moduleName) asyncEdgePromises.push(handlePythonModule(moduleName, filePath, projectRoot, edges));
      }
    } else if (node.type === 'import_from_statement') {
      const modNameNode = node.childForFieldName('module_name');
      if (modNameNode) {
        asyncEdgePromises.push(handlePythonModule(modNameNode.text as string, filePath, projectRoot, edges));
      }
    }
    for (let i = 0; i < node.childCount; i++) visitNodeAsync(node.child(i));
  }

  edges.length = 0; // clear the void-fired edges
  visitNodeAsync(tree.rootNode);
  await Promise.all(asyncEdgePromises);
  return edges;
}

// ─── Python symbol extractor (MLS-01) ─────────────────────────────────────────

/**
 * Phase 36 MLS-01 — extract top-level Python symbols from a single parser pass.
 *
 * Scope (per D-10 / Pitfall 3): visit ONLY direct children of the root `module`
 * node — no nested methods or nested classes. One `pythonParser.parse()` call
 * per invocation (D-04 single-pass invariant).
 *
 * Node handling:
 * - `function_definition` + `async_function_definition` → kind='function'
 *   (D-11 defensive — current grammar emits `function_definition` with an
 *   `async` keyword child; the `async_function_definition` branch is a no-op
 *   today but future-proofs against grammar change).
 * - `class_definition` → kind='class'.
 * - `decorated_definition` → startLine from the outer node (decorator line per
 *   D-12 / Pitfall 2), name + kind from the inner function/class.
 *
 * `isExport` rule (D-13): `!name.startsWith('_')` — single-underscore and
 * dunder names are non-exported. `__all__` handling deferred to v1.8 (MLS-META-02).
 */
export function extractPythonSymbols(_filePath: string, content: string): Symbol[] {
  if (!pythonParser) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree = (pythonParser as any).parse(content);   // ← exactly ONE parse call (D-04)
  const out: Symbol[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.namedChildCount; i++) {     // D-10: top-level only
    const node = root.namedChild(i);

    if (node.type === 'function_definition' || node.type === 'async_function_definition') {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (!name) continue;
      out.push({
        name,
        kind: 'function',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExport: !name.startsWith('_'),                // D-13
      });
    } else if (node.type === 'class_definition') {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (!name) continue;
      out.push({
        name,
        kind: 'class',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExport: !name.startsWith('_'),
      });
    } else if (node.type === 'decorated_definition') {
      // D-12 / Pitfall 2 — startLine from the decorated_definition (outer), name
      // + kind from the inner declaration. Decorator line, NOT def line.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let inner: any = null;
      for (let j = 0; j < node.namedChildCount; j++) {
        const c = node.namedChild(j);
        if (c.type === 'function_definition' ||
            c.type === 'async_function_definition' ||
            c.type === 'class_definition') {
          inner = c;
          break;
        }
      }
      if (!inner) continue;
      const name = inner.childForFieldName('name')?.text as string | undefined;
      if (!name) continue;
      const kind: SymbolKind = inner.type === 'class_definition' ? 'class' : 'function';
      out.push({
        name,
        kind,
        startLine: node.startPosition.row + 1,          // decorator line (Pitfall 2)
        endLine: node.endPosition.row + 1,
        isExport: !name.startsWith('_'),
      });
    }
  }
  return out;
}

// ─── Rust AST extractor ────────────────────────────────────────────────────────

async function handleRustUse(
  usePath: string,
  filePath: string,
  projectRoot: string,
  edges: EdgeResult[]
): Promise<void> {
  void projectRoot;
  if (!usePath) return;
  const isLocal =
    usePath.startsWith('crate::') ||
    usePath.startsWith('super::') ||
    usePath.startsWith('self::');

  if (isLocal) {
    let localPath = usePath;
    if (usePath.startsWith('crate::')) {
      localPath = usePath.slice('crate::'.length);
    } else if (usePath.startsWith('super::')) {
      localPath = usePath.slice('super::'.length);
    } else if (usePath.startsWith('self::')) {
      localPath = usePath.slice('self::'.length);
    }
    const fsPath = localPath.replace(/::/g, '/');
    const candidate = path.join(path.dirname(filePath), fsPath + '.rs');
    const normalized = normalizePath(candidate);
    try {
      await fsPromises.access(normalized);
      edges.push({
        target: normalized,
        edgeType: 'imports',
        confidence: EXTRACTED,
        confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
        weight: 1,
        isPackage: false,
      });
    } catch {
      // Try without .rs (might be a module directory)
      const dirCandidate = path.join(path.dirname(filePath), fsPath, 'mod.rs');
      const normalizedDir = normalizePath(dirCandidate);
      try {
        await fsPromises.access(normalizedDir);
        edges.push({
          target: normalizedDir,
          edgeType: 'imports',
          confidence: EXTRACTED,
          confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
          weight: 1,
          isPackage: false,
        });
      } catch { /* not found — skip */ }
    }
  } else {
    // External crate
    const packageName = usePath.split('::')[0];
    edges.push({
      target: usePath,
      edgeType: 'imports',
      confidence: EXTRACTED,
      confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
      weight: 1,
      isPackage: true,
      packageName,
    });
  }
}

async function handleRustMod(
  modName: string,
  filePath: string,
  _projectRoot: string,
  edges: EdgeResult[]
): Promise<void> {
  // mod utils; → look for utils.rs or utils/mod.rs relative to current file dir
  const dir = path.dirname(filePath);
  const candidate1 = normalizePath(path.join(dir, modName + '.rs'));
  const candidate2 = normalizePath(path.join(dir, modName, 'mod.rs'));

  for (const candidate of [candidate1, candidate2]) {
    try {
      await fsPromises.access(candidate);
      edges.push({
        target: candidate,
        edgeType: 'imports',
        confidence: EXTRACTED,
        confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
        weight: 1,
        isPackage: false,
      });
      return; // found first match
    } catch { /* try next */ }
  }
}

async function extractRustEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree = (rustParser as any).parse(content);
  const edges: EdgeResult[] = [];
  const asyncPromises: Promise<void>[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visitNode(node: any): void {
    if (node.type === 'use_declaration') {
      const argNode = node.childForFieldName('argument');
      if (argNode) asyncPromises.push(handleRustUse(argNode.text as string, filePath, projectRoot, edges));
    } else if (node.type === 'mod_item') {
      const nameNode = node.childForFieldName('name');
      if (nameNode && !node.childForFieldName('body')) {
        asyncPromises.push(handleRustMod(nameNode.text as string, filePath, projectRoot, edges));
      }
    } else if (node.type === 'extern_crate_declaration') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) {
        edges.push({
          target: nameNode.text as string,
          edgeType: 'imports',
          confidence: EXTRACTED,
          confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
          weight: 1,
          isPackage: true,
          packageName: nameNode.text as string,
        });
      }
    }
    for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
  }

  visitNode(tree.rootNode);
  await Promise.all(asyncPromises);
  return edges;
}

// ─── C/C++ include extractor factory ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeIncludeExtractor(parser: any) {
  return async function extractIncludeEdges(
    filePath: string,
    content: string,
    _projectRoot: string
  ): Promise<EdgeResult[]> {
    const tree = parser.parse(content);
    const edges: EdgeResult[] = [];
    const asyncPromises: Promise<void>[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function visitNode(node: any): void {
      if (node.type === 'preproc_include') {
        const pathNode = node.childForFieldName('path');
        if (pathNode) {
          if (pathNode.type === 'system_lib_string') {
            // <stdio.h> — system include
            const name = (pathNode.text as string).slice(1, -1); // strip < >
            edges.push({
              target: name,
              edgeType: 'imports',
              confidence: EXTRACTED,
              confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
              weight: 1,
              isPackage: true,
              packageName: name,
            });
          } else if (pathNode.type === 'string_literal') {
            // "myfile.h" — local include
            const rawPath = (pathNode.text as string).slice(1, -1); // strip quotes
            const resolved = path.resolve(path.dirname(filePath), rawPath);
            const normalized = normalizePath(resolved);
            asyncPromises.push(
              fsPromises.access(normalized).then(() => {
                edges.push({
                  target: normalized,
                  edgeType: 'imports',
                  confidence: EXTRACTED,
                  confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
                  weight: 1,
                  isPackage: false,
                });
              }).catch(() => { /* file not found — skip */ })
            );
          }
        }
      }
      for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
    }

    visitNode(tree.rootNode);
    await Promise.all(asyncPromises);
    return edges;
  };
}

// ─── TS/JS AST extractor ───────────────────────────────────────────────────────

/**
 * Resolves a single TS/JS import path to an EdgeResult with the given edgeType.
 * Handles package vs. local resolution, multi-extension probing for local files.
 * Returns null if the import cannot be resolved (template literal, file not found, error).
 */
async function resolveTsJsImport(
  importPath: string,
  filePath: string,
  projectRoot: string,
  edgeType: string
): Promise<EdgeResult | null> {
  if (isUnresolvedTemplateLiteral(importPath)) return null;

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

      if (isUnresolvedTemplateLiteral(pkgDep.name)) return null;

      const version = await extractPackageVersion(pkgDep.name, projectRoot);

      return {
        target: normalizedResolvedPath,
        edgeType,
        confidence: EXTRACTED,
        confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
        weight: 1,
        isPackage: true,
        packageName: pkgDep.name || undefined,
        packageVersion: version,
      };
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
        return {
          target: resolvedTarget,
          edgeType,
          confidence: EXTRACTED,
          confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
          weight: 1,
          isPackage: false,
        };
      }
      return null;
    }
  } catch (resolveError) {
    log(`[language-config] Error resolving TS/JS import '${importPath}' in ${filePath}: ${resolveError}`);
    return null;
  }
}

/**
 * Extracts dependency edges from a TypeScript/JavaScript file using the AST.
 * Delegates to extractRicherEdges() from ast-parser.ts, then resolves and classifies
 * each import path into local (EdgeResult.isPackage=false) or package edges.
 *
 * Produces three edge types:
 * - 'imports'    — regular import_statement and require() calls
 * - 're_exports' — export_statement nodes with a source (re-exports from another module)
 * - 'inherits'   — class extends clause where the base class is imported from another file
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
  const richer = extractRicherEdges(filePath, content);
  if (!richer) return [];

  log(`[language-config] [AST] Found ${richer.regularImports.length} imports, ${richer.reExportSources.length} re-exports, ${richer.inheritsFrom.length} inherits, ${richer.symbols.length} symbols in ${filePath}`);

  const edges: EdgeResult[] = [];

  // Regular imports — thread raw specifier through EdgeResult (Phase 33 IMP-03)
  for (const imp of richer.regularImports) {
    const edge = await resolveTsJsImport(imp, filePath, projectRoot, 'imports');
    if (edge) edges.push({ ...edge, originalSpecifier: imp });
  }

  // Re-exports
  for (const src of richer.reExportSources) {
    const edge = await resolveTsJsImport(src, filePath, projectRoot, 're_exports');
    if (edge) edges.push({ ...edge, originalSpecifier: src });
  }

  // Inherits (cross-file class extends)
  for (const { sourceSpecifier } of richer.inheritsFrom) {
    const edge = await resolveTsJsImport(sourceSpecifier, filePath, projectRoot, 'inherits');
    if (edge) edges.push({ ...edge, originalSpecifier: sourceSpecifier });
  }

  return edges;
}

/**
 * Phase 33 SYM-02/SYM-04 — returns edges, symbols, and importMeta from a single
 * extractRicherEdges() call. Callers that need the parser's symbol output (coordinator,
 * file-watcher, future bulk-extraction gate) use this instead of extractTsJsEdges to
 * avoid re-parsing.
 * Returns null for non-TS/JS files so callers can fall back to extractEdges().
 */
export async function extractTsJsFileParse(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<{
  edges: EdgeResult[];
  symbols: import('./db/symbol-types.js').Symbol[];
  importMeta: import('./change-detector/ast-parser.js').ImportMeta[];
  callSiteEdges: CallSiteEdge[];   // Phase 37 CSE-03 — resolved call-site edges
} | null> {
  const richer = extractRicherEdges(filePath, content);
  if (!richer) return null;

  const edges: EdgeResult[] = [];

  for (const imp of richer.regularImports) {
    const edge = await resolveTsJsImport(imp, filePath, projectRoot, 'imports');
    if (edge) edges.push({ ...edge, originalSpecifier: imp });
  }
  for (const src of richer.reExportSources) {
    const edge = await resolveTsJsImport(src, filePath, projectRoot, 're_exports');
    if (edge) edges.push({ ...edge, originalSpecifier: src });
  }
  for (const { sourceSpecifier } of richer.inheritsFrom) {
    const edge = await resolveTsJsImport(sourceSpecifier, filePath, projectRoot, 'inherits');
    if (edge) edges.push({ ...edge, originalSpecifier: sourceSpecifier });
  }

  // Phase 37 CSE-03 — call-site resolution pass.
  // Builds localSymbolIndex (from this file's symbols[] — D-10)
  // and importedSymbolIndex (from a single batch DB query — D-11, D-32).

  // 3a. Local index — first-match-wins on duplicate names (D-10).
  const localSymbolIndex = new Map<string, import('./db/symbol-types.js').Symbol>();
  for (const sym of richer.symbols) {
    if (!localSymbolIndex.has(sym.name)) localSymbolIndex.set(sym.name, sym);
  }

  // 3b. Reuse already-resolved edges to build spec → targetPath map (Item 6 caching).
  // `edges` already contains resolved absolute target paths for local imports.
  // Avoids redundant fsPromises.access calls from re-running resolveTsJsImport.
  const specToTargetPath = new Map<string, string>();
  for (const edge of edges) {
    if (edge.originalSpecifier && !edge.isPackage) {
      specToTargetPath.set(edge.originalSpecifier, edge.target);
    }
  }

  // 3c. Barrel-file detector (D-13 / Pitfall 11).
  const BARREL_RE = /[\\/]index\.(ts|tsx|js|mjs|cjs|jsx)$/;

  // 3d. Collect unique non-barrel target paths from importMeta entries with importedNames.
  const targetPathsSet = new Set<string>();
  for (const meta of richer.importMeta) {
    const t = specToTargetPath.get(meta.specifier);
    if (!t) continue;                 // package or unresolved — skip
    if (BARREL_RE.test(t)) continue;  // barrel — silent discard (D-13)
    targetPathsSet.add(t);
  }
  const targetPaths = Array.from(targetPathsSet);

  // 3e. Single batch query — chunked at 500 per getFilesByPaths precedent.
  // The symbols table stores paths relative to projectRoot (host portability);
  // translate the absolute targetPaths down for the query, then absolutify the
  // returned rows so the downstream comparison `r.path === targetPath` matches.
  type SymbolRow = { id: number; name: string; path: string };
  const allSymbolRows: SymbolRow[] = [];
  if (targetPaths.length > 0) {
    const { getSqlite } = await import('./db/db.js');
    const sqlite = getSqlite();
    const CHUNK = 500;
    const relTargetPaths = targetPaths.map(p => relativizePath(p, projectRoot));
    for (let i = 0; i < relTargetPaths.length; i += CHUNK) {
      const chunk = relTargetPaths.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(', ');
      const rows = sqlite
        .prepare(`SELECT id, name, path FROM symbols WHERE path IN (${placeholders})`)
        .all(...chunk) as SymbolRow[];
      for (const r of rows) {
        allSymbolRows.push({ ...r, path: absolutifyPath(r.path, projectRoot) });
      }
    }
  }

  // 3f. Build importedSymbolIndex with Pitfall 10 ambiguity defense.
  // Key = imported name. Value = { path }. Ambiguous names are removed.
  const importedSymbolIndex = new Map<string, { path: string }>();
  const ambiguousNames = new Set<string>();
  for (const meta of richer.importMeta) {
    const targetPath = specToTargetPath.get(meta.specifier);
    if (!targetPath) continue;
    if (BARREL_RE.test(targetPath)) continue;  // barrel — skip per D-13
    for (const importedName of meta.importedNames) {
      if (importedName === '*' || importedName === 'default') continue;
      const match = allSymbolRows.find(r => r.path === targetPath && r.name === importedName);
      if (!match) continue;
      if (ambiguousNames.has(importedName)) continue;  // already flagged ambiguous
      if (importedSymbolIndex.has(importedName)) {
        const prev = importedSymbolIndex.get(importedName)!;
        if (prev.path !== targetPath) {
          // Pitfall 10: same name imported from different files — silent discard.
          importedSymbolIndex.delete(importedName);
          ambiguousNames.add(importedName);
          continue;
        }
      }
      importedSymbolIndex.set(importedName, { path: targetPath });
    }
  }

  // 3g. Resolve each CallSiteCandidate → CallSiteEdge (D-12 resolution order).
  const callSiteEdges: CallSiteEdge[] = [];
  for (const c of richer.callSiteCandidates) {
    // Step 1: local (confidence 1.0)
    if (localSymbolIndex.has(c.calleeName)) {
      callSiteEdges.push({
        callerName:      c.callerName,
        callerStartLine: c.callerStartLine,
        calleePath:      filePath,
        calleeName:      c.calleeName,
        callLine:        c.callLine,
        confidence:      1.0,
      });
      continue;
    }
    // Step 2: imported unambiguous (confidence 0.8)
    const imp = importedSymbolIndex.get(c.calleeName);
    if (imp) {
      callSiteEdges.push({
        callerName:      c.callerName,
        callerStartLine: c.callerStartLine,
        calleePath:      imp.path,
        calleeName:      c.calleeName,
        callLine:        c.callLine,
        confidence:      0.8,
      });
      continue;
    }
    // Step 3: unresolvable → silent discard (D-12 step 3).
  }

  return { edges, symbols: richer.symbols, importMeta: richer.importMeta, callSiteEdges };
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

// ─── Go symbol extractor (MLS-02) ─────────────────────────────────────────────

/**
 * Phase 36 MLS-02 — extract top-level Go symbols from a single parser pass.
 * Note: Go edges still use regex via extractGoEdges. This function is a
 * SYMBOLS-only AST pass (D-06 REVERSED per D-14). One `goParser.parse()` call.
 *
 * Node handling (D-15/D-16):
 * - `function_declaration` → kind='function' (name type `identifier`).
 * - `method_declaration` → kind='function' (name type `field_identifier`;
 *   Pitfall 4 — use childForFieldName('name'), NOT type-filter).
 * - `type_declaration` → iterate namedChildren:
 *     - `type_spec` with inner `struct_type` → kind='struct' (D-06 new kind).
 *     - `type_spec` with inner `interface_type` → kind='interface'.
 *     - `type_spec` with any other inner → kind='type'.
 *     - `type_alias` (e.g., `type MyAlias = int`) → kind='type'.
 * - `const_declaration` → emit one symbol per `const_spec` (D-16).
 *
 * `isExport` (D-17): first ASCII char uppercase ([65..90]).
 */
export function extractGoSymbols(_filePath: string, content: string): Symbol[] {
  if (!goParser) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree = (goParser as any).parse(content);      // ← exactly ONE parse call (D-04)
  const out: Symbol[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);

    if (node.type === 'function_declaration') {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (!name) continue;
      out.push({
        name,
        kind: 'function',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExport: isGoExported(name),
      });
    } else if (node.type === 'method_declaration') {
      // D-07: method → 'function'. Pitfall 4: name field is `field_identifier`,
      // not `identifier`. childForFieldName('name') is type-agnostic.
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (!name) continue;
      out.push({
        name,
        kind: 'function',
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        isExport: isGoExported(name),
      });
    } else if (node.type === 'type_declaration') {
      // type_declaration may have multiple type_spec children (rare — `type (...)` blocks).
      for (let j = 0; j < node.namedChildCount; j++) {
        const spec = node.namedChild(j);
        if (spec.type === 'type_alias') {
          const name = spec.childForFieldName('name')?.text as string | undefined;
          if (!name) continue;
          out.push({
            name,
            kind: 'type',
            startLine: spec.startPosition.row + 1,
            endLine: spec.endPosition.row + 1,
            isExport: isGoExported(name),
          });
        } else if (spec.type === 'type_spec') {
          const nameNode = spec.childForFieldName('name');
          const name = nameNode?.text as string | undefined;
          if (!name) continue;
          // Find the inner "body" child — the namedChild that is not the name node.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let inner: any = null;
          for (let k = 0; k < spec.namedChildCount; k++) {
            const c = spec.namedChild(k);
            if (c !== nameNode) { inner = c; break; }
          }
          let kind: SymbolKind = 'type';
          if (inner?.type === 'struct_type') kind = 'struct';
          else if (inner?.type === 'interface_type') kind = 'interface';
          out.push({
            name,
            kind,
            startLine: spec.startPosition.row + 1,
            endLine: spec.endPosition.row + 1,
            isExport: isGoExported(name),
          });
        }
      }
    } else if (node.type === 'const_declaration') {
      // D-16: emit one symbol per const_spec. First named child of const_spec
      // is the identifier (verified 2026-04-24 live probe).
      for (let j = 0; j < node.namedChildCount; j++) {
        const spec = node.namedChild(j);
        if (spec.type !== 'const_spec') continue;
        const idNode = spec.namedChild(0);
        const name = idNode?.text as string | undefined;
        if (!name) continue;
        out.push({
          name,
          kind: 'const',
          startLine: spec.startPosition.row + 1,
          endLine: spec.endPosition.row + 1,
          isExport: isGoExported(name),
        });
      }
    }
  }
  return out;
}

/** Go export rule (D-17): first ASCII char uppercase. */
function isGoExported(name: string): boolean {
  if (name.length === 0) return false;
  const c = name.charCodeAt(0);
  return c >= 65 && c <= 90;   // 'A'..'Z' ASCII
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

// ─── Ruby symbol extractor (MLS-03) ───────────────────────────────────────────

/**
 * Phase 36 MLS-03 — extract top-level Ruby symbols from a single parser pass.
 * One `rubyParser.parse()` call (D-04).
 *
 * Scope (per D-19): visit ONLY direct children of the root `program` node.
 * Nested methods inside classes are NOT emitted — top-level only.
 *
 * Node handling:
 * - `method` + `singleton_method` → kind='function' (D-07).
 * - `class` → kind='class'. Name node is `constant` (e.g., `Foo`) OR
 *   `scope_resolution` (e.g., `Foo::Bar`). Use `.text` either way — this
 *   yields the full qualified name (D-22 note).
 * - `module` → kind='module' (D-06 new SymbolKind).
 * - `assignment` where `left` is a `constant` node → kind='const' (D-08).
 *   Plain identifier assignments (lowercase variables) are NOT emitted.
 *
 * `isExport`: always `true` (D-21 — Ruby has no export keyword; visibility
 * modifiers are deferred to v1.8 MLS-META-03).
 *
 * Deliberate non-emissions (Pitfall 5 / D-20): `attr_accessor`, `attr_reader`,
 * `attr_writer` — these are method calls that SYNTHESIZE methods at runtime,
 * not AST declarations. Documented as a find_symbol limitation (D-29).
 *
 * Reopened classes (Pitfall 6 / D-22): multiple `class Foo` blocks in the same
 * file produce multiple Symbol rows with identical name + kind and different
 * startLines — intentional; find_symbol callers filter by filePath.
 */
export function extractRubySymbols(_filePath: string, content: string): Symbol[] {
  if (!rubyParser) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tree = (rubyParser as any).parse(content);    // ← exactly ONE parse call (D-04)
  const out: Symbol[] = [];
  const root = tree.rootNode;   // type === 'program'

  for (let i = 0; i < root.namedChildCount; i++) {
    const node = root.namedChild(i);
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    if (node.type === 'method' || node.type === 'singleton_method') {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (!name) continue;
      out.push({ name, kind: 'function', startLine, endLine, isExport: true });  // D-21
    } else if (node.type === 'class') {
      const nameNode = node.childForFieldName('name');
      if (!nameNode) continue;
      // nameNode.type is either `constant` ("Foo") or `scope_resolution`
      // ("Foo::Bar"). .text gives the full qualified name (D-22).
      const name = nameNode.text as string;
      out.push({ name, kind: 'class', startLine, endLine, isExport: true });
    } else if (node.type === 'module') {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (!name) continue;
      out.push({ name, kind: 'module', startLine, endLine, isExport: true });   // D-06
    } else if (node.type === 'assignment') {
      // D-08: only emit when lhs is a `constant` (Ruby-uppercase name).
      // Plain `my_var = 42` has lhs type `identifier` and is NOT emitted.
      const left = node.childForFieldName('left');
      if (left?.type === 'constant') {
        out.push({
          name: left.text as string,
          kind: 'const',
          startLine,
          endLine,
          isExport: true,
        });
      }
    }
  }
  return out;
}

// ─── Non-TS/JS file-parse dispatcher (MLS-04) ─────────────────────────────────

/**
 * Phase 36 MLS-04 — dispatcher for Python / Go / Ruby file parsing, returning
 * edges + symbols together. Mirror of extractTsJsFileParse but for non-TS/JS
 * AST-backed languages.
 *
 * Contract (D-05):
 * - `.py` / `.go` / `.rb` → `{ edges, symbols }` (importMeta intentionally
 *   omitted — v1.7 carries `imported_names` only for TS/JS).
 * - Any other extension → `null` (callers fall back to extractEdges()).
 *
 * Calls the per-language edge extractor AND the per-language symbol extractor.
 * For Go/Ruby the edge extraction stays on regex (resolveGoImports /
 * resolveRubyImports) while the symbol extractor uses the tree-sitter AST —
 * a two-pass-per-file pattern, but each function still makes ≤ 1 parser.parse()
 * call (single-pass invariant, D-31/Pitfall 14).
 */
export async function extractLangFileParse(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<{
  edges: EdgeResult[];
  symbols: Symbol[];
  importMeta?: import('./change-detector/ast-parser.js').ImportMeta[];
} | null> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.py') {
    const edges = await extractPythonEdges(filePath, content, projectRoot);
    const symbols = extractPythonSymbols(filePath, content);
    return { edges, symbols };
  }
  if (ext === '.go') {
    const edges = await extractGoEdges(filePath, content, projectRoot);
    const symbols = extractGoSymbols(filePath, content);
    return { edges, symbols };
  }
  if (ext === '.rb') {
    const edges = await extractRubyEdges(filePath, content, projectRoot);
    const symbols = extractRubySymbols(filePath, content);
    return { edges, symbols };
  }
  return null;
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

// TS/JS: delegate to extractTsJsEdges() which uses extractRicherEdges() from ast-parser.ts
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

// Python: AST extractor (with regex fallback if grammar failed to load)
if (pythonParser) {
  registry.set('.py', {
    grammarLoader: () => PythonLang,
    usesRegexFallback: false,
    extract: extractPythonEdges,
  });
}

// Rust: AST extractor
if (rustParser) {
  registry.set('.rs', {
    grammarLoader: () => RustLang,
    usesRegexFallback: false,
    extract: extractRustEdges,
  });
}

// C: AST extractor (for .c, .h)
if (cParser) {
  const extractCEdges = makeIncludeExtractor(cParser);
  for (const ext of ['.c', '.h']) {
    registry.set(ext, {
      grammarLoader: () => CLang,
      usesRegexFallback: false,
      extract: extractCEdges,
    });
  }
}

// C++: AST extractor (for .cpp, .cc, .cxx, .hpp, .hh, .hxx)
if (cppParser) {
  const extractCppEdges = makeIncludeExtractor(cppParser);
  for (const ext of ['.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx']) {
    registry.set(ext, {
      grammarLoader: () => CppLang,
      usesRegexFallback: false,
      extract: extractCppEdges,
    });
  }
}

// All IMPORT_PATTERNS languages not yet registered: generic regex extractor
// Covers: .lua, .zig, .php, .cs, .java (Python, C, C++, Rust are handled by AST above)
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

  let rawEdges: EdgeResult[];
  try {
    rawEdges = await config.extract(filePath, content, projectRoot);
  } catch (err) {
    log(`[language-config] extractEdges failed for ${filePath}: ${err}`);
    return [];
  }

  // Aggregate duplicate targets by summing weights (legacy language behavior).
  // EXCEPT: edges that carry `originalSpecifier` (TS/JS — D-08) stay as separate rows
  // so each import_line / imported_names is preserved precisely.
  const accumulator = new Map<string, EdgeResult>();
  const preserved: EdgeResult[] = [];
  for (const edge of rawEdges) {
    if (edge.originalSpecifier !== undefined) {
      preserved.push(edge);
      continue;
    }
    const key = `${edge.target}\x00${edge.edgeType}`;
    const existing = accumulator.get(key);
    if (existing) {
      existing.weight += edge.weight;
    } else {
      accumulator.set(key, { ...edge });
    }
  }
  return [...Array.from(accumulator.values()), ...preserved];
}

// Export buildAstExtractor and buildRegexExtractor for tests and external composition.
export { buildAstExtractor, buildRegexExtractor };
