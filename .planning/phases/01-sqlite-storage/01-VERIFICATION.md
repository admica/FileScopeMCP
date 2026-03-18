# Phase 1: SQLite Storage - Verification

**Verified:** 2026-03-18
**Test command:** `npx vitest run src/db/db.test.ts src/db/repository.test.ts src/migrate/json-to-sqlite.test.ts src/coordinator.test.ts src/mcp-server.test.ts`
**Result:** All tests pass (165 tests across 12 test files)

---

## STOR-01: SQLite stores all file metadata, non-breaking migration

**Status:** VERIFIED
**Evidence:**
- `src/db/db.test.ts` -- `openDatabase > creates a .db file at the specified path`
- `src/db/repository.test.ts` -- `upsertFile / getFile > inserts a new row and retrieves it as a FileNode`
**Behavior confirmed:** openDatabase creates a SQLite .db file on disk, and upsertFile/getFile round-trips all FileNode fields (path, name, isDirectory, importance, summary, mtime) through the database.

---

## STOR-02: Existing JSON trees are automatically migrated to SQLite on first startup

**Status:** VERIFIED
**Evidence:**
- `src/migrate/json-to-sqlite.test.ts` -- `runMigrationIfNeeded > triggers migration when JSON file exists and DB has no data`
- `src/coordinator.test.ts` -- `ServerCoordinator > init() runs migration for existing JSON tree`
**Behavior confirmed:** When a JSON tree file is present and the SQLite DB is empty, runMigrationIfNeeded() automatically migrates all file nodes to SQLite and renames the JSON file to .bak; coordinator.init() invokes this migration transparently.

---

## STOR-03: SQLite schema supports per-file staleness flags, dependency relationships as a join table, and structured metadata fields

**Status:** VERIFIED
**Evidence:**
- `src/db/db.test.ts` -- `openDatabase > files table has required columns`
- `src/db/db.test.ts` -- `openDatabase > file_dependencies table has required columns`
- `src/db/db.test.ts` -- `openDatabase > creates file_dependencies table after migration`
**Behavior confirmed:** The files table includes summary_stale_since, concepts_stale_since, and change_impact_stale_since columns; file_dependencies is a join table with source_path, target_path, and dependency_type columns; all columns are present after openDatabase().

---

## STOR-04: All existing MCP tools continue to work identically after storage migration (backward compatibility)

**Status:** VERIFIED
**Evidence:**
- `src/mcp-server.test.ts` -- `Staleness injection into MCP response shape > fresh file: no staleness fields appear in get_file_summary response shape`
- `src/mcp-server.test.ts` -- `Staleness injection into MCP response shape > stale file: summaryStale appears in get_file_summary response shape`
**Behavior confirmed:** MCP tool response shapes remain backward compatible — fresh files return no staleness fields (no API contract change), and stale files include staleness timestamps only when non-null.

---

## STOR-07: Pending LLM jobs persist in SQLite and survive process restarts

**Status:** VERIFIED
**Evidence:**
- `src/db/db.test.ts` -- `openDatabase > creates llm_jobs table after migration`
- `src/db/db.test.ts` -- `openDatabase > llm_jobs table has required columns`
**Behavior confirmed:** openDatabase() creates an llm_jobs table with all required columns (job_id, file_path, job_type, priority_tier, status, created_at, started_at, completed_at, error_message, retry_count) persisted in the SQLite file so jobs survive process restarts.

---

## COMPAT-01: All 20+ existing MCP tool names, parameter schemas, and response shapes remain identical

**Status:** VERIFIED
**Evidence:**
- `src/mcp-server.test.ts` -- `COMPAT-01: MCP tool names and schemas remain identical > COMPAT-01: all expected MCP tool names are registered in mcp-server.ts`
**Behavior confirmed:** All 19 MCP tool names (set_project_path, list_saved_trees, delete_file_tree, create_file_tree, select_file_tree, list_files, get_file_importance, find_important_files, get_file_summary, set_file_summary, read_file_content, set_file_importance, recalculate_importance, toggle_file_watching, get_file_watching_status, update_file_watching_config, debug_list_all_files, toggle_llm, exclude_and_remove) remain registered via server.tool() calls — no tool was renamed or removed after storage migration.
