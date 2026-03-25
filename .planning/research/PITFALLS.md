# Pitfalls Research

**Domain:** Adding a centralized observability daemon (Nexus) to an existing multi-process Node.js system with a live LLM broker
**Researched:** 2026-03-24
**Confidence:** HIGH (codebase audit + broker implementation post-mortem + Node.js official docs + SQLite WAL official docs)

---

## Critical Pitfalls

### Pitfall 1: Nexus Becomes Critical Path When Graceful Degradation Is Implemented Incorrectly

**What goes wrong:**
The design requirement is "Nexus down = zero impact on core functionality." But the client code does something like:

```typescript
// Coordinator init()
await nexusConnect(repoPath);         // spawns Nexus, waits for connect
await emit({ type: 'repo:init', ... }); // fire-and-forget, but...
```

If `nexusConnect` throws (permission denied writing `~/.filescope/nexus.pid`, disk full, Nexus binary missing), and the error propagates up through `coordinator.init()`, the MCP instance fails to start — because of the observability layer. The user's Claude session is broken by a daemon whose entire purpose is to be optional.

The second failure mode is subtler: the Nexus client blocks coordinator startup while waiting for the Nexus to bind its socket. With the broker client, a 500ms sleep was added after spawn. If the Nexus is slow to start (cold filesystem, large repos counting files for `repo:init`), that sleep is too short and the first `emit()` drops silently — but startup time has increased by 500ms on every session. If the sleep is made longer, it compounds when BOTH broker and Nexus are spawned.

**Why it happens:**
The broker was also supposed to be optional, but its `connect()` is `async` and the coordinator does `await brokerConnect()`. Developers copy this pattern for the Nexus. The `await` is fine for broker because the broker has a direct impact on whether LLM jobs run. For the Nexus, there is no reason to await anything.

**How to avoid:**
The Nexus client must NEVER be awaited in any path that blocks coordinator init. The correct pattern:

```typescript
// coordinator.init():
brokerConnect(repoPath).catch(() => {}); // still awaited — LLM depends on it
nexusConnect(repoPath);                   // fire-and-don't-await — intentionally not awaited
                                          // also not .catch() suppressed — no error to suppress
                                          // because nexusConnect never throws
```

`nexusConnect` must be implemented as a fully synchronous kick-off that swallows all errors internally:

```typescript
export function nexusConnect(repoPath: string): void {
  _repoPath = repoPath;
  _intentionalDisconnect = false;
  spawnNexusIfNeeded().catch(() => {}); // spawn errors are silent
  scheduleConnect();                     // connect attempt is scheduled, not awaited
}
```

