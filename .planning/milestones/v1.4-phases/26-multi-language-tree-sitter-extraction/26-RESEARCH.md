# Phase 26: Multi-Language Tree-sitter Extraction - Research

**Researched:** 2026-04-09
**Domain:** tree-sitter grammar packages, multi-language AST extraction, TS/JS richer edge types, edge weight aggregation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Install official tree-sitter grammar packages: `tree-sitter-python`, `tree-sitter-c`, `tree-sitter-rust`, `tree-sitter-go`. These are the canonical npm packages maintained by the tree-sitter org, matching the installed `tree-sitter@0.25.x`.
- **D-02:** Each grammar is loaded via `createRequire` (same CJS-from-ESM pattern used in `ast-parser.ts` for tree-sitter-typescript and tree-sitter-javascript).
- **D-03:** Grammar load failures fall back to regex via the existing `buildAstExtractor()` pattern from Phase 25 — never crash, log once.
- **D-04:** Per-language extractor functions (not a shared generic walker). Each language has distinct AST node types for imports — Python (`import_statement`, `import_from_statement`), Rust (`use_declaration`, `mod_item`, `extern_crate_declaration`), C/C++ (`preproc_include`), Go (`import_declaration` with import spec list). Per-language is clearer and matches the existing pattern where TS/JS, Go, and Ruby each have dedicated extractors.
- **D-05:** Each new extractor follows the same signature: `(filePath, content, projectRoot) => Promise<EdgeResult[]>`. They are registered in the LanguageConfig registry with `grammarLoader` set and `usesRegexFallback: false`.
- **D-06:** Existing Go and Ruby extractors remain regex-based for now (they already work well via specialized resolvers). Only Python, Rust, C/C++ get new AST extractors. Go uses `resolveGoImports()` which handles go.mod module paths — rewriting that as AST would require reimplementing the module resolver.
- **D-07:** Extend the existing `extractTsJsEdges()` in `language-config.ts` to produce `re_exports` and `inherits` edge types in addition to `imports`.
- **D-08:** Re-exports: detected via `export_statement` nodes that have a `source` field (already partially identified in `ast-parser.ts` `visitForImports`). These get `edgeType: 're_exports'` instead of `'imports'`.
- **D-09:** Inherits: detected via `class_declaration` nodes with `class_heritage` / `extends_clause` children. The extended class's module source becomes an edge with `edgeType: 'inherits'`. Only cross-file inheritance is tracked (same-file extends is not a dependency edge).
- **D-10:** The `extractSnapshot()` function in `ast-parser.ts` needs to return richer data — either new fields on `ExportSnapshot` or a separate extraction function called from `extractTsJsEdges()` that walks for re-exports and extends clauses.
- **D-11:** Post-extraction aggregation. Each extractor emits one EdgeResult per import statement (including duplicates when a file imports another multiple times). After extraction, `extractEdges()` aggregates by target path — summing weights for duplicate targets. This keeps extractor logic simple.
- **D-12:** The aggregation happens in the public `extractEdges()` function in `language-config.ts`, not inside individual extractors. A `Map<target, EdgeResult>` accumulator merges duplicates, incrementing `weight` for each additional reference to the same target.
- **D-13:** Each new language extractor (Python, Rust, C/C++, Go) must pass a parity test: given the same input file, the AST extractor produces the same set of resolved dependency paths as the previous regex extractor. Parity tests run both extractors and compare outputs.
- **D-14:** Parity tests are vitest tests in the test suite. They use fixture files with known import patterns for each language.

### Claude's Discretion

- Internal AST walker implementation details (cursor vs recursive node traversal)
- Parser instance management (one per grammar, matching existing ast-parser.ts pattern)
- Test fixture file contents and naming
- Whether to create a shared helper for common post-extraction steps (path normalization, package detection)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AST-02 | Tree-sitter extracts import edges for Python files (replacing regex) | D-04/D-05: `import_statement`, `import_from_statement` nodes; `tree-sitter-python@0.25.0` verified compatible |
| AST-03 | Tree-sitter extracts import edges for Rust files (replacing regex) | D-04/D-05: `use_declaration`, `mod_item`, `extern_crate_declaration` nodes; `tree-sitter-rust@0.24.0` verified compatible |
| AST-04 | Tree-sitter extracts import edges for C/C++ files (replacing regex) | D-04/D-05: `preproc_include` node with `path` field; requires both `tree-sitter-c@0.24.1` AND `tree-sitter-cpp@0.23.4` |
| AST-05 | Tree-sitter extracts import edges for Go files (replacing regex) | **D-06 OVERRIDES**: Go stays on `resolveGoImports()` regex per locked decision. Parity test verifies Go extraction unchanged. AST-05 is NOT fully implemented — Go keeps regex. |
| AST-07 | Extractor produces richer edge types: imports, re_exports, inherits (for TS/JS) | D-07/D-08/D-09: extend `extractTsJsEdges()`; `export_statement` with `source` → `re_exports`; `class_heritage`/`extends_clause` → `inherits` |
| AST-08 | Extractor produces edge weights (reference count between file pairs) | D-11/D-12: aggregation Map in `extractEdges()` after delegate extraction; weight sums per unique target |
| EDGE-03 | All edges written by extractors carry confidence label and score | New extractors use `EXTRACTED`/`CONFIDENCE_SOURCE_EXTRACTED` constants; `extractEdges()` ensures non-null confidence on all returned edges |
</phase_requirements>

