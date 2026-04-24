// src/change-detector/ast-parser.ts
// Tree-sitter CST extraction for TypeScript/JavaScript files.
// Extracts exported symbols and import paths from TS/JS source using AST queries
// (replaces regex-based import parsing for TS/JS — CHNG-04).
//
// Uses createRequire to load CJS tree-sitter packages from ESM context.
// Same pattern as better-sqlite3 in src/db/db.ts.
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { log } from '../logger.js';
import type { ExportSnapshot, ExportedSymbol, CallSiteCandidate } from './types.js';
import type { Symbol, SymbolKind } from '../db/symbol-types.js';

const _require = createRequire(import.meta.url);

// Load tree-sitter parser engine (CJS package with native .node addon)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Parser = _require('tree-sitter') as any;

// Load TypeScript and TSX grammars from tree-sitter-typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { typescript: TypeScriptLang, tsx: TSXLang } = _require('tree-sitter-typescript') as {
  typescript: unknown;
  tsx: unknown;
};

// Load JavaScript grammar (handles .js and .jsx)
const JavaScriptLang = _require('tree-sitter-javascript') as unknown;

// Create one parser instance per grammar — parser is stateful (holds last parse)
// so we instantiate separate parsers to avoid grammar-switching overhead.
const tsParser = new Parser();
tsParser.setLanguage(TypeScriptLang);

const tsxParser = new Parser();
tsxParser.setLanguage(TSXLang);

const jsParser = new Parser();
jsParser.setLanguage(JavaScriptLang);

// ─── Language dispatch ─────────────────────────────────────────────────────

/**
 * Returns true for file extensions supported by tree-sitter (TS/JS family).
 * All other extensions use regex-based import parsing.
 */
export function isTreeSitterLanguage(ext: string): boolean {
  return ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx';
}

function getParser(filePath: string): typeof tsParser | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':  return tsParser;
    case '.tsx': return tsxParser;
    case '.js':
    case '.jsx': return jsParser;
    default:     return null;
  }
}

// ─── Kind mapping ──────────────────────────────────────────────────────────

/**
 * Maps tree-sitter node types to ExportedSymbol kinds.
 */
function nodeTypeToKind(nodeType: string): ExportedSymbol['kind'] {
  switch (nodeType) {
    case 'function_declaration':
    case 'generator_function_declaration':
    case 'function':
    case 'generator_function':
    case 'arrow_function':
      return 'function';
    case 'class_declaration':
    case 'class':
      return 'class';
    case 'lexical_declaration':
    case 'variable_declaration':
      return 'variable';
    case 'type_alias_declaration':
      return 'type';
    case 'interface_declaration':
      return 'interface';
    case 'enum_declaration':
      return 'enum';
    default:
      return 'variable';
  }
}

/**
 * Extracts the signature line from a declaration node.
 * Returns the first line of the node's text (the declaration header, not body).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSignature(node: any, source: string): string {
  // For declarations that have a body (functions, classes), extract just the header.
  // We take the text up to the opening brace '{' or the end of the line.
  const fullText: string = node.text ?? source.slice(node.startIndex, node.endIndex);
  // Take first line only (handles multiline declarations)
  const firstLine = fullText.split('\n')[0].trim();
  // Truncate at '{' if present to omit the body
  const braceIdx = firstLine.indexOf('{');
  if (braceIdx > 0) {
    return firstLine.slice(0, braceIdx).trim();
  }
  return firstLine;
}

// ─── Richer edge extraction ────────────────────────────────────────────────

/**
 * Per-import metadata emitted during the same AST walk as regularImports.
 * One entry per `import_statement` node (NOT deduplicated by specifier — see D-08).
 * `importedNames` uses the original exported name, not any local alias (verified via runtime probe).
 */
