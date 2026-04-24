# Phase 34: Symbol-Aware MCP Surface - Research

**Researched:** 2026-04-23
**Domain:** MCP tool surface over phase-33 `symbols` table + `file_dependencies.imported_names`/`import_line` columns
**Confidence:** HIGH (phase is a thin read-only wiring layer over schema that already exists and is already populated; every core decision locked by CONTEXT.md D-01..D-26; remaining technical questions verified against `better-sqlite3` in an ephemeral DB probe)

## Summary

Phase 34 wires the phase-33 symbol store into two MCP touchpoints: one new tool (`find_symbol`) and one enriched tool (`get_file_summary`). There is no parser work, no schema change, no migration, no watcher change, and no coordinator change. The phase touches exactly three files of production code (`src/mcp-server.ts`, `src/db/repository.ts`, optionally `src/db/symbol-types.ts`) plus three test files.

The design is near-fully specified by CONTEXT.md's 26 decisions. The only open technical questions were: (1) `GLOB` vs `LIKE ... ESCAPE '\\'` for case-sensitive prefix match, (2) whether `z.coerce.boolean()` wires cleanly through the existing MCP SDK registration path, (3) how to parse the JSON `imported_names` column null-safely, and (4) whether a `tests/contract/` directory exists. All four are resolved below via tool probes against the current codebase and a live `better-sqlite3` experiment.

**Primary recommendation:** Use `GLOB` with a bracket-escape helper over `LIKE ... ESCAPE`. Rationale: cleaner code (two-branch switch on `=` vs `GLOB`, no stacked metachar escape for `%`/`_`/`\\`), native case-sensitivity with no PRAGMA session toggle required, and symbol names in the DB are always valid JS identifiers (can never contain `*`, `?`, `[`, or `]`) so GLOB false-positives on stored data are impossible. The only escape obligation is on the user-supplied search term, and GLOB's bracket form (`foo*bar*` → `foo[*]bar*`) is a one-line `.replace()` call.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**find_symbol matching semantics:**
- **D-01:** Prefix syntax — trailing `*` ONLY. Any other `*` position is a literal character, no wildcard, no error.
- **D-02:** Prefix translates to a SQL pattern with escaped user-supplied metacharacters. Exact match uses `=`.
- **D-03:** Case-sensitive (per FIND-02). Recommend `GLOB`; planner may choose `LIKE ... ESCAPE` instead.
- **D-04:** `maxItems` default 50, hard upper clamp 500, lower clamp 1 (silent — never error).
- **D-05:** Ordering `isExport DESC, path ASC, startLine ASC`.
- **D-06:** `kind` filter accepts phase-33 enum values (`function | class | interface | type | enum | const`). Unknown kind returns empty items, never errors.
- **D-07:** `total` is pre-truncation count. `truncated: true` set only when `items.length < total`. Omit the field entirely otherwise.

**find_symbol input schema:**
- **D-08:** Zod shape: `{name: z.string().min(1), kind?: z.string(), exportedOnly: z.coerce.boolean().default(true), maxItems?: z.coerce.number().int()}`.

**get_file_summary enrichment:**
- **D-09:** `exports[]` derived from `getSymbolsForFile(normalizedPath)` filtered to `isExport === true`.
- **D-10:** `exports[]` sorted by `startLine ASC`.
- **D-11:** Non-TS/JS → `exports: []` (determined by "no rows in symbols for this path", NOT by extension).
- **D-12:** `dependents[]` one entry per source path, aggregated by `source_path`.
- **D-13:** `importedNames` set-style (deduped); `importLines` keeps every occurrence, sorted ascending.
- **D-14:** NULL `imported_names` coerced to `[]`; never surface `null` in the wire response.
- **D-15:** `dependents[]` sorted by `path ASC`.
- **D-16:** `dependents[]` shape change is BREAKING at the wire level — explicitly sanctioned by SUM-03. No dual-mode, no legacy `string[]` fallback, no config flag.

**Repository helpers:**
- **D-17:** New helper `findSymbols(opts: {name, kind?, exportedOnly, limit}) → {items, total}`. Single `SELECT COUNT(*)` + single `SELECT ... LIMIT ?`. Existing `getSymbolsByName` left untouched.
- **D-18:** New helper `getDependentsWithImports(targetPath) → Array<{path, importedNames, importLines}>`. Single SQL + JS-level aggregation. Existing `getDependents` left untouched.
- **D-19:** MCP handler bypasses `FileNode.dependents`; calls `getDependentsWithImports(normalizedPath)` directly (parallel to existing `getDependenciesWithEdgeMetadata` pattern at mcp-server.ts:305).

**Tool descriptions:**
- **D-20:** `find_symbol` description is long-form with 7 required elements (purpose, match semantics, kind enum, defaults, response shape, when-to-use, error policy).
- **D-21:** `get_file_summary` description updates — append a sentence about the new `exports[]` field; clarify `dependents[]` is now objects not strings; one-line hint on `importLines`.
- **D-22:** Tool titles unchanged. Add `"Find Symbol"` for the new tool.

**Testing strategy:**
- **D-23:** New `tests/unit/find-symbol.test.ts`.
- **D-24:** New `tests/unit/file-summary-enrichment.test.ts`.
- **D-25:** Extend `src/db/repository.test.ts` (or more naturally `src/db/repository.symbols.test.ts`) with helper-level tests.
- **D-26:** Extend `tests/contract/mcp-tools.test.ts` — but that path does NOT exist today (see Risk Register R-3). The closest-matching existing file is `tests/unit/tool-outputs.test.ts`.

### Claude's Discretion

- `GLOB` vs `LIKE ... ESCAPE '\\'` — D-03 recommends `GLOB`; planner chooses. **Research recommendation: `GLOB`** (see §GLOB vs LIKE decision below).
- Internal helper naming (`findSymbols` vs `queryMatchingSymbols` vs `searchSymbols`).
- Whether `mcp-server.ts` gets a small `normalizeFindSymbolArgs()` helper.
- Exact wording of long-form tool descriptions — D-20/D-21 specify facts that MUST be covered.
- Test file naming / fixture choice.

### Deferred Ideas (OUT OF SCOPE)

