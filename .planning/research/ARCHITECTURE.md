# Architecture Research

**Domain:** Incremental extension of an existing MCP server — multi-language symbol extraction and call-site dependency edges
**Researched:** 2026-04-23
**Confidence:** HIGH (all claims based on direct codebase inspection)

---

## System Context: What v1.7 Is Adding To

The existing v1.6 system already has a clean, well-factored extraction pipeline:

```
coordinator.ts (scan pass 2)
    |── isTsJs? YES → extractTsJsFileParse()  ← single AST pass for edges + symbols + importMeta
    |                        |
    |                 setEdgesAndSymbols()       ← atomic transaction: file_dependencies + symbols
    |
    └── otherwise → extractEdges()              ← language-config registry dispatch
                         |
                   setEdges()                   ← file_dependencies only (no symbols)
```

The `LanguageConfig` registry in `src/language-config.ts` has one entry per file extension, each entry holding an `extract(filePath, content, projectRoot): Promise<EdgeResult[]>` function. The single public API is `extractEdges()`. For TS/JS, a parallel function `extractTsJsFileParse()` exists to return edges + symbols + importMeta in one call.

The `symbols` table stores: `(id, path, name, kind, start_line, end_line, is_export)`. No language column. The `file_dependencies` table stores edge metadata including `imported_names` (JSON string array) and `import_line` (nullable, only populated for TS/JS).

The `deleteFile()` function in `repository.ts` runs a three-DELETE transaction (file_dependencies + symbols + files) to handle file unlink without orphaned rows.

---

## Question 1: Multi-Language Symbol Extraction Integration

### Should extractEdges() become extractSymbolsAndEdges()?

No. The correct extension is a parallel path to `extractTsJsFileParse()`, not a rename of `extractEdges()`.

The v1.6 pattern established two co-existing callsites in `coordinator.ts`:
- `extractTsJsFileParse()` — returns `{ edges, symbols, importMeta }` for TS/JS
- `extractEdges()` — returns `EdgeResult[]` only, for everything else

The v1.7 pattern should extend this to a three-way dispatch in `coordinator.ts`:

```typescript
if (isTsJs) {
  // v1.6 path: unchanged
  const parsed = await extractTsJsFileParse(filePath, content, projectRoot);
  ...setEdgesAndSymbols(...)
} else if (isPythonGoRuby) {
  // v1.7 path: new
  const parsed = await extractLangFileParse(filePath, content, projectRoot);
  // parsed = { edges: EdgeResult[], symbols: Symbol[] }
  // no importMeta (not applicable to these languages)
  setEdgesAndSymbols(filePath, parsed.edges, parsed.symbols);
} else {
  // existing generic path: unchanged
  const edges = await extractEdges(filePath, content, projectRoot);
  setEdges(filePath, edges);
}
```

A new exported function `extractLangFileParse()` in `language-config.ts` mirrors `extractTsJsFileParse()` but for Python/Go/Ruby. It returns `{ edges, symbols }` (no `importMeta` — those fields stay TS/JS-only for v1.7). Returning `null` for unsupported extensions maintains the same fallback pattern already established.

### Where does per-language symbol kind mapping live?

Inside each language-specific extractor function in `src/language-config.ts`, co-located with the existing edge extraction logic for that language. There is no separate registry file or separate `src/symbols/` directory needed.

The pattern from v1.6 `extractBareTopLevelSymbol()` in `ast-parser.ts` demonstrates this: kind mapping is a local `switch` statement next to the AST visitor. Repeat this pattern:

- Python: inside `extractPythonEdges()` — extend it to also populate a `Symbol[]` while visiting the same tree nodes. Function defs map to `'function'`, class defs to `'class'`, top-level assignments to `'const'`.
- Ruby: inside `extractRubyEdges()` — but Ruby currently uses regex (no tree-sitter grammar), so symbol extraction requires either a regex approach (limited, misses nesting) or adding `tree-sitter-ruby`. The cleanest path is to keep Ruby on regex for edges and emit no symbols for v1.7 (deferred until tree-sitter-ruby is validated), consistent with how Go is handled (regex edges, no symbols). Verify `tree-sitter-ruby` npm availability before committing to AST.
- Go: inside `extractGoEdges()` — regex-only. Add regex passes for `func \w+` and `type \w+ struct|interface`. Emit `Symbol[]` with `isExport` set by Go export convention (capitalized name). Same return shape as AST extractors.

