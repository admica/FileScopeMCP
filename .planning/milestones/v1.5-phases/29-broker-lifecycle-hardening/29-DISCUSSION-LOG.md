# Phase 29: Broker Lifecycle Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 29-broker-lifecycle-hardening
**Areas discussed:** Shutdown drain behavior, Spawn readiness strategy, Liveness check depth, Crash handler scope

---

## Shutdown Drain Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Match job timeout (120s) | Reuse existing jobTimeoutMs config. Job will abort itself at timeout anyway. | |
| Shorter dedicated timeout (10-30s) | Separate shutdown drain timeout — don't wait full 120s. Faster restart cycle. | ✓ |
| No timeout (keep current) | Wait indefinitely for current job. Risk of hung shutdown. | |

**User's choice:** Shorter dedicated timeout (10-30s)
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Drop silently | Queue is in-memory, jobs resubmitted on reconnect. Files stay stale. | ✓ |
| Send error to clients | Notify each connected client about dropped jobs before closing. | |
| Log count only | Log how many jobs were dropped. No client notification. | |

**User's choice:** Drop silently
**Notes:** None

---

## Spawn Readiness Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Poll socket existence | Check if SOCK_PATH exists at interval, up to configurable max timeout. | ✓ |
| Poll with connect attempt | Same polling loop but actually try connecting. More thorough but heavier. | |
| Configurable fixed sleep | Replace 500ms with a config value. Simple but still a guess. | |

**User's choice:** Poll socket existence
**Notes:** User asked why poll so fast (100ms) — agreed slower is fine

| Option | Description | Selected |
|--------|-------------|----------|
| 500ms / 5s defaults | Poll interval 500ms, max wait 5s. | |
| 1s / 10s defaults | Poll every 1s, max wait 10s. More patient for loaded machines. | ✓ |

**User's choice:** 1s interval, 10s max, both configurable
**Notes:** None

---

## Liveness Check Depth

| Option | Description | Selected |
|--------|-------------|----------|
| PID + socket file | Require BOTH PID alive AND socket file exists. Simple, handles 99% of cases. | ✓ |
| PID + socket + connect probe | Also try connecting and sending status ping. More robust but heavier. | |
| PID + process name check | Verify process at PID is node running broker. OS-specific. | |

**User's choice:** PID + socket file
**Notes:** None

---

## Crash Handler Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Both uncaughtException + unhandledRejection | Catch both, clean up, log, exit(1). Covers sync throws and forgotten awaits. | ✓ |
| uncaughtException only | Only catch sync throws. | |
| Neither | Rely on client-side stale detection. | |

**User's choice:** Both
**Notes:** None

| Option | Description | Selected |
|--------|-------------|----------|
| Exit(1) with error log | Non-zero exit code. Callers know it failed. | |
| Exit(0) silently (current) | Current behavior — exits cleanly. | |
| Exit(0) with warning log | Log message but exit cleanly. Auto-start scripts stay happy. | ✓ |

**User's choice:** Exit(0) with warning log
**Notes:** Non-zero exit would break auto-start scripts

## Claude's Discretion

- Exact drain timeout value within 10-30s range
- Config key names for spawn poll settings
- Log message wording

## Deferred Ideas

None
