# Requirements: Milestone v1.6 Symbol-Level Intelligence

**Milestone goal:** Elevate FileScopeMCP from file-granular to symbol-granular for three daily-use LLM queries — kill grep for symbol navigation, expose import-names on dependent edges, add "changed since" re-orientation.

**Scope audit date:** 2026-04-23 (ruthlessly trimmed from 8 candidate features to 3 high-value tools)

---

## v1.6 Requirements

### Symbol Extraction (parser + schema)

- [x] **SYM-01**: Parser extracts top-level symbols from TS/JS files during scan, emitting name, kind (`function` / `class` / `interface` / `type` / `enum` / `const`), `startLine`, `endLine`, and `isExport` flag
- [x] **SYM-02**: Symbol extraction MUST share the existing AST walk with edge extraction — no second parser pass per file
- [x] **SYM-03**: New `symbols` SQLite table with columns (path, name, kind, startLine, endLine, isExport) and indexes on `(name)` and `(path)`; schema migration is additive and safe for existing DBs
- [x] **SYM-04**: Repository functions `upsertSymbols(path, Symbol[])`, `getSymbolsByName(name, kind?)`, `getSymbolsForFile(path)`, `deleteSymbolsForFile(path)` with transactional writes
- [x] **SYM-05**: Migration-time bulk extraction — on first startup after v1.6 upgrade, iterate all tracked files and populate `symbols` (one-shot; no per-query lazy extraction)
- [x] **SYM-06**: `npm run inspect-symbols <path>` CLI emits the extracted symbol set for a single file — parser debugging tool, exposed via package.json scripts
- [x] **SYM-07**: React JSX components are classified as `function` kind (no separate `component` kind); no heuristic needed beyond existing function/arrow-function AST nodes
- [x] **SYM-08**: Re-exports (`export * from './foo'`) are NOT populated as symbols on the re-exporting file — direct exports only

### Import-Name Extraction (enriches edges)

- [x] **IMP-01**: TS/JS dep parser, at the same AST pass, records the imported names (named imports + default import) and the source line number for each dependency edge
- [x] **IMP-02**: Namespace imports (`import * as ns from './foo'`) record target as `*` placeholder; no symbol-level splitting
- [x] **IMP-03**: Schema carries imported names and line via a join table or columns on `file_dependencies` — additive, no breaking changes to existing `file_dependencies` rows

### find_symbol Tool

- [x] **FIND-01**: New MCP tool `find_symbol(name, kind?, exportedOnly=true, maxItems?)` returns matching symbols with `{path, name, kind, startLine, endLine, isExport}[]`
- [x] **FIND-02**: Case-sensitive match with exact and prefix modes (exact by default; prefix via trailing `*`)
- [x] **FIND-03**: `exportedOnly` defaults to `true` — private helpers excluded unless explicitly requested
- [x] **FIND-04**: Returns standardized envelope `{items, total, truncated?: true}`; no-match returns `{items: [], total: 0}` (not an error)
- [x] **FIND-05**: Error codes: `NOT_INITIALIZED` only; all other outcomes are valid empty results

### get_file_summary Enrichment

- [x] **SUM-01**: `get_file_summary` response gains `exports: [{name, kind, startLine, endLine}]` field listing only exported symbols from the file
- [x] **SUM-02**: `dependents[]` entries upgrade from `string[]` to `[{path, importedNames: string[], importLines: number[]}]`
- [x] **SUM-03**: Changes are additive — no existing fields removed or renamed; existing MCP clients see `dependents` coerced to the richer shape
- [x] **SUM-04**: When a file has no extracted symbols (e.g., non-TS/JS or unparsed), `exports` is `[]` and `dependents[].importedNames` is `[]`

### list_changed_since Tool

- [ ] **CHG-01**: New MCP tool `list_changed_since(since, maxItems?)` accepting ISO-8601 timestamp or 7+ char git commit SHA
- [ ] **CHG-02**: Returns `[{path, mtime}]` — paths whose DB `mtime` is greater than the resolved `since` value
- [ ] **CHG-03**: Git-SHA mode resolves via `git diff --name-only <sha> HEAD`, filtered to paths present in the DB
- [ ] **CHG-04**: Error codes: `NOT_INITIALIZED`, `INVALID_SINCE` (unparseable timestamp/SHA), `NOT_GIT_REPO` (SHA mode without `.git`)
- [ ] **CHG-05**: No deletion tracking — only returns files that currently exist in DB; deletion tombstones deferred to future milestone

### Watcher Integration

