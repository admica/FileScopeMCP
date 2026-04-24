# Stack Research

**Domain:** v1.7 Multi-Lang Symbols + Call-Site Edges — targeted additions to existing FileScopeMCP stack
**Researched:** 2026-04-23
**Confidence:** HIGH

## Context

This is a targeted v1.7 addition to the existing validated stack. The core stack is NOT
re-researched here. This document covers only the **new capability domains** for v1.7:

1. Go symbol extraction via tree-sitter (D-06 reconfirmation)
2. Ruby symbol extraction via tree-sitter-ruby
3. Python symbol extraction (already has tree-sitter-python for edges; extend to symbols)
4. TS/JS symbol-level call-site edges — new `symbol_dependencies` schema + AST walk extension

**Retained stack (do not change):** TypeScript 5.8, Node.js 22, ESM, esbuild,
`@modelcontextprotocol/sdk`, `chokidar`, `zod`, `vitest@3.1.4`, `@vitest/coverage-v8`,
`better-sqlite3@12.6.2`, `drizzle-orm@0.45.1`, `tree-sitter@0.25.0`,
`tree-sitter-python@0.25.0`, `tree-sitter-typescript@0.23.2`, `tree-sitter-javascript@0.25.0`,
`tree-sitter-rust@0.24.0`, `tree-sitter-c@0.24.1`, `tree-sitter-cpp@0.23.4`,
`graphology` ecosystem, Vercel AI SDK, Fastify 5, Svelte 5, Vite 8.

---

## D-06 Reconfirmation: Go Grammar Ecosystem (2026-04-23)

**Decision D-06 is REVERSED for v1.7. Use `tree-sitter-go@0.25.0`.**

Audit findings:

- `tree-sitter-go@0.25.0` is now published on npm. Version 0.25.0 was released ~7 months ago (2025-09).
- peerDependency is `tree-sitter: ^0.25.0` — exact match with the installed `tree-sitter@0.25.0`. No ABI conflict.
- Grammar exports the standard `language` object via `bindings/node` — same pattern as all other tree-sitter grammars already in use.
- Verified by live parse: `source_file` root → `function_declaration`, `method_declaration`, `type_declaration`, `const_declaration`, `var_declaration` all parse correctly.
- The regex-based `resolveGoImports()` will be KEPT for edge extraction (Go import paths still work fine with regex). The new grammar is added ONLY for Go symbol extraction (v1.7 scope).

The Go extractor in `language-config.ts` stays on regex for `extractEdges()`. A new `extractGoSymbols()` function uses `tree-sitter-go@0.25.0`.

---

## Recommended Stack — New Additions Only

### New npm Packages

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `tree-sitter-go` | `^0.25.0` | Go grammar for tree-sitter — Go symbol extraction | Stable npm package, peerDep ^0.25.0 matches installed tree-sitter exactly. No binary conflict. Provides `function_declaration`, `method_declaration`, `type_declaration`, `const_declaration` for Go symbol extraction. |
| `tree-sitter-ruby` | `^0.23.1` | Ruby grammar for tree-sitter — Ruby symbol extraction | Latest version. peerDep ^0.21.1 (^0.21.1 = >=0.21.1 <1.0.0 in semver, compatible with 0.25.0). Live-tested: loads cleanly with tree-sitter@0.25.0, parses `program` → `method`, `singleton_method`, `class`, `module` correctly. |

### No New Packages for Call-Site Edges

Call-site edge extraction for TS/JS uses the **existing tree-sitter parsers** (already installed).
The call_expression walk is added to `extractRicherEdges()` in `ast-parser.ts` — same single AST pass.
No ts-morph, no TypeScript language service. See trade-off analysis below.

### Schema Addition (No New Library)

A new `symbol_dependencies` table in `schema.ts` using the existing `drizzle-orm` and `better-sqlite3`.
Raw `getSqlite().prepare(...)` is used for the "who calls foo" and "what does foo call" queries —
consistent with the existing pattern in `repository.ts` (getSqlite is already used for 60%+ of queries).
No recursive CTEs needed in v1.7 (transitive call graph is Out of Scope per PROJECT.md).

---

## Symbol Kind Additions to SymbolKind Type

The current `SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const'` needs extension
for the new languages. Additions are additive — the `find_symbol` tool already accepts unknown kinds and
returns empty (never an error), so existing callers are safe.

