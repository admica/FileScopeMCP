# Architecture Research

**Domain:** Centralized observability service (Nexus) integrated with existing FileScopeMCP daemon ecosystem
**Researched:** 2026-03-24
**Confidence:** HIGH — based on direct reading of existing source code (broker/client.ts, coordinator.ts, broker/main.ts, broker/server.ts, broker/config.ts, broker/stats.ts, package.json) and the fully-designed NEXUS-PLAN.md

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Claude Code (AI Agent)                             │
│          (one Claude session per repo, spawns MCP as stdio child)         │
└───────────────────────────┬──────────────────────────────────────────────┘
                            │ stdio (JSON-RPC / MCP protocol)
┌───────────────────────────▼──────────────────────────────────────────────┐
│                   MCP Instance (per-repo process)                         │
│                       src/mcp-server.ts                                   │
│                                                                           │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐    │
│  │  coordinator.ts │   │ broker/client.ts │   │  nexus/client.ts    │    │
│  │  (lifecycle,    │   │  (LLM job sub-  │   │  (event emitter,    │    │
│  │   file watcher, │   │   mission, re-  │   │   fire-and-forget,  │    │
│  │   cascade)      │   │   connect)      │   │   reconnect)        │    │
│  └────────┬────────┘   └────────┬────────┘   └────────┬────────────┘    │
│           │                     │                      │                  │
│  .filescope/data.db    NDJSON over sock        NDJSON over sock          │
│  (per-repo SQLite)                                                        │
└───────────────────────────────────────────────────────────────────────────┘
           │                     │                       │
           │          ┌──────────▼────────┐   ┌─────────▼──────────────┐
           │          │    LLM Broker     │   │    Nexus Service        │
           │          │  ~/.filescope/    │   │  ~/.filescope/         │
           │          │  broker.sock      │   │  nexus.sock            │
           │          │  broker.pid       │   │  nexus.pid             │
           │          │  broker.log       │   │  nexus.log             │
           │          │  broker.json      │   │  nexus.db              │
           │          │                   │   │                        │
           │          │  PriorityQueue    │   │  Connection map        │
           │          │  BrokerWorker     │   │  Activity batch queue  │
           │          │  Ollama calls     │   │  Ring buffer           │
           │          └───────────────────┘   └────────────────────────┘
           │
     SQLite per repo
     .filescope/data.db
```

**Key structural fact:** The Nexus is a pure event sink — it mirrors the broker's lifecycle patterns (PID guard, Unix socket, auto-spawn, NDJSON, reconnect) but data flows in only one direction. The broker processes work. The Nexus observes work.

### Component Responsibilities

| Component | Responsibility | Lives In |
|-----------|---------------|----------|
| `coordinator.ts` | Init/shutdown lifecycle, file watcher, cascade, calls nexusConnect/nexusDisconnect | Per MCP instance |
| `broker/client.ts` | LLM job submission to broker, result handling, resubmit on reconnect | Per MCP instance |
| `nexus/client.ts` (NEW) | Fire-and-forget event emission to Nexus, auto-spawn, reconnect, progress debounce | Per MCP instance |
| `mcp-server.ts` | MCP tool handlers, timing wrappers for tool:called events | Per MCP instance |
| `nexus/main.ts` (NEW) | Nexus entry point: PID guard, signal handlers, startup | Nexus daemon |
| `nexus/server.ts` (NEW) | NexusServer class: socket accept, NDJSON parse, connection tracking, event routing | Nexus daemon |
| `nexus/store.ts` (NEW) | SQLite schema, write batching, log file append, rotation | Nexus daemon |
| `nexus/types.ts` (NEW) | NexusEvent union type, RepoConnection interface — shared by client and server | Shared |
| `broker/stats.ts` (MODIFIED) | Still writes stats.json during Phase 1 transition; removed after stats migration | Broker (transitional) |

---

## Recommended Project Structure

```
src/
├── nexus/                    # NEW — all Nexus code isolated here
│   ├── types.ts              # NexusEvent union, RepoConnection, NexusQuery types
│   ├── store.ts              # SQLite schema, write batching, log append, rotation
│   ├── server.ts             # NexusServer class — socket + connection management
│   ├── client.ts             # nexusConnect/nexusDisconnect/emit — MCP instance side
│   └── main.ts               # Entry point, PID guard, signal handlers
├── broker/                   # EXISTING — unchanged except stats.ts migration later
│   ├── client.ts             # MODIFIED: add nexus emit calls (job:submitted, job:completed, job:error)
│   ├── stats.ts              # MODIFIED (Phase 5): removed after Nexus owns token tracking
│   └── ...                   # queue, worker, server, config, types — no changes
├── coordinator.ts            # MODIFIED: add nexusConnect/nexusDisconnect/emit calls
├── mcp-server.ts             # MODIFIED: add timing wrappers for tool:called events
└── ...                       # all other files — no changes
```

### Structure Rationale

- **nexus/ is self-contained:** All new code lives in one directory. No imports flow from nexus/ into broker/ — broker/client.ts imports nexus/client.ts for emit, not the reverse. coordinator.ts imports from both.
- **types.ts first:** Shared between client.ts and server.ts. Must not import from either — it is the protocol definition layer.
- **store.ts separate from server.ts:** SQLite logic is testable in isolation. server.ts composes store.ts. Mirrors broker's separation of queue.ts from server.ts.

---

## Architectural Patterns

### Pattern 1: Module-Level Socket State (Fire-and-Forget Client)

**What:** The client module holds module-level socket state (not class-level). Public functions operate against that state. This makes imports side-effect-free at import time but stateful once `nexusConnect()` is called.

**When to use:** When multiple call sites across a module tree need to emit to the same service without passing a handle everywhere.

**Trade-offs:** Simple call sites (`emit(event)` anywhere), but no per-instance isolation. Appropriate here — one Nexus connection per process.

**Example (mirrors broker/client.ts exactly):**
```typescript
// src/nexus/client.ts
let socket: net.Socket | null = null;
let reconnectTimer: ReturnType<typeof setInterval> | null = null;
let repoPath: string = '';
let _intentionalDisconnect = false;

