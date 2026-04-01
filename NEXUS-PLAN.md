# FileScopeMCP Nexus — Design Plan

## What Is It

The Nexus is a standalone, long-running service that acts as the central observability hub for all FileScopeMCP activity. Every MCP instance (one per repo, spawned by Claude Code or other agents) pushes events to the Nexus as things happen. The Nexus collects, stores, and exposes that data.

It is **not** in the broker's data path. The broker continues to manage the LLM job queue untouched. The Nexus is a parallel service that receives events from MCP instances — it's the system's memory and eyes.

```
Claude (repo A) → MCP instance A ──→ Broker ──→ Ollama
                        │
                        ├──→ Nexus (events, state, history)
                        │         ↑
Claude (repo B) → MCP instance B ──→ Broker
                        │
                        └──→ Nexus
```

## Why

Today, all intelligence is locked inside each MCP instance's SQLite DB and the broker's transient in-memory state. There's no way to see what's happening across repos, no activity history, no progress tracking, and no central place to query the system's state. The only way to know what the LLM is doing is to ask an AI to call MCP tools and read JSON back to you.

The Nexus fixes this by being the single place where all activity is recorded and queryable — by a human tailing a log, a web frontend (future), or any other consumer.

## Lifecycle

Mirrors the broker pattern exactly:

- **First MCP instance** spawns the Nexus (if `~/.filescope/nexus.sock` doesn't exist)
- **Subsequent instances** find it already running and just connect
- **PID guard** at `~/.filescope/nexus.pid` prevents duplicate daemons
- **Graceful shutdown** on SIGTERM/SIGINT: close connections, clean up socket + PID
- **Reconnect** from MCP clients on 10s interval if connection drops

Files:
- `~/.filescope/nexus.sock` — Unix domain socket
- `~/.filescope/nexus.pid` — PID file
- `~/.filescope/nexus.log` — Human-readable activity log (the thing you `tail -f`)
- `~/.filescope/nexus.db` — SQLite database for persistent state

## Graceful Degradation

The Nexus is strictly optional. If it's down, unreachable, or never started:
- MCP instances work exactly as they do today — zero impact on core functionality
- Broker is unaffected — it doesn't know the Nexus exists
- Events are silently dropped (same pattern as broker job submission when disconnected)
- No error messages, no retries, no buffering — just a no-op

This must remain true through all phases. The Nexus is never in the critical path.

## What MCP Instances Push

Events are fire-and-forget NDJSON messages over the Unix socket. MCP instances never wait for a response — the Nexus is purely a sink.

### Common Event Envelope

All events share a common structure:

```typescript
interface NexusEvent {
  type: string;           // event type (repo:init, job:completed, etc.)
  timestamp: number;      // Date.now() at emission time (client-side)
  repoPath: string;       // absolute path to project root
  repoName: string;       // derived short name (last path component or git remote)
  // ... event-specific fields
}
```

`repoName` is derived by the client at connect time (basename of repoPath, e.g. `/home/user/projects/my-app` → `my-app`). This is for display — `repoPath` remains the unique key.

### Event Types

**Repo lifecycle:**
```
repo:init        — MCP instance initialized for a repo
                   { repoPath, repoName, totalFiles, importanceDistribution }

repo:disconnect  — MCP instance shutting down
                   { repoPath, repoName }
```

`importanceDistribution` is a compact histogram: `{ "0": 50, "1-3": 120, "4-6": 80, "7-9": 30, "10": 5 }` — gives the Nexus a sense of the repo's shape without transferring the whole file list.

**LLM job lifecycle (mirrored from broker interactions):**
```
job:submitted    — MCP queued a job to the broker
                   { repoPath, filePath, jobType, importance }

job:completed    — MCP received a result back from the broker
                   { repoPath, filePath, jobType, totalTokens, durationMs }

job:error        — MCP received an error from the broker
                   { repoPath, filePath, jobType, errorCode, errorMessage }
```

**Progress snapshots:**
```
progress:update  — Periodic LLM progress snapshot from a repo
                   { repoPath, totalFiles, withSummary, withConcepts,
                     pendingSummary, pendingConcepts }
```

Emitted on a debounced schedule: after every 10th `job:completed`, or every 60s while jobs are in flight, whichever comes first. Also emitted once on `repo:init` (initial baseline) and once when all pending work completes (final state).

**Tool usage:**
```
tool:called      — An MCP tool was invoked by the AI
                   { repoPath, toolName, durationMs }
```

Tool args are NOT included — they can contain file contents (set_file_summary) or large payloads. Just the tool name and how long it took.

**File watcher activity:**
```
files:changed    — File watcher detected changes, triggering staleness cascade
                   { repoPath, changedCount, staledCount }
```

This captures the moment when the cascade engine marks files stale — useful for understanding why a burst of jobs suddenly appeared in the queue.

### Events NOT Included

- `job:submitted` for the initial `resubmitStaleFiles()` burst — this would spam hundreds of events on every reconnect. Instead, a single `progress:update` after the resubmission batch covers it.
- Individual file details (summaries, concepts, dependencies) — that data lives in each repo's SQLite DB and is too large to push through events. The future web frontend reads repo DBs directly.

### When Events Fire

| Trigger | Event | Location in code |
|---------|-------|-----------------|
| `coordinator.init()` completes | `repo:init` + `progress:update` | End of init() |
| `coordinator.shutdown()` | `repo:disconnect` | Start of shutdown() |
| `brokerClient.submitJob()` | `job:submitted` | After socket.write() (but NOT during resubmitStaleFiles bulk) |
| `brokerClient.handleBrokerMessage()` result | `job:completed` | After writeLlmResult() |
| `brokerClient.handleBrokerMessage()` error | `job:error` | In error handler |
| Every 10th completion or 60s | `progress:update` | Debounced in nexus client |
| All pending work finishes | `progress:update` | When pendingSummary + pendingConcepts hits 0 |
| MCP tool handler returns | `tool:called` | In mcp-server.ts tool handlers |
| File watcher cascade completes | `files:changed` | In coordinator's file change handler |

## Connection & Identity Model

### Socket-Level Tracking

Unlike the broker (which has no per-client identity), the Nexus tracks which socket belongs to which repo. The first message on any new connection MUST be `repo:init`. The Nexus uses this to build a `Map<Socket, RepoConnection>`:

```typescript
interface RepoConnection {
  repoPath: string;
  repoName: string;
  connectedAt: number;
  lastEventAt: number;
  socket: net.Socket;
}
```

On socket close, the Nexus:
1. Marks that repo as disconnected (updates `repos.last_seen`)
2. Logs the disconnect
3. Does NOT delete history — the repo's data persists

### Multiple Instances for Same Repo

If Claude crashes and restarts, or the user opens the same repo in two terminals, the Nexus may receive multiple `repo:init` events for the same `repoPath`. This is fine:
- The repos table uses `INSERT OR REPLACE` — last writer wins for `total_files`, `last_seen`
- Multiple sockets can map to the same `repoPath` — the Nexus tracks a `Map<Socket, RepoConnection>` not a `Map<repoPath, Socket>`
- Connected repos count is by unique `repoPath` across all active sockets, not by socket count
- Events from either instance are stored identically — they have the same `repoPath`

### Reconnect Behavior

When an MCP instance reconnects after a disconnect:
1. Client sends `repo:init` again (required first message)
2. Nexus updates `repos.last_seen` and `total_files`
3. Client sends a `progress:update` with current state
4. Normal event flow resumes

Events that occurred while disconnected are simply lost — no buffering, no replay. The `progress:update` on reconnect gives the Nexus the current state, which is sufficient.

## What the Nexus Stores

### In-Memory (live state)

- **Active connections**: `Map<Socket, RepoConnection>` — tracks which sockets are alive and what repo they represent
- **Connected repos**: derived view — unique repoPaths across active connections, with aggregate state
- **Recent activity**: Ring buffer (last ~1000 events), capped by count not memory. Events in the ring buffer are the slim post-insert versions (no large payloads, since we already stripped those).
- **Aggregate stats**: Live counters — total jobs completed today, total tokens today, rolling jobs/minute rate (1-minute sliding window)

### On Disk (persistent)

**SQLite database** (`~/.filescope/nexus.db`), opened with WAL mode for concurrent read/write performance:

**repos table** — registry of all repos ever seen:
```sql
CREATE TABLE repos (
  repo_path       TEXT PRIMARY KEY,
  repo_name       TEXT NOT NULL,        -- short display name
  first_seen      INTEGER NOT NULL,     -- unix ms
  last_seen       INTEGER NOT NULL,     -- unix ms
  total_files     INTEGER,
  total_tokens    INTEGER DEFAULT 0,
  last_progress   TEXT                  -- JSON snapshot of most recent progress:update
);
```

**activity table** — append-only event log:
```sql
CREATE TABLE activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,       -- unix ms
  event_type  TEXT NOT NULL,          -- repo:init, job:completed, etc.
  repo_path   TEXT NOT NULL,
  file_path   TEXT,                   -- null for repo-level events
  job_type    TEXT,                   -- null for non-job events
  tokens      INTEGER,               -- null for non-completion events
  duration_ms INTEGER,               -- null for non-completion events
  error_code  TEXT,                   -- null for non-error events
  detail      TEXT,                   -- JSON for anything else
  FOREIGN KEY (repo_path) REFERENCES repos(repo_path)
);

CREATE INDEX idx_activity_repo ON activity(repo_path, timestamp);
CREATE INDEX idx_activity_type ON activity(event_type, timestamp);
CREATE INDEX idx_activity_time ON activity(timestamp);
```

**Write batching**: During heavy activity (scan_all on a large repo), the Nexus could receive hundreds of events per second. Activity inserts are batched — accumulated in memory and flushed every 500ms or 50 events, whichever comes first. The repos table and in-memory state update immediately; only the activity log is batched.

**Token stats** are accumulated in the repos table (`total_tokens`), replacing `stats.json`. The broker currently owns `stats.json` — we'll migrate that responsibility to the Nexus.

### Log File

`~/.filescope/nexus.log` — human-readable log. The primary "just watch it" interface:

```
[17:23:01] repo:init       FileScopeMCP        343 files
[17:23:01] repo:init       wtfij               127 files
[17:23:02] job:completed   FileScopeMCP        src/coordinator.ts          summary    412 tok  1.3s
[17:23:04] job:completed   FileScopeMCP        src/db/repository.ts        summary    387 tok  1.1s
[17:23:05] job:error       wtfij               src/main.cpp                concepts   timeout
[17:23:08] tool:called     FileScopeMCP        find_important_files        42ms
[17:23:09] files:changed   wtfij               3 changed, 7 staled
[17:24:01] progress        FileScopeMCP        47/343 summarized, 12/343 concepts
```

Log lines use fixed-width columns for alignment. Repo names are truncated/padded to 20 chars. File paths are relative to repo root and truncated with `...` if over 40 chars.

### Log Rotation

- **Activity table**: retain last 30 days, prune on startup and daily at midnight (via setTimeout). A full scan of 500 files x 3 job types = 1500 rows — even 10 repos scanning daily is ~15k rows/day, well within SQLite's comfort zone for months.
- **Log file**: rotate at 10MB, keep 3 files (nexus.log → nexus.log.1 → nexus.log.2 → deleted). Rotation checked on each write batch, not per-line.

## MCP Client Integration

New module: `src/nexus/client.ts`

Follows the exact same pattern as `src/broker/client.ts`:
- Module-level socket state
- `nexusConnect(repoPath)` — auto-spawn + connect, sends `repo:init` as first message
- `nexusDisconnect()` — sends `repo:disconnect`, then graceful close
- Fire-and-forget `emit(event)` function — silent no-op when disconnected
- 10s reconnect timer, unref'd
- Progress debounce timer (tracks completion count, emits `progress:update` on threshold)

The coordinator calls `nexusConnect()` right after `brokerConnect()` in init, and `nexusDisconnect()` in shutdown. Both connections are independent — neither blocks or depends on the other.

### Integration points in existing code

**coordinator.ts:**
- `init()` → `nexusConnect(repoPath)`, then emit `repo:init` with totalFiles + importance distribution
- `init()` → emit initial `progress:update` baseline
- `shutdown()` → emit `repo:disconnect`, then `nexusDisconnect()`
- File watcher change handler → emit `files:changed`

**broker/client.ts:**
- `submitJob()` → emit `job:submitted` (skip during `resubmitStaleFiles` bulk — controlled by a flag)
- `handleBrokerMessage()` result → emit `job:completed`, increment completion counter, check debounce
- `handleBrokerMessage()` error → emit `job:error`

**mcp-server.ts:**
- Each tool handler → wrap execution in timing, emit `tool:called` with toolName + durationMs

### Import Dependency

The nexus client module must NOT import from broker modules or vice versa. They are independent subsystems. The coordinator is the only module that calls both. The broker/client.ts integration uses the nexus client via a callback or direct import from `nexus/client.ts` — never circular.

## Nexus Server

New module: `src/nexus/server.ts` + `src/nexus/main.ts`

Structure mirrors broker:
- `main.ts` — entry point, PID guard, signal handlers, startup
- `server.ts` — NexusServer class, connection handling, event routing
- `types.ts` — event type definitions (shared with client)
- `store.ts` — SQLite persistence layer (nexus.db), write batching, rotation

The server is simpler than the broker — it only receives events, never sends work. Connection handling:
1. Client connects → added to connections set (no repo mapping yet)
2. First NDJSON message MUST be `repo:init` → creates RepoConnection mapping
3. Subsequent messages parsed and dispatched to: in-memory state update, activity batch queue, log file append
4. On malformed message: log warning, skip (don't kill the connection)
5. On socket close: mark repo disconnected, clean up connection state

### Stale Socket Handling

Same pattern as broker — on startup, if `nexus.sock` exists but `nexus.pid` is stale (process not running), clean up both files before binding.

## Stats Migration

Today `stats.json` is owned by the broker (read on startup, updated after each job). With the Nexus:

1. **Phase 1 (Nexus ships)**: Nexus accumulates its own token stats from `job:completed` events. Broker continues writing `stats.json` in parallel. Both sources exist.
2. **Phase 2 (cutover)**: Nexus imports existing `stats.json` data on first startup if `nexus.db` has no token data yet (one-time migration). After that, Nexus is authoritative.
3. **Phase 3 (cleanup)**: Broker stops writing `stats.json`. MCP status tool reads from Nexus. `stats.json` deleted.

This phased approach means the stats migration doesn't block the Nexus from shipping, and there's no flag day where both systems need to change simultaneously.

### MCP Status Tool Changes

The `status` MCP tool currently queries the broker for `repoTokens`. After migration:
- Status tool queries the Nexus for token stats (new message type: `query:stats`, Nexus responds with per-repo totals)
- This is the ONE case where the Nexus sends a response — it's a simple request/response for the status tool only
- If Nexus is unreachable, status tool shows "tokens: unavailable" instead of failing

This means the Nexus protocol is almost-entirely fire-and-forget, with one exception: stats queries from the status tool. This is cleaner than having the MCP instance maintain its own token counter.

## Build

- Source: `src/nexus/main.ts`, `src/nexus/server.ts`, `src/nexus/client.ts`, `src/nexus/types.ts`, `src/nexus/store.ts`
- Compiled to: `dist/nexus/main.js` (+ supporting modules)
- Added to existing esbuild config alongside broker entry points
- Spawned by MCP client as detached daemon: `spawn(process.execPath, [nexusBin], { detached: true, stdio: 'ignore' }).unref()`
- Binary path resolved from `import.meta.url` in `dist/nexus/client.js`, same pattern as broker

### SQLite Dependency

The Nexus uses `better-sqlite3` (same as the per-repo DBs in repository.ts). This is already a project dependency — no new native modules needed.

## Future: Web Frontend

Not in scope for this milestone, but the Nexus is designed to support it:
- HTTP server can be added to the Nexus process later (or as yet another standalone service)
- SSE endpoint streams from the in-memory ring buffer
- REST endpoints query nexus.db for history, per-repo state
- For file-level detail (summaries, dependencies, file tree), the frontend opens each repo's `.filescope/data.db` read-only using `repo_path` from the repos table to locate the DB

## Future: Broker Tap

Also not in scope, but possible later:
- Nexus connects to broker socket as a client
- Sends `status` requests on an interval to get queue depth, current job, connected clients
- Exposes broker health alongside repo activity in the dashboard
- Eliminates need for MCP instances to relay any broker state

## Edge Cases & Gotchas

### Race: Nexus spawn vs first event
Multiple MCP instances starting simultaneously may all try to spawn the Nexus. The PID guard handles this — losers exit(0) cleanly. But the first `repo:init` event may arrive before the Nexus finishes binding the socket. The client's reconnect timer (10s) handles this — the event is dropped, and on reconnect, `repo:init` is re-sent.

### Race: Broker spawns before Nexus
The coordinator calls `brokerConnect()` then `nexusConnect()`. The broker may start processing and returning results before the Nexus connection is established. Early `job:completed` events are silently dropped. The `progress:update` on reconnect recovers the current state — individual early events are lost to history but the aggregate is correct.

### Repo path as identity
Repo paths are absolute filesystem paths. If a repo is accessed via symlink, the path may differ between instances. This is an existing limitation in the broker too — we don't solve it here. The Nexus uses whatever path the MCP instance reports.

### Nexus DB corruption
If `nexus.db` is corrupted (power loss, disk full), the Nexus should log the error and recreate the database from scratch. Historical data is lost but the service recovers. WAL mode + PRAGMA journal_mode minimizes corruption risk.

### High event volume
During `scan_all` on a large repo, hundreds of `job:submitted` events could fire in rapid succession. The `resubmitStaleFiles` bulk skip flag prevents this — only non-bulk submissions emit `job:submitted`. Completions come back one at a time (serial worker), so `job:completed` events are naturally rate-limited by Ollama's processing speed.

## Phase Breakdown (suggested)

1. **Nexus types & store** — types.ts, store.ts. Event type definitions (shared between client and server). SQLite schema, write batching, rotation logic. Can be unit tested independently.
2. **Nexus server** — main.ts, server.ts. PID guard, Unix socket, NDJSON parsing, connection tracking, event routing to store + log. Runnable standalone with test events.
3. **Nexus client** — client.ts module. Auto-spawn, connect, emit, reconnect, progress debounce. Mirror of broker client pattern.
4. **MCP integration** — Wire up event emission in coordinator.ts, broker/client.ts, mcp-server.ts. Build config updates.
5. **Stats migration** — Import existing stats.json, accumulate from events, add query:stats protocol, update status tool.
6. **End-to-end verification** — Start multiple MCP instances, verify events flow, tail the log, check nexus.db contents, test graceful degradation (Nexus down), test reconnect behavior.
