---
phase: 17-instance-client-pipeline-wiring
plan: 02
subsystem: llm
tags: [broker, wiring, coordinator, cascade-engine, llm-diff-fallback, toggle-llm, esbuild]

requires:
  - phase: 17-instance-client-pipeline-wiring
    plan: 01
    provides: src/broker/client.ts with connect/disconnect/submitJob/isConnected exports

provides:
  - cascade-engine.ts wired to submitJob() — staleness propagation routes through broker
  - llm-diff-fallback.ts wired to submitJob() — diff jobs route through broker
  - coordinator.ts broker lifecycle via connectBroker/disconnectBroker — no LLMPipeline
  - mcp-server.ts toggle_llm simplified to broker connect/disconnect
  - dist/broker/client.js produced by esbuild

affects: [coordinator.ts, cascade-engine.ts, llm-diff-fallback.ts, mcp-server.ts, package.json]

tech-stack:
  added: []
  patterns:
    - "submitJob(filePath, jobType, importance, fileContent, payload?) — fire-and-forget broker submission"
    - "isExhausted: () => false — stub preserved for Phase 18 removal, broker handles capacity"
    - "connectBroker/disconnectBroker as public coordinator methods — mcp-server calls directly"

key-files:
  created: []
  modified:
    - src/cascade/cascade-engine.ts
    - src/change-detector/llm-diff-fallback.ts
    - src/coordinator.ts
    - src/mcp-server.ts
    - package.json

key-decisions:
  - "isExhausted parameter signatures left in cascadeStale/markSelfStale — Phase 18 CLEAN-05 removes them"
  - "cascade-engine.ts reads file content inline for broker submission — readFileSync already imported"
  - "coordinator.toggleLlm() made async — await connectBroker() propagates async spawn correctly"
  - "Pre-existing TypeScript errors in adapter.ts/pipeline.ts are Phase 18 cleanup targets — not caused by Plan 02"

requirements-completed: [PIPE-01, CONF-03]

duration: 4min
completed: 2026-03-22
---

# Phase 17 Plan 02: Instance Client and Pipeline Wiring Summary

**All LLM callers wired to submitJob() via broker client; coordinator lifecycle replaced with connectBroker/disconnectBroker; toggle_llm simplified; esbuild produces dist/broker/client.js**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-22T16:26:06Z
- **Completed:** 2026-03-22T16:29:57Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Replaced all `insertLlmJobIfNotPending()` calls in cascade-engine.ts and llm-diff-fallback.ts with `submitJob()` from broker/client.ts — file content and importance are read at call site and passed to the broker
- Removed LLMPipeline from coordinator.ts: dropped import, private field, startLlmPipeline, stopLlmPipeline, and loadLlmRuntimeState/saveLlmRuntimeState repository imports
- Added public `connectBroker()` and `disconnectBroker()` methods to coordinator; `init()` now awaits `connectBroker()`, `shutdown()` calls `disconnectBroker()`
- All 4 `isExhausted: () => this.isLlmBudgetExhausted()` call sites replaced with `isExhausted: () => false` — broker manages capacity
- `toggle_llm` MCP handler rewritten: no more synthesized LLM config with provider/model/baseURL; simply calls `coordinator.connectBroker()` or `coordinator.disconnectBroker()` and persists `enabled` boolean
- Added `src/broker/client.ts` to esbuild command; `dist/broker/client.js` now produced alongside other broker modules
- `npm run build` passes with exit 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace insertLlmJobIfNotPending with submitJob** - `98e1ed2` (feat)
2. **Task 2: Rewire coordinator, mcp-server toggle_llm, update esbuild** - `e864bd1` (feat)

## Files Created/Modified

- `src/cascade/cascade-engine.ts` — imports submitJob+getFile from broker/repository; cascadeStale and markSelfStale read file content and call submitJob instead of insertLlmJobIfNotPending
- `src/change-detector/llm-diff-fallback.ts` — imports readFileSync, getFile, submitJob; queueLlmDiffJob reads file content and calls submitJob
- `src/coordinator.ts` — LLMPipeline removed, broker lifecycle via connectBroker/disconnectBroker, 4 isExhausted callbacks simplified to () => false
- `src/mcp-server.ts` — toggle_llm handler rewritten to connect/disconnect broker, no model config synthesis
- `package.json` — src/broker/client.ts added to esbuild entry points

## Decisions Made

- `isExhausted` parameter kept in cascadeStale/markSelfStale signatures — Phase 18 CLEAN-05 removes them; callers stub with `() => false`
- `coordinator.toggleLlm()` became async to properly await `connectBroker()` which in turn awaits broker spawn + socket connect
- Pre-existing TypeScript errors in `src/llm/adapter.ts` and `src/llm/pipeline.ts` (from LLMConfig simplification in Plan 01) are intentional; those files are Phase 18 deletion targets

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in adapter.ts and pipeline.ts (16 errors total). These were introduced in Plan 01 when LLMConfig was stripped to `enabled?: boolean`. They are Phase 18 cleanup targets. `npm run build` (esbuild) succeeds with no errors; `npx tsc --noEmit` errors are isolated to the two dead-code modules.

## User Setup Required

None.

## Next Phase Readiness

- Phase 18 cleanup can now safely delete src/llm/pipeline.ts, src/llm/adapter.ts, src/llm/rate-limiter.ts, remove insertLlmJobIfNotPending from repository.ts, and remove isExhausted parameters from cascadeStale/markSelfStale
- Phase 19 observability can wire broker stats into get_llm_status

---
*Phase: 17-instance-client-pipeline-wiring*
*Completed: 2026-03-22*
