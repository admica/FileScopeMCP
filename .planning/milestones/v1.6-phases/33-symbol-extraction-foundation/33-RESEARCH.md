# Phase 33: Symbol Extraction Foundation - Research

**Researched:** 2026-04-23
**Domain:** tree-sitter AST node structure, Drizzle ORM schema extension, better-sqlite3 transaction patterns, coordinator startup sequencing
**Confidence:** HIGH — all findings verified against live codebase or runtime probe

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Extend `extractRicherEdges()` in `src/change-detector/ast-parser.ts` to emit `symbols: Symbol[]` and per-import metadata in a single walk. `extractSnapshot()` untouched.
- D-02: New `Symbol` interface (distinct from `ExportedSymbol`). Kinds: `function | class | interface | type | enum | const`. Fields: `startLine`, `endLine`, `isExport`.
- D-03: Rename entry point if return shape deviates enough; otherwise widen `extractRicherEdges` return. Planner decides.
- D-04: JSX components = `function` kind. No `component` kind.
- D-05: Re-exports do NOT produce symbol rows. Direct declarations only.
- D-06: Named default exports emit under declared name. Anonymous defaults skipped.
- D-07: New `symbols` table via Drizzle schema + migration `0005_add_symbols_and_import_metadata.sql`. Columns: path, name, kind, start_line, end_line, is_export. No FK.
- D-08: Additive columns on `file_dependencies`: `imported_names TEXT` (JSON), `import_line INTEGER`. Multi-import-same-edge → separate rows.
- D-09: Namespace imports → `imported_names = ["*"]`.
- D-10: Non-TS/JS rows keep NULL.
- D-11: One-shot bulk extraction gated by `kv_state` table row or schema_version row. Coordinator checks after `migrate()`.
- D-12: Bulk extraction synchronous at startup. Per-file fail = log+continue.
- D-13: No lazy per-query extraction.
- D-14: `upsertSymbols` = DELETE WHERE path + bulk INSERT in a txn.
- D-15: `upsertSymbols` shares same per-file transaction as `setEdges`.
- D-16–D-18: `scripts/inspect-symbols.mjs` CLI, `"inspect-symbols"` npm script. Default plain-text, `--json` → JSONL. Reads file directly, no DB.
- D-19–D-21: `scripts/bench-scan.mjs`, `"bench-scan"` npm script. Measures self-scan + medium-repo fixture. Output to `.planning/phases/33-symbol-extraction-foundation/baseline.json`. Committed BEFORE any symbol code.
- D-22: AST node type → kind mapping (finalized in CONTEXT.md).

### Claude's Discretion
- Exact migration filename numbering (0005_...) and Drizzle schema diff output layout
- Whether to introduce a `kv_state` table or reuse `schema_version` row for the bulk-extraction flag
- Exact internal name of the extended parser function
- Parser internals for walking `lexical_declaration` to extract multiple `const` bindings
- Fixture choice for `medium-repo` benchmark
- Transaction granularity inside `upsertSymbols`

### Deferred Ideas (OUT OF SCOPE)
- Python/Go/Ruby symbol extraction (v1.7)
- Per-query lazy symbol extraction
- React component kind (separate from function)
- FileWatcher symbol re-extraction (Phase 35)
- `find_symbol` MCP tool (Phase 34)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYM-01 | Parser extracts top-level symbols (name, kind, startLine, endLine, isExport) | §AST Node Structure confirms all 6 kinds + non-exported top-levels |
| SYM-02 | Single-pass AST walk | §Extending extractRicherEdges: single visitNode loop covers both |
| SYM-03 | `symbols` table + additive migration | §Drizzle Schema Extension details exact column definitions |
| SYM-04 | Repository functions: upsertSymbols, getSymbolsByName, getSymbolsForFile, deleteSymbolsForFile | §Repository Pattern confirms transaction shape |
| SYM-05 | Migration-time bulk extraction (one-shot) | §Coordinator Startup Sequence identifies hook point |
| SYM-06 | `npm run inspect-symbols <path>` CLI | §CLI Pattern shows ESM structure from register-mcp.mjs |
| SYM-07 | JSX components as function kind | §Arrow Functions Assigned to Const confirms value.type === arrow_function |
| SYM-08 | Re-exports do NOT populate symbols | §Re-export Detection: `has_source=true → skip` |
| IMP-01 | Imported names + line per dep edge (same AST pass) | §Import Name Extraction confirms row+1 for line |
| IMP-02 | Namespace imports → `["*"]` | §Import Name Extraction probed and confirmed |
| IMP-03 | Additive schema for imported_names + import_line | §Drizzle Schema Extension: two new nullable columns |
| PERF-01 | Baseline captured BEFORE any Phase 33 implementation code | §Benchmark Script documents bench-scan design |
</phase_requirements>

---

## Summary

Phase 33 extends the existing TS/JS AST pipeline in three coordinated layers: (1) the parser emits symbols and per-import metadata from the same tree walk as edge extraction, (2) the schema gains a `symbols` table and two additive columns on `file_dependencies`, and (3) the coordinator runs a one-shot bulk extraction at first startup after the schema migration. The locked decisions are internally consistent and verified against the live codebase.

The key architectural insight is that the tree-sitter walk in `extractRicherEdges()` already visits every top-level node. The implementation adds two accumulators to that walk: a `symbols: Symbol[]` array (populated by visiting `export_statement` → declaration, or bare top-level declarations for isExport=false symbols) and a `perImportMeta` array (populated by extending the existing `import_statement` branch to capture `importedNames[]` and `line`). Both accumulators are returned in a widened `RicherEdgeData` interface, threaded through `extractTsJsEdges()` in `language-config.ts`, and written by a new `upsertSymbols()` repo function inside the existing `setEdges()` transaction.

The `schema_version` table already exists but is currently unused at runtime (no INSERT or SELECT against it anywhere in `src/`). A new `kv_state` table is the cleaner approach — it avoids repurposing a single-row integer table to carry string key-value pairs.

