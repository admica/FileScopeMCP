---
phase: 02-coordinator-daemon-mode
plan: 01
subsystem: coordinator
tags: [typescript, sqlite, better-sqlite3, mcp, coordinator, file-watcher, daemon]

# Dependency graph
requires:
  - phase: 01-sqlite-storage
    provides: SQLite repository CRUD functions (getAllFiles, upsertFile, getFile, deleteFile, setDependencies), openDatabase/closeDatabase lifecycle, runMigrationIfNeeded
provides:
  - ServerCoordinator class in src/coordinator.ts encapsulating all orchestration state and lifecycle
  - mcp-server.ts thin tool-surface layer delegating to coordinator via registerTools(server, coordinator)
  - enableDaemonFileLogging() in logger.ts for daemon-mode log suppression with 10MB rotation
  - Coordinator tests proving STOR-05 (no MCP transport needed) and COMPAT-03 (no LLM needed)
affects: [02-daemon-mode, 03-change-detector]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Coordinator pattern: all orchestration state moved from module-level vars into ServerCoordinator class"
    - "Bridge pattern: reconstructTreeFromDb() used as temporary adapter for file-utils functions that expect a FileNode tree argument"
    - "registerTools(server, coordinator) closure capture: thin tool-surface delegates to coordinator without global state"
    - "Daemon-safe logging: enableDaemonFileLogging suppresses console.error and adds 10MB rotation"

key-files:
  created:
    - src/coordinator.ts
    - src/coordinator.test.ts
  modified:
    - src/mcp-server.ts
    - src/logger.ts
    - package.json

key-decisions:
  - "reconstructTreeFromDb() exposed as public method on ServerCoordinator to serve as bridge for file-utils mutation functions that require a FileNode tree argument"
  - "In-memory fileTree module variable fully removed from mcp-server.ts; coordinator.getFileTree() reconstructs from DB on-demand for COMPAT-01 backward compat"
  - "shutdown() drains mutex via treeMutex.run(async () => {}) to prevent DB close racing with in-flight file events"
  - "AsyncMutex kept as module-private class in coordinator.ts (not exported) to avoid leaking implementation detail"
  - "recalculate_importance uses inline flattenTree helper in mcp-server.ts instead of deleted getAllFileNodes function"

patterns-established:
  - "Coordinator owns: DB open/close lifecycle, file watcher, integrity sweep, debounce timers"
  - "MCP tools own: input validation, error formatting, direct repo calls for pure DB reads/writes"
  - "Bridge pattern: getFileTree() / reconstructTreeFromDb() used when file-utils functions need a tree argument"

requirements-completed: [STOR-05, COMPAT-03]

# Metrics
duration: 6min
completed: 2026-03-03
---

# Phase 2 Plan 1: ServerCoordinator Extraction Summary

**ServerCoordinator class extracted from mcp-server.ts — all orchestration state moved to coordinator.ts, mcp-server.ts reduced to thin registerTools() tool surface with zero module-level mutable state**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-03T05:56:27Z
- **Completed:** 2026-03-03T06:03:00Z
- **Tasks:** 3
- **Files modified:** 4 (coordinator.ts created, mcp-server.ts, logger.ts, package.json)

## Accomplishments
- Created `src/coordinator.ts` with `ServerCoordinator` class: encapsulates `init()`, `initServer()`, `shutdown()`, `handleFileEvent()`, `startIntegritySweep()`, `buildFileTree()`, `reconstructTreeFromDb()` and all associated state
- Rewired `src/mcp-server.ts` from ~1169 lines with module-level mutable state to a thin tool-surface using `registerTools(server, coordinator)` pattern with zero `let` variables at module scope
- Extended `src/logger.ts` with `enableDaemonFileLogging()` for daemon mode: suppresses console.error, adds 10MB automatic log rotation
- Added 5 tests in `src/coordinator.test.ts` proving STOR-05 (coordinator runs without MCP transport) and COMPAT-03 (system works without LLM)
- All 78 tests pass (5 new + 73 existing), build succeeds, TypeScript compiles clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create ServerCoordinator class in src/coordinator.ts** - `db6e6c0` (feat)
2. **Task 2: Rewire mcp-server.ts to use ServerCoordinator via closure capture** - `22054fc` (feat)
3. **Task 3: Verify MCP mode backward compatibility end-to-end** - `fe64baa` (test)

**Plan metadata:** (docs commit — this summary)

## Files Created/Modified
- `src/coordinator.ts` — New file: ServerCoordinator class with all orchestration logic extracted from mcp-server.ts; module-private AsyncMutex; reconstructTreeFromDb() as public bridge method
- `src/coordinator.test.ts` — New file: 5 tests covering init, migration, getFileTree, shutdown, and no-LLM operation
- `src/mcp-server.ts` — Rewritten to thin tool surface: removed all mutable state, all extracted functions, findNode, getAllFileNodes; added registerTools(server, coordinator); updated entry IIFE
- `src/logger.ts` — Extended: added enableDaemonFileLogging(), daemonMode flag, LOG_MAX_SIZE constant, size-check-then-truncate in log()
- `package.json` — Added src/coordinator.ts to esbuild entry points

## Decisions Made
- **reconstructTreeFromDb() is public:** Makes it accessible as a bridge for file-utils mutation functions (addFileNode, removeFileNode, etc.) that require a FileNode tree argument — avoids changing file-utils.ts signatures in this plan
- **In-memory fileTree fully dropped:** No instance-level fileTree property on ServerCoordinator; getFileTree() reconstructs from SQLite on-demand for list_files COMPAT-01 backward compat
- **shutdown() drains mutex:** Calls `await this.treeMutex.run(async () => {})` after stopping watcher/timers to ensure any in-flight DB mutations complete before closeDatabase()
- **AsyncMutex stays module-private:** Not exported from coordinator.ts — implementation detail
- **recalculate_importance uses inline flattenTree helper:** getAllFileNodes was deleted (in-memory tree traversal dead code); equivalent inline function added directly in the tool handler

## Deviations from Plan

None — plan executed exactly as written. All bridge patterns, public API methods, and logger extensions matched the plan specification.

## Issues Encountered
None — TypeScript compiled on first attempt, all tests passed on first run.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (daemon entry point) can now import `ServerCoordinator` and call `coordinator.initServer()` + `coordinator.shutdown()` without any MCP transport
- `enableDaemonFileLogging()` is ready for use in daemon entry point
- All orchestration logic consolidated in coordinator.ts — clean foundation for daemon mode
- No blockers.

## Self-Check: PASSED

- src/coordinator.ts: FOUND
- src/coordinator.test.ts: FOUND
- 02-01-SUMMARY.md: FOUND
- Commit db6e6c0: FOUND
- Commit 22054fc: FOUND
- Commit fe64baa: FOUND

---
*Phase: 02-coordinator-daemon-mode*
*Completed: 2026-03-03*
