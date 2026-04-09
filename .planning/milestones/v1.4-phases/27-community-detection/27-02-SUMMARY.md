---
phase: 27-community-detection
plan: "02"
subsystem: api
tags: [mcp, louvain, community-detection, dirty-flag, cache-invalidation, graphology]

# Dependency graph
requires:
  - phase: 27-community-detection-01
    provides: detectCommunities() function, CommunityResult interface, community repository CRUD, dirty flag functions
provides:
  - get_communities MCP tool with lazy Louvain recomputation on dirty flag
  - Optional file_path parameter for single-community lookup
  - Representative-based community identification (no integer IDs exposed)
  - Empty graph handled gracefully (empty list, not error)
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Lazy computation pattern: check dirty flag before running expensive algorithm
    - Order-sensitive cache flush: setCommunities -> clearCommunitiesDirty -> getCommunities

key-files:
  created: []
  modified:
    - src/mcp-server.ts

key-decisions:
  - "Order: setCommunities() then clearCommunitiesDirty() then read — reading before clearing would cause infinite recompute (Pitfall 6)"
  - "Empty edges clears dirty flag and returns empty list — no Louvain call needed, no error"
  - "communityId not exposed in MCP response per D-14 — representative path is the public identifier"

patterns-established:
  - "Pattern: lazy dirty-flag cache invalidation before running expensive algorithm in MCP handler"
  - "Pattern: setCommunities -> clearCommunitiesDirty -> read (never read before clearing)"

requirements-completed: [COMM-02, COMM-03]

# Metrics
duration: 10min
completed: 2026-04-09
---

# Phase 27 Plan 02: Community Detection MCP Tool Summary

**get_communities MCP tool with lazy Louvain recomputation via dirty-flag check, optional file_path filtering, and representative-path community identification**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-09T15:00:00Z
- **Completed:** 2026-04-09T15:10:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Registered `get_communities` tool in `src/mcp-server.ts` that orchestrates dirty-flag checking, Louvain recomputation, SQLite persistence, and cached reads
- Lazy computation: Louvain only runs when `isCommunitiesDirty()` returns true (D-11, D-12) — no startup cost
- Optional `file_path` parameter returns the single community containing that file via `getCommunityForFile()`
- Without `file_path`, returns all communities sorted by size descending with representative file paths
- Empty edge graph handled gracefully: dirty flag cleared, empty `{ communities: [], totalCommunities: 0 }` returned (no error, no Louvain call)
- All 7 community repository functions imported and wired correctly; `communityId` integer not exposed per D-14

## Task Commits

Each task was committed atomically:

1. **Task 1: Register get_communities MCP tool with dirty-flag orchestration** - `d64e020` (feat)

## Files Created/Modified
- `src/mcp-server.ts` - Added 6 repository imports + `detectCommunities` import + `get_communities` tool (57 lines added)

## Decisions Made
- Followed plan exactly: setCommunities() -> clearCommunitiesDirty() -> read, never reversed (Pitfall 6 guard)
- `communityId` is used internally in `getCommunityForFile()` return value but never surfaced in `createMcpResponse()` calls per D-14
- Empty edge case returns `{ communities: [], totalCommunities: 0 }` for the no-file_path path — consistent shape with the populated case

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed npm dependencies missing from worktree**
- **Found during:** Task 1 (TypeScript compilation verification)
- **Issue:** The worktree had no `node_modules/` directory. `npx tsc --noEmit` reported `Cannot find module 'graphology'` and `'graphology-communities-louvain'`. These are listed in `package.json` (added in Plan 01) but not installed in the worktree's isolated environment.
- **Fix:** Ran `npm install --prefer-offline` in the worktree directory. 467 packages installed.
- **Files modified:** None (node_modules is not tracked in git)
- **Verification:** `npx tsc --noEmit` exits 0 with no errors; `npm run build` succeeds.
- **Committed in:** N/A (node_modules not committed)

---

**Total deviations:** 1 auto-fixed (1 blocking environment setup)
**Impact on plan:** Required for TypeScript compilation to succeed. No scope creep.

## Issues Encountered
- Worktree had no `node_modules/` — required `npm install` before TypeScript compilation could be verified. This is expected for new worktrees and does not reflect any code issue.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 27 complete: `detectCommunities()`, repository CRUD, dirty flag, and `get_communities` MCP tool are all ready
- The `get_communities` MCP tool is callable via Claude Code for any initialized project
- No blockers for subsequent phases

---
*Phase: 27-community-detection*
*Completed: 2026-04-09*