**Primary recommendation:** Widen `extractRicherEdges`'s return type in-place (don't rename to avoid touching all callers), use a new `kv_state` table for the bulk-extraction gate, and write `upsertSymbols` using raw better-sqlite3 prepared statements (not Drizzle ORM) to match the rest of the repo's transaction pattern.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Symbol extraction (AST) | `src/change-detector/ast-parser.ts` | `src/language-config.ts` (wiring) | AST walk lives here; language-config threads output to coordinator |
| Symbol type definition | `src/db/symbol-types.ts` (new file) | `src/change-detector/types.ts` (untouched) | Keeps phase-33 Symbol distinct from ExportedSymbol |
| DB schema | `src/db/schema.ts` | `drizzle/0005_*.sql` | Drizzle schema is source of truth; migration is generated |
| Symbol persistence | `src/db/repository.ts` | — | All DB writes go through repository |
| Per-file atomic write | `src/db/repository.ts` (`setEdges` + `upsertSymbols`) | `src/language-config.ts` (caller) | Transaction wraps both writes for one file |
| Bulk extraction at startup | `src/coordinator.ts` (`init()` method) | `src/db/repository.ts` (reads/writes) | Coordinator owns startup sequencing |
| One-shot gate (kv_state) | `src/db/repository.ts` | `src/db/schema.ts` | Gate read/write is a repository concern |
| `inspect-symbols` CLI | `scripts/inspect-symbols.mjs` | `src/change-detector/ast-parser.ts` | Standalone, exercises parser only |
| `bench-scan` CLI | `scripts/bench-scan.mjs` | `src/coordinator.ts` (invoked via init) | Standalone, times coordinator.init() wall-clock |

---

## Standard Stack

### Core (all already installed — no new dependencies needed)

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| tree-sitter | ^0.25.0 | AST parsing engine | [VERIFIED: package.json] |
| tree-sitter-typescript | ^0.23.2 | TS + TSX grammars | [VERIFIED: package.json] |
| tree-sitter-javascript | ^0.25.0 | JS + JSX grammar | [VERIFIED: package.json] |
| better-sqlite3 | ^12.6.2 | Synchronous SQLite transactions | [VERIFIED: package.json] |
| drizzle-orm | ^0.45.1 | Schema definition; migrations via migrate() | [VERIFIED: package.json] |
| drizzle-kit | ^0.31.9 | `npx drizzle-kit generate` produces migration SQL | [VERIFIED: npm view + drizzle-kit --version] |

**Installation:** No new npm installs required. All needed packages already in dependencies.

---

## Architecture Patterns

### System Architecture Diagram

```
File on disk
     │
     ▼
extractRicherEdges(filePath, source)        ← ast-parser.ts [EXTENDED]
     │
     ├─► regularImports[]          ─┐
     ├─► reExportSources[]          │ (existing)
     ├─► inheritsFrom[]            ─┘
     │
     ├─► symbols: Symbol[]         ← NEW: from export_statement + bare top-level nodes
     └─► perImportMeta[]           ← NEW: {specifier, importedNames, line} per import_statement
               │
               ▼
extractTsJsEdges(filePath, content, root)   ← language-config.ts [EXTENDED]
     │
     ├─► edges: EdgeResult[]
     └─► {symbols, perImportMeta}
               │
               ▼
coordinator buildFileTree / handleFileEvent
     │
     └─► per-file transaction (better-sqlite3)
              ├── setEdges(path, edges, perImportMeta)  ← repository.ts [EXTENDED]
              └── upsertSymbols(path, symbols)           ← repository.ts [NEW]
```

**Startup bulk extraction path:**

```
coordinator.init(projectPath)
     │
     ├── openDatabase(dbPath)      ← runs migrate() automatically
     ├── runMigrationIfNeeded()    ← JSON-to-SQLite one-time migration
     ├── runSymbolsBulkExtraction()   ← NEW, synchronous, gated by kv_state row
     │      │
     │      ├── getKvState('symbols_bulk_extracted') → if set: return (no-op)
     │      ├── getAllFiles().filter(isTS/JS)
     │      │     └── for each: readFile → extractRicherEdges → upsertSymbols
     │      │           (per-file try/catch; log+continue on failure)
     │      └── setKvState('symbols_bulk_extracted', ISO timestamp)
     │
     ├── buildFileTree(newConfig)
     ├── initializeFileWatcher()
     ├── runStartupIntegritySweep()
     └── _initialized = true
```

### Recommended Project Structure (new files only)

```
src/
├── db/
│   ├── symbol-types.ts       # New Symbol interface + SymbolKind union type
│   ├── schema.ts             # Extended: symbols table + kv_state table + 2 columns on file_dependencies
│   └── repository.ts         # Extended: upsertSymbols, getSymbolsByName, getSymbolsForFile, deleteSymbolsForFile, getKvState, setKvState
├── change-detector/
│   └── ast-parser.ts         # Extended: RicherEdgeData widened, symbol walking logic added
scripts/
├── inspect-symbols.mjs       # New ESM CLI
└── bench-scan.mjs            # New ESM CLI
drizzle/
└── 0005_add_symbols_and_import_metadata.sql   # Generated by drizzle-kit generate
.planning/phases/33-symbol-extraction-foundation/
└── baseline.json             # Output of bench-scan run BEFORE any symbol code
```

---

## AST Node Structure: Verified Findings

All findings below verified by live runtime probe of tree-sitter-typescript@0.23.2. [VERIFIED: runtime probe 2026-04-23]

### Kind Mapping (D-22 confirmed)

For **exported** symbols — always inside an `export_statement` node:

