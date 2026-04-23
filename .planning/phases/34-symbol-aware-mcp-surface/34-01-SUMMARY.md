---
phase: 34-symbol-aware-mcp-surface
plan: 01
subsystem: database
tags: [sqlite, better-sqlite3, glob, typescript, symbols, repository, vitest]

# Dependency graph
requires:
  - phase: 33-symbol-extraction-foundation
    provides: "symbols table, file_dependencies.imported_names + import_line columns, setEdgesAndSymbols writer, SymbolKind/Symbol types, rowToSymbol helper"
provides:
  - "findSymbols(opts) helper in src/db/repository.ts — GLOB prefix-match with dual-statement COUNT+LIMIT"
  - "getDependentsWithImports(targetPath) helper in src/db/repository.ts — Map-based aggregation with null-safe JSON parse"
  - "Private helpers escapeGlobMeta() + buildNamePredicate() — bracket-escape GLOB metachars, exact-vs-prefix predicate builder"
  - "18 new unit tests in src/db/repository.symbols.test.ts covering both helpers"
affects:
  - "34-02 (MCP surface wiring — find_symbol registration and get_file_summary enrichment consume both new helpers)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SQLite GLOB with bracket-escape for case-sensitive prefix matching (new to this codebase)"
    - "Dual-statement COUNT + LIMIT on same better-sqlite3 connection for pre-truncation total"
    - "Map<key, {Set, Array}> JS-level group-by-key aggregation with alphabetical/ascending sort"

key-files:
  created: []
  modified:
    - "src/db/repository.ts — +133 lines (two exported helpers + two private helpers)"
    - "src/db/repository.symbols.test.ts — +199 lines (two describe blocks, 18 it-blocks, insertDepRow helper)"

key-decisions:
  - "Inlined getDependentsWithImports return type (no new DependentWithImports interface in symbol-types.ts) — single call site, promote only if a second consumer emerges"
  - "Added private insertDepRow() test helper rather than extending setEdges() — setEdges() lacks fine-grained control over NULL imported_names and package_import rows which the test matrix requires"
  - "Kept getSymbolsByName signature and getDependents signature untouched — phase-33 tests pin them, FileNode.dependents: string[] consumer path preserved"

patterns-established:
  - "GLOB with bracket-escape: function escapeGlobMeta(s) { return s.replace(/([*?\\[])/g, '[$1]'); } — case-sensitive prefix/exact matching without PRAGMA"
  - "Dual-query pagination pattern: one SELECT COUNT + one SELECT LIMIT sharing identical WHERE, applied against same getSqlite() connection"
  - "Null-safe JSON.parse with [] fallback (mirrors getExportsSnapshot:488 try/catch semantics)"

requirements-completed:
  - FIND-01
  - FIND-02
  - FIND-03
  - FIND-04
  - SUM-02
  - SUM-04

# Metrics
duration: 7min
completed: 2026-04-23
---

# Phase 34 Plan 01: Symbol-Aware MCP Repository Helpers Summary

**Added two read-only repository helpers (findSymbols + getDependentsWithImports) plus 18 unit tests, backing find_symbol tool and get_file_summary dependents enrichment without touching phase-33 primitives.**

## Performance

- **Duration:** ~7 minutes
- **Started:** 2026-04-23T22:13:18Z
- **Completed:** 2026-04-23T22:20:00Z
- **Tasks:** 3 completed
- **Files modified:** 2

## Accomplishments

- Added `findSymbols(opts)` with GLOB-based case-sensitive prefix matching, dual-statement COUNT + LIMIT pattern, and deterministic ordering (is_export DESC, path ASC, start_line ASC)
- Added `getDependentsWithImports(targetPath)` aggregating file_dependencies rows per source_path with deduped imported names and ascending import lines, filtering to local_import only
- Added private helpers `escapeGlobMeta()` and `buildNamePredicate()` — bracket-escape GLOB metachars per D-01, switch between `name = ?` exact and `name GLOB ?` prefix predicates
- Extended `src/db/repository.symbols.test.ts` with 10 findSymbols it-blocks and 8 getDependentsWithImports it-blocks (18 new, 36 total passing)
- Phase-33 primitives preserved: `getSymbolsByName` signature unchanged, `getDependents` signature unchanged, no new exported interface in symbol-types.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Add findSymbols helper + private GLOB escape helpers** — `09eef26` (feat)
2. **Task 2: Add getDependentsWithImports helper** — `6273a1d` (feat)
3. **Task 3: Extend repository.symbols.test.ts with 18 new tests** — `9c3602e` (test)

