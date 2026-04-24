# Phase 35: Changed-Since Tool + Watcher Integration - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning
**Mode:** `--auto` (Claude selected recommended options for every gray area)

<domain>
## Phase Boundary

Three additive surface changes that close v1.6:

1. **New MCP tool `list_changed_since(since, maxItems?)`** — agents re-orient after multi-edit runs in one call. Accepts ISO-8601 timestamp OR 7–40 char git SHA. Returns `{items: [{path, mtime}], total, truncated?: true}` sorted `mtime DESC`. Timestamp mode compares DB `files.mtime` (ms epoch). SHA mode shells out `git diff --name-only <sha> HEAD` and intersects against the DB.
2. **Unlink cascade for `symbols`** — on file deletion, symbol rows for that path are removed alongside `file_dependencies` rows and the `files` row. Single transaction in `deleteFile()`.
3. **PERF-02 regression gate** — run `npm run bench-scan` at phase close, compare to `33-symbol-extraction-foundation/baseline.json`. Soft-fail > 15% regression, hard-fail > 25%.

**Already-done plumbing (confirmed by scout — do NOT re-implement):**
- **WTC-01 (watcher re-extracts symbols on change):** `updateFileNodeOnChange` at `src/file-utils.ts:984` and `addFileNode` at `src/file-utils.ts:1104` already call `setEdgesAndSymbols(path, edges, symbols, importMeta)` inside a single AST pass. Phase 35 only adds a regression-guard test, no wiring.
- **WTC-03 (symbols staleness):** Symbols and edges are written in one `setEdgesAndSymbols` transaction per file. Staleness == file `mtime`. No separate freshness column needed.

**Out of scope (future milestone):**
- Deletion tombstones for `list_changed_since` (explicitly rejected in v1.6 scope audit — CHG-05).
- Fuzzy / partial SHA resolution (7-char minimum stays).
- Python/Go/Ruby symbol re-extraction on watcher events (v1.7 language work).
- Nexus UI surface for changed-since.
- Pagination beyond `maxItems` clamp (cursor tokens etc).

</domain>

<decisions>
## Implementation Decisions

### list_changed_since — Input Parsing (CHG-01, CHG-04)

- **D-01: Dispatch via regex first, then Date.parse.** Test `since` against `/^[0-9a-fA-F]{7,40}$/` → SHA mode. Otherwise call `Date.parse(since)`; `NaN` → `INVALID_SINCE`. Any finite ms result → timestamp mode. One deterministic order, no ambiguity — a 7-char hex string is SHA, nothing else is.
- **D-02: `since` length floor = 7 chars (per CHG-01 "7+ char SHA").** Shorter hex strings do NOT trigger SHA mode — they fall through to `Date.parse`, usually fail, and return `INVALID_SINCE`. Keeps the rule one regex, no tiered validation.
- **D-03: Case-insensitive hex (`a-fA-F`).** Git accepts either case; we pass through unchanged. No normalization to lowercase.
- **D-04: Empty string or whitespace-only → `INVALID_SINCE`.** Zod `z.string().min(1)` catches pure-empty; whitespace-only still fails both regex + `Date.parse` and lands in `INVALID_SINCE`.

### list_changed_since — SHA Mode (CHG-03, CHG-04)

- **D-05: `.git` existence gate checked BEFORE shelling out.** `fsSync.existsSync(path.join(projectRoot, '.git'))` → if missing, return `NOT_GIT_REPO` immediately. Avoids a subprocess call for the hot sad-path and gives the user a precise error code.
- **D-06: Use `execFileSync('git', ['diff', '--name-only', sha, 'HEAD'], opts)` — NOT `execSync(string)`.** Injection-safe by construction (no shell parsing); the SHA regex (D-01) is a belt-and-suspenders guard, not the last line of defense. Diverges from `src/change-detector/git-diff.ts:27` which uses `execSync` — that call has a hard-coded string with already-quoted `filePath`; our SHA comes from user input, so `execFileSync` is the right primitive.
- **D-07: Timeout = 5000ms, matching `git-diff.ts`.** Consistent with existing git-shelling convention.
- **D-08: Git failure (bad SHA, git not installed, etc.) → `INVALID_SINCE`.** Wrap `execFileSync` in try/catch; any throw after the `.git` existence check collapses to `INVALID_SINCE`. Do NOT leak raw git stderr to the MCP response — log it, return the code.
- **D-09: Git output paths are POSIX repo-relative. Resolve to absolute via `path.resolve(projectRoot, p)` then `canonicalizePath()`** (the same chain `file-utils.ts:163` uses). Normalized paths feed `getFilesByPaths()`.
- **D-10: Deleted files in git output are naturally filtered by DB intersection (CHG-05).** `git diff --name-only` lists added/modified/deleted files relative to the commit. Since `getFilesByPaths` only returns rows present in `files`, deleted paths drop out silently — no tombstone machinery.