### How does Go's regex path emit symbols in the same return shape?

The `Symbol` interface (`src/db/symbol-types.ts`) requires `name`, `kind`, `startLine`, `endLine`, `isExport`. All are derivable from regex with line number tracking:

```typescript
// Inside extractGoEdges() (or a new extractGoSymbols() helper called from it):
const GO_FUNC_RE = /^func\s+(?:\([^)]+\)\s+)?([A-Z]\w*)\s*\(/gm;
const GO_TYPE_RE = /^type\s+(\w+)\s+(struct|interface)/gm;
// Track line numbers by counting newlines to the match offset
```

`isExport = name[0] === name[0].toUpperCase()` — Go's capitalization convention.

`endLine` from regex is approximate (regex cannot find the closing brace without a full parser). Two practical options:
1. Emit `endLine = startLine` (single-line point reference). Simple, honest.
2. Run a brace-depth counter from the match position to find the closing brace. More accurate but adds complexity.

Recommendation: start with `endLine = startLine` for Go (regex limitation is known). The `find_symbol` query result already shows `startLine` and `endLine`, so the agent can navigate to startLine and read forward. Go symbols are typically short; a point reference is usable.

### Does the symbols table need a language column?

No. `file_id`'s path extension already encodes the language. Queries that need language filtering (e.g., "only Python symbols") can join against the file path with `LIKE '%.py'`. Adding a `language` column would be denormalization without a concrete query benefit. The `kind` values do not conflict across languages (all languages use `function`, `class`, `const` where applicable). The schema stays unchanged.

---

## Question 2: Call-Site Edge Architecture

### New table or extend file_dependencies?

New table `symbol_dependencies`. Extending `file_dependencies` with nullable `source_symbol_id`/`target_symbol_id` would make the existing file-level edge queries more complex (must filter `WHERE source_symbol_id IS NULL`) and couples two distinct concepts in one table. A separate table is cleaner and avoids touching the column contract of every existing `file_dependencies` query.

**New table definition:**

```sql
CREATE TABLE symbol_dependencies (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source_symbol_id  INTEGER NOT NULL,   -- FK to symbols.id (caller)
  target_symbol_id  INTEGER NOT NULL,   -- FK to symbols.id (callee)
  call_line         INTEGER NOT NULL,   -- 1-indexed source line of the call site
  edge_type         TEXT NOT NULL DEFAULT 'calls',
  confidence        REAL NOT NULL DEFAULT 1.0
);
CREATE INDEX sym_dep_source_idx ON symbol_dependencies(source_symbol_id);
CREATE INDEX sym_dep_target_idx ON symbol_dependencies(target_symbol_id);
```

No FK constraint enforcement (consistent with existing `symbols` table which deliberately has no FK to `files`). Cascade deletes are handled explicitly in `deleteFile()` and any new per-file-reset logic.

### Reference resolution: during AST walk or separate pass?

During the AST walk, but only for same-file calls (no cross-file resolution in v1.7).

The v1.7 scope as defined in PROJECT.md is "TS/JS symbol-level call-site edges." Cross-file call-site resolution was explicitly deferred in v1.6 (listed in Out of Scope: "Cross-file call-site resolution — needs full type registry, HIGH complexity"). v1.7 should respect this boundary.

**What v1.7 resolves:**
- **Same-file calls:** During the AST walk in `extractRicherEdges()` (in `ast-parser.ts`), after collecting symbols, do a second pass over call expression nodes. For each call `foo()`, check if `foo` appears in the file's own symbol list. If yes, emit a call-site edge: caller_symbol → callee_symbol. This is purely local (no import lookup needed).
- **Imported calls:** Using `imported_names` already stored in `file_dependencies`, it is possible to resolve `foo()` where `foo` was imported from a known file. The `importMeta[]` already tracks which names came from which specifier. After building the file's symbol index AND querying `file_dependencies` for its imports, a call to `foo()` can be traced to `target_path` + `foo` → query `symbols WHERE path = target_path AND name = 'foo'`. This is the "imported" case: deterministic but requires a DB lookup per call site.