| New Kind | Language | Source Node Type | Notes |
|----------|----------|-----------------|-------|
| `'module'` | Ruby | `module` AST node | Ruby modules are top-level namespaces — distinct from classes. Equivalent to TS `namespace`. |
| `'variable'` | Go | `var_declaration` → `var_spec` | Go module-level `var` declarations. Distinct from `const`. |
| `'struct'` | Go | `type_declaration` → `type_spec` with `struct_type` inner | Go structs are the primary data type, more specific than `class`. |

TS/JS-originated kinds (`interface`, `type`, `enum`, `const`) remain unchanged.
Python adds no new kinds: `function_definition` → `'function'`, `class_definition` → `'class'`.

---

## AST Node Types for Symbol Extraction

### Python (tree-sitter-python@0.25.0 — already installed)

Python symbol extraction at `extractTsJsFileParse()` parity — single AST pass alongside edges.

| Node Type | Maps To | Key Fields | Notes |
|-----------|---------|-----------|-------|
| `function_definition` | `'function'` | `name: (identifier)` | Covers both sync and async. Async functions have an `async` keyword child but node type is still `function_definition` (verified live). `startPosition.row` includes `async` keyword. |
| `class_definition` | `'class'` | `name: (identifier)` | Includes superclass via `superclasses` field. |
| `decorated_definition` | Depends on inner | inner child is `function_definition` or `class_definition` | Use `positionSource = decorated_definition` for startLine (decorator lines included), inner node's `name` field for symbol name. Same Pitfall 7 pattern as TS/JS decorators. |

NOT extracted: `expression_statement` wrapping `assignment` (module-level variables like `MY_VAR = 42`).
Python variables lack explicit type annotations at module level, making kind classification ambiguous.
Scope cut: same rationale as TS `let`/`var` — `const` equivalent in Python is convention, not syntax.

### Ruby (tree-sitter-ruby@0.23.1 — NEW)

| Node Type | Maps To | Key Fields | Notes |
|-----------|---------|-----------|-------|
| `method` | `'function'` | `name: (identifier)` | `def foo ... end` — top-level or within class body. At top-level, `is_export` = false (Ruby has no export keyword). |
| `singleton_method` | `'function'` | `name: (identifier)`, `object: (self)` | `def self.foo ... end` — class methods. `is_export` = false. |
| `class` | `'class'` | `name: (constant)` or `name: (scope_resolution)` | `class Foo ... end`. Name can be `constant` or `Foo::Bar` scope resolution. |
| `module` | `'module'` | `name: (constant)` | `module Foo ... end`. |

Ruby `program` node is the root (equivalent to JS `program` or TS `program`).
Top-level walk: iterate `root.namedChildren`, check type, recurse into `body_statement` of `class`/`module` nodes for nested definitions.

**Nesting decision:** Extract only top-level symbols (same as TS/JS v1.6 scope). Methods nested inside a class are NOT extracted at the first iteration — they are reachable via class `startLine`/`endLine` range. v1.8 can add nested extraction if needed.

### Go (tree-sitter-go@0.25.0 — NEW)

| Node Type | Maps To | Key Fields | Notes |
|-----------|---------|-----------|-------|
| `function_declaration` | `'function'` | `name: (identifier)` | `func Foo() {}`. Package-level function. |
| `method_declaration` | `'function'` | `name: (field_identifier)`, `receiver: (parameter_list)` | `func (r *T) Foo() {}`. Method on a type. |
| `type_declaration` → `type_spec` with `struct_type` | `'struct'` | `type_spec.name: (type_identifier)` | `type Foo struct {}`. |
| `type_declaration` → `type_spec` with `interface_type` | `'interface'` | `type_spec.name: (type_identifier)` | `type Foo interface {}`. |
| `type_declaration` → `type_alias` | `'type'` | `type_alias.name: (type_identifier)` | `type MyError = error`. |
| `const_declaration` → `const_spec` | `'const'` | `const_spec.name` (first named child of const_spec) | `const MaxSize = 100`. |

NOT extracted: `var_declaration` (Go module-level vars). Low value for symbol navigation.
NOT extracted: `type_declaration` → `type_spec` with other inner types (e.g., channel, map types) — too obscure.

Go `source_file` is the root node. Walk immediate children of `source_file` only (top-level symbols).

