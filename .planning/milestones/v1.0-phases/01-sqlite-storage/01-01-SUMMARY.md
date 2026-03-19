---
phase: 01-sqlite-storage
plan: 01
subsystem: database
tags: [sqlite, drizzle-orm, better-sqlite3, drizzle-kit, wal, repository-pattern]

# Dependency graph
requires: []
provides:
  - SQLite database connection module with WAL pragmas and programmatic migration via drizzle-orm
  - Drizzle schema defining files, file_dependencies, llm_jobs, schema_version tables
  - Repository module with typed CRUD: getFile, upsertFile, deleteFile, getChildren, getDependencies, getDependents, setDependencies, getAllFiles
  - Initial migration SQL (drizzle/0000_eager_rumiko_fujikawa.sql)
affects:
  - 01-02 (JSON migration runner consumes openDatabase, repository functions)
  - 01-03 (storage rewiring replaces storage-utils.ts with repository calls)
  - 05-llm-pipeline (llm_jobs table pre-built and ready)

# Tech tracking
tech-stack:
  added:
    - better-sqlite3 ^12.6.2 (synchronous SQLite driver, CJS loaded via createRequire)
    - drizzle-orm ^0.45.1 (type-safe query builder + schema-as-code)
    - drizzle-kit ^0.31.9 (migration generation CLI)
    - "@types/better-sqlite3 ^7.6.13" (TypeScript types)
  patterns:
    - createRequire(import.meta.url) for loading CJS better-sqlite3 from ESM context
    - WAL pragmas set on raw sqlite connection BEFORE drizzle() wraps it
    - Migrations folder resolved at module load time (immune to process.chdir)
    - Repository pattern hiding SQL from all callers
    - Flat files table with path-prefix LIKE queries for children reconstruction
    - Dependents derived by inverse query (never stored as duplicate rows)

key-files:
  created:
    - src/db/schema.ts
    - src/db/db.ts
    - src/db/repository.ts
    - src/db/db.test.ts
    - src/db/repository.test.ts
    - drizzle.config.ts
    - drizzle/0000_eager_rumiko_fujikawa.sql
    - drizzle/meta/_journal.json
  modified:
    - package.json (new deps + build script includes db files)
    - tsconfig.json (moduleResolution: node → bundler)

key-decisions:
  - "createRequire(import.meta.url) loads better-sqlite3 CJS from ESM — no direct ESM import"
  - "WAL and foreign_keys pragmas set on raw Database instance before drizzle() wraps it to avoid unreliable PRAGMA-via-migration behavior"
  - "Migrations folder resolved at module load time via import.meta.url — immune to process.chdir() from set_project_path"
  - "tsconfig.json moduleResolution changed from node to bundler — node resolution caused OOM with drizzle-orm type traversal"
  - "--external:better-sqlite3 removed from esbuild — not needed without --bundle mode; native addon resolved from node_modules at runtime"
  - "getAllFiles() skips dependency population for performance; getFile() populates deps/dependents/packageDependencies for backward compatibility"

patterns-established:
  - "Pattern: ESM/CJS bridge — createRequire(import.meta.url) for native CJS addons in ESM TypeScript"
  - "Pattern: WAL setup — always set pragmas directly on Database instance before ORM wraps it"
  - "Pattern: Migration safety — resolve migrationsFolder at module load time, not at call time"
  - "Pattern: Repository — all storage goes through repository.ts; callers never see SQL or Drizzle"

requirements-completed: [STOR-01, STOR-03, STOR-07]

# Metrics
duration: 10min
completed: 2026-03-03
---

# Phase 1 Plan 01: SQLite Storage Foundation Summary

**SQLite persistence layer with Drizzle ORM: schema (4 tables), WAL-mode connection via createRequire, programmatic migrations, and typed CRUD repository — all tests passing, build clean.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-03T04:40:31Z
- **Completed:** 2026-03-03T04:51:05Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 10

## Accomplishments

- SQLite database module opens with WAL mode, NORMAL synchronous, foreign_keys ON, 5s busy timeout — all configured before drizzle() wraps the connection
- Drizzle schema defines all 4 tables (files, file_dependencies, llm_jobs, schema_version) with correct columns, indexes, and enum constraints
- Repository module provides 8 typed CRUD functions covering all required operations; FileNode round-trips without data loss; PackageDependency metadata persisted in extra columns
- esbuild transpiles all 3 db source files cleanly; typecheck passes with no errors; 28 tests pass across 2 test suites

## Task Commits

