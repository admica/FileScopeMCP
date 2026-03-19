---
phase: 01-sqlite-storage
plan: 03
subsystem: database
tags: [sqlite, better-sqlite3, drizzle-orm, mcp, storage, migration, file-watcher]

# Dependency graph
requires:
  - phase: 01-01
    provides: openDatabase, closeDatabase, getDb, getSqlite, repository CRUD functions (getFile, getAllFiles, upsertFile, deleteFile, getChildren, getDependencies, getDependents, setDependencies)
  - phase: 01-02
    provides: runMigrationIfNeeded(projectRoot) for automatic JSON-to-SQLite migration at server init
provides:
  - All MCP tool handlers (get_file_importance, find_important_files, get_file_summary, set_file_summary, set_file_importance, list_files, recalculate_importance) reading/writing SQLite via repository
  - initializeProject() calls runMigrationIfNeeded then openDatabase — database lifecycle fully managed
  - buildFileTree() uses SQLite as cache with freshness spot-check, bulk-inserts on full scan
  - handleFileEvent() persists add/change/unlink mutations to SQLite without saveFileTree()
  - startIntegritySweep() reads from and writes to SQLite
  - storage-utils.ts functions delegate to repository; loadedTrees Map removed
  - file-utils.ts mutation functions (addFileNode, removeFileNode, updateFileNodeOnChange) persist to SQLite after in-memory mutation
affects:
  - 02-coordinator (coordinator can open the SQLite DB knowing lifecycle is stable)
  - all future phases (SQLite is now the single source of truth for all file metadata)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Repository pattern: all file metadata reads/writes go through repository.ts functions
    - DB lifecycle: openDatabase() at project init, closeDatabase() before project switch
    - Dual-write pattern during transition: in-memory FileNode tree mutated first, then persisted to SQLite via repository
    - SQLite as cache: buildFileTree checks getAllFiles().length > 0 and mtime spot-check before deciding full scan vs. reuse

key-files:
  created: []
  modified:
    - src/mcp-server.ts
    - src/storage-utils.ts
    - src/file-utils.ts

key-decisions:
  - "In-memory FileNode tree retained during this plan for backward compatibility with tool handlers — Phase 2+ can remove it once all callers use repository directly"
  - "handleFileEvent no longer calls saveFileTree() — mutations are persisted by file-utils.ts repository calls (addFileNode/removeFileNode/updateFileNodeOnChange) instead"
  - "buildFileTree freshness check: spot-sample 5 files by mtime against DB; if any diverge by >5s, trigger full rescan and bulk upsert"

patterns-established:
  - "Pattern: tool handler reads via getFile(path) or getAllFiles() from repository, never via in-memory tree traversal"
  - "Pattern: mutation functions (addFileNode, removeFileNode, updateFileNodeOnChange) call repository persist functions immediately after in-memory update"
  - "Pattern: project switch closes old DB before opening new one — no concurrent DB handles"

requirements-completed: [STOR-04, COMPAT-01]

# Metrics
duration: ~30min
completed: 2026-03-02
---

# Phase 1 Plan 03: Storage Rewiring Summary

**All MCP tool handlers and infrastructure layers rewired to SQLite repository: JSON persistence removed, database lifecycle managed at server init, backward-compatible response shapes guaranteed (COMPAT-01).**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-03-02T23:00:00Z
- **Completed:** 2026-03-02T23:05:34Z
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 3

## Accomplishments

- `initializeProject()` now calls `runMigrationIfNeeded(projectRoot)` then `openDatabase()` — first-boot migration is automatic; fresh installs start cleanly with empty DB
- `buildFileTree()` uses SQLite as the cache layer: checks `getAllFiles().length > 0` with mtime spot-check for freshness, falls back to full scan with bulk `upsertFile()` / `setDependencies()` per file
- `handleFileEvent()` no longer calls `saveFileTree()` — file-utils mutation functions (`addFileNode`, `removeFileNode`, `updateFileNodeOnChange`) persist each change to SQLite directly
- `startIntegritySweep()` loads file list from `getAllFiles()`, runs integrity checks, writes fixes back via repository
- `storage-utils.ts` rewritten: `loadedTrees` Map removed, all functions delegate to repository (saveFileTree → bulk upsertFile, loadFileTree → reconstruct from getChildren, getFileNode → getFile, updateFileNode → getFile + merge + upsertFile, clearTreeCache → no-op)
- `file-utils.ts` mutation functions extended with repository persist calls after every in-memory tree mutation
- Every MCP tool handler (get_file_importance, find_important_files, get_file_summary, set_file_summary, set_file_importance, list_files, recalculate_importance) uses repository calls — response JSON shapes unchanged (COMPAT-01 preserved)
- User confirmed end-to-end correctness via human-verify checkpoint

## Task Commits

1. **Task 1: Rewire server init, storage-utils, file-utils, and global-state for SQLite** - `226eae0` (feat)
2. **Task 2: Rewire MCP tool handlers to use SQLite repository** - `226eae0` (feat, combined with Task 1)
3. **Task 3: Verify end-to-end SQLite storage with MCP tool backward compatibility** - human-verify checkpoint (no code commit)

## Files Created/Modified

- `src/mcp-server.ts` — initializeProject DB lifecycle, buildFileTree SQLite cache, handleFileEvent SQLite persist, startIntegritySweep SQLite, all tool handlers via repository (504 lines changed)
- `src/storage-utils.ts` — loadedTrees removed, all functions delegate to repository (137 lines changed)
- `src/file-utils.ts` — addFileNode/removeFileNode/updateFileNodeOnChange persist to SQLite (15 lines changed)

## Decisions Made

- Retained the in-memory `fileTree` variable for this plan to minimize blast radius — tool handlers that needed a tree root during the transition could still reference it. Phase 2+ will remove it once all callers are repository-native.
- `handleFileEvent` does not call `saveFileTree()` anymore — the file-utils functions handle persistence at the point of mutation. This avoids double-writing and makes the mutation path self-contained.
- `buildFileTree` freshness check uses a 5-file mtime spot-sample with a 5-second tolerance. This mirrors the original JSON freshness logic and avoids full-scan churn on restarts.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - all steps in Tasks 1 and 2 completed without unexpected errors. Build and typecheck passed. User approved the human-verify checkpoint confirming correct MCP tool behavior.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- SQLite is the single source of truth for all file metadata — Phase 2 (Coordinator) can open the DB knowing the lifecycle contract is stable (openDatabase on init, closeDatabase on switch)
- COMPAT-01 and STOR-04 requirements fulfilled — MCP clients see identical response shapes
- STOR-02 (migration) + STOR-04 (rewiring) complete: the full Phase 1 storage stack is done
- No blockers for Phase 2

## Self-Check: PASSED

All modified files exist in the repository. Task commits (226eae0) verified in git log.

---
*Phase: 01-sqlite-storage*
*Completed: 2026-03-02*
