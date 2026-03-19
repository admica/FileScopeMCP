# Phase 3: Semantic Change Detection - Research

**Researched:** 2026-03-17
**Domain:** AST parsing (tree-sitter), semantic diff classification, LLM fallback, SQLite schema extension
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### AST parser scope
- Focus on API surface vs internals distinction — the parser extracts exported symbols and their type signatures, not internal function structure
- Four classification buckets: exports changed, types changed, body only, comments only
- tree-sitter is the AST tool (tree-sitter-typescript, tree-sitter-javascript) — gives concrete syntax trees without requiring the full TypeScript compiler
- No need to analyze internal function bodies deeply — Phase 4 only cares about "does this change affect dependents?"

#### LLM fallback behavior
- For unsupported languages (Go, Rust, Python, etc.), queue an async LLM job with the file diff (not full file content)
- When no LLM is configured: classify changes as "unknown" — Phase 4 treats conservatively (marks all direct dependents stale). Safe default, no false negatives
- Cost control: truncate diffs over ~4K tokens; for very large files, fall back to "unknown" rather than burning tokens
- LLM fallback is async/queued using the pending LLM jobs table from Phase 1. Until the job completes, the change is classified as "unknown"

#### Change classification output (SemanticChangeSummary)
- Stable TypeScript interface with 6 fields:
  - `filePath: string` — the changed file
  - `changeType: "exports-changed" | "types-changed" | "body-only" | "comments-only" | "mixed" | "unknown"` — what kind of change
  - `affectsDependents: boolean` — derived from changeType (true for exports/types/mixed/unknown, false for body/comments)
  - `changedExports?: string[]` — names of exports that changed (TS/JS AST only, optional)
  - `confidence: "ast" | "llm" | "heuristic"` — how the classification was determined
  - `timestamp: number` — when the change was detected
- `"mixed"` covers edits that change both exports and body in one save
- `"unknown"` is the safe conservative default

#### Regex replacement strategy
- Replace TS/JS import parsing regex (file-utils.ts lines 50-53) with tree-sitter AST extraction — eliminates false positives from string literals, comments, and template literals (CHNG-04)
- Keep existing regex parsers for all other languages (Python, Rust, Go, Lua, etc.) — they work adequately for import/dependency extraction
- Dispatch based on file extension: TS/JS -> tree-sitter, everything else -> regex
- No scope creep into other language AST parsers — deferred to v2 (LANG-01, LANG-02)

#### Previous version storage for diffing
- Store extracted exports snapshot in SQLite (JSON column on the files table) after each successful parse
- On next file change, compare new parse result against stored snapshot to produce the semantic diff
- No git dependency — works in non-git directories
- Avoids needing to cache full ASTs in memory

### Claude's Discretion
- tree-sitter native addon build pipeline details (external flags, .node file copying)
- Exact tree-sitter query patterns for extracting exports and type signatures
- LLM prompt design for unsupported language diff classification
- Error handling when tree-sitter parsing fails (fall back to "unknown")
- Performance: no AST caching needed — tree-sitter parses typical files in ~1-5ms

### Deferred Ideas (OUT OF SCOPE)
- Python AST support in semantic change detection — v2 (LANG-01)
- Rust/Go/C++ language-aware LLM prompting — v2 (LANG-02)
- Targeted cascade using changedExports list — Phase 4 enhancement (start with boolean)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CHNG-01 | System performs AST-level diff on changed TS/JS files to distinguish export/type signature changes from body-only changes | tree-sitter 0.25 + tree-sitter-typescript 0.23 provide CST; export_statement queries extract API surface; exports_snapshot column in SQLite enables before/after comparison |
| CHNG-02 | AST diff produces a typed SemanticChangeSummary that classifies what changed (exports, types, body, comments) | Stable TypeScript interface with 6 fields defined in CONTEXT.md; derived affectsDependents boolean drives Phase 4 |
| CHNG-03 | For unsupported languages, system falls back to LLM-powered diff to summarize what semantically changed | llm_jobs table already exists in schema; diff truncation pattern documented; async queue wired in Phase 1 |
| CHNG-04 | Body-only changes (internal logic, comments) only re-evaluate the changed file's own metadata, not dependents | tree-sitter AST extraction replaces regex in file-utils.ts lines 50-53; dispatch by extension pattern documented |
| CHNG-05 | Export/type changes trigger cascade to direct dependents, marking their metadata stale | affectsDependents boolean in SemanticChangeSummary is the signal; wire into coordinator.ts handleFileEvent() before updateFileNodeOnChange() |
</phase_requirements>

