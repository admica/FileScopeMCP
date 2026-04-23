# Phase 29: Broker Lifecycle Hardening - Research

**Researched:** 2026-04-17
**Domain:** Node.js process lifecycle, Unix domain sockets, graceful shutdown patterns
**Confidence:** HIGH

## Summary

Phase 29 is a targeted hardening pass on the existing broker process lifecycle. All decisions were locked in CONTEXT.md during the discuss phase, so this research focuses on verifying the exact Node.js APIs, current code states, and implementation patterns needed to execute the five requirements (BRKR-01 through BRKR-05).

The broker is a standalone stdio-spawned daemon that serves Unix domain socket clients. The four source files requiring changes are small and well-understood: `main.ts` (PID guard, signal handlers, crash handlers), `client.ts` (spawn readiness poll), `server.ts` (drain timeout), and `config.ts` (new config fields). No new libraries are required — all patterns use Node.js built-in APIs already in use by the codebase.

**Primary recommendation:** Implement all five changes in a single wave. Each change is independent and maps 1:1 to a requirement. The code surface is small (< 20 lines changed per file) and the patterns are entirely standard Node.js.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Graceful shutdown uses a dedicated drain timeout of 10-30s (NOT the full 120s job timeout). If the in-progress job hasn't completed by then, force-abort and proceed with cleanup.
- **D-02:** Queued (not-yet-started) jobs are dropped silently on shutdown. Files stay stale and will be resubmitted when clients reconnect to the next broker session.
- **D-03:** Replace the hardcoded 500ms sleep in `spawnBrokerIfNeeded()` with a poll loop that checks socket file existence every 1s, up to a 10s max timeout.
- **D-04:** Both poll interval (default 1s) and max timeout (default 10s) are configurable in broker config.
- **D-05:** Broker liveness requires BOTH conditions: PID is alive (signal 0) AND socket file exists. If either is missing, treat as stale and clean up. No connect probe or process name check needed.
- **D-06:** Add both `uncaughtException` and `unhandledRejection` handlers. Both clean up PID file + socket file, log the error, and exit(1).
- **D-07:** SIGKILL cleanup is handled client-side — the existing stale socket detection in `spawnBrokerIfNeeded()` already covers this path.
- **D-08:** When a second broker instance detects an existing running broker, log a clear warning message (e.g., "Broker already running (PID 1234)") and exit(0). Non-zero exit would break auto-start scripts.

### Claude's Discretion

- Exact drain timeout value within the 10-30s range
- Config key names for spawn poll interval and max timeout
- Log message wording for crash handlers and concurrent detection

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BRKR-01 | Broker liveness check validates both PID alive AND socket exists (prevents PID recycle false positive) | D-05: checkPidGuard() in main.ts:32-49 needs socket existence added to the alive-branch condition |
| BRKR-02 | uncaughtException handler cleans up PID file and socket before exit | D-06: handlers registered after signal handlers in main.ts:120-121, same fs.rmSync pattern |
| BRKR-03 | Graceful shutdown drains in-progress jobs before closing socket | D-01: server.ts shutdown() awaits getCurrentJobPromise() — wrap with Promise.race timeout |
| BRKR-04 | Configurable spawn timeout replaces hardcoded 500ms sleep | D-03/D-04: client.ts spawnBrokerIfNeeded() poll loop + config.ts new fields |
| BRKR-05 | Concurrent broker instance detection with clear error messaging | D-08: checkPidGuard() already exits(0) on alive PID — just needs socket-existence check added (same as BRKR-01) |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Liveness validation | Broker process (main.ts) | Client (client.ts stale detection) | PID guard runs in broker; client-side detection handles SIGKILL path per D-07 |
| Crash cleanup | Broker process (main.ts) | — | uncaughtException/unhandledRejection only fire in the process that threw |
| Drain timeout | Broker server (server.ts) | — | shutdown() owns the drain sequence; timeout is applied here |
| Spawn readiness poll | MCP client (client.ts) | — | Client spawns the broker and must wait for it to be ready |
| Config schema | Broker config (config.ts) | — | All broker config lives in BrokerConfig; Zod schema extended here |

## Standard Stack

### Core (all already in use — no new dependencies)