| Top-level export shape | declaration field type | name field | Phase 33 kind |
|------------------------|----------------------|------------|---------------|
| `export function foo() {}` | `function_declaration` | `childForFieldName('name').text` | `function` |
| `export function* gen() {}` | `generator_function_declaration` | `childForFieldName('name').text` | `function` |
| `export class Foo {}` | `class_declaration` | `childForFieldName('name').text` | `class` |
| `export interface IFoo {}` | `interface_declaration` | `childForFieldName('name').text` | `interface` |
| `export type T = string;` | `type_alias_declaration` | `childForFieldName('name').text` | `type` |
| `export enum Color {}` | `enum_declaration` | `childForFieldName('name').text` | `enum` |
| `export const X = 1;` | `lexical_declaration` (keyword=`const`) | via `variable_declarator` children | `const` |
| `export let Y = 1;` | `lexical_declaration` (keyword=`let`) | — | **skip** |
| `export var Z = 1;` | `variable_declaration` | — | **skip** |
| `export default function foo() {}` | `function_declaration` | `childForFieldName('name').text` = `foo` | `function` (isExport=true) |
| `export default function() {}` | `undefined` (no declaration field) | — | **skip** (D-06) |
| `export default class Foo {}` | `class_declaration` | `childForFieldName('name').text` | `class` (isExport=true) |
| `export default class {}` | anonymous | name=null | **skip** |
| `export { x } from './foo'` | — has `source` field | — | **skip** (D-05: re-export) |
| `export * from './foo'` | — has `source` field | — | **skip** (D-05) |
| `export type { X } from './types'` | — has `source` field | — | **skip** (D-05) |

For **non-exported** symbols — direct children of `rootNode` (NOT wrapped in `export_statement`):

| Top-level bare node type | name field | Phase 33 kind | isExport |
|--------------------------|-----------|---------------|---------|
| `function_declaration` | `childForFieldName('name').text` | `function` | false |
| `class_declaration` | `childForFieldName('name').text` | `class` | false |
| `interface_declaration` | `childForFieldName('name').text` | `interface` | false |
| `type_alias_declaration` | `childForFieldName('name').text` | `type` | false |
| `enum_declaration` | `childForFieldName('name').text` | `enum` | false |
| `lexical_declaration` with `const` keyword | via `variable_declarator` | `const` | false |
| `lexical_declaration` with `let` keyword | — | — | **skip** |
| `variable_declaration` (var) | — | — | **skip** |
| `ambient_declaration` (declare ...) | — | — | **skip** (see Pitfalls §1) |

### Arrow Function Const Binding (D-22: const foo = () => {} → function kind)

When a `lexical_declaration` has `const` keyword and a `variable_declarator` whose `value` field type is `arrow_function`, emit it as kind=`function` with the binding name (not kind=`const`). [VERIFIED: runtime probe]

```typescript
// In the lexical_declaration const-handling branch:
const vdecl = declNode.children.find(c => c.type === 'variable_declarator');
const nameNode = vdecl?.childForFieldName('name');
const valNode  = vdecl?.childForFieldName('value');
const isArrow  = valNode?.type === 'arrow_function';
const kind     = isArrow ? 'function' : 'const';
```

### Multiple Bindings in One `const` Declaration

`export const a = 1, b = 2;` — the `lexical_declaration` node has MULTIPLE `variable_declarator` children. Iterate all of them. [VERIFIED: runtime probe]

```typescript
for (let i = 0; i < declNode.childCount; i++) {
  const child = declNode.child(i);
  if (child.type === 'variable_declarator') {
    const nameNode = child.childForFieldName('name');
    const valNode  = child.childForFieldName('value');
    if (nameNode?.text) {
      const isArrow = valNode?.type === 'arrow_function';
      symbols.push({ name: nameNode.text, kind: isArrow ? 'function' : 'const', ... });
    }
  }
}
```

### Line Numbers: 0-Indexed → 1-Indexed Conversion

`node.startPosition.row` is 0-indexed. `node.endPosition.row` is 0-indexed. [VERIFIED: runtime probe]

```typescript
startLine: node.startPosition.row + 1,   // 1-indexed
endLine:   node.endPosition.row + 1,     // 1-indexed
```

Use `export_statement` (or the bare top-level node) `.startPosition.row` for the symbol's startLine, `.endPosition.row` for endLine. For export statements, the export_statement node and its declaration child have the same row span. [VERIFIED: runtime probe showing both yield startRow:0, endRow:7 for same multiline function]

### Decorator-Wrapped Classes

`@Component(...) export class Foo {}` — tree-sitter wraps the decorator annotation INSIDE the `export_statement`. The `declaration` field of the export_statement is `class_declaration` with correct name. The `startPosition.row` of the export_statement starts at the decorator line. [VERIFIED: runtime probe]

This means for decorated classes, `startLine` correctly captures the decorator start — which is the right behavior for a "find where this class starts" use case.

---

## Import Name Extraction: Verified Findings

[VERIFIED: runtime probe 2026-04-23]

### Names Per Import Statement

| Import shape | importedNames encoding | line |
|--------------|----------------------|------|
| `import { useState, useEffect } from 'react'` | `["useState", "useEffect"]` | `node.startPosition.row + 1` |
| `import React from './module'` | `["default"]` | `node.startPosition.row + 1` |
| `import * as ns from './namespace'` | `["*"]` | `node.startPosition.row + 1` |
| `import React, { useState } from 'react'` | `["default", "useState"]` | same line, same row |
| `import { foo as localFoo } from './utils'` | `["foo"]` | note: original name, not alias |

**Aliased imports:** `import { foo as bar }` — use the **original name** (`foo` = `nameNode.childForFieldName('name').text`), not the local alias (`bar` = `nameNode.childForFieldName('alias').text`). The original name is what the source module exports. [VERIFIED: runtime probe]

### Walk Pattern for importedNames Array

The existing `buildImportNameMap()` function in `ast-parser.ts` already walks `import_specifier`, default `identifier`, and `namespace_import` nodes correctly. A sibling function can reuse the same traversal pattern but return `string[]` instead of building a Map:

```typescript
function extractImportedNames(importNode: any): string[] {
  const names: string[] = [];
  function walk(node: any): void {
    if (node.type === 'import_specifier') {
      const nameNode = node.childForFieldName('name');
      if (nameNode) names.push(nameNode.text as string);
    } else if (node.type === 'identifier' && node.parent?.type === 'import_clause') {
      names.push('default');                          // default import
    } else if (node.type === 'namespace_import') {
      names.push('*');                                // D-09: namespace
    }
    for (let i = 0; i < node.childCount; i++) walk(node.child(i));
  }
  walk(importNode);
  return names;
}
```

### import_line Semantics Confirmed