---

## Summary

Phase 3 introduces tree-sitter as the AST engine for TypeScript/JavaScript files, replacing the existing regex-based import parser and adding semantic change classification. The core problem is: when a file changes, did its API surface change (requiring dependent files to be re-evaluated) or did only internal implementation change? tree-sitter parses the CST and queries extract exported symbols; comparing the current snapshot against a previously stored SQLite snapshot yields the classification.

The build pipeline challenge is the main technical risk. tree-sitter is a native Node.js addon (.node binary) that cannot be bundled by esbuild. The project already uses this pattern successfully with better-sqlite3: since the esbuild build script does NOT use --bundle (confirmed in package.json scripts), native addons resolve from node_modules at runtime without any special esbuild flags. This is the same resolution that already works for better-sqlite3 and is the safest path. No .node file copying or --external flags are required unless --bundle mode is added.

For unsupported languages, the LLM fallback queues an async job using the llm_jobs table from Phase 1. Until the job completes the change is classified "unknown" (conservative), and the classification is updated in-place when the LLM responds. The LLM prompt receives the diff text and must return one of the changeType enum values with a rationale.

**Primary recommendation:** Use tree-sitter 0.25 (native Node bindings via createRequire) + tree-sitter-typescript 0.23 with S-expression queries targeting export_statement, interface_declaration, type_alias_declaration, and enum_declaration nodes. Since esbuild is not in --bundle mode, native addons resolve from node_modules without special flags — validate this assumption early in plan 03-01.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| tree-sitter | 0.25.0 | Native Node.js CST parsing engine | Locked decision; fastest Node parser; no TS compiler dependency |
| tree-sitter-typescript | 0.23.2 | TypeScript + TSX grammar | Official grammar; covers all TS export/type node types |
| tree-sitter-javascript | (latest) | JavaScript grammar | Required for .js/.jsx; separate from TS grammar |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| drizzle-orm | 0.45.1 (existing) | Extend schema with exports_snapshot column | Already in project; migrate via Drizzle |
| better-sqlite3 | 12.6.2 (existing) | Read/write exports_snapshot JSON blob | Already in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| tree-sitter (native) | web-tree-sitter (WASM) | WASM is slower in Node.js but avoids native addon; locked decision says use native tree-sitter |
| tree-sitter (native) | TypeScript compiler API (ts-morph) | ts-morph is far heavier — requires full type resolution; tree-sitter only needs CST |
| Custom diff of export snapshots | tree-sitter incremental re-parse | Snapshot diff is simpler and avoids AST memory pressure; locked decision |