## Summary

Phase 26 is the "fill in the AST logic" phase. Phase 25 built the entire scaffolding — grammar loader pattern, `buildAstExtractor()`, `extractEdges()` dispatch, `EdgeResult` type, `setEdges()` writer. Phase 26 plugs real AST extraction into that scaffold for Python, Rust, C/C++, and TS/JS richer edges.

Four npm packages need installation. Three have exact peer dep compatibility with the installed `tree-sitter@0.25.0` (`tree-sitter-python@0.25.0`, `tree-sitter-go@0.25.0`). Two are compatible via semver range (`tree-sitter-rust@0.24.0` with `^0.22.1`, `tree-sitter-c@0.24.1` with `^0.22.4`, `tree-sitter-cpp@0.23.4` with `^0.21.1`). No `--legacy-peer-deps` is needed. A critical finding: D-01 in CONTEXT.md lists `tree-sitter-c` only, but C++ file extensions (`.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`) need `tree-sitter-cpp` as a separate package. Both must be installed.

The AST-05 / D-06 conflict is a known design decision: Go was listed as a requirement to get AST extraction, but the user explicitly locked Go to stay on `resolveGoImports()` in the context discussion. The "Go parity test" mentioned in the success criteria means verifying that Go extraction still works correctly after all changes (trivially true since the Go code path is unchanged). The planner must make this explicit.

**Primary recommendation:** Install all grammar packages first, then implement Python/Rust/C/C++ extractors in sequence (each with parity test), then add re-exports/inherits to extractTsJsEdges, then add the weight aggregation in `extractEdges()`. These four tracks are mostly independent and can be planned in parallel waves.

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tree-sitter | ^0.25.0 | Parser engine | Already in production; all grammar packages peer-dep on it |
| tree-sitter-typescript | ^0.23.2 | TS/TSX grammar | Already loaded at module level in `ast-parser.ts` |
| tree-sitter-javascript | ^0.25.0 | JS/JSX grammar | Already loaded at module level in `ast-parser.ts` |

### New packages to install
| Library | Version | Purpose | Peer Dep Compat |
|---------|---------|---------|-----------------|
| tree-sitter-python | 0.25.0 | Python grammar | `^0.25.0` — exact match |
| tree-sitter-c | 0.24.1 | C grammar (.c, .h) | `^0.22.4` — satisfied by 0.25.0 |
| tree-sitter-cpp | 0.23.4 | C++ grammar (.cpp, .cc, .cxx, .hpp, .hh, .hxx) | `^0.21.1` — satisfied by 0.25.0 |
| tree-sitter-rust | 0.24.0 | Rust grammar | `^0.22.1` — satisfied by 0.25.0 |
| tree-sitter-go | 0.25.0 | Go grammar (optional — Go stays on regex per D-06) | `^0.25.0` — exact match, but not needed |

**Installation:**
```bash
npm install tree-sitter-python tree-sitter-c tree-sitter-cpp tree-sitter-rust
```
Note: `tree-sitter-go` is NOT required. Go extraction stays on `resolveGoImports()` per D-06.

### Supporting (already present)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.1.4 | Test runner | Co-located `*.test.ts` parity tests and edge type tests |
| confidence.ts | project module | EXTRACTED/INFERRED constants | All new extractors use these — never raw float literals |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── language-config.ts      MODIFY: add Python/Rust/C/C++ extractors; extend extractTsJsEdges; add weight aggregation to extractEdges()
├── change-detector/
│   └── ast-parser.ts       MODIFY: add exported function for richer TS/JS edge walk (re-exports + inherits)
└── language-config.test.ts NEW: parity tests + edge type tests + weight aggregation tests
```
No schema changes needed. Migration 0004 from Phase 25 already has `edge_type text`, `confidence real`, `confidence_source text`, `weight integer`. The `edge_type` column is plain text (no enum constraint), so `'re_exports'` and `'inherits'` are valid without migration.

### Pattern 1: Grammar Loading (follows ast-parser.ts pattern)
**What:** Load each grammar at module level via `createRequire`. One `Parser` instance per grammar.

**When to use:** Every new language grammar follows this exact pattern.

**Example:**
```typescript
// Source: src/change-detector/ast-parser.ts lines 13-38 (verified)
// At top of file:
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