- [ ] **WTC-01**: FileWatcher re-extracts symbols on file change using the same throttled single-pass AST walk as edges — no separate symbol watcher
- [ ] **WTC-02**: FileWatcher on unlink invokes `deleteSymbolsForFile(path)` alongside existing edge cleanup
- [ ] **WTC-03**: Symbols treated as stale under the same `mtime`-based staleness model as edges — no separate per-symbol freshness column

### Performance Budget

- [x] **PERF-01**: Baseline captured before Phase 33: FileScopeMCP self-scan wall time and `medium-repo` fixture scan wall time
- [ ] **PERF-02**: Scan wall time MUST NOT regress more than 15% from baseline at end of milestone; hard fail at 25% regression — phases revisited before merge

---

## Future Requirements

<!-- Deferred — may surface in a later milestone -->

- Python / Go / Ruby symbol extraction (wait for v1.6 adoption signal)
- Method-level symbols on classes (revisit if demand surfaces)
- Call-site resolution (`who calls foo` across files) — needs type registry
- Fuzzy symbol search — exact + prefix deemed sufficient
- Symbol importance scoring / "top N most-imported symbols"
- Deletion-tracking on `list_changed_since` via `deleted_files` tombstone table
- Nexus UI rendering of symbols (v1.6 is MCP-surface only)
- Re-export transitive symbol population

---

## Out of Scope

<!-- Explicit exclusions with reasoning -->

- **Renaming refactors** — this is a read/analysis tool; never mutates source
- **Method-level symbols** — reachable via class start/end line range; adds parser surface without proportional query value
- **`get_neighborhood(hops=2)` tool** — with symbol+line data, one-hop suffices; tree demos bloat context at edit time
- **`find_risky_files`** — LLM-generated `changeImpact.risk` scores unreliable; agents verify via tests instead
- **`summarize_paths` immediate-queue tool** — agents prefer raw file read over paragraph-about-file when editing
- **Pagination expansion on `search`** — with `find_symbol`, keyword search becomes secondary; top-10 suffices
- **Fuzzy matching on `find_symbol`** — JS casing conventions and exact/prefix suffice; no ranking heuristic needed
- **Symbol-level edges in `file_dependencies`** — kept file-level; symbol info attached via new join table on reads only
- **Parser emits a second AST walk** — performance-critical mandate, not a cosmetic preference

---

## Traceability

<!-- Filled in by roadmap — REQ-ID → Phase -->

| REQ-ID | Description | Phase | Status |
|--------|-------------|-------|--------|
| SYM-01 | Top-level symbol extraction (TS/JS) | 33 | Pending |
| SYM-02 | Single-pass AST walk | 33 | Pending |
| SYM-03 | `symbols` table + migration | 33 | Pending |
| SYM-04 | Repository functions | 33 | Pending |
| SYM-05 | Migration-time bulk extraction | 33 | Pending |
| SYM-06 | `npm run inspect-symbols` CLI | 33 | Pending |
| SYM-07 | JSX components as function kind | 33 | Pending |
| SYM-08 | Re-exports not populated | 33 | Pending |
| IMP-01 | Imported-name + import-line extraction | 33 | Pending |
| IMP-02 | Namespace import as `*` placeholder | 33 | Pending |
| IMP-03 | Additive schema for imports | 33 | Pending |
| FIND-01 | `find_symbol` MCP tool | 34 | Pending |
| FIND-02 | Exact + prefix, case-sensitive | 34 | Pending |
| FIND-03 | `exportedOnly` default true | 34 | Pending |
| FIND-04 | Standardized `{items, total}` envelope | 34 | Pending |
| FIND-05 | Error codes | 34 | Pending |
| SUM-01 | `exports[]` on `get_file_summary` | 34 | Pending |
| SUM-02 | Rich `dependents[]` with importedNames | 34 | Pending |
| SUM-03 | Additive response schema | 34 | Pending |
| SUM-04 | Empty arrays when no symbols | 34 | Pending |
| CHG-01 | `list_changed_since` MCP tool | 35 | Pending |
| CHG-02 | `{path, mtime}` response | 35 | Pending |
| CHG-03 | Git-SHA mode | 35 | Pending |
| CHG-04 | Error codes | 35 | Pending |
| CHG-05 | No deletion tracking | 35 | Pending |
| WTC-01 | Watcher single-pass symbol re-extract | 35 | Pending |
| WTC-02 | Watcher unlink cleanup | 35 | Pending |
| WTC-03 | Reuse mtime staleness model | 35 | Pending |
| PERF-01 | Baseline capture | 33 | Pending |
| PERF-02 | Wall-time regression budget | 35 | Pending |
