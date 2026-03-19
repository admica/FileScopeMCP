---
phase: 08-integration-fixes
plan: 01
subsystem: database
tags: [sqlite, llm-pipeline, cascade-engine, circuit-breaker, dedup, change-detection]

# Dependency graph
requires:
  - phase: 07-fix-change-impact-pipeline
    provides: cascadeStale with changeContext, insertLlmJobIfNotPending with payload, queueLlmDiffJob wired to git diff

provides:
  - insertLlmJobIfNotPending used exclusively in llm-diff-fallback (no duplicate change_impact jobs)
  - isExhausted? circuit breaker in cascadeStale and markSelfStale (jobs blocked when budget exhausted, staleness always applied)
  - ServerCoordinator exposes isLlmBudgetExhausted, getLlmLifetimeTokensUsed, getLlmTokenBudget, getLlmMaxTokensPerMinute
  - file-utils.ts free of commented-out console.warn dead code

affects: [09-mcp-tools, get_llm_status tool, any plan that checks budget state]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Budget exhaustion circuit breaker: isExhausted?.() optional callback in cascade opts — guard wraps job insertions only, staleness marks always run
    - Coordinator budget delegation: four public methods proxy llmPipeline.getBudgetGuard() or getConfig().llm for token budget info

key-files:
  created: []
  modified:
    - src/change-detector/llm-diff-fallback.ts
    - src/cascade/cascade-engine.ts
    - src/coordinator.ts
    - src/file-utils.ts
    - src/cascade/cascade-engine.test.ts
    - src/change-detector/change-detector.test.ts

key-decisions:
  - "isExhausted circuit breaker is optional callback (isExhausted?: () => boolean) — absent = unlimited (backward compat)"
  - "Staleness marks always apply regardless of budget exhaustion — jobs will queue when budget resets"
  - "getLlmTokenBudget and getLlmMaxTokensPerMinute read from getConfig().llm rather than pipeline internals — config is source of truth"

patterns-established:
  - "Circuit breaker pattern: wrap job insertion in if (!isExhausted?.()) — staleness SQL stays outside guard"
  - "Coordinator budget methods: proxy to getBudgetGuard() for runtime state; proxy to getConfig() for config values"

requirements-completed: [CHNG-03, LLM-07]

# Metrics
duration: 4min
completed: 2026-03-18
---

# Phase 8 Plan 01: Integration Fixes — Dedup, Budget Circuit Breaker, Coordinator Budget Methods Summary

**LLM job dedup via insertLlmJobIfNotPending in diff-fallback, isExhausted circuit breaker in cascade engine preventing queue bloat when token budget is exhausted, and 4 new budget delegation methods on ServerCoordinator**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-18T23:03:18Z
- **Completed:** 2026-03-18T23:06:46Z
- **Tasks:** 2 (Task 1 TDD, Task 2 chore)
- **Files modified:** 6

## Accomplishments
- Fixed CHNG-03: `queueLlmDiffJob` now uses `insertLlmJobIfNotPending` instead of raw `insertLlmJob` — rapid file changes cannot produce duplicate change_impact jobs
- Fixed LLM-07: `cascadeStale` and `markSelfStale` accept `isExhausted?` callback — job insertions are blocked when budget is exhausted, but staleness marks always run so jobs re-queue when budget resets
- Added 4 new public methods to `ServerCoordinator` (`isLlmBudgetExhausted`, `getLlmLifetimeTokensUsed`, `getLlmTokenBudget`, `getLlmMaxTokensPerMinute`) for downstream use by Plan 02's `get_llm_status` MCP tool
- Wired `isExhausted` into all 3 cascade/markSelfStale call sites in coordinator.ts
- Removed 3 commented-out `console.warn` dead-code lines from file-utils.ts
- 180 tests passing (4 new circuit-breaker + dedup source tests added)

## Task Commits

Each task was committed atomically:

1. **Task 1: Dedup fix + circuit breaker + coordinator budget methods** - `0ecebc2` (feat)
2. **Task 2: Remove commented-out console.warn lines in file-utils.ts** - `a3dfd8b` (chore)

**Plan metadata:** (docs commit follows)

_Note: Task 1 used TDD — failing tests written first, then implementation to pass._

## Files Created/Modified
- `src/change-detector/llm-diff-fallback.ts` - Replaced `insertLlmJob` import/call with `insertLlmJobIfNotPending` (dedup)
- `src/cascade/cascade-engine.ts` - Added `isExhausted?` to opts of `cascadeStale` and `markSelfStale`; guarded job insertions
- `src/coordinator.ts` - Added 4 budget delegation methods; wired `isExhausted` into all cascade call sites
- `src/file-utils.ts` - Removed 3 commented-out `console.warn` lines
- `src/cascade/cascade-engine.test.ts` - 3 new circuit-breaker tests (isExhausted=true/false guard behavior)
- `src/change-detector/change-detector.test.ts` - 1 new dedup source-check test

## Decisions Made
- `isExhausted` circuit breaker uses optional callback `() => boolean` on opts — missing/undefined = `isExhausted?.()` evaluates false, preserving backward compatibility
- Staleness marks are unconditional (always applied) so that when budget resets the pending staleness is already recorded and jobs get re-queued
- `getLlmTokenBudget` and `getLlmMaxTokensPerMinute` read from `getConfig().llm` rather than accessing private `LLMPipeline.config` — avoids `(this as any)` casting; config is the source of truth for these values

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `isLlmBudgetExhausted()`, `getLlmLifetimeTokensUsed()`, `getLlmTokenBudget()`, `getLlmMaxTokensPerMinute()` are ready for Plan 02's `get_llm_status` MCP tool
- All 180 tests pass, TypeScript compiles cleanly
- No blockers

---
*Phase: 08-integration-fixes*
*Completed: 2026-03-18*