export function isNexusConnected(): boolean {
  return socket !== null && !socket.destroyed;
}

export async function nexusConnect(repo: string): Promise<void> {
  repoPath = repo;
  _intentionalDisconnect = false;
  await spawnNexusIfNeeded();
  await attemptConnect();
}

export function emit(event: NexusEvent): void {
  if (!isNexusConnected()) return;  // silent no-op — never throws
  try {
    socket!.write(JSON.stringify(event) + '\n');
  } catch { /* socket error — ignore */ }
}
```

### Pattern 2: PID Guard + Stale Socket Cleanup

**What:** On daemon startup: check PID file, signal(0) to test liveness, clean up stale files, write new PID. Same logic in both broker/main.ts and the new nexus/main.ts.

**When to use:** Every standalone daemon that uses a socket file for IPC.

**Trade-offs:** Minor TOCTOU window between checking and writing — acceptable for local daemons where the window is microseconds and the consequence is a second process that exits(0).

**Example (mirrors broker/main.ts exactly):**
```typescript
// src/nexus/main.ts — PID guard (same structure as broker/main.ts)
function checkPidGuard(): void {
  if (fs.existsSync(PID_PATH)) {
    const pid = parseInt(fs.readFileSync(PID_PATH, 'utf-8').trim(), 10);
    if (!isNaN(pid) && isPidRunning(pid)) {
      log(`Nexus already running (PID ${pid})`);
      process.exit(0);  // race loser exits cleanly
    }
    fs.rmSync(SOCK_PATH, { force: true });
    fs.rmSync(PID_PATH, { force: true });
  } else if (fs.existsSync(SOCK_PATH)) {
    fs.rmSync(SOCK_PATH, { force: true });
  }
}
```

### Pattern 3: Write Batching for High-Volume Inserts

**What:** Activity events accumulate in an in-memory array and flush to SQLite either every 500ms or every 50 events (whichever comes first). Immediate state (repos table, in-memory ring buffer) updates synchronously. Only the append-only log is batched.

**When to use:** When individual writes are cheap but the sheer count would cause I/O thrashing. SQLite WAL handles concurrent reads but batching reduces write amplification.

**Trade-offs:** Up to 500ms of lost events on hard crash. Acceptable — the Nexus is observability infrastructure, not the authoritative record.

**Example:**
```typescript
// src/nexus/store.ts
private activityBatch: ActivityRow[] = [];
private flushTimer: NodeJS.Timeout | null = null;

enqueue(row: ActivityRow): void {
  this.activityBatch.push(row);
  if (this.activityBatch.length >= 50) {
    this.flush();
  } else if (!this.flushTimer) {
    this.flushTimer = setTimeout(() => this.flush(), 500).unref();
  }
}