**Installation:**
```bash
npm install tree-sitter tree-sitter-typescript tree-sitter-javascript
```

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── change-detector/
│   ├── change-detector.ts         # Main ChangeDetector class — public entry point
│   ├── ast-parser.ts              # tree-sitter CST extraction; returns ExportSnapshot
│   ├── semantic-diff.ts           # Compares old/new ExportSnapshot; produces SemanticChangeSummary
│   ├── llm-diff-fallback.ts       # Queues llm_job for unsupported languages
│   └── types.ts                   # SemanticChangeSummary, ExportSnapshot interfaces
├── coordinator.ts                 # Wire ChangeDetector into handleFileEvent()
├── db/
│   └── schema.ts                  # Add exports_snapshot column to files table
└── file-utils.ts                  # Replace TS/JS regex with AST extraction call
```

### Pattern 1: Native Addon Loading in ESM via createRequire

The project is fully ESM (`"type": "module"` in package.json, ESM throughout source). tree-sitter's npm package provides CommonJS bindings with a native .node file. Load it using the established project pattern (same as better-sqlite3):

```typescript
// src/change-detector/ast-parser.ts
// Source: tree-sitter Node.js bindings docs, createRequire pattern
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Parser = require('tree-sitter') as typeof import('tree-sitter');
const TypeScriptGrammar = require('tree-sitter-typescript').typescript;
const TSXGrammar = require('tree-sitter-typescript').tsx;
const JavaScriptGrammar = require('tree-sitter-javascript');
```

**When to use:** Always — this is the only supported pattern for native addons in ESM Node.js projects.

**Note on esbuild:** Since the project build script does NOT use `--bundle` (confirmed in package.json), native addons resolve from node_modules at runtime. No `--external` flags or .node file copying are required. If `--bundle` is ever added, tree-sitter must be marked external just like better-sqlite3.

### Pattern 2: ExportSnapshot Type and Storage

Store the extracted API surface as a JSON blob in SQLite after every successful parse. On next change, compare old vs. new snapshot to classify the change.

```typescript
// src/change-detector/types.ts
export interface ExportedSymbol {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'default';
  // Signature text — the declaration line, not the body
  // e.g., "export function foo(a: string): number"
  signature: string;
}

export interface ExportSnapshot {
  filePath: string;
  exports: ExportedSymbol[];
  imports: string[];   // resolved import paths — replaces regex extraction
  capturedAt: number;  // ms timestamp
}

export interface SemanticChangeSummary {
  filePath: string;
  changeType: 'exports-changed' | 'types-changed' | 'body-only' | 'comments-only' | 'mixed' | 'unknown';
  affectsDependents: boolean;
  changedExports?: string[];
  confidence: 'ast' | 'llm' | 'heuristic';
  timestamp: number;
}
```

### Pattern 3: tree-sitter Query for TypeScript Exports

Use S-expression queries on the tree-sitter CST to extract all exported symbols and import paths:

```typescript
// src/change-detector/ast-parser.ts
// Source: tree-sitter query docs + tree-sitter-typescript node-types.json

// Query for all export forms in TypeScript/JS:
const EXPORT_QUERY = `
  (export_statement
    declaration: (_) @declaration)
  (export_statement
    value: (_) @default_value)
`;

// Query for import paths (replaces regex in file-utils.ts lines 50-53):
const IMPORT_QUERY = `
  (import_statement
    source: (string (string_fragment) @import_path))
  (call_expression
    function: (identifier) @require_id
    (#eq? @require_id "require")
    arguments: (arguments (string (string_fragment) @import_path)))
`;

// Usage:
const tsParser = new Parser();
tsParser.setLanguage(TypeScriptGrammar);