**Recommendation for v1.7:** Implement same-file and imported-call resolution. Skip ambiguous cases (multiple symbols with same name, dynamic calls, computed property calls). This is achievable within the existing AST walk without a full type registry.

### Building the name→symbol index

Build it once per file during `extractRicherEdges()`. The index is: `Map<string, Symbol>` from the file's own symbol list (already populated in the same AST walk). For imported symbols, query `symbols WHERE path IN (importedFilePaths)` after the AST walk is complete (a single SQL batch query). This avoids streaming or global pre-computation.

The flow is:

```
extractRicherEdges(filePath, source):
  1. AST walk → collect regularImports, symbols, importMeta (existing)
  2. After walk: build localSymbolIndex = Map<name, symbol_id> from symbols[]
  3. Resolve import paths → importedFilePaths (done already in extractTsJsFileParse via file resolution)
  4. Query DB: SELECT id, name, path FROM symbols WHERE path IN (importedFilePaths)
     → build importedSymbolIndex = Map<name, {symbol_id, path}>
  5. Second AST walk (or continuation of first): collect call_expression nodes
     → for each call `foo()`:
       a. localSymbolIndex.has(foo) → emit (callerSymbol.id, localSymbol.id, call_line)
       b. importedSymbolIndex.has(foo) → emit (callerSymbol.id, importedSymbol.id, call_line)
       c. else → skip (unresolvable — no error, no noise)
  6. Return: { edges, symbols, importMeta, callSiteEdges }
```

The DB query in step 4 is synchronous via `better-sqlite3` (consistent with existing repository pattern).

### Ambiguity handling

- **Same name in multiple imports:** Take the first match by file path alphabetical order (deterministic, not perfect, acceptable for v1.7). Do not fail or skip.
- **Multiple symbols with same name in same file:** Should not happen for top-level declarations (JS/TS prevents duplicate `function foo`). If it does (function overloads in TS), pick the first by `start_line`.
- **Dynamic calls `obj[method]()`:** Skip — cannot resolve without type inference. No emission, no logging noise.
- **Method calls `this.foo()`, `obj.foo()`:** Skip for v1.7 — method-level symbols are out of scope.

### Incremental update on file change

When a file changes (watcher `change` event):

1. Re-extract the file: new symbols, new edges, new call-site edges.
2. Delete old `symbol_dependencies` where `source_symbol_id IN (SELECT id FROM symbols WHERE path = changedFile)`.
3. The symbol IDs for the changed file are also replaced (upsertSymbols does DELETE then INSERT, so old IDs are gone).
4. After re-insertion of symbols, insert new `symbol_dependencies` rows using the new symbol IDs.
5. Additionally invalidate call-site edges where `target_symbol_id` points to a symbol in the changed file (because the callee may have moved or been renamed): DELETE FROM `symbol_dependencies` WHERE `target_symbol_id IN (SELECT id FROM symbols WHERE path = changedFile)`.

Steps 2 and 5 together scope the invalidation correctly. Any file that called into the changed file will lose its call-site edges to that file's symbols. On the next re-extraction of the calling file (triggered by watcher if the caller file changes, or by on-demand re-scan), the edges will be rebuilt.

**This is intentionally conservative.** Callers of changed symbols do not get re-extracted automatically unless they are themselves modified. This matches the existing behavior of `file_dependencies` (edges are re-emitted only when the source file changes, not when the target file changes).

The `deleteFile()` transaction in `repository.ts` must be extended to also DELETE from `symbol_dependencies` where `source_symbol_id` or `target_symbol_id` is a symbol belonging to the deleted file:

```typescript
// Extended deleteFile() transaction (repository.ts):
sqlite.prepare(
  `DELETE FROM symbol_dependencies
   WHERE source_symbol_id IN (SELECT id FROM symbols WHERE path = ?)
      OR target_symbol_id IN (SELECT id FROM symbols WHERE path = ?)`
).run(filePath, filePath);
// Then existing DELETEs: file_dependencies, symbols, files
```