// Grammar loading (module level — fails fast, not per-call):
const PythonLang   = _require('tree-sitter-python')   as unknown;
const RustLang     = _require('tree-sitter-rust')      as unknown;
const CLang        = _require('tree-sitter-c')         as unknown;
const CppLang      = _require('tree-sitter-cpp')       as unknown;

// Parser instances (one per grammar):
const pythonParser = new Parser();
pythonParser.setLanguage(PythonLang);

const rustParser = new Parser();
rustParser.setLanguage(RustLang);

const cParser = new Parser();
cParser.setLanguage(CLang);

const cppParser = new Parser();
cppParser.setLanguage(CppLang);
```

**Grammar export shape:** All grammar packages export `{ language, nodeTypeInfo }` as their module object. `parser.setLanguage(grammarModule)` works directly — same as how `JavaScriptLang` is loaded and used in `ast-parser.ts` line 27/36.

**ABI compatibility:** `tree-sitter@0.25.0` supports multiple grammar ABI versions. All four new grammar packages have peer deps satisfied by 0.25.0.

### Pattern 2: Python AST Extractor
**What:** Walk tree for `import_statement` and `import_from_statement` nodes.

**AST node fields (from tree-sitter-python node-types.json, HIGH confidence):**

| Node Type | Field | What it holds |
|-----------|-------|---------------|
| `import_statement` | `name` | One or more `dotted_name` or `aliased_import` children |
| `import_from_statement` | `module_name` | `dotted_name` or `relative_import` |

**Key insight:** For `import os` → `import_statement` → `name` field → `dotted_name` with `.text = "os"`. For `from json import loads` → `import_from_statement` → `module_name` field → `dotted_name` with `.text = "json"`. For relative imports (`from . import foo`) → `module_name` field → `relative_import` node.

**Resolution logic (for parity with regex):** Take the module name text and apply the same logic as `buildRegexExtractor`: `path.resolve(path.dirname(filePath), moduleText)`. Absolute module names (no `.` prefix) are `isPackage: true`.

**Example:**
```typescript
// Source: established from tree-sitter-python node-types.json (HIGH confidence)
async function extractPythonEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  const tree = pythonParser.parse(content);
  const edges: EdgeResult[] = [];

  function visitNode(node: any): void {
    if (node.type === 'import_statement') {
      // "import os" or "import os.path"
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        // child is dotted_name or aliased_import
        const moduleName = child.type === 'aliased_import'
          ? child.childForFieldName('name')?.text ?? ''
          : child.text;
        if (moduleName) handleModuleRef(moduleName, filePath, projectRoot, edges);
      }
    } else if (node.type === 'import_from_statement') {
      // "from json import loads" or "from . import foo"
      const modNameNode = node.childForFieldName('module_name');
      if (modNameNode) handleModuleRef(modNameNode.text, filePath, projectRoot, edges);
    }
    for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
  }

  visitNode(tree.rootNode);
  return edges;
}
```

### Pattern 3: Rust AST Extractor
**What:** Walk tree for `use_declaration` nodes and extract path via `childForFieldName('argument')`.

**AST node fields (from tree-sitter-rust node-types.json + verified web sources, HIGH confidence):**

The `use_declaration` node has an `argument` field containing the use path. Accessing `.text` on the argument gives the full path string, e.g., `"std::io"` for `use std::io;`.

```typescript
// Source: tree-sitter-rust node-types.json + verified usage pattern
function visitNode(node: any): void {
  if (node.type === 'use_declaration') {
    const argNode = node.childForFieldName('argument');
    if (argNode) {
      const usePath = argNode.text as string;
      // usePath is like "std::io", "crate::utils", "super::model"
      handleRustUse(usePath, filePath, projectRoot, edges);
    }
  } else if (node.type === 'mod_item') {
    const nameNode = node.childForFieldName('name');
    if (nameNode && !node.childForFieldName('body')) {
      // "mod utils;" (no body) → external module reference
      handleRustMod(nameNode.text as string, filePath, projectRoot, edges);
    }
  } else if (node.type === 'extern_crate_declaration') {
    const nameNode = node.childForFieldName('name');
    if (nameNode) handleRustExternCrate(nameNode.text as string, filePath, projectRoot, edges);
  }
  for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
}
```

**Note on `mod_item`:** `mod utils;` (no body) is an external module reference. `mod utils { ... }` (with body) is an inline module — not a dependency. Check for absence of `body` field.

### Pattern 4: C/C++ AST Extractor
**What:** Walk tree for `preproc_include` nodes and extract path via `childForFieldName('path')`.

**AST node fields (from tree-sitter-c node-types.json, HIGH confidence):**

| Node | Field | Child Types |
|------|-------|-------------|
| `preproc_include` | `path` | `string_literal` (for `"header.h"`) OR `system_lib_string` (for `<stdio.h>`) |

For `string_literal`: path child text is `'"header.h"'` — strip quotes for the filename.
For `system_lib_string`: path child text is `'<stdio.h>'` — this is a system/package dep.

```typescript
// Source: tree-sitter-c node-types.json (HIGH confidence)
// Same logic works for tree-sitter-cpp — uses identical preproc_include node type
function visitNode(node: any): void {
  if (node.type === 'preproc_include') {
    const pathNode = node.childForFieldName('path');
    if (!pathNode) return;
    if (pathNode.type === 'system_lib_string') {
      // <stdio.h> — system include, isPackage: true
      // Strip < and > to get "stdio.h"
      const name = pathNode.text.slice(1, -1);
      edges.push({ target: name, edgeType: 'imports', confidence: EXTRACTED,
                   confidenceSource: CONFIDENCE_SOURCE_EXTRACTED, weight: 1,
                   isPackage: true, packageName: name });
    } else if (pathNode.type === 'string_literal') {
      // "myfile.h" — local include, isPackage: false
      // Strip quotes to get "myfile.h"
      const rawPath = pathNode.text.slice(1, -1);
      const resolved = path.resolve(path.dirname(filePath), rawPath);
      // ... access check, then push local edge
    }
  }
  for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
}
```

**C vs C++ grammar dispatch:** Use `cParser` for `.c` and `.h`; use `cppParser` for `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`. Register in language-config.ts registry accordingly.

### Pattern 5: TS/JS Richer Edge Types (re-exports + inherits)
**What:** Extend `extractTsJsEdges()` to categorize edges by type, adding `re_exports` and `inherits`.

**Re-exports detection:** `export_statement` nodes with a `source` field (e.g., `export { X } from './path'`). Already partially captured in `visitForImports` in `ast-parser.ts` but added to the same import set. For Phase 26: distinguish these at the `extractTsJsEdges` level.

**Inherits detection (D-09):** Requires two-pass correlation:
1. Build an import name → source path map: `import { Bar } from './bar.js'` → `Map.set('Bar', './bar.js')`
2. Walk for `class_heritage` → `extends_clause` → `value` field → identifier `.text`
3. Look up identifier in map → if found, emit edge with `edgeType: 'inherits'`

**Implementation approach (D-10):** Add a new exported function `extractRicherEdgesFromSource(filePath, source)` to `ast-parser.ts`. This avoids modifying `ExportSnapshot` (which is used by change-detector) and keeps the richer logic in the same file as the parser instances.

```typescript
// New function to add to ast-parser.ts (HIGH confidence pattern)
export interface RicherEdgeData {
  /** Raw import specifiers from import_statement nodes */
  regularImports: string[];
  /** Raw specifiers from export_statement nodes with source (re-exports) */
  reExportSources: string[];
  /** { className, sourcePath } pairs from extends_clause (cross-file only if found in imports) */
  inheritsFrom: Array<{ className: string; sourceSpecifier: string }>;
}

