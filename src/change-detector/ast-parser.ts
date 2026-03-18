// src/change-detector/ast-parser.ts
// Tree-sitter CST extraction for TypeScript/JavaScript files.
// Extracts exported symbols and import paths from TS/JS source using AST queries
// (replaces regex-based import parsing for TS/JS — CHNG-04).
//
// Uses createRequire to load CJS tree-sitter packages from ESM context.
// Same pattern as better-sqlite3 in src/db/db.ts.
import { createRequire } from 'node:module';
import * as path from 'node:path';
import type { ExportSnapshot, ExportedSymbol } from './types.js';

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
    console.warn(`[ast-parser] tree-sitter parse failed for ${filePath}:`, err);
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
