---
phase: 15-cycle-detection
plan: 02
subsystem: api
tags: [mcp, cycle-detection, tarjan, sqlite, typescript]

# Dependency graph
requires:
  - phase: 15-01
    provides: detectCycles function, buildAdjacencyList, iterativeTarjanSCC in cycle-detection.ts, and getAllLocalImportEdges in repository.ts
provides:
  - detect_cycles MCP tool: returns all circular dependency groups with totalCycles and totalFilesInCycles counts
  - get_cycles_for_file MCP tool: returns cycle groups containing a specified file, with file-not-found error handling
affects: [future MCP consumers needing cycle data, any phase that extends mcp-server.ts]

# Tech tracking
tech-stack:
  added: []
  patterns: [tool-registration-pattern: server.tool with zod schema, isInitialized guard, createMcpResponse wrapping]

key-files:
  created: []
  modified:
    - src/mcp-server.ts

key-decisions:
  - "No caching between tool calls — both detect_cycles and get_cycles_for_file independently call getAllLocalImportEdges() and detectCycles() on every invocation per CONTEXT.md locked decision"
  - "detect_cycles has empty {} parameter schema — no input required"
  - "get_cycles_for_file uses normalizePath() then getFile() check before running cycle detection, matching established file-specific tool pattern"

patterns-established:
  - "Cycle tools placed at end of registerTools() following same coordinator.isInitialized() guard and createMcpResponse wrapping pattern as all other tools"

requirements-completed: [CYCL-02]

# Metrics
duration: 1min
completed: 2026-03-20
---

# Phase 15 Plan 02: Cycle Detection MCP Tools Summary

**Two read-only MCP tools wired into mcp-server.ts exposing Tarjan's SCC cycle detection via `detect_cycles` (all groups) and `get_cycles_for_file` (file-filtered groups), both backed by fresh SQLite edge loading on every call.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-20T06:59:28Z
- **Completed:** 2026-03-20T07:00:43Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Registered `detect_cycles` MCP tool: loads all local import edges from SQLite, runs Tarjan's SCC, returns `{ cycles, totalCycles, totalFilesInCycles }`
- Registered `get_cycles_for_file` MCP tool: validates file existence via `getFile()`, filters cycle groups to those containing the normalized path, returns same response shape
- Added `getAllLocalImportEdges` to the repository import block and `detectCycles` as a new import from `./cycle-detection.js`
- All 250 existing tests continue to pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Register detect_cycles and get_cycles_for_file MCP tools** - `8250b51` (feat)

**Plan metadata:** (docs: complete plan — see final commit)

## Files Created/Modified
- `src/mcp-server.ts` - Added two new tool registrations, two new imports (getAllLocalImportEdges, detectCycles)

## Decisions Made
None beyond locked decisions already recorded in CONTEXT.md and STATE.md — plan executed exactly as specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 15 (cycle-detection) is now fully complete: cycle-detection.ts (Plan 01) + MCP tool registrations (Plan 02)
- `detect_cycles` and `get_cycles_for_file` are immediately callable by MCP clients
- No blockers for subsequent phases

---
*Phase: 15-cycle-detection*
*Completed: 2026-03-20*