export function extractRicherEdges(filePath: string, source: string): RicherEdgeData | null {
  const parser = getParser(filePath);
  if (!parser) return null;
  // ...walk for import_statement, export_statement-with-source, class_heritage
}
```

Then `extractTsJsEdges()` calls `extractRicherEdges()` instead of `extractSnapshot()` for edge classification.

**TS/JS class_heritage node structure (HIGH confidence):**
```
class_declaration
  class_heritage
    extends_clause
      value: identifier | member_expression
```
Access: `classNode.childForFieldName('heritage')` → walk for `extends_clause` → `childForFieldName('value').text`

### Pattern 6: Edge Weight Aggregation in `extractEdges()`
**What:** After the language-specific extractor returns raw edges, merge duplicate targets by summing weights.

**Decision D-12:** The Map aggregator goes in `extractEdges()`, not in individual extractors.

```typescript
// Modification to extractEdges() in language-config.ts
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

  // Aggregate duplicate targets by summing weights (D-11/D-12)
  // Key: target + edgeType (same file can be imported AND re-exported — different edges)
  const accumulator = new Map<string, EdgeResult>();
  for (const edge of rawEdges) {
    const key = `${edge.target}\x00${edge.edgeType}`;
    const existing = accumulator.get(key);
    if (existing) {
      existing.weight += edge.weight;
    } else {
      accumulator.set(key, { ...edge });
    }
  }
  return Array.from(accumulator.values());
}
```

**Key detail:** The aggregation key must include `edgeType`, not just `target`. A file could be both imported and re-exported — those are two distinct edges. Keying on `target` alone would incorrectly merge them.

### Pattern 7: Parity Test Structure
**What:** Run both AST extractor and regex extractor on the same fixture file, compare target sets.

**Fixture design principle:** Use stdlib/external-only imports in fixture files. Avoid relative local imports that require filesystem resolution — those depend on real files existing and would make tests flaky.

```typescript
// Source: established from existing ast-parser.test.ts patterns (HIGH confidence)
// In src/language-config.test.ts:

