---
phase: 10-code-quality-and-bug-fixes
plan: 01
subsystem: core
tags: [file-utils, types, file-watcher, dead-code, backoff]

requires: []
provides:
  - Consolidated fs imports in file-utils.ts (fs for sync, fsPromises for async only)
  - createFileTree removed from public API (export removed)
  - PackageDependency.fromPath() uses structural detection only, no hardcoded allowlist
  - FileWatcher restart backoff resets after 60s stable operation, not immediately on start
affects: [11-cycle-detection, 12-language-support, 13-streaming-scan]

tech-stack:
  added: []
  patterns:
    - "Package classification uses only structural path analysis (@-prefix for scoped, first segment for bare)"
    - "Watcher stability timer pattern: reset backoff only after sustained uptime, not on restart attempt"

key-files:
  created: []
  modified:
    - src/file-utils.ts
    - src/types.ts
    - src/file-watcher.ts

key-decisions:
  - "Removed commonPkgs hardcoded list in PackageDependency.fromPath — structural detection (node_modules path, @-prefix scoped) is sufficient without false positive risk"
  - "stabilityTimer approach chosen for backoff reset: 60s consecutive uptime required, timer cleared on any restart trigger or shutdown"

patterns-established:
  - "Stability timer pattern: clear on failure/shutdown, start on successful watcher start, reset counter only in timer callback"

requirements-completed: [QUAL-01, QUAL-03, QUAL-04, BUG-02]

duration: 3min
completed: 2026-03-19
---

# Phase 10 Plan 01: Code Quality and Bug Fixes Summary

**Removed fsSync dead import, un-exported createFileTree, replaced commonPkgs allowlist with structural path detection, and fixed watcher backoff reset to require 60s stability before clearing attempt counter**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-03-19T16:19:10Z
- **Completed:** 2026-03-19T16:21:36Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Removed unused `import * as fsSync from "fs"` (zero usages confirmed) — file-utils.ts now has exactly two fs imports
- Removed `export` from `createFileTree` — function stays internal, not part of public module API
- Replaced 7-item `commonPkgs` hardcoded list in `PackageDependency.fromPath()` with generic structural detection — eliminates false positives on local paths containing common package names (e.g. `/src/firebase/config.ts`)
- Fixed watcher restart backoff: `restartAttempts` now resets only after 60 consecutive seconds of stable operation via `stabilityTimer`, not immediately when `start()` is called

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove dead code from file-utils.ts and fix PackageDependency false positives in types.ts** - `49cc33a` (fix)
2. **Task 2: Fix watcher restart backoff to require 60s stability before reset** - `fd84182` (fix)

## Files Created/Modified
- `src/file-utils.ts` - Removed duplicate `fsSync` import; removed `export` from `createFileTree`
- `src/types.ts` - Replaced `commonPkgs` allowlist in `PackageDependency.fromPath()` with clean structural detection
- `src/file-watcher.ts` - Added `stabilityTimer`, `STABILITY_THRESHOLD_MS = 60_000`, `startStabilityTimer()` method; fixed `restart()` and `stop()` to clear timer correctly

## Decisions Made
- Removed `commonPkgs` rather than expanding it — any path-substring matching approach is inherently fragile; first segment heuristic is correct for bare specifiers and avoids false positives on local file paths
- The stability timer is cleared in both `restart()` (at the top, before scheduling) and `stop()` — belt-and-suspenders to prevent stale timer callbacks after shutdown

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Clean baseline established: no dead imports, no dead exports, no hardcoded package allowlist, correct backoff behavior
- Ready for Phase 10 Plan 02 and subsequent phases

---
*Phase: 10-code-quality-and-bug-fixes*
*Completed: 2026-03-19*