function extractSnapshot(filePath: string, source: string): ExportSnapshot {
  const tree = tsParser.parse(source);
  const exportQuery = tsParser.getLanguage().query(EXPORT_QUERY);
  const importQuery = tsParser.getLanguage().query(IMPORT_QUERY);
  // ... process captures
}
```

**Export node types to handle:**
- `export_statement` + `declaration` field → named exports (`export function`, `export class`, `export const`, `export type`, `export interface`, `export enum`)
- `export_statement` + `value` field → default exports (`export default`)
- No `source` field → not a re-export

**TypeScript-specific export node types (within `declaration`):**
- `function_declaration` — `export function foo()`
- `class_declaration` — `export class Foo`
- `lexical_declaration` — `export const/let foo`
- `type_alias_declaration` — `export type Foo = ...`
- `interface_declaration` — `export interface Foo`
- `enum_declaration` — `export enum Foo`

### Pattern 4: Semantic Diff Logic

```typescript
// src/change-detector/semantic-diff.ts
export function computeSemanticDiff(
  prev: ExportSnapshot | null,
  next: ExportSnapshot,
): SemanticChangeSummary {
  // No previous snapshot → first parse, cannot determine change type
  if (!prev) {
    return { filePath: next.filePath, changeType: 'unknown', affectsDependents: true,
             confidence: 'ast', timestamp: Date.now() };
  }

  const prevNames = new Set(prev.exports.map(e => e.name));
  const nextNames = new Set(next.exports.map(e => e.name));
  const prevSigMap = new Map(prev.exports.map(e => [e.name, e.signature]));
  const nextSigMap = new Map(next.exports.map(e => [e.name, e.signature]));

  const added    = [...nextNames].filter(n => !prevNames.has(n));
  const removed  = [...prevNames].filter(n => !nextNames.has(n));
  const changed  = [...nextNames].filter(n => prevNames.has(n) && prevSigMap.get(n) !== nextSigMap.get(n));

  const importsChanged = JSON.stringify(prev.imports.sort()) !== JSON.stringify(next.imports.sort());

  const exportsDiffer = added.length > 0 || removed.length > 0 || changed.length > 0 || importsChanged;

  // Distinguish export changes from type-only changes
  // type_alias_declaration and interface_declaration are "types-changed"
  // function/class/variable are "exports-changed"
  // If both, "mixed"
  // If neither, "body-only" (signature unchanged, body likely changed)

  const changedExports = [...added, ...removed, ...changed];

  if (!exportsDiffer) {
    // No API surface change — internal body or comments changed
    // Heuristic: we cannot distinguish body-only from comments-only from AST alone
    // without full text analysis. Classify as body-only (Phase 4 safe).
    return { filePath: next.filePath, changeType: 'body-only', affectsDependents: false,
             confidence: 'ast', timestamp: Date.now() };
  }

  const onlyTypes = changedExports.every(name => {
    const sym = next.exports.find(e => e.name === name) ?? prev.exports.find(e => e.name === name);
    return sym?.kind === 'type' || sym?.kind === 'interface';
  });

  const changeType = onlyTypes ? 'types-changed' : 'exports-changed';

  return {
    filePath: next.filePath,
    changeType,
    affectsDependents: true,
    changedExports: changedExports.length > 0 ? changedExports : undefined,
    confidence: 'ast',
    timestamp: Date.now(),
  };
}
```

### Pattern 5: LLM Fallback for Unsupported Languages

```typescript
// src/change-detector/llm-diff-fallback.ts
// For non-TS/JS files: queue an async llm_job using the existing llm_jobs table.
// Returns "unknown" immediately; classification is updated when job completes.

const MAX_DIFF_TOKENS = 4000; // ~16KB of diff text

export function queueLlmDiffJob(
  filePath: string,
  diff: string,          // unified diff string, NOT full file
): SemanticChangeSummary {
  const truncatedDiff = diff.length > MAX_DIFF_TOKENS * 4
    ? diff.slice(0, MAX_DIFF_TOKENS * 4) + '\n... [truncated]'
    : diff;

  // Insert pending job into llm_jobs table (already exists in schema from Phase 1)
  // job_type: 'change_impact' is the closest match; Phase 5 will consume these
  insertLlmJob({
    file_path: filePath,
    job_type: 'change_impact',
    priority_tier: 2,
    payload: JSON.stringify({ diff: truncatedDiff }),
  });

  // Return conservative "unknown" immediately — Phase 4 handles this safely
  return {
    filePath,
    changeType: 'unknown',
    affectsDependents: true,
    confidence: 'heuristic',
    timestamp: Date.now(),
  };
}
```

**LLM prompt template for diff classification:**
```
You are a code change classifier. Analyze the following unified diff and classify what semantically changed.

