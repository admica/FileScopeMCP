---
phase: 37-ts-js-call-site-edge-extraction
plan: "01"
subsystem: call-site-extraction
tags: [ast-parser, language-config, repository, symbol-dependencies, call-site-edges, tdd]
dependency_graph:
  requires: [36-03]
  provides: [37-01]
  affects: [src/change-detector/ast-parser.ts, src/language-config.ts, src/db/repository.ts]
tech_stack:
  added: []
  patterns:
    - callerStack push/pop in single-pass visitNode walk
    - local-first resolution (conf 1.0) → imported unambiguous (conf 0.8) → silent discard
    - caller-side DELETE before symbols DELETE (FLAG-02 fix: old IDs queryable at clear time)
    - prepared-statement reuse outside per-edge loop (D-17)
    - single batch DB query chunked at 500 (D-32)
    - BARREL_RE discard for /index.(ts|tsx|js|mjs|cjs|jsx)$ targets
    - Pitfall 10 ambiguousNames Set for cross-specifier disambiguation
key_files:
  created:
    - src/change-detector/ast-parser.call-sites.test.ts
    - src/language-config.call-sites.test.ts
    - src/db/repository.call-sites.test.ts
  modified:
    - src/change-detector/types.ts
    - src/change-detector/ast-parser.ts
    - src/language-config.ts
    - src/db/repository.ts
decisions:
  - "callerStack push/pop placement: inside visitNode before existing if/else chain; pop after child-recursion loop (Landmine G — no early return)"
  - "export_statement callerStartLine uses export_statement.startPosition.row+1 NOT inner declaration (Pitfall A alignment with extractExportedSymbol positionSource)"
  - "FLAG-02 fix: caller-side DELETE from symbol_dependencies runs BEFORE symbols DELETE+INSERT so old symbol IDs are still queryable in the subquery"
  - "callSiteEdges empty array = caller-side clear without inserts (stale edges cleaned on rescan yielding zero resolvable calls)"
  - "callSiteEdges undefined = complete no-op (backward compat with Phase 36 callers)"
  - "lexical_declaration (const foo = () => {}): push only for first declarator with arrow_function/function_expression RHS (Landmine A)"
metrics:
  duration_minutes: 68
  completed_date: "2026-04-24"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 4
  tests_added: 43
  tests_passing: 111
---

# Phase 37 Plan 01: TS/JS Call-Site Edge Extraction — Extraction + Atomic Write Summary

**One-liner:** Single-pass callerStack + callSiteCandidates extraction in ast-parser, local-first/imported/discard resolution in language-config with single batch DB query, and caller-side DELETE-before-symbols-DELETE write in repository (FLAG-02 resolved by ordering not geometry).

## What Was Built

