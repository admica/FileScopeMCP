---
phase: 02-coordinator-daemon-mode
plan: 02
subsystem: coordinator
tags: [typescript, daemon, pid-file, signal-handling, graceful-shutdown, mcp, file-watcher]

# Dependency graph
requires:
  - phase: 02-coordinator-daemon-mode
    plan: 01
    provides: ServerCoordinator class with init/shutdown/initServer lifecycle, enableDaemonFileLogging() in logger.ts
provides:
  - PID file guard (acquirePidFile/releasePidFile) in ServerCoordinator preventing concurrent daemons
  - --daemon entry point in mcp-server.ts: standalone daemon mode without MCP client
  - gracefulShutdown() with 5-second force-exit timeout for SIGTERM/SIGINT in both modes
  - STOR-06 fully satisfied: node dist/index.js --daemon --base-dir=<path> is operational
affects: [02-03-smoke-test, 03-change-detector]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PID file guard pattern: write process.pid to .filescope.pid on init, remove on shutdown, overwrite stale, refuse live"
    - "Daemon mode branching: process.argv --daemon flag determines entry path at runtime"
    - "Force-exit timeout pattern: setTimeout(process.exit(1), 5000) with .unref() for graceful shutdown fallback"
    - "Signal handler consistency: SIGTERM/SIGINT registered in both daemon and MCP modes"

key-files:
  created: []
  modified:
    - src/coordinator.ts
    - src/mcp-server.ts
    - src/coordinator.test.ts

key-decisions:
  - "PID file acquired after _projectRoot is set but before DB open — prevents second instance from corrupting DB"
  - "releasePidFile called as final step in shutdown() after DB close — ensures consistent cleanup order"
  - "enableDaemonFileLogging() called before coordinator.init() so all init logs go to file only"
  - "Banner uses process.stdout.write (not log()) — one stdout line only, then silence"
  - "forceExit.unref() prevents timer from keeping event loop alive if shutdown completes normally"

patterns-established:
  - "Daemon lifecycle: acquirePidFile -> init -> signal handlers -> chokidar keeps event loop alive -> SIGTERM/SIGINT -> gracefulShutdown -> releasePidFile"
  - "TDD discipline: failing tests committed separately (test(02-02)) before implementation"

requirements-completed: [STOR-06]

# Metrics
duration: 4min
completed: 2026-03-03
---

# Phase 2 Plan 2: Daemon Entry Point Summary

**PID file guard and --daemon entry point wired into ServerCoordinator and mcp-server.ts — `node dist/mcp-server.js --daemon --base-dir=<path>` is a fully operational standalone daemon with graceful SIGTERM/SIGINT shutdown**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-03T06:09:16Z
- **Completed:** 2026-03-03T06:12:25Z
- **Tasks:** 2 (1 TDD, 1 auto)
- **Files modified:** 2 (coordinator.ts, mcp-server.ts) + 1 test file

## Accomplishments
- Added `acquirePidFile()` / `releasePidFile()` to `ServerCoordinator`: writes `process.pid` to `.filescope.pid` on init, removes on shutdown, overwrites stale PIDs, throws "already running" for live PIDs
- Wired `acquirePidFile` into `init()` (after setting `_projectRoot`, before DB open) and `releasePidFile` into `shutdown()` (final step after DB close)
- Replaced entry IIFE in `mcp-server.ts` with `--daemon` flag branching: daemon mode calls `coordinator.init()` directly, MCP mode unchanged via `coordinator.initServer()`
- Added `gracefulShutdown()` with 5-second force-exit timeout (`.unref()` prevents premature event loop blockage)
- Signal handlers (SIGTERM/SIGINT) registered in both daemon and MCP modes per locked decision
- All 83 tests pass (10 coordinator tests, 73 existing)

## Task Commits

Each task was committed atomically:

1. **Task 1 - RED: failing PID guard tests** - `4cc2412` (test)
2. **Task 1 - GREEN: implement PID guard** - `9f5f8b4` (feat)
3. **Task 2: wire --daemon entry point** - `e5e696b` (feat)

**Plan metadata:** (docs commit — this summary)

## Files Created/Modified
- `src/coordinator.ts` — Added `acquirePidFile()`, `releasePidFile()` private methods; wired into `init()` and `shutdown()`
- `src/mcp-server.ts` — Added `gracefulShutdown()`, replaced entry IIFE with daemon/MCP branching, added `enableDaemonFileLogging` import
- `src/coordinator.test.ts` — Added 5 new PID guard tests (Tests 6-10): PID written, PID removed, stale overwritten, live PID throws, daemon mode standalone

## Decisions Made
- **PID acquired before DB open:** Prevents second instance from even opening the database when another daemon is live
- **Banner uses `process.stdout.write`, not `log()`:** One stdout line only; `log()` goes to file after `enableDaemonFileLogging` is called
- **`forceExit.unref()`:** Timer does not keep event loop alive if shutdown completes within 5 seconds
- **Signal handlers in MCP mode too:** Consistent lifecycle behavior per locked decision from Plan 02-01

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered
None — TypeScript compiled on first attempt, all tests passed after implementation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `node dist/mcp-server.js --daemon --base-dir=<path>` is fully operational
- STOR-06 satisfied
- Plan 02-03 (smoke test / end-to-end verification) can now run the daemon and verify the full integration
- No blockers.

## Self-Check: PASSED