- Cross-file reference lookup ("find all call sites of `foo`"). Requires a symbol-reference pass distinct from declaration extraction. Future milestone (v1.7+).
- Fuzzy / regex / case-insensitive search modes. Deliberately out of scope per FIND-02.
- Rename/move tracking for symbols.
- Python / Go / Ruby symbol emission. Deferred to v1.7 per PROJECT.md.
- Deletion tracking for `dependents[]`.
- `get_symbols_for_file` as its own MCP tool — redundant with enriched `get_file_summary.exports`.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIND-01 | New MCP tool `find_symbol(name, kind?, exportedOnly=true, maxItems?)` returns matching symbols with `{path, name, kind, startLine, endLine, isExport}[]` | § `find_symbol` Implementation Map below; handler uses new `findSymbols()` helper (D-17) wrapping `symbols` table reads |
| FIND-02 | Case-sensitive match with exact and prefix modes | §GLOB vs LIKE decision — `GLOB` gives native case-sensitivity with no session pragma |
| FIND-03 | `exportedOnly` defaults to `true` | Zod schema D-08 uses `.default(true)`; verified `z.coerce.boolean().default(true)` parses cleanly via existing `schema-coercion.test.ts` precedent |
| FIND-04 | Standardized envelope `{items, total, truncated?: true}` | §Envelope naming — flagged: this introduces a NEW envelope shape distinct from `list_files` (`{files, totalCount, truncated}`); CONTEXT locks the new names |
| FIND-05 | Error codes: `NOT_INITIALIZED` only | Reuse single-line guard at handler entry (pattern repeated ~6x in mcp-server.ts); no new error code added to `ErrorCode` union at mcp-server.ts:134 |
| SUM-01 | `get_file_summary` response gains `exports: [{name, kind, startLine, endLine}]` | `getSymbolsForFile` (repository.ts:913) already returns the exact shape; filter to `isExport === true` and project out `path` + `isExport` (D-09) |
| SUM-02 | `dependents[]` upgrades from `string[]` to `[{path, importedNames, importLines}]` | New helper `getDependentsWithImports()` (D-18) aggregates existing `file_dependencies` rows; JSON-column parse pattern confirmed via precedent at repository.ts:487 |
| SUM-03 | Additive; existing consumers see `dependents` coerced to richer shape | Breaking at wire level per D-16; verified that `FileNode.dependents: string[]` in memory is consumed ONLY by nexus/UI via a different API path (`nexus/repo-store.ts:315`), NOT by `get_file_summary` — see Risk Register R-1 |
| SUM-04 | Non-TS/JS files → `exports: []` and `dependents[].importedNames: []` | D-11 determines by "no symbol rows", not extension; D-14 coerces NULL `imported_names` to `[]` inside the new helper |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCP tool registration + Zod input schema | MCP Server (`src/mcp-server.ts`) | — | The ONLY registration site; `registerTools()` receives `server` + `coordinator` and wires every tool |
| SQL against `symbols` table / `file_dependencies` | Repository (`src/db/repository.ts`) | — | Raw `better-sqlite3.prepare().all()` via `getSqlite()` per existing pattern (`getDependenciesWithEdgeMetadata`, `getDependents`, `getSymbolsByName`); no Drizzle for this phase because the queries involve `GLOB` / aggregation that raw SQL expresses more cleanly |
| Symbol row → response DTO projection | MCP Server handler | Repository | Repository returns `SymbolRow & {path}`; MCP handler projects to the wire shape (strips unused fields, orders by D-05 keys). Projection done at the handler so the repository can stay schema-shaped |
| Result ordering (D-05, D-10, D-15) | Repository (SQL `ORDER BY`) | — | Deterministic ordering is a contract guarantee; SQL-level ordering is faster and atomic with the paginated slice |
| `truncated` flag assembly | MCP Server handler | — | Derivation requires knowing both `total` (repository) and slice length (post-helper); the conditional field spread `...(isTruncated && {truncated: true})` happens at the handler per existing precedent at mcp-server.ts:219–220 |
| JSON column parse (`imported_names`) | Repository helper (`getDependentsWithImports`) | — | Parse at read so callers always see typed arrays, never raw JSON strings. Null-safe: `imported_names === null ? [] : JSON.parse(...)` — see §JSON column parsing below |

## Standard Stack

### Core (already present — no new installs)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | pinned in `package.json` | MCP server + `registerTool` API | Already used for all 13 existing tools [VERIFIED: src/mcp-server.ts:1] |
| `zod` | pinned in `package.json` | Input schema validation + `z.coerce.*` | Already used for 13 tool schemas; `z.coerce.number()` validated by 5-test suite in `tests/unit/schema-coercion.test.ts` [VERIFIED: tests/unit/schema-coercion.test.ts] |
| `better-sqlite3` | pinned in `package.json` | Raw SQL via `getSqlite().prepare()` | Established read-heavy pattern (`getDependenciesWithEdgeMetadata`, `getDependents`, `getSymbolsByName`, all of `searchFiles`) [VERIFIED: src/db/repository.ts:218] |
| `drizzle-orm` | pinned in `package.json` | ORM layer for writes + simple reads | Used by `getDependents` (repository.ts:230); not used in Phase 34 because GLOB/aggregation is cleaner as raw SQL |

### Supporting (no new installs)

None. Phase 34 uses only what Phase 33 + earlier phases already pulled in.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `GLOB ? || '*'` (case-sensitive native) | `LIKE ? ESCAPE '\\'` with `PRAGMA case_sensitive_like = ON` | PRAGMA is connection-scoped; setting it per-query is safe but adds a second SQL statement. LIKE needs escaping of `%`, `_`, `\\` in user input. GLOB needs escaping of `*`, `?`, `[` in user input. Both work; GLOB is one fewer statement + no PRAGMA state + no worry about `%`/`_` in symbol names. **Chosen: `GLOB`.** |
| Inline handler logic for prefix detection + clamp | Extract `normalizeFindSymbolArgs({name, maxItems})` helper | Inline is fine at the ~10-line scale CONTEXT expects. A helper is cleaner if the prefix/clamp/kind-coerce logic crosses 15 lines or is re-used by a contract test. **Planner's call.** Research recommendation: inline — the logic is 5 lines. |
| New `tests/contract/mcp-tools.test.ts` (D-26) | Extend existing `tests/unit/tool-outputs.test.ts` | `tests/contract/` directory does NOT currently exist (verified via `ls`). `tool-outputs.test.ts` is the **de facto** contract test file — its top comment says so: `// Contract tests for MCP tool response shapes.` Creating a new directory for one file adds structure for structure's sake. **Planner's call.** Research recommendation: extend `tool-outputs.test.ts`; treat D-26 as a suggestion that was drafted before confirming the existing location. |

**Installation:** N/A — no new packages.

**Version verification:** No new packages, so no `npm view` needed. Existing versions in `package.json` are the versions the phase uses.

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ LLM Agent (Claude Code)                                          │
└───────────────────┬──────────────────────────────────────────────┘
                    │ MCP stdio JSON-RPC
                    │   tool: find_symbol(name="React*", kind?, ...)
                    │   tool: get_file_summary(filepath=".../foo.ts")
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ StdioTransport (mcp-server.ts)                                   │
│   mcpSuccess() / mcpError() envelope helpers (lines 136–150)     │
└───────────────────┬──────────────────────────────────────────────┘
                    │
                    │ server.registerTool(name, {inputSchema, handler})
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ Tool handler (mcp-server.ts registerTools)                       │
│   1. Guard: coordinator.isInitialized() else NOT_INITIALIZED     │
│   2. Zod-parse args (SDK does this before handler fires)         │
│   3. Normalize: trailing-*? prefix/exact; clamp maxItems [1,500] │
│   4. Project response to wire shape                              │
└─────┬──────────────────────────────────────────┬─────────────────┘
      │                                          │
      │ findSymbols(opts) [D-17, new]            │ getSymbolsForFile(path) [phase-33]
      │ getDependentsWithImports(path) [D-18,new]│ getDependenciesWithEdgeMetadata(path)
      ▼                                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ Repository (src/db/repository.ts)                                │
│   raw SQL via getSqlite().prepare(...).all(...)                  │
│   - findSymbols: 1x SELECT COUNT + 1x SELECT ... LIMIT ?         │
│   - getDependentsWithImports: 1x SELECT + JS-level aggregation   │
└───────────────────┬──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────────────────────────┐
│ SQLite (.filescope/data.db) — read-only in Phase 34              │
│   symbols table        (phase 33 — populated by bulk-extract +   │
│                         per-file scan write via setEdgesAndSymbols)│
│   file_dependencies    (imported_names, import_line — phase 33)  │
└──────────────────────────────────────────────────────────────────┘
```

Data flow invariant for Phase 34: **every read is non-blocking and the DB state is set by Phase 33**. No new writes, no new gates, no new watcher logic.

### Recommended Project Structure

```
src/
├── mcp-server.ts         # + registerTool("find_symbol"); modify "get_file_summary" handler (adds 2 new fields)
├── db/
│   ├── repository.ts     # + findSymbols(); + getDependentsWithImports()
│   ├── symbol-types.ts   # + DependentWithImports interface (optional; or inline in helper's return type)
│   ├── schema.ts         # untouched (read-only ref)
│   └── repository.symbols.test.ts  # extend with findSymbols + getDependentsWithImports cases
tests/
└── unit/
    ├── find-symbol.test.ts             # new (D-23)
    ├── file-summary-enrichment.test.ts # new (D-24)
    └── tool-outputs.test.ts            # extend with find_symbol envelope + get_file_summary shape (D-26 — see alternatives)