### Symbol IDs and file rename

Symbol IDs are auto-increment integers (`symbols.id`). A file rename in the watcher appears as `unlink` + `add` (chokidar behavior) or as a `change` on the renamed path. In either case:

- **Rename via unlink+add:** `deleteFile(oldPath)` cascades all symbol_dependencies. The new path is treated as a fresh file: new symbols with new IDs, new call-site edges.
- **Rename via change event:** Same as unlink+add in effect — `upsertSymbols()` does DELETE+INSERT for the new path, new IDs assigned.

Symbol IDs are therefore ephemeral — they are internal join keys valid only for the current scan. No external system (MCP tools) exposes symbol IDs directly. The `find_symbol` tool returns `path + startLine` as the navigation reference, not `id`. This is correct and requires no change.

---

## Question 3: MCP Surface Integration

### Where do new call-site tools register?

In `registerTools()` in `src/mcp-server.ts`, following the exact same pattern as `find_symbol` and `get_file_summary`. The registration is mechanical: `server.registerTool("get_callers", { inputSchema: { symbolName, filePath?, ... }, annotations: { readOnlyHint: true } }, handler)`.

### Suggested new tools

**`get_callers`** — "Who calls this symbol?"

```typescript
server.registerTool("get_callers", {
  title: "Get Callers",
  description: "List all call-site edges pointing to a symbol. Returns callers with their file path, symbol name, and call line. Resolves both same-file and cross-file callers captured during last extraction. Use this after find_symbol to trace who calls a function.",
  inputSchema: {
    name: z.string().min(1).describe("Exact symbol name (no wildcards)"),
    filePath: z.string().optional().describe("Absolute path to disambiguate when multiple files export the same name"),
    maxItems: z.coerce.number().int().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true }
}, async ({ name, filePath, maxItems }) => { ... });
```

**`get_callees`** — "What does this symbol call?" (secondary tool, can defer to v1.8)

### Do existing tools need enrichment?

`get_file_summary` could gain a `callers[]` field per exported symbol. However, this couples the already-complex `get_file_summary` response shape to a new join on `symbol_dependencies`. The cleaner design is to keep call-site queries in a dedicated tool (`get_callers`) and leave `get_file_summary` unchanged. An agent that needs both will call both tools. This avoids making `get_file_summary` slower for the majority of use cases that do not need call-site data.

`find_symbol` stays unchanged. Its job is symbol location; call-site is a separate dimension.

---

## Question 4: Watcher Lifecycle Extension

### Extending deleteFile() for symbol_dependencies

The v1.6 watcher already hardened `deleteFile()` to a three-DELETE transaction in `src/db/repository.ts`. Extend it to four DELETEs (all in the same `sqlite.transaction()`):

```
Order of DELETEs in deleteFile():
1. DELETE FROM symbol_dependencies WHERE source_symbol_id or target_symbol_id IN (SELECT id FROM symbols WHERE path = ?)
2. DELETE FROM file_dependencies WHERE source_path = ? OR target_path = ?
3. DELETE FROM symbols WHERE path = ?
4. DELETE FROM files WHERE path = ?
```

Delete from `symbol_dependencies` BEFORE deleting from `symbols` because the subquery `SELECT id FROM symbols WHERE path = ?` must execute while the symbols rows still exist. Alternatively, materialize the IDs first into a temp list within the transaction.

The safest implementation:

```typescript
const symbolIds = sqlite
  .prepare('SELECT id FROM symbols WHERE path = ?')
  .all(filePath)
  .map((r: { id: number }) => r.id);

if (symbolIds.length > 0) {
  const placeholders = symbolIds.map(() => '?').join(',');
  sqlite.prepare(`DELETE FROM symbol_dependencies WHERE source_symbol_id IN (${placeholders}) OR target_symbol_id IN (${placeholders})`).run(...symbolIds, ...symbolIds);
}
// then existing DELETEs
```

For the watcher `change` event (file modified, not deleted): the call-site invalidation described in Question 2 above must run as part of the per-file re-extraction transaction, before re-inserting new symbols and new call-site edges.

---

## Question 5: Migration

### kv_state flag pattern for v1.7