describe('Python extractor parity', () => {
  const FIXTURE = `import os\nfrom json import loads\nimport pathlib`;
  const filePath = '/project/test.py';
  const projectRoot = '/project';

  it('AST extractor produces same target set as regex extractor', async () => {
    const astEdges = await extractEdgesAst(filePath, FIXTURE, projectRoot);
    const regexEdges = await extractEdgesRegex(filePath, FIXTURE, projectRoot);

    const astTargets = new Set(astEdges.map(e => e.target));
    const regexTargets = new Set(regexEdges.map(e => e.target));
    expect(astTargets).toEqual(regexTargets);
  });

  it('AST edges have confidence=EXTRACTED', async () => {
    const edges = await extractEdgesAst(filePath, FIXTURE, projectRoot);
    expect(edges.every(e => e.confidence === EXTRACTED)).toBe(true);
  });
});
```

**Parity test approach for languages where extractors will be replaced in the registry:** The test must call BOTH the new AST extractor AND the original regex extractor. Access the regex extractor via `buildRegexExtractor(ext)` called directly (it's not exported currently — may need to export it or keep a reference for test purposes).

### Anti-Patterns to Avoid

- **Don't install tree-sitter-go:** Go stays on `resolveGoImports()` regex (D-06). Installing the grammar package without using it wastes space and creates a misleading code expectation.
- **Don't use `node.text` for `string_literal` content directly:** `node.text` includes surrounding quotes (`'"stdio.h"'`). Strip quotes manually or use the same `getStringFragment()` helper pattern from `ast-parser.ts`.
- **Don't key the weight aggregator on `target` alone:** Must also key on `edgeType` to preserve separate `imports`, `re_exports`, and `inherits` edges to the same file.
- **Don't put aggregation inside individual language extractors:** D-12 is explicit — aggregation belongs in `extractEdges()` only. Keep extractors simple (emit one edge per statement).
- **Don't modify `ExportSnapshot` interface for re-exports/inherits:** Change-detector depends on this type. Adding fields requires updating `semantic-diff.ts` usage and all tests. Use a new exported function in `ast-parser.ts` instead.
- **Don't use `mod_item` with a body as a dependency:** `mod mymodule { ... }` is an inline module definition. Only `mod utils;` (no body field) is an external module reference.
- **Don't assume `buildAstExtractor()` is called from outside `language-config.ts`:** It is exported (line 479) but the Phase 26 implementation should add extractors directly as `LanguageConfig` entries in the registry, not compose them externally.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Grammar CJS loading from ESM | Custom module loading | `createRequire(import.meta.url)` + `_require(...)` | Already proven in `ast-parser.ts`; ABI native modules need this exact pattern |
| AST node traversal boilerplate | Custom tree walker | Direct recursive `.childCount` / `.child(i)` loop | Same pattern as `visitNode`/`visitForImports` in `ast-parser.ts` — no need for cursor abstraction |
| Module name → path resolution for Python/Rust | Custom resolution logic | Same `path.resolve(path.dirname(filePath), moduleName)` + `isPackage` check used by `buildRegexExtractor()` | Parity requirement demands identical resolution logic |
| C/C++ system include detection | Parse angle brackets manually | `pathNode.type === 'system_lib_string'` from tree-sitter-c | Grammar already distinguishes `<header>` from `"header"` at the node type level |
| Import name → module correlation for inherits | Symbol table / type resolver | Simple `Map<string, string>` built from `import_statement` nodes in the same file | Cross-file type resolution is out of scope; within-file import map is sufficient for the common case |

## Common Pitfalls

### Pitfall 1: tree-sitter-c Does Not Cover C++ Extensions
**What goes wrong:** Installing only `tree-sitter-c` leaves `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` files without an AST grammar. The grammar load fails, falls back to regex, and the AST-04 requirement is only half-satisfied.
**Why it happens:** CONTEXT.md D-01 lists `tree-sitter-c` but doesn't explicitly call out `tree-sitter-cpp`. The C grammar only covers C syntax — it will parse `.c` files but cannot handle C++ syntax (classes, templates, namespaces).
**How to avoid:** Install BOTH `tree-sitter-c` (for `.c`, `.h`) AND `tree-sitter-cpp` (for `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx`). Register them separately in the language-config registry.
**Warning signs:** C++ files like `main.cpp` with `#include <iostream>` fall back to regex (check log for "Grammar load failed") or parse errors appear in complex C++ files.