Return ONLY a JSON object with these exact fields:
{
  "changeType": "<exports-changed|types-changed|body-only|comments-only|mixed|unknown>",
  "changedExports": ["<list of changed export names if applicable, else empty array>"],
  "rationale": "<one sentence>"
}

Rules:
- "exports-changed": functions, classes, or variables were added/removed/renamed in the public API
- "types-changed": only type aliases or interfaces changed
- "body-only": only internal implementation changed, no public API change
- "comments-only": only code comments changed
- "mixed": both API surface and internals changed
- "unknown": cannot determine from the diff

Diff:
{diff}
```

### Pattern 6: Integration Point in coordinator.ts

Wire ChangeDetector between the mutex lock and `updateFileNodeOnChange()`:

```typescript
// src/coordinator.ts — inside treeMutex.run() callback, case 'change':
case 'change':
  if (fileWatchingConfig.watchForChanged) {
    // 1. Run semantic change detection BEFORE updating file metadata
    const summary = await changeDetector.classify(filePath);
    log(`[Coordinator] SemanticChange for ${filePath}: ${summary.changeType} (affectsDependents=${summary.affectsDependents})`);

    // 2. Proceed with normal file update (updates mtime, imports, summary stale flag)
    await updateFileNodeOnChange(filePath, tempTree, projectRoot);

    // 3. Phase 4 CascadeEngine will consume summary.affectsDependents
    //    Store summary result for Phase 4 (can emit event or write to DB)
  }
  break;