Two independent flags, sequential in boot order:

**Flag 1: `multilang_symbols_bulk_extracted`**

Purpose: backfill Python/Go/Ruby symbols for all existing files on first boot after migration. Runs in `coordinator.init()` after the new migration applies (analogous to `runSymbolsBulkExtractionIfNeeded()` in `src/migrate/bulk-symbol-extract.ts`).

New module: `src/migrate/bulk-multilang-symbol-extract.ts`

Pattern: identical to v1.6 `bulk-symbol-extract.ts` — iterate `getAllFiles()`, filter to `.py`/`.go`/`.rb`, call the new `extractLangFileParse()`, call `setEdgesAndSymbols()`. Per-file errors are logged and skipped. Flag set only after full pass.

**Flag 2: `call_site_edges_bulk_extracted`**

Purpose: backfill `symbol_dependencies` for all existing TS/JS files after the table is created. Cannot run until Flag 1 is set AND the `symbol_dependencies` table migration has applied. These are independent because call-site edges require `symbols.id` values to exist for all files first.

New module: `src/migrate/bulk-call-site-extract.ts`

This is the more expensive pass: for each TS/JS file, re-parse, resolve call sites against the full `symbols` table. Must run after `symbols` is populated for all languages (i.e., after Flag 1 completes for Python/Go/Ruby).

**Boot order:**
```
openDatabase()  [applies migration for symbol_dependencies table]
runMultilangSymbolsBulkExtractionIfNeeded()   [Flag 1]
runSymbolsBulkExtractionIfNeeded()            [v1.6 flag — idempotent no-op]
runCallSiteEdgesBulkExtractionIfNeeded()      [Flag 2 — depends on Flag 1 complete]
buildFileTree()
```

### Are the two flags sequential or independent?

Sequential. The call-site backfill needs symbol IDs for all files to do cross-file resolution. Running it before Python/Go/Ruby symbols are populated means call-site edges from TS/JS files that call into Python/Go/Ruby files would be incomplete. The flag gate enforces the ordering: Flag 2's check reads `getKvState('multilang_symbols_bulk_extracted')` and aborts (with a log warning) if Flag 1 is not set.

---

## Question 6: Build Order

### Dependency graph across capabilities

```
[A] Schema migration — ADD symbol_dependencies table (migration file, no code deps)
    |
    |── [B] Multi-lang symbol extraction (Python AST, Go regex, Ruby TBD)
    |       |── Depends on: nothing (additive to existing extractors)
    |       |── Produces: Symbol[] for new languages in coordinator pass 2
    |       └── Unlocks: [D] Call-site backfill pass (needs Symbol rows populated)
    |
    |── [C] Symbol-level call-site edges for TS/JS
    |       |── Depends on: [A] schema
    |       |── Depends on: Symbol IDs in DB (TS/JS symbols already exist from v1.6)
    |       |── Produces: symbol_dependencies rows
    |       └── Requires: extended deleteFile() to cascade symbol_dependencies
    |
    |── [D] Migration: bulk backfill passes (multilang symbols + call-site edges)
    |       |── Depends on: [B] and [C] extractors exist
    |       └── Runs on first boot, flag-gated
    |
    └── [E] MCP tool surface (get_callers + optional get_callees)
            |── Depends on: [A] schema (to query symbol_dependencies)
            |── Depends on: [C] for data to exist
            └── Additive to registerTools() — no existing tools modified
```

**Recommended phase order:**

**Phase 36: Schema + Multi-Lang Symbols**
- Add `symbol_dependencies` table migration
- Python symbol extraction (AST walk extension in `language-config.ts`)
- Go symbol extraction (regex in `language-config.ts`)
- `extractLangFileParse()` exported function in `language-config.ts`
- Coordinator dispatch: three-way if/else (TS/JS | Python+Go+Ruby | other)
- `setEdgesAndSymbols()` called for Python/Go
- Bulk backfill pass module + flag

Rationale: symbols for all languages must be in the DB before call-site edges can reference their IDs. This phase can ship and be tested independently — `find_symbol` immediately works for Python and Go files.

