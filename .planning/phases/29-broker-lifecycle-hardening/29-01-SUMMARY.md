---
phase: 29-broker-lifecycle-hardening
plan: "01"
subsystem: broker
tags: [lifecycle, pid-guard, crash-handlers, config, hardening]
dependency_graph:
  requires: []
  provides:
    - Extended BrokerConfigSchema with drainTimeoutMs, spawnPollIntervalMs, spawnMaxWaitMs
    - Hardened checkPidGuard() with dual PID+socket liveness check
    - Module-level crash handlers (uncaughtException, unhandledRejection)
    - Drain-aware shutdown call site in main.ts
  affects:
    - src/broker/server.ts (Plan 02 must update shutdown() signature to accept drainTimeoutMs)
    - src/broker/client.ts (Plan 02 uses spawnPollIntervalMs, spawnMaxWaitMs for socket readiness)
tech_stack:
  added: []
  patterns:
    - Dual liveness check (PID alive AND socket exists) before declaring broker running
    - Synchronous crash handlers with force:true file cleanup
    - Forward-compat parameter passing (config.drainTimeoutMs wired before server.ts updated)
key_files:
  created: []
  modified:
    - src/broker/config.ts
    - src/broker/main.ts
decisions:
  - "Crash handlers placed at module level (outside main()) so they catch errors during all execution phases including startup"
  - "{ force: true } on rmSync makes cleanup safe even if files do not exist (ENOENT silently ignored)"
  - "server.shutdown(config.drainTimeoutMs) passes the parameter ahead of Plan 02 updating the signature — TypeScript error is expected and documented"
  - "Underscore numeric separators applied to all numeric defaults in BrokerConfigSchema (120_000, 1_000, 15_000, 10_000)"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-17"
  tasks_completed: 2
  tasks_total: 2
  files_modified: 2
---

# Phase 29 Plan 01: Broker Lifecycle Hardening — Config and Main Entry Point

One-liner: Extended BrokerConfigSchema with three lifecycle timing fields and hardened main.ts with dual PID+socket liveness check, synchronous crash cleanup handlers, and drain-aware shutdown wiring.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend BrokerConfigSchema with lifecycle fields | d486a16 | src/broker/config.ts |
| 2 | Harden main.ts — liveness check, crash handlers, shutdown wiring | 847bd18 | src/broker/main.ts |

## What Was Built

### Task 1: BrokerConfigSchema Lifecycle Fields

Added three new fields to `BrokerConfigSchema` in `src/broker/config.ts`:

- `drainTimeoutMs: z.number().int().positive().default(15_000)` — D-01: graceful drain timeout (10-30s range)
- `spawnPollIntervalMs: z.number().int().positive().default(1_000)` — D-04: poll interval for socket readiness
- `spawnMaxWaitMs: z.number().int().positive().default(10_000)` — D-04: max wait for socket to appear

Also applied underscore separators to existing defaults (`120_000`, `1_000`) per project convention.

`BrokerConfig` type (via `z.infer<typeof BrokerConfigSchema>`) automatically includes all new fields with no additional type changes.

### Task 2: main.ts Hardening

Three changes applied:

**Change 1 — Dual liveness check (BRKR-01, BRKR-05):**
`checkPidGuard()` now requires BOTH `isPidRunning(pid)` AND `fs.existsSync(SOCK_PATH)` before declaring broker running. Previously a recycled PID (same number reused by another process) with a missing socket would falsely report the broker as alive. Now when PID is alive but socket is missing, the code falls through to stale cleanup — which is correct behavior per D-05.

**Change 2 — Crash handlers (BRKR-02):**
Two module-level handlers registered before `main().catch(...)`:
- `uncaughtException`: logs error+stack, removes SOCK_PATH and PID_PATH (force:true), exits 1
- `unhandledRejection`: logs reason, same file cleanup, exits 1

Handlers are synchronous (no await) per Node.js docs — process state is undefined after uncaught exception. `{ force: true }` prevents ENOENT errors if files do not yet exist. The existing `shutdownStarted` guard in graceful shutdown is bypassed intentionally — double-cleanup is safe with `force: true`.

**Change 3 — Drain-aware shutdown wiring (BRKR-03):**
`server.shutdown()` call in the graceful shutdown path updated to `server.shutdown(config.drainTimeoutMs)`. `config` is in scope from `loadBrokerConfig()`. Also added `log(\`  Drain:     ${config.drainTimeoutMs}ms\`)` to the startup verbose logging block.

## Deviations from Plan

None — plan executed exactly as written.

Note: TypeScript reports one expected error on the `server.shutdown(config.drainTimeoutMs)` call site because `server.ts` still declares `shutdown(): Promise<void>` (no parameter). This is documented in the plan as an intentional forward-compatibility gap that Plan 02 resolves by updating the `server.ts` shutdown signature.

## Known Stubs

None.

## Threat Flags

None — all changes are internal to the broker process, no new network endpoints, auth paths, or file access patterns introduced beyond those already in the threat model (T-29-02, T-29-03 mitigated by this plan).

## Self-Check

### Created files exist
- `.planning/phases/29-broker-lifecycle-hardening/29-01-SUMMARY.md` — this file

### Commits exist
- d486a16: feat(29-01): extend BrokerConfigSchema with lifecycle fields
- 847bd18: feat(29-01): harden main.ts with dual liveness check, crash handlers, drain wiring
