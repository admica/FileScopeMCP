---
phase: 35-changed-since-tool-watcher-integration
plan: 01
subsystem: database/repository
tags: [sqlite, transaction, cascade, watcher, symbols, changed-since]
dependency_graph:
  requires: []
  provides:
    - getFilesChangedSince(mtimeMs) — non-directory files with mtime > mtimeMs, mtime DESC
    - getFilesByPaths(paths[]) — DB intersection with 500-item chunking, empty-guard
    - deleteFile(filePath) — atomic three-DELETE transaction (file_dependencies, symbols, files)
  affects:
    - src/db/repository.ts (extended)
    - all callers of deleteFile (removeFileNode at file-utils.ts:1215)
tech_stack:
  added: []
  patterns:
    - better-sqlite3 sqlite.transaction() wrapping mixed Drizzle + raw-SQL (matches setEdgesAndSymbols precedent)
    - getSqlite().prepare(...).all(...) raw-SQL read pattern (matches Phase 33/34 helpers)
    - 500-item IN-clause chunking (conservative under SQLite's 32,766 variable limit)
key_files:
  created:
    - src/db/repository.changed-since.test.ts
  modified:
    - src/db/repository.ts
decisions:
  - D-27: deleteFile wraps three DELETEs in sqlite.transaction() — atomicity improvement over pre-Phase-35 state
  - D-28: symbols DELETE inlined in deleteFile (not delegated to deleteSymbolsForFile) to share the transaction
  - D-29: deleteSymbolsForFile() left untouched — still callable independently
  - D-24: getFilesChangedSince SQL is byte-exact as specified in CONTEXT
  - D-25: getFilesByPaths empty-guard returns [] before any DB call; chunks at 500
metrics:
  duration_minutes: 10
  tasks_completed: 2
  files_created: 1
  files_modified: 1
  completed_date: 2026-04-23
---

# Phase 35 Plan 01: Repository Layer — Changed-Since Helpers + deleteFile Cascade Summary

**One-liner:** Raw-sqlite read helpers `getFilesChangedSince` and `getFilesByPaths` plus a three-DELETE atomic `deleteFile` wrapping file_dependencies, symbols, and files in one `sqlite.transaction()`.

## Tasks Completed

| # | Name | Commit | Files |
|---|------|--------|-------|
| 1 | Extend deleteFile + add getFilesChangedSince + getFilesByPaths | ad6e285 | src/db/repository.ts |
| 2 | Unit tests for new helpers + deleteFile cascade | 1be250b | src/db/repository.changed-since.test.ts |

## Functions Exported / Extended

### `deleteFile(filePath: string): void` — extended

Prior to Phase 35: two non-atomic Drizzle deletes (file_dependencies, files) with no transaction wrapper.

After Phase 35: three DELETEs inside a single `sqlite.transaction()`:
1. `db.delete(file_dependencies).where(or(source=path, target=path)).run()` — Drizzle, safe inside better-sqlite3 tx
2. `sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(filePath)` — raw, new (WTC-02)
3. `db.delete(files).where(eq(files.path, filePath)).run()` — Drizzle

This is an improvement over the pre-Phase-35 un-transacted state. A crash between deletes no longer leaves orphan rows in any of the three tables.

### `getFilesChangedSince(mtimeMs: number): Array<{path: string, mtime: number}>` — new

SQL: `SELECT path, mtime FROM files WHERE is_directory = 0 AND mtime IS NOT NULL AND mtime > ? ORDER BY mtime DESC`

- Strict `>` comparison (D-13)
- NULL mtime rows excluded in SQL
- Directory rows excluded in SQL
- Raw sqlite, no Drizzle

### `getFilesByPaths(paths: string[]): Array<{path: string, mtime: number | null}>` — new

- Empty input returns `[]` immediately (no DB call) — mandatory guard against `WHERE path IN ()` syntax error
- Processes in 500-item chunks (conservative; SQLite limit in this build is 32,766)
- Returns rows in DB-native order; caller is responsible for sorting

## Test File: `src/db/repository.changed-since.test.ts` (166 lines, 10 tests)

Harness: real SQLite DB in per-test tmpdir (`mkdtempSync`), `openDatabase`/`closeDatabase` in `beforeEach`/`afterEach` — matches Phase 33 `repository.symbols.test.ts` pattern.

seeding via raw `INSERT OR REPLACE INTO files (path, name, is_directory, mtime, importance)` for precise mtime/NULL control.

### Test names:

**getFilesChangedSince (5 tests):**
1. `returns rows with mtime > since, ordered mtime DESC`
2. `applies strict > boundary`
3. `excludes rows with mtime IS NULL`
4. `excludes rows with is_directory = 1`
5. `returns [] on empty DB`

**getFilesByPaths (4 tests):**
6. `returns [] immediately for empty input`
7. `returns rows for matching paths and drops missing paths`
8. `handles batching above 500 paths`
9. `preserves null mtime in result rows`

**deleteFile WTC-02 cascade (1 test):**
10. `cascades symbols on deleteFile — WTC-02`
    - Asserts `getSymbolsForFile('/a.ts')` → length 0
    - Asserts raw `SELECT COUNT(*) AS n FROM symbols WHERE path = ?` → `{n: 0}` (orphan-row guard)
    - Asserts `getFile('/a.ts')` → null

## Acceptance Criteria

| Criterion | Result |
|-----------|--------|
| `npm run build` exits 0 | PASS |
| `npx vitest run src/db/repository.changed-since.test.ts` exits 0 | PASS |
| At least 10 passing tests | PASS (10/10) |
| `getFilesChangedSince(999)` fixed literal (no Date.now()) | PASS |
| `COUNT(*) AS n FROM symbols WHERE path` orphan guard | PASS |
| No `Date.now()` calls in test file | PASS |
| `is_directory` directory-exclusion test | PASS |
| `npx vitest run src/db/repository.symbols.test.ts` exits 0 (Phase 33 regression) | PASS (18/18) |
| `grep -c "sqlite.transaction" src/db/repository.ts` >= 2 | PASS (6) |
| `deleteFile` uses `sqlite.transaction` | PASS |
| `deleteSymbolsForFile` still present unchanged | PASS |
| `export function getFilesChangedSince` present | PASS |
| `export function getFilesByPaths` present with empty guard | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] seedFile raw INSERT used wrong column name**
- **Found during:** Task 2, first test run
- **Issue:** Raw INSERT included `has_dependencies` column which does not exist in the actual `files` schema (schema.ts has no such column)
- **Fix:** Removed `has_dependencies` from the INSERT column list; kept `(path, name, is_directory, mtime, importance)` — sufficient for all test scenarios
- **Files modified:** src/db/repository.changed-since.test.ts
- **Commit:** part of 1be250b (fixed before final commit)

## Known Stubs

None — all functions are fully wired to real SQLite.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary changes. The `getFilesByPaths` IN-clause uses positional `?` placeholders only (no string interpolation of user input).

## Self-Check: PASSED

Files created/modified:
- `src/db/repository.ts` — FOUND (modified, committed ad6e285)
- `src/db/repository.changed-since.test.ts` — FOUND (created, committed 1be250b)

Commits:
- `ad6e285` — FOUND in `git log --oneline -5`
- `1be250b` — FOUND in `git log --oneline -5`