**Phase 37: Call-Site Edges**
- Extend `extractRicherEdges()` in `ast-parser.ts` to return `callSiteEdges`
- Add `getCallSiteEdges()` repository function + `setCallSiteEdges()` repository function
- Extend `deleteFile()` transaction to cascade `symbol_dependencies`
- Extend coordinator's per-file write path for call-site edges
- Bulk backfill pass for call-site edges (Flag 2)

**Phase 38: MCP Surface**
- `get_callers` tool registration in `mcp-server.ts`
- Repository query: `getCallers(symbolName, filePath?, limit)` — join `symbol_dependencies` + `symbols`
- Tests: repository unit test, MCP transport integration test via InMemoryTransport

Rationale: Tool registration is pure I/O surface — keep it last so the data contract is stable before surfacing to agents. This also allows Phase 37's data model to be validated before the MCP shape is locked.

---

## Modified Components

| Component | File | What Changes |
|-----------|------|-------------|
| `schema.ts` | `src/db/schema.ts` | ADD: `symbol_dependencies` table definition |
| `language-config.ts` | `src/language-config.ts` | ADD: `extractLangFileParse()` export; EXTEND: `extractPythonEdges()`, `extractGoEdges()` to also return `Symbol[]`; MAYBE: `extractRubyEdges()` if tree-sitter-ruby is available |
| `ast-parser.ts` | `src/change-detector/ast-parser.ts` | EXTEND: `extractRicherEdges()` return type gains `callSiteEdges: CallSiteEdge[]`; ADD: call-expression visitor logic |
| `coordinator.ts` | `src/coordinator.ts` | MODIFY: pass-2 dispatch from two-way to three-way if/else; call new path for Python/Go/Ruby |
| `repository.ts` | `src/db/repository.ts` | EXTEND: `deleteFile()` transaction adds symbol_dependencies DELETE; ADD: `setCallSiteEdges()`, `getCallers()` |
| `mcp-server.ts` | `src/mcp-server.ts` | ADD: `get_callers` tool registration in `registerTools()` |

## New Components

| Component | File | Purpose |
|-----------|------|---------|
| Symbol-deps migration | `drizzle/XXXX_symbol_dependencies.sql` | CREATE TABLE symbol_dependencies |
| Multi-lang bulk extract | `src/migrate/bulk-multilang-symbol-extract.ts` | Flag-gated backfill for Python/Go/Ruby symbols |
| Call-site bulk extract | `src/migrate/bulk-call-site-extract.ts` | Flag-gated backfill for TS/JS call-site edges |
| Call-site types | `src/db/call-site-types.ts` (optional) | `CallSiteEdge` interface if it grows beyond inline use |

---

## Data Flow Changes in v1.7

### Scan pass 2 (coordinator.ts) — extended

```
For each file:
    ext is .ts/.tsx/.js/.jsx?
        YES → extractTsJsFileParse()     [returns edges + symbols + importMeta + callSiteEdges (new)]
              setEdgesAndSymbols()        [unchanged]
              setCallSiteEdges()          [NEW — writes symbol_dependencies rows]

    ext is .py/.go/.rb?
        YES → extractLangFileParse()     [NEW — returns edges + symbols]
              setEdgesAndSymbols()        [existing — symbols column added for these langs]

    else → extractEdges()               [unchanged]
           setEdges()                   [unchanged]
```

### Call-site resolution in extractRicherEdges()

```
extractRicherEdges(filePath, source):
  [existing AST walk: regularImports, reExportSources, inheritsFrom, symbols, importMeta]
  
  After walk:
    localIndex = Map<name, symbol_id> from symbols[]
    importedFilePaths = resolve(regularImports) [already done by caller]
    importedIndex = getSymbolsByPaths(importedFilePaths)  [synchronous DB query]
    
  Call-expression pass (new):
    For each call_expression node in AST:
      callerSymbol = find enclosing symbol from localIndex by line range
      calleeName = extract function name from call_expression
      if calleeName in localIndex:
        emit CallSiteEdge(caller.id, local.id, call_line, 'calls', 1.0)
      elif calleeName in importedIndex:
        emit CallSiteEdge(caller.id, imported.id, call_line, 'calls', 1.0)
      else: skip (dynamic, method, or external)
  
  Return: { regularImports, reExportSources, inheritsFrom, symbols, importMeta, callSiteEdges }
```

