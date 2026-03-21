# Pitfalls Research

**Domain:** Adding Unix domain socket IPC broker to an existing single-process Node.js system
**Researched:** 2026-03-21
**Confidence:** HIGH (codebase audit + Node.js official docs + verified external sources)

---

## Critical Pitfalls

### Pitfall 1: Stale Socket File Causes EADDRINUSE Loop on Broker Restart

**What goes wrong:**
The broker writes its Unix socket to `~/.filescope/broker.sock`. When the broker process crashes (SIGKILL, OOM, power loss) the socket file is NOT removed — Node.js only auto-unlinks sockets created via `net.createServer()` when `server.close()` is explicitly called. On next startup, `server.listen(SOCK_PATH)` throws `EADDRINUSE`. The broker fails to start. All instances fall back to direct mode silently. The broker never comes back up, even after the user manually relaunches it.

The subtler failure is the "blind delete" trap: if broker startup unconditionally deletes the socket file before listening, a second broker instance that starts at the same time will silently steal the socket from the first — both call `fs.unlinkSync()` then `server.listen()` and whichever wins the race becomes the broker while the other instance's clients are permanently orphaned.

**Why it happens:**
Developers assume Node.js cleans up socket files the same way it handles TCP port release. It does not. The socket file is a filesystem artifact that persists until explicitly unlinked.

**How to avoid:**
On broker startup, probe the socket before touching it:

```typescript
async function acquireSocket(sockPath: string): Promise<void> {
  try {
    await fs.access(sockPath);
    // File exists — is a real broker still using it?
    await new Promise<void>((resolve, reject) => {
      const probe = net.connect(sockPath);
      probe.once('connect', () => {
        probe.destroy();
        reject(new Error('BROKER_ALREADY_RUNNING'));
      });
      probe.once('error', (err: NodeJS.ErrnoException) => {
        probe.destroy();
        if (err.code === 'ECONNREFUSED' || err.code === 'ENOENT') {
          // Stale socket — safe to remove
          resolve();
        } else {
          reject(err);
        }
      });
    });
    await fs.unlink(sockPath); // Remove stale socket
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT' && e.message !== 'BROKER_ALREADY_RUNNING') throw e;
    if (e.message === 'BROKER_ALREADY_RUNNING') throw e;
    // ENOENT = file doesn't exist, safe to proceed
  }
}
```

Also register cleanup on process exit:
```typescript
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('exit', () => { try { fs.unlinkSync(sockPath); } catch {} });
```

**Warning signs:**
- Broker refuses to start after any crash; only recovers after manual `rm ~/.filescope/broker.sock`
- Instances silently fall back to direct mode with no log noise pointing at IPC
- Two broker processes running simultaneously (check with `lsof ~/.filescope/broker.sock`)

**Phase to address:** Broker process phase — implement `acquireSocket()` as the first thing broker does before calling `server.listen()`. Do not defer this to hardening.

---

### Pitfall 2: NDJSON Framing Breaks on Partial `data` Events

**What goes wrong:**
TCP and Unix domain socket streams do NOT guarantee message boundaries. A single `socket.write('{"type":"submit",...}\n')` call from the client may arrive as two `data` events on the server: `{"type":"sub` and `mit",...}\n`. Similarly, two back-to-back writes may coalesce into one `data` event. Code that does `JSON.parse(chunk.toString())` on every `data` event will throw `SyntaxError` on partial chunks and silently drop the second message when two arrive together.

This is the single most common IPC bug in Node.js systems. It will not appear in unit tests (where messages are tiny and arrive atomically) and will appear intermittently in production when job payloads are large (file diffs, long prompts).

**Why it happens:**
Unix domain sockets are stream-based, not message-based. There is no concept of "one write = one read." The kernel may deliver data in arbitrary chunks depending on buffer sizes, scheduling, and kernel version.

**How to avoid:**
Use Node's built-in `readline` module to wrap the socket — it handles all buffer accumulation internally and emits exactly one `line` event per `\n`-terminated message:

```typescript
import readline from 'node:readline';

// Server side — per-connection framing
server.on('connection', (socket) => {
  const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;       // skip blank lines between messages
    try {
      const msg = JSON.parse(line);
      handleMessage(socket, msg);
    } catch (err) {
      log(`broker: malformed JSON from client — ${err}`);
      // Do NOT destroy socket on parse error — it may be a version mismatch
      // Log and skip; the connection is still valid
    }
  });
  rl.on('close', () => handleDisconnect(socket));
});

// Send side — always terminate with \n
function send(socket: net.Socket, msg: object): boolean {
  return socket.write(JSON.stringify(msg) + '\n');
}
```