### list_changed_since — Timestamp Mode (CHG-02)

- **D-11: `Date.parse(since)` is authoritative.** Accepts full ISO-8601 (`2026-04-23T12:34:56Z`), date-only (`2026-04-23`), and other RFC-2822 forms Node parses. Convert to ms epoch; compare against `files.mtime`.
- **D-12: Rows with `mtime IS NULL` are excluded from timestamp mode.** Phase 1 schema permits null mtime (unknown). Can't compare → skip. Directories (`is_directory = 1`) also excluded. Both filters live in SQL, not JS.
- **D-13: Comparison is strict `>`, not `>=`.** `mtime > since` — if `since` equals a file's mtime exactly, it was NOT changed since; it was changed AT that moment. Symmetric with "give me what's new".

### list_changed_since — Response Shape (CHG-02)

- **D-14: Standard envelope `{items: [{path, mtime}], total, truncated?: true}`.** Mirrors `find_symbol` (D-07 from Phase 34) and `find_important_files`. `total` = pre-truncation count; `truncated` omitted when not applicable.
- **D-15: `mtime` is always a number in the response.** Timestamp mode: DB mtime is non-null by filter. SHA mode: a file in git output with `mtime IS NULL` in DB is coerced to `0`. Agents get a number; `0` signals "unknown mtime, but file is in the changed set".
- **D-16: Ordering: `mtime DESC, path ASC`.** Most-recent first — matches user's mental model ("show me what just changed"). Path as secondary key for deterministic pagination-friendly output.
- **D-17: `maxItems` default = 50, clamped to `[1, 500]`.** Identical policy to `find_symbol` D-04. Zero/negative silently clamp to 1.
- **D-18: Empty result is `{items: [], total: 0}` (success), NOT an error.** Matches the "only NOT_INITIALIZED + parse errors are errors" philosophy established in FIND-05 and phase 34.

### list_changed_since — Error Codes (CHG-04)

- **D-19: Extend the `ErrorCode` union in `src/mcp-server.ts:138` to include `INVALID_SINCE | NOT_GIT_REPO`.** No new error machinery — same `mcpError(code, message)` helper at line 140.
- **D-20: Only three error codes used: `NOT_INITIALIZED`, `INVALID_SINCE`, `NOT_GIT_REPO`.** No `OPERATION_FAILED` catch-all — git throw-after-`.git`-check collapses to `INVALID_SINCE` (D-08). Keeps the error surface minimal and testable.

### list_changed_since — Input Schema (Zod)

- **D-21: Schema shape:**
  ```ts
  {
    since: z.string().min(1),
    maxItems: z.coerce.number().int().optional(),
  }
  ```
  No `z.coerce.date` — `since` is a plain string because it carries two modes. The handler does the dispatch.

### list_changed_since — Tool Description

- **D-22: Long-form description matching Phase 34 D-20 style.** Must cover:
  1. One-line purpose: "Re-orient after multi-file edits — returns every tracked file whose mtime (or git history) is newer than a given reference point."
  2. Two modes: ISO-8601 timestamp (e.g. `2026-04-23T10:00:00Z`) vs git SHA ≥ 7 chars (e.g. `860fe61`).
  3. SHA mode invokes `git diff --name-only <sha> HEAD` and intersects with the DB.
  4. No deletion tracking — only files currently in the DB appear.
  5. Response shape + `maxItems` default/clamp.
  6. Error codes `NOT_INITIALIZED | INVALID_SINCE | NOT_GIT_REPO` with one-line semantics each.
  7. Concrete example invocations for both modes.
- **D-23: Authored as `string[].join(' ')` literal** — same pattern as `find_symbol` (see Phase 34 D-22 and the `describe-length-probe` in `scripts/`). Enables the description-length probe script to regex-extract without running JS.

### Repository Helpers

