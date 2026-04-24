# Phase 34: Symbol-Aware MCP Surface - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** `--auto`-style (user deferred all gray areas to Claude's judgment — "this whole app is for YOU remember")

<domain>
## Phase Boundary

Expose the phase-33 symbol store through the MCP surface:

1. New MCP tool `find_symbol(name, kind?, exportedOnly=true, maxItems?)` — returns matching symbols with `{path, name, kind, startLine, endLine, isExport}` in the standardized `{items, total, truncated?: true}` envelope. Exact match by default; trailing `*` triggers prefix match.
2. Enrich `get_file_summary`:
   - New `exports: [{name, kind, startLine, endLine}]` field populated from the phase-33 `symbols` table (only rows where `is_export = 1`).
   - Upgrade `dependents: string[]` → `dependents: [{path, importedNames: string[], importLines: number[]}]` by joining `file_dependencies.imported_names`/`import_line` stored in phase 33 (D-08).

**Pure surface phase** — no new parser work, no new schema, no watcher changes. All storage and helpers for symbols + imported-name metadata already landed in Phase 33. Phase 34 wires them into the MCP tool registrations.

**Out of scope (Phase 35+):** `list_changed_since` tool, FileWatcher symbol re-extraction, Python/Go/Ruby symbol emission, cross-file reference lookups ("find all call sites of `foo`"), fuzzy matching, regex support, rename/move tracking.
</domain>

<decisions>
## Implementation Decisions

### find_symbol Matching Semantics