All named imports in a single `import { a, b, c } from './mod'` statement share the same `import_statement` node. `node.startPosition.row + 1` gives the source line of that single import statement. This matches IMP-01 wording ("source line for each dependency edge") — one edge row per `(source, target)` pair, one line number per edge. [VERIFIED: runtime probe]

---

## Drizzle Schema Extension

### New `symbols` Table (D-07)

Add to `src/db/schema.ts`:

```typescript
export const symbols = sqliteTable('symbols', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  path:       text('path').notNull(),
  name:       text('name').notNull(),
  kind:       text('kind').notNull(),
  start_line: integer('start_line').notNull(),
  end_line:   integer('end_line').notNull(),
  is_export:  integer('is_export', { mode: 'boolean' }).notNull().default(false),
}, (t) => [
  index('symbols_name_idx').on(t.name),
  index('symbols_path_idx').on(t.path),
]);
```

No FK to `files(path)` per D-07. Autoincrement `id` as primary key (consistent with `file_communities` pattern).

### New `kv_state` Table (Claude's Discretion: prefer kv_state over schema_version)

`schema_version` is a single-row integer table — its design doesn't cleanly accommodate string key-value pairs without mutation of the schema_version concept. A new `kv_state` table is the correct pattern. [VERIFIED: schema_version has no runtime INSERT/SELECT anywhere in src/]

```typescript
export const kv_state = sqliteTable('kv_state', {
  key:   text('key').primaryKey().notNull(),
  value: text('value').notNull(),
});
```

Repository helpers:
```typescript
export function getKvState(key: string): string | null { ... }
export function setKvState(key: string, value: string): void { ... }
```

### Additive Columns on `file_dependencies` (D-08)

Add to the existing `file_dependencies` table definition:

```typescript
imported_names: text('imported_names'),      // nullable JSON string array
import_line:    integer('import_line'),       // nullable source line
```

These are nullable with no DEFAULT — existing rows get NULL (correct per D-10).

### Generating the Migration

```bash
npx drizzle-kit generate
```

This produces `drizzle/0005_add_symbols_and_import_metadata.sql`. Based on the pattern in 0004 (which shows `ALTER TABLE ... ADD COLUMN` + `CREATE TABLE` + `CREATE INDEX` with `-->statement-breakpoint` separators), the expected output will be:

```sql
ALTER TABLE `file_dependencies` ADD COLUMN `imported_names` text;--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `import_line` integer;--> statement-breakpoint
CREATE TABLE `symbols` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `path` text NOT NULL,
  `name` text NOT NULL,
  `kind` text NOT NULL,
  `start_line` integer NOT NULL,
  `end_line` integer NOT NULL,
  `is_export` integer DEFAULT 0 NOT NULL
);--> statement-breakpoint
CREATE TABLE `kv_state` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL
);--> statement-breakpoint
CREATE INDEX `symbols_name_idx` ON `symbols` (`name`);--> statement-breakpoint
CREATE INDEX `symbols_path_idx` ON `symbols` (`path`);
```

**Migration is additive:** new columns are nullable, new tables don't FK-reference existing tables. Existing rows are unaffected. [VERIFIED: consistent with 0004 pattern]

**Drizzle handles JSON-text columns cleanly:** `imported_names` is stored as `text` and serialized/deserialized manually via `JSON.stringify`/`JSON.parse` — same pattern as `exports_snapshot` and `concepts` columns. Drizzle doesn't need to know about the JSON content. [VERIFIED: existing patterns in schema.ts + repository.ts]

---

## Extending `extractRicherEdges`: Return Shape

### Current return type (verified from source)

```typescript
export interface RicherEdgeData {
  regularImports: string[];
  reExportSources: string[];
  inheritsFrom: Array<{ className: string; sourceSpecifier: string }>;
}
```

### Widened return type (Phase 33)

```typescript
export interface ImportMeta {
  specifier:     string;       // raw import specifier string
  importedNames: string[];     // e.g. ["useState", "useEffect"] or ["*"] or ["default"]
  line:          number;       // 1-indexed source line of the import_statement
}

export interface RicherEdgeData {
  regularImports:  string[];
  reExportSources: string[];
  inheritsFrom:    Array<{ className: string; sourceSpecifier: string }>;
  // Phase 33 additions:
  symbols:         Symbol[];     // Symbol from src/db/symbol-types.ts
  importMeta:      ImportMeta[]; // per-import metadata (one entry per import_statement)
}
```

The function name stays `extractRicherEdges`. Callers (`extractTsJsEdges` in `language-config.ts`) must be updated to destructure the new fields and pass them downstream.

### Where `Symbol` Type Lives

New file: `src/db/symbol-types.ts`

```typescript
// src/db/symbol-types.ts
// Phase 33 Symbol type for the symbols table.
// Distinct from ExportedSymbol in change-detector/types.ts (which keeps its own kinds).

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const';

export interface Symbol {
  name:      string;
  kind:      SymbolKind;
  startLine: number;    // 1-indexed
  endLine:   number;    // 1-indexed
  isExport:  boolean;
}
```

---

## Repository Pattern: `upsertSymbols` and `setEdges` in Same Transaction

### Current `setEdges` in `repository.ts` (verified from source)

`setEdges` uses Drizzle ORM calls (`.delete()`, `.insert()`) but NOT a `sqlite.transaction()` wrapper. Each insert is a separate auto-committed statement. [VERIFIED: repository.ts lines 321–344]

### Why This Matters for D-15 (Atomic per-file write)

To share a transaction between `setEdges` and `upsertSymbols`, the coordinator (or language-config.ts wrapper) must wrap both calls in a `sqlite.transaction()`. The cleanest approach (matching the community/cascade patterns): create a combined function or wrap at the call site in coordinator.

Recommended: add a new `setEdgesAndSymbols(path, edges, symbols)` repository function that wraps both operations in a single `sqlite.transaction()`. This avoids exposing transaction internals to the coordinator.

```typescript
export function setEdgesAndSymbols(
  sourcePath: string,
  edges: EdgeResult[],
  symbols: Symbol[],
  importMeta: ImportMeta[]
): void {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(() => {
    // Delete + insert edges (same logic as current setEdges)
    // Delete + insert symbols (new: DELETE WHERE path + bulk INSERT)
    // Update file_dependencies rows with imported_names + import_line
  });
  tx();
  markCommunitiesDirty();
}
```