## Files Created/Modified

- `src/db/repository.ts` — Added `findSymbols`, `getDependentsWithImports`, `escapeGlobMeta`, `buildNamePredicate` (+133 lines). Phase-33 helpers (`getSymbolsByName`, `getSymbolsForFile`, `deleteSymbolsForFile`, `getDependents`) left intact.
- `src/db/repository.symbols.test.ts` — Added `findSymbols` import, `getDependentsWithImports` import, `insertDepRow()` helper, `describe('findSymbols …')` block (10 it-blocks), `describe('getDependentsWithImports …')` block (8 it-blocks) (+199 lines).

## Decisions Made

- **Inlined getDependentsWithImports return type** — per RESEARCH §Files the Planner Will Touch Open Question 2, single call site means no exported DependentWithImports interface needed; promotion to symbol-types.ts deferred until a second consumer emerges.
- **insertDepRow() test helper** — `setEdges()` writes via its own code path that pulls imported_names/import_line from ImportMeta; the test matrix requires rows with NULL imported_names (non-TS/JS case), NULL import_line (edge case), and package_import type — all three conflict with setEdges()'s contract. Direct INSERT via getSqlite().prepare() is the precedent used by the existing `setEdges — imported_names` tests at lines 154-206, so the pattern is in-repo already.
- **Path-ascending default for same-export tests** — in the "prefix match returns all names with the prefix" test, all three seeded symbols share `isExport=true` (makeSymbol default), so ordering falls through to `path ASC` — the test asserts paths, not names, to lock the documented sort order.

## Deviations from Plan

None — plan executed exactly as written.

All three tasks landed verbatim per their `<action>` blocks, with the specified file anchors preserved:
- Task 1 code inserted between `getSymbolsByName` (unchanged) and `getSymbolsForFile` (unchanged)
- Task 2 code inserted between `getDependents` (unchanged) and `getAllLocalImportEdges` (unchanged)
- Task 3 describes appended after the last existing describe block

No Rule 1/2/3 auto-fixes required. No Rule 4 architectural decisions surfaced.

## Issues Encountered

- **Pre-existing test failures (out of scope)** — Two tests fail in the full `npx vitest run` that do NOT relate to Plan 01 scope:
  1. `tests/unit/parsers.test.ts` "very large file does not crash (10K lines)" — timed out at 5000ms. Verified pre-existing via `git stash && npx vitest run`.
  2. `tests/integration/mcp-stdout.test.ts` "first byte of mcp-server.js stdout is { (ASCII 0x7B)". Verified pre-existing.
  Both logged to `.planning/phases/34-symbol-aware-mcp-surface/deferred-items.md` per the SCOPE BOUNDARY rule. Neither involves `src/db/repository.ts` or `src/db/repository.symbols.test.ts`; Plan 01's target file passes 36/36.

## User Setup Required

None — no external service configuration required.

## Self-Check: PASSED

Verified files exist:
- FOUND: src/db/repository.ts (contains findSymbols, getDependentsWithImports, escapeGlobMeta, buildNamePredicate)
- FOUND: src/db/repository.symbols.test.ts (contains describe('findSymbols …') + describe('getDependentsWithImports …'))

Verified commits exist:
- FOUND: 09eef26 (Task 1 — findSymbols + helpers)
- FOUND: 6273a1d (Task 2 — getDependentsWithImports)
- FOUND: 9c3602e (Task 3 — 18 new tests)

Verified test pass:
- FOUND: 36/36 tests passing in src/db/repository.symbols.test.ts (18 pre-existing + 18 new)

Verified build clean:
- FOUND: npm run build exits 0, npx tsc --noEmit exits 0

## Next Phase Readiness

**Plan 02 (MCP surface wiring) is unblocked.** Both repository helpers are exported with the exact signatures declared in Plan 01 `<interfaces>`:

- `findSymbols({name, kind?, exportedOnly, limit}): { items, total }` — ready to back `find_symbol` MCP tool handler (FIND-01..04).
- `getDependentsWithImports(targetPath): Array<{path, importedNames, importLines}>` — ready to back `get_file_summary.dependents[]` enrichment (SUM-02/SUM-04).

Plan 02 can proceed with MCP registration and handler-level argument normalization (Zod schema, maxItems clamp, truncated envelope) without further repository-layer changes.

---
*Phase: 34-symbol-aware-mcp-surface*
*Completed: 2026-04-23*
