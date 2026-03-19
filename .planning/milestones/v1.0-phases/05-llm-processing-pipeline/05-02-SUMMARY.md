---
phase: 05-llm-processing-pipeline
plan: 02
subsystem: llm
tags: [ai-sdk, generateText, structured-output, sqlite, vitest, rate-limiting]

# Dependency graph
requires:
  - phase: 05-llm-processing-pipeline/05-01
    provides: adapter, rate-limiter, prompts, repository job management functions, types
  - phase: 04-cascade-engine-staleness
    provides: clearStaleness, staleness columns, isExcluded exclude check (COMPAT-02)
provides:
  - LLMPipeline class with start/stop/isRunning/getBudgetGuard API
  - Self-scheduling dequeueLoop consuming llm_jobs table
  - summary, concepts, change_impact job type dispatch
  - Ollama JSON repair fallback for structured output
  - COMPAT-02 exclude check before dispatch
  - File-deleted detection without retry
  - Orphaned job recovery on start
  - isExcluded exported from file-utils.ts
  - 7 unit tests covering all required pipeline behaviors
affects:
  - 05-llm-processing-pipeline/05-03 (persistence wiring, getBudgetGuard)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Self-scheduling setTimeout loop (not setInterval) for dequeue backpressure
    - Ollama JSON repair: structured output failure falls back to plain generateText + JSON.parse
    - readFileOrFail: ENOENT -> markJobFailed('file_deleted') + clearStaleness + rethrow
    - .unref() on loop timers to prevent keeping event loop alive during shutdown

key-files:
  created:
    - src/llm/pipeline.ts
    - src/llm/pipeline.test.ts
  modified:
    - src/file-utils.ts

key-decisions:
  - "maxOutputTokens (not maxTokens) is the correct generateText parameter in ai@6 — LanguageModelV2 CallSettings uses maxOutputTokens"
  - "Ollama JSON repair fallback: structured output failures fall back to plain generateText and JSON.parse on the text response"
  - "readFileOrFail pattern: ENOENT marks job failed with 'file_deleted' and clears staleness without retry"
  - "scheduleNext uses .unref() on NodeJS.Timeout to prevent keeping event loop alive during process shutdown"

patterns-established:
  - "Self-scheduling dequeue loop: each async iteration schedules next via setTimeout (not setInterval) — allows natural backpressure"
  - "Budget guard check before markJobInProgress — prevents partially-in-flight jobs when rate limited"

requirements-completed: [LLM-01, LLM-02, LLM-03, LLM-08, COMPAT-02]

# Metrics
duration: 12min
completed: 2026-03-18
---

# Phase 5 Plan 2: LLMPipeline Dequeue Loop Summary

**LLMPipeline class with self-scheduling dequeue loop, 3 job type dispatch (summary/concepts/change_impact), rate limiting, COMPAT-02 exclude check, and 7 vitest unit tests with fake timers**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-18T05:20:00Z
- **Completed:** 2026-03-18T05:33:00Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- LLMPipeline class processes pending llm_jobs and writes results/clears staleness back to SQLite
- All 3 job types handled: summary (plain text), concepts (structured JSON), change_impact (structured JSON)
- Ollama JSON repair fallback: if Output.object() structured call fails, falls back to plain generateText + JSON.parse
- COMPAT-02 exclude check: files matching project exclusion patterns are skipped without LLM call
- Deleted file detection: ENOENT on readFile marks job failed with 'file_deleted' and clears staleness
- Orphaned in_progress jobs recovered to pending on start()
- Rate limit / budget guard checked before dispatching — backoff at 30s when exceeded
- isExcluded exported from file-utils.ts (additive, no breaking change)
- 7 vitest unit tests using fake timers cover all required behaviors with mocked dependencies

## Task Commits

Each task was committed atomically:

1. **Task 1: Export isExcluded and build LLMPipeline** - `6d3cb3c` (feat)
2. **Task 2: LLMPipeline unit tests** - `405fc34` (test)

## Files Created/Modified
- `src/llm/pipeline.ts` - LLMPipeline class with full dequeue loop and 3 job type handlers
- `src/llm/pipeline.test.ts` - 7 unit tests covering all 6 required behaviors + 1 bonus (successful summary)
- `src/file-utils.ts` - isExcluded function exported (one-word additive change)

## Decisions Made
- `maxOutputTokens` (not `maxTokens`) is the correct generateText parameter in ai@6 — caught during TypeScript compile; fixed inline (Rule 1 auto-fix)
- Ollama JSON repair fallback implemented as nested try/catch within each structured output job branch
- `readFileOrFail` private method encapsulates ENOENT handling to avoid repetition across summary/concepts branches
- `.unref()` on setTimeout handles prevents event loop keep-alive during graceful shutdown

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] maxTokens -> maxOutputTokens for ai@6 generateText API**
- **Found during:** Task 1 (TypeScript compilation verification)
- **Issue:** Plan specified `maxTokens` but ai@6 CallSettings uses `maxOutputTokens` — caused 5 TypeScript errors
- **Fix:** Replaced all 5 occurrences of `maxTokens` with `maxOutputTokens` in pipeline.ts
- **Files modified:** src/llm/pipeline.ts
- **Verification:** `npx tsc --noEmit` passes with 0 errors
- **Committed in:** 6d3cb3c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary correctness fix. No scope creep.

## Issues Encountered
- ai@6 API: `maxTokens` was the plan-specified parameter but ai@6 uses `maxOutputTokens` in `CallSettings`. Caught immediately during TypeScript compile check, fixed inline.

## Next Phase Readiness
- LLMPipeline fully operational; ready for Plan 03 (persistence wiring: budget state persistence, coordinator integration)
- getBudgetGuard() accessor ready for Plan 03 lifetime token persistence
- All 164 tests pass (no regressions)

---
*Phase: 05-llm-processing-pipeline*
*Completed: 2026-03-18*

## Self-Check: PASSED
- src/llm/pipeline.ts: FOUND
- src/llm/pipeline.test.ts: FOUND
- 05-02-SUMMARY.md: FOUND
- Commit 6d3cb3c: FOUND
- Commit 405fc34: FOUND