### Pitfall 2: String Literal Text Includes Surrounding Quotes
**What goes wrong:** `node.text` on a `string_literal` node returns `'"stdio.h"'` (with quotes). Passing `'"stdio.h"'` to `path.resolve()` produces a path like `/dir/"stdio.h"` which will never match any file.
**Why it happens:** tree-sitter `node.text` gives the verbatim source text of the node, including delimiters.
**How to avoid:** For `string_literal`, either use a helper like `getStringFragment()` from `ast-parser.ts` (which finds the `string_fragment` child), or manually strip the first and last character. For `system_lib_string`, strip the `<` and `>` delimiters similarly.
**Warning signs:** C/C++ and Python local imports produce zero resolved edges even when the header files exist on disk.

### Pitfall 3: mod_item With Body Treated as External Dependency
**What goes wrong:** `mod mymodule { fn foo() {} }` is an inline module definition. Treating it as an import creates a spurious edge to a non-existent file.
**Why it happens:** `mod_item` node type represents both `mod utils;` (external reference) and `mod utils { ... }` (inline definition). A naive check for `mod_item` catches both.
**How to avoid:** Before emitting an edge for `mod_item`, check that there is no `body` field: `!node.childForFieldName('body')`. Only bodyless `mod` declarations are external references.
**Warning signs:** Rust files with inline modules produce spurious local file edges; parity test fails because regex doesn't match inline mods.

### Pitfall 4: Inherits Edge Target Looks Up Class Name Not Found in Imports
**What goes wrong:** `class Foo extends EventEmitter {}` where `EventEmitter` is imported from `'events'` — but the import correlation map misses it because the import is destructured differently or uses a namespace import.
**Why it happens:** The import correlation only handles simple named imports and default imports. Namespace imports (`import * as Node from 'events'; class Foo extends Node.EventEmitter`) are not handled.
**How to avoid:** Limit `inherits` edge emission to cases where the extends target name IS found in the import map. If not found, silently skip (the class extends a same-file class or an unresolvable external). Don't crash or emit a malformed edge.
**Warning signs:** No `inherits` edges appear for valid cross-file inheritance in tests — check that the import correlation map is being populated correctly.

### Pitfall 5: re-exports and imports Share the Same Target, Aggregation Collapses Them
**What goes wrong:** A file both `import`s and `re_export`s the same module: `import { Foo } from './foo'` + `export { Foo } from './foo'`. With a target-only aggregation key, these two edges get merged into one.
**Why it happens:** If the aggregation key in `extractEdges()` is just `edge.target`, duplicate detection collapses edges to the same target regardless of edge type.
**How to avoid:** Use `target + '\x00' + edgeType` as the composite aggregation key. `imports` and `re_exports` edges to the same file remain distinct.
**Warning signs:** Test for a file with both import and re-export of the same module — should produce TWO edges (one `imports`, one `re_exports`), not one.

### Pitfall 6: buildAstExtractor() Placeholder Still in Path for New Languages
**What goes wrong:** `buildAstExtractor()` in `language-config.ts` currently has a stub that loads the grammar but then falls back to regex (`void _grammar; return regexFallback(...)`). If Phase 26 reuses this function for new languages without replacing the stub, the grammar is loaded but never used.
**Why it happens:** The Phase 25 `buildAstExtractor()` was written as a scaffold with `// Phase 26 will add actual AST extraction here`.
**How to avoid:** Phase 26 should NOT use `buildAstExtractor()` for the new extractors. Instead, register each language directly in the registry with a proper extractor function as the `extract` field. `buildAstExtractor()` only matters if the grammar load itself fails (the fallback guard pattern — which is handled by the module-level `try/catch` around parser instantiation).
**Warning signs:** Logs show grammars loading but confidence remains `0.8` (INFERRED) for Python/Rust/C/C++ files — means regex fallback is still being used.

### Pitfall 7: Parity Tests Need Access to Both Old and New Extractor
**What goes wrong:** After Phase 26 replaces the registry entry for Python/Rust/C/C++, there is no exported reference to the old regex extractor, making parity comparison impossible.
**Why it happens:** The parity test design requires running BOTH extractors on the same fixture. But `buildRegexExtractor()` is not currently exported from `language-config.ts`.
**How to avoid:** Either (a) export `buildRegexExtractor` from `language-config.ts` so parity tests can call both, OR (b) define the regex extractor inline in the test using `buildRegexExtractor`'s logic directly (re-implement in the test for isolation). Option (a) is simpler and already aligns with the `buildAstExtractor` export pattern.
**Warning signs:** Parity tests can only test the AST extractor in isolation, not run a comparison — the test doesn't actually verify parity.

## Code Examples

