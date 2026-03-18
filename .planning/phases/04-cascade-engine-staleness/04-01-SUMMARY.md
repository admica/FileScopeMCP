---
phase: 04-cascade-engine-staleness
plan: 01
subsystem: database
tags: [sqlite, bfs, staleness, cascade, llm-jobs, better-sqlite3]

# Dependency graph
requires:
  - phase: 03-semantic-change-detection
    provides: SemanticChangeSummary with affectsDependents flag; ChangeDetector wired in coordinator
provides:
  - BFS CascadeEngine with cycle protection and depth cap (cascadeStale, markSelfStale)
  - repository markStale() and insertLlmJobIfNotPending() functions
  - upsertFile() staleness-safe fix (no longer clobbers cascade writes)
  - Coordinator wiring: cascade dispatch on change and deletion events
affects: [05-llm-pipeline, phase-5-llm-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - BFS with visited Set for cycle-safe graph traversal
    - Depth cap (MAX_CASCADE_DEPTH=10) to bound cascade size
    - raw better-sqlite3 prepared statement in transaction for markStale bulk update
    - insertLlmJobIfNotPending dedup pattern: SELECT 1 pending check before INSERT

key-files:
  created:
    - src/cascade/cascade-engine.ts
    - src/cascade/cascade-engine.test.ts
  modified:
    - src/db/repository.ts
    - src/coordinator.ts

key-decisions:
  - "CascadeEngine uses raw better-sqlite3 prepared statements (not Drizzle) for markStale — transaction() API composes cleanly with loops, same pattern as migration"
  - "upsertFile() conflict update path no longer includes staleness columns — CascadeEngine owns those columns exclusively; fresh INSERT still defaults to null"
  - "markSelfStale sets only summary_stale_since and concepts_stale_since (NOT change_impact_stale_since) — body-only changes don't affect the impact assessment"
  - "cascadeStale in unlink case must run BEFORE removeFileNode so getDependents() can still find dependency edges"
  - "MAX_CASCADE_DEPTH=10 — depth >= 10 exits BFS expansion; files at depth 0..10 are visited (11 total max hops)"

patterns-established:
  - "CascadeEngine pattern: BFS queue of [filePath, depth] tuples, visited Set initialized with start node, markStale + 3 insertLlmJobIfNotPending calls per visited node"
  - "Staleness ownership: only CascadeEngine writes staleness columns; upsertFile skips them on conflict update"

requirements-completed: [CASC-01, CASC-02, CASC-04, CASC-05]

# Metrics
duration: 12min
completed: 2026-03-17
---

# Phase 4 Plan 1: CascadeEngine BFS Staleness Summary

**BFS CascadeEngine with visited-Set cycle protection, depth cap 10, and priority-tier-2 LLM job deduplication wired into coordinator change and deletion handlers**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-18T04:00:00Z
- **Completed:** 2026-03-18T04:12:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Implemented `cascadeStale()` BFS walk that marks all transitive dependents stale with per-field timestamps and queues 3 LLM jobs per file at priority tier 2
- Implemented `markSelfStale()` for body-only changes (summary + concepts only, not change_impact)
- Added `markStale()` bulk update function using raw prepared statements in a transaction
- Added `insertLlmJobIfNotPending()` with pending-status dedup to prevent duplicate job rows
- Fixed `upsertFile()` staleness clobber bug — conflict update path no longer overwrites cascade-written columns
- Wired coordinator: `affectsDependents=true` → `cascadeStale`, `affectsDependents=false` → `markSelfStale`, unlink case runs cascade before `removeFileNode`

## Task Commits

Each task was committed atomically:

1. **Task 1: Repository functions and upsertFile fix + CascadeEngine BFS** - `0fb2111` (feat)
2. **Task 2: Coordinator wiring** - `b3a19f9` (feat)

## Files Created/Modified

- `src/cascade/cascade-engine.ts` - BFS cascadeStale and markSelfStale functions
- `src/cascade/cascade-engine.test.ts` - 11 unit tests covering BFS, cycle detection, depth cap, body-only, deletion
- `src/db/repository.ts` - markStale(), insertLlmJobIfNotPending(), upsertFile() staleness fix
- `src/coordinator.ts` - Import cascade-engine, replace void placeholder with cascade dispatch, add deletion cascade

## Decisions Made

- Used raw `better-sqlite3` prepared statements for `markStale()` — transaction API composes cleanly with the file path loop, consistent with migration pattern
- `upsertFile()` conflict update path has staleness columns removed; CascadeEngine exclusively owns those columns
- `markSelfStale` omits `change_impact_stale_since` — body-only changes don't invalidate the change impact assessment of the file itself
- `cascadeStale` in unlink handler runs before `removeFileNode` so `getDependents()` can still resolve edges

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CascadeEngine fully operational; all CASC requirements fulfilled
- Phase 5 (LLM Pipeline) can now read `summary_stale_since`, `concepts_stale_since`, `change_impact_stale_since` fields and pending llm_jobs rows at priority tier 2
- `insertLlmJobIfNotPending` dedup pattern is Phase 5's entry point for job consumption

---
*Phase: 04-cascade-engine-staleness*
*Completed: 2026-03-17*