---

## Call-Site Edge Extraction: Tree-Sitter Walk (Not ts-morph)

### Decision: Extend `extractRicherEdges()` in `ast-parser.ts`

Use the existing tree-sitter walk in `extractRicherEdges()` to also collect `call_expression` nodes.
Resolve callee names against the import name map already built during the same walk.

**Resolution algorithm (in-file AST walk):**
1. During the `visitNode()` pass, collect `call_expression` nodes. For each:
   - Extract callee = `node.childForFieldName('function')`.
   - If callee is `identifier`: base name = `callee.text`.
   - If callee is `member_expression`: base name = `callee.childForFieldName('object').text`.
2. Look up base name in `importNameToSource` map (already built from `import_statement` nodes).
   - If found: edge is cross-file. Record `(callee_name, source_specifier, call_line)`.
   - If not found: edge is intra-file (local function call). Record `(callee_name, null, call_line)`.
3. After extracting the file's own symbols, resolve intra-file calls: look up callee_name in the
   file's own symbol list (just built in the same pass). Match by `symbol.name === callee_name`.
4. For cross-file calls: defer resolution to a post-pass that queries the `symbols` table for
   `(path = resolved_target_file, name = callee_name)`. This is a synchronous `better-sqlite3`
   query against the already-populated symbols table.

The result is a list of `(caller_symbol_id, callee_symbol_id, call_line)` tuples written to
the new `symbol_dependencies` table.

**Confidence of call-site edges:** INFERRED (0.8). Name-based matching without type information
means overloaded names (same function name in multiple files) may produce false positives.
The confidence field on `symbol_dependencies` encodes this.

### Why NOT ts-morph

| Criterion | tree-sitter (chosen) | ts-morph |
|-----------|---------------------|---------|
| Startup cost | 0 (parsers already loaded) | 235ms+ import, 500ms-2s for large project load |
| Per-file cost | O(file_size), streaming | O(project_size), batch |
| Incremental fit | Fits existing single-pass model | Breaks incremental model |
| Memory footprint | ~0 additional | 100-300MB TypeScript language service |
| Accuracy | Name-based (INFERRED 0.8) | Type-aware (would be EXTRACTED 1.0) |
| Dependency | No new dep | ts-morph@28 (though TS already in devDeps) |
| Correctness for overloads | False positives possible | Resolves correctly |
| Cross-file resolution | Import map + DB lookup | Full TypeScript resolution |

ts-morph is the right choice IF the requirement is "cross-file call resolution with full type accuracy."
PROJECT.md lists "Cross-file call resolution — requires type registry, HIGH complexity" as Out of Scope.
The v1.7 goal is "resolve call expressions to symbol IDs" — name-based resolution is sufficient for
the primary use case ("who calls foo" in a focused agent query context).

ts-morph can be reconsidered in a future milestone if type-accurate resolution is needed.

---

## New Schema: symbol_dependencies

Add to `src/db/schema.ts`. No new library required — uses existing `drizzle-orm/sqlite-core` imports.

```typescript
// Phase N — symbol-level call-site edges.
// caller_symbol_id / callee_symbol_id reference symbols(id) logically (no FK — same rationale as symbols table).
// Purged via deleteSymbolDepsForFile() when a file is deleted or re-extracted.
export const symbol_dependencies = sqliteTable('symbol_dependencies', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  caller_symbol_id: integer('caller_symbol_id').notNull(),
  callee_symbol_id: integer('callee_symbol_id').notNull(),
  call_line:        integer('call_line'),           // 1-indexed source line of the call_expression
  confidence:       real('confidence').notNull().default(0.8),
}, (t) => [
  index('symdep_caller_idx').on(t.caller_symbol_id),   // "what does foo call"
  index('symdep_callee_idx').on(t.callee_symbol_id),   // "who calls foo"
]);
```

Both indices are required. "Who calls foo" (callee lookup) is the primary MCP query pattern.
"What does foo call" (caller lookup) is secondary but needed for impact analysis.

**No recursive CTEs in v1.7.** The "who calls foo transitively" use case is Out of Scope per PROJECT.md.
When needed in v1.8+, `getSqlite().prepare('WITH RECURSIVE ...')` works fine with better-sqlite3.
Drizzle's `db.$with()` supports non-recursive CTEs only; recursive CTEs require raw SQL.

