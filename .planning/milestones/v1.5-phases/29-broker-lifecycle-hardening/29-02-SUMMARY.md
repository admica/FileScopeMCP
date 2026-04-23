---
phase: 29-broker-lifecycle-hardening
plan: "02"
subsystem: broker
tags: [lifecycle, drain-timeout, spawn-poll, shutdown, hardening]
dependency_graph:
  requires:
    - 29-01 (BrokerConfigSchema with drainTimeoutMs, spawnPollIntervalMs, spawnMaxWaitMs; main.ts shutdown call site)
  provides:
    - Drain-timeout-aware BrokerServer.shutdown() with Promise.race (BRKR-03)
    - Poll-based spawn readiness in spawnBrokerIfNeeded() replacing hardcoded 500ms sleep (BRKR-04)
  affects: []
tech_stack:
  added: []
  patterns:
    - Promise.race for bounded drain wait (mirrors worker.ts runJobWithTimeout pattern)
    - Timer .unref() on drain timeout (mirrors worker.ts scheduleNext pattern)
    - while + setTimeout poll loop (not setInterval) per RESEARCH.md anti-pattern guidance
key_files:
  created: []
  modified:
    - src/broker/server.ts
    - src/broker/client.ts
decisions:
  - "drainTimeoutMs default of 15_000 applied both at shutdown() signature level and as schema default — backward compatible"
  - "waitForSocket uses hardcoded module constants (not loaded from broker config) per Assumption A3 — avoids async config loading in spawn path"
  - "Final existsSync check after deadline loop provides one last opportunity to detect late-arriving socket file"
metrics:
  duration_minutes: 10
  completed_date: "2026-04-17"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 29 Plan 02: Broker Lifecycle Hardening — Drain Timeout and Spawn Poll

One-liner: BrokerServer.shutdown() now bounds the drain wait with Promise.race and a configurable timeout; spawnBrokerIfNeeded() polls for socket file existence every 1s up to 10s instead of sleeping a fixed 500ms.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add drain timeout to BrokerServer.shutdown() | 9ae6cf4 | src/broker/server.ts |
| 2 | Replace 500ms sleep with poll loop in spawnBrokerIfNeeded() | 6c21d63 | src/broker/client.ts |

## What Was Built

### Task 1: Drain Timeout in BrokerServer.shutdown()

Modified `shutdown()` in `src/broker/server.ts`:

- Signature changed from `async shutdown(): Promise<void>` to `async shutdown(drainTimeoutMs: number = 15_000): Promise<void>`
- Replaced the unbounded `await pending` with `Promise.race([pending, drainTimeout])` where `drainTimeout` is a `setTimeout` promise
- Drain timeout timer calls `.unref()` to prevent it from holding the process alive if the job finishes first (same pattern as `worker.ts` `scheduleNext()`)
- Log message now includes the configured timeout value: `Waiting for current job to finish (drain timeout: ${drainTimeoutMs}ms)...`
- Call site in `main.ts` (added in Plan 01) passes `config.drainTimeoutMs` — TypeScript error from Plan 01 is now resolved

### Task 2: Poll-Based Spawn Readiness in client.ts

Two additions to `src/broker/client.ts`:

**Constants (after imports, before module-level state):**
```typescript
const SPAWN_POLL_INTERVAL_MS = 1_000;
const SPAWN_MAX_WAIT_MS = 10_000;
```

**`waitForSocket()` helper (after `clearReconnectTimer()`):**
Polls `existsSync(sockPath)` in a `while` loop with `await new Promise<void>(r => setTimeout(r, pollIntervalMs))` between checks. Returns `true` when socket appears, `false` after deadline (with one final check at deadline). Uses `while + setTimeout` (not `setInterval`) per RESEARCH.md anti-pattern guidance.

**Replacement in `spawnBrokerIfNeeded()`:**
The hardcoded `await new Promise<void>(r => setTimeout(r, 500))` is replaced with:
```typescript
const ready = await waitForSocket(SOCK_PATH, SPAWN_POLL_INTERVAL_MS, SPAWN_MAX_WAIT_MS);
if (!ready) {
  log('[broker-client] Warning: broker socket did not appear within timeout');
}
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — changes are internal to broker shutdown sequencing and client spawn readiness detection. No new network endpoints, auth paths, or file access patterns beyond those already in the threat model (T-29-05, T-29-06, T-29-07 accepted).

## Self-Check

### Created files exist
- `.planning/phases/29-broker-lifecycle-hardening/29-02-SUMMARY.md` — this file

### Commits exist
- 9ae6cf4: feat(29-02): add drain timeout to BrokerServer.shutdown()
- 6c21d63: feat(29-02): replace 500ms sleep with poll loop in spawnBrokerIfNeeded()

## Self-Check: PASSED