### Watcher unlink (deleteFile()) — extended transaction

```
BEGIN TRANSACTION
  1. Materialize symbol IDs: SELECT id FROM symbols WHERE path = ?
  2. DELETE FROM symbol_dependencies WHERE source_symbol_id IN (...) OR target_symbol_id IN (...)
  3. DELETE FROM file_dependencies WHERE source_path = ? OR target_path = ?
  4. DELETE FROM symbols WHERE path = ?
  5. DELETE FROM files WHERE path = ?
END TRANSACTION
```

### Boot migration sequence

```
openDatabase()
  → drizzle migrate() applies pending SQL files
  → symbol_dependencies table now exists

runMultilangSymbolsBulkExtractionIfNeeded()
  → kv_state['multilang_symbols_bulk_extracted'] set?
    NO → iterate .py/.go/.rb files → extractLangFileParse() → setEdgesAndSymbols()
    YES → skip

runCallSiteEdgesBulkExtractionIfNeeded()
  → kv_state['multilang_symbols_bulk_extracted'] NOT set? → abort (log warning)
  → kv_state['call_site_edges_bulk_extracted'] set? → skip
  → iterate .ts/.tsx/.js/.jsx files → re-parse + resolve call sites → setCallSiteEdges()
  → set flag

buildFileTree()
```

---

## Architectural Patterns in Use

### Pattern 1: Single-Pass AST Walk (established v1.6)

**What:** One `parser.parse()` call emits all data products (edges, symbols, importMeta). No re-parsing.
**Extension for v1.7:** The call-expression pass is a second loop over the same tree (already in memory), not a second `parser.parse()` call. This preserves the PERF constraint.
**Integration point:** `extractRicherEdges()` in `src/change-detector/ast-parser.ts`.

### Pattern 2: Atomic Per-File Write (established v1.6)

**What:** `setEdgesAndSymbols()` wraps all inserts in `sqlite.transaction()`. A crash leaves the file in its prior state.
**Extension for v1.7:** `setCallSiteEdges()` must participate in the same transaction or be called as a separate transaction immediately after. Separate transaction is acceptable because a partial call-site write is recoverable (edges are idempotent on re-extraction). Combining into one transaction is cleaner but requires inlining into the same `sqlite.transaction()` closure.
**Recommendation:** Extend `setEdgesAndSymbols()` to accept an optional `callSiteEdges?` parameter and include the symbol_dependencies DELETE+INSERT in the same transaction. One closure, one transaction.

### Pattern 3: Repository as DB Boundary (established v1.0)

**What:** All SQL in `src/db/repository.ts`. Callers never write raw SQL.
**Extension for v1.7:** New functions `setCallSiteEdges()`, `getCallers()`, `getCallees()` go in `repository.ts`. The `symbol_dependencies` table is never queried outside this module.

### Pattern 4: kv_state Flag for One-Shot Migration Gates (established v1.6)

**What:** `getKvState(FLAG_KEY)` check at boot; if null, run the pass, set the flag.
**Extension for v1.7:** Two new flags following the identical pattern. Sequential dependency enforced by checking Flag 1 inside Flag 2's guard.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Full Cross-File Call Resolution

**What people do:** Build a project-wide name → symbol map and resolve all call sites globally.
**Why it's wrong:** Requires a full type registry (TypeScript's type system) to handle overloads, generics, and interface dispatch. This is months of work. PROJECT.md explicitly defers this.
**Do this instead:** Resolve only (a) same-file calls and (b) calls to named imports from known files. Skip method calls, dynamic calls, and calls to symbols not resolvable via `imported_names`.

### Anti-Pattern 2: A Separate extractSymbols() Call After extractEdges()

**What people do:** Add a separate extraction phase — run `extractEdges()` for deps, then separately run `extractSymbols()` for each file.
**Why it's wrong:** Double-parse of every file. v1.6 PERF budget is already tight (+13.75% scan time). Double-parsing would double the AST overhead.
**Do this instead:** Extend the existing extractor functions to emit symbols alongside edges in one pass, exactly as v1.6 did for TS/JS.

