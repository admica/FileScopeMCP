---
phase: 17-instance-client-pipeline-wiring
plan: 01
subsystem: llm
tags: [broker, unix-socket, ndjson, reconnect, stale-resubmission, llm-config]

requires:
  - phase: 16-broker-core
    provides: broker binary at dist/broker/main.js, SOCK_PATH in config.ts, SubmitMessage/BrokerMessage types in types.ts, writeLlmResult/clearStaleness in repository.ts

provides:
  - src/broker/client.ts — singleton broker client with connect, disconnect, submitJob, isConnected
  - Simplified LLMConfig with enabled-only (model config migrated to broker.json)
  - Auto-spawn broker if socket missing on connect
  - 10s reconnect timer (unref'd) on unexpected disconnect
  - Stale file resubmission on every successful connect

affects: [coordinator.ts, pipeline.ts, adapter.ts, 17-02-pipeline-wiring]

tech-stack:
  added: []
  patterns:
    - "Broker client as module-level singleton with socket/reconnectTimer/repoPath/_intentionalDisconnect state"
    - "Best-effort connect — resolves (not rejects) on socket error"
    - "fire-and-forget submitJob — silently drops if not connected"
    - "reconnectTimer.unref() prevents timer from blocking process exit"
    - "resubmitStaleFiles called on every connect event (not just first connect)"

key-files:
  created:
    - src/broker/client.ts
  modified:
    - src/llm/types.ts

key-decisions:
  - "LLMConfig now has only enabled?: boolean — all model/provider/token fields removed from instance config"
  - "resubmitStaleFiles uses raw SQL (getSqlite().prepare) not Drizzle ORM — matches pattern of other staleness queries in repository.ts"
  - "spawnBrokerIfNeeded: 500ms wait after spawn before attemptConnect, wrapped in try/catch to never throw"
  - "sock.on('close') handler checks _intentionalDisconnect to avoid spurious reconnect on graceful shutdown"

patterns-established:
  - "Module-level singleton for broker connection state — one connection per instance process"
  - "NDJSON over net.Socket using readline.createInterface — same pattern as broker server"

requirements-completed: [CONF-01, CONF-02, CLIENT-01, CLIENT-02, CLIENT-03, CLIENT-04, CLIENT-05]

duration: 2min
completed: 2026-03-22
---

# Phase 17 Plan 01: Instance Client and LLM Config Simplification Summary

**Unix-socket broker client with auto-spawn, 10s reconnect, and stale-file resubmission; LLMConfig simplified to enabled-only boolean**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-22T16:21:24Z
- **Completed:** 2026-03-22T16:23:27Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Stripped LLMConfig down to `enabled?: boolean` — all model/provider/token fields removed since the broker now owns LLM configuration via broker.json
- Created `src/broker/client.ts`: 256-line module-level singleton managing the full Unix socket lifecycle (auto-spawn, connect, reconnect, stale resubmission, result persistence)
- Confirmed zero errors in broker/client.ts; only expected errors in coordinator.ts/pipeline.ts/adapter.ts which Plan 02 will remove

## Task Commits

Each task was committed atomically:

1. **Task 1: Simplify LLMConfig to enabled-only** - `c4099fe` (feat)
2. **Task 2: Create broker client module** - `d0b7138` (feat)

**Plan metadata:** committed with docs commit below

## Files Created/Modified

- `src/llm/types.ts` - LLMConfig and LLMConfigSchema reduced to enabled-only; ConceptsSchema and ChangeImpactSchema unchanged
- `src/broker/client.ts` - New broker client module with connect, disconnect, submitJob, isConnected exports

## Decisions Made

- Used raw `getSqlite().prepare()` for `resubmitStaleFiles` to match the pattern of other staleness queries in repository.ts and avoid Drizzle ORM overhead on the reconnect hot path
- `spawnBrokerIfNeeded` uses a 500ms wait after spawn, wrapped in try/catch so broker spawn failures are logged but never fatal to the connect flow
- `sock.on('close')` distinguishes intentional from accidental disconnects via `_intentionalDisconnect` flag to avoid reconnect loop on graceful shutdown

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 (pipeline wiring) can now wire `broker/client.ts` into coordinator init/shutdown and replace pipeline.ts/adapter.ts invocations
- Expected TypeScript errors in coordinator.ts, adapter.ts, pipeline.ts will be resolved in Plan 02 when those modules are removed/replaced

---
*Phase: 17-instance-client-pipeline-wiring*
*Completed: 2026-03-22*