| API/Library | Version | Purpose | Notes |
|-------------|---------|---------|-------|
| `process.on('uncaughtException')` | Node.js 22.x | Catch synchronous exceptions that escape all handlers | [VERIFIED: Node.js 22.21.1 on machine] |
| `process.on('unhandledRejection')` | Node.js 22.x | Catch rejected promises with no rejection handler | [VERIFIED: Node.js 22.21.1 on machine] |
| `process.kill(pid, 0)` | Node.js built-in | Signal 0 = PID existence check, throws ESRCH if dead | [VERIFIED: confirmed ESRCH behavior on machine] |
| `fs.existsSync()` | Node.js built-in | Synchronous file existence check for poll loop | [VERIFIED: available in Node.js 22.21.1] |
| `Promise.race()` | ES2015 | Drain timeout: race job promise against timeout promise | [VERIFIED: pattern confirmed working on machine] |
| `setTimeout` / `clearTimeout` | Node.js built-in | Poll interval and drain timeout implementation | [ASSUMED: standard Node.js] |
| `zod` | Already in codebase | Config schema extension for new fields | [VERIFIED: used in config.ts BrokerConfigSchema] |

**Installation:** No new packages required.

## Architecture Patterns

### System Architecture Diagram

```
MCP Server (client.ts)                    Broker Process (main.ts)
      |                                           |
      |-- spawnBrokerIfNeeded() ----------------> spawn broker binary
      |                                           |-- checkPidGuard()
      |     [poll loop: check SOCK_PATH exists]   |     PID alive? AND socket exists?
      |     [every 1s, up to 10s]                 |     NO -> clean stale files
      |<-- socket appears ----------------------- |     YES -> exit(0) [D-08]
      |                                           |-- write PID file
      |-- attemptConnect() ------------------>    |-- server.start() [bind SOCK_PATH]
      |<-- connected                              |
      |                                           |-- SIGTERM/SIGINT handler
      |                                           |     worker.stop()
      |                                           |     Promise.race([jobPromise, drainTimeout])
      |                                           |     fs.rmSync(SOCK_PATH)
      |                                           |     fs.rmSync(PID_PATH)
      |                                           |     exit(0)
      |                                           |
      |                                           |-- uncaughtException handler [D-06]
      |                                           |     log(error)
      |                                           |     fs.rmSync(SOCK_PATH)
      |                                           |     fs.rmSync(PID_PATH)
      |                                           |     exit(1)
      |                                           |
      |                                           |-- unhandledRejection handler [D-06]
      |                                           |     (same as uncaughtException)
```

### Recommended Project Structure

No structural changes — all edits are within existing files:

```
src/broker/
├── config.ts    # Add spawnPollIntervalMs, spawnMaxWaitMs to BrokerConfigSchema
├── main.ts      # Fix checkPidGuard() liveness; add crash handlers
├── client.ts    # Replace setTimeout(500ms) with poll loop
└── server.ts    # Add drain timeout to shutdown()
```

### Pattern 1: Liveness Check (BRKR-01, BRKR-05)

**What:** Check PID alive AND socket file exists in checkPidGuard(). Currently only checks PID.
**When to use:** On every broker startup before binding the socket.

Current code (main.ts:36-38):
```typescript
if (!isNaN(pid) && isPidRunning(pid)) {
  log(`Broker already running (PID ${pid})`);
  process.exit(0);
}
```

Required change — add socket existence check:
```typescript
// Source: existing isPidRunning() + fs.existsSync(), both already in main.ts
if (!isNaN(pid) && isPidRunning(pid) && fs.existsSync(SOCK_PATH)) {
  // Both PID alive AND socket present — genuine live broker
  log(`Broker already running (PID ${pid})`);
  process.exit(0);
}
// PID running but socket missing (or vice versa) — treat as stale, fall through to cleanup
```

This single-line change addresses both BRKR-01 (prevents PID recycle false positive) and BRKR-05 (concurrent detection message already correct per D-08, gate just needs to be accurate).

### Pattern 2: Crash Handlers (BRKR-02)

**What:** Register `uncaughtException` and `unhandledRejection` handlers that clean up files then exit(1).
**When to use:** Added once in main.ts, after PID file is written (so cleanup is relevant).