```

### Anti-Patterns to Avoid

- **Caching ASTs in memory across file events:** ASTs are 2-10MB and go stale immediately. Always re-parse on each change event. tree-sitter parses a typical file in ~1-5ms.
- **Using tree-sitter for non-TS/JS files:** Only dispatch to AST parser for .ts/.tsx/.js/.jsx extensions. All other extensions use existing regex patterns or LLM fallback.
- **Parsing the full file content for LLM fallback:** Send the diff, not the full file. This controls token costs and focuses the LLM on what changed.
- **Blocking the mutex on LLM calls:** LLM jobs are async and queued — never await them within the treeMutex.run() callback. Return "unknown" immediately.
- **Missing the first-parse case:** When no previous snapshot exists (new file or first scan), return "unknown" rather than crashing. Store the snapshot for future comparisons.
- **Forgetting `export default` has `value` field, not `declaration`:** Default exports use a different AST field. Queries must handle both.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript/JS parsing | Custom tokenizer or regex for export detection | tree-sitter + tree-sitter-typescript | Regex fails on multiline exports, decorators, generics, string literals containing "export" |
| Import path extraction | Regex (existing IMPORT_PATTERNS for TS/JS) | tree-sitter IMPORT_QUERY | Regex matches imports inside comments and string literals, creating false dependency edges |
| AST query language | Manual tree traversal with childForFieldName() | tree-sitter S-expression queries | Queries are declarative, composable, and compiled to efficient C matchers |
| Diff computation | Myers diff algorithm | Simple JSON.stringify comparison of ExportSnapshot | For API surface classification, comparing structured name+signature pairs is sufficient and far simpler |

**Key insight:** tree-sitter's native Node bindings give you a full CST with field-named access in ~1-5ms per file — this is faster than any alternative and eliminates entire classes of parsing edge cases.

---

## Common Pitfalls

### Pitfall 1: Native Addon Not Found at Runtime
**What goes wrong:** `Error: Cannot find module 'tree-sitter'` or `.node file not found` after build.
**Why it happens:** If --bundle mode is ever enabled in esbuild, it will try to inline tree-sitter, which fails for native addons.
**How to avoid:** Verify the build script does NOT use --bundle (currently confirmed). If --bundle is added in future, add `--external:tree-sitter --external:tree-sitter-typescript --external:tree-sitter-javascript` to the esbuild command and copy .node files to dist/.
**Warning signs:** Build succeeds but `node dist/mcp-server.js` throws module resolution error.

### Pitfall 2: ESM + createRequire Type Errors
**What goes wrong:** TypeScript complains about the tree-sitter import; `Parser` type is inferred as `any`.
**Why it happens:** tree-sitter's type definitions use CommonJS exports; `createRequire` returns `any` without a cast.
**How to avoid:** Add `import type Parser from 'tree-sitter'` for the type, then use `createRequire` for the value. The cast `require('tree-sitter') as typeof import('tree-sitter')` gives you proper typing.
**Warning signs:** `parser.setLanguage(...)` shows no type checking; autocomplete doesn't work.

### Pitfall 3: Grammar Version Mismatch (ABI Incompatibility)
**What goes wrong:** `Error: Incompatible Language version 14. Expected 13` or similar at runtime when calling `setLanguage()`.
**Why it happens:** tree-sitter 0.25 bumped the ABI to 15. Grammar packages must be compiled against the same ABI. tree-sitter-typescript must be a version that supports ABI 15.
**How to avoid:** Install tree-sitter, tree-sitter-typescript, and tree-sitter-javascript together and test `parser.setLanguage(grammar)` in a spike before building the full component. Check that grammar `.node` files load without error.
**Warning signs:** `setLanguage()` throws at startup; grammar package versions are mismatched.

### Pitfall 4: TSX vs TypeScript Grammar Selection
**What goes wrong:** Parsing a `.tsx` file with the TypeScript (non-TSX) grammar fails or produces incorrect CST for JSX syntax.
**Why it happens:** TSX and TypeScript are different dialects in tree-sitter-typescript — JSX angle brackets conflict with TypeScript generics in the non-TSX grammar.
**How to avoid:** Dispatch grammar by extension: `.tsx` → TSXGrammar, `.ts` → TypeScriptGrammar, `.jsx` → JavaScriptGrammar (which handles JSX), `.js` → JavaScriptGrammar.
**Warning signs:** Parse errors or missing export nodes in `.tsx` files.

### Pitfall 5: `export default` Not Captured by `declaration` Query
**What goes wrong:** `export default function foo()` or `export default class Foo` not captured by the named export query.
**Why it happens:** Default exports use the `value` field on `export_statement`, not `declaration`. The node type may also be `function_expression` rather than `function_declaration` for anonymous defaults.
**How to avoid:** Write a separate query branch for `(export_statement value: (_) @default_value)`. For named defaults like `export default function foo`, the name is in the `value` subtree.
**Warning signs:** Functions/classes exported as default don't appear in ExportSnapshot.

### Pitfall 6: No Previous Snapshot on First File Change
**What goes wrong:** Null pointer error when comparing prev/next snapshots on a file that was never parsed before.
**Why it happens:** The `exports_snapshot` column is NULL for files scanned before Phase 3 was deployed.
**How to avoid:** Always null-check prev snapshot. If null, store the new snapshot and return `{ changeType: 'unknown', affectsDependents: true }` — safe conservative default.
**Warning signs:** Errors on the first change event after deployment.

### Pitfall 7: Diff Generation for LLM Fallback
**What goes wrong:** No diff available — only the new file content is accessible.
**Why it happens:** The coordinator doesn't currently store previous file content for non-TS/JS files.
**How to avoid:** For LLM fallback files, store a content hash or the previous mtime. On change, read the current content and generate a simple diff. Since full git integration is out of scope, use Node.js `fs` to read current content and compare against a cached version. If no previous content cached, read the new file and classify as "unknown".
**Warning signs:** LLM prompt receives empty or single-sided diff.

---

## Code Examples

### Loading tree-sitter in ESM with createRequire
```typescript
// Source: tree-sitter Node.js bindings docs + project pattern (same as better-sqlite3)
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Parser = require('tree-sitter') as typeof import('tree-sitter');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { typescript: TypeScriptLang, tsx: TSXLang } = require('tree-sitter-typescript') as {
  typescript: unknown;
  tsx: unknown;
};
const JavaScriptLang = require('tree-sitter-javascript') as unknown;