---

## Installation

```bash
# Two new production dependencies
npm install tree-sitter-go tree-sitter-ruby
```

That is the complete install step. No other packages needed.

Expected output: `tree-sitter-go@0.25.0`, `tree-sitter-ruby@0.23.1`.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `tree-sitter-go@0.25.0` for Go symbols | Continue D-06 regex path | Regex extractGoImports works for edges but produces no symbol names or line ranges. Now that tree-sitter-go is stable on npm with the right peerDep, the grammar path is superior for symbols. Edge extraction stays on regex — no regression. |
| `tree-sitter-ruby@0.23.1` for Ruby symbols | Regex-based Ruby symbol extraction | No reliable regex for Ruby method/class/module extraction (Ruby syntax is complex, blocks look like method bodies). Tree-sitter gives accurate line ranges and handles edge cases (one-liner defs, endless methods). |
| tree-sitter call_expression walk for call-site edges | ts-morph `findReferences()` | ts-morph requires loading entire project TypeScript language service (235ms import + project-size startup), breaks incremental per-file model, adds 13MB+ to node_modules. Name-based resolution at INFERRED 0.8 is sufficient for v1.7 agent queries. |
| `symbol_dependencies` table with symbol IDs | Denormalized table with (caller_path, caller_name, callee_path, callee_name) | Denormalized table duplicates data already in `symbols` table. ID-based JOIN is slightly more complex but keeps data normalized, and the query pattern (lookup by callee_symbol_id) maps directly to a single index. |
| Raw `getSqlite()` for call graph queries | drizzle-orm query builder | Drizzle doesn't support recursive CTEs (future need) and the JOINs across `symbols` + `symbol_dependencies` are cleaner in raw SQL. Consistent with existing repository.ts pattern. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `ts-morph` | Type-aware call resolution is not required for v1.7. Adds 235ms startup overhead, ~13MB, and fundamentally breaks the per-file streaming model that keeps scan wall-time under budget. | tree-sitter call_expression walk in existing `extractRicherEdges()` |
| TypeScript Compiler API directly (`typescript` pkg) | Same problems as ts-morph, more verbose, no benefit. | Same |
| `tree-sitter-go@<0.25.0` | Older versions have peerDep ^0.21.x — potentially ABI-incompatible with installed tree-sitter@0.25.0. | `tree-sitter-go@^0.25.0` only |
| A separate Go symbol-extractor that re-uses `resolveGoImports()` regex | Symbol extraction needs line ranges, which regex cannot provide reliably for multi-line function signatures. | `tree-sitter-go@0.25.0` AST walk |
| `@typescript/language-server` or language-server protocol deps | Language servers are designed for editor integration, not daemon extraction. | tree-sitter |
| `acorn` or `babel/parser` | Redundant — tree-sitter-typescript/javascript already parse TS/JS. Two AST libraries for the same language is waste. | tree-sitter (already installed) |
| Drizzle schema migrations for `symbol_dependencies` | The project uses manual SQLite migrations (additive ALTER TABLE or CREATE TABLE IF NOT EXISTS) with a version integer, not drizzle-kit migrations in production. Match existing pattern. | Manual `CREATE TABLE IF NOT EXISTS` in migration logic |
| Recursive CTE infrastructure | Transitive call graph queries are Out of Scope per PROJECT.md. Don't over-engineer. | Simple JOIN on `symbol_dependencies` |

---

## Version Compatibility

| Package | Version | Compatible With | Verified |
|---------|---------|-----------------|---------|
| `tree-sitter-go@0.25.0` | latest | `tree-sitter@0.25.0` (peerDep ^0.25.0 — exact match) | HIGH — peerDep verified via `npm view`, live parse test confirmed `function_declaration`/`method_declaration`/`type_declaration`/`const_declaration` |
| `tree-sitter-ruby@0.23.1` | latest | `tree-sitter@0.25.0` (peerDep ^0.21.1 = >=0.21.1 <1.0.0, covers 0.25.0) | HIGH — live test confirmed: loads cleanly, parses `program` → `method`, `singleton_method`, `class`, `module` without error |
| `tree-sitter-python@0.25.0` | already installed | `tree-sitter@0.25.0` | HIGH — already working in production (v1.4+) |
| `better-sqlite3@12.6.2` | already installed | New `symbol_dependencies` table | HIGH — existing `getSqlite().prepare()` pattern, no new library needed |
| `drizzle-orm@0.45.1` | already installed | `symbol_dependencies` table schema definition | HIGH — table added to schema.ts same as `symbols` table |