```typescript
// Source: Node.js docs [CITED: https://nodejs.org/api/process.html#event-uncaughtexception]
// Register immediately after main() starts, before any async work

process.on('uncaughtException', (err: Error) => {
  log(`Broker crash (uncaughtException): ${err.message}\n${err.stack}`);
  fs.rmSync(SOCK_PATH, { force: true });
  fs.rmSync(PID_PATH, { force: true });
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  log(`Broker crash (unhandledRejection): ${msg}`);
  fs.rmSync(SOCK_PATH, { force: true });
  fs.rmSync(PID_PATH, { force: true });
  process.exit(1);
});
```

**Placement in main.ts:** Register these handlers at module level (outside `main()`) or as the very first lines inside `main()` before the `await loadBrokerConfig()` call. This ensures they catch errors during startup as well as runtime. The PID file may not exist yet if the crash happens before line 76 — `fs.rmSync({ force: true })` silently ignores missing files, so this is safe.

### Pattern 3: Drain Timeout (BRKR-03)

**What:** Wrap the existing `await this.worker.getCurrentJobPromise()` with a `Promise.race` timeout.
**When to use:** In `BrokerServer.shutdown()` (server.ts:69-90).

Current code (server.ts:74-78):
```typescript
const pending = this.worker.getCurrentJobPromise();
if (pending) {
  log('Waiting for current job to finish...');
  await pending;
}
```

Required change — add drain timeout:
```typescript
// Source: Promise.race pattern [VERIFIED: working on Node.js 22.21.1]
// drainTimeoutMs is passed in from main.ts (from config or hardcoded default)
const pending = this.worker.getCurrentJobPromise();
if (pending) {
  log('Waiting for current job to finish (drain timeout: {drainTimeoutMs}ms)...');
  const drainTimeout = new Promise<void>(resolve =>
    setTimeout(resolve, drainTimeoutMs).unref()
  );
  await Promise.race([pending, drainTimeout]);
}
```

**Wire-up:** `shutdown()` needs to accept `drainTimeoutMs` as a parameter, or `BrokerServer` can read it from `this.config`. The cleanest approach given the existing config access pattern: add `drainTimeoutMs` to `BrokerConfig` and read `this.config.drainTimeoutMs` directly in `shutdown()`. Alternatively, pass it as a parameter to `shutdown(drainTimeoutMs)` and supply the value from `main.ts`. Either works — Claude's discretion on config key placement.

### Pattern 4: Configurable Spawn Poll (BRKR-04)

**What:** Replace `await new Promise<void>(r => setTimeout(r, 500))` with a poll loop.
**When to use:** In `spawnBrokerIfNeeded()` in client.ts:119-150.

Current code (client.ts:145):
```typescript
await new Promise<void>(r => setTimeout(r, 500));
```

Required change — poll loop:
```typescript
// Source: fs.existsSync poll pattern [VERIFIED: working on Node.js 22.21.1]
// Values come from config loaded by MCP server (or use defaults if config unavailable)
async function waitForSocket(
  sockPath: string,
  pollIntervalMs: number,
  maxWaitMs: number,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (existsSync(sockPath)) return true;
    await new Promise<void>(r => setTimeout(r, pollIntervalMs));
  }
  return existsSync(sockPath); // one final check
}
```

**Config access in client.ts:** The client currently imports only `SOCK_PATH` and `PID_PATH` from config, not a full `BrokerConfig`. The poll values can be sourced either by: (a) also importing/calling `loadBrokerConfig()` from `spawnBrokerIfNeeded()`, or (b) accepting the values as parameters injected when `connect()` is called. Option (a) adds async config loading inside a spawn helper; option (b) requires the MCP server to pass config values through. The simplest correct approach: define constants with the default values in `client.ts` and also import them from config defaults — no config file read needed since the defaults satisfy D-04.

### Anti-Patterns to Avoid

