---
phase: 37-ts-js-call-site-edge-extraction
plan: "02"
subsystem: call-site-extraction
tags: [repository, coordinator, bulk-migration, symbol-dependencies, cascade, delete-file, lifecycle-test, verification]
dependency_graph:
  requires: [37-01]
  provides: [37-02]
  affects: [src/db/repository.ts, src/coordinator.ts, src/migrate/bulk-call-site-extract.ts, src/file-watcher.watcher-symbol-lifecycle.test.ts]
tech_stack:
  added: []
  patterns:
    - five-step deleteFile cascade (materialize IDs -> both-sides DELETE -> file_deps -> symbols -> files)
    - empty-IN guard (symbolIds.length > 0) prevents SQL syntax error for zero-symbol files
    - spread-twice pattern (.run(...symbolIds, ...symbolIds)) for both-sides IN bind
    - three-key precondition check (no unified Phase 36 gate exists)
    - gate write AFTER loop (crash-safe idempotent retry)
    - per-file try/catch/log/continue error policy
    - non-fatal try/catch coordinator wiring
key_files:
  created:
    - src/file-watcher.watcher-symbol-lifecycle.test.ts
    - src/migrate/bulk-call-site-extract.ts
    - src/migrate/bulk-call-site-extract.test.ts
    - .planning/phases/37-ts-js-call-site-edge-extraction/37-VERIFICATION.md
  modified:
    - src/db/repository.ts
    - src/coordinator.ts
    - package.json
decisions:
  - "Both-sides DELETE in deleteFile (not caller-side only): file is gone entirely, no eventual-consistency window applies"
  - "symbolIds.length > 0 guard: empty IN () is a SQL syntax error; skip when file has zero symbols"
  - "Three-key precondition check (D-27 option b): no unified multilang_symbols_bulk_extracted gate in Phase 36 — check all three per-language keys individually"
  - "Gate write AFTER full loop: a crash mid-pass leaves gate unset; next boot retries safely (setEdgesAndSymbols idempotent)"
  - "Non-fatal coordinator wiring: try/catch wraps the new call; failure logs and continues; file tree still built"
  - "package.json build entry: bulk-call-site-extract.ts added to esbuild entry points (Rule 3 deviation — needed for bench-scan)"
  - "VERIFICATION.md perf note: worktree bench-scan not comparable to main repo (empty DB, no prior scans); algorithmic argument used instead (one batch query per file)"
metrics:
  duration_minutes: 28
  completed_date: "2026-04-24"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 3
  tests_added: 12
  tests_passing: 823
---

# Phase 37 Plan 02: Cascade + Backfill + VERIFICATION Summary

**One-liner:** Five-step deleteFile cascade (both-sides symbol_dependencies DELETE with materialized IDs), gated bulk backfill with three Phase 36 precondition keys, non-fatal coordinator wiring, and 37-VERIFICATION.md phase exit gate.

## What Was Built

### Task 1: deleteFile five-step cascade + lifecycle regression test (CSE-05)

Extended `deleteFile()` in `src/db/repository.ts` from a three-step to a five-step cascade, all inside the same `sqlite.transaction()`:

1. **Step 1 (materialize):** `SELECT id FROM symbols WHERE path = ?` before the symbols DELETE — ordering is load-bearing (D-21); if symbols were deleted first, the subquery would return nothing.
2. **Step 2 (both-sides DELETE):** `DELETE FROM symbol_dependencies WHERE caller_symbol_id IN (...) OR callee_symbol_id IN (...)` — unlike `setEdgesAndSymbols` (caller-side only), `deleteFile` must clear BOTH sides because the file is gone entirely. Guard: `symbolIds.length > 0` prevents empty-IN SQL syntax error for zero-symbol files.
3. **Steps 3-5:** Original `file_dependencies` → `symbols` → `files` DELETEs preserved in reordered positions.

Spread-twice pattern: `.run(...symbolIds, ...symbolIds)` binds both `caller_symbol_id IN (?)` and `callee_symbol_id IN (?)` placeholder lists.

New `src/file-watcher.watcher-symbol-lifecycle.test.ts` (4 tests):
- `symbol_dependencies, symbols, and files all empty after deleteFile` — checks total `symbol_dependencies` count is 0 after unlink (catches orphaned rows that the old 3-step cascade left behind)
- `deleteFile removes callee-side rows pointing to the deleted file from OTHER files` — cross-file callee-side cleanup
- `deleteFile on a file with zero symbols does not throw (empty symbolIds guard)` — guard test
- `rewriting file clears old caller-side rows and writes new ones` — change scenario regression (D-24)

### Task 2: Bulk backfill migration module + coordinator wiring (CSE-06)

New `src/migrate/bulk-call-site-extract.ts` exposing `runCallSiteEdgesBulkExtractionIfNeeded(projectRoot)`:
- **Gate:** `call_site_edges_bulk_extracted` — no-op on subsequent boots.
- **Precondition:** All three Phase 36 per-language gates (`symbols_py_bulk_extracted`, `symbols_go_bulk_extracted`, `symbols_rb_bulk_extracted`) must be set. Phase 36 does NOT set a unified gate (RESEARCH §Item 7 confirmed — D-27 option b).
- **Per-file loop:** TS/JS extensions (.ts, .tsx, .js, .jsx, .mjs, .cjs); `extractTsJsFileParse` → `setEdgesAndSymbols` with 5-arg callSiteEdges; try/catch/log/continue per file.
- **Gate write AFTER loop:** Crash mid-pass leaves gate unset; next boot retries safely.

New `src/migrate/bulk-call-site-extract.test.ts` (8 tests across 4 describe blocks — CSE-06 coverage).

