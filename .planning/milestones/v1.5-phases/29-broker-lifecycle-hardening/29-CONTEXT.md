# Phase 29: Broker Lifecycle Hardening - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden the broker process lifecycle: clean up socket and PID files on every exit path (graceful, crash, kill), replace spawn timing races with reliable polling, and detect concurrent instances clearly. No new features — only reliability improvements to existing broker infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Shutdown Drain Behavior
- **D-01:** Graceful shutdown uses a dedicated drain timeout of 10-30s (NOT the full 120s job timeout). If the in-progress job hasn't completed by then, force-abort and proceed with cleanup.
- **D-02:** Queued (not-yet-started) jobs are dropped silently on shutdown. Files stay stale and will be resubmitted when clients reconnect to the next broker session.

### Spawn Readiness Strategy
- **D-03:** Replace the hardcoded 500ms sleep in `spawnBrokerIfNeeded()` with a poll loop that checks socket file existence every 1s, up to a 10s max timeout.
- **D-04:** Both poll interval (default 1s) and max timeout (default 10s) are configurable in broker config.

### Liveness Check
- **D-05:** Broker liveness requires BOTH conditions: PID is alive (signal 0) AND socket file exists. If either is missing, treat as stale and clean up. No connect probe or process name check needed.

### Crash Handler
- **D-06:** Add both `uncaughtException` and `unhandledRejection` handlers. Both clean up PID file + socket file, log the error, and exit(1).
- **D-07:** SIGKILL cleanup is handled client-side — the existing stale socket detection in `spawnBrokerIfNeeded()` already covers this path.

### Concurrent Instance Detection
- **D-08:** When a second broker instance detects an existing running broker, log a clear warning message (e.g., "Broker already running (PID 1234)") and exit(0). Non-zero exit would break auto-start scripts.

### Claude's Discretion
- Exact drain timeout value within the 10-30s range
- Config key names for spawn poll interval and max timeout
- Log message wording for crash handlers and concurrent detection

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Broker Source
- `src/broker/main.ts` — Entry point, PID guard, shutdown handlers (modify for D-01, D-06, D-08)
- `src/broker/client.ts` — spawnBrokerIfNeeded with 500ms sleep (modify for D-03, D-04)
- `src/broker/server.ts` — BrokerServer.shutdown() drain logic (modify for D-01)
- `src/broker/config.ts` — Broker config schema (add spawn poll config for D-04)

### Requirements
- `.planning/REQUIREMENTS.md` §Broker Lifecycle Hardening — BRKR-01 through BRKR-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isPidRunning()` in `main.ts:23-29` — PID existence check via signal 0, already correct
- `checkPidGuard()` in `main.ts:32-49` — Stale cleanup logic, needs socket existence check added
- `spawnBrokerIfNeeded()` in `client.ts:119-150` — Stale detection already exists, needs poll loop
- `BrokerServer.shutdown()` in `server.ts:69-90` — Drain logic exists but lacks timeout

### Established Patterns
- Config values in `src/broker/config.ts` with `loadBrokerConfig()` — new config keys follow same pattern
- Signal handlers registered in `main.ts:120-121` — crash handlers follow same registration pattern
- Best-effort cleanup with `fs.rmSync({ force: true })` — consistent across all cleanup paths

### Integration Points
- `main.ts` shutdown function — add drain timeout wrapping around `server.shutdown()`
- `main.ts` after signal handlers — add uncaughtException/unhandledRejection handlers
- `client.ts` spawnBrokerIfNeeded — replace setTimeout with poll loop using config values
- `config.ts` BrokerConfig type — add spawnPollIntervalMs and spawnMaxWaitMs fields

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 29-broker-lifecycle-hardening*
*Context gathered: 2026-04-17*