The 500ms post-spawn sleep must be replaced with a connect-retry loop (same pattern as the broker client's reconnect timer). The Nexus client should attempt to connect immediately, and retry every 10 seconds if it fails — never blocking coordinator init.

**Warning signs:**
- MCP tool calls fail when Nexus binary is not present in `dist/`
- `coordinator.init()` takes noticeably longer when Nexus is cold-starting
- Any log line saying "waiting for nexus" in coordinator init

**Phase to address:** Nexus client phase (Phase 3). Write the `nexusConnect()` function as fire-and-forget-and-never-throws before wiring any emit calls. Verify by deleting `dist/nexus/main.js` and confirming coordinator still starts clean.

---

### Pitfall 2: Multi-Instance Spawn Race Produces Duplicate Nexus Daemons

**What goes wrong:**
Three MCP instances start simultaneously (three Claude sessions opening three repos). All three call `spawnNexusIfNeeded()`. All three check `existsSync(SOCK_PATH)` — the file does not exist yet. All three spawn the Nexus binary with `spawn(..., { detached: true }).unref()`. Three Nexus processes are now running. They all race to call `server.listen(SOCK_PATH)`. Two get `EADDRINUSE` and crash. The winner survives. But the two losers already wrote their PIDs to `nexus.pid` (or one of them won the PID file write race), so the PID file may point to a dead process. All three MCP clients now try to connect to the socket — which works because the winner is listening. But on the next session start, `checkPidGuard()` reads a PID that may belong to a terminated process (the loser), concludes the Nexus is not running, and spawns another daemon.

**Why it happens:**
The `existsSync(SOCK_PATH)` check is not atomic with the spawn. Between the check and the spawn completing, another instance can pass the same check. The broker had this same race — the documented solution was `checkPidGuard()` checking both the PID file and the socket. But with three instances racing simultaneously, the PID file and socket checks are both window-raced.

**How to avoid:**
The Nexus main.ts must implement the same two-stage guard the broker uses, but both losers must exit via `process.exit(0)` (not crash) when they lose the `server.listen` race:

```typescript
// nexus/main.ts
function checkPidGuard(): void {
  if (fs.existsSync(PID_PATH)) {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10);
    if (!isNaN(pid) && isPidRunning(pid)) {
      process.exit(0); // already running — silent exit, not error
    }
    // Stale PID — clean up and continue
    fs.rmSync(SOCK_PATH, { force: true });
    fs.rmSync(PID_PATH, { force: true });
  } else if (fs.existsSync(SOCK_PATH)) {
    fs.rmSync(SOCK_PATH, { force: true });
  }
}
```

Additionally, the `server.listen()` error handler must treat `EADDRINUSE` as "another instance won the race, exit cleanly":

```typescript
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log('Nexus already running (lost bind race) — exiting');
    process.exit(0); // not an error — another instance won
  }
  throw err; // real errors still propagate
});
```

The MCP client side must NOT retry spawning if the socket appears after a failed connect. Check `existsSync(SOCK_PATH)` before spawning, not just at the start of `nexusConnect()`.

**Warning signs:**
- `ps aux | grep nexus` shows multiple nexus processes
- `nexus.pid` contains a PID that does not match the running nexus process
- Nexus log shows "Error: EADDRINUSE" followed by crash (exit code 1) rather than clean exit

**Phase to address:** Nexus server phase (Phase 2). The PID guard and EADDRINUSE handler must be the first things written in `nexus/main.ts`, before any socket logic.

---

### Pitfall 3: SQLite WAL Mode Write Batching Flushes on Process Exit, Losing the Last Batch

**What goes wrong:**
The Nexus accumulates activity inserts in a buffer and flushes every 500ms or 50 events. When the Nexus receives SIGTERM (e.g., machine shutdown, user `kill`), the shutdown handler closes the database immediately. Any events accumulated since the last flush — potentially the last 499ms of activity — are lost. This includes `repo:disconnect` events from all connected MCP instances, which are emitted during their own shutdown sequences and arrive in the final seconds before the Nexus exits.

The WAL-specific failure: even if you flush the in-memory buffer before closing, `better-sqlite3` requires an explicit `db.pragma('wal_checkpoint(TRUNCATE)')` call to ensure the WAL file is fully checkpointed. If the process exits after `db.close()` but before the checkpoint completes (which is asynchronous at the kernel level), the WAL file may not be fully applied to the main database file. On the next startup, WAL recovery runs automatically — but if the WAL file is partially written (disk full mid-write), recovery may fail, leaving the database inaccessible.

**Why it happens:**
Developers implement the happy path: buffer flushes on timer. Shutdown path is added later and calls `db.close()` without draining the buffer or checkpointing WAL.

**How to avoid:**
The shutdown sequence for `NexusServer` must explicitly flush before closing:

```typescript
async shutdown(): Promise<void> {
  // 1. Stop accepting connections — no new events
  await new Promise<void>(resolve => this.server.close(() => resolve()));
  // 2. Destroy all client sockets — no more event emissions
  for (const socket of this.connections.keys()) socket.destroy();
  // 3. Flush pending batch before closing DB
  this.store.flushPendingBatch(); // synchronous better-sqlite3 call
  // 4. Checkpoint WAL to consolidate into main file
  this.store.checkpoint(); // db.pragma('wal_checkpoint(TRUNCATE)')
  // 5. Close database
  this.store.close();
}
```

The `flushPendingBatch()` method must be synchronous (better-sqlite3 is synchronous by design) and must be called BEFORE `db.close()`. Do not call it after `db.close()`.

For WAL corruption protection: set `PRAGMA journal_mode = WAL` and `PRAGMA synchronous = NORMAL` (not FULL). NORMAL provides crash safety with acceptable write latency. FULL doubles write time for minimal additional safety benefit in this use case.

**Warning signs:**
- Last few events before Nexus shutdown are missing from `nexus.db`
- `repo:disconnect` events never appear in the activity log even when MCP instances shut down cleanly
- On startup, Nexus logs WAL recovery messages more than once per week
- `nexus.db-wal` file persists on disk after Nexus exits (indicates WAL not checkpointed)

**Phase to address:** Nexus store phase (Phase 1). Implement `flushPendingBatch()` and `checkpoint()` in `store.ts`. Make shutdown sequence in `main.ts` call them in the correct order. Test by sending 40 events then sending SIGTERM — verify all 40 appear in `nexus.db`.

---

### Pitfall 4: Write Batching Timer Accumulates Unboundedly During High-Volume Scan

**What goes wrong:**
The design specifies "flush every 500ms or 50 events." During a `scan_all` on a large repo, hundreds of `job:submitted` events arrive in rapid succession. With a 50-event threshold, each batch flushes after 50 events — but the timer fires every 500ms regardless. If the timer fires while a batch is mid-flush (though better-sqlite3 is synchronous, so this can't overlap in the same process), the timer accumulates. The real problem is different: if each flush takes 10ms (50 inserts in a transaction), and events arrive at 200/second, the flush loop runs 4 times per second — but the setTimeout is set for 500ms. The timer is rescheduled after each flush, not cancelled between flushes.

Result: after a 30-second scan_all with 1000 events, there are 60 pending timer callbacks that all want to flush an empty buffer. Each callback acquires the database (no-op in better-sqlite3), checks the buffer length (0), and exits. No data loss, but 60 unnecessary SQLite lock acquisitions per scan — visible as CPU spikes after heavy scans.

More critically: if the design uses `setInterval` instead of a rescheduled `setTimeout`, multiple flushes can be "queued up" in the event loop. Since better-sqlite3 is synchronous, they serialize — but each blocks the event loop for ~10ms, creating perceptible latency for incoming socket events during heavy flush cycles.

**Why it happens:**
The batching design sounds simple but has three moving parts (timer, count threshold, shutdown flush) that must be coordinated. Using `setInterval` is the first instinct; it is the wrong choice for a threshold-based flusher.

**How to avoid:**
Use a self-rescheduling `setTimeout` pattern, not `setInterval`. Reset the timer on every flush (whether triggered by count or timer):

```typescript
class ActivityBatcher {
  private buffer: ActivityRow[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  append(row: ActivityRow): void {
    this.buffer.push(row);
    if (this.buffer.length >= 50) {
      this.flush(); // triggers reset of timer
    } else if (this.timer === null) {
      this.scheduleFlush(); // start timer only if not already running
    }
  }

  private scheduleFlush(): void {
    this.timer = setTimeout(() => this.flush(), 500);
    this.timer.unref(); // don't prevent process exit
  }

  flush(): void {
    if (this.buffer.length === 0) return;
    const rows = this.buffer.splice(0); // drain atomically
    this.timer && clearTimeout(this.timer);
    this.timer = null;
    // single transaction for all rows
    this.db.transaction(() => {
      for (const row of rows) insertActivity.run(row);
    })();
    // reschedule only if more work arrived during flush
    if (this.buffer.length > 0) this.scheduleFlush();
  }
}
```

The `unref()` call on the timer is critical: without it, the Nexus process will not exit when all connections close because the timer holds the event loop open.

**Warning signs:**
- CPU usage spikes ~1-2 seconds after a heavy scan completes, then drops
- `nexus.log` shows "Flushed 0 events" log lines (if you log empty flushes)
- Event loop latency (measurable via `process.hrtime`) spikes during flush cycles

**Phase to address:** Nexus store phase (Phase 1). Write a unit test that sends 200 events rapidly and verifies the timer fires at most once per 500ms window and that no events are duplicated or lost.

---

### Pitfall 5: `repo:init` Required-First-Message Contract Broken by Reconnect Edge Cases

**What goes wrong:**
The Nexus design requires that the first message on any new connection is `repo:init`. The server maps `Socket → RepoConnection` only after receiving this message. Events received before `repo:init` are orphaned — the server can't associate them with a repo. The Nexus design acknowledges this: "On malformed message: log warning, skip (don't kill the connection)."

The edge case is reconnection. When an MCP instance reconnects after a Nexus restart (or a network blip), the broker client in `src/broker/client.ts` calls `resubmitStaleFiles()` immediately after `connect`. The nexus client pattern mirrors this: it calls `emit({ type: 'repo:init', ... })` immediately after connect. But the emit is fire-and-forget via `socket.write()`. If the `connect` event fires and both `repo:init` and `job:submitted` emissions are queued in the same event loop tick, they arrive at the Nexus in order — but if the nexus client has a bug where `emit()` is called before the `connect` event fires (e.g., from a `progress:update` timer that ticked while the socket was connecting), the `progress:update` may arrive before `repo:init`.

The deeper issue: if the Nexus drops the connection because it received a non-`repo:init` message first, and the MCP client doesn't detect this drop (because it only checks `socket.destroyed`, not a Nexus-level acknowledgment), the client thinks it's connected and keeps emitting into the void.

**Why it happens:**
Fire-and-forget is designed to not care about delivery. But the "first message must be `repo:init`" contract creates a hidden ordering dependency that is violated when timing is just right.

**How to avoid:**
Two rules enforced in the Nexus server:

1. Never drop connections on bad first message — log the warning and simply wait. The next message might be `repo:init`. Do NOT implement any protocol enforcement that closes the socket.

2. The Nexus server must treat any `repo:init` message (even mid-stream) as a re-registration, not just as the first message. The `Map<Socket, RepoConnection>` update must happen whenever `repo:init` arrives, not only on first message.

```typescript
// nexus/server.ts — dispatch
private handleMessage(msg: NexusEvent, socket: net.Socket): void {
  if (msg.type === 'repo:init') {
    // Always register/update — even on reconnect mid-stream
    this.registerConnection(socket, msg);
    return;
  }
  const conn = this.connections.get(socket);
  if (!conn) {
    // Pre-init event — log and drop, but don't close the connection
    log(`Event before repo:init (${msg.type}) — skipping`);
    return;
  }
  this.routeEvent(conn, msg);
}
```

On the client side: the progress debounce timer must be cancelled and reset on every new connection. `nexusConnect()` must clear any running timers before establishing a new socket.

**Warning signs:**
- Nexus log shows "Event before repo:init" for `progress:update` events after reconnect
- Some MCP instances show as "unknown repo" in Nexus logs despite running `repo:init`
- Reconnect after Nexus restart produces orphaned events in the activity log with null `repo_path`

**Phase to address:** Nexus server phase (Phase 2). Add a test: connect socket, immediately emit `progress:update` before `repo:init`, then emit `repo:init`. Verify the Nexus does not close the socket and correctly routes subsequent events.

---

### Pitfall 6: Stats Migration Race — Broker and Nexus Both Write Token Stats Simultaneously

**What goes wrong:**
The migration plan has three phases. During Phase 1 (Nexus ships but broker still writes `stats.json`), two processes are writing token stats independently. The broker writes to `~/.filescope/stats.json` after each job via `fs.writeFileSync`. The Nexus writes `total_tokens` to `nexus.db` after each `job:completed` event. These are separate files — no write contention between them.

The problem occurs in Phase 2 (cutover). The Nexus reads `stats.json` on first startup and imports it into `nexus.db` as a one-time migration. Then both systems continue accumulating tokens. If the migration logic uses "import only if nexus.db has no token data," there's a race: the Nexus processes 50 `job:completed` events before the status tool query triggers the import check. The check finds `total_tokens > 0` and skips import. The historical data from `stats.json` is never imported. The user sees a reset token counter.

The second failure: the broker stops writing `stats.json` in Phase 3. But the Nexus may be down (user killed it, disk full). The `status` MCP tool now shows "tokens: unavailable." The token counter that was previously always available is now conditionally available, which feels like a regression.

**Why it happens:**
Phased migrations with "Phase 1 / Phase 2 / Phase 3" sound clean on paper but create a window where both old and new systems are partially active, and the cutover condition ("first startup with no token data") is fragile.

**How to avoid:**
Simplify the migration to a single atomic operation. On Nexus startup, always read `stats.json` (if it exists) and merge it into `nexus.db`:

```typescript
function migrateStatsJson(db: Database): void {
  const statsPath = path.join(os.homedir(), '.filescope', 'stats.json');
  if (!fs.existsSync(statsPath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as { repoTokens: Record<string, number> };
    const merge = db.prepare(`
      UPDATE repos SET total_tokens = total_tokens + ?
      WHERE repo_path = ? AND total_tokens < ?
    `);
    // Only add stats.json tokens if they're higher (avoid double-counting)
    db.transaction(() => {
      for (const [repoPath, tokens] of Object.entries(data.repoTokens)) {
        // Use MAX semantics: if stats.json has more tokens, use that baseline
        db.prepare(`INSERT OR IGNORE INTO repos (repo_path, repo_name, first_seen, last_seen, total_tokens)
                    VALUES (?, ?, ?, ?, ?)`).run(repoPath, path.basename(repoPath), Date.now(), Date.now(), 0);
        merge.run(Math.max(0, tokens - (getCurrentTokens(db, repoPath))), repoPath, tokens);
      }
    })();
    log(`Migrated token stats from stats.json`);
  } catch (err) {
    log(`Warning: stats.json migration failed — ${err}. Continuing without historical data.`);
  }
}
```

Keep `stats.json` in place and do not delete it in Phase 3. The broker can keep writing it as a no-op backup indefinitely. Deleting `stats.json` is not worth the coordination risk.

**Warning signs:**
- Token counter drops to zero after Nexus ships
- `status` MCP tool shows different token counts than broker's `stats.json`
- After Nexus restart, total_tokens is lower than before restart

**Phase to address:** Stats migration phase (Phase 5). Never delete `stats.json`. Import on every Nexus startup using MAX semantics to avoid double-counting. Test by pre-populating `stats.json` with 10,000 tokens for a repo, starting the Nexus, and verifying `total_tokens` in `nexus.db` reflects the historical data.

---

### Pitfall 7: Log File Rotation Loses Events During Rename Window

**What goes wrong:**
The design specifies rotating `nexus.log` at 10MB, keeping 3 files. The implementation opens a file stream, checks size on each write batch, and when size exceeds 10MB, does:

```
nexus.log.2 → deleted
nexus.log.1 → nexus.log.2
nexus.log   → nexus.log.1
open new nexus.log
```

If events arrive from MCP clients between the rename of `nexus.log` and the open of the new file, the write fails with `ENOENT` (file has been renamed away) or `EBADF` (file descriptor is now invalid). If the write failure is silently swallowed (common with `stream.write()` which emits `error` events rather than throwing), those log lines are permanently lost. A user doing `tail -f nexus.log` during rotation also loses the tail because the inode changes.

A second issue: the rotation check happens "on each write batch." If the batch flush runs every 500ms and the file is 10MB exactly at flush time, the rotation and the batch write happen in the same synchronous block — in better-sqlite3's execution model, this is safe. But the log file write is NOT better-sqlite3 — it is `fs.appendFileSync` or a writable stream. These two operations must be kept strictly sequential.

**Why it happens:**
Log rotation is typically implemented last (it's not needed until the log gets big) and tested never (10MB takes weeks to accumulate in dev). The error path during the rename window is not exercised.

**How to avoid:**
Use synchronous file operations for log writing (not a stream) to avoid the EBADF/ENOENT window. The pattern:

```typescript
function writeLogLine(line: string): void {
  try {
    const stat = fs.statSync(LOG_PATH);
    if (stat.size > LOG_ROTATE_BYTES) {
      rotateLogs(); // renames synchronously before the next write
    }
    fs.appendFileSync(LOG_PATH, line + '\n', 'utf-8');
  } catch (err) {
    // Log write failure is silent — observability layer must not throw
    // Optionally: stderr fallback for debugging
  }
}

function rotateLogs(): void {
  // Synchronous renames — no window between operations
  try { fs.rmSync(LOG_PATH + '.2', { force: true }); } catch {}
  try { fs.renameSync(LOG_PATH + '.1', LOG_PATH + '.2'); } catch {}
  try { fs.renameSync(LOG_PATH, LOG_PATH + '.1'); } catch {}
  // New LOG_PATH will be created by first appendFileSync after rotation
}
```

Using `appendFileSync` (not a stream) means each log line opens, appends, and closes the file. This is slower than a stream but the Nexus log volume is low enough (one line per event, max ~200 events/minute) that the syscall overhead is negligible. It also means rotation is safe: the old file has been renamed and closed before the next write opens a new file at the same path.

**Warning signs:**
- `tail -f nexus.log` shows output stopping mid-session without the Nexus stopping
- Log lines are missing for the 5-10 second window when the log rotates
- `nexus.log.1` exists but is smaller than 10MB (rotation triggered too early by a stat() race)

**Phase to address:** Nexus store phase (Phase 1). Use `appendFileSync` from the start — never use a stream for log writing. Test rotation by setting `LOG_ROTATE_BYTES` to 1000 in tests and verifying all lines are present across the rotation boundary.

---

### Pitfall 8: Stale Socket Cleanup Race With the PID Guard — Nexus Cleans Its Own Live Socket

**What goes wrong:**
The broker's PID guard cleanup sequence (which the Nexus mirrors) has a subtle race on broker startup that is amplified when both broker and Nexus are added:

```
MCP instance A starts → spawns Nexus → Nexus checks PID (stale) → removes nexus.sock → removes nexus.pid
MCP instance B starts 50ms later → also sees no nexus.sock → spawns another Nexus process
```

The race is not just between multiple MCP instances — it can happen between two startup attempts from the SAME instance. If the coordinator crashes mid-init and is restarted by the user immediately, `nexus.sock` was cleaned up by the first Nexus startup (which got to PID guard cleanup), and the new startup then spawns a second Nexus — before the first Nexus has had time to bind.

A worse version: the broker startup cleans up `broker.sock` (documented in the existing PITFALLS.md). It does NOT clean up `nexus.sock`. The Nexus startup cleans up `nexus.sock`. Neither cleans up the other's files. But the timing matters: if both broker and Nexus are spawned simultaneously, and BOTH call `fs.rmSync(SOCK_PATH, { force: true })` on their own sockets, a third process checking for the existence of either socket file may find it absent and spawn yet another daemon.

**Why it happens:**
The cleanup is done with `fs.rmSync({ force: true })` which silently succeeds even if the file doesn't exist or has already been deleted by another process. There is no lock between "check PID" and "remove socket."

**How to avoid:**
The guard must write the PID file BEFORE binding the socket. The sequence in `nexus/main.ts`:

```
1. checkPidGuard()        — read + validate existing PID
2. writeFileSync(PID_PATH) — claim ownership FIRST
3. server.listen(SOCK_PATH) — only then bind socket
4. on EADDRINUSE: remove PID_PATH, exit(0)
```

If step 3 fails with EADDRINUSE, step 4 must remove the PID file we just wrote. This ensures the PID file is only present when the socket is also present, and the PID is always the process currently holding the socket.

The check in the MCP client's `spawnNexusIfNeeded()` must check BOTH files:

```typescript
async function spawnNexusIfNeeded(): Promise<void> {
  // Only skip spawn if BOTH sock AND pid exist and pid is running
  if (existsSync(SOCK_PATH) && existsSync(PID_PATH)) {
    const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
    if (!isNaN(pid) && isPidRunning(pid)) return; // definitely running
  }
  // Either file missing, or PID stale — let the Nexus sort it out on startup
  spawn(nexusBin, { detached: true, stdio: 'ignore' }).unref();
  // No sleep — connect via retry loop, not by waiting for spawn
}
```

**Warning signs:**
- `nexus.pid` points to a dead process but `nexus.sock` is a live socket (PID file not cleaned up on EADDRINUSE)
- Two Nexus processes running simultaneously (check with `lsof nexus.sock`)
- MCP client logs "spawning nexus" more than once per session

**Phase to address:** Nexus server phase (Phase 2). Test: write a script that starts 5 MCP instances simultaneously, wait 5 seconds, verify only one Nexus process is running and all 5 instances are connected to it.

---

### Pitfall 9: Ring Buffer Memory Growth From Large `detail` JSON Payloads

**What goes wrong:**
The activity table schema has a `detail TEXT` field for "anything else" — the `progress:update` event payload is stored here as JSON. A `progress:update` event looks like:
```json
{ "totalFiles": 343, "withSummary": 47, "withConcepts": 12, "pendingSummary": 296, "pendingConcepts": 331 }
```
That is ~100 bytes. Harmless. But the design says the in-memory ring buffer holds the "slim post-insert versions." If the implementation accidentally stores the full original event object (including the original `NexusEvent` fields: `type`, `timestamp`, `repoPath`, `repoName`, plus the detail payload) rather than a slim summary object, and the ring buffer cap is 1000 events, memory usage is:

1000 events × (average event size ~200 bytes) = 200KB. Fine.

But if `tool:called` is logged with the full tool args included (the design explicitly says "Tool args are NOT included"), or if `files:changed` accidentally includes the full list of changed file paths (not just `changedCount, staledCount`), event sizes balloon. A `files:changed` event for a 500-file cascade with full paths is ~15KB per event. 1000 events × 15KB = 15MB in the ring buffer. For 10 active repos, that's 150MB of ring buffer — on a machine with 16GB VRAM committed to the GPU.

**Why it happens:**
The event types are defined in `types.ts` with specific fields. But if the server stores `msg as received` rather than projecting to a slim object, future additions to event payloads automatically bloat the ring buffer without any developer noticing.

**How to avoid:**
Define a `RingEntry` type that is separate from `NexusEvent` and contains only what's needed for the ring buffer:

```typescript
interface RingEntry {
  id: number;           // activity.id from SQLite insert
  timestamp: number;
  eventType: string;
  repoPath: string;
  summary: string;      // pre-formatted display string, not raw fields
}
```

The `summary` field is a pre-formatted human-readable string (same as the log line). The ring buffer stores `RingEntry[]`, not `NexusEvent[]`. The raw event fields are stored in SQLite but never held in the ring buffer.

Add a test that measures ring buffer memory after inserting 1000 events with large `detail` payloads and asserts that memory growth per event is under 500 bytes.

**Warning signs:**
- Nexus process RSS grows steadily over hours during active sessions
- `process.memoryUsage().heapUsed` increases by >1MB per 100 events received
- Memory pressure visible when multiple large repos are scanning simultaneously

**Phase to address:** Nexus store phase (Phase 1). Define `RingEntry` before implementing the ring buffer. Never store `NexusEvent` directly in the ring buffer array.

---

### Pitfall 10: `query:stats` Response Protocol Makes Nexus Partially Critical Path for `status` Tool

**What goes wrong:**
The design states: "This is the ONE case where the Nexus sends a response — it's a simple request/response for the status tool only." The `status` MCP tool currently calls `requestStatus()` on the broker (which has a 2-second timeout returning null on failure). After stats migration, the status tool also calls `queryStats()` on the Nexus.

The problem: the status tool is now making TWO async calls — one to the broker, one to the Nexus — and the user perceives the tool as slow if either has a 2-second timeout. Worse: if the MCP client is not connected to the Nexus (Nexus never spawned because LLM is disabled), `queryStats()` returns null after 2 seconds. The status tool call now takes 2 seconds minimum, even when nothing is wrong. This is a regression from the current behavior where `status` returns instantly when the broker is disconnected.

A second subtlety: the `query:stats` message sent to the Nexus must be handled differently from fire-and-forget events. The Nexus server must send a response back over the socket. This means the Nexus socket protocol now has two modes: fire-and-forget (events from client) and request/response (stats query from client). This asymmetry is a protocol design smell that future developers will not expect and may break.

**Why it happens:**
The stats query is added as an afterthought to the fire-and-forget protocol. It "seems simple" but creates a stateful request-tracking requirement on both sides.

**How to avoid:**
Two options:

**Option A (preferred):** Keep the Nexus as pure sink. For the status tool, read token totals directly from `nexus.db` using a read-only better-sqlite3 connection opened in the MCP instance:

```typescript
// In status tool handler — read nexus.db directly if it exists
function getNexusTokens(repoPath: string): number | null {
  const dbPath = path.join(os.homedir(), '.filescope', 'nexus.db');
  if (!existsSync(dbPath)) return null;
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare('SELECT total_tokens FROM repos WHERE repo_path = ?').get(repoPath);
    db.close();
    return (row as any)?.total_tokens ?? null;
  } catch { return null; }
}
```

This has zero latency (SQLite read is local), no socket round-trip, no timeout, and no protocol complexity. The Nexus remains a pure event sink.

**Option B (if direct DB read is rejected):** Set a 200ms timeout (not 2000ms) for stats queries, and make the status tool display "tokens: (nexus unavailable)" immediately rather than waiting. Never let an observability query block a tool call for more than 200ms.

**Warning signs:**
- `status` tool call takes >500ms when Nexus is not running
- Status tool response is slower after v1.3 ships than before
- Nexus server code has `pendingStatsRequests: Map<string, ...>` — a sign it has become stateful in the request-tracking sense

**Phase to address:** Stats migration phase (Phase 5). Decide on Option A or Option B before writing any `query:stats` protocol code. If Option A is chosen, delete the `query:stats` protocol entirely — it adds complexity with no benefit.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `await nexusConnect()` in coordinator init | Simpler code, mirrors broker | Nexus becomes critical path; MCP fails if Nexus binary missing | Never — nexus client must be fire-and-don't-await |
| `setInterval` for batch flush timer | Simpler implementation | Timer accumulates after heavy scans; unnecessary DB lock acquisitions | Never — use self-rescheduling setTimeout with unref() |
| Store `NexusEvent` objects directly in ring buffer | No extra type | Ring buffer grows unboundedly with large event payloads | Never — define RingEntry projection type |
| Skip batch flush in shutdown sequence | Simpler shutdown code | Last 499ms of events lost on every Nexus stop | Never — flush is 2 lines of synchronous better-sqlite3 |
| Use writable stream for log file | Faster writes | Events lost during 10MB rotation rename window | Acceptable only if log size is capped below 1MB (never rotates) |
| Add `query:stats` to Nexus protocol | Avoids direct DB reads | Nexus becomes partially critical path for `status` tool; 2s timeout degrades tool UX | Only if direct DB read is architecturally prohibited |
| Blind `fs.rmSync` without PID check in spawn guard | Simpler spawn check | Kills live Nexus if two instances start within 100ms | Never — check both PID file and socket, let Nexus handle EADDRINUSE |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Nexus client in coordinator | `await nexusConnect()` mirrors broker pattern | `nexusConnect()` is void, not async — never awaited, never throws |
| Progress debounce timer | Timer keeps running across reconnects | Cancel and reset timer on every new socket connection |
| SQLite WAL + shutdown | Call `db.close()` at end of shutdown | Flush batch first, then `wal_checkpoint(TRUNCATE)`, then `db.close()` |
| Log rotation + appendFileSync | Use writable stream for performance | Use `appendFileSync` — log volume is low, stream's async model creates rotation race |
| `stats.json` migration | "Import only if nexus.db is empty" | Always import on startup using MAX semantics — idempotent, safe to repeat |
| Ring buffer storage | Store incoming `NexusEvent` directly | Project to slim `RingEntry` at insert time — decouple buffer size from event size |
| EADDRINUSE on Nexus startup | Crash (exit code 1) or retry | `process.exit(0)` — another instance won the race, not an error |
| Better-sqlite3 WAL reads from MCP instance | Open DB with `{ readonly: true }` and read total_tokens directly | Use `{ fileMustExist: true }` to avoid creating empty file if Nexus never ran |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Batch timer not unref'd | Nexus process won't exit when all connections close | `timer.unref()` on every setTimeout call | Immediately — any session where Nexus is idle |
| SQLite `PRAGMA synchronous = FULL` for WAL mode | Each write batch takes 2× longer | Use `PRAGMA synchronous = NORMAL` — WAL provides sufficient crash safety | At >100 events/sec on spinning disk |
| Activity table INSERT without index on repo_path | History queries for a specific repo do full table scans | Index `idx_activity_repo ON activity(repo_path, timestamp)` at table creation | At >10k rows (~1 week of active usage) |
| 30-day pruning as full table scan at startup | Startup takes 500ms+ on long-running systems | Use `DELETE FROM activity WHERE timestamp < ?` with the index — O(log n) not O(n) | After 30 days of continuous operation |
| Direct DB reads from MCP instance open new Database() per call | 10ms overhead per status query from SQLite open/close | Cache the read-only DB handle, close lazily | Any status tool call |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Nexus socket world-readable in `/tmp/` | Another local user connects and reads cross-repo token stats | Use `~/.filescope/nexus.sock` (mode 700 home dir), never `/tmp/` |
| Storing MCP tool args in `tool:called` events | File contents passed to `set_file_summary` end up persisted in nexus.db | Explicitly exclude args — log only `toolName + durationMs`, never args |
| `nexus.db` readable by other users | Activity log reveals which files are being worked on and their LLM processing patterns | Ensure `~/.filescope/` is created with mode 700; `nexus.db` inherits from directory |

---

## "Looks Done But Isn't" Checklist

- [ ] **Graceful degradation:** Delete `dist/nexus/main.js` — coordinator must start cleanly, all MCP tools must work, zero error logs about nexus
- [ ] **Graceful degradation:** Start Nexus, then kill it with `kill -9` — MCP instance must continue working, no crashes, reconnect timer fires quietly
- [ ] **Multi-instance spawn:** Start 5 MCP instances simultaneously — verify exactly one Nexus process after 5 seconds (`ps aux | grep nexus | grep -v grep`)
- [ ] **Shutdown flush:** Send 40 events, immediately send SIGTERM — verify all 40 appear in `nexus.db` (not just the first 0 or 50)
- [ ] **WAL checkpoint:** After Nexus shutdown, verify `nexus.db-wal` file is absent or zero bytes
- [ ] **Log rotation:** Set rotate threshold to 1000 bytes, write 200 log lines — verify `nexus.log.1` exists and all 200 lines are present across `nexus.log` + `nexus.log.1`
- [ ] **Stats migration:** Pre-populate `stats.json` with 50,000 tokens for a test repo — start Nexus — verify `total_tokens` in `nexus.db` is ≥ 50,000
- [ ] **Ring buffer size:** Inject 1000 events with 500-byte `detail` payloads — verify Nexus RSS does not grow by more than 5MB
- [ ] **repo:init ordering:** Connect socket, emit `progress:update` before `repo:init`, then emit `repo:init` — verify connection is not closed, subsequent events are routed correctly
- [ ] **Timer unref:** Stop all MCP instances (all nexus connections close) — verify Nexus process exits within 60 seconds (batch timer fires, finds nothing, exits cleanly)
- [ ] **EADDRINUSE exit code:** Two Nexus processes race to bind — verify the loser exits with code 0, not 1 (not counted as error by process supervisor)
- [ ] **Status tool latency:** With Nexus down, call `status` tool — verify response in <300ms, not 2000ms

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Nexus in critical path — MCP won't start | HIGH | Hotfix: change `await nexusConnect()` to `nexusConnect()` (remove await); redeploy |
| Stale nexus.sock after crash | LOW | `rm ~/.filescope/nexus.sock ~/.filescope/nexus.pid` — Nexus auto-respawns on next MCP init |
| Last batch lost on SIGTERM | LOW | Restart Nexus; missing events are only the last 499ms before shutdown; no data corruption |
| stats.json migration skipped (token counter reset) | MEDIUM | Stop Nexus, run manual migration script, restart; historical data is in stats.json |
| nexus.db corrupted (power loss during WAL write) | MEDIUM | `rm ~/.filescope/nexus.db` — Nexus recreates on startup; historical data lost but service recovers |
| Log rotation lost events | LOW | Events are in nexus.db; log loss only affects human-readable tail view |
| Ring buffer memory growth discovered in production | MEDIUM | Restart Nexus to clear buffer; fix RingEntry projection in code; monitor RSS after fix |
| EADDRINUSE crash (exit code 1) alerting process supervisor | LOW | Change exit code from 1 to 0 in EADDRINUSE handler; redeploy |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Nexus becomes critical path | Phase 3 (Nexus client) | Test: missing nexus binary — coordinator starts clean |
| Multi-instance spawn race | Phase 2 (Nexus server) | Test: 5 simultaneous instances — exactly one Nexus process |
| WAL shutdown loses last batch | Phase 1 (Nexus store) | Test: 40 events then SIGTERM — all 40 in nexus.db |
| Batch timer accumulation | Phase 1 (Nexus store) | Test: 200 rapid events — no empty flush calls after scan |
| repo:init ordering violations | Phase 2 (Nexus server) | Test: pre-init event then repo:init — connection stays open |
| Stats migration race | Phase 5 (Stats migration) | Test: pre-populated stats.json — tokens appear in nexus.db |
| Log rotation window | Phase 1 (Nexus store) | Test: 1000-byte rotation threshold — all lines present |
| Socket cleanup race | Phase 2 (Nexus server) | Test: PID written before socket bound — EADDRINUSE path cleans PID |
| Ring buffer memory growth | Phase 1 (Nexus store) | Test: 1000 large events — RSS growth <5MB |
| query:stats creates latency | Phase 5 (Stats migration) | Test: Nexus down — status tool responds in <300ms |

---

## Sources

- Codebase audit: `/home/autopcap/FileScopeMCP/src/broker/client.ts` — broker connect/reconnect/fire-and-forget patterns, `_intentionalDisconnect` flag, reconnect timer with `unref()` (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/src/broker/main.ts` — PID guard implementation, `isPidRunning()` via `process.kill(pid, 0)`, SIGTERM/SIGINT shutdown sequence (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/src/broker/server.ts` — `activeConnections: Set<net.Socket>`, `server.close()` + `socket.destroy()` shutdown, NDJSON readline pattern (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/src/broker/stats.ts` — `stats.json` read/write/accumulate pattern; migration surface (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/NEXUS-PLAN.md` — full Nexus design including event types, connection model, write batching spec, log rotation spec, stats migration phases (HIGH confidence — authoritative design document)
- [SQLite WAL mode official docs](https://www.sqlite.org/wal.html) — WAL checkpoint behavior, `wal_checkpoint(TRUNCATE)`, `PRAGMA synchronous` levels, crash safety guarantees (HIGH confidence — official docs)
- [better-sqlite3 synchronous API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — synchronous write semantics, `db.close()`, `db.pragma()`, transaction API (HIGH confidence — official docs)
- [Node.js `fs.appendFileSync` docs](https://nodejs.org/api/fs.html#fsappendfilesyncpath-data-options) — synchronous append behavior, file creation on first call (HIGH confidence — official docs)
- [Node.js `net.Server` docs](https://nodejs.org/api/net.html) — `server.close()` semantics (stops new connections, does not close existing), `EADDRINUSE` behavior (HIGH confidence — official docs)
- [Node.js process memory](https://nodejs.org/api/process.html#processmemoryusage) — `process.memoryUsage().heapUsed` for ring buffer measurement (HIGH confidence — official docs)
- Previous PITFALLS.md (v1.2 broker) — Pitfall 10 on `server.close()` hang, Pitfall 1 on stale socket, Pitfall 3 on startup race — all patterns directly applicable to Nexus (HIGH confidence — internal research)

---

*Pitfalls research for: v1.3 Nexus — adding centralized observability daemon to FileScopeMCP*
*Researched: 2026-03-24*