export interface ImportMeta {
  /** Raw source specifier string (e.g. './utils.js', 'react'). */
  specifier: string;
  /** Array of imported names. Values: original named-import identifiers, 'default', or '*' for namespace imports. */
  importedNames: string[];
  /** 1-indexed source line of the import_statement. */
  line: number;
}

/**
 * Richer edge classification for dependency extraction.
 * Used by extractTsJsEdges() in language-config.ts for edge type categorization.
 */
export interface RicherEdgeData {
  /** Raw import specifiers from import_statement and require() nodes */
  regularImports: string[];
  /** Raw specifiers from export_statement nodes that have a source field (re-exports) */
  reExportSources: string[];
  /** className + sourceSpecifier pairs from extends_clause where class is imported from another file */
  inheritsFrom: Array<{ className: string; sourceSpecifier: string }>;
  // Phase 33 additions — same AST walk as edges.
  /** Top-level navigable symbols (SYM-01). */
  symbols:    Symbol[];
  /** Per-import-statement metadata (IMP-01, IMP-02). */
  importMeta: ImportMeta[];
  // Phase 37 addition — call-site candidates emitted during the same visitNode walk.
  /** Pre-resolution call-site records (CSE-02). Resolved by language-config.extractTsJsFileParse(). */
  callSiteCandidates: CallSiteCandidate[];
}

/**
 * Builds a map from imported name to source specifier for a single import_statement.
 * Handles named imports, default imports, and namespace imports.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildImportNameMap(importNode: any, sourceSpecifier: string, map: Map<string, string>): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any): void {
    if (node.type === 'import_specifier') {
      // Named import: import { Foo } from './mod'
      const nameNode = node.childForFieldName('name');
      if (nameNode) map.set(nameNode.text as string, sourceSpecifier);
    } else if (node.type === 'identifier' && node.parent?.type === 'import_clause') {
      // Default import: import Foo from './mod'
      map.set(node.text as string, sourceSpecifier);
    } else if (node.type === 'namespace_import') {
      // Namespace import: import * as Foo from './mod'
      const nameNode = node.childForFieldName('name');
      if (nameNode) map.set(nameNode.text as string, sourceSpecifier);
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  }
  walk(importNode);
}

/**
 * Returns the list of imported names for an import_statement.
 * - Named imports:     original exported name (e.g. `foo` for `import { foo as bar }`)
 * - Default imports:   literal string 'default'
 * - Namespace imports: literal string '*'
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImportedNames(importNode: any): string[] {
  const names: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any): void {
    if (node.type === 'import_specifier') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) names.push(nameNode.text as string);
    } else if (node.type === 'identifier' && node.parent?.type === 'import_clause') {
      names.push('default');
    } else if (node.type === 'namespace_import') {
      names.push('*');
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  }
  walk(importNode);
  return names;
}

/**
 * Extracts a single bare top-level declaration into zero or more Symbol entries.
 * Handles all six kinds + const/arrow-function disambiguation + multi-binding const.
 * Skips: let, var, ambient, anonymous default, anything not in D-22 mapping.
 *
 * `positionSource` is the node whose startPosition/endPosition define the symbol's line range.
 * Defaults to `node` itself. When called from extractExportedSymbol, the export_statement is
 * passed to capture decorator lines correctly (Pitfall 7).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractBareTopLevelSymbol(node: any, isExport: boolean, out: Symbol[], positionSource?: any): void {
  const posNode = positionSource ?? node;
  const startLine = (posNode.startPosition.row as number) + 1;
  const endLine   = (posNode.endPosition.row as number) + 1;

  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (name) out.push({ name, kind: 'function', startLine, endLine, isExport });
      break;
    }
    case 'class_declaration': {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (name) out.push({ name, kind: 'class', startLine, endLine, isExport });
      break;
    }
    case 'interface_declaration': {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (name) out.push({ name, kind: 'interface', startLine, endLine, isExport });
      break;
    }
    case 'type_alias_declaration': {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (name) out.push({ name, kind: 'type', startLine, endLine, isExport });
      break;
    }
    case 'enum_declaration': {
      const name = node.childForFieldName('name')?.text as string | undefined;
      if (name) out.push({ name, kind: 'enum', startLine, endLine, isExport });
      break;
    }
    case 'lexical_declaration': {
      // const only — skip let/var (Pitfall 2)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kw = (node.children as any[]).find(c => c.type === 'const' || c.type === 'let' || c.type === 'var');
      if (kw?.type !== 'const') break;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'variable_declarator') {
          const name = child.childForFieldName('name')?.text as string | undefined;
          const valType = child.childForFieldName('value')?.type as string | undefined;
          if (name) {
            const kind: SymbolKind = valType === 'arrow_function' ? 'function' : 'const';
            out.push({ name, kind, startLine, endLine, isExport });
          }
        }
      }
      break;
    }
    // ambient_declaration, variable_declaration (var), others — intentionally skipped
  }
}

/**
 * Extracts a symbol from an `export_statement` node.
 * Skips re-exports (`export * from`, `export { x } from`) because they have a `source` field.
 * Skips anonymous defaults (D-06) because they have no declaration or the declaration lacks a name.
 * For decorator'd classes, both export_statement and its declaration child share the decorator's
 * startPosition.row, so passing declNode preserves the correct startLine (Pitfall 7).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractExportedSymbol(exportNode: any, out: Symbol[]): void {
  // Re-exports have a source field — SYM-08 skip
  if (exportNode.childForFieldName('source')) return;

  const declNode = exportNode.childForFieldName('declaration');
  if (!declNode) return;  // `export default <expression>` — D-06 anonymous case

  // Pass exportNode as positionSource so decorators preceding the `export` keyword are included
  // in the symbol's startLine (Pitfall 7 — decorators attach to the export_statement span,
  // not the inner declaration span).
  extractBareTopLevelSymbol(declNode, true, out, exportNode);
}

/**
 * Parses a TypeScript/JavaScript file and extracts richer edge classification data.
 * Returns regularImports, reExportSources, and inheritsFrom pairs.
 *
 * Unlike extractSnapshot(), this function distinguishes between:
 * - Regular imports (import_statement, require(), dynamic import)
 * - Re-export sources (export_statement with source field)
 * - Inherits-from pairs (class_declaration with extends referencing an imported name)
 *
 * Returns null if the file extension is not supported or parsing fails.
 */
