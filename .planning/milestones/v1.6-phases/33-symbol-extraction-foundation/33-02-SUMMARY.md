---
phase: 33-symbol-extraction-foundation
plan: 02
subsystem: database
tags: [drizzle, sqlite, migration, schema, symbols, kv_state]

# Dependency graph
requires:
  - phase: 33-symbol-extraction-foundation (plan 01)
    provides: PERF-01 baseline and bench-scan CLI anchored at commit 1871c6a, so 33-02 schema changes land cleanly against a measurable pre-implementation point
provides:
  - src/db/schema.ts — Drizzle definitions for new `symbols` and `kv_state` tables plus two additive columns (`imported_names`, `import_line`) on `file_dependencies`
  - drizzle/0005_add_symbols_and_import_metadata.sql — hand-authored migration creating the two new tables, two indexes, and the two additive columns
  - drizzle/meta/_journal.json — registered idx 5 entry pointing at the new migration tag
  - src/db/migration-0005.test.ts — 5 assertions proving migration applies cleanly on both a fresh DB and a simulated pre-v1.6 DB with existing file_dependencies rows
affects: [33-03, 33-04, 33-05, 34-find-symbol-and-get-file-summary]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-authored additive migration SQL matching 0004_add_edge_metadata.sql shape — statement-breakpoint separators, backtick-quoted identifiers, CREATE TABLE / CREATE INDEX / ALTER TABLE with default values"
    - "PRAGMA table_info + sqlite_master introspection pattern for migration tests (hasTable / hasColumn / hasIndex helpers scoped to the test file)"
    - "kv_state as the canonical store for string flags going forward (replaces the effectively-unused schema_version integer table)"

key-files:
  created:
    - drizzle/0005_add_symbols_and_import_metadata.sql
    - src/db/migration-0005.test.ts
  modified:
    - src/db/schema.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "Hand-author the 0005 SQL (matching 0004 format) instead of running `npx drizzle-kit generate` — the project's drizzle/meta/ only contains the 0000 snapshot, so drizzle-kit compares against a stale reference and prompts interactively about renames of tables that were added or dropped between 0001-0004; prior migrations in this repo are already hand-authored in the same pattern"
  - "is_export column stored as INTEGER with DEFAULT false (0) — Drizzle boolean mode maps naturally and NULLs-are-not-possible on this column matches the Symbol interface's `isExport: boolean`"
  - "imported_names left as nullable TEXT (no DEFAULT) — non-TS/JS rows keep NULL per D-10; readers interpret NULL as [] and decode non-null values via JSON.parse"
  - "No FK from symbols.path or kv_state.key to files.path — keeps migration ordering independent and purges explicit via deleteSymbolsForFile()"

patterns-established:
  - "Migration SQL style: statement-breakpoint separators, backtick identifiers, CREATE TABLE followed by CREATE INDEX in the same migration (no separate index migration)"
  - "Migration test pattern: src/db/migration-NNNN.test.ts covering fresh-DB schema shape + existing-DB idempotent re-open"
  - "kv_state is now the shared home for one-shot gates (symbols_bulk_extracted, future json_migrated flag redesigns, etc.) — string keys avoid repurposing schema_version"

requirements-completed: [SYM-03, IMP-03]

# Metrics
duration: 4m 9s
completed: 2026-04-23
---

# Phase 33 Plan 02: Schema + Migration for Symbol-Level Intelligence Summary

**Additive Drizzle schema for `symbols` (6-column table with `symbols_name_idx` + `symbols_path_idx`), `kv_state` (string key/value flags table), and two nullable columns (`imported_names`, `import_line`) on `file_dependencies` — shipped as hand-authored migration `drizzle/0005_add_symbols_and_import_metadata.sql` with 5 passing migration-0005 tests covering fresh and pre-v1.6 databases**

## Performance

- **Duration:** 4m 9s
- **Started:** 2026-04-23T13:55:58Z
- **Completed:** 2026-04-23T14:00:07Z
- **Tasks:** 3 / 3
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `symbols` table added with columns (id, path, name, kind, start_line, end_line, is_export) and two indexes; shapes the Phase 34 `find_symbol` query surface without requiring further schema work
- `kv_state` table added as the canonical string flag store, unblocking the 33-05 `symbols_bulk_extracted` one-shot gate
- `file_dependencies` gains `imported_names` (nullable TEXT for JSON encoding) and `import_line` (nullable INTEGER), additive and safe for every existing row (IMP-03)
- Migration `drizzle/0005_add_symbols_and_import_metadata.sql` lands against `drizzle/meta/_journal.json` idx 5 so `migrate()` applies it automatically on next `openDatabase()`
- `src/db/migration-0005.test.ts` with 5 assertions proves the migration applies cleanly on both a fresh DB and a simulated pre-v1.6 DB — idempotent re-open verified and NULL preservation on existing rows verified
- Full test suite (570 passed + 9 skipped) stays green; zero regressions against the Plan 01 baseline

