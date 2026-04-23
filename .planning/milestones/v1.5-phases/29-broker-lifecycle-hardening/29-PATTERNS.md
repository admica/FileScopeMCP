# Phase 29: Broker Lifecycle Hardening - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 4 modified files
**Analogs found:** 4 / 4 (all files are self-analog — changes are within existing files)

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/broker/main.ts` | service / process entry | event-driven | `src/broker/main.ts` (self) | exact — all patterns already live here |
| `src/broker/server.ts` | service / socket server | request-response | `src/broker/worker.ts` | exact — same Promise.race + .unref() timeout pattern |
| `src/broker/client.ts` | utility / process spawner | event-driven | `src/broker/client.ts` (self) | exact — poll pattern extends existing stale-detection loop |
| `src/broker/config.ts` | config | transform | `src/broker/config.ts` (self) | exact — new fields follow existing Zod `.number().int().positive().default(N)` pattern |

## Pattern Assignments

### `src/broker/main.ts` — BRKR-01, BRKR-02, BRKR-05

Three changes to this file: fix `checkPidGuard()` liveness gate, add `uncaughtException`/`unhandledRejection` handlers, and ensure concurrent-instance message is correct.

---

**Change 1: Liveness gate fix (BRKR-01, BRKR-05)**

Current code in `checkPidGuard()` (lines 36-38) — the bug:
```typescript
if (!isNaN(pid) && isPidRunning(pid)) {
  log(`Broker already running (PID ${pid})`);
  process.exit(0);
}
```

Analog for `fs.existsSync` guard pattern — already used 3 lines below at line 44:
```typescript
} else if (fs.existsSync(SOCK_PATH)) {
  log('Cleaning stale socket file (no PID file)');
  fs.rmSync(SOCK_PATH, { force: true });
}
```

And the `isPidRunning` pattern (lines 23-29):
```typescript
function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code !== 'ESRCH'; // ESRCH = no such process
  }
}
```

Required change — add `&& fs.existsSync(SOCK_PATH)` to the liveness condition (line 36):
```typescript
if (!isNaN(pid) && isPidRunning(pid) && fs.existsSync(SOCK_PATH)) {
  log(`Broker already running (PID ${pid})`);
  process.exit(0);
}
```

---

**Change 2: Crash handlers (BRKR-02)**

Analog: existing signal handlers (lines 120-121) showing the registration pattern:
```typescript
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

Analog: best-effort cleanup pattern used throughout `main.ts` (lines 113-115 and 42-43):
```typescript
fs.rmSync(SOCK_PATH, { force: true });
fs.rmSync(PID_PATH, { force: true });
```

Analog: startup error handler at the bottom of `main.ts` (lines 126-131) showing synchronous file cleanup before exit:
```typescript
main().catch((err) => {
  console.error(`Broker failed to start: ${err}`);
  try { fs.rmSync(PID_PATH, { force: true }); } catch {}
  process.exit(1);
});
```

New handlers to add — register at module level (outside `main()`) or as the first lines inside `main()` before any `await`. The `{ force: true }` flag makes cleanup safe even if PID/socket files do not yet exist:
```typescript
process.on('uncaughtException', (err: Error) => {
  log(`Broker crash (uncaughtException): ${err.message}\n${err.stack ?? ''}`);
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

**Placement:** Before the `main().catch(...)` call at the bottom of the file. This ensures they fire for any error in any execution phase.

---

**Change 3: Shutdown drain wrapping (main.ts side)**

The `shutdown()` function in `main.ts` calls `await server.shutdown()` (line 111). After the `server.ts` drain timeout is added (see below), the call site requires no change — the timeout is encapsulated in `server.shutdown()`.

If the drain timeout is passed as a parameter to `server.shutdown()`, the call site becomes:
```typescript
await server.shutdown(config.drainTimeoutMs);
```

Config access is already available here — `config` is in scope from `main()` line 70.

---

### `src/broker/server.ts` — BRKR-03

One change: wrap the unbounded `await pending` with a `Promise.race` drain timeout.

**Analog: Promise.race + AbortController timeout in `worker.ts` (lines 179-188)**

This is the exact same pattern used for per-job timeout enforcement:
```typescript
private async runJobWithTimeout(job: QueueJob, timeoutMs: number): Promise<JobResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref();
  try {
    return await this.runJob(job, ac.signal);
  } finally {
    clearTimeout(timer);
  }
}
```

**Analog: `.unref()` on timers — `worker.ts` (line 173)**

The `scheduleNext` method shows the established `.unref()` pattern to prevent the timer from blocking process exit:
```typescript
private scheduleNext(delayMs: number): void {
  if (this.stopped) return;
  this.loopTimer = setTimeout(() => void this.dequeueLoop(), delayMs);
  this.loopTimer.unref(); // Don't prevent process exit
}
```

Current `shutdown()` code to modify (lines 69-90):
```typescript
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

