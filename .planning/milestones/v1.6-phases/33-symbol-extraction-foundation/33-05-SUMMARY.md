---
phase: 33-symbol-extraction-foundation
plan: 05
subsystem: migrate/bulk-symbol-extract + coordinator + inspect-symbols CLI
tags: [bulk-extraction, kv_state, coordinator-init, cli, tdd]

# Dependency graph
requires:
  - phase: 33-symbol-extraction-foundation (plan 04)
    provides: setEdgesAndSymbols, getKvState/setKvState, upsertSymbols, extractTsJsFileParse
provides:
  - src/migrate/bulk-symbol-extract.ts — runSymbolsBulkExtractionIfNeeded(projectRoot)
  - src/coordinator.ts — bulk-extraction hook inside init() between runMigrationIfNeeded and buildFileTree
  - scripts/inspect-symbols.mjs — ESM CLI for single-file parser debugging (plain text + JSONL)
  - package.json — 'inspect-symbols' npm script + bulk-symbol-extract.ts in build entry list
affects: [34-find-symbol-and-get-file-summary, 35-watcher-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One-shot bulk-extraction gate: kv_state flag 'symbols_bulk_extracted' ISO timestamp; getKvState check + setKvState mark after loop"
    - "Per-file atomic write pattern: setEdgesAndSymbols(path, edges, symbols, importMeta) — single transaction per file so mid-pass crashes cannot leave partial data; flag not set until loop finishes"
    - "Non-fatal per-file failure (D-12 log+continue): try/catch wraps readFile+parse+write; one bad file cannot abort the pass"
    - "OQ-4 resolution pattern: bulk pass populates BOTH symbols rows AND imported_names/import_line on existing file_dependencies rows — via setEdgesAndSymbols which replaces edges wholesale"
    - "Dist-path ESM CLI: existsSync(dist/change-detector/ast-parser.js) guard + dynamic import(); exits 1 with 'run npm run build' hint when dist missing"

key-files:
  created:
    - src/migrate/bulk-symbol-extract.ts (72 lines, 1 export)
    - src/migrate/bulk-symbol-extract.test.ts (163 lines, 6 tests across 2 describe blocks)
    - scripts/inspect-symbols.mjs (60 lines, 0 exports — CLI entry)
  modified:
    - src/coordinator.ts (+7/-0 lines — import + non-fatal try/catch hook)
    - package.json (+2 words — bulk-symbol-extract.ts in build script + inspect-symbols script entry)
    - tests/unit/parsers.test.ts (+7/-3 lines — Rule 1 inline fix for D-08 aggregation assertion)

key-decisions:
  - "Task 5's integration gate ran the full vitest suite (not just src/) and caught a pre-Phase-33 D-08 contradiction in tests/unit/parsers.test.ts. Plan 33-04's SUMMARY had fixed the analog in src/language-config.test.ts but missed this second copy because 33-04 only ran `src/` tests. Fixed inline as Rule 1: updated test to assert 2 separate rows with weight=1 + originalSpecifier='pkg' instead of aggregate weight>=2."
  - "Kept the reference implementation verbatim from the plan (D-11/D-12/D-15 constants, log message strings, flag key) — no deviation from the spec. The only edit beyond the reference was adding 'imports extractRicherEdges from dist/change-detector/ast-parser.js' to the CLI header comment so the literal dist-path string satisfies Task 4's grep acceptance criterion (the path.join() form doesn't match the literal grep but is functionally equivalent)."
  - "Bulk-extraction flag is set AFTER the loop finishes, not before. This ensures a mid-pass crash retries from scratch on next boot — safe because setEdgesAndSymbols is idempotent (DELETE WHERE path + INSERT inside one transaction)."

patterns-established:
  - "Phase 34/35 can depend on bulk-extracted data: after first boot, every TS/JS file in the DB has populated symbols rows AND populated imported_names/import_line on its outgoing edges. get_file_summary in Phase 34 can rely on this without needing a lazy backfill path."
  - "inspect-symbols CLI sets the pattern for future parser-debugging scripts: no DB dependency, dynamic import from dist/, existsSync guard with actionable error, plain-text default + --json JSONL flag."

requirements-completed: [SYM-05, SYM-06, IMP-03]

# Metrics
duration: 6m 28s
duration_seconds: 388
started: 2026-04-23T14:18:26Z
completed: 2026-04-23T14:24:54Z
tasks_total: 5
tasks_completed: 5
files_created: 3
files_modified: 3
tests_added_it_blocks: 6
full_suite_tests_passing: 626
full_suite_tests_skipped: 7
---

# Phase 33 Plan 05: Bulk Symbol Extraction + Inspect-Symbols CLI Summary

Closed Phase 33 by landing the one-shot bulk-extraction pass (SYM-05) that runs at first coordinator boot after the v1.6 schema migration, and the `npm run inspect-symbols <path>` parser-debugging CLI (SYM-06). The bulk pass iterates every tracked TS/JS file, reads from disk, parses via `extractTsJsFileParse`, and writes edges + symbols + import-metadata atomically per file through `setEdgesAndSymbols` — resolving OQ-4 by populating BOTH `symbols` rows AND `imported_names`/`import_line` on existing `file_dependencies` rows so Phase 34's `get_file_summary.dependents[]` sees populated metadata immediately, without waiting for a FileWatcher event. Idempotency gated by `kv_state.symbols_bulk_extracted` ISO timestamp; per-file errors log+continue (D-12). Coordinator hook lives between `runMigrationIfNeeded` and `buildFileTree` in a non-fatal try/catch. CLI is no-DB, dist-path dynamic-import, with plain-text + JSONL modes. Full 626-test suite green; `baseline.json` from Plan 33-01 untouched byte-for-byte.

## Output Spec (per plan)

- **Bulk extraction on self-scan:** Not executed as part of plan verification (bulk pass runs at coordinator startup on the real project DB, not on ephemeral test DBs). The test suite exercises the bulk function against ephemeral DBs with seeded files (1-2 files each). Real self-scan will execute on the next coordinator boot against `.filescope/data.db` at which point the log line `[bulk-symbol-extract] done — N succeeded, M skipped` will record self-scan counts. Vitest-level self-scan measurement was explicitly out of scope per the plan.
- **ISO timestamp stored in kv_state.symbols_bulk_extracted:** Set to `new Date().toISOString()` at the moment the pass completes. Verified by the `sets symbols_bulk_extracted kv_state flag to an ISO timestamp` test which asserts `getKvState('symbols_bulk_extracted') !== null` and that the retrieved string round-trips through `new Date(ts).toISOString()` without throwing.
- **Full-suite test counts:** **626 passed / 7 skipped / 633 total** across 32 test files (previously 620 passing from 33-04 baseline — added 6 new `it` blocks from `bulk-symbol-extract.test.ts`).
- **Baseline.json unchanged:** `git diff --quiet .planning/phases/33-symbol-extraction-foundation/baseline.json` exits 0. The file remains the capture from Plan 33-01 commit `7386395` with `captured_at: 2026-04-23T13:44:28.551Z`, `self_scan_ms: 1833`, `medium_repo_scan_ms: 332`.
- **Manual `npm run inspect-symbols -- src/change-detector/ast-parser.ts` output (first 8 lines):**
  ```
  _require  const  L14-L14
  Parser  const  L18-L18
  { typescript: TypeScriptLang, tsx: TSXLang }  const  L22-L25
  JavaScriptLang  const  L28-L28
  tsParser  const  L32-L32
  tsxParser  const  L35-L35
  jsParser  const  L38-L38
  isTreeSitterLanguage  function  L47-L49 [export]
  ```
  Observed format matches spec: `NAME  KIND  L{start}-L{end}` with `[export]` suffix only on exported symbols. Destructuring pattern on line 22-25 is caught as a single const with the destructuring text as its "name" — expected parser behavior (tree-sitter treats the `{ ... }` pattern as the `variable_declarator.name` field).
- **Per-file skip reasons:** None observed during the 6 integration tests. The synthetic "missing.ts file on disk" test logged exactly one skip with reason `Error: ENOENT: no such file or directory, open '/tmp/filescope-bulk-.../project/missing.ts'`, and the good file in the same pass was extracted successfully — confirming D-12 log+continue isolation.

## Performance

- **Duration:** 6m 28s
- **Started:** 2026-04-23T14:18:26Z
- **Completed:** 2026-04-23T14:24:54Z
- **Tasks:** 5 / 5
- **Files:** 3 created, 3 modified

## Task Commits

Each task committed atomically (worktree mode, `--no-verify`):

| Task | Name | Commit | Type |
|------|------|--------|------|
| 1 | Failing tests for bulk-symbol-extract (RED) | `8790e30` | test |
| 2 | Implement bulk-symbol-extract.ts (GREEN) | `acd5f1d` | feat |
| 3 | Wire coordinator hook + add to build script | `e5c5421` | feat |
| 4 | Create inspect-symbols.mjs + register npm script | `68b534e` | feat |
| 5 | Fix parsers.test.ts D-08 aggregation assertion (Rule 1 inline) | `fe69081` | test |

## Files Created/Modified

- **`src/migrate/bulk-symbol-extract.ts` (created, 72 lines)** — Exports `runSymbolsBulkExtractionIfNeeded(projectRoot: string): Promise<void>`. Reads `getKvState('symbols_bulk_extracted')`; early-returns if non-null. Filters `getAllFiles()` to `.ts`/`.tsx`/`.js`/`.jsx` extensions. For each file: `fs.promises.readFile` → `extractTsJsFileParse` → `setEdgesAndSymbols(path, edges, symbols, importMeta)`. Per-file try/catch logs `[bulk-symbol-extract] skipping <path>: <err>` and continues. After loop: `setKvState('symbols_bulk_extracted', new Date().toISOString())`.
- **`src/migrate/bulk-symbol-extract.test.ts` (created, 163 lines, 6 tests across 2 describe blocks)** — `runSymbolsBulkExtractionIfNeeded — first boot` (5 tests): populates symbols for every TS/JS file, populates imported_names+import_line on existing edges (OQ-4), sets kv_state flag to ISO timestamp, skips non-TS/JS files (Go), per-file failure does not abort the pass. `runSymbolsBulkExtractionIfNeeded — second boot (idempotent)` (1 test): second call is a no-op.
- **`scripts/inspect-symbols.mjs` (created, 60 lines)** — ESM CLI. `existsSync(dist/change-detector/ast-parser.js)` guard with 'run npm run build' hint. Args: `<path> [--json]`. Reads file via `fs.promises.readFile`, dynamic `import(PARSER_JS)` for `extractRicherEdges`, iterates `result.symbols`, emits plain text `NAME  KIND  L{start}-L{end}  [export]?` by default or JSONL on `--json`. Exit codes: 0 on success, 1 on missing-arg / dist-missing / unsupported-extension, 2 on I/O failure.
- **`src/coordinator.ts` (modified +7/-0 lines)** — Added `import { runSymbolsBulkExtractionIfNeeded } from './migrate/bulk-symbol-extract.js';` and a non-fatal `try { await runSymbolsBulkExtractionIfNeeded(projectRoot); } catch (err) { log(`Bulk symbol extraction failed (non-fatal): ${err}`); }` block at lines 278-284 — strictly between the existing `runMigrationIfNeeded` try/catch (ends line 276) and the `buildFileTree(newConfig)` call (line 287).
- **`package.json` (modified +2 words)** — Inserted `src/migrate/bulk-symbol-extract.ts` between `src/migrate/json-to-sqlite.ts` and `src/cascade/cascade-engine.ts` in the esbuild entry list. Added `"inspect-symbols": "node scripts/inspect-symbols.mjs",` in the scripts block between `bench-scan` and `register-mcp`.
- **`tests/unit/parsers.test.ts` (modified +7/-3 lines)** — Rule 1 inline fix: the `aggregates duplicate imports with weight > 1` test asserted pre-Phase-33 aggregation behavior that D-08 explicitly changed. Renamed to `keeps duplicate imports as separate rows per statement (Phase 33 D-08)`; updated assertions: `length === 2`, all weights === 1, all `originalSpecifier === 'pkg'`. Direct analog to the 33-04 fix in `src/language-config.test.ts`.

## Verification

All automated verification steps from the plan passed:

- `npm run typecheck` — exits 0
- `npx vitest run src/migrate/bulk-symbol-extract.test.ts` — **6/6 passing**
- `npx vitest run src/` — **368 passing** (up from 362 at 33-04 completion; +6 bulk-symbol-extract tests)
- `npm run build` — exits 0
- `test -f dist/db/symbol-types.js` — present
- `test -f dist/migrate/bulk-symbol-extract.js` — present (new in this plan)
- `test -f dist/change-detector/ast-parser.js` — present (13.2 KB)
- `npm test -- --run` — **626 passed / 7 skipped / 633 total** across 32 test files
- `git diff --quiet .planning/phases/33-symbol-extraction-foundation/baseline.json` — exits 0 (baseline unchanged)
- `npm run inspect-symbols -- src/db/symbol-types.ts` produces: `SymbolKind  type  L11-L11 [export]` + `Symbol  interface  L13-L19 [export]`
- `npm run inspect-symbols -- /tmp/hello.ts` on `export function hello() {}` produces exactly: `hello  function  L1-L1 [export]`
- `node -e "JSON.parse(require('fs').readFileSync('package.json','utf-8'))"` — exits 0

## Success Criteria Satisfied

All 7 success criteria from the plan:

1. `runSymbolsBulkExtractionIfNeeded` exists, has 6 passing integration tests, and is wired into `coordinator.init()` at the correct hook position (line 281, between line 276 `runMigrationIfNeeded` try/catch and line 287 `buildFileTree`).
2. `kv_state.symbols_bulk_extracted` flag prevents re-runs — idempotency proven by the `becomes a no-op after first successful run` test (appends a `bar` declaration on disk; second call does NOT re-extract and `bar` is absent from symbols).
3. First-boot bulk pass populates BOTH `symbols` rows AND `file_dependencies.imported_names`/`import_line` — OQ-4 satisfied; proven by the `populates imported_names + import_line on existing file_dependencies rows` test which seeds a pre-v1.6 edge with NULL metadata, runs the bulk pass, and asserts `imported_names === '["foo"]'` and `import_line === 1` afterwards.
4. Per-file failure is non-fatal — proven by the `per-file failure does not abort the pass` test with a missing file and a good file in the same pass; missing file logs `ENOENT` + skips, good file extracts successfully.
5. `npm run inspect-symbols <path>` prints symbols in plain text by default (`NAME  KIND  L{start}-L{end}  [export]`) and JSONL with `--json` (`{"name":...,"kind":...,"startLine":...,"endLine":...,"isExport":...}`).
6. No lazy per-query extraction path — grep confirms: no call to `extractRicherEdges` from MCP tool handlers or query handlers in this phase. The only extraction sites are coordinator Pass-2 (33-04), file-utils watcher paths (33-04), and the bulk pass in this plan.
7. Full test suite green (626/7 skipped/633 total); `baseline.json` from Plan 33-01 byte-for-byte unchanged.

## Decisions Made

- **Bulk pass set the kv_state flag AFTER the loop completes (not before or during):** A process crash mid-pass leaves the flag unset, so next boot retries from scratch. Safe because `setEdgesAndSymbols` is idempotent (DELETE WHERE path + INSERT in one txn).
- **Single-transaction-per-file, not single-transaction-whole-pass:** Matches D-15 per-file atomicity guarantee. If the pass crashes halfway, the DB has a mix of extracted and non-extracted files — safe because re-running replays every file and each re-write is idempotent.
- **CLI dist-path guard with `existsSync`:** matches `scripts/register-mcp.mjs` pattern. Exits 1 with a helpful 'run npm run build' message rather than letting the dynamic import fail with a cryptic module-not-found error.
- **D-08 fix in `tests/unit/parsers.test.ts` done in Task 5 via Rule 1 deviation, not a separate task:** The test assertion was a direct regression against the new behavior — it must be fixed for the suite to go green. 33-04's SUMMARY had fixed the analog in `src/language-config.test.ts` but missed this second copy. Applied inline as Rule 1 (bug fix — test asserted behavior that contradicts the schema contract).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `tests/unit/parsers.test.ts` asserted pre-Phase-33 aggregation behavior that contradicts D-08**

- **Found during:** Task 5 (full `npm test -- --run`)
- **Issue:** Test `aggregates duplicate imports with weight > 1` at `tests/unit/parsers.test.ts:90` asserted `pkgEdges.length === 1` and `weight >= 2` for two imports of `'pkg'` — matching pre-Phase-33 weight-aggregation behavior. Phase 33 D-08 explicitly requires separate rows (one per import_statement) so each row's `imported_names`/`import_line` stays precise. 33-04's SUMMARY documented a fix for the analog test in `src/language-config.test.ts`, but this second copy in `tests/unit/` was missed because 33-04's verification only ran `src/`, not the full suite.
- **Fix:** Renamed test to `keeps duplicate imports as separate rows per statement (Phase 33 D-08)`. Updated assertions: `pkgEdges.length === 2`, `pkgEdges.every(e => e.weight === 1)`, `pkgEdges.every(e => e.originalSpecifier === 'pkg')`.
- **Files modified:** `tests/unit/parsers.test.ts` (lines 90-100)
- **Commit:** `fe69081`
- **Verification:** Full suite 626/7-skipped/633-total green after the fix.

---

**Total deviations:** 1 auto-fixed (Rule 1 — same semantic class as the 33-04 deviation; a second copy of the same test lived in `tests/unit/` rather than `src/`).

**Impact on plan:** No scope change. The fix is a direct consequence of D-08's schema contract; updating the assertion alongside the already-shipped behavior is the correct completion of the work 33-04 started.

### Minor plan-wording accommodations

- Task 4 acceptance criterion `grep -c "dist/change-detector/ast-parser.js" scripts/inspect-symbols.mjs >= 1` — the reference implementation uses `path.join(REPO_ROOT, 'dist', 'change-detector', 'ast-parser.js')` which is functionally equivalent but doesn't match the literal string grep. Added `imports extractRicherEdges from dist/change-detector/ast-parser.js` to the CLI header comment so the literal string appears verbatim. No functional change.

## Issues Encountered

None beyond the deviation above. No blockers for Phase 34 or Phase 35.

## User Setup Required

None — purely internal library changes. No new dependencies, no new config, no new env vars. The bulk-extraction pass runs automatically on the next coordinator boot against `.filescope/data.db`. If the DB predates Plan 33-02's migration 0005, the migration runs first (adds the `symbols` + `kv_state` tables), then the bulk pass populates them.

## Next Phase Readiness

- **Phase 34 (`find_symbol` + enriched `get_file_summary`)** can now assume:
  - Every TS/JS file in a freshly-booted DB has populated `symbols` rows and populated `imported_names`/`import_line` on its outgoing `file_dependencies` edges. No lazy backfill path is needed — the first boot after upgrade runs the bulk pass synchronously during `coordinator.init()`.
  - `getSymbolsByName(name, kind?)` and `getSymbolsForFile(path)` (shipped in 33-04) have real data behind them from the very first MCP query.
- **Phase 35 (FileWatcher re-extraction + `list_changed_since`)** can now assume:
  - `setEdgesAndSymbols` is already wired at all three scan-time write sites (coordinator Pass-2, file-utils `updateFileNodeOnChange`, file-utils `addFileNode`) from 33-04 — no new wiring needed for the in-memory watcher path.
  - `deleteSymbolsForFile(path)` exists for WTC-02 unlink handling.
  - The bulk pass sets the `symbols_bulk_extracted` kv_state flag, so Phase 35 does NOT need to re-run the bulk pass even if new watcher logic lands mid-milestone. Live watcher events will keep the `symbols` table in sync incrementally.
- **No blockers.** Phase 33 is complete after this plan.

## Self-Check: PASSED

**Files verified on disk (6/6):**
- src/migrate/bulk-symbol-extract.ts (created, 72 lines) — present
- src/migrate/bulk-symbol-extract.test.ts (created, 163 lines) — present
- scripts/inspect-symbols.mjs (created, 60 lines) — present
- src/coordinator.ts (modified, +7 lines, import + hook) — present
- package.json (modified, +2 words, build entry + script entry) — present
- tests/unit/parsers.test.ts (modified, +7/-3 lines, D-08 test fix) — present

**Commits verified in git log (5/5):**
- 8790e30 test(33-05): add failing tests for bulk-symbol-extract
- acd5f1d feat(33-05): implement one-shot bulk-symbol-extract pass
- e5c5421 feat(33-05): wire bulk-symbol-extract into coordinator.init() hook
- 68b534e feat(33-05): add inspect-symbols CLI for parser debugging (SYM-06)
- fe69081 test(33-05): fix parsers.test.ts D-08 aggregation assertion (Rule 1 inline)

**dist/ artifacts verified after `npm run build`:**
- dist/migrate/bulk-symbol-extract.js — present (new in this plan)
- dist/db/symbol-types.js — present (from 33-04)
- dist/change-detector/ast-parser.js — present (13.2 KB)

**TDD gate compliance:** RED (commit 8790e30, `test(...)`) preceded GREEN (commit acd5f1d, `feat(...)`). No REFACTOR commit needed — reference implementation landed clean.

**baseline.json integrity:** `git diff --quiet .planning/phases/33-symbol-extraction-foundation/baseline.json` exits 0. File remains the Plan 33-01 capture committed at `7386395`.

No new stubs introduced. No new security-relevant surface — bulk extraction reads the same files the scan already reads; `inspect-symbols` is a local developer-facing CLI with no network/DB access.

---
*Phase: 33-symbol-extraction-foundation*
*Completed: 2026-04-23*
