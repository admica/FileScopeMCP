---
phase: 14-mtime-based-lazy-validation
plan: 01
subsystem: performance
tags: [mtime, lazy-validation, integrity-sweep, mcp-handlers, sqlite]

# Dependency graph
requires:
  - phase: 13-streaming-directory-scan
    provides: SQLite-backed file storage with mtime column, reconstructTreeFromDb bridge
provides:
  - Startup-only integrity sweep (no polling)
  - Per-file mtime lazy validation via checkFileFreshness()
  - Stale flag injection in 3 MCP tool handlers
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy mtime validation: synchronous stat + DB mtime comparison on MCP access"
    - "Stale flag pattern: ...(isStale && { stale: true }) conditional spread"

key-files:
  created: []
  modified:
    - src/coordinator.ts
    - src/mcp-server.ts
    - src/coordinator.test.ts

key-decisions:
  - "checkFileFreshness is a public synchronous method on ServerCoordinator — uses fsSync.statSync for hot-path performance"
  - "markSelfStale (not cascadeStale) used for lazy mtime detection — lazy check does not know if API surface changed"
  - "stale field is absent (not false) when file is fresh — keeps response size minimal"
  - "read_file_content wraps response in object only when stale — preserves backward compatibility for non-stale responses"

patterns-established:
  - "Lazy mtime validation: per-file stat on MCP read access, stale flag in response"
  - "Startup sweep: blocking integrityCheck before _initialized = true, no mutex needed"

requirements-completed: [PERF-03]

# Metrics
duration: 4min
completed: 2026-03-20
---

# Phase 14 Plan 01: mtime-Based Lazy Validation Summary

**Eliminated 30-second polling integrity sweep, replaced with startup-only full sweep and per-file mtime lazy validation on MCP tool access**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-20T03:32:52Z
- **Completed:** 2026-03-20T03:36:49Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Removed the setInterval-based integrity sweep that polled all files every 30 seconds (PERF-03)
- Added one-time startup integrity sweep that blocks init() to detect files added/deleted/modified while server was down
- Added public checkFileFreshness() method for synchronous per-file mtime validation on MCP access
- Instrumented 3 file-specific MCP read handlers (get_file_summary, get_file_importance, read_file_content) with stale flag injection
- Added 5 new tests covering freshness check and startup sweep behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace polling integrity sweep with startup sweep and per-file mtime check** - `735f90f` (test: RED), `a80e57f` (feat: GREEN)
2. **Task 2: Wire checkFileFreshness into file-specific MCP tool handlers** - `a119965` (feat)

_Note: Task 1 followed TDD with separate RED and GREEN commits_

## Files Created/Modified
- `src/coordinator.ts` - Removed startIntegritySweep/integritySweepInterval/INTEGRITY_SWEEP_INTERVAL_MS, added runStartupIntegritySweep() and checkFileFreshness()
- `src/mcp-server.ts` - Added stale flag to get_file_importance, get_file_summary, read_file_content handlers
- `src/coordinator.test.ts` - Added 5 new tests in describe('checkFileFreshness') block

## Decisions Made
- Used `markSelfStale` (not `cascadeStale`) for lazy mtime detection because the lazy check only knows the file changed, not how it changed
- `stale` field is conditionally spread (`...(isStale && { stale: true })`) so it is absent rather than false when fresh
- `read_file_content` returns raw string when fresh (backward compatible) but wraps in `{ content, stale: true }` object when stale
- Write tools (set_file_summary, set_file_importance) and tree-wide tools (find_important_files, list_files) do not get mtime checks per locked decisions

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- PERF-03 requirement fully addressed
- Zero new npm dependencies added
- All 232 tests pass across 13 test files
- TypeScript compiles cleanly with no errors

## Self-Check: PASSED

- All 3 modified files exist on disk
- All 3 task commits found in git log (735f90f, a80e57f, a119965)

---
*Phase: 14-mtime-based-lazy-validation*
*Completed: 2026-03-20*