- **D-01: Prefix syntax — trailing `*` ONLY.** A trailing asterisk (e.g. `React*`, `use*`) switches to prefix match. Any other `*` position (leading `*foo`, middle `fo*o`, internal `foo*bar*`) is treated as a **literal character** in the name — no wildcard, no error. Keeps the matching rule one line in the description and avoids a second error code class.
- **D-02: Prefix translates to SQL `LIKE` with escaped `%`/`_`.** Build the LIKE pattern by: strip trailing `*`, escape SQLite `LIKE` metacharacters (`\`, `%`, `_`) via an explicit `ESCAPE '\'` clause, append `%`. Exact match uses `=`. No user-supplied `%` or `_` ever reaches raw SQL unescaped — injection-safe.
- **D-03: Case-sensitive (per FIND-02).** SQLite `LIKE` is case-insensitive by default; use `GLOB` instead OR the `PRAGMA case_sensitive_like = ON` session toggle. Planner picks between `GLOB` (simpler, always case-sensitive, supports `*` natively) and `LIKE … ESCAPE`. **Recommend `GLOB`** — `name = ?` for exact, `name GLOB ? || '*'` for prefix, no escaping dance.
- **D-04: `maxItems` default = 50.** Same order of magnitude as `list_files` / `find_important_files`. Hard upper clamp = 500 (protects agents from accidentally pulling a 10K-symbol dump into context). Zero or negative values rejected not as an error but by clamping to 1 (consistent with the "NOT_INITIALIZED only" error policy — all other shapes coerce silently).
- **D-05: Result ordering — `isExport DESC, path ASC, startLine ASC`.** Exports first so public API floats to the top when `exportedOnly=false` is used for diagnostic queries. Alphabetic path + line as secondary keys for deterministic, paginated-friendly ordering.
- **D-06: `kind` filter accepts the phase-33 enum values only** (`function | class | interface | type | enum | const`). An unknown kind is **NOT an error** — it matches zero rows and returns `{items: [], total: 0}`. Aligns with FIND-05 (only `NOT_INITIALIZED` errors) and the "empty result, never throw" philosophy.
- **D-07: `total` is the pre-truncation count.** When `items.length < total`, set `truncated: true`. When not truncated, omit the `truncated` field entirely (matches existing `list_files` pattern at mcp-server.ts:219).

### find_symbol Input Schema (Zod)

- **D-08: Schema shape:**
  ```ts
  {
    name: z.string().min(1),              // non-empty; trailing * triggers prefix
    kind: z.string().optional(),          // free string — unknown kinds return empty
    exportedOnly: z.coerce.boolean().default(true),  // SC #2
    maxItems: z.coerce.number().int().optional(),    // clamped [1, 500], default 50
  }
  ```
  `z.coerce.boolean()` + `z.coerce.number()` match the contract-test pattern already validated in `tests/unit/schema-coercion.test.ts` (#15895).

### get_file_summary Enrichment

- **D-09: `exports[]` source.** Call `getSymbolsForFile(normalizedPath)` (phase 33 helper), filter `s.isExport === true`, project to `{name, kind, startLine, endLine}`. No new repository helper needed for this half.
- **D-10: `exports[]` ordering.** Sort by `startLine ASC` so the response reads top-to-bottom matching source file order. Stable across runs.
- **D-11: Non-TS/JS files → `exports: []` (SUM-04).** Determined by "no rows in `symbols` table for this path", NOT by file extension. Keeps the rule declarative — any file that produces symbols gets them, any that doesn't gets `[]`. Safe default for future languages.
- **D-12: `dependents[]` aggregation — one entry per source path.** Join `file_dependencies WHERE target_path = ?` rows by `source_path`; merge their `imported_names` JSON arrays and `import_line` values into `importedNames: string[]` and `importLines: number[]` (plural per dependent, matching SC #5 wording exactly).
- **D-13: Dedupe `importedNames` within a dependent; preserve all `importLines`.** `importedNames` is set-style (`['useState', 'useEffect']` — no repeats); `importLines` keeps every source line occurrence (sorted ascending) so agents can navigate to each import statement individually.
- **D-14: Null / non-TS/JS `imported_names` rows → empty arrays.** Phase 33 D-10 stores `imported_names = NULL` for non-TS/JS edges; coerce to `importedNames: []` and `importLines: []` (or `[import_line]` if that single integer exists) on read. Never surface `null` in MCP response.
- **D-15: Ordering — `dependents[]` sorted by `path ASC`.** Deterministic output for agents that diff responses across scans.
- **D-16: `dependents[]` shape change is breaking at the wire level but explicitly sanctioned by SUM-03** ("`dependents` coerced to the richer shape"). No dual-mode, no legacy `string[]` fallback, no config flag. One code path. Per user preference: "No dual-mode fallbacks — one code path, no legacy support".

### Repository Helper Design

- **D-17: New helper `findSymbols(opts)`** for the `find_symbol` MCP path:
  ```ts
  findSymbols(opts: {
    name: string;            // exact or 'prefix*'
    kind?: SymbolKind;
    exportedOnly: boolean;   // default applied at MCP handler, passed through explicitly
    limit: number;           // post-clamp, always a positive integer
  }): { items: SymbolRow[]; total: number }
  ```
  Single-query implementation: one `SELECT COUNT(*)` for `total`, one `SELECT … LIMIT ?` for `items`, same `WHERE`. Keeps phase-33 `getSymbolsByName(name, kind?)` untouched as the exact-match primitive used by the existing phase-33 repository tests.
- **D-18: New helper `getDependentsWithImports(targetPath)`** for `get_file_summary`:
  ```ts
  getDependentsWithImports(targetPath: string):
    Array<{ path: string; importedNames: string[]; importLines: number[] }>
  ```
  Implementation: one `SELECT source_path, imported_names, import_line FROM file_dependencies WHERE target_path = ? AND dependency_type = 'local_import'`, then in JS aggregate by `source_path`, parse each row's JSON `imported_names` into a merged deduped set, collect `import_line`s into a sorted-ascending array. Old `getDependents(path): string[]` stays — still used by `getFile()` to populate `FileNode.dependents` at repository.ts:54, and by tests + coordinator (repository.ts:230, coordinator.ts:539). No cascade into nexus/broker typings.
- **D-19: MCP handler bypasses `FileNode.dependents`.** `get_file_summary` already calls `getDependenciesWithEdgeMetadata(normalizedPath)` for the `dependencies` field (mcp-server.ts:305) — it does the same for dependents via the new helper instead of reading `node.dependents` (which stays `string[]` for nexus/UI consumers).

### Tool Description Style

- **D-20: `find_symbol` description is long-form with inline examples.** MCP tool descriptions drive LLM tool selection. Cover in the description:
  1. One-line purpose: "Resolve a symbol name (function/class/interface/type/enum/const) to its defining file + line range in a single call — no need to grep source."
  2. Match semantics: "Exact case-sensitive match; trailing `*` switches to prefix match (e.g. `React*` matches `React`, `ReactDOM`, `Reactive`). Any other `*` is treated as a literal character."
  3. Kind enum listed explicitly: `"function" | "class" | "interface" | "type" | "enum" | "const"`.
  4. Default behavior: "`exportedOnly` defaults to `true` — private helpers only appear when you pass `exportedOnly: false`."
  5. Response shape: `{items: [{path, name, kind, startLine, endLine, isExport}], total, truncated?}`.
  6. When to use vs alternatives: "Use `find_symbol` when you know a symbol name; use `get_file_summary` when you have a path and want its exports + dependents."
  7. Error policy: "Returns `NOT_INITIALIZED` if the server hasn't been set up. All other outcomes (no match, unknown kind, empty prefix) return an empty `items` array — never an error."
- **D-21: `get_file_summary` description updates** — append a sentence about the new `exports[]` field and clarify that `dependents[]` is now objects (`{path, importedNames, importLines}`) not strings, with a one-line "Use importLines to jump directly to the `import` statement in the dependent file" hint.
- **D-22: Keep tool-title changes out of scope.** Titles stay — `"Find Symbol"` added for the new tool; `"Get File Summary"` unchanged.

### Testing Strategy

- **D-23: Unit tests per tool in `tests/unit/find-symbol.test.ts`** (new) — exact match, prefix (`*`-suffix), `exportedOnly` default, `kind` filter, unknown kind → empty, `maxItems` clamp, `truncated` envelope, `NOT_INITIALIZED` propagation, zero-match returns `{items:[], total:0}` not error.
- **D-24: Unit tests for `get_file_summary` enrichment in `tests/unit/file-summary-enrichment.test.ts`** (new) — `exports[]` populated from `symbols` rows, sorted by `startLine`; `dependents[]` aggregated per source path; `importedNames` deduped; non-TS/JS path returns `exports: []` and `dependents[].importedNames: []`; namespace imports (`['*']`) passed through per IMP-02.
- **D-25: Repository-level tests for new helpers** in `src/db/repository.test.ts` (extend) — `findSymbols` cursor-less pagination via `LIMIT` + `total` count; `getDependentsWithImports` aggregation with multi-row same-pair edges; NULL `imported_names` rows coerced to `[]`.
- **D-26: Contract test for MCP tool response shape** in `tests/contract/mcp-tools.test.ts` (extend) — `find_symbol` conforms to `{items, total, truncated?}`; `get_file_summary.exports` is an array even for empty files.

### Claude's Discretion

- Planner picks `GLOB` vs `LIKE … ESCAPE '\\'` (D-03 recommendation is `GLOB` but either satisfies FIND-02).
- Internal helper naming — `findSymbols` vs `queryMatchingSymbols` vs `searchSymbols`. Functional behavior is what matters.
- Test file naming and fixture choice (self-scan fixtures from Phase 33 likely sufficient; no new fixtures required).
- Whether `mcp-server.ts` gets a small local `normalizeFindSymbolArgs()` helper or inlines the prefix-detection/clamp logic.
- Exact wording of the long-form tool descriptions — D-20/D-21 specify the facts that MUST be covered; final prose is planner's call.

### Folded Todos

_None — no pending todos matched phase 34 scope._
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements
- `.planning/ROADMAP.md` — Phase 34 entry: goal, depends-on, requirements list, success criteria (1–6)
- `.planning/REQUIREMENTS.md` §find_symbol Tool (FIND-01..05), §get_file_summary Enrichment (SUM-01..04)
- `.planning/PROJECT.md` — v1.6 milestone "Symbol-Level Intelligence" target features; LLM-first principle

### Phase 33 context (MUST read — this phase is pure surface layer on top)
- `.planning/phases/33-symbol-extraction-foundation/33-CONTEXT.md` — symbol schema decisions (D-02, D-07, D-08, D-10), repository helpers
- `.planning/phases/33-symbol-extraction-foundation/33-05-SUMMARY.md` — bulk-extract + `inspect-symbols` CLI shipped
- `.planning/phases/33-symbol-extraction-foundation/baseline.json` — perf baseline (Phase 35's concern, but relevant for "no new scan-path work" sanity)

### Source files to extend (NOT rewrite)
- `src/mcp-server.ts` §`registerTool("find_important_files"...)` (lines 224–270) — reference pattern for `{items, total, truncated?}` envelope; copy shape for `find_symbol`
- `src/mcp-server.ts` §`registerTool("get_file_summary"...)` (lines 273–319) — add `exports` field + swap `dependents` assembly; keep all existing fields (path, importance, dependencies, summary, staleness, concepts, changeImpact)
- `src/mcp-server.ts` §`mcpSuccess`/`mcpError` helpers (lines 136–150) — all responses flow through these; no new error machinery
- `src/db/repository.ts` §`getSymbolsByName` (lines 902–908) — phase-33 exact-match primitive; DO NOT break signature, add `findSymbols` alongside
- `src/db/repository.ts` §`getSymbolsForFile` (lines 913–919) — used directly for `exports[]`, no change needed
- `src/db/repository.ts` §`getDependents` (lines 230–238) — leave untouched; add `getDependentsWithImports` alongside
- `src/db/repository.ts` §`getDependenciesWithEdgeMetadata` (lines 212–223) — reference pattern for raw SQL + typed row mapping
- `src/db/symbol-types.ts` — `SymbolRow` + `SymbolKind` types already defined by phase 33; import in the new helper + MCP handler

### Schema (read-only reference — no changes this phase)
- `src/db/schema.ts` §`file_dependencies.imported_names`/`import_line` (lines 45–46) — phase-33 additive columns
- `drizzle/0005_add_symbols_and_import_metadata.sql` — phase-33 migration; reference only, no new migration

### Existing codebase conventions
- `.planning/codebase/CONVENTIONS.md` — ES modules, `.js` extensions in relative imports, mcpSuccess/mcpError pattern
- `.planning/codebase/STRUCTURE.md` — where new test files go (`tests/unit/`, `tests/contract/`)
- `.planning/codebase/TESTING.md` — vitest patterns; schema-coercion contract test precedent at `tests/unit/schema-coercion.test.ts`

### Existing tests (reference patterns + extend)
- `src/db/repository.test.ts` — extend with `findSymbols` + `getDependentsWithImports` cases
- `tests/unit/schema-coercion.test.ts` — `z.coerce.boolean()` + `z.coerce.number()` precedent for `find_symbol` input schema
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `mcpSuccess` / `mcpError` helpers (mcp-server.ts:136–150): all tool responses flow through these — new `find_symbol` uses the same path, no new error infrastructure.
- `getSymbolsForFile(path)` (repository.ts:913): directly usable for `exports[]` — just filter `s.isExport`.
- `getSymbolsByName(name, kind?)` (repository.ts:902): phase-33 primitive — stays as the exact-match-only low-level helper; the new `findSymbols` wraps/supersedes it for the MCP path.
- `file_dependencies.imported_names` (JSON text) + `import_line` (int) columns already populated by phase-33 scan path — no parser work in phase 34.
- `z.coerce.boolean()` / `z.coerce.number()` pattern already validated by `tests/unit/schema-coercion.test.ts` — drop straight into `find_symbol` input schema.

### Established Patterns
- `{items, total, truncated?}` envelope — precedent in `list_files` (mcp-server.ts:207–220) and `find_important_files`. Copy exactly; don't invent a second envelope variant.
- One `NOT_INITIALIZED` error guard at handler entry (pattern repeated ~6 times in mcp-server.ts). Same line for `find_symbol`.
- Additive MCP response fields wrapped in `...(condition && { field: value })` (see mcp-server.ts:268, 313–315). Use for optional `truncated` key in `find_symbol`.
- Raw SQL via `getSqlite().prepare(…)` for read-heavy paths (see `getDependenciesWithEdgeMetadata`, `getDependents`, `getSymbolsByName`). Drizzle is used elsewhere but repository.ts mixes both — the pattern for this phase is raw SQL.

### Integration Points
- `src/mcp-server.ts` — single registration site for both new tool (`find_symbol`) and enriched existing tool (`get_file_summary`). No other files need MCP-level changes.
- `src/db/repository.ts` — adds `findSymbols`, adds `getDependentsWithImports`. No schema changes, no migrations, no `src/db/db.ts` touches.
- `src/db/symbol-types.ts` — import `SymbolRow` / `SymbolKind` in mcp-server.ts; potentially add one new return-type interface (`DependentWithImports`) or inline the shape in the new helper's return type.
- Nexus/UI/broker code paths remain on `FileNode.dependents: string[]` via the existing `getDependents()` — **no cascade** into frontend typings from this phase.
</code_context>

<specifics>
## Specific Ideas

- Tool description for `find_symbol` should include a concrete in-context example: `find_symbol("React*")` → list of matches, so LLM readers see the prefix rule applied to a realistic name.
- Error-policy wording should explicitly say "never throws on missing symbol / unknown kind / empty prefix" so agents don't wrap the call in unnecessary try/catch.
- `importedNames` should be sorted alphabetically within each dependent entry for stable diffs — trivial addition, big readability win when comparing summaries across scans.
</specifics>

<deferred>
## Deferred Ideas

- Cross-file reference lookup ("find all call sites of `foo`"): would need a symbol-reference pass distinct from the declaration extraction phase 33 landed. Belongs in a future milestone (v1.7 or later).
- Fuzzy / regex / case-insensitive search modes: deliberately out of scope per FIND-02. Re-evaluate if agent usage telemetry shows exact/prefix is too strict.
- Rename/move tracking for symbols: requires symbol-ID stability across file renames. Deferred indefinitely; not on v1.6 roadmap.
- Python / Go / Ruby symbol emission: deferred to v1.7 per project decision (PROJECT.md Key Decisions).
- Deletion tracking for `dependents[]` (tombstones for removed sources): deferred — v1.6 decision explicitly rejected tombstones.
- `get_symbols_for_file` as its own MCP tool: redundant with enriched `get_file_summary.exports`. Only add if agent usage proves a one-shot "exports only" call is valuable.
</deferred>

---

*Phase: 34-symbol-aware-mcp-surface*
*Context gathered: 2026-04-23*