private flush(): void {
  if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
  if (this.activityBatch.length === 0) return;
  const rows = this.activityBatch.splice(0);
  this.insertActivityBatch(rows);  // single SQLite transaction
}
```

### Pattern 4: First-Message Identity Protocol

**What:** Unlike the broker (which has no per-client identity), the Nexus requires `repo:init` as the first NDJSON message on any new connection. Until that message arrives, events from an unidentified socket are dropped with a warning. This lets the server maintain a `Map<Socket, RepoConnection>` for cleanup on disconnect.

**When to use:** When server needs to associate a persistent connection with a logical entity (here: a repo) without a prior handshake mechanism.

**Trade-offs:** Client must always send `repo:init` first, even on reconnect. Slight complexity in client state machine — worth it for clean server-side tracking.

---

## Data Flow

### Event Emission Flow (Happy Path)

```
coordinator.init() completes
    │
    ├── nexusConnect(repoPath)
    │       │
    │       ├── spawnNexusIfNeeded()   [if nexus.sock missing]
    │       │       └── spawn('node', [nexusBin], { detached: true }).unref()
    │       │
    │       └── attemptConnect()
    │               └── net.createConnection(NEXUS_SOCK_PATH)
    │                       └── on 'connect': send repo:init as first message
    │
    └── emit({ type: 'repo:init', repoPath, repoName, totalFiles, ... })
            └── socket.write(JSON.stringify(event) + '\n')
                    └── Nexus server receives line
                            ├── parse NDJSON
                            ├── identify socket → RepoConnection
                            ├── update repos table immediately
                            ├── update in-memory ring buffer
                            ├── append to log file (batched)
                            └── enqueue into activity batch
```

### LLM Job Event Flow

```
broker/client.ts::submitJob()
    │
    ├── socket.write(submitMsg)                              [to broker]
    └── emit({ type: 'job:submitted', ... })                 [to nexus, skip during resubmitStaleFiles bulk]

broker/client.ts::handleBrokerMessage() result path
    │
    ├── writeLlmResult(...)                                  [to per-repo SQLite]
    ├── clearStaleness(...)                                  [to per-repo SQLite]
    ├── emit({ type: 'job:completed', totalTokens, durationMs })   [to nexus]
    └── incrementCompletionCounter()                         [nexus client-side debounce]
            └── if counter % 10 == 0 OR 60s elapsed:
                    emit({ type: 'progress:update', ... })

broker/client.ts::handleBrokerMessage() error path
    └── emit({ type: 'job:error', errorCode, errorMessage })
```

### Stats Query Flow (Phase 5 — bidirectional exception)

```
mcp-server.ts::status tool handler
    │
    └── coordinator.getBrokerStatus()
            └── nexusRequestStats()              [new: query nexus, not broker]
                    │
                    ├── socket.write({ type: 'query:stats', id })
                    └── await response (2s timeout)
                            │
                            Nexus reads repos.total_tokens from nexus.db
                            └── socket.write({ type: 'stats_response', id, repoTokens })
```

This is the **single exception** to the fire-and-forget model. The Nexus is otherwise a pure sink.

### Stats Migration Flow (Phase 5)

```
Nexus startup (first run, nexus.db has no token rows):
    └── if stats.json exists AND repos.total_tokens all zero:
            read stats.json
            UPDATE repos SET total_tokens = imported_value WHERE repo_path = key
            log "Migrated token stats from stats.json"

Phase 5 cutover:
    Broker stops writing stats.json (remove accumulateTokens calls from server.ts)
    Status tool reads from Nexus via query:stats
    broker/stats.ts removed
    stats.json file deleted
```

### Shutdown Flow

```
coordinator.shutdown()
    │
    ├── [clear debounce timers]
    ├── [stop file watcher]
    ├── [drain treeMutex]
    │
    ├── emit({ type: 'repo:disconnect', repoPath, repoName })
    ├── nexusDisconnect()          [intentional close, clears reconnect timer]
    │
    ├── brokerDisconnect()
    └── closeDatabase()