export function extractRicherEdges(filePath: string, source: string): RicherEdgeData | null {
  const parser = getParser(filePath);
  if (!parser) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tree: any;
  try {
    tree = parser.parse(source);
  } catch (err) {
    log(`[ast-parser] tree-sitter parse failed for ${filePath}: ${err}`);
    return null;
  }

  const regularImports: string[] = [];
  const reExportSources: string[] = [];
  const inheritsFrom: Array<{ className: string; sourceSpecifier: string }> = [];
  // Phase 33 accumulators — populated during the same visitNode walk.
  const symbols: Symbol[] = [];
  const importMeta: ImportMeta[] = [];
  // Phase 37 accumulators — call-site candidate tracking (CSE-02).
  const callSiteCandidates: CallSiteCandidate[] = [];
  const callerStack: Array<{ name: string; startLine: number }> = [];

  // Build import name → source specifier map for inherits correlation
  const importNameToSource = new Map<string, string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visitNode(node: any): void {
    // Phase 37: push callerStack frame for top-level symbols ONLY.
    // "Top-level" = parent is `program`, OR parent is `export_statement`
    // whose parent is `program`. Frame's startLine must match the
    // eventual symbols[] row's startLine for the setEdgesAndSymbols
    // lookup (Pitfall A).
    let pushed = false;
    const parentType = node.parent?.type;
    const grandparentType = node.parent?.parent?.type;
    const isTopLevel =
      parentType === 'program' ||
      (parentType === 'export_statement' && grandparentType === 'program');

    if (isTopLevel) {
      if (node.type === 'export_statement') {
        // Push using export_statement's own start row — matches extractExportedSymbol positionSource.
        const decl = node.childForFieldName('declaration');
        const nameNode = decl?.childForFieldName?.('name');
        const name = nameNode?.text as string | undefined;
        if (name && (decl.type === 'function_declaration' ||
                     decl.type === 'generator_function_declaration' ||
                     decl.type === 'class_declaration')) {
          callerStack.push({ name, startLine: (node.startPosition.row as number) + 1 });
          pushed = true;
        }
      } else if (node.type === 'function_declaration' ||
                 node.type === 'generator_function_declaration' ||
                 node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        const name = nameNode?.text as string | undefined;
        if (name) {
          callerStack.push({ name, startLine: (node.startPosition.row as number) + 1 });
          pushed = true;
        }
      } else if (node.type === 'lexical_declaration') {
        // Per Landmine A simpler-alternative: attribute only the FIRST named
        // declarator whose RHS is a function/arrow; later declarators silently
        // discarded (callerStack empty for their subtrees).
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const declarators = (node.children as any[]).filter(c => c?.type === 'variable_declarator');
        for (const decl of declarators) {
          const nameNode = decl.childForFieldName?.('name');
          const valueNode = decl.childForFieldName?.('value');
          if (nameNode && valueNode &&
              (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression' || valueNode.type === 'function')) {
            callerStack.push({
              name: nameNode.text as string,
              startLine: (node.startPosition.row as number) + 1,  // const keyword line — matches extractBareTopLevelSymbol
            });
            pushed = true;
            break;
          }
        }
      }
    }

    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const specifier = getStringFragment(sourceNode);
        if (specifier) {
          regularImports.push(specifier);
          // Build name map for inherits correlation
          buildImportNameMap(node, specifier, importNameToSource);
          // Phase 33 IMP-01/02 — same walk, emit per-import metadata.
          const importedNames = extractImportedNames(node);
          const line = (node.startPosition.row as number) + 1;
          importMeta.push({ specifier, importedNames, line });
        }
      }
    } else if (node.type === 'export_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const specifier = getStringFragment(sourceNode);
        if (specifier) {
          reExportSources.push(specifier);
        }
      }
      // Don't return early — still need to recurse for nested nodes
    } else if (node.type === 'call_expression') {
      const fnNode = node.childForFieldName('function');
      if (fnNode && fnNode.type === 'identifier' && fnNode.text === 'require') {
        const argsNode = node.childForFieldName('arguments');
        if (argsNode && argsNode.childCount >= 3) {
          const firstArg = argsNode.child(1);
          if (firstArg && firstArg.type === 'string') {
            const fragment = getStringFragment(firstArg);
            if (fragment) regularImports.push(fragment);
          }
        }
      } else if (fnNode && fnNode.type === 'import') {
        const argsNode = node.childForFieldName('arguments');
        if (argsNode && argsNode.childCount >= 3) {
          const firstArg = argsNode.child(1);
          if (firstArg && firstArg.type === 'string') {
            const fragment = getStringFragment(firstArg);
            if (fragment) regularImports.push(fragment);
          }
        }
      } else if (fnNode && fnNode.type === 'identifier' && callerStack.length > 0) {
        // Phase 37 CSE-02 — emit call-site candidate.
        // Top of stack = current enclosing top-level symbol.
        const caller = callerStack[callerStack.length - 1];
        callSiteCandidates.push({
          callerName:      caller.name,
          callerStartLine: caller.startLine,
          calleeName:      fnNode.text as string,
          calleeSpecifier: null,   // resolved later in language-config.ts
          callLine:        (node.startPosition.row as number) + 1,
        });
      }
      // else: member_expression / subscript_expression / other → silent discard (D-09)
    }

    // Detect class extends referencing an imported name
    if (node.type === 'class_declaration' || node.type === 'class') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child.type === 'class_heritage') {
          for (let j = 0; j < child.namedChildCount; j++) {
            const hChild = child.namedChild(j);
            if (hChild.type === 'extends_clause') {
              const valueNode = hChild.childForFieldName('value') ?? hChild.namedChild(0);
              if (valueNode) {
                const className = valueNode.text as string;
                const sourceSpec = importNameToSource.get(className);
                if (sourceSpec) {
                  inheritsFrom.push({ className, sourceSpecifier: sourceSpec });
                }
              }
            }
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));

    // Phase 37: pop callerStack frame after recursing into children (Landmine G — no early return).
    if (pushed) callerStack.pop();
  }

  visitNode(tree.rootNode);

  // Phase 33 SYM-01 — walk top-level children for symbols, reusing the already-parsed tree.
  // (Nested/inner declarations are intentionally NOT extracted per milestone scope.)
  // This is the SAME parse output from above — no second parse-call is performed.
  const root = tree.rootNode;
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i);
    if (child.type === 'export_statement') {
      extractExportedSymbol(child, symbols);
    } else {
      extractBareTopLevelSymbol(child, false, symbols);
    }
  }

  return { regularImports, reExportSources, inheritsFrom, symbols, importMeta, callSiteCandidates };
}

