---
phase: 28-mcp-polish
plan: 02
subsystem: mcp-tools
tags: [mcp, list_files, find_important_files, maxItems, truncation, token-budget]

# Dependency graph
requires:
  - phase: 28-mcp-polish
    plan: 01
    provides: enriched get_file_summary (this plan is in the same wave; no direct dependency)
provides:
  - list_files dual-mode: tree (no maxItems) or flat list sorted by importance (with maxItems)
  - find_important_files maxItems parameter replacing limit, with truncation metadata
affects: [any MCP client calling find_important_files with limit parameter (breaking rename)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Conditional spread for truncation metadata: ...(isTruncated && { truncated: true })
    - Dual-mode tool handler: parameter presence determines response shape

key-files:
  created: []
  modified:
    - src/mcp-server.ts
    - src/mcp-server.test.ts

key-decisions:
  - "Rename limit to maxItems in find_important_files — breaking change, but no legacy installs to support per project memory"
  - "list_files dual-mode: undefined maxItems returns tree (COMPAT-01 preserved), any number activates flat list"
  - "Truncation metadata uses conditional spread so fields are absent (not null) when not truncated — clean JSON"
  - "Flat list items include hasSummary but NOT dependentCount/dependencyCount (lighter payload than find_important_files)"

# Metrics
duration: 9min
completed: 2026-04-09
---

# Phase 28 Plan 02: MCP Polish - maxItems Token Budget Parameter Summary

**maxItems parameter added to list_files (dual-mode tree/flat) and find_important_files (renamed from limit), with truncated/totalCount metadata when results are capped**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-09T22:16:00Z
- **Completed:** 2026-04-09T22:25:50Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Modified `find_important_files` to replace `limit` parameter with `maxItems`, computing `isTruncated` before slicing and returning `{files, truncated?, totalCount?}` shape
- Modified `list_files` from a no-parameter handler to a parameterized dual-mode handler: omitting `maxItems` returns the full file tree (existing behavior); providing `maxItems` returns a flat list sorted by importance descending with truncation metadata
- Flat list items include `path`, `importance`, `hasSummary`, and staleness fields (lighter than find_important_files which also includes dependentCount/dependencyCount)
- Added 5 new tests across 2 describe blocks covering truncation, no-truncation, ordering, and hasSummary field presence
- TypeScript compiles clean (exit 0)

## Task Commits

Each task was committed atomically:

1. **Task 1: Modify find_important_files to use maxItems with truncation metadata** - `db11ce4` (feat)
2. **Task 2: Add maxItems parameter to list_files with dual-mode behavior** - `b0126c4` (feat)

## Files Created/Modified

- `src/mcp-server.ts` — find_important_files: replaced limit with maxItems, added isTruncated logic, changed return shape to {files, truncated?, totalCount?}; list_files: changed from no-param to parameterized form with dual-mode logic
- `src/mcp-server.test.ts` — Added `list_files maxItems dual mode` describe block (3 tests) and `find_important_files maxItems truncation` describe block (2 tests)

## Decisions Made

- Renamed `limit` to `maxItems` in find_important_files — breaking API change, but the project memory confirms zero legacy installs so no backward compatibility concern
- list_files dual-mode pivot on `params.maxItems === undefined` preserves exact existing tree behavior for the no-parameter case (COMPAT-01 satisfied)
- Truncation metadata uses conditional spread `...(isTruncated && { ... })` so `truncated` and `totalCount` are completely absent from the JSON when not needed, not set to null or false
- Flat list for list_files omits `dependentCount`/`dependencyCount` (those are find_important_files-specific) to keep list_files payload lighter

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None.

## Next Phase Readiness

- Both tools now support token-budget capping for LLM callers working with large codebases
- MCP clients using `find_important_files` with `limit` parameter will need to update to `maxItems`
- All 21 tests pass, TypeScript compiles clean

---
*Phase: 28-mcp-polish*
*Completed: 2026-04-09*

## Self-Check: PASSED

- FOUND: src/mcp-server.ts (modified)
- FOUND: src/mcp-server.test.ts (modified)
- FOUND commit: db11ce4 (Task 1 - find_important_files maxItems)
- FOUND commit: b0126c4 (Task 2 - list_files dual-mode)
- FOUND: maxItems in both list_files and find_important_files handlers
- FOUND: isTruncated conditional spread pattern in both handlers
- FOUND: getFileTree() call preserved in list_files tree mode
- FOUND: describe('list_files maxItems dual mode') in test file
- FOUND: describe('find_important_files maxItems truncation') in test file
- All 21 tests pass
- TypeScript compiles clean
