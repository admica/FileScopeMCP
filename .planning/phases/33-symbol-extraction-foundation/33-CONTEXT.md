# Phase 33: Symbol Extraction Foundation - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** `--auto` (Claude selected recommended options for every gray area)

<domain>
## Phase Boundary

TS/JS parser pipeline produces **symbols** (top-level declarations: function/class/interface/type/enum/const, with line ranges + export flag) and **imported-name metadata** on dependency edges, emitted in the **same AST walk** as edge extraction — no second `parse()` call per file.

Storage additions:
- New `symbols` SQLite table (path, name, kind, startLine, endLine, isExport) with indexes on (name) and (path)
- Additive columns on `file_dependencies` carrying imported names + import line

Tooling:
- Repository helpers: `upsertSymbols`, `getSymbolsByName`, `getSymbolsForFile`, `deleteSymbolsForFile`
- One-shot bulk extraction at first startup post-upgrade
- `npm run inspect-symbols <path>` CLI for parser debugging
- `npm run bench-scan` baseline capture before any Phase 33 code merges

**Out of scope (Phase 34/35):** `find_symbol` MCP tool, `get_file_summary` enrichment, `list_changed_since` tool, FileWatcher symbol re-extraction. Those depend on the schema + parser output this phase delivers.
</domain>

<decisions>
## Implementation Decisions

### Parser Architecture
- **D-01:** Extend `extractRicherEdges()` in `src/change-detector/ast-parser.ts` to additionally emit `symbols: Symbol[]` and per-import `{ specifier, importedNames: string[], line: number }` metadata in a single tree walk. This satisfies SYM-02 (single-pass) without disturbing `extractSnapshot()` which feeds the separate semantic-diff/change-detector path.
- **D-02:** Introduce a new `Symbol` interface (distinct from `ExportedSymbol`) with kinds `function | class | interface | type | enum | const` plus `startLine`/`endLine`/`isExport`. Keeps the phase-33 symbol row shape decoupled from the historical `ExportedSymbol` used by semantic-diff (which retains its `variable`/`default` kinds and `signature` field).
- **D-03:** Rename the new extractor entry point (e.g., `extractParseResult()` or `extractFileParse()`) if the return shape deviates enough to confuse callers; otherwise keep the `extractRicherEdges` name and widen its return type. Planner decides.
- **D-04:** React/JSX components classified as `function` kind — no heuristic beyond existing function/arrow-function AST node types (SYM-07).
- **D-05:** Re-export statements (`export * from './foo'`, `export { x } from './foo'`) do NOT produce symbol rows for the re-exporting file (SYM-08). Direct declarations and named re-exports-with-local-binding only.
- **D-06:** `export default class Foo {}` / `export default function foo(){}` emit a symbol under the declared name + its kind. Anonymous `export default function(){}` or `export default { ... }` are skipped — no symbol row (no useful name for `find_symbol`).

### Schema
- **D-07:** New `symbols` table via Drizzle schema + migration `0005_add_symbols_and_import_metadata.sql`. Columns: `path TEXT NOT NULL`, `name TEXT NOT NULL`, `kind TEXT NOT NULL`, `start_line INTEGER NOT NULL`, `end_line INTEGER NOT NULL`, `is_export INTEGER NOT NULL DEFAULT 0`. Indexes: `symbols_name_idx (name)`, `symbols_path_idx (path)`. No FK to `files(path)` to avoid coupling migration ordering — purge is explicit via `deleteSymbolsForFile`.
- **D-08:** Imported-name + line metadata is stored on `file_dependencies` as additive columns in the same migration: `imported_names TEXT` (JSON string array — `["useState","useEffect"]` or `["*"]` for namespace imports, `["default"]` for default imports), `import_line INTEGER` (the source line of the `import` statement). Multi-line / multi-statement same-edge cases: if the same `(source, target)` pair is imported twice, produce separate rows so each row's `import_line` stays precise (existing `file_dependencies` already supports this — `id` is autoincrement).
- **D-09:** Namespace imports (`import * as ns from './foo'`) → `imported_names = ["*"]` per IMP-02. No symbol-level splitting.
- **D-10:** Non-TS/JS rows keep `imported_names = NULL` and `import_line = NULL`. Readers (Phase 34 `get_file_summary`) must treat NULL as "no data" and fall back to `[]`.