// ─── Main extraction function ──────────────────────────────────────────────

/**
 * Parses a TypeScript/JavaScript file using tree-sitter and extracts:
 * - All exported symbols (exports array)
 * - All import paths (imports array)
 *
 * Returns null if the file extension is not supported or parsing fails.
 * Callers should treat null as an "unknown" change for safety.
 */
export function extractSnapshot(filePath: string, source: string): ExportSnapshot | null {
  const parser = getParser(filePath);
  if (!parser) return null;

  let tree: ReturnType<typeof tsParser.parse>;
  try {
    tree = parser.parse(source);
  } catch (err) {
    // Parsing failure — return null so caller falls back to 'unknown'
    // Use log() (not warn()) — parse failures in daemon mode should be suppressed, not spammed to stderr
    log(`[ast-parser] tree-sitter parse failed for ${filePath}: ${err}`);
    return null;
  }

  const exports: ExportedSymbol[] = [];
  const importSet = new Set<string>();

  // ─── Export queries ──────────────────────────────────────────────────────
  // Walk the tree looking for export_statement nodes. We use rootNode traversal
  // rather than Language.query() to avoid S-expression compilation at runtime
  // and handle both named and default exports in a single pass.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visitNode(node: any): void {
    if (node.type === 'export_statement') {
      processExportStatement(node, source, exports);
      // Don't recurse into export_statement — nested exports not valid TS/JS
      return;
    }
    // Recurse into children
    for (let i = 0; i < node.childCount; i++) {
      visitNode(node.child(i));
    }
  }

  visitNode(tree.rootNode);

  // ─── Import queries ──────────────────────────────────────────────────────
  // Walk the tree looking for import paths via AST (no regex).

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visitForImports(node: any): void {
    // ES6 import statements: import { X } from './path'
    if (node.type === 'import_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const fragment = getStringFragment(sourceNode);
        if (fragment) importSet.add(fragment);
      }
    }
    // Re-export statements: export { X } from './path'
    else if (node.type === 'export_statement') {
      const sourceNode = node.childForFieldName('source');
      if (sourceNode) {
        const fragment = getStringFragment(sourceNode);
        if (fragment) importSet.add(fragment);
      }
    }
    // require() calls: const x = require('./path')
    else if (node.type === 'call_expression') {
      const fnNode = node.childForFieldName('function');
      if (fnNode && fnNode.type === 'identifier' && fnNode.text === 'require') {
        const argsNode = node.childForFieldName('arguments');
        if (argsNode && argsNode.childCount >= 3) {
          // arguments: ( string )
          const firstArg = argsNode.child(1); // skip '('
          if (firstArg && firstArg.type === 'string') {
            const fragment = getStringFragment(firstArg);
            if (fragment) importSet.add(fragment);
          }
        }
      }
      // import() dynamic: import('./path')
      else if (fnNode && fnNode.type === 'import') {
        const argsNode = node.childForFieldName('arguments');
        if (argsNode && argsNode.childCount >= 3) {
          const firstArg = argsNode.child(1); // skip '('
          if (firstArg && firstArg.type === 'string') {
            const fragment = getStringFragment(firstArg);
            if (fragment) importSet.add(fragment);
          }
        }
      }
    }

    // Recurse into all children
    for (let i = 0; i < node.childCount; i++) {
      visitForImports(node.child(i));
    }
  }

  visitForImports(tree.rootNode);

  return {
    filePath,
    exports,
    imports: Array.from(importSet),
    capturedAt: Date.now(),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Extracts the string fragment (unquoted text) from a string node.
 * For a node like (string '"' (string_fragment "foo") '"'), returns "foo".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getStringFragment(node: any): string | null {
  if (!node) return null;
  // Traverse into the string node to find string_fragment
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === 'string_fragment') {
      return child.text as string;
    }
  }
  // Fallback: strip surrounding quotes from the string text
  const text: string = node.text ?? '';
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text.startsWith('`') && text.endsWith('`')) {
    // Template literal — not a safe import path (could be dynamic)
    return null;
  }
  return null;
}