## Task Commits

Each task committed atomically (worktree mode, --no-verify):

1. **Task 1: Extend src/db/schema.ts — add symbols, kv_state, and two file_dependencies columns** — `b680d41` (feat)
2. **Task 2: [BLOCKING] Generate migration via drizzle-kit and rename to canonical filename** — `129f258` (feat)
3. **Task 3: Verify migration applies cleanly on both fresh and existing DBs** — `2545917` (test)

Plan metadata commit will be produced after this SUMMARY lands.

## Files Created/Modified

- `src/db/schema.ts` (modified) — added `symbols` table (lines 52–65), `kv_state` table (lines 77–82), and two nullable columns `imported_names` + `import_line` on `file_dependencies` (lines 44–46). All existing exports (`files`, `file_dependencies`, `file_communities`, `schema_version`) preserved verbatim; `drizzle-orm/sqlite-core` import line untouched.
- `drizzle/0005_add_symbols_and_import_metadata.sql` (created) — 11-line hand-authored migration with `ALTER TABLE ... ADD COLUMN` for the two new columns, `CREATE TABLE \`symbols\`` with all 7 columns, `CREATE INDEX` for name and path, and `CREATE TABLE \`kv_state\``
- `drizzle/meta/_journal.json` (modified) — appended idx 5 entry `{ "idx": 5, "version": "6", "when": 1776952800000, "tag": "0005_add_symbols_and_import_metadata", "breakpoints": true }`; JSON remains valid
- `src/db/migration-0005.test.ts` (created) — vitest suite with `hasTable` / `hasColumn` / `hasIndex` helpers driving 5 assertions across fresh-DB and existing-DB describe blocks

### PRAGMA table_info Verification

All three targeted DDL groups confirmed after migration applies against a fresh SQLite file (run via a standalone `better-sqlite3` script that executes 0000-0005 in order):

**file_dependencies** (13 columns, new ones at indices 11 and 12):
```
0  id                 INTEGER  NOT NULL (PK, autoincrement)
1  source_path        TEXT     NOT NULL
2  target_path        TEXT     NOT NULL
3  dependency_type    TEXT     NOT NULL
4  package_name       TEXT
5  package_version    TEXT
6  is_dev_dependency  INTEGER
7  edge_type          TEXT     NOT NULL DEFAULT 'imports'
8  confidence         REAL     NOT NULL DEFAULT 0.8
9  confidence_source  TEXT     NOT NULL DEFAULT 'inferred'
10 weight             INTEGER  NOT NULL DEFAULT 1
11 imported_names     TEXT                                    <-- new
12 import_line        INTEGER                                 <-- new
```

**symbols** (7 columns):
```
0  id          INTEGER  NOT NULL (PK, autoincrement)
1  path        TEXT     NOT NULL
2  name        TEXT     NOT NULL
3  kind        TEXT     NOT NULL
4  start_line  INTEGER  NOT NULL
5  end_line    INTEGER  NOT NULL
6  is_export   INTEGER  NOT NULL DEFAULT false
```

**kv_state** (2 columns):
```
0  key    TEXT  NOT NULL (PK)
1  value  TEXT  NOT NULL
```

**Indexes on symbols table:** `symbols_name_idx`, `symbols_path_idx` — both present.

## Decisions Made