Note: NDJSON is safe for this use case because the JSON spec requires that newline characters WITHIN string values be escaped as `\n` (not literal newlines). A correctly serialized JSON object never contains a literal `\n`, so newline is an unambiguous message delimiter.

**Warning signs:**
- `SyntaxError: Unexpected token` in broker logs, intermittently
- Jobs get submitted but broker never processes them (message was silently discarded)
- Bug only reproduces when payload field contains long content (file diffs > ~4KB)

**Phase to address:** Broker IPC protocol phase — use `readline` from the start, not a manual buffer accumulator. The manual approach has well-known off-by-one bugs at buffer boundaries.

---

### Pitfall 3: Broker Startup Race — Instance Connects Before Server Is Listening

**What goes wrong:**
The coordinator `init()` code starts the LLM pipeline and the broker client in sequence. If the broker process is launching concurrently with the first instance, the instance attempts `net.connect(SOCK_PATH)` before the broker has called `server.listen()`. The connect attempt fails with `ECONNREFUSED`. The instance logs "broker unavailable" and switches to direct mode. It does not retry. The broker finishes starting 50ms later. The instance stays in direct mode for the entire session.

The same race occurs when the user starts three Claude sessions in rapid succession (one per repo). All three instances connect before the broker is ready. All three fall back to direct mode. The broker starts successfully but has no clients.

**Why it happens:**
Process startup order is not guaranteed. Even if the coordinator spawns the broker, `child_process.spawn()` returns before the child process has called `net.createServer().listen()`.

**How to avoid:**
The broker client must implement exponential backoff with jitter on initial connect, treating the first `ECONNREFUSED` as a transient startup condition rather than permanent unavailability:

```typescript
const BASE_DELAY_MS = 100;
const MAX_DELAY_MS = 10_000;
const MAX_ATTEMPTS = 8;

async function connectWithBackoff(sockPath: string): Promise<net.Socket> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await tryConnect(sockPath);
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ECONNREFUSED' && e.code !== 'ENOENT') throw e;
      if (attempt === MAX_ATTEMPTS - 1) throw err;
      const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS)
                  + Math.random() * BASE_DELAY_MS; // jitter
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('BROKER_UNREACHABLE');
}
```

The jitter is critical: without it, all instances that start simultaneously will retry at exactly the same intervals, creating a reconnection storm that spikes CPU on the broker side every N seconds.

**Warning signs:**
- All instances in direct mode immediately after launch even when broker process is running
- Broker logs show zero connections despite multiple instances running
- Direct mode and broker mode running simultaneously in different instances

**Phase to address:** Broker client phase — wire exponential backoff before writing any other client logic. Test with artificial startup delay in broker to verify retry behavior.

---

### Pitfall 4: In-Flight Job Lost When Broker Disconnects During Processing

**What goes wrong:**
An instance submits a job to the broker. The broker dequeues it, starts the Ollama call (which takes 5-30 seconds), and during that call the broker process crashes or the Unix socket disconnects. The instance receives a socket `close` event and switches to direct mode. The job is gone — it was in the broker's in-memory queue, not persisted anywhere. The file stays stale indefinitely. No error is logged at the instance level because the instance does not know the job was in flight at the broker.

**Why it happens:**
In-memory queue means jobs have no durability. When the broker process dies, all queue state dies with it. The instance only knows it submitted a job; it has no record of which jobs are in-flight at the broker.

**How to avoid:**
When the broker client detects a disconnect (`socket.on('close', ...)` or `socket.on('error', ...)`), it must re-enqueue all jobs that were submitted but not yet acknowledged with a completion response:

```typescript
class BrokerClient {
  private pendingJobs: Map<string, JobRequest> = new Map(); // jobId → original request

  submitJob(job: JobRequest): void {
    this.pendingJobs.set(job.jobId, job);
    this.send({ type: 'submit', ...job });
  }

  onJobComplete(jobId: string): void {
    this.pendingJobs.delete(jobId); // Only remove on explicit ack
  }

  onDisconnect(): void {
    // Re-queue all pending jobs locally
    const requeue = [...this.pendingJobs.values()];
    this.pendingJobs.clear();
    for (const job of requeue) {
      this.localFallbackQueue.enqueue(job);
    }
    this.switchToDirectMode();
  }
}
```

The instance must track "submitted to broker but not yet complete" separately from "in local queue." The set of tracked jobs gives the re-queue list on disconnect.