### Task 1: Types + AST extraction (CSE-02)
- Added `CallSiteCandidate` and `CallSiteEdge` interfaces to `src/change-detector/types.ts` — pre- and post-resolution shapes per D-03/D-04. `ExportedSymbol` untouched (D-05).
- Extended `RicherEdgeData` with `callSiteCandidates: CallSiteCandidate[]` field.
- Added `callerStack: Array<{name, startLine}>` and `callSiteCandidates: CallSiteCandidate[]` accumulators inside `extractRicherEdges()`.
- `callerStack` pushes on entering top-level `function_declaration`, `generator_function_declaration`, `class_declaration`, `lexical_declaration` (const + arrow_function RHS), and `export_statement` wrapping function/class. Pops after child-recursion (Landmine G — no early return pattern preserved).
- `export_statement` callerStartLine uses `export_statement.startPosition.row + 1` (not the inner declaration's row) — aligned with `extractExportedSymbol`'s `positionSource` convention (Pitfall A).
- Emits `CallSiteCandidate` for bare `identifier` callees inside tracked callers; silently discards `member_expression`, `subscript_expression`, `require`, `import`.
- Single-pass invariant preserved: `parser.parse()` count in `ast-parser.ts` = 2 (unchanged from pre-Phase-37; `extractRicherEdges` has 1, `extractSnapshot` has 1).
- **Test file:** `src/change-detector/ast-parser.call-sites.test.ts` — 21 tests (CSE-02 coverage).

### Task 2: Resolution pass (CSE-03)
- Extended `extractTsJsFileParse()` return type to include `callSiteEdges: CallSiteEdge[]`.
- Added `CallSiteEdge` type import from `./change-detector/types.js`.
- Resolution pass after edges loop:
  - `localSymbolIndex`: built from `richer.symbols` — first-match-wins on name collision.
  - `specToTargetPath`: reuses already-resolved `edges[]` to avoid re-running `resolveTsJsImport` (Item 6 caching).
  - `BARREL_RE`: `/[\\/]index\.(ts|tsx|js|mjs|cjs|jsx)$/` — silently discards barrel targets (Pitfall 11).
  - `targetPathsSet`: collects unique non-barrel target paths from importMeta.
  - Batch DB query: single `SELECT id, name, path FROM symbols WHERE path IN (...)` chunked at 500 per `getFilesByPaths` precedent (D-32).
  - `importedSymbolIndex`: built with Pitfall 10 ambiguity defense — `ambiguousNames` Set removes names found in multiple specifiers' results.
  - Resolution order: local (conf 1.0) → imported unambiguous (conf 0.8) → silent discard.
- **Test file:** `src/language-config.call-sites.test.ts` — 12 tests (CSE-03 coverage including local, imported, Pitfall 10, Pitfall 11, self-loop, unresolvable discard, batch query correctness).

### Task 3: DB write extension (CSE-04)
- Extended `setEdgesAndSymbols()` signature with optional `callSiteEdges?: CallSiteEdge[]` fifth parameter.
- **Critical ordering fix (FLAG-02 deviation from plan):** The caller-side DELETE from `symbol_dependencies` runs BEFORE the `DELETE FROM symbols` step, not after. This ensures the subquery `IN (SELECT id FROM symbols WHERE path = ?)` finds the OLD symbol IDs (still present at clear time) — matching the stale rows in `symbol_dependencies`. If DELETE ran after the symbols re-insert (as the plan sketch showed), the subquery would return the NEW IDs which don't match the old rows, leaving stale edges.
- After the symbols DELETE+INSERT: per-edge INSERT using fresh IDs via `callerLookup`/`calleeLookup`/`edgeInsert` prepared statements (created once outside the loop, D-17).
- Backward compat: `callSiteEdges === undefined` → entire block skipped (Phase 36 callers unchanged).
- Empty array: caller-side clear runs but no inserts (cleans stale edges from rescan with zero resolvable calls).
- Silent discard on caller or callee lookup miss (no INSERT for that edge).
- Self-loops stored: `caller_symbol_id == callee_symbol_id` when `calleePath == sourcePath` and `calleeName == callerName` (D-14).
- **Test file:** `src/db/repository.call-sites.test.ts` — 10 tests (CSE-04 coverage).

## Test Coverage

| Describe block | File | Requirement |
|---|---|---|
| `extractRicherEdges — callSiteCandidates emission (CSE-02)` | `ast-parser.call-sites.test.ts` | CSE-02 |
| `extractRicherEdges — callerStack frame shape` | `ast-parser.call-sites.test.ts` | CSE-02 |
| `extractTsJsFileParse — call-site resolution (CSE-03)` | `language-config.call-sites.test.ts` | CSE-03 |
| `extractTsJsFileParse — importedSymbolIndex batch query` | `language-config.call-sites.test.ts` | CSE-03 |
| `setEdgesAndSymbols — callSiteEdges optional param (CSE-04)` | `repository.call-sites.test.ts` | CSE-04 |
| `setEdgesAndSymbols — caller-side clear semantics` | `repository.call-sites.test.ts` | CSE-04 |
| `setEdgesAndSymbols — silent-discard on lookup miss` | `repository.call-sites.test.ts` | CSE-04 |
| `setEdgesAndSymbols — self-loop storage (D-14)` | `repository.call-sites.test.ts` | CSE-04 |

**Tests added this plan:** 43 (21 + 12 + 10)
**Total tests at plan completion:** 811+ passing

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Caller-side DELETE ordering (FLAG-02 real fix)**
- **Found during:** Task 3, Test 5 (fresh caller IDs from same txn)
- **Issue:** The plan's Action item 2 said to run `DELETE FROM symbol_dependencies WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE path = ?)` AFTER the symbols INSERT. This is wrong: after symbols are DELETEd+INSERTed, the subquery returns the NEW IDs. The stale `symbol_dependencies` rows have OLD IDs. The DELETE would silently match nothing, leaving stale edges.
- **Fix:** Moved the `symbol_dependencies` DELETE to run BEFORE `DELETE FROM symbols`, while the old symbol IDs are still in the table. The `SELECT id FROM symbols WHERE path = ?` subquery then correctly returns the OLD IDs that match the stale rows.
- **Files modified:** `src/db/repository.ts`
- **Commit:** 590065c (replaces the originally-incorrect ordering described in the plan sketch)

## Known Stubs

None — all data flows are wired. `callSiteEdges` is returned from `extractTsJsFileParse` and accepted by `setEdgesAndSymbols`. Coordinator callers are not yet updated to pass `callSiteEdges` (that is Plan 37-02's scope: bulk backfill + watcher lifecycle).

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced. All changes are internal DB-local writes (T-37-01 accepted per plan threat model).

## Self-Check: PASSED

| Check | Result |
|---|---|
| `src/change-detector/types.ts` exists | FOUND |
| `src/change-detector/ast-parser.ts` exists | FOUND |
| `src/change-detector/ast-parser.call-sites.test.ts` exists | FOUND |
| `src/language-config.ts` exists | FOUND |
| `src/language-config.call-sites.test.ts` exists | FOUND |
| `src/db/repository.ts` exists | FOUND |
| `src/db/repository.call-sites.test.ts` exists | FOUND |
| Commit b4e816e exists | FOUND |
| Commit 59b6546 exists | FOUND |
| Commit 590065c exists | FOUND |
| `parser.parse(` count in ast-parser.ts = 2 (unchanged) | PASS |
| `describe.*callSiteCandidates emission` in ast-parser.call-sites.test.ts | FOUND |
| `describe.*callerStack frame shape` in ast-parser.call-sites.test.ts | FOUND |
| `describe.*call-site resolution (CSE-03)` in language-config.call-sites.test.ts | FOUND |
| `describe.*callSiteEdges optional param (CSE-04)` in repository.call-sites.test.ts | FOUND |
| `SELECT COUNT(*)` in repository.call-sites.test.ts ≥ 3 | 4 (PASS) |
| `npm run build` exits 0 | PASS |
| All new tests pass (43 tests) | PASS |
| No regressions in existing tests | PASS (pre-existing flaky timeout in parsers.test.ts unrelated to Phase 37) |
