---
phase: 18-cleanup
plan: 01
subsystem: database
tags: [sqlite, drizzle, migration, cleanup, broker, tests]

# Dependency graph
requires:
  - phase: 17-instance-client-pipeline-wiring
    provides: broker client (submitJob) replacing all insertLlmJobIfNotPending callers
provides:
  - DB migration dropping llm_jobs and llm_runtime_state tables
  - Clean schema.ts without legacy job queue table definitions
  - Clean repository.ts without 9 dead CRUD functions
  - Tests using submitJob mock instead of llm_jobs table queries
affects: [19-observability, any future schema migrations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "createLLMModel inlined into broker/worker.ts — sole consumer after adapter.ts deletion"
    - "cascade-engine tests use tmpDir real file paths — cascade BFS requires files on disk"

key-files:
  created:
    - drizzle/0003_drop_legacy_llm_tables.sql
  modified:
    - drizzle/meta/_journal.json
    - src/db/schema.ts
    - src/db/repository.ts
    - src/broker/worker.ts
    - src/cascade/cascade-engine.test.ts
    - src/change-detector/change-detector.test.ts
    - src/change-detector/types.test.ts
    - src/db/db.test.ts
    - src/coordinator.ts
    - package.json

key-decisions:
  - "createLLMModel inlined into broker/worker.ts rather than moved to broker/utils.ts — single consumer, no new abstraction needed"
  - "Cascade test files must use tmpDir real paths — cascade-engine reads files from disk before submitJob; fake paths cause BFS to terminate early"
  - "db.test.ts updated to assert llm_jobs NOT present — migration 0003 drops it, old assertions were wrong post-cleanup"

patterns-established:
  - "Test isolation: vi.mock at module level with mockClear in beforeEach — prevents cross-test mock pollution"

requirements-completed: [CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04]

# Metrics
duration: 45min
completed: 2026-03-22
---

# Phase 18 Plan 01: Legacy LLM Job Queue Removal Summary

**Drizzle migration dropping llm_jobs/llm_runtime_state, 9 dead CRUD functions purged from repository.ts, deleted pipeline.ts/rate-limiter.ts/adapter.ts, and all tests rewired from llm_jobs queries to submitJob mock**

## Performance

- **Duration:** 45 min
- **Started:** 2026-03-22T18:00:00Z
- **Completed:** 2026-03-22T18:10:42Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments

- Created drizzle/0003_drop_legacy_llm_tables.sql — drops llm_jobs and llm_runtime_state on DB init for all existing deployments
- Removed 4 dead source files: pipeline.ts, rate-limiter.ts, adapter.ts, pipeline.test.ts; removed from esbuild
- Deleted 9 dead CRUD functions from repository.ts (insertLlmJobIfNotPending, insertLlmJob, dequeueNextJob, markJobInProgress, markJobDone, markJobFailed, recoverOrphanedJobs, loadLlmRuntimeState, saveLlmRuntimeState)
- Rewrote all test files to mock `submitJob` from broker/client.js instead of querying llm_jobs table

## Task Commits

1. **Task 1: DB migration, schema cleanup, file deletions, and esbuild update** - `4845514` (chore)
2. **Task 2: Remove dead CRUD functions from repository.ts and fix all test files** - `ac3beed` (feat)

## Files Created/Modified

- `drizzle/0003_drop_legacy_llm_tables.sql` - Created: DROP TABLE IF EXISTS llm_jobs/llm_runtime_state
- `drizzle/meta/_journal.json` - Added entry idx 3 for 0003_drop_legacy_llm_tables migration
- `src/db/schema.ts` - Removed llm_jobs and llm_runtime_state table definitions
- `src/db/repository.ts` - Removed llm_jobs import, deleted 9 dead functions
- `src/broker/worker.ts` - Inlined createLLMModel (adapter.ts deleted)
- `src/cascade/cascade-engine.test.ts` - Mocked submitJob, use tmpDir real paths, deleted isExhausted block
- `src/change-detector/change-detector.test.ts` - Mocked submitJob, removed llm_jobs table/queries
- `src/change-detector/types.test.ts` - Removed insertLlmJob import and describe block
- `src/db/db.test.ts` - Updated to assert llm_jobs/llm_runtime_state do NOT exist after migration
- `src/coordinator.ts` - Updated stale comment referencing insertLlmJobIfNotPending
- `package.json` - Removed adapter.ts, pipeline.ts, rate-limiter.ts from esbuild entries

## Decisions Made

- **createLLMModel inlined into broker/worker.ts** — adapter.ts was the only source; broker/worker.ts is the only caller. Inlining avoids creating a new file just to hold one function.
- **Cascade test files must use real tmpDir paths** — cascade-engine.ts reads file content via `readFileSync` before calling `submitJob`. If the file doesn't exist on disk, the BFS `continue` skips dependent expansion. Tests with fake paths like `/A.ts` would only visit 1 file instead of the full chain.
- **db.test.ts assertions flipped** — the old tests expected `llm_jobs` to exist after migration. Now that migration 0003 drops it, the tests correctly assert it does NOT exist.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Inlined createLLMModel from deleted adapter.ts into broker/worker.ts**
- **Found during:** Task 2 (TypeScript check after deletions)
- **Issue:** `broker/worker.ts` still imported `createLLMModel` from `../llm/adapter.js` which was deleted in Task 1
- **Fix:** Inlined the 20-line `createLLMModel` function directly into worker.ts, updated import to use `@ai-sdk/anthropic` and `@ai-sdk/openai-compatible` directly, changed `config.llm as any` cast to `config.llm` with `BrokerConfig['llm']` type
- **Files modified:** src/broker/worker.ts
- **Verification:** tsc --noEmit passes, npm run build passes
- **Committed in:** ac3beed (Task 2 commit)

**2. [Rule 1 - Bug] Cascade test files required real file paths in tmpDir**
- **Found during:** Task 2 (test run showing cascade tests failing)
- **Issue:** cascade-engine.ts reads file content with `readFileSync` before calling `submitJob`. When file doesn't exist on disk, the `continue` statement skips BFS expansion — only 1 file visited instead of the full chain. Old tests used fake paths like `/A.ts` that worked because insertLlmJobIfNotPending didn't need to read files.
- **Fix:** Updated cascade-engine.test.ts to use `path.join(tmpDir, 'filename.ts')` paths and call `writeFileSync` in `insertFile` helper to create actual files
- **Files modified:** src/cascade/cascade-engine.test.ts
- **Verification:** All 13 cascade tests pass
- **Committed in:** ac3beed (Task 2 commit)

**3. [Rule 1 - Bug] change-detector/types.test.ts had stale insertLlmJob import**
- **Found during:** Task 2 (TypeScript check)
- **Issue:** types.test.ts imported `insertLlmJob` from repository.ts which was deleted
- **Fix:** Removed import and entire `describe('insertLlmJob', ...)` describe block
- **Files modified:** src/change-detector/types.test.ts
- **Verification:** tsc --noEmit passes
- **Committed in:** ac3beed (Task 2 commit)

**4. [Rule 1 - Bug] db.test.ts assertions expected deleted tables to exist**
- **Found during:** Task 2 (test run)
- **Issue:** Two tests expected `llm_jobs` and `llm_runtime_state` to exist after migration, but migration 0003 now drops them
- **Fix:** Updated tests to assert tables do NOT exist (with `toContain` flipped to `not.toContain`)
- **Files modified:** src/db/db.test.ts
- **Verification:** Both updated db tests pass
- **Committed in:** ac3beed (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (1 blocking import, 3 test correctness bugs)
**Impact on plan:** All fixes necessary for correctness after adapter.ts deletion and submitJob migration. No scope creep.

## Issues Encountered

- Pre-existing `coordinator.test.ts > init throws "already running"` failure exists before and after our changes (confirmed via `git stash` check). Out of scope for this plan.

## Next Phase Readiness

- All legacy LLM job queue artifacts removed from codebase
- Schema, repository, and tests are clean
- Ready for Phase 18 Plan 02 (isExhausted parameter removal and remaining cleanup)

---
*Phase: 18-cleanup*
*Completed: 2026-03-22*