- **D-24: New helper `getFilesChangedSince(mtimeMs: number): Array<{path: string, mtime: number}>` in `src/db/repository.ts`.** Single raw-SQL read:
  ```sql
  SELECT path, mtime FROM files
  WHERE is_directory = 0 AND mtime IS NOT NULL AND mtime > ?
  ORDER BY mtime DESC
  ```
  Uses `getSqlite().prepare(...)` — same style as `getSymbolsByName` and `getDependenciesWithEdgeMetadata`. No Drizzle for read paths in this phase.
- **D-25: New helper `getFilesByPaths(paths: string[]): Array<{path: string, mtime: number | null}>`.** For SHA mode's DB intersection.
  - Empty input → return `[]` immediately (no query).
  - Build `WHERE path IN (?, ?, …)` prepared statement. Chunk in batches of 500 (well under SQLite's 999-variable default).
  - Order by DB order — caller sorts.
- **D-26: No changes to `getFile`, `upsertFile`, `getAllFiles`.** These remain the single-row and full-table primitives. New helpers are phase-35-specific shapes.

### Unlink Cascade — WTC-02

- **D-27: Extend `deleteFile()` at `src/db/repository.ts:153` to also delete from `symbols`.** Symmetric with the existing `file_dependencies` cascade (lines 156–163). Wrap the three deletes in a `better-sqlite3` transaction for atomicity:
  ```ts
  const tx = sqlite.transaction(() => {
    // delete file_dependencies (existing)
    // delete symbols WHERE path = ? (new)
    // delete files WHERE path = ? (existing)
  });
  tx();
  ```
  The symbols delete uses raw sqlite (`getSqlite().prepare('DELETE FROM symbols WHERE path = ?')`) — matches how Phase 33 `deleteSymbolsForFile` was written.
- **D-28: DO NOT add a separate `deleteSymbolsForFile(path)` call inside `removeFileNode` at `src/file-utils.ts:1215`.** One code path through `deleteFile` — avoids the dual-site drift risk and keeps the startup integrity sweep (`runStartupIntegritySweep` → `removeFileNode` → `deleteFile`) and live watcher path identical. Per user preference: "one code path, no legacy support".
- **D-29: `deleteSymbolsForFile()` (Phase 33, repository.ts:1058) stays as-is.** Still callable directly by tests or future code; `deleteFile` does NOT delegate to it (inlines the DELETE to share the transaction).

### WTC-01 — Regression Guard Only

- **D-30: No production code change for WTC-01.** `setEdgesAndSymbols` is already called by `updateFileNodeOnChange` (file-utils.ts:984) and `addFileNode` (file-utils.ts:1104). The planner MUST add a dedicated test (see D-36) to prevent future drift.

### WTC-03 — No Per-Symbol Staleness Column

- **D-31: No schema change.** Symbols live in a per-file transaction with edges (setEdgesAndSymbols). Staleness is file-granular (`files.mtime`). Any future per-symbol freshness need is deferred to the same milestone as symbol-level diffing — not v1.6.

### PERF-02 — Regression Check

- **D-32: Run `npm run bench-scan` as the last step of the last plan in this phase.** Script already exists (`scripts/bench-scan.mjs`); no code changes. Output currently writes to `baseline.json` at phase 33's path — the planner's last task captures the produced file and copies it to `.planning/phases/35-changed-since-tool-watcher-integration/bench-end.json` BEFORE the next `bench-scan` run could overwrite.
- **D-33: Regression thresholds (per REQUIREMENTS.md PERF-02, baseline `860fe61`):**
  - Self-scan baseline **1833 ms** — soft limit 2108 ms (15%), hard limit 2291 ms (25%).
  - Medium-repo baseline **332 ms** — soft limit 382 ms (15%), hard limit 415 ms (25%).
  - Either axis exceeding **25%** blocks merge. Between 15–25% flags the phase for follow-up but does not block.
- **D-34: Record the bench-end numbers + verdict in the phase's `35-VERIFICATION.md`** (produced later by `/gsd-verify-phase`). Plan only needs to run and copy the JSON.

### Testing Strategy

- **D-35: `tests/unit/list-changed-since.test.ts`** (new) covers:
  - Timestamp mode: valid ISO passes through; NULL-mtime rows excluded; directory rows excluded; strict `>` boundary; empty result returns `{items: [], total: 0}`.
  - SHA mode: `.git`-missing → `NOT_GIT_REPO`; invalid SHA (non-hex / < 7 chars / garbage) → `INVALID_SINCE`; valid SHA triggers git shell out (mock via `execFileSync` spy); deleted files dropped by DB intersection; paths canonicalized.
  - Envelope: `truncated` present iff items dropped; `total` always pre-truncation.
  - `maxItems` clamp `[1, 500]`; negative/zero → 1.
  - `NOT_INITIALIZED` when coordinator not ready.
- **D-36: `tests/unit/watcher-symbol-lifecycle.test.ts`** (new) — the WTC regression guard:
  - WTC-01: `upsertFile` + `setEdgesAndSymbols` a TS file; simulate change (new symbol added); call `updateFileNodeOnChange`; `getSymbolsForFile(path)` reflects the new set (old symbols gone, new present).
  - WTC-02: `upsertFile` + symbols; call `removeFileNode` (or `deleteFile` directly); `getSymbolsForFile(path)` returns `[]`; `getFile(path)` returns undefined; `getDependencies` path also empty (sanity check on existing cascade).
- **D-37: `tests/unit/repository.changed-since.test.ts`** (new) — `getFilesChangedSince` ordering and NULL/directory exclusion; `getFilesByPaths` empty input, partial matches, batch-chunking above 500 paths.
- **D-38: Extend `tests/unit/schema-coercion.test.ts`** — `list_changed_since` input: `since` kept as string, `maxItems` coerced via `z.coerce.number().int()`.
- **D-39: Extend `tests/unit/tool-outputs.test.ts`** — contract lock for `list_changed_since` output shape (add alongside Phase 34's `find_symbol` locks).
- **D-40: Extend `tests/unit/schema-coercion.test.ts` find_symbol-description probe pattern** — add a `list_changed_since` description length probe if the script already covers tool descriptions. If not, skip.

### Claude's Discretion

- Exact placement of the `since` dispatcher: inline in the MCP handler (5–10 lines) vs small `resolveSinceReference(since, projectRoot)` helper with a discriminated-union return. Planner picks — testability vs locality.
- Test file naming (`watcher-symbol-lifecycle.test.ts` vs split `...symbol-update.test.ts` + `...symbol-unlink.test.ts`).
- Whether `bench-scan.mjs` gets a `--out` flag extension for D-32's copy step, or the plan shells out `cp baseline.json bench-end.json` after the run.
- Whether `getFilesByPaths` uses Drizzle's `inArray()` helper or raw prepared IN queries (codebase mixes both; consistency with `getSymbolsByName` raw-sql precedent leans raw).
- Batch chunk size for `getFilesByPaths` — 500 is a conservative default, anything 100–900 is fine.
- Exact prose of the `list_changed_since` tool description — D-22 specifies the facts that MUST be covered; wording is the planner's call.

### Folded Todos

_None — no pending todos matched phase 35 scope (confirmed via `todo.match-phase 35`)._

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap + requirements
- `.planning/ROADMAP.md` — Phase 35 entry: goal, depends-on (33, 34), requirements (CHG-01..05, WTC-01..03, PERF-02), success criteria (1–7)
- `.planning/REQUIREMENTS.md` §list_changed_since Tool (CHG-01..05), §Watcher Integration (WTC-01..03), §Performance Budget (PERF-02)
- `.planning/PROJECT.md` — v1.6 milestone scope audit decisions: "no deletion tracking", "three tools only", "TS/JS only v1.6"

### Phase 33 + 34 context (MUST read — this phase builds on both)
- `.planning/phases/33-symbol-extraction-foundation/33-CONTEXT.md` — symbol schema, `setEdgesAndSymbols`, single-pass parser, `deleteSymbolsForFile`
- `.planning/phases/33-symbol-extraction-foundation/baseline.json` — PERF-02 reference wall-times (self-scan 1833 ms, medium-repo 332 ms, commit `860fe61`)
- `.planning/phases/34-symbol-aware-mcp-surface/34-CONTEXT.md` — tool envelope pattern (D-07), description style (D-20), Zod coercion pattern (D-08), error-code philosophy

### Source files to extend (NOT rewrite)
- `src/mcp-server.ts` §`ErrorCode` union (line 138) — add `INVALID_SINCE | NOT_GIT_REPO`
- `src/mcp-server.ts` §`registerTool("find_symbol", …)` (lines 331–378) — closest-analog tool; copy envelope + description-array idiom for `list_changed_since`
- `src/mcp-server.ts` §`mcpSuccess` / `mcpError` helpers (lines 140–150) — all responses flow through these; no new error machinery
- `src/db/repository.ts` §`deleteFile` (lines 150–166) — extend to cascade `symbols` in a transaction (WTC-02)
- `src/db/repository.ts` §`getSymbolsByName` / `getSymbolsForFile` (lines 902+) — raw-sqlite read pattern; reuse for `getFilesChangedSince` and `getFilesByPaths`
- `src/db/repository.ts` §`deleteSymbolsForFile` (lines 1054–1061) — keep as-is; do NOT delete from `deleteFile` (D-28 rationale)
- `src/file-utils.ts` §`updateFileNodeOnChange` (lines 897–990) — already calls `setEdgesAndSymbols` (line 984); read-only reference for WTC-01 test
- `src/file-utils.ts` §`addFileNode` (lines 1002–1110) — also already calls `setEdgesAndSymbols` (line 1104); reference
- `src/file-utils.ts` §`removeFileNode` (lines 1129–1219) — calls `deleteFile` at line 1215; no code change, new coverage via WTC-02 cascade
- `src/file-utils.ts` §`canonicalizePath` (line 32) — use for git diff output path normalization

### Git shelling reference
- `src/change-detector/git-diff.ts` (lines 21–48) — existing `execSync` git pattern; **diverge to `execFileSync`** for user-input SHA (D-06 rationale)

### Schema (read-only — no changes this phase)
- `src/db/schema.ts` §`files.mtime` (line 14) — `integer`, nullable ms-epoch column consumed by timestamp mode
- `src/db/schema.ts` §`files.is_directory` (line 11) — filter in `getFilesChangedSince` (D-12)
- `src/db/schema.ts` §`symbols` table (Phase 33 additive migration `0005`) — target of the new cascade DELETE

### Existing codebase conventions
- `.planning/codebase/CONVENTIONS.md` — ES modules, `.js` extensions in relative imports, mcpSuccess/mcpError pattern
- `.planning/codebase/STRUCTURE.md` — `tests/unit/` directory convention; no `tests/contract/` (R-3 in Phase 34)
- `.planning/codebase/TESTING.md` — vitest patterns; `tests/unit/tool-outputs.test.ts` is the contract-lock home

### Existing tests (reference + extend)
- `tests/unit/schema-coercion.test.ts` — `z.coerce.number()` + `z.coerce.boolean()` precedent (Phase 34); extend for `list_changed_since`
- `tests/unit/tool-outputs.test.ts` — extend for `list_changed_since` envelope lock (D-39)
- `src/db/repository.symbols.test.ts` — Phase 33 symbols-table test pattern; reuse harness style for `getFilesChangedSince`
- `scripts/bench-scan.mjs` + `package.json` `bench-scan` script — PERF-02 runner (no code change, reuse as-is)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`setEdgesAndSymbols` (repository.ts:1092)** — single-transaction writer already wired into both scan path (`coordinator.ts:781`) and watcher update path (`file-utils.ts:984`, `:1104`). WTC-01 is effectively done.
- **`deleteSymbolsForFile` (repository.ts:1058)** — direct delete primitive; usable from tests but not called by `deleteFile` (we inline the DELETE inside the cascade transaction to share atomicity — D-27).
- **`mcpSuccess` / `mcpError` (mcp-server.ts:140–150)** — all tool responses already flow through these; list_changed_since uses the same plumbing, plus two new error codes in the `ErrorCode` union.
- **`z.coerce.number().int()` + `z.string().min(1)` Zod pattern** — validated in Phase 34 and `tests/unit/schema-coercion.test.ts`; drops straight into `list_changed_since` input schema.
- **`canonicalizePath` (file-utils.ts:32)** — already the codebase's path-normalization primitive; SHA mode feeds it git-relative paths after `path.resolve(projectRoot, p)`.
- **`scripts/bench-scan.mjs` + `npm run bench-scan`** — baseline capture machinery already shipped by Phase 33. Re-run for PERF-02, no new script.

### Established Patterns
- `{items, total, truncated?}` envelope — precedent in `list_files`, `find_important_files`, `find_symbol` (Phase 34). Don't invent a second envelope variant.
- One `NOT_INITIALIZED` guard at handler entry — repeated ~8 times in mcp-server.ts. Same line for `list_changed_since`.
- Raw SQL via `getSqlite().prepare(…)` for read-heavy paths — consistent with `getSymbolsByName`, `getDependenciesWithEdgeMetadata`, `getDependents`. Drizzle is used for write paths in the older repository, but new read helpers stay raw for symmetry with Phase 33/34.
- Tool descriptions as `string[].join(' ')` literals — Phase 34 established this for the length-probe script. `list_changed_since` follows suit.
- Additive schema migrations only; `symbols` cascade is code-level, no new migration.
- Git shell-out pattern: existing `execSync` in `git-diff.ts` hardcodes the command. For user-input SHAs, diverge to `execFileSync` (D-06).

### Integration Points
- `src/mcp-server.ts` — single registration site for the new `list_changed_since` tool; also the `ErrorCode` union extension.
- `src/db/repository.ts` — adds `getFilesChangedSince`, `getFilesByPaths`; extends `deleteFile` with the `symbols` DELETE inside a transaction.
- `tests/unit/` — new test files for tool behavior, watcher lifecycle, repository helpers; existing schema-coercion and tool-outputs extended.
- No changes to: `src/coordinator.ts` (scan path untouched), `src/file-watcher.ts` (watcher wiring untouched), `src/file-utils.ts` (all WTC-01/02 paths already correct — cascade happens downstream in `deleteFile`).
- Nexus / broker unaffected — this phase adds one read-only MCP tool and tightens one transactional delete. No surface-level changes to the `FileNode` shape or the broker protocol.

</code_context>

<specifics>
## Specific Ideas

- Tool description for `list_changed_since` should include two concrete in-context examples side-by-side: `list_changed_since("2026-04-23T10:00:00Z")` and `list_changed_since("860fe61")`. LLMs need to see both modes resolved to understand they share one entry point.
- SHA mode's "git failure → `INVALID_SINCE`" rule (D-08) should be called out explicitly in the description: *"If `git diff` fails for any reason (unknown SHA, corrupt repo, etc.) this returns `INVALID_SINCE` — no SHA is ever assumed valid without git's confirmation."* Prevents agent retry loops.
- The `truncated: true` key should appear ONLY when `items.length < total`. Don't emit `truncated: false` — matches existing tools' conditional spread idiom (see `mcp-server.ts:376`).
- The unlink cascade test (D-36 WTC-02 branch) should assert NOT JUST that `symbols` is empty, but that the DB has zero orphan rows (sanity query: `SELECT COUNT(*) FROM symbols WHERE path = ?`). Defends against future schema changes that might split symbols into multiple tables.
- Running `bench-scan` at phase close gives the milestone a visible closing number. The planner should make the PERF-02 plan the final one so the captured JSON reflects the final state of all three phases (33/34/35).

</specifics>

<deferred>
## Deferred Ideas

- **Deletion tombstones for `list_changed_since`** — a `deleted_files` table tracking unlinked paths with deletion timestamp. Explicitly rejected for v1.6 (CHG-05, PROJECT.md decision). Revisit in v1.7 if agents ask for "what was deleted since".
- **Partial/short SHA resolution (< 7 chars)** — would require a preliminary `git rev-parse --short=N` call. 7-char minimum matches git's default short-SHA length; shorter is deliberately not supported.
- **Fuzzy timestamp parsing ("yesterday", "2h ago")** — add a date-library dependency; agents can compute ISO strings themselves. Not a v1.6 addition.
- **Per-directory `list_changed_since(since, dir)` filter** — narrowing to a path prefix. Usable but adds surface area; defer until an agent usage pattern emerges.
- **Pagination beyond `maxItems`** (cursor tokens) — `find_important_files` and `find_symbol` don't paginate either; `maxItems` clamp + `truncated` flag is the established v1.6 pattern.
- **PERF-02 automation in CI** — a `bench-scan-ci` command that fails the build on > 25% regression. Possible v1.7 dev-ex addition. v1.6 reports manually in `35-VERIFICATION.md`.
- **Watcher integration for Python/Go/Ruby symbol re-extraction** — deferred to v1.7 (PROJECT.md scope audit). TS/JS only this milestone.
- **Nexus UI surface for changed-since** — v1.6 is explicitly MCP-surface only. No Svelte component this phase.

</deferred>

---

*Phase: 35-changed-since-tool-watcher-integration*
*Context gathered: 2026-04-23*