1. **Task 1: Install deps, define Drizzle schema, create DB connection module, generate migration** - `f458b86` (feat)
2. **Task 2: Build repository module with typed CRUD functions** - `1d476a3` (feat)

## Files Created/Modified

- `src/db/schema.ts` - Drizzle table definitions: files, file_dependencies (with PackageDependency columns), llm_jobs (Phase 5-ready), schema_version
- `src/db/db.ts` - openDatabase/getDb/getSqlite/closeDatabase; createRequire for better-sqlite3; WAL pragmas; module-load-time migration path
- `src/db/repository.ts` - 8 typed CRUD functions; rowToFileNode/fileNodeToRow helpers; flat children via LIKE + post-filter; dependents via inverse query
- `src/db/db.test.ts` - 13 tests: file creation, WAL mode, foreign_keys, table existence, column presence, close behavior
- `src/db/repository.test.ts` - 15 tests: upsert/get round-trip, importance=0 mapping, delete cascade, children one-level-deep, dependency CRUD, PackageDependency round-trip, getAllFiles
- `drizzle.config.ts` - Drizzle kit config (dialect: sqlite, schema: src/db/schema.ts, out: drizzle/)
- `drizzle/0000_eager_rumiko_fujikawa.sql` - Generated initial migration SQL with CREATE TABLE for all 4 tables
- `package.json` - Added better-sqlite3, drizzle-orm, drizzle-kit, @types/better-sqlite3; build script includes db source files
- `tsconfig.json` - moduleResolution changed from node to bundler

## Decisions Made

- Used `createRequire(import.meta.url)` to load better-sqlite3 (CJS) in ESM context — direct import would fail at runtime
- WAL pragmas set on raw `Database` instance before `drizzle()` wraps it — per verified GitHub issue drizzle-team/drizzle-orm#4968
- Migrations folder resolved using `import.meta.url` at module load time — immune to `process.chdir()` from `set_project_path`
- `moduleResolution: bundler` in tsconfig instead of `node` — `node` resolution with drizzle-orm caused out-of-memory crash during typecheck
- No `--bundle` in esbuild build script, so `--external:better-sqlite3` is not needed (and would error without `--bundle`)
- `getAllFiles()` skips dep queries for performance; `getFile()` populates all arrays for backward compat with existing code

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed --external:better-sqlite3 from esbuild (not valid without --bundle)**
- **Found during:** Task 1 (verifying build)
- **Issue:** Plan specified `--external:better-sqlite3` but esbuild 0.27.3 returns error "Cannot use 'external' without 'bundle'" when `--bundle` is not set. The existing build script does not use `--bundle` — it transpiles files individually.
- **Fix:** Added db source files to esbuild entry points without `--external` flag. Without bundling, node_modules imports (including better-sqlite3) are preserved as-is in the output, so the native addon resolves at runtime from node_modules normally.
- **Files modified:** package.json (build script)
- **Verification:** `npm run build` succeeds; all 3 db files appear in dist/
- **Committed in:** f458b86 (Task 1 commit)

**2. [Rule 3 - Blocking] Changed tsconfig.json moduleResolution from node to bundler**
- **Found during:** Task 1 (running npm run typecheck)
- **Issue:** `tsc --noEmit` with `moduleResolution: "node"` causes out-of-memory crash (process killed at ~2GB heap) when drizzle-orm is installed. The `node` strategy traverses all package files including drizzle-orm's extensive type graph.
- **Fix:** Changed to `moduleResolution: "bundler"` which uses the `exports` field in package.json and does not traverse the full type tree. Typecheck now completes in < 1s.
- **Files modified:** tsconfig.json
- **Verification:** `npx tsc --noEmit` exits 0 with no output
- **Committed in:** f458b86 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary for the build to succeed. No scope creep — behavior matches plan intent exactly (better-sqlite3 remains a runtime dep; types work correctly).

## Issues Encountered

- drizzle-kit generates migration filenames with random slugs (e.g., `0000_eager_rumiko_fujikawa.sql`) rather than `0000_initial_schema.sql` as noted in the plan. This is normal drizzle-kit behavior — the filename is tracked in `meta/_journal.json` and the migration applies correctly regardless.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `openDatabase(dbPath)`, `getDb()`, `closeDatabase()` are ready for Plan 02 (JSON migration runner)
- All 8 repository functions tested and ready for Plan 03 (storage rewiring)
- `llm_jobs` table pre-built with correct columns for Phase 5
- No blockers for Plan 02

## Self-Check: PASSED

All created files verified to exist. Both task commits (f458b86, 1d476a3) verified in git log.

---
*Phase: 01-sqlite-storage*
*Completed: 2026-03-03*
