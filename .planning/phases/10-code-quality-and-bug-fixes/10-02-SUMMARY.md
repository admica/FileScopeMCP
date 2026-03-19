---
phase: 10-code-quality-and-bug-fixes
plan: 02
subsystem: core
tags: [path-normalization, importance-scoring, bfs, refactoring, typescript]

# Dependency graph
requires:
  - phase: 10-01
    provides: dead-code removal and backoff stability fixes that clean up the codebase before this refactor
provides:
  - canonicalizePath as single unified path normalization function in file-utils.ts
  - Transitive importance propagation via BFS with cycle protection in recalculateImportanceForAffected
affects: [all phases using path normalization, file-utils.ts callers, importance scoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "canonicalizePath(filepath, baseDir?) — cosmetic-only when no baseDir, resolves when baseDir provided"
    - "BFS traversal with visited Set for cycle-safe graph propagation"
    - "Re-export aliases for backward compatibility (normalizePath, normalizeAndResolvePath)"

key-files:
  created: []
  modified:
    - src/file-utils.ts
    - src/storage-utils.ts
    - src/mcp-server.ts
    - src/coordinator.ts
    - src/file-utils.test.ts

key-decisions:
  - "canonicalizePath lives in file-utils.ts; storage-utils.ts re-exports it (not the other way) — eliminates the circular dependency that existed when file-utils.ts imported saveFileTree from storage-utils.ts"
  - "saveFileTree import in file-utils.ts was unused — removed to break the circular dependency chain"
  - "normalizePath and normalizeAndResolvePath kept as deprecated re-export aliases for backward compatibility"
  - "BFS with visited set chosen over recursive DFS to avoid stack overflow on deep dependency chains"

patterns-established:
  - "Path normalization: always use canonicalizePath; pass baseDir when resolution needed, omit for cosmetic-only"
  - "Graph traversal in importance propagation: BFS + visited set prevents infinite loops on circular deps"

requirements-completed: [QUAL-02, BUG-01]

# Metrics
duration: 6min
completed: 2026-03-19
---

# Phase 10 Plan 02: Path Normalization Unification and Transitive Importance Fix Summary

**Single canonicalizePath function replaces normalizePath/normalizeAndResolvePath split; recalculateImportanceForAffected upgraded to BFS traversal with cycle-safe visited set for full transitive dependency chain updates**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-19T16:24:50Z
- **Completed:** 2026-03-19T16:31:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Unified `normalizePath` (cosmetic) and `normalizeAndResolvePath` (resolve) into single `canonicalizePath(filepath, baseDir?)` in file-utils.ts
- Eliminated circular dependency between file-utils.ts and storage-utils.ts by removing unused `saveFileTree` import
- Fixed `recalculateImportanceForAffected` to traverse the full transitive dependent chain using BFS with visited set
- Added 2 new tests documenting transitive importance behavior and isolated-file baseline

## Task Commits

Each task was committed atomically:

1. **Task 1: Unify path normalization into canonicalizePath** - `e508ce2` (feat)
2. **Task 2 RED: Add transitive importance tests** - `ddc876b` (test)
3. **Task 2 GREEN: Fix recalculateImportanceForAffected** - `beac47f` (feat)

**Plan metadata:** _(to be added by final commit)_

_Note: TDD task has test commit followed by implementation commit._

## Files Created/Modified
- `src/file-utils.ts` - Added `canonicalizePath`, deprecated `normalizePath` alias, fixed BFS in `recalculateImportanceForAffected`
- `src/storage-utils.ts` - Replaced `normalizeAndResolvePath` definition with re-export from file-utils.ts
- `src/mcp-server.ts` - Updated import to use `canonicalizePath` from file-utils.ts, removed `normalizeAndResolvePath`
- `src/coordinator.ts` - Updated import from `normalizeAndResolvePath` to `canonicalizePath`
- `src/file-utils.test.ts` - Renamed describe block to `canonicalizePath`, updated all calls, added transitive importance tests

## Decisions Made
- `canonicalizePath` lives in `file-utils.ts` rather than a new module — no new files needed; storage-utils.ts re-exports it
- Removed unused `saveFileTree` import from `file-utils.ts` to break circular import (Rule 1: dead/broken import auto-fix)
- BFS over recursive DFS for cycle-safe transitive traversal — avoids call-stack overflow on deep chains
- `normalizeAndResolvePath` in `coordinator.ts` now passes `process.cwd()` as baseDir (matching original default behavior)
- `normalizeAndResolvePath` in `mcp-server.ts` now passes `getProjectRoot()` as baseDir (matching original default behavior)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused `saveFileTree` import from file-utils.ts to prevent circular dependency**
- **Found during:** Task 1 (path normalization unification)
- **Issue:** Plan said storage-utils.ts should import from file-utils.ts, but file-utils.ts already imported `saveFileTree` from storage-utils.ts (creating a circular dependency). The `saveFileTree` import was never actually used in file-utils.ts.
- **Fix:** Removed the unused `import { saveFileTree } from './storage-utils.js'` from file-utils.ts
- **Files modified:** src/file-utils.ts
- **Verification:** `npx tsc --noEmit` passes, `npx vitest run` all 184 tests pass
- **Committed in:** e508ce2 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - unused import causing circular dependency)
**Impact on plan:** Required for correctness — without removing the unused import, circular imports would cause module load failures. No scope creep.

## Issues Encountered
- Discovered that `normalizeAndResolvePath` in storage-utils.ts had a `getProjectRoot()` default that `canonicalizePath` does not. Updated all callers to explicitly pass the base directory, preserving original behavior.

## Next Phase Readiness
- Path normalization is now consistent across the codebase
- Importance propagation correctly updates transitive dependents when files change
- Both QUAL-02 and BUG-01 requirements satisfied

---
*Phase: 10-code-quality-and-bug-fixes*
*Completed: 2026-03-19*

## Self-Check: PASSED

- src/file-utils.ts: FOUND
- src/storage-utils.ts: FOUND
- src/mcp-server.ts: FOUND
- src/coordinator.ts: FOUND
- src/file-utils.test.ts: FOUND
- 10-02-SUMMARY.md: FOUND
- Commit e508ce2: FOUND
- Commit ddc876b: FOUND
- Commit beac47f: FOUND