---

## Key Decisions for v1.7

| Decision | Rationale |
|----------|-----------|
| D-06 reversed: tree-sitter-go@0.25.0 for Go symbols | Grammar is now stable on npm with correct peerDep. Use for symbols only — edge extraction stays on regex. |
| tree-sitter-ruby@0.23.1 for Ruby symbols | Only reliable option for line-range symbol extraction. peerDep semver-compatible with tree-sitter@0.25.0. Tested. |
| Python symbol extraction extends existing tree-sitter-python (no new package) | tree-sitter-python already installed and working for edges. Symbol walk is additive to `extractPythonEdges()`. |
| Call-site edges via tree-sitter call_expression walk (not ts-morph) | Fits incremental per-file model. No startup overhead. INFERRED 0.8 confidence is sufficient for v1.7 agent queries. |
| `symbol_dependencies` table with dual indices | Simple JOIN queries for "who calls foo" and "what does foo call". No recursive CTEs in v1.7. |
| SymbolKind extended with 'module', 'struct' | Ruby modules and Go structs are distinct from 'class'. Additive — find_symbol tool handles unknown kinds gracefully. |
| Top-level symbols only for Python/Ruby/Go | Same scope as TS/JS v1.6. Nested method extraction deferred to v1.8. Line ranges make nesting navigable anyway. |
| isExport = false for all Ruby/Python/Go symbols | These languages have no `export` keyword. The `is_export` field is TS/JS-specific; defaults false for other languages. |

---

## Sources

- `npm view tree-sitter-go` — confirmed `0.25.0` latest, `peerDependencies: { tree-sitter: '^0.25.0' }` (HIGH confidence — live npm registry, 2026-04-23)
- `npm view tree-sitter-ruby` — confirmed `0.23.1` latest, `peerDependencies: { tree-sitter: '^0.21.1' }` (HIGH confidence — live npm registry, 2026-04-23)
- Live parse test: `tree-sitter-ruby@0.23.1` + `tree-sitter@0.25.0` in `/tmp/test-ts-ruby` — confirmed load + parse without errors (HIGH confidence — live test)
- Live parse test: `tree-sitter-go@0.25.0` + `tree-sitter@0.25.0` — confirmed `function_declaration`, `method_declaration`, `type_declaration`, `const_declaration` (HIGH confidence — live test)
- Live Python AST probe: `async def` nodes have type `function_definition` (not `async_function_definition`) — `async` is a keyword child (HIGH confidence — live test against installed `tree-sitter-python@0.25.0`)
- Context7 `/tree-sitter/tree-sitter-python` — `decorated_definition` node wraps `function_definition` or `class_definition` with `decorator` children (HIGH confidence)
- Context7 `/tree-sitter/tree-sitter-ruby` — `method`, `singleton_method`, `class`, `module` node types with `name` field; `body_statement` wraps class body (HIGH confidence)
- Context7 `/tree-sitter/tree-sitter-go` — `function_declaration`, `method_declaration`, `type_spec`, `const_spec` node types (HIGH confidence)
- Context7 `/dsherret/ts-morph` — `findReferences()` API, `Project.addSourceFilesAtPaths()` semantics; confirms whole-project loading model (HIGH confidence)
- Live ts-morph startup benchmark: `import { Project } from 'ts-morph'` = 235ms in `/tmp/test-tsmorph` (HIGH confidence — live measurement)
- `/home/autopcap/FileScopeMCP/src/db/schema.ts` — existing schema patterns for additive table design (HIGH confidence — codebase)
- `/home/autopcap/FileScopeMCP/src/language-config.ts` — existing Go regex path (D-06), grammar loading pattern (HIGH confidence — codebase)
- `/home/autopcap/FileScopeMCP/src/change-detector/ast-parser.ts` — `extractRicherEdges()` single-pass model, `importNameToSource` map (HIGH confidence — codebase)

---

*Stack research for: FileScopeMCP v1.7 Multi-Lang Symbols + Call-Site Edges — new capabilities only*
*Researched: 2026-04-23*
