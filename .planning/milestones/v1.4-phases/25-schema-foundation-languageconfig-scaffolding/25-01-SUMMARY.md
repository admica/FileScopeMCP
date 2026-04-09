---
phase: 25-schema-foundation-languageconfig-scaffolding
plan: "01"
subsystem: db-schema
tags: [schema, migration, drizzle, confidence, edge-metadata, community-detection]
dependency_graph:
  requires: []
  provides: [drizzle/0004_add_edge_metadata.sql, src/db/schema.ts, src/confidence.ts]
  affects: [src/db/repository.ts, src/file-utils.ts]
tech_stack:
  added: []
  patterns: [drizzle-orm sqlite column types, named constant module pattern]
key_files:
  created:
    - drizzle/0004_add_edge_metadata.sql
    - src/confidence.ts
  modified:
    - src/db/schema.ts
decisions:
  - "Use real() Drizzle column type for confidence float (not integer) to match SQL REAL affinity"
  - "Set DEFAULT 'imports' for edge_type and DEFAULT 0.8/'inferred' for confidence so all existing rows are valid without a data migration"
  - "ConfidenceSource as union type (not enum) to keep it as a plain string in SQLite without a lookup table"
  - "file_communities FK uses ON DELETE CASCADE so orphan rows are cleaned up automatically when files are removed"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-09"
  tasks_completed: 2
  files_created: 2
  files_modified: 1
requirements_completed: [EDGE-01, EDGE-02]
---

# Phase 25 Plan 01: Schema Foundation — Edge Metadata + Confidence Constants Summary

SQLite migration adds four edge metadata columns to `file_dependencies` with safe defaults preserving existing rows, creates the `file_communities` table for community detection output, and introduces a typed `confidence.ts` constants module.

## What Was Built

### Task 1: Schema migration and Drizzle type definitions (commit 23d0fed)

Created `drizzle/0004_add_edge_metadata.sql` with six SQL statements (5 statement-breakpoint delimiters) that:
- Add `edge_type TEXT NOT NULL DEFAULT 'imports'` to `file_dependencies`
- Add `confidence REAL NOT NULL DEFAULT 0.8` to `file_dependencies`
- Add `confidence_source TEXT NOT NULL DEFAULT 'inferred'` to `file_dependencies`
- Add `weight INTEGER NOT NULL DEFAULT 1` to `file_dependencies`
- Create `file_communities` table with PK, `community_id`, `file_path` (FK to files.path ON DELETE CASCADE)
- Create `communities_community_id_idx` index on `community_id`

Updated `src/db/schema.ts`:
- Added `real` to the `drizzle-orm/sqlite-core` import
- Added all four new columns to `file_dependencies` table definition
- Added `file_communities` table export with matching index definition

### Task 2: Confidence constants module (commit 4c7cfda)

Created `src/confidence.ts` as a standalone zero-dependency module exporting:
- `EXTRACTED = 1.0` — for AST-parsed edges with high confidence
- `INFERRED = 0.8` — for regex-parsed edges matching schema default
- `CONFIDENCE_SOURCE_EXTRACTED = 'extracted' as const`
- `CONFIDENCE_SOURCE_INFERRED = 'inferred' as const`
- `ConfidenceSource` union type for typed function parameters downstream

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Soft-reset side effect deleted tracked planning files**
- **Found during:** Initial branch setup
- **Issue:** The `git reset --soft` to rebase onto the correct base commit left planning files (25-01-PLAN.md, 25-02-PLAN.md, ROADMAP.md) staged for deletion because they had been added in the base commit but were missing from the worktree HEAD. The first task commit inadvertently deleted them from git history.
- **Fix:** Used `git checkout <base-commit> -- <files>` to restore the planning files and committed them back (commit 5244539).
- **Files modified:** `.planning/ROADMAP.md`, `.planning/phases/25-schema-foundation-languageconfig-scaffolding/25-01-PLAN.md`, `.planning/phases/25-schema-foundation-languageconfig-scaffolding/25-02-PLAN.md`
- **Commit:** 5244539

## Verification Results

All acceptance criteria passed:

- `drizzle/0004_add_edge_metadata.sql` contains exactly 5 `statement-breakpoint` occurrences
- All four ALTER TABLE statements present with correct types and defaults
- CREATE TABLE `file_communities` present with FK and AUTOINCREMENT
- CREATE INDEX `communities_community_id_idx` present
- `drizzle/meta/_journal.json` not modified
- `src/db/schema.ts` import includes `real`
- All four new columns defined in `file_dependencies` with correct types/defaults
- `file_communities` table exported with index
- `src/confidence.ts` exports all four constants and ConfidenceSource type
- No import statements in `src/confidence.ts`
- `npx tsc --noEmit` passes with zero errors

## Self-Check: PASSED

Files verified to exist:
- drizzle/0004_add_edge_metadata.sql: FOUND
- src/confidence.ts: FOUND
- src/db/schema.ts: FOUND (modified)

Commits verified:
- 23d0fed: feat(25-01): add edge metadata columns and file_communities table
- 4c7cfda: feat(25-01): add confidence constants module