### C/C++ preproc_include extraction (both grammars)
```typescript
// Source: tree-sitter-c node-types.json (HIGH confidence) + search-verified AST shape
// Works identically for tree-sitter-cpp (same preproc_include node type)

function visitNode(node: any): void {
  if (node.type === 'preproc_include') {
    const pathNode = node.childForFieldName('path');
    if (!pathNode) { recurse(node); return; }
    if (pathNode.type === 'system_lib_string') {
      // <stdio.h> → system include → package dep
      const name = (pathNode.text as string).slice(1, -1); // strip < >
      edges.push({ target: name, edgeType: 'imports', confidence: EXTRACTED,
                   confidenceSource: CONFIDENCE_SOURCE_EXTRACTED, weight: 1,
                   isPackage: true, packageName: name });
    } else if (pathNode.type === 'string_literal') {
      // "myfile.h" → local include → local dep (with file existence check)
      const rawPath = (pathNode.text as string).slice(1, -1); // strip quotes
      const resolved = path.resolve(path.dirname(filePath), rawPath);
      // access check then push local edge
    }
  }
  for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
}
```

### Python import_from_statement extraction
```typescript
// Source: tree-sitter-python node-types.json (HIGH confidence)
if (node.type === 'import_from_statement') {
  const modNode = node.childForFieldName('module_name');
  if (modNode) {
    const moduleName = modNode.text as string; // e.g. "json", ".", ".submodule"
    // Apply same resolution as regex: path.resolve(dirname, moduleName)
    // moduleName not starting with '.' → isPackage = true
  }
}
```

### Rust use_declaration path extraction
```typescript
// Source: tree-sitter-rust node-types.json + verified usage pattern (HIGH confidence)
if (node.type === 'use_declaration') {
  const argNode = node.childForFieldName('argument');
  if (argNode) {
    const usePath = argNode.text as string; // e.g. "std::io", "crate::utils::Foo"
    // isPackage: !usePath.startsWith("crate::") && !usePath.startsWith("super::")
    //            && !usePath.startsWith("self::")
  }
}
```

### TS/JS class_heritage for inherits edge
```typescript
// Source: tree-sitter-typescript grammar + verified web sources (MEDIUM confidence)
// Build import map first
const importNameToSource = new Map<string, string>();
// In import walk: for "import { Bar } from './bar.js'" → importNameToSource.set('Bar', './bar.js')

// Then in class walk:
if (node.type === 'class_declaration') {
  const heritageNode = node.childForFieldName('heritage');  // Note: check field name carefully
  if (heritageNode) {
    for (let i = 0; i < heritageNode.childCount; i++) {
      const child = heritageNode.child(i);
      if (child.type === 'extends_clause') {
        const valueNode = child.childForFieldName('value');
        if (valueNode) {
          const className = valueNode.text as string;
          const sourceSpecifier = importNameToSource.get(className);
          if (sourceSpecifier) {
            // Emit edge with edgeType: 'inherits', target: resolved(sourceSpecifier)
          }
        }
      }
    }
  }
}
```

**Note:** The field name for heritage on `class_declaration` in `tree-sitter-typescript` may be accessed via `.namedChildren` traversal rather than a named field. Verify the exact field name during implementation — it may be `heritage` or accessible via `node.namedChildren.find(c => c.type === 'class_heritage')`.

### Weight aggregation in extractEdges()
```typescript
// Replacement for the simple return in extractEdges() (HIGH confidence)
const accumulator = new Map<string, EdgeResult>();
for (const edge of rawEdges) {
  const key = `${edge.target}\x00${edge.edgeType}`;
  const existing = accumulator.get(key);
  if (existing) {
    existing.weight += edge.weight;
  } else {
    accumulator.set(key, { ...edge }); // spread to avoid mutating the original
  }
}
return Array.from(accumulator.values());
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex `/#include\s+["<]([^">]+)[">]/g` for C/C++ | tree-sitter `preproc_include` node walk | Phase 26 | Confidence 1.0 (EXTRACTED) vs 0.8 (INFERRED); handles macro-expanded includes better |
| Regex `/(?:import\s+([\w.]+)\|from\s+([\w.]+)...)/g` for Python | tree-sitter `import_statement` / `import_from_statement` walk | Phase 26 | Properly handles `import a, b, c` and wildcard imports; confidence 1.0 |
| Regex `/use\s+([\w:]+)\|mod\s+(\w+)/g` for Rust | tree-sitter `use_declaration` + `mod_item` (bodyless) | Phase 26 | Handles `use std::{io, fmt}` grouped imports that regex misses |
| All TS/JS edges typed as `imports` | TS/JS edges can be `imports`, `re_exports`, or `inherits` | Phase 26 | Downstream community detection (Phase 27) can weight edges by semantic type |
| Edge weight always 1 | Edge weight = reference count for file pair | Phase 26 | Stronger dependency signal for clustering |

**No deprecations.** `buildRegexExtractor()` is retained (now also used as parity fallback in tests). `setDependencies()` in repository.ts is retained per Phase 25 decision.

## Open Questions