`src/coordinator.ts` wired: import added at line 21; call at line 303, after `runMultilangSymbolsBulkExtractionIfNeeded` (line 294) and before `buildFileTree` (line 309), in a non-fatal `try/catch` wrapper.

### Task 3: 37-VERIFICATION.md phase exit gate (D-31, D-34)

`.planning/phases/37-ts-js-call-site-edge-extraction/37-VERIFICATION.md` created with:
- One row per test per CSE-02..06, citing test file + describe block + exact test name.
- Perf budget table (self <= 2883ms, medium <= 520ms) with caveat: worktree bench-scan is not comparable to main-repo baseline (empty DB context); algorithmic argument confirms one batch query per file.
- Phase 37 exit gate: **PASS**.

## Test Coverage (Phase 37 Plan 02)

| Describe block | File | Requirement |
|---|---|---|
| `watcher-symbol-lifecycle — unlink cascade (CSE-05)` | `src/file-watcher.watcher-symbol-lifecycle.test.ts` | CSE-05 |
| `watcher-symbol-lifecycle — change (caller-side clear) (D-24)` | `src/file-watcher.watcher-symbol-lifecycle.test.ts` | CSE-05 |
| `runCallSiteEdgesBulkExtractionIfNeeded — gate already set (no-op)` | `src/migrate/bulk-call-site-extract.test.ts` | CSE-06 |
| `runCallSiteEdgesBulkExtractionIfNeeded — precondition gates unset (abort without gate-write)` | `src/migrate/bulk-call-site-extract.test.ts` | CSE-06 |
| `runCallSiteEdgesBulkExtractionIfNeeded — first boot (preconditions set)` | `src/migrate/bulk-call-site-extract.test.ts` | CSE-06 |
| `runCallSiteEdgesBulkExtractionIfNeeded — per-file failure does not abort pass` | `src/migrate/bulk-call-site-extract.test.ts` | CSE-06 |

**Tests added this plan:** 12 (4 + 8)
**Total tests at plan completion:** 823 passing

## Perf Numbers

Worktree bench-scan (empty-DB context, not comparable to main-repo baseline):
- Self-scan: 245ms / 505 files (empty DB, no Phase 36 gates set — bulk extraction aborts at precondition)
- Medium-repo: 45ms / 102 files

Main-repo baseline (v1.7-baseline.json, Phase 36 capture):
- Self-scan: 2403ms / 490 files
- Medium-repo: 434ms / 102 files

Phase 37 perf budget: self <= 2883ms (1.20x), medium <= 520ms (1.20x). Expected to hold based on algorithmic analysis (one batch SQL query per file in `extractTsJsFileParse`, zero new `parser.parse()` calls).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing build script entry point for bulk-call-site-extract.ts**
- **Found during:** Task 3 (bench-scan ran `node scripts/bench-scan.mjs` which loads `dist/coordinator.js` which imports `dist/migrate/bulk-call-site-extract.js`)
- **Issue:** `package.json` build script did not list `src/migrate/bulk-call-site-extract.ts` as an esbuild entry point. Running `node scripts/bench-scan.mjs` failed with `ERR_MODULE_NOT_FOUND`.
- **Fix:** Added `src/migrate/bulk-call-site-extract.ts` to the esbuild entry list in `package.json`, analogous to `bulk-multilang-symbol-extract.ts`.
- **Files modified:** `package.json`
- **Commit:** 6399532

**2. [Behavioral - Test design] RED test for deleteFile needed total-count assertion, not subquery**
- **Found during:** Task 1 RED phase
- **Issue:** Initial test used `WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE path = ?)` to check deletion, which passes trivially after deleteFile because the symbols are also deleted (subquery returns 0 rows, so count is 0 regardless). The orphaned rows were invisible to this check.
- **Fix:** Changed assertion to check total `SELECT COUNT(*) FROM symbol_dependencies` = 0, which correctly catches the orphaned rows left by the old 3-step cascade.
- **Impact:** The RED state was correctly established (1 test failed), implementation produced GREEN (0 orphaned rows).

## Known Stubs

None.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries. All changes are local-daemon DB operations (T-37-04, T-37-05, T-37-06 per plan threat model — T-37-06 accepted).

## Self-Check: PASSED

| Check | Result |
|---|---|
| `src/db/repository.ts` deleteFile five-step cascade present | FOUND (`grep -c "const symbolIds"` = 1) |
| `grep -c "DELETE FROM symbol_dependencies"` in repository.ts | 2 (setEdgesAndSymbols + deleteFile) |
| `grep -c "OR callee_symbol_id IN"` in repository.ts | 1 |
| `grep -c '...symbolIds, ...symbolIds'` in repository.ts | 1 |
| `src/file-watcher.watcher-symbol-lifecycle.test.ts` exists | FOUND |
| `src/migrate/bulk-call-site-extract.ts` exists | FOUND |
| `src/migrate/bulk-call-site-extract.test.ts` exists | FOUND |
| `runCallSiteEdgesBulkExtractionIfNeeded` in coordinator.ts | 2 lines (import + call) |
| Call-site line (303) > multilang line (294) in coordinator.ts | PASS |
| buildFileTree line (309) > call-site line (303) in coordinator.ts | PASS |
| `.planning/phases/37-ts-js-call-site-edge-extraction/37-VERIFICATION.md` exists | FOUND |
| No {fill} or {PASS/FAIL} placeholders in VERIFICATION.md | PASS (0 matches) |
| Baseline file v1.7-baseline.json unchanged | PASS (git diff clean) |
| Commit 2e85643 exists (Task 1) | FOUND |
| Commit adf34d5 exists (Task 2) | FOUND |
| Commit 6399532 exists (Task 3) | FOUND |
| `npm run build` exits 0 | PASS |
| `npm test` exits 0 (823 passing, 7 skipped) | PASS |