```

Order matters: emit `repo:disconnect` before closing socket, so Nexus logs the clean disconnect.

---

## Integration Points: New vs Modified

### New Files (no prior code to conflict with)

| File | What It Does | Key Exports |
|------|-------------|-------------|
| `src/nexus/types.ts` | Event union type, RepoConnection, path constants | `NexusEvent`, `RepoConnection`, `NEXUS_SOCK_PATH`, `NEXUS_PID_PATH`, `NEXUS_LOG_PATH`, `NEXUS_DB_PATH` |
| `src/nexus/store.ts` | SQLite schema init, activity batching, log append, log rotation | `NexusStore` class |
| `src/nexus/server.ts` | Unix socket server, connection tracking, event dispatch | `NexusServer` class |
| `src/nexus/client.ts` | Module-level socket state, emit, auto-spawn, reconnect, progress debounce | `nexusConnect`, `nexusDisconnect`, `emit`, `isNexusConnected`, `nexusRequestStats` |
| `src/nexus/main.ts` | Entry point, PID guard, signal handlers | (executable, no exports) |

### Modified Files (surgical additions only)

| File | What Changes | Risk |
|------|-------------|------|
| `src/coordinator.ts` | Add `nexusConnect` call after `brokerConnect` in `init()`. Add `nexusDisconnect` + `repo:disconnect` emit in `shutdown()`. Add `files:changed` emit in `handleFileEvent()` after cascade. | LOW — additive only, no existing logic touched |
| `src/broker/client.ts` | Add `emit()` calls at 3 spots: after `socket.write()` in `submitJob()` (with bulk-skip flag), in `handleBrokerMessage()` result path, in `handleBrokerMessage()` error path. Add `_bulkResubmit` flag to suppress `job:submitted` during `resubmitStaleFiles`. | LOW — additive only |
| `src/mcp-server.ts` | Wrap tool handler execution in `Date.now()` timing, call `emit({ type: 'tool:called', ... })` after each handler returns. | LOW — wrapper pattern, no handler logic changes |
| `src/broker/stats.ts` | Phase 5 only: remove `accumulateTokens` calls from `broker/server.ts`, then delete file when Nexus is authoritative. | MEDIUM — coordinate with stats migration |
| `package.json` | Add `src/nexus/main.ts` and nexus sub-modules to the esbuild command. | LOW |

### Internal Module Boundaries

| Boundary | Communication | Constraint |
|----------|---------------|-----------|
| `nexus/client.ts` ↔ `nexus/server.ts` | Unix domain socket, NDJSON | No direct import between them — protocol only |
| `nexus/client.ts` ↔ `broker/client.ts` | None (broker/client.ts imports nexus/client.ts emit only) | These two must NOT have circular imports. broker/client.ts → nexus/client.ts → nexus/types.ts is the allowed direction. |
| `nexus/server.ts` → `nexus/store.ts` | Direct method calls | store.ts has no knowledge of server.ts |
| `coordinator.ts` → `nexus/client.ts` | Direct import | coordinator owns the nexus connection lifecycle |
| `broker/client.ts` → `nexus/client.ts` | Direct import (emit only) | broker/client.ts calls emit for job events but does not call nexusConnect/Disconnect |
| `mcp-server.ts` → `nexus/client.ts` | Direct import (emit only) | mcp-server calls emit for tool:called events only |

**Critical constraint:** `broker/client.ts` imports from `nexus/client.ts` for `emit()` only. It does NOT control the nexus connection lifecycle. The coordinator owns that via `nexusConnect` / `nexusDisconnect`.

---

## SQLite Schema (nexus.db)

```sql
-- Repos registry: one row per repo ever seen, upserted on each repo:init
CREATE TABLE IF NOT EXISTS repos (
  repo_path       TEXT PRIMARY KEY,
  repo_name       TEXT NOT NULL,
  first_seen      INTEGER NOT NULL,
  last_seen       INTEGER NOT NULL,
  total_files     INTEGER,
  total_tokens    INTEGER DEFAULT 0,
  last_progress   TEXT                   -- JSON: most recent progress:update payload
);

-- Append-only event log: batched writes, pruned at 30 days
CREATE TABLE IF NOT EXISTS activity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   INTEGER NOT NULL,
  event_type  TEXT NOT NULL,
  repo_path   TEXT NOT NULL,
  file_path   TEXT,                      -- null for repo-level events
  job_type    TEXT,                      -- null for non-job events
  tokens      INTEGER,                   -- null for non-completion events
  duration_ms INTEGER,                   -- null for non-completion events
  error_code  TEXT,                      -- null for non-error events
  detail      TEXT,                      -- JSON blob for event-specific extras
  FOREIGN KEY (repo_path) REFERENCES repos(repo_path)
);

