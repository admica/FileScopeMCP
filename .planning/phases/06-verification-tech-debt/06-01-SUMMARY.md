---
phase: 06-verification-tech-debt
plan: 01
subsystem: logging, database, migration
tags: [logger, console-error, better-sqlite3, migration, db-lifecycle]

# Dependency graph
requires:
  - phase: 05-llm-processing-pipeline
    provides: Full system with LLM pipeline; all 164 tests passing

provides:
  - logger.ts with error/warn/info/debug level methods alongside existing log()
  - Zero console.error calls in application code (storage-utils, global-state, file-watcher, config-utils)
  - Dead getChildren import removed from storage-utils.ts
  - runMigrationIfNeeded(projectRoot, sqlite) — accepts open DB handle, no internal openDatabase()
  - coordinator.ts opens DB exactly once before migration (single lifecycle owner)
  - Migration skip condition is content-based (SELECT COUNT(*) FROM files), not file-existence

affects: [06-02, 06-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared _write() helper in logger.ts — all level methods call it with different prefix/suppression rules"
    - "Coordinator as DB lifecycle owner — opens once, passes handle to migration"
    - "Content-based migration idempotency — SELECT COUNT(*) FROM files instead of fs.existsSync"

key-files:
  created: []
  modified:
    - src/logger.ts
    - src/storage-utils.ts
    - src/global-state.ts
    - src/file-watcher.ts
    - src/config-utils.ts
    - src/migrate/json-to-sqlite.ts
    - src/migrate/json-to-sqlite.test.ts
    - src/coordinator.ts

key-decisions:
  - "error() always outputs to console AND disk regardless of daemonMode — never suppressed"
  - "debug() suppressed entirely in daemon mode — per CONTEXT.md locked decision"
  - "Migration skip condition uses DB content check (row count > 0) not file existence — required because coordinator now always opens DB first"
  - "migrateJsonToSQLite continues to call getSqlite() internally since DB is guaranteed open by coordinator"
  - "runMigrationIfNeeded test for 'already migrated' now inserts a sentinel row then verifies migration is skipped"

patterns-established:
  - "Logger named import pattern: import { error as logError, info as logInfo, debug as logDebug } from './logger.js'"
  - "Coordinator opens DB, passes getSqlite() to migration — enforces single DB lifecycle owner"

requirements-completed: [STOR-01, STOR-02, STOR-07]

# Metrics
duration: 6min
completed: 2026-03-18
---

# Phase 6 Plan 01: Logger Level Methods + DB Lifecycle Fix Summary

**Logger extended with error/warn/info/debug levels via shared _write() helper; all console.error calls in 4 app files replaced with level-appropriate logger calls; migration refactored to accept open DB handle eliminating double-open bug**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-18T05:55:56Z
- **Completed:** 2026-03-18T06:02:06Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Logger now exports 5 methods: log, error, warn, info, debug — all with correct daemon-mode suppression
- Zero console.error calls remain in application source files (storage-utils, global-state, file-watcher, config-utils)
- Dead `getChildren` import removed from storage-utils.ts
- DB double-open bug eliminated — coordinator opens DB once, migration receives open handle
- Migration idempotency now content-based (`SELECT COUNT(*) FROM files`) — robust across restarts
- All 164 existing tests pass after changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend logger with level methods, replace console.error in app files** - `be99786` (feat)
2. **Task 2: Refactor DB lifecycle — migration receives open handle from coordinator** - `0fcb635` (feat)

## Files Created/Modified

- `src/logger.ts` — Added _write() helper, error/warn/info/debug exported methods
- `src/storage-utils.ts` — Removed dead getChildren import; replaced all console.error with logError/logInfo/logDebug
- `src/global-state.ts` — Replaced all console.error with logError/logInfo/logDebug
- `src/file-watcher.ts` — Replaced all console.error with logError/logWarn/logInfo/logDebug per severity
- `src/config-utils.ts` — Replaced all console.error with logError/logInfo/logDebug
- `src/migrate/json-to-sqlite.ts` — Removed openDatabase/closeDatabase; new signature accepts sqlite handle; content-based skip check
- `src/migrate/json-to-sqlite.test.ts` — Updated call sites to pass getSqlite(); updated skip test to use content-based verification
- `src/coordinator.ts` — Imported getSqlite; moved openDatabase before runMigrationIfNeeded; passes getSqlite() as second arg

## Decisions Made

- `error()` always outputs regardless of daemon mode (never suppressed) — matches CONTEXT.md spec
- `debug()` is suppressed in daemon mode — matches CONTEXT.md spec; saves log noise in production
- Logger import pattern in app files: named imports with aliases (`error as logError`) to avoid shadowing
- Migration content check uses `SELECT COUNT(*) FROM files` — if table doesn't exist, catch returns false (proceed); if rows exist, return true (skip)
- `migrateJsonToSQLite` continues to use `getSqlite()` internally (module-level getter) since DB is always open when called

## Deviations from Plan

None — plan executed exactly as written. All classifications from RESEARCH.md classification table applied as specified.

## Issues Encountered

None. All changes were straightforward. The test file update was anticipated in RESEARCH.md Pitfalls 2 and 4.

## Next Phase Readiness

- Tech debt cleared — logger, console.error bypass, and DB lifecycle are all clean
- Phase 06-02 (VERIFICATION.md creation) can proceed against clean codebase
- All 164 tests passing confirms no regressions

---
*Phase: 06-verification-tech-debt*
*Completed: 2026-03-18*
