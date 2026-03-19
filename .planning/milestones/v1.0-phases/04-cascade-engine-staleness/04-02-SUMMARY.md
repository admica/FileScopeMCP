---
phase: 04-cascade-engine-staleness
plan: 02
subsystem: database
tags: [sqlite, staleness, mcp, repository, better-sqlite3, tdd]

# Dependency graph
requires:
  - phase: 04-cascade-engine-staleness
    plan: 01
    provides: markStale() sets staleness columns; staleness columns exist in schema
provides:
  - getStaleness() repository function for reading all three staleness columns per file
  - Staleness fields injected into get_file_importance, find_important_files, and get_file_summary MCP tool responses
  - Backward-compatible spread pattern: fields present only when non-null
affects: [05-llm-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Conditional spread for backward-compatible field injection: ...(val !== null && { key: val })
    - getStaleness uses raw better-sqlite3 prepared statement — same pattern as getExportsSnapshot

key-files:
  created:
    - src/mcp-server.test.ts
  modified:
    - src/db/repository.ts
    - src/mcp-server.ts

key-decisions:
  - "getStaleness uses raw better-sqlite3 prepared statement (not Drizzle) — consistent with getExportsSnapshot pattern for direct column reads without full row hydration"
  - "MCP staleness injection uses conditional spread so null fields are always omitted — no API contract change for fresh files (CASC-03 backward compat)"
  - "get_file_summary injects all three staleness fields (not just summaryStale) — LLMs see the full picture from any query"

patterns-established:
  - "Staleness injection pattern: getStaleness(path) → conditional spread into response object for each non-null field"

requirements-completed: [CASC-03]

# Metrics
duration: 7min
completed: 2026-03-18
---

# Phase 4 Plan 2: MCP Staleness Response Injection Summary

**getStaleness() repository function plus backward-compatible staleness field injection into get_file_importance, find_important_files, and get_file_summary MCP tool handlers**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-03-18T04:06:28Z
- **Completed:** 2026-03-18T04:13:00Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments

- Implemented `getStaleness(filePath)` in repository.ts: reads all three staleness columns from DB via raw prepared statement; returns camelCase object with null for fresh/missing files
- Augmented `get_file_importance` handler: spreads all three stale fields when non-null
- Augmented `find_important_files` handler: each file entry in the array gets staleness fields spread in
- Augmented `get_file_summary` handler: injects all three staleness fields when non-null
- Created `src/mcp-server.test.ts` with 8 tests: 4 covering getStaleness directly, 4 covering the response injection shape contract
- Full test suite: 157 tests pass; build clean

## Task Commits

Each task was committed atomically:

1. **Task 1: getStaleness function + MCP response injection** - `541f6bf` (feat)

## Files Created/Modified

- `src/db/repository.ts` - Added getStaleness() function (raw prepared statement, exports camelCase result)
- `src/mcp-server.ts` - Imported getStaleness; injected staleness fields in get_file_importance, find_important_files, and get_file_summary handlers
- `src/mcp-server.test.ts` - 8 tests for getStaleness and response shape injection

## Decisions Made

- Used raw `better-sqlite3` prepared statement in `getStaleness()` — consistent with `getExportsSnapshot` pattern, avoids Drizzle overhead for a simple direct column read
- Spread all three staleness fields in `get_file_summary` (not just `summaryStale`) — LLMs seeing the file summary also benefit from knowing whether concepts/change_impact assessments are stale
- Conditional spread pattern `...(val !== null && { key: val })` — omits null fields, no change for callers that don't know about staleness

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CASC-03 fulfilled: LLMs can now see staleness timestamps inline with file metadata queries
- Phase 5 (LLM Pipeline) can read staleness fields from all three MCP query responses to decide whether to trust metadata
- `getStaleness()` is also available for Phase 5 to programmatically check staleness before scheduling regeneration

## Self-Check: PASSED

---
*Phase: 04-cascade-engine-staleness*
*Completed: 2026-03-18*