1. **`class_heritage` field name in tree-sitter-typescript**
   - What we know: The tree-sitter query syntax is `(class_declaration (class_heritage (extends_clause value: ...))`  
   - What's unclear: The exact Node.js API field name to access `class_heritage` as a named child of `class_declaration` — it may be via `childForFieldName('heritage')` or via `namedChildren` traversal
   - Recommendation: During implementation, add a quick test with a minimal TypeScript source like `class Foo extends Bar {}` and print the class_declaration's named children to confirm the correct field/traversal path. This is a 5-minute verification.

2. **Python `import a, b` multi-name import AST shape**
   - What we know: `import_statement` has a `name` field with `multiple: true` — multiple `dotted_name` children
   - What's unclear: Whether `node.namedChildCount` or `node.childForFieldName('name')` returns an array or individual children
   - Recommendation: Use `.namedChildCount` / `.namedChild(i)` loop over the statement node's named children to capture all names. Alternatively: use `.namedChildren` array if available in the Node.js tree-sitter API.

3. **`buildRegexExtractor` export for parity tests**
   - What we know: `buildRegexExtractor` is currently not exported from `language-config.ts`; parity tests need to call both AST and regex extractors
   - What's unclear: Whether to export `buildRegexExtractor` or use a different strategy for parity test access
   - Recommendation: Export `buildRegexExtractor` from `language-config.ts`. This is a simple one-line change and is already consistent with `buildAstExtractor` being exported. Parity tests can then call `buildRegexExtractor('.py')` directly.

## Sources

### Primary (HIGH confidence)
- Direct inspection of `src/language-config.ts` — complete current state of registry, extractors, `extractEdges()`, `buildAstExtractor()`, `buildRegexExtractor()`
- Direct inspection of `src/change-detector/ast-parser.ts` — grammar loading pattern (`createRequire`), parser instances, `visitNode`/`visitForImports` traversal, `getStringFragment()` helper, `ExportSnapshot` type
- Direct inspection of `src/confidence.ts` — `EXTRACTED`/`INFERRED` constants
- Direct inspection of `src/db/schema.ts` — confirmed `edge_type` is plain `text()`, no enum constraint
- Direct inspection of `drizzle/0004_add_edge_metadata.sql` — confirmed Phase 25 migration complete
- Direct inspection of `src/db/repository.ts` lines 267-290 — `setEdges()` already handles all EdgeResult fields
- Direct inspection of `package.json` — `tree-sitter@^0.25.0` installed (v0.25.0); no grammar packages installed yet
- `npm show` verified versions: `tree-sitter-python@0.25.0`, `tree-sitter-c@0.24.1`, `tree-sitter-cpp@0.23.4`, `tree-sitter-rust@0.24.0`, `tree-sitter-go@0.25.0`
- `npm install --dry-run` — confirmed no peer dependency conflicts for all four packages
- `tree-sitter-python/src/node-types.json` (fetched from GitHub master) — `import_statement` and `import_from_statement` field definitions
- `tree-sitter-rust/src/node-types.json` (fetched from GitHub master) — `use_declaration`, `mod_item`, `extern_crate_declaration` field definitions
- `tree-sitter-c/src/node-types.json` (fetched from GitHub master) — `preproc_include` `path` field with `string_literal`/`system_lib_string` child types
- vitest run: 699 tests pass — clean baseline before Phase 26

### Secondary (MEDIUM confidence)
- tree-sitter-cpp `preproc_include` — confirmed same node type as tree-sitter-c via web search results showing identical AST structure
- `tree-sitter-rust` `use_declaration` `argument` field access pattern — confirmed via "Knee Deep in tree-sitter" blog example showing `child_by_field_name("argument")` usage
- `class_declaration` / `class_heritage` / `extends_clause` node types in tree-sitter-typescript — confirmed via web search citing tree-sitter query examples; exact Node.js API field access unverified

### Tertiary (LOW confidence)
- `class_heritage` exact field name in Node.js tree-sitter API — search results show query syntax `(class_heritage ...)` but not the `.childForFieldName()` key; needs verification during implementation

## Metadata

**Confidence breakdown:**
- Grammar package identification and compatibility: HIGH — npm version checks run against installed tree-sitter@0.25.0
- Python/C/C++ AST node types: HIGH — verified from official node-types.json files
- Rust AST node types: HIGH — node-types.json + verified blog usage example
- Go kept on regex (D-06 conflict with AST-05): HIGH — locked decision in CONTEXT.md
- TS/JS re-exports detection: HIGH — existing code in ast-parser.ts already partially does this
- TS/JS inherits detection: MEDIUM — class_heritage field name needs verification during implementation
- Weight aggregation pattern: HIGH — straightforward Map accumulator
- Parity test design: HIGH — follows established vitest patterns in project

**Research date:** 2026-04-09
**Valid until:** 2026-05-09 (stable domain; tree-sitter grammars don't change node types in patch releases)