const tsParser = new Parser();
tsParser.setLanguage(TypeScriptLang);

const tsxParser = new Parser();
tsxParser.setLanguage(TSXLang);

const jsParser = new Parser();
jsParser.setLanguage(JavaScriptLang);
```

### Querying Exports from a TypeScript File
```typescript
// Source: tree-sitter query docs — https://tree-sitter.github.io/tree-sitter/using-parsers
// Node types from tree-sitter-typescript grammar

function parseExports(source: string, language: 'ts' | 'tsx' | 'js' | 'jsx'): ExportedSymbol[] {
  const parser = getParserForLanguage(language);
  const tree = parser.parse(source);

  // Named exports: export function/class/const/type/interface/enum
  const namedQuery = parser.getLanguage().query(`
    (export_statement
      declaration: (_) @decl)
  `);

  // Default exports: export default <expr|function|class>
  const defaultQuery = parser.getLanguage().query(`
    (export_statement
      value: (_) @val)
  `);

  const exports: ExportedSymbol[] = [];

  for (const { node } of namedQuery.matches(tree.rootNode).flatMap(m => m.captures)) {
    const name = node.childForFieldName('name')?.text ?? '';
    if (!name) continue;
    const kind = nodeTypeToKind(node.type);
    exports.push({ name, kind, signature: extractSignatureLine(node, source) });
  }

  for (const { node } of defaultQuery.matches(tree.rootNode).flatMap(m => m.captures)) {
    const name = node.childForFieldName('name')?.text ?? 'default';
    exports.push({ name: name || 'default', kind: 'default', signature: extractSignatureLine(node, source) });
  }

  return exports;
}
```

### Querying Import Paths (Replaces Regex)
```typescript
// Source: tree-sitter-javascript/typescript grammar node types
// Eliminates false positives from string literals and comments (CHNG-04)

function parseImports(source: string, language: 'ts' | 'tsx' | 'js' | 'jsx'): string[] {
  const parser = getParserForLanguage(language);
  const tree = parser.parse(source);

  const query = parser.getLanguage().query(`
    (import_statement
      source: (string (string_fragment) @path))
    (export_statement
      source: (string (string_fragment) @path))
    (call_expression
      function: (identifier) @fn (#eq? @fn "require")
      arguments: (arguments (string (string_fragment) @path)))
    (call_expression
      function: (import) @fn
      arguments: (arguments (string (string_fragment) @path)))
  `);

  return query.matches(tree.rootNode)
    .flatMap(m => m.captures)
    .filter(c => c.name === 'path')
    .map(c => c.node.text);
}
```

### Schema Addition for exports_snapshot
```typescript
// src/db/schema.ts — add to files table
export const files = sqliteTable('files', {
  // ... existing columns ...
  exports_snapshot: text('exports_snapshot'),  // JSON blob: ExportSnapshot | null
});
```

### Drizzle migration via raw SQL (consistent with Phase 1 pattern)
```typescript
// In a migration script called from runMigrationIfNeeded()
db.run(sql`ALTER TABLE files ADD COLUMN exports_snapshot TEXT`);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex-based import parsing for TS/JS | tree-sitter AST extraction | Phase 3 | Eliminates false positives from string literals, template literals, and comments in imports |
| No change classification | SemanticChangeSummary with 6-value changeType | Phase 3 | Enables body-only changes to skip dependent re-evaluation |
| nan-based Node bindings for tree-sitter | Node-API bindings (tree-sitter 0.22+) | tree-sitter 0.22 (2023) | More stable across Node.js versions; required for Node 22 compatibility |

**Deprecated/outdated:**
- `tree-sitter` versions before 0.22: Used NAN which requires recompile per Node version. 0.25 uses Node-API (napi). Use 0.25.
- Regex import patterns for .ts/.tsx/.js/.jsx (IMPORT_PATTERNS in file-utils.ts lines 50-53): Will be replaced by AST extraction in 03-02.

