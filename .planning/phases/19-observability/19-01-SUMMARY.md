---
phase: 19-observability
plan: 01
subsystem: infra
tags: [broker, stats, tokens, observability, sqlite]

# Dependency graph
requires:
  - phase: 16-shared-llm-queue
    provides: broker server, queue, worker, types, config constants (FILESCOPE_DIR)
  - phase: 17-instance-client-pipeline-wiring
    provides: broker client, submitJob wiring
  - phase: 18-cleanup
    provides: clean broker codebase without legacy dead code
provides:
  - stats.ts module with readStats/writeStats/accumulateTokens/STATS_PATH/BrokerStats
  - Per-repo lifetime token totals persisted to ~/.filescope/stats.json
  - StatusResponse enriched with repoTokens field
  - BrokerMessage union includes StatusResponse for client-side handling
affects: [19-02-get-llm-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-modify-write stats pattern: accumulateTokens reads, updates, writes, returns new state in one call"
    - "In-memory snapshot of stats in BrokerServer.repoTokens, loaded from disk at startup"

key-files:
  created:
    - src/broker/stats.ts
  modified:
    - src/broker/types.ts
    - src/broker/server.ts
    - package.json

key-decisions:
  - "accumulateTokens returns updated BrokerStats so caller avoids a second readStats call"
  - "Token accumulation placed BEFORE connection-destroyed check so stats are always recorded even if client disconnected"
  - "In-memory repoTokens field loaded at constructor time; kept in sync on every job completion"
  - "Status response uses spread { ...this.repoTokens } for snapshot copy, not live reference"

patterns-established:
  - "Stats accumulation: always persist before responding to clients"

requirements-completed: [OBS-02]

# Metrics
duration: 2min
completed: 2026-03-23
---

# Phase 19 Plan 01: Stats Persistence and Status Enrichment Summary

**Per-repo token stats persisted to ~/.filescope/stats.json via stats.ts; broker status responses now include repoTokens for lifetime totals per repo**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-23T01:55:01Z
- **Completed:** 2026-03-23T01:57:23Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- New `src/broker/stats.ts` module with `readStats`, `writeStats`, `accumulateTokens`, `STATS_PATH`, and `BrokerStats` type
- `StatusResponse` type enriched with `repoTokens: Record<string, number>` field
- `BrokerMessage` union extended to include `StatusResponse` so clients can handle status_response messages
- Broker server accumulates tokens after each successful job (before connection-destroyed check) and returns them in status responses

## Task Commits

Each task was committed atomically:

1. **Task 1: Create stats.ts and update types.ts** - `d0b884c` (feat)
2. **Task 2: Wire stats into broker server** - `729514a` (feat)

**Plan metadata:** (docs commit — pending)

## Files Created/Modified
- `src/broker/stats.ts` - Stats persistence helpers: readStats/writeStats/accumulateTokens/STATS_PATH/BrokerStats
- `src/broker/types.ts` - Added repoTokens to StatusResponse; added StatusResponse to BrokerMessage union
- `src/broker/server.ts` - Import stats helpers; add repoTokens field; load from disk in constructor; accumulate in handleJobComplete; include in handleStatus response
- `package.json` - Added src/broker/stats.ts to esbuild build script entry list

## Decisions Made
- `accumulateTokens` returns updated `BrokerStats` so the caller (server.ts) doesn't need a second `readStats` call to update its in-memory copy
- Token accumulation runs before the `connection.destroyed` check so stats are recorded even when the result is discarded
- In-memory `repoTokens` is loaded from disk at constructor time and kept synchronized on every job completion
- Status response sends `{ ...this.repoTokens }` (spread snapshot) rather than a live reference

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- stats.ts is complete and self-contained; Plan 02 (get_llm_status update) can now read repoTokens from StatusResponse
- No blockers

---
*Phase: 19-observability*
*Completed: 2026-03-23*

## Self-Check: PASSED

- FOUND: src/broker/stats.ts
- FOUND: src/broker/types.ts
- FOUND: src/broker/server.ts
- FOUND: .planning/phases/19-observability/19-01-SUMMARY.md
- FOUND commit: d0b884c (Task 1)
- FOUND commit: 729514a (Task 2)
