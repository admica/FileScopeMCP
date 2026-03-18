---
phase: 05-llm-processing-pipeline
plan: 03
subsystem: api
tags: [llm, pipeline, coordinator, mcp, budget, persistence]

# Dependency graph
requires:
  - phase: 05-llm-processing-pipeline
    provides: LLMPipeline class with start/stop/getBudgetGuard, TokenBudgetGuard with setLifetimeTokensUsed/getLifetimeTokensUsed, loadLlmRuntimeState/saveLlmRuntimeState in repository
provides:
  - LLMPipeline lifecycle managed in ServerCoordinator (starts in init, stops in shutdown)
  - Budget state persisted across restarts via llm_runtime_state table
  - toggle_llm MCP tool for runtime pipeline enable/disable with config persistence
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - LLMPipeline started non-blocking (no await) after _initialized=true in coordinator.init()
    - Pipeline stopped before DB close in shutdown() to allow budget save
    - Token budget persisted via saveLlmRuntimeState before stop, restored via loadLlmRuntimeState on start

key-files:
  created: []
  modified:
    - src/coordinator.ts
    - src/mcp-server.ts

key-decisions:
  - "LLM pipeline start is non-blocking (no await) — prevents blocking coordinator init per RESEARCH.md anti-pattern 6"
  - "stopLlmPipeline() called before closeDatabase() in shutdown() — budget save requires open DB"
  - "toggle_llm persists llm.enabled to config file — restart respects the toggle without user reconfiguring"
  - "toggleLlm creates minimal llm config (provider=anthropic, model=claude-3-haiku) if config.llm is missing when enabling"

patterns-established:
  - "Coordinator owns pipeline lifecycle: start in init(), stop in shutdown(), toggle via public method"
  - "Budget persistence: getLifetimeTokensUsed() before stop, setLifetimeTokensUsed() on start"

requirements-completed: [LLM-06, LLM-07]

# Metrics
duration: 8min
completed: 2026-03-18
---

# Phase 5 Plan 03: LLM Pipeline Lifecycle Wiring Summary

**LLMPipeline wired into ServerCoordinator lifecycle with budget persistence across restarts and toggle_llm MCP tool for runtime control**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-18T05:30:00Z
- **Completed:** 2026-03-18T05:38:37Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- LLMPipeline starts automatically in coordinator.init() when llm.enabled=true (non-blocking)
- Pipeline shutdown wired into coordinator.shutdown() before DB close, with budget state saved to SQLite
- Lifetime token budget persists across restarts via llm_runtime_state table (key: 'lifetime_tokens_used')
- toggle_llm MCP tool registered: enables/disables pipeline at runtime, persists setting to config file
- All 164 existing tests continue to pass (COMPAT-03 verified)

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire LLMPipeline into coordinator lifecycle** - `fff427a` (feat)
2. **Task 2: Register toggle_llm MCP tool** - `43a3178` (feat)

**Plan metadata:** committed with docs commit below

## Files Created/Modified
- `src/coordinator.ts` - Added LLMPipeline field, startLlmPipeline/stopLlmPipeline private methods, toggleLlm/isLlmRunning public methods, pipeline start in init(), stop in shutdown()
- `src/mcp-server.ts` - Added toggle_llm tool registration with z.boolean() param, config persistence

## Decisions Made
- LLM pipeline start is non-blocking (no await) per RESEARCH.md anti-pattern 6 — prevents blocking coordinator init
- stopLlmPipeline() is called before closeDatabase() in shutdown() — budget state save requires open DB
- toggle_llm tool persists llm.enabled to config file so restart respects the setting
- When enabling with no existing llm config, creates minimal config (anthropic/claude-3-haiku-20240307)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 5 LLM Processing Pipeline is fully complete end-to-end:
- Plan 01: DB schema, LLM types, prompts, adapter, rate limiter
- Plan 02: LLMPipeline dequeue loop (summary/concepts/change_impact), job queue integration
- Plan 03: Coordinator lifecycle wiring, budget persistence, MCP toggle tool

The entire pipeline is operational. LLMs can query file summaries/concepts, the pipeline auto-processes stale files, and operators can control the pipeline via the toggle_llm MCP tool.

---
*Phase: 05-llm-processing-pipeline*
*Completed: 2026-03-18*
