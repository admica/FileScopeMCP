---
phase: 16-shared-llm-queue
plan: 01
subsystem: infra
tags: [broker, ipc, priority-queue, zod, typescript]

# Dependency graph
requires: []
provides:
  - Wire protocol message types (SubmitMessage, StatusMessage, ResultMessage, ErrorMessage)
  - Internal QueueJob type with cancelled/createdAt/connection fields
  - BrokerConfig Zod schema with loadBrokerConfig auto-copy behavior
  - FILESCOPE_DIR, SOCK_PATH, PID_PATH, LOG_PATH, CONFIG_PATH path constants
  - PriorityQueue class with importance DESC / createdAt ASC ordering, dedup, and connection-drop
affects: [16-02, 17, 18, 19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy deletion: mark heap entry cancelled, dedup map is source of truth for active jobs"
    - "Auto-copy default config on first run via fileURLToPath(new URL('.', import.meta.url))"
    - "Fail-fast on invalid config with safeParse + process.exit(1)"
    - "dedupKey helper: repoPath|filePath|jobType string key for dedup map"

key-files:
  created:
    - src/broker/types.ts
    - src/broker/config.ts
    - src/broker/queue.ts
  modified: []

key-decisions:
  - "dedupKey as exported runtime function (not just type) so queue.ts can import it from types.ts"
  - "size getter returns dedupMap.size not heap.length — dedup map is authoritative active count"
  - "loadBrokerConfig is async-shaped but internally synchronous — sync fs calls at startup before async work"
  - "BrokerLLMSchema excludes enabled/maxTokensPerMinute/tokenBudget from LLMConfig — broker-specific subset"

patterns-established:
  - "Pattern 1: All broker modules under src/broker/ with explicit .js extensions for ESM imports"
  - "Pattern 2: Dedup map + heap with lazy deletion — dedup map is source of truth for size"
  - "Pattern 3: Path constants exported as module-level consts from config.ts, imported by all broker modules"

requirements-completed: [BROKER-02, BROKER-03, BROKER-05, BROKER-06]

# Metrics
duration: 8min
completed: 2026-03-22
---

# Phase 16 Plan 01: Broker Foundation Summary

**In-memory priority queue with heap+dedup+lazy-deletion, Zod-validated broker.json config with auto-copy, and NDJSON wire protocol types for the standalone LLM broker**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-03-22T13:59:31Z
- **Completed:** 2026-03-22T14:07:00Z
- **Tasks:** 3
- **Files modified:** 3 (all created)

## Accomplishments
- Wire protocol types for all 4 message variants plus internal QueueJob and JobResult shapes
- Broker config loading with Zod validation, directory creation, and default config auto-copy on first run
- Binary min-heap priority queue with dedup map and lazy deletion, correct importance DESC / createdAt ASC ordering

## Task Commits

Each task was committed atomically:

1. **Task 1: Create broker message types and job shapes** - `c637edc` (feat)
2. **Task 2: Create broker config loader with auto-copy and Zod validation** - `506becf` (feat)
3. **Task 3: Create priority queue with heap, dedup map, and lazy deletion** - `6d80f35` (feat)

## Files Created/Modified
- `src/broker/types.ts` - Wire protocol types (SubmitMessage, ResultMessage, etc.), QueueJob, JobResult, StatusResponse, dedupKey
- `src/broker/config.ts` - BrokerConfigSchema, loadBrokerConfig, path constants (FILESCOPE_DIR, SOCK_PATH, PID_PATH, LOG_PATH)
- `src/broker/queue.ts` - PriorityQueue class: enqueue, dequeue, dropByConnection, peek, size getter

## Decisions Made
- `dedupKey` exported as a runtime function from types.ts so queue.ts can import it without circular dependency
- `size` getter uses `dedupMap.size` not `heap.length` since cancelled ghost entries inflate the heap count
- `loadBrokerConfig` is async-shaped but uses synchronous fs calls internally — startup sequencing is inherently sequential before any async work begins
- BrokerLLMSchema omits `enabled`, `maxTokensPerMinute`, `tokenBudget` from the instance LLMConfig shape — broker always runs, no per-call rate limits, no lifetime budget

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None - all three files compiled without TypeScript errors on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three foundation modules ready for Plan 02 (broker server + worker)
- Plan 02 can import from `./types.js`, `./config.js`, `./queue.js` with full type safety
- `broker.default.json` already exists at repo root and will be auto-copied to `~/.filescope/broker.json` on first broker run

---
*Phase: 16-shared-llm-queue*
*Completed: 2026-03-22*