### Bulk Extraction
- **D-11:** One-shot bulk extraction gate: a row in a new `kv_state` table (or a reserved row in existing `schema_version` — planner picks) named `symbols_bulk_extracted` with an ISO timestamp value. Coordinator checks at startup *after* `migrate()` returns. If absent, iterate `getAllFiles()` filtered to TS/JS extensions, run extraction, bulk-insert, mark flag. Subsequent startups are no-ops.
- **D-12:** Bulk extraction runs synchronously during coordinator startup — blocks MCP readiness. For self-scan (~15K LOC) this is seconds; acceptable one-time cost. Failures on individual files log + continue (don't abort the whole pass).
- **D-13:** No per-query lazy extraction path. If a file is missing symbols, it shows as empty — not a prompt to re-extract.

### Storage Batching
- **D-14:** `upsertSymbols(path, symbols)` writes via a better-sqlite3 transaction: `DELETE FROM symbols WHERE path = ?` then bulk `INSERT`. Same pattern as existing `setDependencies` / `setEdges`.
- **D-15:** At scan time, the coordinator's existing per-file edge-write path calls `upsertSymbols` inside the same transaction as `setEdges` so symbols + edges for one file commit atomically. Parser output carries both in one return object.

### CLI
- **D-16:** `scripts/inspect-symbols.mjs` (ESM, matches `scripts/register-mcp.mjs` pattern). Wired via `"inspect-symbols": "node scripts/inspect-symbols.mjs"` in `package.json` scripts.
- **D-17:** Default output is plain text, one line per symbol: `NAME  KIND  L{start}-L{end}  [export]`. `--json` flag switches to JSONL (one symbol JSON object per line) for tooling. Parses a single path passed as first argument; resolves it via existing path utilities.
- **D-18:** CLI reads the file directly (no DB dependency) — it exercises the parser, not storage. This makes it usable for debugging before a scan runs.

### Performance Baseline (PERF-01)
- **D-19:** New `scripts/bench-scan.mjs` + `"bench-scan": "node scripts/bench-scan.mjs"` script. Measures wall-time of:
  1. FileScopeMCP self-scan (`scanAll` on project root)
  2. A `medium-repo` fixture scan (fixture path + row count to be determined by the planner; reuse existing test fixture if one exists, otherwise create a minimal one)
- **D-20:** Baseline output → `.planning/phases/33-symbol-extraction-foundation/baseline.json` with `{ captured_at, self_scan_ms, medium_repo_scan_ms, file_counts, node_version, commit_sha }`. Committed BEFORE any Phase 33 implementation code lands — the baseline commit must precede the symbol-code commits so Phase 35's PERF-02 regression check has a stable reference.
- **D-21:** `bench-scan` is also usable post-implementation for the Phase 35 regression check; same script, compare outputs.

### Symbol Kind Mapping (tree-sitter → Phase 33 kinds)
- **D-22:** AST node type → kind mapping table (finalized during planning — listing the known cases here):
  - `function_declaration`, `generator_function_declaration` → `function`
  - `class_declaration` → `class`
  - `interface_declaration` → `interface`
  - `type_alias_declaration` → `type`
  - `enum_declaration` → `enum`
  - `lexical_declaration` (top-level `const X = ...`) → `const`
  - `variable_declaration` (top-level `var`/`let`) → skipped for now (not in SYM-01 kind list). Planner confirms.
  - Arrow-function assigned to `const` (`const foo = () => {}`) → `function` kind (symbol name = the `const` binding, NOT `const`) — matches SYM-07 philosophy for JSX.

### Claude's Discretion
- Exact migration filename numbering (0005_...) and Drizzle schema diff output layout
- Whether to introduce a `kv_state` table or reuse `schema_version` row for the bulk-extraction flag
- Exact internal name of the extended parser function (`extractRicherEdges` widened vs. renamed)
- Parser internals for walking `lexical_declaration` nodes to extract multiple `const` bindings per statement (e.g., `export const a = 1, b = 2;`)
- Fixture choice for `medium-repo` benchmark (existing vitest fixture if suitable, else minimal synthetic fixture)
- Transaction granularity inside `upsertSymbols` (single big DELETE+INSERT vs. statement-by-statement)

### Folded Todos
_None — no pending todos matched phase 33 scope._
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements
- `.planning/ROADMAP.md` — Phase 33 entry: goal, depends-on, requirements, success criteria
- `.planning/REQUIREMENTS.md` §Symbol Extraction (SYM-01..08), §Import-Name Extraction (IMP-01..03), §Performance (PERF-01)
- `.planning/PROJECT.md` — v1.6 milestone target features; Key Decisions table

### Source files to extend (NOT rewrite)
- `src/change-detector/ast-parser.ts` §`extractRicherEdges()` (lines 116–260) — the function to widen for symbol + import-name emission
- `src/change-detector/ast-parser.ts` §`extractSnapshot()` (lines 264–400) — DO NOT remove or re-purpose; feeds `exports_snapshot` via semantic-diff
- `src/change-detector/types.ts` §`ExportedSymbol` — keep untouched; new `Symbol` type lives elsewhere (likely `src/db/symbol-types.ts` or extended `src/types.ts`)
- `src/language-config.ts` §`extractTsJsEdges()` (lines 530–562) — wires parser output into the coordinator's edge pipeline; symbol + import-name wiring lands here
- `src/db/schema.ts` — add `symbols` table + additive columns on `file_dependencies`
- `src/db/repository.ts` — add `upsertSymbols`, `getSymbolsByName`, `getSymbolsForFile`, `deleteSymbolsForFile`; extend `setEdges` to carry imported_names + import_line
- `src/db/db.ts` — no changes expected; migrations run automatically via existing `migrate()` call
- `drizzle/` — new migration file `0005_add_symbols_and_import_metadata.sql` produced by `drizzle-kit generate`

### Drizzle + migration pattern (how to add)
- `drizzle.config.ts` — config for `drizzle-kit generate`
- `drizzle/0004_add_edge_metadata.sql` — reference for additive-column + new-table migration pattern
- `src/migrate/json-to-sqlite.ts` — reference for one-shot startup-gated extraction pattern (similar shape to bulk symbol extraction)

### Existing codebase conventions
- `.planning/codebase/CONVENTIONS.md` — naming, ES modules, `.js` extensions in relative imports
- `.planning/codebase/STRUCTURE.md` — where new files go (scripts, src subdirs, drizzle migrations)
- `.planning/codebase/TESTING.md` — vitest patterns for repository + parser tests

### Scripts pattern (for CLI)
- `scripts/register-mcp.mjs` — reference ESM node script structure for `inspect-symbols` + `bench-scan`

### Coordinator scan path (where bulk extraction hooks in)
- `src/coordinator.ts` — startup sequence + `scanAll` path; bulk-extract gate lives near migration/init

### MCP spec for Phase 34 consumer contract (informational only — do not implement here)
- ROADMAP Phase 34 success criteria — shape of `find_symbol` + enriched `get_file_summary` that this phase's schema must support

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`extractRicherEdges()`** in `src/change-detector/ast-parser.ts` — already walks the AST and emits regularImports, reExportSources, inheritsFrom. This is the single-pass extraction point to extend for symbols + import-name metadata.
- **`buildImportNameMap()`** (helper inside ast-parser.ts) — already builds a per-statement map from imported identifier → source specifier. Needs a sibling/extension that also captures the source line (`node.startPosition.row + 1`) and preserves the full names-per-edge list rather than flattening.
- **Drizzle schema + `migrate()` runner** — additive migrations are appended to `drizzle/` and run automatically at `openDatabase()`. No runner changes needed.
- **Transaction pattern in repository.ts** — `setEdges`, `setDependencies`, etc. wrap DELETE-by-path + bulk INSERT in a better-sqlite3 transaction. `upsertSymbols` follows the same shape.
- **`scripts/register-mcp.mjs`** — ESM node script pattern; reused for `inspect-symbols.mjs` and `bench-scan.mjs`.

### Established Patterns
- `*.js` extension on relative imports (ESM rule), `.ts` source
- One tree-sitter parser instance per grammar at module load (`tsParser`, `tsxParser`, `jsParser`) — reuse, don't recreate per file
- JSON-blob columns (e.g., `exports_snapshot`, `concepts`) for nested data on files table — import-names column follows this pattern
- Additive schema migrations only — new columns use `DEFAULT` or allow NULL; new tables don't add FKs that break old rows
- Repository functions receive domain objects (not raw SQL); transactions live inside the repo
- Per-file transactional writes — edges + (now) symbols commit together per file

### Integration Points
- **Parser return shape** flows from `extractRicherEdges` → `extractTsJsEdges` in `language-config.ts` → coordinator's `scanAll` / file-change handler → `setEdges` + `upsertSymbols` in repository
- **Schema changes** picked up automatically by `openDatabase()` via drizzle `migrate()` — no init code change
- **Bulk extraction** runs from `coordinator.ts` startup after migration completes, gated by flag; touches repository only
- **CLI (`inspect-symbols`, `bench-scan`)** runs standalone via package.json scripts; does not import coordinator or db runtime
</code_context>

<specifics>
## Specific Ideas

- Keep `extractSnapshot()` and the `exports_snapshot` column untouched — those feed semantic-diff, not `find_symbol`. Phase 33 adds a parallel, denormalized symbol representation in its own table.
- `imported_names` JSON array encoding is a deliberate mirror of `exports_snapshot` — consistent "JSON-blob column for small arrays" pattern the codebase already uses.
- Anonymous default exports return zero value to `find_symbol` (the caller can't search for them by name); skipping them is a principled simplification, not an oversight.
- Baseline capture must land in a **separate commit before any Phase 33 code** — this is the only way Phase 35's PERF-02 regression check has a meaningful reference. The planner should put baseline capture as Plan 33-01.
</specifics>

<deferred>
## Deferred Ideas

- **Python/Go/Ruby symbol extraction** — deferred to v1.7 per PROJECT.md v1.6 scope audit. Namespace import `*` placeholder leaves symbol-level splitting open for future phases without schema change.
- **Deletion tombstones for `list_changed_since`** — explicitly deferred per PROJECT.md v1.6 decisions. Only files currently in DB appear in tool responses.
- **Per-query lazy symbol extraction** — rejected for v1.6 (SYM-05 requires one-shot bulk). Can revisit in v1.7+ if bulk pass proves expensive at scale.
- **React component kind** — rejected (SYM-07). JSX components stay as `function`. No separate `component` kind.
- **FileWatcher integration (re-extract on change)** — Phase 35 (WTC-01..03). Phase 33's parser output must be callable from the watcher path, but wiring is Phase 35's job.
- **`find_symbol` MCP tool** — Phase 34. Phase 33 sets up the schema + rows; Phase 34 exposes the query surface.
</deferred>

---

*Phase: 33-symbol-extraction-foundation*
*Context gathered: 2026-04-23*
