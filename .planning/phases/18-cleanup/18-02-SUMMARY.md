---
phase: 18-cleanup
plan: 02
subsystem: cascade
tags: [cascade, broker, cleanup, typescript]

# Dependency graph
requires:
  - phase: 18-01
    provides: legacy LLM job queue tables dropped, pipeline.ts/rate-limiter.ts deleted
  - phase: 17-02
    provides: cascadeStale/markSelfStale already calling submitJob unconditionally; isExhausted left in signatures for Phase 18
provides:
  - cascadeStale with clean signature (no isExhausted option)
  - markSelfStale with clean signature (no isExhausted option)
  - isLlmBudgetExhausted() method removed from coordinator
affects: [phase-19, future cascade consumers]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Broker handles all capacity management — no isExhausted/budget concept in cascade layer"

key-files:
  created: []
  modified:
    - src/cascade/cascade-engine.ts
    - src/coordinator.ts
    - src/change-detector/llm-diff-fallback.ts
    - src/mcp-server.ts

key-decisions:
  - "mcp-server.ts get_llm_status budgetExhausted hardcoded to false — removing isLlmBudgetExhausted() made the inline literal correct and minimal"

patterns-established:
  - "Capacity management is a broker concern only — no upstream code should gate on budget/exhaustion state"

requirements-completed: [CLEAN-05]

# Metrics
duration: 2min
completed: 2026-03-22
---

# Phase 18 Plan 02: isExhausted Parameter Removal Summary

**Removed isExhausted parameter from cascadeStale/markSelfStale signatures, deleted isLlmBudgetExhausted() from coordinator, and updated stale llm_jobs comments to reflect broker architecture**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T18:13:20Z
- **Completed:** 2026-03-22T18:15:20Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments
- cascadeStale and markSelfStale signatures no longer accept isExhausted parameter — broker owns all capacity management
- All 4 call sites in coordinator.ts updated to omit the dead isExhausted: () => false argument
- isLlmBudgetExhausted() method deleted from ServerCoordinator class
- Stale comments in llm-diff-fallback.ts updated from "llm_jobs table" to "LLM broker" / "submitJob"
- TypeScript compiles clean, build succeeds, 232/233 tests pass (1 pre-existing PID guard test unrelated to this plan)

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove isExhausted from cascade-engine.ts signatures and coordinator.ts call sites** - `3e444c2` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `src/cascade/cascade-engine.ts` - Removed isExhausted? from cascadeStale and markSelfStale opts types and destructuring
- `src/coordinator.ts` - Removed all 4 isExhausted: () => false call sites; deleted isLlmBudgetExhausted() method
- `src/change-detector/llm-diff-fallback.ts` - Updated two stale comments referencing llm_jobs table to reference LLM broker/submitJob
- `src/mcp-server.ts` - Replaced coordinator.isLlmBudgetExhausted() call with inline false literal

## Decisions Made
- isLlmBudgetExhausted() caller in mcp-server.ts get_llm_status was updated to `budgetExhausted: false` as a direct inline literal — keeping the field in the response for API stability while removing the dead method

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed broken mcp-server.ts caller of deleted isLlmBudgetExhausted()**
- **Found during:** Task 1 (TypeScript compile check after removing isLlmBudgetExhausted())
- **Issue:** mcp-server.ts line 661 called coordinator.isLlmBudgetExhausted() which was deleted as part of the plan — TypeScript error TS2339
- **Fix:** Replaced the call with inline `false` literal (budget is a broker concern; always false from the coordinator's perspective)
- **Files modified:** src/mcp-server.ts
- **Verification:** npx tsc --noEmit exits with code 0
- **Committed in:** 3e444c2 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug)
**Impact on plan:** Necessary fix directly caused by removing the method. No scope creep.

## Issues Encountered
- 1 pre-existing test failure (PID guard test in coordinator.test.ts) confirmed present before any changes — not caused by this plan.

## User Setup Required
None - no external service configuration required.

## Self-Check: PASSED

All modified files exist on disk. Task commit 3e444c2 confirmed in git log. TypeScript compiles clean. Build succeeds.

## Next Phase Readiness
- Phase 18 cleanup complete: all isExhausted vestiges removed, all stale comments updated
- Phase 19 (observability) ready to proceed — get_llm_status can be enhanced to report real broker stats

---
*Phase: 18-cleanup*
*Completed: 2026-03-22*