```

### Pattern 1: Raw SQL Read Helper with Typed Row

```typescript
// Source: src/db/repository.ts:212 (getDependenciesWithEdgeMetadata — exemplar)
export function getDependenciesWithEdgeMetadata(filePath: string): Array<{
  target_path: string;
  edge_type: string;
  confidence: number;
}> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT target_path, edge_type, confidence FROM file_dependencies WHERE source_path = ? AND dependency_type = 'local_import'"
    )
    .all(filePath) as Array<{ target_path: string; edge_type: string; confidence: number }>;
}
```

**When to use:** Every new Phase 34 repository helper.
**Why this pattern:** Clear SQL in-place, typed row cast at the boundary, no Drizzle ceremony. Matches every other read-path helper.

### Pattern 2: Count + Slice Pagination (new shape for Phase 34 — no direct precedent)

The closest analog is `list_files` / `find_important_files`, which both do it in-memory after `getAllFiles()`. `findSymbols` must do it in SQL because we can't load 10K symbol rows to count them:

```typescript
// Proposed shape for findSymbols — no direct precedent, synthesized from
// existing raw-SQL read pattern (Pattern 1) + CONTEXT D-17.
export function findSymbols(opts: {
  name: string;
  kind?: SymbolKind;
  exportedOnly: boolean;
  limit: number;
}): { items: Array<SymbolRow & { path: string }>; total: number } {
  const sqlite = getSqlite();
  // Build WHERE clause — see §GLOB vs LIKE decision for the name-predicate builder
  const { namePredicate, nameParam } = buildNamePredicate(opts.name);
  const whereParts = [namePredicate];
  const params: unknown[] = [nameParam];
  if (opts.kind) { whereParts.push('kind = ?'); params.push(opts.kind); }
  if (opts.exportedOnly) { whereParts.push('is_export = 1'); }
  const whereSQL = whereParts.join(' AND ');

  const total = (sqlite
    .prepare(`SELECT COUNT(*) AS n FROM symbols WHERE ${whereSQL}`)
    .get(...params) as { n: number }).n;

  const rows = sqlite
    .prepare(
      `SELECT path, name, kind, start_line, end_line, is_export
       FROM symbols
       WHERE ${whereSQL}
       ORDER BY is_export DESC, path ASC, start_line ASC
       LIMIT ?`
    )
    .all(...params, opts.limit) as Array<{
      path: string; name: string; kind: string;
      start_line: number; end_line: number; is_export: number;
    }>;

  return {
    items: rows.map(r => ({
      path: r.path,
      name: r.name,
      kind: r.kind as SymbolKind,
      startLine: r.start_line,
      endLine: r.end_line,
      isExport: r.is_export === 1,
    })),
    total,
  };
}
```

### Pattern 3: JS-Level Aggregation After Single SQL (for `getDependentsWithImports`)

```typescript
// Proposed shape — single SELECT, JS-level reduce for (source_path) aggregation.
// Precedent: getCommunities() at repository.ts:792 (groups rows into a Map by community_id).
export function getDependentsWithImports(targetPath: string):
  Array<{ path: string; importedNames: string[]; importLines: number[] }>
{
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(
      `SELECT source_path, imported_names, import_line
       FROM file_dependencies
       WHERE target_path = ? AND dependency_type = 'local_import'`
    )
    .all(targetPath) as Array<{
      source_path: string;
      imported_names: string | null;
      import_line: number | null;
    }>;

  const bySource = new Map<string, { names: Set<string>; lines: number[] }>();
  for (const r of rows) {
    let bucket = bySource.get(r.source_path);
    if (!bucket) {
      bucket = { names: new Set(), lines: [] };
      bySource.set(r.source_path, bucket);
    }
    // D-14: NULL → []
    if (r.imported_names !== null) {
      try {
        const arr = JSON.parse(r.imported_names) as unknown;
        if (Array.isArray(arr)) {
          for (const n of arr) if (typeof n === 'string') bucket.names.add(n);
        }
      } catch { /* corrupt JSON — treat as empty, matches getExportsSnapshot pattern at :488 */ }
    }
    if (r.import_line !== null) bucket.lines.push(r.import_line);
  }

  return Array.from(bySource.entries())
    .map(([path, { names, lines }]) => ({
      path,
      importedNames: Array.from(names).sort(),  // Specifics §: sort alphabetically for stable diffs
      importLines: lines.sort((a, b) => a - b),  // D-13: ascending
    }))
    .sort((a, b) => a.path.localeCompare(b.path));  // D-15
}
```

### Anti-Patterns to Avoid

- **Don't** use Drizzle for the new helpers — the raw-SQL pattern is already dominant for reads (9+ call sites in repository.ts use `getSqlite().prepare`). Introducing Drizzle-style querybuilder calls for GLOB/aggregation is cosmetic inconsistency.
- **Don't** add a new error code to `ErrorCode` at mcp-server.ts:134. FIND-05 + D-06 require that every non-init-failure returns an empty result — the existing `ErrorCode` union stays.
- **Don't** rename `getSymbolsByName` to reflect the new capability (D-17 explicitly says leave it untouched — it's the exact-match primitive consumed by `src/db/repository.symbols.test.ts`).
- **Don't** overload `get_file_summary` with dual-shape `dependents` handling. D-16 says one code path. Replace the assignment at mcp-server.ts:310 (`dependents: node.dependents || []`) with `dependents: getDependentsWithImports(normalizedPath)`.
- **Don't** parse `imported_names` at write time into an in-memory cache. The read path runs per MCP call; parsing 10K rows eagerly at boot is premature optimization.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Case-sensitive prefix matching in SQLite | A custom LIKE-pattern builder with ESCAPE | SQLite `GLOB` with a 1-line bracket-escape helper | GLOB is native-case-sensitive, no PRAGMA toggle, cleaner than `LIKE ... ESCAPE` for this shape |
| String → boolean coercion in MCP tool args | Manual `val === 'true' \|\| val === true` normalization | `z.coerce.boolean()` | Already validated in schema-coercion.test.ts for number coercion; boolean coercion is the same SDK path |
| JSON-column null safety | Custom `safeJsonParse()` wrapper | Try/catch around `JSON.parse` with `return []` fallback — matches precedent at repository.ts:488 (`getExportsSnapshot`) | Codebase already has this pattern; a new helper duplicates semantics for one call site |
| MCP response envelope | A new builder abstraction | `mcpSuccess({...})` at mcp-server.ts:143 + conditional field spread `...(cond && { field: val })` | Every existing tool uses this — introducing a builder for one shape is overkill |
| Symbol name enum validation | Zod `z.enum([...])` for `kind` | `z.string().optional()` per D-06 | D-06 explicitly states unknown kind returns empty, not a validation error. Zod `z.enum` would throw at parse time |

**Key insight:** Every subproblem in this phase has a direct precedent within ~100 lines of repository.ts or mcp-server.ts. The phase is pure composition of existing patterns over the phase-33 schema.

## GLOB vs LIKE Decision (Claude's Discretion D-03)

**Decision: `GLOB`.**

### Live probe against `better-sqlite3` (run 2026-04-23, symbol name table with `React`/`react`/`ReactDOM`/`Reactive`/`foo%bar`/`foo_bar`/`foo*bar`)

| Query | Result | Note |
|-------|--------|------|
| `WHERE name GLOB 'React*'` | `React`, `ReactDOM`, `Reactive` | Native case-sensitive, native prefix wildcard |
| `WHERE name GLOB 'react*'` | `react` only | Confirms case-sensitivity without PRAGMA |
| `WHERE name = 'React'` | `React` only | Exact-match path — trivial |
| `WHERE name GLOB 'foo*bar'` | `foo%bar`, `foo_bar`, `foo*bar` | **Gotcha** — middle `*` in search pattern is a wildcard. Must escape |
| `WHERE name GLOB 'foo[*]bar'` | `foo*bar` only | Bracket-escape works — `[*]` matches literal `*` |
| `WHERE name LIKE 'React%'` (default) | `React`, `react`, `ReactDOM`, `Reactive` | **Case-insensitive by default** — violates FIND-02 |
| `WHERE name LIKE 'React%'` after `PRAGMA case_sensitive_like = ON` | `React`, `ReactDOM`, `Reactive` | Works, but PRAGMA is connection-scoped and adds a second SQL statement per-query-or-init |

### Why GLOB wins for this phase

1. **Case-sensitivity is FREE with GLOB.** FIND-02 mandates case-sensitive matching. GLOB is always case-sensitive (SQLite docs, [CITED: https://www.sqlite.org/lang_expr.html#glob]). LIKE is case-insensitive for ASCII by default and requires `PRAGMA case_sensitive_like = ON` to flip. Setting a PRAGMA once at DB open is fine but adds a surface for "I forgot to open a fresh connection and the pragma was lost"; per-query PRAGMA adds a second statement.
2. **Symbol names in the DB are valid JS identifiers** `[A-Za-z0-9_$]`. They can NEVER contain `*`, `?`, `[`, `]`, `%`, `_` (outside underscore, which is a valid identifier char and NOT a GLOB metacharacter). So GLOB cannot false-positive on stored data. LIKE's `_` metacharacter, by contrast, DOES collide with valid identifier chars — `foo_bar` in storage would match LIKE pattern `foo?bar` in unexpected ways if we ever wanted single-char match. (We don't, per D-01, but the ambient risk is real.) [VERIFIED: ECMAScript spec §11.6.1.1 IdentifierName]
3. **Escape surface is narrower.** GLOB escape burden: `*`, `?`, `[`, `]` in user input. LIKE escape burden: `%`, `_`, `\\`. Both are solvable, but GLOB's bracket form is a single `.replace(/([*?[\]])/g, '[$1]')` call. LIKE's ESCAPE form requires a designated escape char and a regex that doesn't double-escape. Bracket-escape is compositional and idempotent.
4. **CONTEXT D-03 already recommends it.** The recommendation is non-binding, but worth honoring when the technical case also supports it.

### The bracket-escape helper

```typescript
// Escape GLOB metacharacters (*, ?, [) in a user-supplied string by wrapping
// each in a bracket class. ']' inside a bracket class must be first or escaped;
// we avoid the issue by wrapping every metachar individually: '[*]', '[?]', '[[]'.
// ']' alone doesn't need escaping outside a bracket class.
function escapeGlobMeta(s: string): string {
  return s.replace(/([*?\[])/g, '[$1]');
}

function buildNamePredicate(name: string): { namePredicate: string; nameParam: string } {
  if (name.endsWith('*')) {
    // Prefix mode (D-01): strip trailing *, escape any remaining metachars, append *
    const prefix = escapeGlobMeta(name.slice(0, -1));
    return { namePredicate: 'name GLOB ?', nameParam: prefix + '*' };
  }
  // Exact mode (D-01): any * inside the name is treated as literal char
  return { namePredicate: 'name = ?', nameParam: name };
}
```

**Validated against D-01 examples:**

| Input | Predicate | Param | Matches |
|-------|-----------|-------|---------|
| `React*` | `name GLOB ?` | `React*` | `React`, `ReactDOM`, `Reactive` |
| `React` | `name = ?` | `React` | `React` only |
| `foo*bar` (literal `*` in middle) | `name = ?` | `foo*bar` | exact `foo*bar` only (0 matches in practice since JS identifiers can't contain `*`) |
| `foo*bar*` (trailing `*` = prefix, middle `*` literal) | `name GLOB ?` | `foo[*]bar*` | `foo*bar` + anything starting with `foo*bar` (0 matches in practice) |
| `*foo` (leading `*`) | `name = ?` | `*foo` | exact `*foo` only (0 matches in practice) |

All five behaviors match D-01. `[VERIFIED: live better-sqlite3 probe, 2026-04-23]`

## Zod + MCP SDK Schema Wiring

**Finding: `z.coerce.boolean().default(true)` and `z.coerce.number().int().optional()` pass through the MCP SDK `registerTool` inputSchema without adjustment.** `[VERIFIED: existing code paths]`

Evidence:
- `tests/unit/schema-coercion.test.ts:65-73` already exercises `z.object({ minImportance: z.coerce.number().optional() })` end-to-end and proves the coercion fires when string input is supplied.
- `scan_all` handler at mcp-server.ts:413–415 uses both `z.coerce.number().optional().default(1)` AND `z.boolean().optional().default(false)` (plain, not coerced) — so the SDK already accepts Zod defaults in tool schemas.
- No version quirk found. The MCP SDK schema validator invokes `.parse()` on the Zod object before the handler runs; coerced + defaulted fields arrive at the handler fully materialized.

**Recommendation:** Use the CONTEXT D-08 schema verbatim. Add ONE contract-test line in `schema-coercion.test.ts` to lock the `find_symbol` schema:

```typescript
it('find_symbol uses z.coerce.boolean() and z.coerce.number().int()', async () => {
  const src = await fs.readFile(path.resolve(process.cwd(), 'src/mcp-server.ts'), 'utf-8');
  const match = src.match(/registerTool\("find_symbol"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
  expect(match).toBeTruthy();
  expect(match![1]).toMatch(/exportedOnly:\s*z\.coerce\.boolean\(\)\.default\(true\)/);
  expect(match![1]).toMatch(/maxItems:\s*z\.coerce\.number\(\)\.int\(\)/);
});
```

This matches the grep-source style that the existing 5 tests already use.

**Edge case to flag:** `z.string().min(1)` on `name` will throw a Zod validation error if the agent sends `""`. This conflicts with D-06's "empty results, never throw" philosophy. CONTEXT D-08 still specifies `.min(1)` — the planner should confirm with the user OR interpret this as: "the SDK rejects at schema layer, so empty string never reaches the handler; the NOT_INITIALIZED-only error rule applies only to handler-reachable states." The pragmatic read is that Zod's `.min(1)` rejection produces a validation error distinct from the `ErrorCode` union — it manifests as the SDK's own malformed-input response, not an `mcpError` call. This is probably intentional: `name=""` is a protocol violation, not a "no matches found" case. Plan should not remove `.min(1)`.

## Raw SQLite Pagination Pattern

**Finding:** The dual-query `(SELECT COUNT + SELECT ... LIMIT)` pattern has NO exact precedent in repository.ts, but the closest-shape analogs all do in-memory counting because their full result sets are small (`list_files`, `find_important_files`).

`findSymbols` MUST count in SQL because a self-scan can produce many thousands of symbol rows — `inspect-symbols` output on one file (ast-parser.ts) shows 7+ symbols; extrapolated to 100+ TS files the table has 700+ rows already. Streaming all of them to count in JS is wasteful.

**Pattern to adopt:**

```typescript
const sqlite = getSqlite();
const where = '...';        // Same WHERE for both queries
const params = [...];       // Same params for both queries
const total = (sqlite.prepare(`SELECT COUNT(*) AS n FROM symbols WHERE ${where}`)
                     .get(...params) as { n: number }).n;
const rows = sqlite.prepare(`SELECT ... FROM symbols WHERE ${where} ORDER BY ... LIMIT ?`)
                   .all(...params, limit);
```

Two prepared statements, same DB connection, same parameters. better-sqlite3's statement cache makes the `COUNT` nearly free after the first call.

**Non-issue:** no need for `SELECT COUNT(*)` to match `SELECT ...` result count exactly (pre-truncation count is the contract per D-07). Same WHERE + no LIMIT on the count = correct.

**Precedent for the same-connection dual-query shape:** `getCommunityForFile` at repository.ts:828 runs two prepared statements against `getSqlite()` in sequence without an explicit transaction. Same shape.

## JSON Column Parsing (`imported_names`)

**Finding:** The codebase has ONE existing JSON-column read helper — `getExportsSnapshot` at repository.ts:475 — and it uses exactly the pattern needed here:

```typescript
// src/db/repository.ts:482-490 (getExportsSnapshot — the pattern to mirror)
if (!row || row.exports_snapshot === null || row.exports_snapshot === undefined) {
  return null;
}
try {
  return JSON.parse(row.exports_snapshot) as ExportSnapshot;
} catch {
  return null;
}
```

For `getDependentsWithImports`, adapt this pattern by returning `[]` on null/corrupt (D-14 says NULL → `[]`, and the same "never throw" philosophy extends to malformed JSON):

```typescript
function parseImportedNames(raw: string | null): string[] {
  if (raw === null) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
```

Use inline inside `getDependentsWithImports` (aggregation adds sort/dedupe on top). No separate exported helper — single call site.

**Phase 33 D-10 guarantee:** `imported_names` is NULL exclusively for non-TS/JS rows (Go, Ruby, etc.). For TS/JS rows post-Phase-33, it's always `JSON.stringify([...])` — a well-formed array (including `["*"]` for namespace imports per IMP-02, and `["default"]` for default imports). So in practice the `catch` block is defensive-only; but keeping it aligns with D-14's "never surface null".

## MCP Response Shape Validation — Contract Test Pattern

**Finding:** `tests/contract/` does NOT exist. The de facto contract test file is `tests/unit/tool-outputs.test.ts` — its module header says:

```typescript
// tests/unit/tool-outputs.test.ts
// Contract tests for MCP tool response shapes.
// Agents depend on stable output schemas — these tests prevent regressions.
// Tests the response construction logic WITHOUT starting the MCP server.
```

It uses a `describe('<tool> response contract', ...)` block-per-tool convention. The tests construct the wire shape inline from repository function outputs — they don't invoke the MCP server. Example (lines 117–153):

```typescript
describe('get_file_summary response contract', () => {
  it('returns path, importance, dependencies, dependents, summary', () => {
    clear();
    insertFile('/src/main.ts', { importance: 8, summary: 'Entry point' });
    insertFile('/src/utils.ts', { importance: 5 });
    insertDep('/src/main.ts', '/src/utils.ts');

    const node = getFile('/src/main.ts');
    const deps = getDependenciesWithEdgeMetadata('/src/main.ts');
    const staleness = getStaleness('/src/main.ts');

    // Simulate the response construction from mcp-server.ts
    const response = {
      path: node!.path,
      importance: node!.importance || 0,
      dependencies: deps.map(d => ({ path: d.target_path, edgeType: d.edge_type, confidence: d.confidence })),
      dependents: node!.dependents || [],
      summary: node!.summary || null,
      ...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
      // ...
    };

    expect(response.path).toBe('/src/main.ts');
    // ...
  });
});
```

The test file also enforces a **tool-name registry** (lines 420–447) that currently lists 13 tool names. Phase 34 adds a 14th (`find_symbol`) — that test MUST be extended or it will fail on passing the new tool name assertion. Actually, rereading the test: it asserts each `expectedTools` name EXISTS in mcp-server.ts source; it does NOT assert the list is exhaustive. Adding `find_symbol` to the array and including a `server.registerTool("find_symbol"` call in mcp-server.ts will make the test pass.

**Recommended approach for D-26:**

1. Extend `tests/unit/tool-outputs.test.ts` with:
   - A `describe('find_symbol response contract', ...)` block exercising `{items, total, truncated?}` envelope with exact match, prefix match, truncation, zero-match.
   - Update `expectedTools` array to add `'find_symbol'` (one-word change).
   - A `describe('get_file_summary response contract — Phase 34 enrichment', ...)` block (or extend the existing block) asserting `exports` is an array, `dependents[0]` is an object with `path`/`importedNames`/`importLines` keys.

2. **Do not create `tests/contract/mcp-tools.test.ts`.** Match the actual codebase layout. (Planner's discretion — CONTEXT D-26 says "extend" but the file doesn't exist yet; the closest extensible file is `tool-outputs.test.ts`.)

## Envelope Naming — Flagged Discrepancy

**Important:** CONTEXT D-07 says "matches existing `list_files` pattern at mcp-server.ts:219" and prescribes `{items, total, truncated?: true}`. The **actual** list_files/find_important_files envelope uses:

| CONTEXT prescribed | Actual `list_files` / `find_important_files` |
|--------------------|---------------------------------------------|
| `items:` | `files:` |
| `total:` | `totalCount:` |
| `truncated: true` | `truncated: true` ✓ |

Verified at mcp-server.ts:207–221 and :266–270:

```typescript
return mcpSuccess({
  files: items,
  ...(isTruncated && { truncated: true }),
  ...(isTruncated && { totalCount: allMatching.length }),
});
```

CONTEXT's envelope `{items, total, truncated?}` is a **new shape** distinct from the existing precedent. The planner should:

1. Treat CONTEXT D-07/FIND-04 as authoritative — use `items` and `total` for `find_symbol` (the requirements spec also says `{items, total}` in FIND-04).
2. **NOT** attempt to retroactively rename the `list_files` envelope. That's out of scope.
3. Note in the plan that Phase 34 introduces a second envelope convention. This is explicit in FIND-04's wording and should not be pushed back on.

No contradiction with SUM-03 — `get_file_summary` keeps its existing shape (path/importance/dependencies/... plus two NEW fields). The envelope question only applies to `find_symbol`.

## Files the Planner Will Touch

### Production code (3 files)

| File | Change | Anchor lines |
|------|--------|--------------|
| `src/mcp-server.ts` | Add import `getSymbolsForFile` from repository. Add new imports for `findSymbols`, `getDependentsWithImports`. Add `server.registerTool("find_symbol", ...)` — insert between `find_important_files` (ends :271) and `get_file_summary` (starts :273), OR after `get_file_summary`. Modify `get_file_summary` handler body at :301–318 — swap `dependents: node.dependents \|\| []` for the new helper call, add new `exports:` field | register site + handler body |
| `src/db/repository.ts` | Add `findSymbols(opts)` near existing `getSymbolsByName` at :902. Add `getDependentsWithImports(targetPath)` near existing `getDependents` at :230. Both are raw-SQL helpers matching Pattern 1 from §Architecture Patterns. Existing helpers unchanged | append to "Symbol persistence" section at :856 and dependents section near :230 |
| `src/db/symbol-types.ts` | OPTIONAL: add `DependentWithImports` interface. Alternative: inline the return type in `getDependentsWithImports`'s signature (planner's call — research leans toward inline since it's only exported through one helper) | end of file (:20) |

### Test code (3 files, 2 new + 1 extension)

| File | Status | Purpose | Reference pattern |
|------|--------|---------|-------------------|
| `tests/unit/find-symbol.test.ts` | NEW (D-23) | Unit tests: exact/prefix/exportedOnly/kind/unknown-kind/maxItems-clamp/truncated/NOT_INITIALIZED/zero-match | Model on `src/db/repository.symbols.test.ts` structure (describe-per-behavior, ephemeral DB setup/teardown) |
| `tests/unit/file-summary-enrichment.test.ts` | NEW (D-24) | Unit tests: exports populated + sorted / dependents aggregated per source / importedNames deduped / non-TS-JS empty / namespace imports `['*']` passed through | Same ephemeral DB pattern |
| `src/db/repository.symbols.test.ts` | EXTEND (D-25) | Add describes for `findSymbols` (dual-query count+slice, clamp behaviors) and `getDependentsWithImports` (aggregation, NULL-coerced-to-empty) | The file already has `describe('setEdges — imported_names...')` and `describe('setEdgesAndSymbols ...')` — append two new describes at the end |
| `tests/unit/tool-outputs.test.ts` | EXTEND (D-26, reinterpreted) | Response shape contract for `find_symbol` envelope + `get_file_summary.exports` / `get_file_summary.dependents[]` new shape. Also add `'find_symbol'` to `expectedTools` array at :430 | Follow existing `describe('<tool> response contract', ...)` pattern |
| `tests/unit/schema-coercion.test.ts` | EXTEND (recommended, small) | One new `it(...)` asserting `find_symbol` uses `z.coerce.boolean()` + `z.coerce.number().int()` in its schema | Follow existing 5 grep-source tests |

**Total code changes expected:** ~250–350 LOC across 5 files (production + tests), concentrated in the two new repository helpers and the two new unit test files.

## Risk Register

### R-1: `dependents[]` shape change cascades into a caller we missed (MITIGATED)

**What:** D-16 claims the `dependents[]` shape change is wire-only — `FileNode.dependents: string[]` remains `string[]` in memory. If a caller somewhere reads `get_file_summary` output and feeds it back into something that expected `string[]`, it would break.

**Verification:** Audited all `.dependents` callsites via `grep -rn "\.dependents" src/`. Results:
- `src/file-utils.ts` — 14 sites, all operate on `FileNode.dependents` (in-memory object), NOT on MCP response. In-memory shape unchanged. SAFE.
- `src/mcp-server.ts:257` — `find_important_files` uses `file.dependents?.length` (count only). Shape-change-agnostic. SAFE.
- `src/mcp-server.ts:310` — `get_file_summary` — this is the exact site being modified. INTENTIONAL.
- `src/db/repository.ts:54` — `rowToFileNode(withDeps=true)` calls `getDependents(row.path)` which returns `string[]`. In-memory only. SAFE.
- `src/nexus/ui/components/FileDetail.svelte:131–137` — reads `detail.dependents.length` + iterates as strings. BUT: `detail` is a different API response — `nexus/ui/lib/api.ts:85` types it as `{ path: string }[]`, and `src/nexus/repo-store.ts:315–339` builds it from a DIFFERENT SQL query, not from `get_file_summary`. Nexus and MCP responses are independent. SAFE.

**Confidence:** HIGH. The audit covers every `.dependents` callsite in `src/`. Only `mcp-server.ts:310` is affected, which is where the intentional modification lives.

**Residual risk:** An external consumer of the MCP API (e.g., a user's own LLM agent script outside the repo) may break. This is explicit per SUM-03 — the "additive" framing in SUM-03 is about the FIELD-level contract (no fields removed), not the type-level contract. No mitigation needed; the intent is documented.

### R-2: `symbols` table actually populated for in-repo TS files before first MCP call (VERIFIED)

**What:** `find_symbol` returning empty results on a freshly-started server would look like a phase-34 bug when it's actually a phase-33 population gap.

**Verification:**
- Phase 33 Plan 05 shipped `runSymbolsBulkExtractionIfNeeded(projectRoot)` at `src/migrate/bulk-symbol-extract.ts`. Gated by `kv_state.symbols_bulk_extracted` flag.
- Wired into `coordinator.init()` between `runMigrationIfNeeded` and `buildFileTree` (SUMMARY notes lines 278–284; `bulk-symbol-extract.ts` is already in the build entry list).
- Phase 33 Plan 05 SUMMARY Next Phase Readiness: "Every TS/JS file in a freshly-booted DB has populated `symbols` rows and populated `imported_names`/`import_line` on its outgoing `file_dependencies` edges. No lazy backfill path is needed — the first boot after upgrade runs the bulk pass synchronously during coordinator.init()."
- `setEdgesAndSymbols` is wired at all three scan-time write paths per phase 33 summary.

**Confidence:** HIGH. Phase 34 can assume populated data unconditionally. No defensive "empty? re-extract?" logic needed.

### R-3: `tests/contract/` doesn't exist — D-26 path references a non-existent location (IDENTIFIED)

**What:** CONTEXT D-26 says "Contract test for MCP tool response shape in `tests/contract/mcp-tools.test.ts` (extend)". `ls tests/` returns `fixtures/`, `integration/`, `unit/` — no `contract/` directory.

**Resolution:** Treat D-26 as a directive to EXTEND THE EXISTING CONTRACT TEST FILE, which is `tests/unit/tool-outputs.test.ts` (its header comment confirms it serves this purpose). Alternative: create the new directory for organizational cleanliness. Research recommends the former — no new structure for one file.

**Confidence:** HIGH. Planner decision, not a blocker.

### R-4: MCP tool description length (unknown — no verified limit)

**What:** D-20 mandates a long-form description with 7 required elements (purpose, match semantics, kind enum, defaults, response shape, when-to-use, error policy). If the MCP SDK enforces a description-length cap, the detailed description could be truncated.

**Check:**
- `list_files` description in mcp-server.ts is ~280 chars.
- `get_file_summary` description at :274 is ~430 chars.
- `search` description at :434 is ~270 chars.
- `get_communities` description at :589 is ~320 chars.

The longest existing description is ~430 chars. A 7-point description covering D-20 will likely be 800–1200 chars. The MCP SDK spec `[CITED: https://modelcontextprotocol.io/specification]` has no documented length cap on tool descriptions as of training data. `[ASSUMED]` — the spec is permissive; no empirical evidence of truncation in the existing SDK.

**Recommendation:** Write the description to target ~800 chars. If the description turns out to exceed SDK or display limits at runtime, split the "examples" into concrete `find_symbol("React*")` inline snippets and compress prose. Phase 34 plan should include a manual verification step: after implementing, run `npm run build` and send a `tools/list` request to confirm the description round-trips.

**Confidence:** LOW on the empirical limit. MEDIUM on the mitigation (manual post-build check is cheap).

### R-5: Symbol `name` containing a trailing `*` by coincidence (NON-ISSUE)

**What:** If a symbol name legitimately ends with `*`, the user searching for it exactly with trailing `*` would see prefix matching instead.

**Verification:** JS identifier spec `[VERIFIED: ECMAScript 11.6.1.1]` — IdentifierName is `IdentifierStart IdentifierPart*` where `IdentifierStart` ⊂ `{letter, $, _}` and `IdentifierPart` ⊂ `{letter, digit, $, _, ZWJ, ZWNJ}`. **`*` is not a valid identifier character.** Symbol names in the DB cannot end with `*`. Non-issue.

### R-6: Nexus UI depends on `get_file_summary` indirectly via some unknown API relay (NON-ISSUE)

**What:** If nexus-server forwards MCP responses to the UI, shape change cascades.

**Verification:** `nexus/repo-store.ts` builds its own `dependents` via a separate SQL query. Nexus does not relay `get_file_summary`. Non-issue. Confirmed under R-1.

## Common Pitfalls

### Pitfall 1: PRAGMA `case_sensitive_like` drift

**What goes wrong:** Turning on `PRAGMA case_sensitive_like = ON` globally changes LIKE behavior for every query across the DB, not just `find_symbol`. This could break `searchFiles` (which uses `LIKE @pattern` at repository.ts:608 and intentionally wants case-insensitive matching across summaries, purpose, paths).
**Why it happens:** Session PRAGMAs are connection-scoped and persist across statements until the connection closes.
**How to avoid:** Skip PRAGMA entirely — use `GLOB` for `find_symbol`. `searchFiles` stays untouched, case-insensitivity preserved.
**Warning signs:** After phase 34, `searchFiles('BROKER')` returns fewer results than `searchFiles('broker')` → PRAGMA contamination. Existing `search response contract` tests in `tool-outputs.test.ts` would catch this.

### Pitfall 2: `imported_names` JSON double-encoding

**What goes wrong:** Phase 33 writes `imported_names` as `JSON.stringify(arr)`. If `getDependentsWithImports` calls `JSON.stringify(JSON.parse(raw))` or returns raw strings, the wire response would contain stringified JSON instead of an array.
**Why it happens:** Confusion about which layer owns the JSON. Repository helper parses; handler uses the parsed shape directly; `JSON.stringify` happens only once in `mcpSuccess` (wraps the whole response).
**How to avoid:** Parse in the helper, return typed `string[]`. Let `mcpSuccess` handle the single outer `JSON.stringify` at mcp-server.ts:145. Never re-stringify intermediate values.
**Warning signs:** Unit test `importedNames is an array of strings` fails with `Expected Array, got String`.

### Pitfall 3: `truncated` flag leaking when not truncated

**What goes wrong:** Emitting `truncated: false` or `truncated: undefined` when `items.length === total`. D-07 says OMIT the field entirely when not truncated.
**Why it happens:** Forgetting the conditional-spread pattern and writing `truncated: isTruncated` directly.
**How to avoid:** Use `...(isTruncated && { truncated: true })` — the exact pattern at mcp-server.ts:219. Matches FIND-04 wording verbatim.
**Warning signs:** Contract test `omits truncated when not truncated` fails with `expected undefined to be undefined, received false`.

### Pitfall 4: maxItems clamp silently dropping user's "zero I meant zero" intent

**What goes wrong:** If a user passes `maxItems: 0` intending to get just the count, silent clamp to 1 returns one result unexpectedly. CONTEXT D-04 explicitly prefers this over an error, so it's not a bug — but it's a behavioral surprise.
**Why it happens:** `Math.max(1, Math.min(500, maxItems ?? 50))` drops 0 and negatives to 1 without signal.
**How to avoid:** Document the clamp in the tool description per D-20 point 4 ("`maxItems` clamped to [1, 500], defaults to 50"). Tests should cover: `maxItems: 0` → returns 1 item, `maxItems: 999` → returns at most 500 items.
**Warning signs:** Agent confusion in logs — "I asked for 0 and got 1."

### Pitfall 5: Ordering non-determinism on ties

**What goes wrong:** Two symbols with same `path` + same `startLine` (shouldn't happen per Phase 33 one-entry-per-declaration rule, but destructuring patterns at repository.symbols.test.ts §4 suggest edge cases). Without a tiebreaker, ORDER BY leaves order undefined.
**Why it happens:** SQLite ORDER BY is stable only up to the last key. `ORDER BY is_export DESC, path ASC, start_line ASC` is deterministic in practice but the id column would make it bulletproof.
**How to avoid:** Optionally append `, id ASC` to the ORDER BY as a tiebreaker. Not required by D-05 but a trivial robustness win. Planner's call.
**Warning signs:** Flaky test — "expected rows in order X but got Y" once in 100 runs.

## Code Examples

All examples are verified against the existing codebase patterns.

### Example 1: `find_symbol` handler skeleton

```typescript
// Target location: src/mcp-server.ts — between find_important_files and get_file_summary
// Sources: pattern from find_important_files :224-270; normalize logic from this research.
server.registerTool("find_symbol", {
  title: "Find Symbol",
  description: [
    "Resolve a symbol name (function/class/interface/type/enum/const) to its defining file + line range in a single call — no need to grep source.",
    "Exact case-sensitive match; trailing `*` switches to prefix match (e.g. `React*` matches `React`, `ReactDOM`, `Reactive`). Any other `*` in the name is a literal character.",
    "`kind` accepts: \"function\" | \"class\" | \"interface\" | \"type\" | \"enum\" | \"const\".",
    "`exportedOnly` defaults to `true` — private helpers only appear when you pass `exportedOnly: false`.",
    "`maxItems` defaults to 50, clamped to [1, 500].",
    "Response: `{items: [{path, name, kind, startLine, endLine, isExport}], total, truncated?: true}`.",
    "Use `find_symbol` when you know a symbol name; use `get_file_summary` when you have a path and want its exports + dependents.",
    "Returns `NOT_INITIALIZED` if the server hasn't been set up. All other outcomes (no match, unknown kind, empty prefix) return an empty `items` array — never an error.",
    "Example: `find_symbol(\"useState*\")` returns all symbols whose names start with `useState`."
  ].join(' '),
  inputSchema: {
    name: z.string().min(1).describe("Symbol name; trailing `*` triggers prefix match"),
    kind: z.string().optional().describe("function | class | interface | type | enum | const (unknown kind returns empty)"),
    exportedOnly: z.coerce.boolean().default(true).describe("Defaults to true — include private helpers by passing false"),
    maxItems: z.coerce.number().int().optional().describe("Max items to return, clamped to [1, 500], default 50"),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ name, kind, exportedOnly, maxItems }) => {
  if (!coordinator.isInitialized()) {
    return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
  }
  // maxItems clamp (D-04): [1, 500], default 50
  const limit = Math.max(1, Math.min(500, maxItems ?? 50));
  const kindFilter = (kind as SymbolKind | undefined);  // unknown kind → 0 rows (D-06)
  const { items, total } = findSymbols({ name, kind: kindFilter, exportedOnly, limit });
  const truncated = items.length < total;
  return mcpSuccess({
    items: items.map(s => ({
      path: s.path, name: s.name, kind: s.kind,
      startLine: s.startLine, endLine: s.endLine, isExport: s.isExport,
    })),
    total,
    ...(truncated && { truncated: true }),
  });
});
```

### Example 2: `get_file_summary` handler modifications

```typescript
// Target location: src/mcp-server.ts:285-319 (existing handler)
// Changes: add `exports` field, swap `dependents: node.dependents || []`
//          for the new helper call. All other fields unchanged.

// REPLACE the return statement at :301-318 with:
return mcpSuccess({
  path: node.path,
  ...(isStale && { stale: true }),
  importance: node.importance || 0,
  dependencies: getDependenciesWithEdgeMetadata(normalizedPath).map(d => ({
    path: d.target_path,
    edgeType: d.edge_type,
    confidence: d.confidence,
  })),
  // D-12..D-16: dependents upgraded to {path, importedNames, importLines}[]
  dependents: getDependentsWithImports(normalizedPath),
  // D-09..D-11: exports populated from symbols table, isExport=true only, sorted by startLine
  exports: getSymbolsForFile(normalizedPath)
    .filter(s => s.isExport)
    .sort((a, b) => a.startLine - b.startLine)
    .map(s => ({ name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine })),
  packageDependencies: node.packageDependencies || [],
  summary: node.summary || null,
  ...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
  ...(staleness.conceptsStale !== null && { conceptsStale: staleness.conceptsStale }),
  ...(staleness.changeImpactStale !== null && { changeImpactStale: staleness.changeImpactStale }),
  concepts: llmData?.concepts ? JSON.parse(llmData.concepts) : null,
  changeImpact: llmData?.change_impact ? JSON.parse(llmData.change_impact) : null,
});
```

### Example 3: Sort importedNames for stable diffs (Specifics §)

```typescript
// Per CONTEXT Specifics section: "importedNames should be sorted alphabetically
// within each dependent entry for stable diffs — trivial addition, big
// readability win when comparing summaries across scans."
importedNames: Array.from(namesSet).sort(),  // default string sort is fine (identifier-only content)
```

## State of the Art

| Old Approach (pre-Phase-34) | Current Approach | When Changed | Impact |
|-----------------------------|------------------|--------------|--------|
| Agents grep source for symbol locations | `find_symbol` MCP call returns `{path, line, kind}` | Phase 34 | Eliminates O(repo_size) text search for symbol navigation |
| `get_file_summary.dependents: string[]` | `get_file_summary.dependents: {path, importedNames, importLines}[]` | Phase 34 | Agents know WHICH symbols a dependent imports + the line to jump to |
| `getSymbolsByName(name, kind?)` exact-match-only | `findSymbols({name, kind?, exportedOnly, limit})` with prefix + pagination | Phase 34 | Exact-match primitive preserved; new helper wraps for MCP path |

**Deprecated/outdated:**
- None at phase entry. All phase-33 exports stay as-is.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | MCP SDK imposes no description-length cap that would truncate a ~1000-char tool description | §Risk Register R-4 | Description gets truncated in `tools/list`, agents see partial info. Mitigation: manual verification step in plan. |
| A2 | `z.coerce.boolean()` used via MCP SDK's schema pipeline accepts `"true"`/`"false"` strings as well as actual booleans (matching the documented coerce semantics) | §Zod + MCP SDK Schema Wiring | Users passing string booleans from JSON-stringified args get validation errors. Mitigation: a contract test exercising schema-coercion. |
| A3 | Symbol names in the DB are always valid JS identifiers (cannot contain `*`, `?`, `[`, `]`, `%`, `_` chars that matter for GLOB/LIKE) | §GLOB vs LIKE decision | Edge case: Phase 33's destructuring-pattern capture (mentioned in inspect-symbols output: `{ typescript: TypeScriptLang, tsx: TSXLang } const L22-L25`) stores the destructuring text as the "name". That DOES contain `{`, `}`, `:`, `,`, spaces — none of which are GLOB/LIKE metachars. Still safe, but weakly verified. Mitigation: low-impact; destructuring-pattern symbols are not useful `find_symbol` targets anyway. |
| A4 | Nexus UI does NOT go through `get_file_summary` for its `dependents` rendering | §Risk Register R-1 | UI breaks. Verified by reading `nexus/repo-store.ts:315-339` — Nexus queries `file_dependencies` directly with its own SQL. Confidence: HIGH. |

**Nothing assumed about:** SQLite GLOB semantics (verified via probe), LIKE case-sensitivity (verified via probe), JSON column read pattern (verified against `getExportsSnapshot`), test file locations (verified via `ls`), `FileNode.dependents` callsite audit (verified via grep).

## Open Questions (RESOLVED)

1. **D-26 path resolution — `tests/contract/mcp-tools.test.ts` vs `tests/unit/tool-outputs.test.ts`**
   - What we know: `tests/contract/` does not exist; `tests/unit/tool-outputs.test.ts` is the de facto contract test file.
   - What's unclear: whether CONTEXT intended to create a new directory or extend the existing file.
   - RESOLVED: extend `tool-outputs.test.ts` (matches actual codebase layout; D-26 says "extend"). Planner should confirm this interpretation before starting the test work.

2. **`DependentWithImports` type location — new export in symbol-types.ts vs inline in repository.ts**
   - What we know: `symbol-types.ts` currently hosts symbol-specific types only; inlining the return type in `getDependentsWithImports` works TypeScript-wise.
   - What's unclear: organizational preference.
   - RESOLVED: inline in the helper's return-type. If a second consumer (e.g., a new nexus helper) emerges in Phase 35+, promote to an exported type then. Keep `symbol-types.ts` narrowly scoped.

3. **Tool description length budget (R-4)**
   - What we know: no empirical SDK limit in training data; longest existing description ~430 chars.
   - What's unclear: exact cap at runtime.
   - RESOLVED: aim for ~800 chars; include a post-build manual check ("run `tools/list`, confirm description round-trips complete") in the plan.

4. **`maxItems` clamp direction for `maxItems: 0`**
   - What we know: D-04 says "Zero or negative values rejected not as an error but by clamping to 1".
   - What's unclear: whether agents might send `maxItems: 0` meaning "just the count" — this use case would benefit from returning `{items: [], total: N}` without the clamp.
   - RESOLVED: stick with D-04 exactly. Document the clamp explicitly in the tool description. If agent telemetry later reveals `maxItems: 0` is common, revisit.

## Environment Availability

No new external dependencies. Phase 34 is pure TypeScript editing over existing packages.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@modelcontextprotocol/sdk` | registerTool API | ✓ | per package.json | — |
| `zod` | inputSchema | ✓ | per package.json | — |
| `better-sqlite3` | getSqlite().prepare() | ✓ | per package.json | — |
| `vitest` | test runner | ✓ | 3.1.4 | — |
| Node.js | runtime | ✓ | per package.json engines | — |

All build/test tooling verified present via existing Phase 33 build (dist/ contains symbol-types.js, change-detector/ast-parser.js, bulk-symbol-extract.js).

## Sources

### Primary (HIGH confidence)
- `src/mcp-server.ts` (lines 1–727) — registration site + envelope helpers + existing tools for precedent
- `src/db/repository.ts` (lines 1–1024) — Pattern 1/2/3 sources; existing `getSymbolsByName`, `getSymbolsForFile`, `getDependents`, `getExportsSnapshot`, `getDependenciesWithEdgeMetadata`
- `src/db/schema.ts` — `symbols` table + `file_dependencies.imported_names`/`import_line` columns
- `src/db/symbol-types.ts` — `Symbol` / `SymbolKind` types
- `src/db/repository.symbols.test.ts` — existing Phase 33 test patterns for ephemeral DB setup
- `tests/unit/tool-outputs.test.ts` — existing contract-test pattern and tool-name registry
- `tests/unit/schema-coercion.test.ts` — `z.coerce.*` validation precedent
- `.planning/phases/34-symbol-aware-mcp-surface/34-CONTEXT.md` — D-01..D-26 decisions
- `.planning/phases/33-symbol-extraction-foundation/33-05-SUMMARY.md` — phase-33 completion state + guarantees for phase-34
- `.planning/REQUIREMENTS.md` — FIND-01..05, SUM-01..04
- Live `better-sqlite3` probe (2026-04-23, in-memory DB) — GLOB vs LIKE ESCAPE behavioral verification

### Secondary (MEDIUM confidence)
- SQLite docs `https://www.sqlite.org/lang_expr.html#glob` — GLOB case-sensitivity semantics `[CITED]`
- ECMAScript Language Spec §11.6.1 IdentifierName — valid identifier character set `[CITED]`

### Tertiary (LOW confidence)
- MCP SDK tool description length cap — `[ASSUMED]` no cap based on existing ~430-char description working; requires manual verification post-build

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, every library already proven in prior phases
- Architecture: HIGH — every pattern has a direct in-repo precedent; one gap (SQL COUNT+LIMIT pagination) has a clear composition recipe
- Pitfalls: HIGH — five pitfalls identified, four with precedent in existing test suite, one (PRAGMA drift) already avoided by the GLOB choice
- Risks: HIGH — R-1 (the only scary one) fully audited via grep and resolved

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (30 days; pure surface wiring phase — dependencies are all locked in phase 33)