### Anti-Pattern 3: Symbol IDs as Stable External References

**What people do:** Return `symbol.id` in MCP tool responses and use it for subsequent queries.
**Why it's wrong:** Symbol IDs are reset on every file re-extraction (DELETE+INSERT pattern in `upsertSymbols()`). An ID from one tool call may not exist after the watcher fires.
**Do this instead:** Use `(path, name, startLine)` as the stable reference. The MCP tools expose these three fields. The `get_callers` tool accepts `name` + optional `filePath`, not `symbol.id`.

### Anti-Pattern 4: Storing Ruby Symbols via Regex Before Validating tree-sitter-ruby

**What people do:** Implement regex-based Ruby symbol extraction (function/class name capture) to ship Ruby symbols in the same phase as Python.
**Why it's wrong:** Ruby's scoping rules (nested classes, modules, reopened classes) make regex-based symbol extraction unreliable. Emitting wrong symbols damages `find_symbol` query quality.
**Do this instead:** Emit no symbols for Ruby in v1.7 unless `tree-sitter-ruby` is available and validated. The `extractGoEdges()` path can be extended to `{ edges, symbols: [] }` for Ruby as a safe default. Decouple Ruby from the v1.7 delivery.

### Anti-Pattern 5: Calling getSymbolsByPaths() N Times in the Call-Site Pass

**What people do:** For each call expression, query the DB to look up the callee symbol.
**Why it's wrong:** A file with 500 call expressions triggers 500 DB queries per file during bulk extraction.
**Do this instead:** Build the `importedSymbolIndex` once per file (one batch query for all import paths), then resolve all call expressions against the in-memory map. One DB query per file, not one per call site.

---

## Scaling Considerations

This is a local developer tool. The relevant scaling dimension is per-repo file count and symbol density.

| Concern | Current State | v1.7 Impact |
|---------|---------------|-------------|
| Scan wall time | Self-scan 2085ms (+13.75% over v1.5 baseline) | Call-site extraction adds a second AST pass per TS/JS file. Estimate +10-20% additional for call-site batch. Must stay under 20% total regression. |
| DB size | Symbols table: ~15K rows for a medium TS codebase | symbol_dependencies can be large (functions call many things). Expect 3-10x more rows than `symbols`. Index on both source and target is required. |
| Bulk backfill time | v1.6 bulk was fast (async file reads, sequential SQLite writes) | Call-site bulk must re-read and re-parse all TS/JS files. On large repos (500+ TS files), this may take 30-60s on first boot. Acceptable because it is one-time. |
| Query latency | getDependentsWithImports: ~1ms (raw SQLite) | getCallers: JOIN across symbol_dependencies + symbols + files. Expect 1-5ms with proper indexes. Fine for interactive tool calls. |

---

## Sources

All claims based on direct inspection of:
- `src/language-config.ts` — registry, `extractTsJsFileParse()`, `extractEdges()`, all extractor functions
- `src/change-detector/ast-parser.ts` — `extractRicherEdges()`, `RicherEdgeData`, `ImportMeta`, `extractBareTopLevelSymbol()`
- `src/db/schema.ts` — `symbols`, `file_dependencies`, `kv_state` table definitions
- `src/db/repository.ts` — `deleteFile()`, `setEdgesAndSymbols()`, `upsertSymbols()`, `findSymbols()`, `getKvState()`
- `src/db/symbol-types.ts` — `Symbol` interface, `SymbolKind`
- `src/coordinator.ts` (lines 740-788) — pass-2 dispatch, three-variable extraction pattern
- `src/mcp-server.ts` — `registerTools()`, `find_symbol`, `get_file_summary` implementations
- `src/migrate/bulk-symbol-extract.ts` — v1.6 flag-gated bulk extract pattern
- `.planning/PROJECT.md` — Out of Scope constraints, v1.7 goals, Key Decisions table
- `.planning/milestones/v1.6-research-archive/ARCHITECTURE.md` — v1.5/v1.6 context

---

*Architecture research for: FileScopeMCP v1.7 Multi-Lang Symbols + Call-Site Edges*
*Researched: 2026-04-23*