Required change — add drain timeout using the same `Promise.race` + `.unref()` pattern from `worker.ts`:
```typescript
async shutdown(drainTimeoutMs: number = 15000): Promise<void> {
  this.worker.stop();
  const pending = this.worker.getCurrentJobPromise();
  if (pending) {
    log(`Waiting for current job to finish (drain timeout: ${drainTimeoutMs}ms)...`);
    const drainTimeout = new Promise<void>(resolve => {
      const t = setTimeout(resolve, drainTimeoutMs);
      t.unref(); // Don't prevent process exit if job finishes first
    });
    await Promise.race([pending, drainTimeout]);
  }
  for (const socket of this.connections) { socket.destroy(); }
  this.connections.clear();
  await new Promise<void>((resolve) => this.server.close(() => resolve()));
  log('Broker server shut down');
}
```

The `drainTimeoutMs` value of 15000ms (15s) falls within the D-01 permitted range of 10-30s. It can be sourced from `this.config.drainTimeoutMs` if added to `BrokerConfig`, or passed as a parameter from `main.ts`.

---

### `src/broker/client.ts` — BRKR-04

One change: replace the hardcoded 500ms sleep with a poll loop that checks for socket file existence.

**Current code to replace (lines 140-149):**
```typescript
try {
  const distBrokerDir = path.dirname(fileURLToPath(import.meta.url));
  const brokerBin = path.resolve(distBrokerDir, 'main.js');
  spawn(process.execPath, [brokerBin], { detached: true, stdio: 'ignore' }).unref();
  // Give the broker 500ms to bind the socket before we try to connect
  await new Promise<void>(r => setTimeout(r, 500));
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  log(`[broker-client] Warning: failed to spawn broker: ${msg}`);
}
```

**Analog: existing stale detection loop in `spawnBrokerIfNeeded()` (lines 120-138)**

The file already uses `existsSync` for a synchronous socket check — the poll loop extends this pattern:
```typescript
if (existsSync(SOCK_PATH)) {
  if (existsSync(PID_PATH)) {
    const raw = readFileSync(PID_PATH, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    if (!isNaN(pid)) {
      try {
        process.kill(pid, 0);
        return; // broker is alive, nothing to do
      } catch {
        // PID is dead — fall through to clean up and respawn
      }
    }
  }
  log('[broker-client] Stale broker socket detected — cleaning up');
  rmSync(SOCK_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
}
```

**Analog: `requestStatus()` timeout pattern in `client.ts` (lines 93-109)**

Shows the established `timer.unref()` + Promise wrapping pattern already used in this file:
```typescript
const timer = setTimeout(() => {
  pendingStatusRequests.delete(id);
  resolve(null);
}, timeoutMs);
timer.unref();
```

**Required change — add `waitForSocket` helper and replace the 500ms sleep:**

Add named constants near the top of the file after imports:
```typescript
// Spawn readiness poll defaults (D-03, D-04)
const SPAWN_POLL_INTERVAL_MS = 1000;
const SPAWN_MAX_WAIT_MS = 10000;
```