**Warning signs:**
- Files remain stale after broker crash/restart despite being recently changed
- LLM pipeline processes no jobs after broker reconnect
- `get_llm_status` shows 0 pending jobs but files have stale summaries

**Phase to address:** Broker client phase — implement the `pendingJobs` map as part of the initial client design, not as a hardening step. It is not optional.

---

### Pitfall 5: Mode-Switch Double-Processing — Same Job Runs in Both Broker and Direct Mode

**What goes wrong:**
The broker client switches to direct mode when it detects a connection error. At the same moment, the broker has already dequeued the job and is running the Ollama call. The instance, now in direct mode, sees the file is stale and enqueues the same job locally. Both the broker and the instance call Ollama for the same file concurrently. Both write results back — the instance to its local DB, the broker sending a response over a socket that no longer has a live listener. The result is wasted GPU time and a `write EPIPE` error from the broker.

**Why it happens:**
The mode switch is not atomic with respect to in-flight jobs. The instance's staleness check runs immediately after the disconnect, before the broker has finished (or failed) the current job.

**How to avoid:**
Two mitigations together solve this:

1. The broker MUST send a `complete` or `failed` message back to the instance before processing the next job. This gives the instance a hook to remove the job from its `pendingJobs` map even if the connection is restored.

2. The instance must check for a result in its local DB before enqueuing a re-queued job. If the broker completed the job and the result was written before the disconnect was detected, there is no work to do:

```typescript
function shouldReenqueue(job: JobRequest): boolean {
  const file = getFile(job.filePath); // read local SQLite
  if (!file) return false;
  const field = job.jobType === 'summary' ? 'summary_stale' : `${job.jobType}_stale`;
  return (file as Record<string, unknown>)[field] === 1;
}
```

**Warning signs:**
- Duplicate Ollama requests visible in Ollama server logs for the same file within seconds of each other
- `write EPIPE` errors in broker logs after instance disconnect
- Token stats showing 2x expected usage for recently-changed files

**Phase to address:** Broker client phase, specifically the mode-switch transition logic. This must be tested with a deliberately slow Ollama mock that takes 10 seconds per job.

---

### Pitfall 6: `socket.write()` Backpressure Ignored, Causing Silent Message Loss

**What goes wrong:**
`socket.write(data)` returns `false` when the socket's internal buffer is full. If the caller ignores the return value and keeps writing (common with fire-and-forget logging patterns), messages are silently dropped. For the broker use case: a single instance that rapidly submits 50 jobs at startup will overflow the socket buffer if the broker is slow to read. Jobs appear to be submitted but the broker never receives them. No error is thrown.

**Why it happens:**
`socket.write()` is asynchronous and non-blocking — it queues data and returns immediately. The `false` return value is the only signal that the buffer is full, and it is easy to miss when porting from synchronous or HTTP-based communication patterns.

**How to avoid:**
For a low-throughput broker (job submissions are not high-frequency), the safest approach is to flush each write and wait for `drain` before the next. A simple wrapper:

```typescript
function writeMessage(socket: net.Socket, msg: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(msg) + '\n';
    const flushed = socket.write(data, (err) => {
      if (err) reject(err);
    });
    if (flushed) {
      resolve();
    } else {
      socket.once('drain', resolve);
    }
  });
}
```

For the broker submission rate (one job per file change event, debounced at 2 seconds), true backpressure is unlikely in practice. But the error handler is still needed: an `EPIPE` error from `socket.write()` with no error listener will crash the process with an unhandled exception.

Always attach an error listener to every socket:
```typescript
socket.on('error', (err) => {
  log(`broker client: socket error — ${err.code}`);
  handleDisconnect();
});
```

**Warning signs:**
- `Error: write EPIPE` crashes the instance process (unhandled error event)
- Jobs submitted during startup burst never appear in broker queue
- Broker queue is always empty despite active file watching

**Phase to address:** Broker IPC protocol phase — add error listeners before the first `socket.write()`. Treat missing error listeners as a bug.

---

### Pitfall 7: esbuild Splits broker.ts Into a Separate Entry Point, Duplicating Shared Modules

**What goes wrong:**
The current build command compiles all source files as individual entry points with `--outdir=dist`. Adding `src/broker/broker.ts` as a new entry point means esbuild compiles it independently. Any module imported by both `mcp-server.ts` and `broker.ts` (e.g., `logger.ts`, `config-utils.ts`) gets compiled into BOTH output files. If those shared modules have module-level state (singletons, Maps, initialized objects), each output file gets its own isolated copy. The broker process and the MCP server process each have their own logger state. This is fine at runtime since they are separate processes — but it means the deduplication warning in esbuild's output can be confusing, and shared config changes require rebuilding both files.