- **Hand-author 0005 SQL vs. `drizzle-kit generate`:** drizzle-kit's interactive rename prompt (triggered because `drizzle/meta/` only contains the 0000 snapshot — 0001-0004 were added without snapshot files) cannot be bypassed non-interactively. The project's established pattern is hand-authored migration SQL anyway (0001, 0002, 0003 all match this shape); 0005 follows that convention exactly. The plan's Task 2 acceptance criteria target the final state of the SQL file and journal entry, both of which are satisfied.
- **`is_export` column stored as INTEGER with `DEFAULT false` (0):** Drizzle's `{ mode: 'boolean' }` generates an `integer` column with a boolean default, and the migration SQL emits `DEFAULT false` as-is. SQLite accepts `false`/`true` as aliases for 0/1 at parse time, so the migration applies cleanly.
- **`imported_names` nullable with no DEFAULT:** non-TS/JS rows must keep NULL per D-10 — readers (Phase 34 `get_file_summary`) treat NULL as "no data" and fall back to `[]`. This matches `package_name` / `package_version` / `is_dev_dependency` shapes already present on the table.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `drizzle-kit generate` cannot run non-interactively on this repo**
- **Found during:** Task 2 (Generate migration via drizzle-kit)
- **Issue:** The project's `drizzle/meta/` directory contains only `0000_snapshot.json` (snapshots for migrations 0001-0004 were never committed to the repo). Running `npx drizzle-kit generate` launches an interactive prompt asking whether each newly-added table (e.g. `file_communities`) was renamed from a dropped table (`llm_jobs`), because drizzle-kit compares against the only snapshot it has. The CLI has no non-interactive bypass flag, and piping stdin does not select answers (the prompt uses readline raw-mode arrow keys). The command hangs indefinitely.
- **Fix:** Hand-author `drizzle/0005_add_symbols_and_import_metadata.sql` matching the exact format of `drizzle/0004_add_edge_metadata.sql` (statement-breakpoint separators, backtick identifiers, CREATE TABLE / CREATE INDEX / ALTER TABLE) and append idx 5 entry to `drizzle/meta/_journal.json`. This matches the established pattern for this repo — commits `23d0fed` (0004), `4845514` (0003), `31e1f2f` (0002), and others all add hand-authored SQL + a 1-line journal addition without touching snapshots. The plan's Step 3 ("If drizzle-kit named the file something other than ..., RENAME it") implicitly accepts post-generation fixup; hand-authoring is the same end state reached via a different means.
- **Files modified:** `drizzle/0005_add_symbols_and_import_metadata.sql` (created), `drizzle/meta/_journal.json` (modified)
- **Verification:** Task 3's migration-0005.test.ts applies all 6 migrations through `openDatabase()` and confirms every target table, column, and index exists. Smoke-check via a standalone better-sqlite3 script also applies 0000-0005 in order and dumps PRAGMA table_info for file_dependencies, symbols, and kv_state — all shapes match the plan spec.
- **Committed in:** `129f258` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking tooling gap, resolved by following the repo's established hand-authored migration pattern)
**Impact on plan:** No scope change. Final on-disk state (SQL file + journal entry) is identical to what drizzle-kit would have produced in a project with up-to-date snapshots. All Task 2 acceptance criteria pass.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None — purely additive schema change applied automatically by `migrate()` inside `openDatabase()`.

## Next Phase Readiness

- **33-03 (parser widening)** can now import `import type { Symbol } from '../db/symbol-types.js'` without worrying about a missing `symbols` table — repo helpers in 33-04 will write into the shape guaranteed here
- **33-04 (repository helpers)** can wire `upsertSymbols` / `getSymbolsByName` / `getSymbolsForFile` / `deleteSymbolsForFile` against the stable column set, and `getKvState`/`setKvState` against the `kv_state` table
- **33-05 (coordinator bulk gate)** has the `kv_state` primary-key store available for the `symbols_bulk_extracted` ISO-timestamp flag
- **Phase 34 `find_symbol`** can assume both indexes exist (`symbols_name_idx`, `symbols_path_idx`) from day one — no post-hoc index creation needed for query performance
- No blockers. Full test suite (570 passing + 9 skipped) unchanged from Plan 01 baseline.

## Self-Check: PASSED

**Files verified on disk (5/5):**
- src/db/schema.ts
- drizzle/0005_add_symbols_and_import_metadata.sql
- drizzle/meta/_journal.json
- src/db/migration-0005.test.ts
- .planning/phases/33-symbol-extraction-foundation/33-02-SUMMARY.md

**Commits verified in git log (3/3):**
- b680d41 feat(33-02): extend schema with symbols, kv_state, import metadata cols
- 129f258 feat(33-02): add migration 0005 for symbols, kv_state, import metadata
- 2545917 test(33-02): verify migration 0005 on fresh and existing DBs

---
*Phase: 33-symbol-extraction-foundation*
*Completed: 2026-04-23*