**Alternative:** Keep `setEdges` and `upsertSymbols` separate and let the coordinator wrap both. The cascade pattern in `purgeRecordsMatching` shows `sqlite.transaction()` wrapping multiple repo calls from outside the repo. Both approaches are valid.

### `upsertSymbols` Shape (D-14)

```typescript
export function upsertSymbols(path: string, symbols: Symbol[]): void {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(path);
    const stmt = sqlite.prepare(
      'INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const sym of symbols) {
      stmt.run(path, sym.name, sym.kind, sym.startLine, sym.endLine, sym.isExport ? 1 : 0);
    }
  });
  tx();
}
```

### `imported_names` on `file_dependencies`

Per D-08: when writing edge rows in `setEdges` (or the combined function), the corresponding `ImportMeta` entry for each edge is matched by specifier, then encoded:

```typescript
// Encode imported names for the edge row
const importedNamesJson = JSON.stringify(meta.importedNames);  // e.g. '["useState","useEffect"]'
// import_line is meta.line
```

Multi-import-same-edge: if the same `(source, target)` pair appears in two separate import statements, produce two rows — each carries its own `import_line`. The existing `file_dependencies` autoincrement `id` already supports this. Do NOT aggregate by target when multiple import statements resolve to the same file.

---

## Coordinator Startup Sequence: Bulk Extraction Hook

### Current `init()` Sequence (verified from source)

```
line 249: openDatabase(dbPath)          ← migrate() runs inside openDatabase
line 254: purgeRecordsOutsideRoot()
line 262: purgeRecordsMatching()
line 269: runMigrationIfNeeded()        ← JSON-to-SQLite one-time migration
line 275: buildFileTree(newConfig)      ← pass 1 (file metadata), pass 2 (edges)
line 283: runStartupIntegritySweep()
line 285: _initialized = true
```

### Bulk Symbol Extraction Hook Point

Insert after `runMigrationIfNeeded()` and BEFORE `buildFileTree()`, so symbols are populated before the integrity sweep. This is analogous to how `runMigrationIfNeeded` runs before building the file tree.

```typescript
// After line 269 (runMigrationIfNeeded):
try {
  await runSymbolsBulkExtractionIfNeeded(projectRoot);
} catch (err) {
  log(`Bulk symbol extraction failed (non-fatal): ${err}`);
}
// Then buildFileTree as before...
```

The function lives in `src/coordinator.ts` or a new `src/migrate/bulk-symbol-extract.ts` file. The gate check reads `getKvState('symbols_bulk_extracted')` from the repository.

**Why synchronous (D-12):** The function iterates tracked TS/JS files, reads each from disk, calls `extractRicherEdges`, and calls `upsertSymbols`. No async required since better-sqlite3 is synchronous and `fs.readFileSync` is available. However, `fs.promises.readFile` is used elsewhere for consistency — keep `await` on file reads.

---

## CLI Scripts Pattern

### `scripts/inspect-symbols.mjs` (D-16–D-18)

Based on `scripts/register-mcp.mjs` structure: [VERIFIED: register-mcp.mjs source]

```javascript
// scripts/inspect-symbols.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import * as fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');

// Must use createRequire to load CJS tree-sitter from ESM script
const _require = createRequire(import.meta.url);
// Import extractRicherEdges from compiled dist/ — NOT src/ (no ts-node)
// OR: implement a lightweight inline parser for the CLI

const filePath = process.argv[2];
if (!filePath) { console.error('Usage: npm run inspect-symbols <path>'); process.exit(1); }

// Read file, call extractRicherEdges, print symbols
```

**Important:** The CLI reads the file directly via the parser — no DB. It imports from `dist/` (compiled output), not `src/`. This means the CLI only works after `npm run build`. The planner should note this: `inspect-symbols` is a debugging tool requiring a build, same as the MCP server itself.

**Alternative for CLI:** Import just `ast-parser.ts` logic compiled as a separate esbuild entry. Check whether `build` script includes all files needed, or whether `inspect-symbols.mjs` should import from `dist/change-detector/ast-parser.js` (which is already in the build output since `src/change-detector/ast-parser.ts` is in the build script).

[VERIFIED: package.json build script includes `src/change-detector/ast-parser.ts`]

### `scripts/bench-scan.mjs` (D-19–D-21)

```javascript
// scripts/bench-scan.mjs
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Import compiled coordinator from dist/
const _require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Measure self-scan via coordinator.init(REPO_ROOT)
// Measure medium-repo fixture scan
// Write baseline.json
```

**Key timing target:** `coordinator.init(projectPath)` performs the full scan (pass 1 metadata, pass 2 edges). Wall time is measured around this call. For Phase 35 regression check, the same script is re-run and output compared.

**Baseline.json schema:**
```json
{
  "captured_at": "2026-04-23T07:31:24.700Z",
  "self_scan_ms": 1234,
  "medium_repo_scan_ms": 5678,
  "file_counts": { "self": 58, "medium_repo": 120 },
  "node_version": "v22.21.1",
  "commit_sha": "abc1234"
}
```

---

## Benchmark Fixture: Medium-Repo

No existing `medium-repo` fixture exists in the test directory. [VERIFIED: find search found no test fixture dirs in project src/]

### Options for Medium-Repo Fixture (Claude's Discretion)

**Option A — Synthetic fixture (recommended):** Create `tests/fixtures/medium-repo/` with ~100–150 synthetic TS/JS files distributed across subdirectories. Each file has 5–10 realistic declarations. Total ~1000 symbols, ~500 import edges. Takes ~15 minutes to scaffold via a generator script. Committed once, used by both bench-scan and potentially by repository tests.

**Option B — Real-world repo snapshot:** Use a pinned commit of a popular npm package as the medium-repo. Risk: external dependency, license concerns. Not recommended.

**Option C — Self-scan IS the medium fixture:** At ~58 TS source files (~15K LOC), the self-scan covers a meaningful range. The CONTEXT.md says "medium-repo fixture (fixture path + row count to be determined by the planner)." The planner may decide that self-scan + a doubled synthetic fixture is sufficient.