/**
 * Returns true if the export_statement has the 'default' keyword as a direct child.
 * Used to distinguish `export default class Foo {}` from `export class Foo {}`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isDefaultExport(node: any): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i).type === 'default') return true;
  }
  return false;
}

/**
 * Processes an export_statement node and pushes ExportedSymbol entries.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processExportStatement(node: any, source: string, exports: ExportedSymbol[]): void {
  const isDefault = isDefaultExport(node);

  // Named export with declaration field: export function/class/const/type/interface/enum
  // Also handles: export default class Foo {} and export default function foo() {}
  // (which use the 'declaration' field but also have the 'default' keyword)
  const declNode = node.childForFieldName('declaration');
  if (declNode) {
    // Skip re-export statements (they have a 'source' field)
    if (node.childForFieldName('source')) return;

    if (isDefault) {
      // export default class Foo {} or export default function foo() {}
      const nameNode = declNode.childForFieldName('name');
      const name: string = nameNode?.text ?? 'default';
      exports.push({
        name: name || 'default',
        kind: 'default',
        signature: extractSignature(declNode, source),
      });
      return;
    }

    if (declNode.type === 'lexical_declaration' || declNode.type === 'variable_declaration') {
      // export const/let/var — may declare multiple variables
      // Find variable_declarator children
      for (let i = 0; i < declNode.childCount; i++) {
        const child = declNode.child(i);
        if (child.type === 'variable_declarator') {
          const nameNode = child.childForFieldName('name');
          const name: string = nameNode?.text ?? '';
          if (name) {
            exports.push({
              name,
              kind: 'variable',
              signature: extractSignature(declNode, source),
            });
          }
        }
      }
      return;
    }

    const kind = nodeTypeToKind(declNode.type);
    const nameNode = declNode.childForFieldName('name');
    const name: string = nameNode?.text ?? '';
    if (name) {
      exports.push({
        name,
        kind,
        signature: extractSignature(declNode, source),
      });
    }
    return;
  }

  // Default export: export default <value> (non-declaration)
  // e.g., export default 42, export default { x: 1 }, export default expr
  const valueNode = node.childForFieldName('value');
  if (valueNode) {
    // Named default: export default function foo() {} would be caught above,
    // but anonymous defaults or expression defaults fall here.
    const nameNode = valueNode.childForFieldName('name');
    const name: string = nameNode?.text ?? 'default';
    exports.push({
      name: name || 'default',
      kind: 'default',
      signature: extractSignature(valueNode, source),
    });
  }
}