- **Registering crash handlers inside the `main()` function body after async calls:** If `loadBrokerConfig()` or `checkLLMConnectivity()` throws an uncaught error before the handlers are registered, cleanup won't run. Register crash handlers before any `await`.
- **Using `.unref()` on the drain timeout timer:** DO use `.unref()` — this prevents the timer from keeping the process alive if all other work completes naturally.
- **Not using `.unref()` on the drain timeout timer:** If you forget `.unref()`, a timed-out shutdown may hang for the drain duration waiting for the timer to fire even after all cleanup is done.
- **Async handler for `uncaughtException`:** The handler must be synchronous (or synchronously initiate cleanup and call `process.exit()`). Awaiting async operations inside `uncaughtException` is not safe — the process state is undefined after an uncaught exception. [CITED: https://nodejs.org/api/process.html#event-uncaughtexception]
- **Polling with `setInterval` instead of `while + setTimeout`:** `setInterval` fires on schedule regardless of whether the previous iteration completed, which is not a problem for a simple `existsSync` check, but the `while + setTimeout` pattern is cleaner and easier to reason about for a one-shot poll.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PID existence check | Custom `/proc/PID/status` reader | `process.kill(pid, 0)` | Already in codebase, standard POSIX, works on Node.js 22 |
| File existence check | `fs.statSync` with try/catch | `fs.existsSync()` | Already in codebase, simpler for boolean check |
| Race timeout | Custom AbortController + timer | `Promise.race([promise, timeoutPromise])` | Already used for job timeout pattern in worker.ts |
| Config validation | Manual JSON key checks | Zod schema (already in config.ts) | Already the pattern — add new fields to existing schema |

**Key insight:** Every capability needed for this phase already exists in the codebase or as a standard Node.js built-in. This is pure wiring, not new functionality.

## Common Pitfalls

### Pitfall 1: Crash Handler Registration Order

**What goes wrong:** `uncaughtException` handler registered inside `main()` after an `await` — if `loadBrokerConfig()` throws synchronously (e.g., Zod validation fails and calls `process.exit(1)`), the handler is never registered for that code path.

**Why it happens:** JavaScript registers event handlers lazily. Any error before registration falls through to the default behavior (log + exit, but without file cleanup).

**How to avoid:** Register both `uncaughtException` and `unhandledRejection` handlers at the top level (outside `main()`), or as the absolute first lines inside `main()` before any `await`. The existing `main().catch()` at the bottom of main.ts already handles startup failures — crash handlers are complementary for runtime crashes.

**Warning signs:** Log shows crash but socket/PID files remain on disk.

### Pitfall 2: Stale Socket After SIGKILL (Client-Side Detection)

**What goes wrong:** After `SIGKILL`, no cleanup runs in the broker (SIGKILL cannot be caught). On next MCP server startup, `spawnBrokerIfNeeded()` sees the socket file, checks the PID, finds it dead (ESRCH), and removes both files — this is already handled.

**Why it happens:** The current client.ts:119-150 correctly handles this. The BRKR-01 fix in `checkPidGuard()` (server-side) must not break this path. The liveness gate `isPidRunning(pid) && existsSync(SOCK_PATH)` must also handle: PID running but socket missing (socket cleaned up by client but broker didn't exit yet — rare race). In that case, falling through to stale cleanup is correct behavior.

**How to avoid:** The two-condition liveness check (D-05) handles all cases correctly. No additional logic needed.

**Warning signs:** "Address already in use" error when broker tries to bind socket — means stale socket was NOT cleaned up.

### Pitfall 3: Drain Timeout Timer Keeps Process Alive

**What goes wrong:** If drain timeout uses `setTimeout` without `.unref()`, and the job completes before the timeout fires, the process waits for the timer to expire before exiting.

**Why it happens:** Node.js event loop stays alive as long as any referenced timer or I/O is pending.

**How to avoid:** Always call `.unref()` on the drain timeout timer. The existing `scheduleNext()` in worker.ts already uses `.unref()` — follow the same pattern.

**Warning signs:** Broker takes the full drain timeout duration to exit even when no job was in-progress.

### Pitfall 4: Poll Loop Blocks Event Loop

**What goes wrong:** Synchronous busy-loop for socket polling blocks the event loop, preventing other handlers from running.

**Why it happens:** `while(true) { if (existsSync(sock)) break; }` — no async yield.

**How to avoid:** The poll loop MUST use `await new Promise(r => setTimeout(r, intervalMs))` between checks. This yields to the event loop each interval. The pattern is verified working (see Pattern 4 above).

**Warning signs:** MCP server becomes unresponsive during broker startup window.

### Pitfall 5: Concurrent Handler Registration

**What goes wrong:** If `shutdown()` and a crash handler both run (e.g., SIGTERM arrives while an unhandledRejection is being processed), `fs.rmSync` is called twice. 

**Why it happens:** Multiple exit paths not guarded by the existing `shutdownStarted` flag.

**How to avoid:** The existing `shutdownStarted` flag in main.ts prevents double-execution of `shutdown()`. Crash handlers bypass this flag. The `{ force: true }` option on `fs.rmSync` makes double-cleanup safe (no error if file already deleted). No additional guard needed.

**Warning signs:** "ENOENT" errors in logs from crash handler cleanup — acceptable and expected if shutdown already ran.

## Code Examples

### Verified: Current State of checkPidGuard() (main.ts:32-49)

```typescript
// Source: /home/autopcap/FileScopeMCP/src/broker/main.ts [VERIFIED: read directly]
function checkPidGuard(): void {
  if (fs.existsSync(PID_PATH)) {
    const raw = fs.readFileSync(PID_PATH, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    if (!isNaN(pid) && isPidRunning(pid)) {
      // BUG: does not check SOCK_PATH — PID recycle false positive possible
      log(`Broker already running (PID ${pid})`);
      process.exit(0);
    }
    // Stale: remove leftover files
    log(`Cleaning stale PID file (PID ${raw} not running)`);
    fs.rmSync(SOCK_PATH, { force: true });
    fs.rmSync(PID_PATH, { force: true });
  } else if (fs.existsSync(SOCK_PATH)) {
    log('Cleaning stale socket file (no PID file)');
    fs.rmSync(SOCK_PATH, { force: true });
  }
}
```

The fix is adding `&& fs.existsSync(SOCK_PATH)` to line 36.

### Verified: Current State of BrokerServer.shutdown() (server.ts:69-90)

```typescript
// Source: /home/autopcap/FileScopeMCP/src/broker/server.ts [VERIFIED: read directly]
async shutdown(): Promise<void> {
  this.worker.stop();
  const pending = this.worker.getCurrentJobPromise();
  if (pending) {
    log('Waiting for current job to finish...');
    await pending;  // BUG: no timeout — hangs indefinitely if job is stuck
  }
  for (const socket of this.connections) { socket.destroy(); }
  this.connections.clear();
  await new Promise<void>((resolve) => this.server.close(() => resolve()));
  log('Broker server shut down');
}
```

### Verified: Current State of spawnBrokerIfNeeded() (client.ts:140-150)

```typescript
// Source: /home/autopcap/FileScopeMCP/src/broker/client.ts [VERIFIED: read directly]
try {
  const distBrokerDir = path.dirname(fileURLToPath(import.meta.url));
  const brokerBin = path.resolve(distBrokerDir, 'main.js');
  spawn(process.execPath, [brokerBin], { detached: true, stdio: 'ignore' }).unref();
  // BUG: hardcoded 500ms sleep — may be too short on loaded machine
  await new Promise<void>(r => setTimeout(r, 500));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log(`[broker-client] Warning: failed to spawn broker: ${msg}`);
}
```

### Verified: BrokerConfig Zod Schema (config.ts:30-34)

```typescript
// Source: /home/autopcap/FileScopeMCP/src/broker/config.ts [VERIFIED: read directly]
export const BrokerConfigSchema = z.object({
  llm: BrokerLLMSchema,
  jobTimeoutMs: z.number().int().positive().default(120000),
  maxQueueSize: z.number().int().positive().default(1000),
  // Add here: drainTimeoutMs, spawnPollIntervalMs, spawnMaxWaitMs
});
```

### Proposed: New Config Fields

```typescript
// Follows existing field pattern — .number().int().positive().default(N)
export const BrokerConfigSchema = z.object({
  llm: BrokerLLMSchema,
  jobTimeoutMs: z.number().int().positive().default(120000),
  maxQueueSize: z.number().int().positive().default(1000),
  drainTimeoutMs: z.number().int().positive().default(15000),    // D-01: 10-30s, pick 15s
  spawnPollIntervalMs: z.number().int().positive().default(1000), // D-04
  spawnMaxWaitMs: z.number().int().positive().default(10000),     // D-04
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fixed sleep after spawn | Poll for socket existence | Phase 29 (this phase) | Eliminates timing race on loaded machines |
| PID-only liveness check | PID + socket dual check | Phase 29 (this phase) | Prevents OS PID recycle false positive |
| Unbounded drain wait | Drain with timeout | Phase 29 (this phase) | Broker can shut down even if job is stuck |
| Silent crash (no handler) | Explicit crash handler with cleanup | Phase 29 (this phase) | Stale files cleaned on uncaught exceptions |

**Deprecated/outdated:**
- `await new Promise<void>(r => setTimeout(r, 500))` in spawnBrokerIfNeeded: replaced by poll loop per D-03.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Drain timeout of 15s is within the acceptable 10-30s range per D-01 | Code Examples | Low — D-01 explicitly grants Claude's discretion on exact value |
| A2 | Config key names `drainTimeoutMs`, `spawnPollIntervalMs`, `spawnMaxWaitMs` are acceptable | Code Examples | Low — D-04 grants Claude's discretion on key names |
| A3 | Client.ts poll loop can use hardcoded defaults (1s/10s) rather than reading broker config file | Architecture Patterns | Low — defaults match D-03/D-04; config file read in client adds complexity without benefit |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed.

## Open Questions

1. **Where should crash handlers be placed relative to PID write?**
   - What we know: Crash handlers call `fs.rmSync(PID_PATH, { force: true })`. PID file is written at main.ts:76. Before that, PID_PATH cleanup is a no-op (force:true ignores ENOENT).
   - What's unclear: Should handlers be registered before or after PID write? Before PID write, cleanup is harmless. After PID write, cleanup is necessary.
   - Recommendation: Register at module level (outside `main()`) so they catch errors in all execution phases. Safe because `{ force: true }` makes pre-PID-write cleanup harmless.

2. **Does client.ts need broker config access for poll values?**
   - What we know: client.ts currently imports only `SOCK_PATH` and `PID_PATH` from config. Loading `BrokerConfig` requires an async `loadBrokerConfig()` call.
   - What's unclear: Whether adding config loading to client.ts is worth the complexity.
   - Recommendation: Use hardcoded defaults (1000ms, 10000ms) as named constants in client.ts. The config fields in config.ts serve broker-side use. The client defaults can be aligned values without a file read.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | Yes | v22.21.1 | — |
| TypeScript / esbuild | Build | Yes | dist/ exists | — |
| `process.on('uncaughtException')` | BRKR-02 | Yes | Node.js 22 built-in | — |
| `fs.existsSync` | BRKR-01, BRKR-04 | Yes | Node.js 22 built-in | — |
| `Promise.race` | BRKR-03 | Yes | ES2015 built-in | — |
| `zod` | BRKR-04 config schema | Yes | Already in package.json | — |

No missing dependencies.

## Sources

### Primary (HIGH confidence)
- `/home/autopcap/FileScopeMCP/src/broker/main.ts` — read directly; verified isPidRunning, checkPidGuard, signal handler patterns
- `/home/autopcap/FileScopeMCP/src/broker/client.ts` — read directly; verified spawnBrokerIfNeeded 500ms sleep and stale detection
- `/home/autopcap/FileScopeMCP/src/broker/server.ts` — read directly; verified BrokerServer.shutdown() drain logic
- `/home/autopcap/FileScopeMCP/src/broker/config.ts` — read directly; verified BrokerConfigSchema Zod pattern
- `/home/autopcap/FileScopeMCP/src/broker/worker.ts` — read directly; verified getCurrentJobPromise() and .unref() pattern
- Node.js 22.21.1 runtime — verified ESRCH behavior, uncaughtException handler registration, fs.existsSync, Promise.race

### Secondary (MEDIUM confidence)
- Node.js process documentation [CITED: https://nodejs.org/api/process.html#event-uncaughtexception] — uncaughtException handler synchrony requirement

### Tertiary (LOW confidence)
None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all APIs verified against live Node.js 22.21.1 and existing codebase
- Architecture: HIGH — all four target files read and analyzed; change surface precisely identified
- Pitfalls: HIGH — derived from direct code analysis, not speculation

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable Node.js APIs — not time-sensitive)