**Recommended plan:** Create a minimal synthetic fixture of ~100 files that can be committed. The generator script itself takes ~30 minutes to write but produces a stable, deterministic fixture.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite transaction wrapper | Custom lock/retry logic | `sqlite.transaction(fn)` from better-sqlite3 | Already in codebase; rollback is automatic |
| Migration runner | Custom SQL executor | `drizzle-kit generate` + existing `migrate()` in `openDatabase()` | Already wired — just add to schema.ts and generate |
| JSON column serialization | Custom binary format | `JSON.stringify` / `JSON.parse` inline | Same pattern as `exports_snapshot`, `concepts` |
| AST node traversal | Recursive descent with manual state | Extend existing `visitNode()` in `extractRicherEdges` | Parser already instantiated; patterns established |
| Import name walking | New AST library | Extend `buildImportNameMap()` pattern | Already handles all 3 import shapes correctly |

---

## Common Pitfalls

### Pitfall 1: `ambient_declaration` Nodes Appearing at Top Level
**What goes wrong:** `declare function foo(): void;` and `declare class Bar {}` appear as `ambient_declaration` nodes at the top level of a `.ts` file. They are NOT `function_declaration` or `class_declaration`. Walking for top-level symbols without filtering `ambient_declaration` will miss them (they won't match any case) — which is correct behavior, since they don't represent runtime symbols.
**Why it happens:** TypeScript ambient declarations describe external types but don't produce JavaScript output. They shouldn't appear in a symbols table meant for navigation.
**How to avoid:** Do not add a case for `ambient_declaration`. The walk will naturally skip them.
**Warning signs:** If `declare function` somehow appears in symbol output, check your walk logic.

### Pitfall 2: `export let` Classified as `const` Symbol
**What goes wrong:** Both `export const X = 1` and `export let Y = 2` produce a `lexical_declaration` declaration node. Only `const` should be emitted as a symbol.
**Why it happens:** The `lexical_declaration` node type covers both `const` and `let`.
**How to avoid:** After finding a `lexical_declaration`, check its first keyword child: `declNode.children.find(c => c.type === 'const' || c.type === 'let')?.type`. Skip if `let` or `var`.
**Warning signs:** If mutable variables appear in symbols output.

### Pitfall 3: Line Numbers Off by One
**What goes wrong:** Using `node.startPosition.row` directly gives 0-indexed lines. Storing as-is yields line 0 for the first line of a file.
**How to avoid:** Always `node.startPosition.row + 1`.
**Warning signs:** Tests checking `startLine === 1` for first-line declarations fail.

### Pitfall 4: Multiple Import Statements to Same Target Producing Duplicate Edge Rows
**What goes wrong:** Two separate `import` statements that resolve to the same `(source, target)` file pair produce two rows in `file_dependencies`. Existing `setEdges()` aggregates duplicate targets by summing weights (the `accumulator` Map in `language-config.ts`). With `imported_names`, each row should carry its own import names — so de-duplication by target must NOT happen for TS/JS imports with metadata.
**Why it happens:** The current weight-aggregation in `extractEdges()` (language-config.ts lines 893–901) de-duplicates by `${target}\x00${edgeType}`. If two imports resolve to the same file, only one row is kept.
**How to avoid:** For TS/JS files, preserve separate rows when `importedNames` differ. This requires changing the aggregation in `extractTsJsEdges` or bypassing the aggregation step for the import-metadata case. Per D-08: "produce separate rows so each row's `import_line` stays precise."
**Warning signs:** A file that imports `{ a }` from `./mod` on line 1 and `{ b }` from `./mod` on line 5 yields only one row in `file_dependencies` with both names merged.

### Pitfall 5: Bulk Extraction Running After DB Already Has Symbols
**What goes wrong:** If the `kv_state` check fails (table not yet created, or key missing after a corrupt run), bulk extraction runs again on every startup, rewriting all symbols unnecessarily.
**How to avoid:** The `kv_state` table is created in migration 0005, which runs inside `openDatabase()` before the bulk extraction check. After successful extraction, `setKvState('symbols_bulk_extracted', new Date().toISOString())` is called. The check reads this row first. If the row exists (even with an old timestamp), skip extraction.
**Warning signs:** Startup takes unexpectedly long on every boot, log shows "Running bulk symbol extraction" on every init.

### Pitfall 6: `inspect-symbols` CLI Importing from `src/` Instead of `dist/`
**What goes wrong:** `.mjs` scripts cannot import `.ts` files directly without a transpiler. The ESM script must import from `dist/change-detector/ast-parser.js`.
**How to avoid:** All imports in `inspect-symbols.mjs` and `bench-scan.mjs` use `dist/` paths, protected by a guard that checks `existsSync(SERVER_JS)` before proceeding (same pattern as `register-mcp.mjs`).
**Warning signs:** `SyntaxError: Cannot use import statement in a module` or TypeScript syntax errors in CLI output.

### Pitfall 7: `export_statement` Start Row Includes Decorator Line
**What goes wrong:** For `@Component({...})\nexport class Foo {}`, the `export_statement.startPosition.row` is the decorator's line (row 0), not the `export` keyword line (row 1). This means `startLine` for the class symbol includes the decorator.
**Risk level:** LOW — for symbol navigation purposes, the decorator line IS the correct start of the class definition. Phase 34's `find_symbol` returns `startLine` to the LLM, which can jump to that line and see the decorator. This is correct behavior.
**Action:** No special handling needed. Document in code comment.

---

## Code Examples

### Walking Top-Level Nodes for Symbols

```typescript
// Source: verified runtime probe 2026-04-23
function extractSymbolsFromRoot(root: any, source: string): Symbol[] {
  const symbols: Symbol[] = [];

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i);

    if (node.type === 'export_statement') {
      extractExportedSymbols(node, symbols);
    } else {
      extractBareTopLevelSymbol(node, false, symbols);
    }
  }
  return symbols;
}

function extractExportedSymbols(exportNode: any, symbols: Symbol[]): void {
  // Skip re-exports (D-05)
  if (exportNode.childForFieldName('source')) return;

  const declNode = exportNode.childForFieldName('declaration');
  if (!declNode) {
    // export default <value> — check for named default
    const valueNode = exportNode.childForFieldName('value');
    if (valueNode) {
      const nameNode = valueNode.childForFieldName('name');
      if (nameNode?.text) {
        // Named default (e.g., export default function foo(){})
        // Actually this case is caught by declaration field above.
        // Anonymous default: skip (D-06).
      }
    }
    return;
  }

  extractBareTopLevelSymbol(declNode, true, symbols);
}

function extractBareTopLevelSymbol(node: any, isExport: boolean, symbols: Symbol[]): void {
  const startLine = node.startPosition.row + 1;
  const endLine   = node.endPosition.row + 1;

  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) symbols.push({ name, kind: 'function', startLine, endLine, isExport });
      break;
    }
    case 'class_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) symbols.push({ name, kind: 'class', startLine, endLine, isExport });
      break;
    }
    case 'interface_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) symbols.push({ name, kind: 'interface', startLine, endLine, isExport });
      break;
    }
    case 'type_alias_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) symbols.push({ name, kind: 'type', startLine, endLine, isExport });
      break;
    }
    case 'enum_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (name) symbols.push({ name, kind: 'enum', startLine, endLine, isExport });
      break;
    }
    case 'lexical_declaration': {
      // const only — skip let
      const kw = node.children.find((c: any) => c.type === 'const' || c.type === 'let');
      if (kw?.type !== 'const') break;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (child.type === 'variable_declarator') {
          const name = child.childForFieldName('name')?.text;
          const valType = child.childForFieldName('value')?.type;
          if (name) {
            const kind = valType === 'arrow_function' ? 'function' : 'const';
            symbols.push({ name, kind, startLine, endLine, isExport });
          }
        }
      }
      break;
    }
    // ambient_declaration, variable_declaration, etc. — fall through and skip
  }
}
```

### `upsertSymbols` Transaction Pattern

```typescript
// Source: modeled on setCommunities() and purgeRecordsMatching() patterns in repository.ts
export function upsertSymbols(path: string, syms: SymbolRow[]): void {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(path);
    const stmt = sqlite.prepare(
      'INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const s of syms) {
      stmt.run(path, s.name, s.kind, s.startLine, s.endLine, s.isExport ? 1 : 0);
    }
  });
  tx();
}
```

### `setEdges` Extended to Accept `ImportMeta`

```typescript
// Extended setEdges signature (or new setEdgesAndSymbols)
export function setEdges(
  sourcePath: string,
  edges: EdgeResult[],
  importMeta?: ImportMeta[]   // optional for backward compatibility
): void {
  const sqlite = getSqlite();
  // Build a map from specifier → ImportMeta for O(1) lookup when writing edge rows
  const metaMap = new Map(importMeta?.map(m => [m.specifier, m]) ?? []);

  db.delete(file_dependencies).where(eq(file_dependencies.source_path, sourcePath)).run();

  for (const edge of edges) {
    const meta = edge.isPackage ? undefined : metaMap.get(edge.originalSpecifier);
    db.insert(file_dependencies).values({
      source_path:       sourcePath,
      target_path:       edge.target,
      dependency_type:   edge.isPackage ? 'package_import' : 'local_import',
      // ... existing fields ...
      imported_names:    meta ? JSON.stringify(meta.importedNames) : null,
      import_line:       meta?.line ?? null,
    }).run();
  }
  markCommunitiesDirty();
}
```

**Note:** `EdgeResult` does not currently carry the original specifier string, only the resolved `target`. The `importMeta` array carries `specifier`. Threading `originalSpecifier` through `EdgeResult` or matching by resolved path requires care — see Open Questions §1.

---

## State of the Art

| Old Approach | Current Approach | Notes |
|--------------|------------------|-------|
| Regex-based import parsing | tree-sitter AST (already shipped v1.4) | Phase 33 extends existing AST walk |
| ExportedSymbol (semantic diff) | New Symbol type for navigation | Parallel representation, different schema |
| File-level metadata only | Symbol-level rows in dedicated table | Phase 33 addition |

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | bench-scan.mjs, inspect-symbols.mjs | ✓ | v22.21.1 | — |
| tree-sitter | ast-parser.ts (already in use) | ✓ | ^0.25.0 | — |
| tree-sitter-typescript | ast-parser.ts | ✓ | ^0.23.2 | — |
| tree-sitter-javascript | ast-parser.ts | ✓ | ^0.25.0 | — |
| better-sqlite3 | repository.ts | ✓ | ^12.6.2 | — |
| drizzle-kit | `npx drizzle-kit generate` | ✓ | 0.31.9 | — |
| drizzle-orm | schema.ts, migrate() | ✓ | 0.45.1 | — |

**Missing dependencies with no fallback:** None.

**Step 2.6 note:** All dependencies are already installed. No environment gaps blocking execution.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `export_statement` with no `declaration` field and no `source` field = anonymous default export (`export default 42`) — skip it | AST Node Structure | If tree-sitter emits these differently in some TS versions, anonymous defaults might not be skipped correctly. Low risk — verified by probe. |
| A2 | `import_specifier.childForFieldName('name')` returns the *original exported name*, not the local alias | Import Name Extraction | If swapped, aliased import names would be wrong. Verified by probe: name=useState, alias=st. |
| A3 | `bench-scan.mjs` can import `ServerCoordinator` from `dist/coordinator.js` and call `coordinator.init(path)` synchronously without a full MCP server | Benchmark Script | If coordinator.init requires MCP transport context (it doesn't — verified from coordinator.test.ts which calls `coordinator.init(tmpDir)` directly), bench-scan will fail. Risk: LOW — test confirms daemon-mode usage. |
| A4 | Drizzle-kit generate produces the SQL in the format shown (ALTER TABLE + CREATE TABLE + CREATE INDEX) | Drizzle Schema Extension | Drizzle-kit 0.31.x output format. ASSUMED from 0004 reference pattern. Actual SQL may differ slightly in column ordering. Risk: LOW — functional correctness unaffected. |

---

## Open Questions for Planner

### OQ-1: Matching `ImportMeta.specifier` to Resolved `EdgeResult.target`

**Problem:** `extractTsJsEdges()` in `language-config.ts` receives raw specifiers from `extractRicherEdges()` (via `richer.regularImports`), then resolves them to absolute paths via `resolveTsJsImport()`. The resolved `EdgeResult.target` is an absolute path. The `ImportMeta.specifier` is the raw string (e.g., `'./utils'`). When writing the edge row, the code must match each `ImportMeta` to its resolved `EdgeResult` to populate `imported_names` and `import_line`.

**Two valid approaches:**

1. **Specifier-keyed map:** Thread `originalSpecifier` through `EdgeResult` as an optional field. In `setEdges`, match by `edge.originalSpecifier` to `meta.specifier`.
2. **Parallel array:** `extractTsJsEdges` returns `edges[]` and `importMeta[]` in the same order as `richer.regularImports`. The Nth import corresponds to the Nth resolved edge. But resolution can return null (unresolvable specifiers), breaking the 1:1 mapping.

**Recommendation for planner:** Approach 1 (add `originalSpecifier?: string` to `EdgeResult`) is cleaner and doesn't break the null-resolution case. The planner should add `originalSpecifier` to `EdgeResult` in language-config.ts and populate it in `extractTsJsEdges`.

### OQ-2: Aggregation Bypass for Duplicate Import Specifiers (D-08)

**Problem:** The current `extractEdges()` in `language-config.ts` aggregates duplicate `(target, edgeType)` pairs by summing weights. D-08 says "produce separate rows" when the same `(source, target)` pair appears twice (different import statements). This conflicts with the weight-aggregation logic.

**The conflict:** The aggregator collapses `import { a } from './mod'` (line 1) and `import { b } from './mod'` (line 5) into one row, losing `import_line` for the second import.

**Decision needed:** Does the planner want to:
a. Keep aggregation for weight-counting but also emit a separate importMeta array that bypasses aggregation for writing `imported_names`/`import_line`?
b. Disable aggregation for TS/JS files when `importMeta` is present?
c. Write both rows to `file_dependencies` (one per import statement) and let `getDependencies()` deduplicate when returning paths?

This is a non-trivial semantic change to the edge table that the planner must resolve explicitly. The research cannot pre-decide this — it affects `setEdges`, `getDependencies`, `getDependenciesWithEdgeMetadata`, and potentially Phase 34's `get_file_summary`.

### OQ-3: `inspect-symbols` CLI — Does It Require a Full Build?

The CLI must import `extractRicherEdges` from somewhere. Options:
a. Import from `dist/change-detector/ast-parser.js` (requires `npm run build` first — consistent with `register-mcp.mjs` pattern).
b. Use an inline `createRequire` block to call tree-sitter directly in the script (avoids build dependency but duplicates parser code).

The planner should pick (a) for consistency with the existing CLI pattern. The planner should add a guard: `if (!existsSync(path.join(REPO_ROOT, 'dist/change-detector/ast-parser.js')))` with a helpful error message.

### OQ-4: Bulk Extraction and `buildFileTree` Interaction

`buildFileTree()` in the coordinator already extracts edges for all files (Pass 2). If a user has an existing DB with no symbols (first startup after upgrade), bulk extraction runs BEFORE `buildFileTree`. But `buildFileTree` skips files with existing deps (mtime freshness check). After bulk extraction, all files already have symbols, so Pass 2 in `buildFileTree` may also be skipped (if mtimes are fresh) — meaning the import metadata columns on `file_dependencies` won't be updated until the next file change event.

**Risk:** On first boot after upgrade, `imported_names`/`import_line` columns on existing `file_dependencies` rows will be NULL even after bulk extraction (since bulk extraction only writes `symbols` rows, not import metadata).

**Possible resolution:** Bulk extraction should also populate `imported_names`/`import_line` on file_dependencies rows. Or the planner accepts that import metadata is populated lazily (on next file change). The planner should decide whether PERF-01's "bulk extraction" scope covers both symbols AND import metadata, or symbols only.

---

## Sources

### Primary (HIGH confidence)
- `src/change-detector/ast-parser.ts` — current `extractRicherEdges()` return shape and walk logic [VERIFIED: read]
- `src/change-detector/types.ts` — `ExportedSymbol` interface (kept untouched) [VERIFIED: read]
- `src/db/schema.ts` — existing table definitions, column patterns, index patterns [VERIFIED: read]
- `src/db/repository.ts` — existing transaction patterns, `setEdges`, `upsertFile` shapes [VERIFIED: read]
- `src/db/db.ts` — `openDatabase()` runs `migrate()` automatically [VERIFIED: read]
- `src/coordinator.ts` — `init()` sequence and hook point locations [VERIFIED: read]
- `src/language-config.ts` — `EdgeResult` interface, `extractTsJsEdges()`, `extractEdges()` aggregation [VERIFIED: read]
- `drizzle/0004_add_edge_metadata.sql` — additive migration pattern [VERIFIED: read]
- `scripts/register-mcp.mjs` — ESM CLI structure [VERIFIED: read]
- Runtime probes — all tree-sitter AST node structures, field names, row values [VERIFIED: executed 5 probes]

### Secondary (MEDIUM confidence)
- `src/coordinator.test.ts` — confirms `coordinator.init(tmpDir)` works standalone without MCP transport
- `package.json` — all dependency versions confirmed [VERIFIED: read]
- `drizzle-kit --version` — 0.31.9 confirmed [VERIFIED: npm exec]

---

## Metadata

**Confidence breakdown:**
- AST node structure: HIGH — all verified by live runtime probes
- Drizzle schema extension: HIGH — verified against existing schema.ts and 0004 pattern
- Repository transaction pattern: HIGH — verified against existing setEdges/setCommunities
- Coordinator startup hook: HIGH — verified from reading coordinator.ts init()
- Benchmark fixture strategy: MEDIUM — no existing medium-repo fixture found; synthetic fixture plan is assumed

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (stable libraries; tree-sitter API unlikely to change in 30 days)
