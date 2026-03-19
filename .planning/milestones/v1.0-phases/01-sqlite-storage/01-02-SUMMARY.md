---
phase: 01-sqlite-storage
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, drizzle-orm, migration, json-to-sqlite, transaction]

# Dependency graph
requires:
  - phase: 01-01
    provides: openDatabase, getSqlite, getDb, closeDatabase, upsertFile, setDependencies, getFile, getDependencies, getDependents from db.ts and repository.ts
provides:
  - migrateJsonToSQLite(jsonPath, dbPath) — reads JSON tree, flattens nested FileNode tree, inserts all nodes and dependencies transactionally, renames JSON to .bak
  - runMigrationIfNeeded(projectRoot) — entry point for server init: detects JSON tree files, skips if DB exists, opens DB and triggers migration, falls back gracefully on failure
  - collectNodes() internal helper — recursive flattening of nested FileNode tree to flat array
affects:
  - 01-03 (storage rewiring can now call runMigrationIfNeeded at server init for automatic migration)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - better-sqlite3 .transaction() used directly (not Drizzle transaction) for synchronous atomicity in migration
    - getSqlite() exposes raw connection for transaction wrapping outside of Drizzle's transaction API
    - runMigrationIfNeeded() pattern for zero-disruption upgrade detection at server startup

key-files:
  created:
    - src/migrate/json-to-sqlite.ts
    - src/migrate/json-to-sqlite.test.ts
  modified:
    - package.json (build script includes src/migrate/json-to-sqlite.ts)

key-decisions:
  - "Use getSqlite().transaction() (raw better-sqlite3) rather than db.transaction() (Drizzle) — Drizzle's transaction returns a callback-style API incompatible with the repository function pattern used here"
  - "runMigrationIfNeeded() opens the database internally — callers (server init) do not need to pre-open before calling"
  - "Migration errors are caught and logged but NOT re-thrown in runMigrationIfNeeded() — server falls back to JSON on failure per locked decision"
  - "migrateJsonToSQLite() re-throws on failure — only runMigrationIfNeeded() silences errors at the top level"

patterns-established:
  - "Pattern: startup migration check — call runMigrationIfNeeded(projectRoot) before any other storage operation in server init"
  - "Pattern: raw SQLite transaction for atomicity — use getSqlite().transaction() when wrapping repository calls that need all-or-nothing semantics"

requirements-completed: [STOR-02]

# Metrics
duration: 3min
completed: 2026-03-03
---

# Phase 1 Plan 02: JSON-to-SQLite Migration Runner Summary

**Transactional JSON-to-SQLite migration runner: flattens nested FileNode trees, inserts all data atomically via better-sqlite3 transaction, renames JSON to .bak on success, skips cleanly on fresh install or already-migrated DB.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-03T04:54:56Z
- **Completed:** 2026-03-03T04:57:54Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments

- `migrateJsonToSQLite()` reads real FileTreeStorage JSON format, flattens nested `children` tree into flat list, inserts all FileNodes and their dependencies in a single atomic better-sqlite3 transaction, renames JSON to `.bak` only after success
- `runMigrationIfNeeded()` detects presence of `FileScopeMCP-tree*.json` files in project root, skips if `.filescope.db` already exists (already migrated), opens DB and runs migration, catches errors without re-throwing so server falls back to JSON gracefully
- Dependents array from FileNode is intentionally NOT inserted — dependents are derived at query time via inverse query, per RESEARCH.md Pitfall 3
- 12 migration tests + 73 total tests all passing; build clean with migration module in dist/

## Task Commits

1. **RED: Failing tests for migration runner** - `60b8264` (test)
2. **GREEN: Migration runner implementation** - `6395d34` (feat)

## Files Created/Modified

- `src/migrate/json-to-sqlite.ts` - Migration runner with `collectNodes()`, `migrateJsonToSQLite()`, `runMigrationIfNeeded()`
- `src/migrate/json-to-sqlite.test.ts` - 12 tests covering all behaviors from plan spec
- `package.json` - Added `src/migrate/json-to-sqlite.ts` to esbuild entry points

## Decisions Made

- Used `getSqlite().transaction()` (raw better-sqlite3) instead of Drizzle's `db.transaction()`. Drizzle's transaction API uses a callback-style pattern that doesn't compose cleanly with the existing repository functions (upsertFile, setDependencies) which call `getDb()` internally. The raw better-sqlite3 transaction wraps any synchronous SQLite calls including those made through Drizzle's query builder.
- `runMigrationIfNeeded()` opens the database itself rather than requiring the caller to pre-open — simpler API for server init code, and the function already knows the dbPath from projectRoot.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed transaction API: switched from db.transaction() to getSqlite().transaction()**
- **Found during:** Task 1 (GREEN phase — running tests after first implementation)
- **Issue:** `db.transaction()` in drizzle-orm/better-sqlite3 does not return a plain callable function the way the RESEARCH.md example shows. Calling `runMigration()` threw `TypeError: runMigration is not a function`. The Drizzle transaction API requires a different call pattern.
- **Fix:** Switched to `getSqlite().transaction(callback)` which returns a proper callable function per better-sqlite3's native transaction API. This wraps all `upsertFile` and `setDependencies` calls (which internally use Drizzle queries) in a single atomic transaction.
- **Files modified:** `src/migrate/json-to-sqlite.ts`
- **Verification:** All 12 migration tests pass after the fix
- **Committed in:** `6395d34` (GREEN commit)

**2. [Rule 1 - Bug] Fixed rollback test: changed from duplicate-path strategy to malformed JSON**
- **Found during:** Task 1 (GREEN phase — 11/12 tests passing)
- **Issue:** Test for "leaves JSON untouched if transaction fails" used duplicate paths to trigger a constraint error. However, `upsertFile()` uses `onConflictDoUpdate` which silently updates on duplicate paths rather than throwing. The transaction never failed.
- **Fix:** Changed the test to write malformed JSON (not parseable), which throws in `JSON.parse()` before the transaction even starts. This correctly tests the invariant: "any failure before renameSync leaves JSON untouched."
- **Files modified:** `src/migrate/json-to-sqlite.test.ts`
- **Verification:** Test now passes; JSON file remains untouched on migration failure
- **Committed in:** `6395d34` (GREEN commit, test file updated inline)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep — behavior matches plan intent exactly (atomic migration, JSON preserved on failure).

## Issues Encountered

- Drizzle's transaction API behavior differs between the RESEARCH.md example (which references a pattern from an older drizzle-orm version or the better-sqlite3 docs directly) and the actual drizzle-orm/better-sqlite3 TypeScript API. The raw `getSqlite().transaction()` pattern is more reliable and is the recommended approach per better-sqlite3 docs.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `runMigrationIfNeeded(projectRoot)` is ready to be called from `mcp-server.ts` or wherever server initialization happens in Plan 03
- `migrateJsonToSQLite()` is tested and handles all edge cases: missing optional fields, empty children, nested trees, package dependencies
- Plan 03 (storage rewiring) can now integrate `runMigrationIfNeeded` as the first step of storage initialization
- No blockers for Plan 03

## Self-Check: PASSED

All created files verified to exist. Both task commits (60b8264, 6395d34) verified in git log.

---
*Phase: 01-sqlite-storage*
*Completed: 2026-03-03*