CREATE INDEX IF NOT EXISTS idx_activity_repo ON activity(repo_path, timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_type ON activity(event_type, timestamp);
CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(timestamp);
```

**Write pattern:** `repos` table and in-memory state update immediately on event receipt. `activity` inserts accumulate in a batch array, flushed every 500ms or 50 events. The flush uses a single SQLite transaction for all accumulated rows.

**Pruning:** On Nexus startup and daily at midnight via `setTimeout`, delete rows from `activity` where `timestamp < Date.now() - 30 * 24 * 60 * 60 * 1000`.

---

## Build Configuration Change

The existing esbuild command in `package.json` lists every source file explicitly. Add nexus files alongside the existing broker entries:

```
# Existing broker entries in build command:
src/broker/types.ts src/broker/config.ts src/broker/queue.ts
src/broker/worker.ts src/broker/server.ts src/broker/stats.ts
src/broker/client.ts src/broker/main.ts

# Add nexus entries (same pattern):
src/nexus/types.ts src/nexus/store.ts src/nexus/server.ts
src/nexus/client.ts src/nexus/main.ts
```

The Nexus binary path in `nexus/client.ts` resolves identically to how `broker/client.ts` resolves the broker binary:
```typescript
const distNexusDir = path.dirname(fileURLToPath(import.meta.url));
const nexusBin = path.resolve(distNexusDir, 'main.js');
// At runtime: dist/nexus/main.js — esbuild mirrors src/ structure into dist/
```

---

## Suggested Build Order (Phase Dependencies)

### Phase 1: nexus/types.ts + nexus/store.ts

**Dependencies:** none (better-sqlite3 already a project dependency)
**Output:** Testable in isolation — unit tests can instantiate NexusStore, write events, verify DB state and log output
**Why first:** types.ts is the protocol contract that all subsequent phases depend on. store.ts tests the SQLite schema and batching logic without needing a running server.

### Phase 2: nexus/server.ts + nexus/main.ts

**Dependencies:** Phase 1 complete (types.ts, store.ts)
**Output:** Runnable Nexus daemon — accepts connections, parses NDJSON, routes to store and log
**Test approach:** Spawn Nexus process, connect a raw net.Socket, send hand-crafted NDJSON events, verify nexus.db and nexus.log contents

### Phase 3: nexus/client.ts

**Dependencies:** Phase 1 (types.ts), Phase 2 (server runnable for integration tests)
**Output:** Client module with emit, auto-spawn, reconnect, progress debounce
**Test approach:** Integration test — start Nexus server, call nexusConnect(), emit events, verify they arrive. Test graceful degradation: kill Nexus mid-test, emit events, verify silent no-ops, restart Nexus, verify reconnect and repo:init re-sent.

### Phase 4: MCP integration (coordinator.ts + broker/client.ts + mcp-server.ts)

**Dependencies:** Phase 3 (client.ts API finalized)
**Output:** Events flowing from real MCP usage
**Changes are additive and surgical** — each file gets minimal additions, no existing logic modified
**Order within Phase 4:** coordinator.ts first (lifecycle hooks), then broker/client.ts (job events), then mcp-server.ts (tool timing)

### Phase 5: Stats migration

**Dependencies:** Phase 4 live and verified (Nexus receiving job:completed events with tokens)
**Steps:**
1. On Nexus startup: one-time import of stats.json into repos.total_tokens
2. Add query:stats request/response to Nexus protocol (the bidirectional exception)
3. Update coordinator.getBrokerStatus() to query Nexus for tokens instead of reading stats.json
4. Remove accumulateTokens calls from broker/server.ts
5. Remove stats.json read from coordinator.ts
6. Delete src/broker/stats.ts

### Phase 6: End-to-end verification

**Dependencies:** All phases complete
**Activities:** Start 2+ MCP instances (different repos), tail nexus.log, verify event ordering, kill Nexus mid-operation and verify zero impact on MCP functionality, restart Nexus and verify reconnect + state recovery via progress:update

---

## Anti-Patterns

### Anti-Pattern 1: Nexus in the Critical Path

**What people do:** Make broker/client.ts or coordinator.ts `await` the nexus emit call, or buffer/retry events when Nexus is down.

**Why it's wrong:** The entire design contract is that Nexus failure is invisible to core functionality. Any await or retry loop makes Nexus failures propagate into LLM job latency or startup delay.

**Do this instead:** `emit()` is synchronous and returns void. If `!isNexusConnected()`, it returns immediately. No async, no buffer, no retry. Lost events during disconnect are acceptable — the `progress:update` on reconnect provides state recovery.

### Anti-Pattern 2: Circular Import Between nexus/ and broker/

**What people do:** Import broker state or types from nexus/client.ts while broker/client.ts imports nexus/client.ts.

**Why it's wrong:** Creates a circular dependency that Node.js ESM may partially resolve at runtime, producing undefined imports at the point of use.

**Do this instead:** nexus/client.ts imports nothing from broker/. broker/client.ts imports only the `emit` function from nexus/client.ts. The dependency graph is one direction: `broker/client.ts → nexus/client.ts → nexus/types.ts`.

### Anti-Pattern 3: Per-Line Log File Writes

**What people do:** Call `fs.appendFileSync()` for every event as it arrives.

**Why it's wrong:** During scan_all on a large repo, hundreds of job:completed events arrive in bursts. Per-line sync writes in the hot path cause measurable I/O pressure on the Nexus process.

**Do this instead:** Batch log writes alongside the activity batch. The log file append is grouped into the same 500ms / 50-event flush cycle. Log rotation check (at 10MB) happens at flush time, not per-line.

### Anti-Pattern 4: Tracking Connection Identity by Socket Address

**What people do:** Use `socket.remoteAddress` as the repo key in a `Map<string, RepoConnection>`.

**Why it's wrong:** Unix domain sockets do not have a meaningful remote address. Multiple sockets from the same process (reconnect) or same repo (two Claude sessions) would collide if keyed by address.

**Do this instead:** `Map<net.Socket, RepoConnection>` — keyed by the socket object reference. Socket reference is unique per connection. `repoPath` is stored inside RepoConnection for lookup when needed. Multiple sockets may share the same repoPath — that is fine and expected.

### Anti-Pattern 5: Blocking Nexus Startup on Broker Availability

**What people do:** Have nexus/main.ts check whether the broker is running or wait for it before binding.

**Why it's wrong:** The Nexus and broker are independent services. Coupling startup sequences creates a hidden dependency that can cascade into startup deadlock if both services are starting simultaneously.

**Do this instead:** Nexus starts, binds socket, begins accepting connections. Broker status is irrelevant to Nexus startup. A future "Broker Tap" feature would connect lazily after startup, not as a startup gate.

---

## Scaling Considerations

This system runs locally on a single developer machine. "Scale" means multiple repos open simultaneously, not user count. The serial Ollama worker in the broker is the natural rate limiter for job:completed events.

| Concern | At 5 repos | At 20 repos | Notes |
|---------|------------|-------------|-------|
| Event throughput | Trivial | Light — serial Ollama limits job:completed rate | Ollama processes one job at a time; completions cannot flood the Nexus |
| nexus.db write volume | ~1500 rows/day | ~6000 rows/day | SQLite handles millions of rows; no concern |
| In-memory ring buffer | 1000 events — negligible | 1000 events — still negligible | Ring buffer is capped by count, not repo count |
| Log file size | ~1MB/day at heavy use | ~4MB/day | 10MB rotation keeps it bounded; 3 generations = 30MB max |
| SQLite activity table | 30-day retention auto-prune | Same | Even at 20 repos scanning daily, stays well under 200k rows |

---

## Sources

- `/home/autopcap/FileScopeMCP/NEXUS-PLAN.md` — authoritative design document, written by project owner (HIGH confidence)
- `/home/autopcap/FileScopeMCP/src/broker/client.ts` — reference implementation for client module pattern (HIGH)
- `/home/autopcap/FileScopeMCP/src/broker/main.ts` — reference implementation for PID guard + signal handling (HIGH)
- `/home/autopcap/FileScopeMCP/src/broker/server.ts` — reference implementation for server class structure (HIGH)
- `/home/autopcap/FileScopeMCP/src/coordinator.ts` — integration point analysis for coordinator lifecycle hooks (HIGH)
- `/home/autopcap/FileScopeMCP/src/broker/stats.ts` — stats migration source of truth (HIGH)
- `/home/autopcap/FileScopeMCP/package.json` — esbuild command structure for build config additions (HIGH)

---

*Architecture research for: FileScopeMCP v1.3 Nexus observability service integration*
*Researched: 2026-03-24*