---

## Open Questions

1. **Build pipeline: esbuild --bundle flag future risk**
   - What we know: Current build script does NOT use --bundle; native addons resolve from node_modules at runtime (confirmed working for better-sqlite3)
   - What's unclear: Whether the plan will ever need --bundle mode; if so, the --external + .node copy pattern must be added
   - Recommendation: Validate tree-sitter loads correctly in a spike (plan 03-01) before designing the full component. Do NOT assume it works without testing.

2. **Grammar ABI compatibility between tree-sitter 0.25 and grammar packages**
   - What we know: tree-sitter 0.25 uses ABI 15. Grammar packages must be compiled for the same ABI.
   - What's unclear: Exact version of tree-sitter-typescript and tree-sitter-javascript that ships with ABI 15 support
   - Recommendation: Run `npm install tree-sitter tree-sitter-typescript tree-sitter-javascript` and immediately test `tsParser.setLanguage(TypeScriptLang)` — if it throws, roll back to a lower version pair.

3. **Diff generation for LLM fallback without git**
   - What we know: Coordinator has access to the file path and can read current content. No git dependency.
   - What's unclear: Whether previous file content needs to be stored separately, or if the exports_snapshot column (which only covers TS/JS) is sufficient
   - Recommendation: For LLM fallback languages, store a `content_hash` or previous raw content snapshot in a separate column or cache. The simplest approach: add `content_snapshot TEXT` to the files table for LLM-fallback files (similar to exports_snapshot). This is a Phase 3 schema decision to make during planning.

4. **`comments-only` classification accuracy**
   - What we know: tree-sitter CST includes comment nodes. Distinguishing "only comments changed" from "body changed" requires checking whether all non-comment CST nodes are identical.
   - What's unclear: Cost-benefit of implementing this vs. folding comments into "body-only" (same Phase 4 behavior — no cascade)
   - Recommendation: Treat `comments-only` as a sub-case of `body-only` for now — both have `affectsDependents: false`. Implement the distinction only if Phase 4 or LLM pipeline needs it.

---

## Sources

### Primary (HIGH confidence)
- https://tree-sitter.github.io/node-tree-sitter/ — Node.js bindings API, Parser class, setLanguage, parse() usage
- https://github.com/tree-sitter/node-tree-sitter — Node-API bindings, ESM createRequire pattern, version 0.25
- https://github.com/tree-sitter/tree-sitter-typescript — grammar for TypeScript/TSX, export_statement node types, v0.23.2
- https://www.npmjs.com/package/tree-sitter — version 0.25.0 confirmed
- https://www.npmjs.com/package/web-tree-sitter — v0.26.6 (WASM alternative, confirmed NOT chosen)

### Secondary (MEDIUM confidence)
- Multiple WebSearch results confirming tree-sitter query S-expression syntax for export_statement, type_alias_declaration, interface_declaration
- esbuild issue #1051 confirming native .node module handling patterns
- tree-sitter PR #4208 confirming WASM + file loader pattern (not needed for native path)
- WebSearch confirming ABI 15 introduced in tree-sitter 0.25.0

### Tertiary (LOW confidence)
- LLM prompt design for code diff classification — no authoritative source found; prompt template in this document is original design based on the structured output pattern

---

## Metadata

**Confidence breakdown:**
- Standard stack (tree-sitter 0.25 + grammars): HIGH — confirmed versions on npm, official docs read
- Build pipeline (no --bundle = no special flags): HIGH — confirmed in package.json; same pattern as better-sqlite3
- AST query patterns: MEDIUM — S-expression syntax confirmed; exact captures need validation in spike
- LLM fallback prompt design: LOW — original design, no authoritative source; validate in plan 03-02
- Grammar ABI compatibility: MEDIUM — ABI 15 in 0.25 confirmed; exact grammar package versions need runtime validation

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (tree-sitter is stable; grammar ABI compatibility should not change within a minor version)