Add the `waitForSocket` helper function alongside the other private helpers:
```typescript
/**
 * Polls for the broker socket file to appear.
 * Returns true when the socket exists, false if the deadline expires.
 */
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
  return existsSync(sockPath); // one final check at deadline
}
```

Replace the 500ms sleep call in the `try` block of `spawnBrokerIfNeeded()`:
```typescript
spawn(process.execPath, [brokerBin], { detached: true, stdio: 'ignore' }).unref();
const ready = await waitForSocket(SOCK_PATH, SPAWN_POLL_INTERVAL_MS, SPAWN_MAX_WAIT_MS);
if (!ready) {
  log('[broker-client] Warning: broker socket did not appear within timeout');
}
```

---

### `src/broker/config.ts` — BRKR-04 (config schema extension)

One change: add three new fields to `BrokerConfigSchema`.

**Analog: existing field pattern in `BrokerConfigSchema` (lines 30-34)**

All fields use `.number().int().positive().default(N)`:
```typescript
export const BrokerConfigSchema = z.object({
  llm: BrokerLLMSchema,
  jobTimeoutMs: z.number().int().positive().default(120000),
  maxQueueSize: z.number().int().positive().default(1000),
});
```

**Required change — add three new fields following the same pattern:**
```typescript
export const BrokerConfigSchema = z.object({
  llm: BrokerLLMSchema,
  jobTimeoutMs: z.number().int().positive().default(120000),
  maxQueueSize: z.number().int().positive().default(1000),
  drainTimeoutMs: z.number().int().positive().default(15000),      // D-01: graceful drain, 10-30s range
  spawnPollIntervalMs: z.number().int().positive().default(1000),  // D-04: poll interval for socket readiness
  spawnMaxWaitMs: z.number().int().positive().default(10000),      // D-04: max wait for socket to appear
});
```

The `BrokerConfig` type is inferred from the schema (`z.infer<typeof BrokerConfigSchema>`) so the new fields are automatically available on the type — no separate type change needed.

---

## Shared Patterns

### Best-Effort Cleanup with `{ force: true }`
**Source:** `src/broker/main.ts` (lines 42-43, 113-115, 129)
**Apply to:** All cleanup call sites in BRKR-02 crash handlers and existing shutdown path
```typescript
fs.rmSync(SOCK_PATH, { force: true });
fs.rmSync(PID_PATH, { force: true });
```
The `{ force: true }` option silently ignores ENOENT — safe to call whether or not the files exist. This is the established pattern for all cleanup in the broker.

### `.unref()` on All Timers
**Source:** `src/broker/worker.ts` (lines 172-173), `src/broker/client.ts` (line 99)
**Apply to:** drain timeout timer in `server.ts`, poll interval timers in `client.ts`
```typescript
const t = setTimeout(resolve, delayMs);
t.unref(); // Don't prevent process exit
```
Every timer in the broker codebase calls `.unref()` to avoid blocking process exit. The drain timeout timer in `server.ts` must follow this pattern.

### `shutdownStarted` Guard Against Double-Execution
**Source:** `src/broker/main.ts` (lines 104-108)
**Apply to:** Crash handlers interact with the same cleanup path — no change needed
```typescript
let shutdownStarted = false;

async function shutdown(sig: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  // ...
}
```
Crash handlers (`uncaughtException`, `unhandledRejection`) bypass this guard. The `{ force: true }` option on `fs.rmSync` makes double-cleanup safe — no additional guard is needed in crash handlers.

### Zod Schema Field Pattern
**Source:** `src/broker/config.ts` (lines 30-34)
**Apply to:** New config fields in `config.ts`
```typescript
fieldName: z.number().int().positive().default(N),
```
All numeric config fields follow this exact chain. Boolean or optional fields are not used in the top-level schema.

---

## No Analog Found

None. All four files are self-analog — each change extends or fixes an established pattern already present in the same file.

---

## Metadata

**Analog search scope:** `src/broker/` (all four target files read directly)
**Files scanned:** 5 (`main.ts`, `client.ts`, `server.ts`, `config.ts`, `worker.ts`)
**Pattern extraction date:** 2026-04-17