The harder failure is if `broker.ts` is mistakenly added to the existing single-entry build command (producing a bundle where the broker server AND the MCP server run in the same process) vs. being a true separate process entry point.

**Why it happens:**
The existing build compiles all source files individually (not as a single bundle). Adding `broker.ts` to this list works for the shared-library compilation model. But the broker is a standalone process, not a library — it needs its own entry point that bootstraps the process, not just a compiled module.

**How to avoid:**
Add a separate build script for the broker entry point. Keep `broker.ts` OUT of the main `build` script's file list — it is not a library module consumed by `mcp-server.ts`, it is a standalone server:

```json
{
  "scripts": {
    "build": "esbuild src/mcp-server.ts [... library files ...] --format=esm --outdir=dist --platform=node",
    "build:broker": "esbuild src/broker/broker.ts --bundle --format=esm --outdir=dist --platform=node --external:better-sqlite3 --external:tree-sitter"
  }
}
```

The `--bundle` flag for the broker entry point matters: it allows esbuild to tree-shake and inline shared utilities, reducing the broker to a single self-contained file. Mark native addons as `--external` so esbuild does not attempt to bundle the `.node` binary.

**Warning signs:**
- Broker starts successfully but cannot find `logger.ts` or `config-utils.ts` at runtime
- `dist/broker/broker.js` imports from relative paths that no longer exist in the broker's working directory
- Build output shows `better-sqlite3` bundling warnings

**Phase to address:** Broker process phase — define the build configuration for `broker.ts` before writing any broker code. Getting the build shape wrong early means refactoring import paths later.

---

### Pitfall 8: Unix Socket Path Exceeds OS Limit (103 Bytes on macOS)

**What goes wrong:**
`~/.filescope/broker.sock` expands to `/home/username/.filescope/broker.sock` on Linux. For a typical Linux user this is well under 107 bytes. But on macOS, the limit is 103 bytes, and some Linux distributions use longer usernames or home paths. A path like `/home/very_long_username_here/.filescope/broker.sock` (52 characters) is fine; but `/Users/very_long_username/.filescope/broker.sock` on macOS is also fine at 47 chars. The real risk is CI environments, Docker containers, or systems where `$HOME` is a long path.

If the path exceeds the limit, `server.listen(sockPath)` throws `Error: path is too long` at broker startup.

**Why it happens:**
`sockaddr_un.sun_path` is a fixed-size C struct field. The limit is baked into the kernel ABI.

**How to avoid:**
Validate the socket path length on broker startup and fail with a clear error message:

```typescript
const SOCK_PATH = path.join(os.homedir(), '.filescope', 'broker.sock');
if (Buffer.byteLength(SOCK_PATH, 'utf8') > 103) {
  // Use 103 as the conservative cross-platform limit
  throw new Error(
    `Socket path too long (${SOCK_PATH.length} bytes, max 103): ${SOCK_PATH}. ` +
    `Set FILESCOPE_SOCK_PATH environment variable to a shorter path.`
  );
}
```

The 103-byte limit is conservative (macOS minimum). Using `Buffer.byteLength` instead of `.length` handles non-ASCII characters in paths correctly.

**Warning signs:**
- Broker fails to start on macOS CI with `Error: path is too long`
- Works in dev (short home path) but fails in a specific user's environment
- Error message from kernel is cryptic: does not mention the 103-byte limit

**Phase to address:** Broker process phase — add the path length check in the broker's startup sequence. Document `FILESCOPE_SOCK_PATH` as the override env var.

---

### Pitfall 9: Priority Starvation — Low-Importance Files Never Processed When High-Importance Files Keep Arriving

**What goes wrong:**
The broker queue is ordered by `importance DESC`. In an active development session where the user is editing high-importance files (importance 7-10) continuously, the in-memory queue always has importance-9 jobs at the front. Low-importance files (importance 1-3) that were enqueued at session start are still pending 30 minutes later. When the session ends, those files have never been summarized.

This is not a theoretical concern: a monorepo where the user edits `src/index.ts` (importance 10) repeatedly will continuously push importance-10 jobs to the front, starving `docs/CHANGELOG.md` (importance 1) indefinitely.

**Why it happens:**
Pure priority ordering with no aging mechanism is mathematically guaranteed to starve low-priority items when high-priority items arrive faster than they are consumed.

**How to avoid:**
For the broker's in-memory queue, apply a simple aging mechanism: jobs that have been waiting more than a threshold are promoted. A practical threshold for this use case is 5 minutes (300,000ms). Implementation:

```typescript
function effectivePriority(job: QueuedJob, nowMs: number): number {
  const waitMs = nowMs - job.enqueuedAt;
  const agingBoost = Math.floor(waitMs / 300_000); // +1 per 5 minutes waiting
  return Math.min(job.importance + agingBoost, 10);
}
```

The aging boost is capped at the maximum importance (10) to prevent wrap-around arithmetic bugs. Re-sort the queue using `effectivePriority()` on each dequeue call rather than on insert (so the boost is computed fresh at dequeue time, not stale from insert time).

Note: starvation is less severe in this system than in general scheduling because each instance only submits jobs for its own repo. A session editing importance-10 files does not starve importance-3 jobs from a different repo (those are in a different instance's submission stream). However, within a single repo, the problem applies.

**Warning signs:**
- `get_llm_status` shows jobs with `created_at` more than 10 minutes ago still pending
- Low-importance files in the same repo never get summaries in long sessions
- Queue depth stays non-zero even after 20 minutes of inactivity

**Phase to address:** Broker queue phase — build the aging function into the dequeue logic from the start. Test with a queue loaded with 10 low-importance jobs followed by a stream of high-importance inserts.

---

### Pitfall 10: `server.close()` Does Not Close Existing Connections — Broker Hangs on Shutdown

**What goes wrong:**
`server.close()` stops the broker from accepting new connections but does NOT close existing connections. If instances are connected when the broker shuts down, the `close` event on the server is never emitted (it fires only when all connections are ended). The broker process hangs indefinitely, holding the socket file. Subsequent broker restarts fail with `BROKER_ALREADY_RUNNING` (the probe connects to the hung process, which is still listening on existing connections).

**Why it happens:**
This is a documented Node.js `net.Server` behavior that surprises most developers. `server.close()` is "close to new connections" not "close everything."

**How to avoid:**
Track all active client sockets and destroy them during shutdown:

```typescript
const activeConnections: Set<net.Socket> = new Set();

server.on('connection', (socket) => {
  activeConnections.add(socket);
  socket.once('close', () => activeConnections.delete(socket));
});

async function shutdown(): Promise<void> {
  // Stop accepting new connections
  await new Promise<void>((resolve) => server.close(() => resolve()));
  // Close all existing connections
  for (const socket of activeConnections) {
    socket.destroy();
  }
  // Clean up socket file
  try { await fs.unlink(SOCK_PATH); } catch {}
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
```

`socket.destroy()` is appropriate here (not `socket.end()`) because shutdown is intentional and immediate. There is no protocol-level "goodbye" message needed — instances detect the socket close and switch to direct mode.

**Warning signs:**
- Broker process stays alive after SIGTERM; `kill -9` required
- `lsof ~/.filescope/broker.sock` shows connections still open after broker exit was requested
- Next broker start reports `BROKER_ALREADY_RUNNING` when the old broker should be gone

**Phase to address:** Broker process phase — wire `activeConnections` tracking into the initial server setup, before any graceful shutdown testing.

---

### Pitfall 11: Coordinator Init Race — Shared Queue Opens Before `~/.filescope/` Directory Exists

**What goes wrong:**
The coordinator's `init()` calls `openSharedQueue()` which attempts to open `~/.filescope/queue.db`. If `~/.filescope/` does not exist (first run on a new machine, or the directory was manually deleted), `better-sqlite3` throws `SQLITE_CANTOPEN: unable to open database file`. The coordinator crashes before it can run any MCP tools. No helpful error message is shown to the user.

**Why it happens:**
`better-sqlite3` does not create parent directories — it only creates the database file itself. `~/.filescope/` must exist before opening.

**How to avoid:**
Create the directory with `fs.mkdirSync(dir, { recursive: true })` before opening any SQLite databases in it. The `recursive: true` flag makes this a no-op if the directory already exists:

```typescript
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const FILESCOPE_DIR = join(homedir(), '.filescope');

export function openSharedQueue(): Database {
  mkdirSync(FILESCOPE_DIR, { recursive: true }); // safe to call every time
  return new Database(join(FILESCOPE_DIR, 'queue.db'));
}
```

**Warning signs:**
- Coordinator fails to start on fresh machines with `SQLITE_CANTOPEN`
- Works fine in dev (directory exists from previous runs) but fails for new users
- Error message does not mention the missing directory

**Phase to address:** Shared queue phase — add `mkdirSync` as the first line of `openSharedQueue()`. This is a one-liner that prevents a class of first-run failures.

---

### Pitfall 12: `readline.createInterface` Does Not Propagate Socket Errors

**What goes wrong:**
When a socket emits an `error` event, the `readline.Interface` wrapping it does NOT propagate that error — it only closes. If the only error handler is on the `rl` instance (not on the raw socket), errors like `ECONNRESET` are silently swallowed. The broker loses track of the client, the `pendingJobs` map is never cleaned up, and jobs are never re-queued.

**Why it happens:**
`readline.Interface` is designed for interactive line reading, not socket error handling. Its `close` event fires on both graceful close AND error, making it impossible to distinguish between them from the `rl` interface alone.

**How to avoid:**
Always attach error handlers to the raw socket, separate from the `readline` interface:

```typescript
server.on('connection', (socket) => {
  // Error handler on RAW socket — required
  socket.on('error', (err) => {
    log(`broker: client socket error — ${err.code}`);
    handleClientDisconnect(socket);
    socket.destroy();
  });

  // readline for message framing only
  const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
  rl.on('line', (line) => handleMessage(socket, line));
  rl.on('close', () => handleClientDisconnect(socket));
});
```

The `handleClientDisconnect` function must be idempotent — both `rl.close` and `socket.error` can fire for the same disconnect event.

**Warning signs:**
- Socket errors (`ECONNRESET`) produce no log output from the broker
- Pending job maps grow unboundedly because disconnect cleanup never runs
- Dead clients remain in the broker's client registry indefinitely

**Phase to address:** Broker IPC protocol phase — add socket error handlers in the same commit that adds the `readline` interface. They are inseparable.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Skip exponential backoff, use fixed 1s retry | Simpler reconnect logic | Reconnection storm when broker restarts with multiple instances | Never — jitter is 3 lines of code |
| Ignore `socket.write()` return value | No async complexity | Silent message loss under load, potential EPIPE crash | Never — attach error listener at minimum |
| Skip `pendingJobs` tracking in broker client | Simpler client code | Jobs lost on disconnect, files stay stale silently | Never — it is the core correctness guarantee |
| Blind-delete stale socket without probing | Simpler startup | Kills a live broker if two instances start simultaneously | Never — the probe is 10 lines |
| Skip aging in priority queue | Simpler dequeue | Low-priority files never processed in active sessions | Acceptable only if single-repo use is the only target |
| Use `socket.end()` in broker shutdown | "Graceful" close | Server.close() hangs waiting for clients to finish | Never — use `socket.destroy()` for intentional shutdown |
| Add broker.ts to main build script file list | One build command | broker.ts compiles as a library module, not a standalone process | Never — broker needs `--bundle` flag, main build does not |
| No path length validation | No startup overhead | Cryptic kernel error on long-path systems, no hint for user | Never — it is a one-liner check |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `net.createServer()` + Unix socket | Call `server.listen()` and assume socket file is auto-cleaned on crash | Register `process.on('exit')` handler to `fs.unlinkSync(sockPath)` |
| `readline` + socket | Only attach `rl.on('error')` | Always attach `socket.on('error')` on the raw socket; `readline` does not forward errors |
| `socket.write()` | Call and ignore return value | Check return value; attach `socket.on('error')` to catch EPIPE |
| `server.close()` | Expect all connections to be closed | Track `activeConnections`, call `socket.destroy()` on each during shutdown |
| `better-sqlite3` + `~/.filescope/queue.db` | Open DB directly | Call `mkdirSync(dir, { recursive: true })` first |
| esbuild + broker entry point | Add `broker.ts` to existing `--outdir` build | Use separate `--bundle` build command with native addons marked `--external` |
| `net.connect()` to probe stale socket | Assume `ECONNREFUSED` is always stale | Handle both `ECONNREFUSED` (stale) and successful connection (live broker) cases |
| Priority queue aging | Compute aging boost at insert time | Compute `effectivePriority()` at dequeue time so the boost grows with wait time |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Startup job flood — instance submits ALL stale files at once | Broker queue depth spikes to hundreds; priority ordering is meaningless because all jobs arrive at once | Batch startup submissions: top N by importance (e.g., N=10), then drip-feed as jobs complete | Any repo with >20 stale files at startup |
| Polling with no backoff when broker is slow | Instance polls for job results every 100ms; CPU spikes while broker runs a 20-second LLM call | Use response-driven flow: broker sends `complete` message back; instance acts on that event | Any repo doing change_impact jobs (slow LLM calls) |
| Unbounded in-memory queue growth | Broker process memory grows without bound during sustained high-change-rate sessions | Cap queue at MAX_QUEUE_SIZE per repo (e.g., 500 jobs); reject inserts beyond cap with a warning | Repos with pathological file-change rates (test runners that write thousands of files) |
| `readline` interface not closed when socket is destroyed | Event listeners accumulate; readline's internal buffer leaks memory | Call `rl.close()` explicitly when handling socket disconnect, in addition to `socket.destroy()` | Long-running broker with frequent client connect/disconnect cycles |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| No validation of `type` field in incoming NDJSON messages | Malicious or buggy client sends `type: "../../etc/passwd"` — broker calls wrong handler or crashes | Validate message type against a fixed enum before dispatching; reject unknown types |
| Socket path written to world-readable location | Another user on the system connects to the broker and submits/steals jobs | Use `~/.filescope/` (user's home dir, mode 700 by default); do not use `/tmp/` |
| Job `payload` field not size-capped before passing to LLM | A crafted large payload fills GPU VRAM and hangs the broker | Cap payload at the same limit used for file content reads (existing `maxFileSize` config) |

---

## "Looks Done But Isn't" Checklist

- [ ] **Stale socket cleanup:** Broker restarts cleanly after `kill -9` (not just after SIGTERM) — verify `ECONNREFUSED` probe path works
- [ ] **NDJSON framing:** Submit a job with a 100KB payload field — verify broker receives exactly one `line` event, not multiple fragments
- [ ] **Reconnection backoff:** Start 3 instances before the broker; verify all 3 connect within 30 seconds — not just the first one
- [ ] **In-flight job recovery:** Kill broker mid-Ollama-call; verify instance re-enqueues the job and processes it in direct mode
- [ ] **Mode-switch double-processing:** With a 10-second LLM mock, disconnect instance during processing — verify Ollama is called exactly once, not twice
- [ ] **server.close() hang:** Send SIGTERM to broker with 3 connected instances — verify broker exits within 2 seconds, not hanging
- [ ] **`~/.filescope/` creation:** Delete `~/.filescope/` and restart coordinator — verify clean startup, no SQLITE_CANTOPEN
- [ ] **Socket path length:** Verify broker startup prints a clear error (not a kernel error) when `SOCK_PATH` exceeds 103 bytes
- [ ] **Priority aging:** Load queue with 20 low-importance jobs, then add 5 high-importance jobs — verify low-importance jobs are eventually processed within 10 minutes
- [ ] **esbuild broker build:** `dist/broker.js` is a self-contained file that starts correctly with `node dist/broker.js` — no relative import failures
- [ ] **Error listener coverage:** Trigger `ECONNRESET` on a connected instance — verify broker logs the error and cleans up client state, does not crash

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Stale socket, broker won't start | LOW | `rm ~/.filescope/broker.sock` then restart broker |
| Broker crash loses in-flight jobs | MEDIUM | Jobs stay stale until next file change event or next session startup triggers re-enqueue; no data loss, just delayed processing |
| Mode-switch double-processing discovered in production | LOW | The second result merely overwrites the first in SQLite; no corruption, just wasted GPU time; fix in next deploy |
| Missing `mkdirSync` causes SQLITE_CANTOPEN on fresh installs | MEDIUM | Hotfix: add `mkdirSync` to `openSharedQueue()`; all existing installs are unaffected (directory already exists) |
| esbuild broker build missing `--external` for native addons | HIGH | Broker crashes at startup with `Error: The module did not self-register`; fix build config and rebuild |
| `server.close()` hang blocking supervisor restart | HIGH | `kill -9 <broker_pid>` to force-exit; then fix shutdown logic to call `socket.destroy()` on tracked connections |
| Socket path too long on user's machine | LOW | Set `FILESCOPE_SOCK_PATH=/tmp/fs-broker.sock` as env var override; add env var support to broker config |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Stale socket `EADDRINUSE` on crash | Broker process (Phase 1) | Test: `kill -9` broker, restart — succeeds without manual cleanup |
| NDJSON framing partial reads | IPC protocol (Phase 1) | Test: send 100KB payload — broker receives exactly one `line` event |
| Startup race / connect before listen | Broker client (Phase 2) | Test: start 3 instances before broker — all connect within 30s |
| In-flight job lost on broker disconnect | Broker client (Phase 2) | Test: crash broker mid-job — job re-queued in direct mode |
| Mode-switch double-processing | Broker client (Phase 2) | Test: 10s LLM mock + disconnect — Ollama called exactly once |
| Backpressure / EPIPE crash | IPC protocol (Phase 1) | Test: `ECONNRESET` injection — broker logs error, does not crash |
| esbuild broker build shape | Broker process (Phase 1) | Test: `node dist/broker.js` starts with no import errors |
| `~/.filescope/` missing on first run | Shared queue (Phase 0) | Test: delete dir, restart coordinator — clean startup |
| `server.close()` hang on shutdown | Broker process (Phase 1) | Test: SIGTERM with 3 connected instances — exits within 2s |
| Socket path length limit | Broker process (Phase 1) | Test: set long HOME path — clear error message, not kernel panic |
| Priority starvation | Broker queue (Phase 1) | Test: 20 low-priority jobs + stream of high-priority — low processed within 10min |
| `readline` error not propagated | IPC protocol (Phase 1) | Test: `ECONNRESET` — broker logs error and cleans client state |

---

## Sources

- [Node.js `net` module official docs — v24 (current)](https://nodejs.org/api/net.html) — `server.close()` behavior, `EADDRINUSE`, socket file lifecycle, `allowHalfOpen`, backpressure (HIGH confidence — official docs)
- [Node.js Readline official docs](https://nodejs.org/api/readline.html) — `createInterface`, `line` event, `crlfDelay` (HIGH confidence — official docs)
- [Node.js Backpressuring in Streams](https://nodejs.org/en/learn/modules/backpressuring-in-streams) — drain event, write() return value (HIGH confidence — official docs)
- [Node.js net module issue #28947](https://github.com/nodejs/node/issues/28947) — impossible Unix domain socket error edge cases (MEDIUM confidence — issue report verified against official docs)
- Codebase audit: `/home/autopcap/FileScopeMCP/src/llm/pipeline.ts` — existing dequeue loop pattern, `scheduleNext` with `.unref()`, stop/start lifecycle (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/src/coordinator.ts` — `AsyncMutex`, coordinator init sequence, pipeline wiring (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/package.json` — esbuild build command, `--outdir` multi-entry pattern, native addons (better-sqlite3, tree-sitter) (HIGH confidence — direct code review)
- [openclaw gateway restart race condition — GitHub issue #26904](https://github.com/openclaw/openclaw/issues/26904) — real-world PID/socket startup race causing log flood (MEDIUM confidence — issue report from March 2025)
- [esbuild shared code between multiple entrypoints — Issue #2303](https://github.com/evanw/esbuild/issues/2303) — module dedup, code splitting ESM-only constraint (HIGH confidence — esbuild official issue tracker)
- [esbuild API docs](https://esbuild.github.io/api/) — `--external`, `--bundle`, `--platform=node` flags (HIGH confidence — official docs)
- [Node.js and esbuild: beware of mixing CJS and ESM](https://dev.to/marcogrcr/nodejs-and-esbuild-beware-of-mixing-cjs-and-esm-493n) — `--format=cjs` with `--bundle` recommendation (MEDIUM confidence — community article, aligned with official docs)
- [starvation-free-priority-queue GitHub](https://github.com/ori88c/starvation-free-priority-queue) — aging mechanism design (MEDIUM confidence — library docs)
- [Aging (scheduling) — Wikipedia](https://en.wikipedia.org/wiki/Aging_(scheduling)) — aging definition, +1 per wait threshold (HIGH confidence — canonical reference)
- [better-sqlite3 distribution issues — GitHub #1367](https://github.com/WiseLibs/better-sqlite3/issues/1367) — external dependency marking in esbuild (MEDIUM confidence — issue report)
- [NDJSON specification](https://jsonltools.com/ndjson-format-specification) — newline escaping guarantee in JSON strings (HIGH confidence — spec document)
- [Parsing NDJSON in Node.js — bennadel.com](https://www.bennadel.com/blog/3233-parsing-and-serializing-large-datasets-using-newline-delimited-json-in-node-js.htm) — buffer accumulation pattern (MEDIUM confidence — community article)
- [Reconnection strategies with exponential backoff — DEV Community](https://dev.to/hexshift/robust-websocket-reconnection-strategies-in-javascript-with-exponential-backoff-40n1) — jitter formula, MAX_ATTEMPTS pattern (MEDIUM confidence — community article)
- [Better Stack: 16 Common Node.js Errors](https://betterstack.com/community/guides/scaling-nodejs/nodejs-errors/) — ECONNREFUSED, EPIPE handling (MEDIUM confidence — community guide)
- [Taming the Buffer: Handling Backpressure in Node.js](https://runebook.dev/en/articles/node/net/event-drain) — drain event pattern for `net.Socket` (MEDIUM confidence — community article aligned with official docs)

---

*Pitfalls research for: v1.2 LLM Broker — adding Unix domain socket IPC and broker process to FileScopeMCP*
*Researched: 2026-03-21*
