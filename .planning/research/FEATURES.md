# Feature Research

**Domain:** Centralized observability service for local multi-process LLM tooling — FileScopeMCP v1.3 Nexus
**Researched:** 2026-03-24
**Confidence:** HIGH (NEXUS-PLAN.md fully designed, broker pattern already proven in v1.2, Node.js net docs + observability literature)

---

## Context

This is a SUBSEQUENT MILESTONE research document. FileScopeMCP v1.0–v1.2 already ships:
- Per-repo MCP servers with 11 tools for querying file metadata
- Standalone LLM broker (Unix socket, in-memory priority queue, Ollama integration)
- Per-repo SQLite databases with file summaries, dependencies, concepts
- File watcher with cascade staleness propagation
- Stats persistence in `~/.filescope/stats.json`

v1.3 adds the **Nexus** — a centralized observability daemon that collects events from all running MCP
instances, persists activity history, and provides human-readable live monitoring via a log file.

The question is: **what features are table stakes for this kind of local observability sink, what are
differentiators, and what should be deferred or rejected?**

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features any credible observability service must have. Missing these makes the system untrustworthy or
unusable as a monitoring tool.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Daemon process with PID guard | Any singleton background service needs a single-instance guard; same contract as the broker; without it, two Nexus processes conflict and produce duplicate log entries | LOW | Write PID on bind, check on startup: if PID alive → exit; if PID dead → clean up and continue. Identical to broker pattern in `src/broker/main.ts`. |
| Unix domain socket at well-known path | Sink must have a stable address; UDS avoids port conflicts and provides filesystem-level access control; every MCP instance finds the same path (`~/.filescope/nexus.sock`) | LOW | `net.createServer()` + `server.listen(NEXUS_SOCK_PATH)`. Mirror of broker's `server.ts`. |
| NDJSON message framing | Socket is a byte stream; JSON objects must be delimited; NDJSON is the established local IPC convention (Language Server Protocol, broker, etc.); `readline.createInterface` handles partial reads correctly | LOW | One line per event, `\n` delimited. `readline.createInterface({ input: socket })` on each connection. Never `JSON.parse()` raw `data` events — partial reads are guaranteed on payloads >~4KB. |
| Connection identity: first message is `repo:init` | Without identity, the Nexus cannot associate subsequent events with a repo; fire-and-forget events have no header — the first message must establish the mapping | LOW | `Map<net.Socket, RepoConnection>`. On first message: validate `type === 'repo:init'`, populate the map. Reject (log + skip) any pre-init events. |
| Event routing to in-memory state and disk | Every received event must update the live in-memory view AND be persisted to SQLite (activity log) AND appended to the human-readable log file; without all three, the Nexus is incomplete | MEDIUM | Three parallel write paths per event: (1) update in-memory `Map<Socket, RepoConnection>` + ring buffer, (2) push to write batch queue, (3) `fs.appendFile` to log. Only SQLite write is batched; log file and memory update are immediate. |
| Append-only log file at `~/.filescope/nexus.log` | The primary human interface is `tail -f ~/.filescope/nexus.log`; this is the single most-cited reason for the Nexus in NEXUS-PLAN.md; without it, there is no live monitoring story | LOW | Fixed-width columns, local time HH:MM:SS, event type, repo name (truncated to 20 chars), file path (truncated to 40 chars), then event-specific fields. One line per event. Append via `fs.appendFileSync` or a write stream. |
| SQLite persistence with WAL mode | Activity history must survive Nexus restarts; raw log files are not queryable; SQLite is already a project dependency (`better-sqlite3`) | MEDIUM | `nexus.db` with `repos` + `activity` tables (schema defined in NEXUS-PLAN.md). WAL mode for concurrent read/write. Indexes on `(repo_path, timestamp)`, `(event_type, timestamp)`, `(timestamp)`. |
| Write batching for SQLite activity inserts | During heavy scan activity, the Nexus can receive hundreds of events per second; individual SQLite inserts without transactions are 50x slower than batched transactions | LOW | Accumulate events in memory buffer; flush every 500ms or every 50 events (whichever comes first) in a single `better-sqlite3` transaction. The `repos` table and in-memory state update immediately — only `activity` inserts are batched. |
| Graceful shutdown on SIGTERM/SIGINT | Must close all client connections cleanly, flush the write batch queue, close the SQLite database, and remove the socket + PID files; without this, the Nexus leaves stale artifacts that block the next startup | LOW | SIGTERM handler: flush pending batch, call `socket.destroy()` on all active connections, `server.close()`, unlink `nexus.sock` + `nexus.pid`, `db.close()`, `process.exit(0)`. Same shutdown discipline as broker. |
| Stale socket/PID cleanup on startup | If the Nexus crashes, the socket file remains; `EADDRINUSE` on bind prevents restart; probe the socket first — if `ECONNREFUSED`, it is stale and can be unlinked | LOW | On startup: if `nexus.sock` exists, attempt `net.connect()`; if `ECONNREFUSED` → unlink socket + PID and continue; if connection succeeds → another Nexus is running, exit(1). Identical to broker startup pattern. |
| Graceful degradation in MCP clients | If the Nexus is down, all 11 MCP tools must work exactly as today — zero user-visible impact; events from disconnected clients are silently dropped | LOW | `emit()` function in `nexus/client.ts` is a no-op when `socket === null || socket.destroyed`. No retries, no buffering, no error propagation. Same fire-and-forget contract as broker job submission. |
| Auto-spawn from MCP client | First MCP instance must spawn the Nexus daemon if `nexus.sock` doesn't exist; subsequent instances find it already running; mirrors broker auto-spawn pattern | LOW | `spawn(process.execPath, [nexusBin], { detached: true, stdio: 'ignore' }).unref()`. Binary path resolved from `import.meta.url`. Identical pattern to broker client's `spawnBrokerIfNeeded()`. |
| Reconnect timer in MCP client | If Nexus restarts mid-session, MCP clients must reconnect and resend `repo:init` without user action; without this, instances lose observability silently after any Nexus restart | LOW | 10s interval reconnect timer, `timer.unref()` so it doesn't block process exit. On reconnect: send `repo:init` then `progress:update`. |

### Differentiators (Features That Make It Genuinely Useful)

Features that transform the Nexus from "event drain" into a useful monitoring tool.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| In-memory ring buffer (last ~1000 events) | Provides live "recent activity" view without a DB query; used by future web frontend via SSE; enables fast status queries without disk I/O | LOW | Fixed-size array with head/tail pointers. Events stored post-parse (slim, no large payloads already stripped at the event source). 1000 events at ~200 bytes each = ~200KB max memory — negligible. |
| Cross-repo aggregate stats (live counters) | Total jobs completed today, total tokens today, jobs/minute rate (1-min sliding window) — gives a system-wide health snapshot; the broker's `stats.json` is per-repo only, not cross-repo | LOW | Increment counters on each `job:completed` event. Rolling 1-minute window: ring buffer of timestamps, count those within `now - 60s`. No persistence needed — these reset on Nexus restart and rebuild from event stream. |
| `repos` table: registry of all repos ever seen | Provides historical knowledge of which repos have been processed, when last active, total files, total tokens — persists across restarts; the broker loses all this on restart | LOW | `INSERT OR REPLACE` on `repo:init`. Update `last_seen` on `repo:disconnect`. Accumulate `total_tokens` from `job:completed` events. This becomes the authoritative source for stats, replacing `stats.json`. |
| `last_progress` JSON snapshot in repos table | Stores the most recent `progress:update` per repo as a JSON blob; allows instant "current processing state" lookup without scanning the activity log | LOW | On `progress:update`: `UPDATE repos SET last_progress = ? WHERE repo_path = ?`. Single-row lookup on query. |
| Log rotation at 10MB, keep 3 files | Without rotation, `nexus.log` grows unboundedly over weeks of use; 10MB is the industry standard threshold for log rotation; 3 files cap total disk at ~30MB | LOW | Check file size on each write batch flush (not per-line). When size > 10MB: rename `nexus.log` → `nexus.log.1`, `nexus.log.1` → `nexus.log.2`, delete `nexus.log.2` if exists, open new `nexus.log`. Use `fs.renameSync`. No npm dependency needed — 15 lines of TypeScript. |
| Activity log pruning (30-day retention) | Without pruning, the `activity` table grows indefinitely; 30 days is the industry standard retention for activity logs; at worst-case load (~15k rows/day across 10 repos), 30 days = ~450k rows — still fast | LOW | On Nexus startup: `DELETE FROM activity WHERE timestamp < (now - 30 * 24 * 60 * 60 * 1000)`. Then schedule daily at midnight via `setTimeout`. No background worker needed. |
| Fixed-width column log format | The `tail -f` interface is only useful if lines are scannable; fixed-width columns let users immediately spot event type, repo name, file path, and result without parsing each line | LOW | Format: `[HH:MM:SS] {eventType,-16} {repoName,-20} {filePath,-40} {extraFields}`. Truncate with `...` if over limit. Local time is more useful than UTC for interactive monitoring (confirmed by logging best practice literature). |
| Progress debounce in MCP client | Without debouncing, a repo scanning 500 files would emit 500 `progress:update` events (one per completion); debounced to every 10th completion or every 60s avoids spamming the Nexus while keeping progress visible | LOW | Completion counter in `nexus/client.ts`. Emit `progress:update` when `completionCount % 10 === 0` OR when `Date.now() - lastProgressAt > 60_000`. Also emit when `pendingSummary + pendingConcepts === 0` (work complete). |
| `query:stats` request/response protocol | The `status` MCP tool needs per-repo token totals from the Nexus; this is the single case where the Nexus sends a response; without it, the Nexus cannot replace `stats.json` as the authoritative stats source | LOW | One exception to fire-and-forget: client sends `{ type: 'query:stats', requestId, repoPath }`, Nexus responds with `{ type: 'stats_response', requestId, totalTokens }`. 5s timeout on client side — if no response, return "unavailable". |
| Stats migration: `stats.json` → Nexus | Preserves lifetime token history built up over previous v1.2 sessions; without migration, users lose their historical token totals when upgrading to v1.3 | LOW | On first Nexus startup, if `nexus.db` has no token data AND `stats.json` exists: import each `repoPath → tokens` entry as an `UPDATE repos SET total_tokens = ?`. Use a migration completion marker in the `repos` table (or a separate `migrations` table) to prevent reruns — **never gate on DB file existence alone** (known bug: DB can exist from prior schema migrations with no JSON data imported). |
| Multiple instances for same repo | Claude crashing and restarting, or opening the same repo in two terminals, is normal; the Nexus must not fail on duplicate `repo:init` for the same `repoPath` | LOW | `repos` table uses `INSERT OR REPLACE` — last writer wins for `total_files`, `last_seen`. `Map<Socket, RepoConnection>` (not `Map<repoPath, Socket>`) allows multiple sockets per repo path. Connected-repo count is by unique `repoPath`, not socket count. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| HTTP/REST API on the Nexus | "Easier to debug, curl-able, works with existing HTTP tooling" | Adds TCP port management, port conflict risk, header parsing, and content-length framing to what is a local-only daemon; UDS is strictly better for local IPC (lower latency, filesystem-level access control, no port) | Unix socket only; when the web frontend is built (future milestone), it can be a separate HTTP server process that reads `nexus.db` directly — or the Nexus adds an HTTP listener at that point |
| Event replay / buffering for offline MCP clients | "Don't lose events when Nexus is restarting" | Requires the MCP client to buffer events in memory or on disk while disconnected, adding state management complexity and memory pressure; the Nexus reconnect design already handles this: `repo:init` + `progress:update` on reconnect gives the Nexus current state without replaying every lost event | On reconnect: resend `repo:init` + `progress:update` (current state snapshot); individual events lost during the gap are not stored — the aggregate is recovered correctly |
| Per-event acknowledgment (request/response for every event) | "Ensures events are never lost" | Turns fire-and-forget into request/response for every event; adds round-trip latency to every MCP tool call and job completion; the Nexus is a monitoring aid, not a critical data store — losing a few events during restart is acceptable; the `progress:update` snapshot recovers aggregate state | Single exception for `query:stats` only; all other events remain fire-and-forget |
| Event schema validation / rejection on Nexus side | "Reject malformed events to catch bugs" | If the Nexus rejects a client event, the MCP instance must handle the rejection — but the Nexus is supposed to be invisible; rejections break the fire-and-forget contract and add error handling to 11 tool handlers | On malformed message: log a warning to `nexus.log` (for debugging), skip the event, continue — never close the connection, never respond with an error |
| Broker status tap (Nexus polls broker socket) | "Expose broker queue depth and active job in Nexus" | Adds a second socket connection from the Nexus to the broker; the broker protocol doesn't expect a passive observer; adds broker coupling to the Nexus, violating the "Nexus is independent" design principle | MCP instances already relay broker state to the Nexus via `job:submitted` / `job:completed` / `job:error` events — broker queue depth is derivable from the delta; if needed, add in a future milestone after the Nexus is stable |
| SSE or WebSocket server for real-time streaming | "Stream events to a browser dashboard in real time" | SSE/WebSocket adds a runtime HTTP server, connection lifecycle management, backpressure handling, and CORS configuration to a daemon that currently has zero external-facing ports; the future web frontend milestone is explicitly scoped separately | Design the in-memory ring buffer now so that a future SSE endpoint can read from it; do not implement the HTTP layer in v1.3 |
| Compression of log files on rotation | "Save disk space on rotated files" | `gzip` compression in Node.js requires streaming through `zlib`, async rename/compress pipeline, and compressed file readers for any tooling that wants to read old logs; the 10MB * 3 = 30MB cap is negligible on any modern disk | Size cap + file count limit; no compression; plain text files remain readable with standard tools |
| Formal protocol versioning on Nexus socket | "Guard against version skew between Nexus and MCP instances" | All processes update together in this project; no independent deployment; if there is a mismatch the symptom is an immediately-visible `unknown event type` log warning — easy to diagnose without a version handshake | Log unknown `type` values as warnings; the Nexus skips them gracefully; add version handshake when multi-user or packaged release scenarios emerge |

---

## Feature Dependencies

```
[Nexus daemon process]
    └──requires──> [PID guard]
    └──requires──> [Stale socket cleanup on startup]
    └──requires──> [Unix socket server + NDJSON framing]

[Unix socket server + NDJSON framing]
    └──requires──> [Connection identity model (first message = repo:init)]

[Connection identity model]
    └──requires──> [Map<Socket, RepoConnection>]
    └──enables──>  [Event routing to in-memory state / SQLite / log file]

[Event routing to SQLite]
    └──requires──> [SQLite store (repos + activity tables)]
    └──requires──> [Write batching (500ms / 50 events)]
    └──requires──> [Activity pruning (30-day retention)]

[Event routing to log file]
    └──requires──> [Fixed-width column formatter]
    └──requires──> [Log rotation (10MB / 3 files)]

[In-memory ring buffer]
    └──requires──> [Connection identity model]
    └──enhances──> [Cross-repo aggregate stats]
    └──enables──>  [Future SSE streaming endpoint]

[query:stats protocol]
    └──requires──> [repos table (total_tokens column)]
    └──requires──> [Nexus server sends one response type]
    └──enables──>  [Stats migration from stats.json]
    └──enables──>  [MCP status tool reads from Nexus instead of broker]

[Stats migration (stats.json → nexus.db)]
    └──requires──> [repos table exists and is writable]
    └──requires──> [Migration completion marker (prevents reruns)]
    └──conflicts──> [Gate on DB file existence alone] (known bug: DB can exist with no data)

[Nexus client module (src/nexus/client.ts)]
    └──requires──> [Nexus server running and accepting connections]
    └──requires──> [Auto-spawn logic (same pattern as broker client)]
    └──requires──> [Reconnect timer (10s, unref'd)]
    └──requires──> [Progress debounce (every 10th completion or 60s)]
    └──conflicts──> [Import from broker modules] (independence rule — coordinator is the only
                    module that calls both; nexus/client.ts and broker/client.ts are siblings)

[MCP integration (coordinator.ts, broker/client.ts, mcp-server.ts)]
    └──requires──> [Nexus client module complete]
    └──requires──> [event types defined in nexus/types.ts]
    └──enhances──> [All 11 MCP tools emit tool:called events]

[Graceful degradation]
    └──requires──> [emit() is no-op when socket === null]
    └──conflicts──> [Per-event acknowledgment] (breaks fire-and-forget contract)
```

### Dependency Notes

- **Nexus server before client:** The server must exist and be testable standalone before client integration makes sense. Build and validate server (types + store + server) first, then client, then MCP wiring.
- **query:stats is the one exception to fire-and-forget:** All other events are one-way. The stats query uses a `requestId` for correlation (same `Map<requestId, resolve>` pattern as broker client's in-flight map). The client sends it, waits max 5s, then returns "unavailable" if no response.
- **Stats migration must use a completion marker:** Gating on DB file existence is a known bug class — the DB can be created by schema migrations without the JSON import completing. Use a dedicated `migrations` table row or a boolean column in `repos` to mark import complete.
- **Module independence:** `src/nexus/client.ts` must NOT import from `src/broker/`. The coordinator is the only module that touches both. This prevents circular dependency and ensures the Nexus can be built/tested without the broker present.
- **`resubmitStaleFiles` bulk skip:** The broker client's bulk resubmission on reconnect must NOT emit `job:submitted` events to the Nexus. The NEXUS-PLAN.md documents this as an explicit skip (controlled by a flag in broker/client.ts). Only a single `progress:update` after the batch covers it.

---

## MVP Definition (v1.3)

### Launch With (v1.3 — all required for the Nexus to be useful)

- [ ] Nexus types (`src/nexus/types.ts`) — shared event envelope + all 8 event types — foundation for everything else
- [ ] SQLite store (`src/nexus/store.ts`) — `repos` + `activity` tables, WAL mode, write batching (500ms/50 events), 30-day pruning, `repos.total_tokens` accumulation
- [ ] Nexus server (`src/nexus/server.ts` + `main.ts`) — PID guard, Unix socket, NDJSON parsing, connection identity (`Map<Socket, RepoConnection>`), event routing to store + log, stale socket cleanup, graceful shutdown
- [ ] Human-readable log file (`~/.filescope/nexus.log`) — fixed-width columns, local time, log rotation at 10MB keep 3 files
- [ ] Nexus client (`src/nexus/client.ts`) — auto-spawn, connect, fire-and-forget `emit()`, reconnect timer (10s unref'd), progress debounce, `repo:init` as first message
- [ ] MCP integration — `coordinator.ts` emits `repo:init` + `repo:disconnect` + `files:changed`; `broker/client.ts` emits `job:submitted`/`job:completed`/`job:error` (with bulk-submit skip flag); `mcp-server.ts` emits `tool:called` for all 11 tools
- [ ] esbuild config update — add `src/nexus/main.ts` as a second entry point alongside `src/broker/main.ts`
- [ ] Graceful degradation verified — all 11 MCP tools work identically when Nexus is not running

### Add After Validation (v1.3 — stats migration, can ship after core is proven)

- [ ] `query:stats` protocol — request/response for per-repo token totals; 5s timeout; "unavailable" fallback
- [ ] Stats migration (`stats.json` → `nexus.db`) — one-time import on first startup, migration completion marker, Nexus becomes authoritative for token stats
- [ ] MCP `status` tool reads from Nexus instead of broker for token stats

### Future Consideration (v1.4+)

- [ ] HTTP server on the Nexus for web frontend — SSE from in-memory ring buffer, REST queries against `nexus.db`, read-only access to per-repo `.filescope/data.db` for file detail
- [ ] Broker status tap — Nexus connects to broker socket as passive observer; exposes broker queue depth in dashboard
- [ ] Cross-repo job throughput visualization — Three.js-style or similar; acknowledged as future milestone in PROJECT.md

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Nexus types (types.ts) | HIGH | LOW | P1 |
| SQLite store + write batching | HIGH | LOW | P1 |
| Nexus server (socket, NDJSON, connection identity) | HIGH | LOW | P1 |
| PID guard + stale socket cleanup | HIGH | LOW | P1 |
| Graceful shutdown | HIGH | LOW | P1 |
| Human-readable log file + fixed-width format | HIGH | LOW | P1 |
| Log rotation (10MB / 3 files) | MEDIUM | LOW | P1 |
| Activity pruning (30-day) | MEDIUM | LOW | P1 |
| Nexus client (auto-spawn, emit, reconnect) | HIGH | LOW | P1 |
| Progress debounce in client | MEDIUM | LOW | P1 |
| MCP integration (all 11 tools + coordinator + broker/client) | HIGH | MEDIUM | P1 |
| In-memory ring buffer | MEDIUM | LOW | P1 |
| Cross-repo aggregate stats (live counters) | MEDIUM | LOW | P1 |
| Graceful degradation (emit no-op when disconnected) | HIGH | LOW | P1 |
| `query:stats` request/response protocol | MEDIUM | LOW | P2 |
| Stats migration (stats.json → nexus.db) | MEDIUM | LOW | P2 |
| MCP `status` tool reads from Nexus | MEDIUM | LOW | P2 |
| HTTP server + SSE for web frontend | HIGH | HIGH | P3 |
| Broker status tap | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1.3 launch — the Nexus is not useful without these
- P2: Should have — complete the stats handoff from broker; add when core is proven
- P3: Defer to v1.4+ — web frontend and broker tap are separate milestones

---

## Dependency on Existing Components

| Existing Component | How v1.3 Uses It |
|-------------------|-----------------|
| `src/broker/client.ts` | Adds emit calls for `job:submitted`, `job:completed`, `job:error`; adds bulk-submit skip flag for `resubmitStaleFiles`; does NOT import from nexus — coordinator wires both |
| `src/coordinator.ts` | Adds `nexusConnect()` after `brokerConnect()` in `init()`; adds `nexusDisconnect()` before `brokerDisconnect()` in `shutdown()`; emits `repo:init`, `progress:update`, `repo:disconnect`, `files:changed` |
| `src/mcp-server.ts` | Wraps each tool handler in timing; emits `tool:called` with toolName + durationMs after handler returns |
| `src/broker/stats.ts` | Phase 2 (stats migration): Nexus reads `stats.json` once on first startup for import; broker continues writing in parallel until stats migration phase cuts over |
| `better-sqlite3` (existing dep) | `nexus.db` uses the same package as per-repo `data.db`; no new native modules |
| esbuild config | Adds `src/nexus/main.ts` as a second additional entry point (alongside `src/broker/main.ts`) |
| `src/logger.ts` | Nexus server logs to stdout using existing logger; `nexus.log` is a separate human-readable file written directly via `fs.appendFileSync` |

---

## Protocol Design Notes

### Nexus Event Envelope (client → server, fire-and-forget)

All events share:
```typescript
interface NexusEvent {
  type: 'repo:init' | 'repo:disconnect' | 'job:submitted' | 'job:completed' |
        'job:error' | 'progress:update' | 'tool:called' | 'files:changed';
  timestamp: number;   // Date.now() at emission
  repoPath: string;    // absolute path — the unique repo key
  repoName: string;    // basename(repoPath) — display only
  // ...event-specific fields
}
```

Eight event types, all one-way. See NEXUS-PLAN.md for per-type field definitions.

### Stats Query (bidirectional — the one exception)

```typescript
// Client → Nexus
{ type: 'query:stats', requestId: string, repoPath: string }

// Nexus → Client
{ type: 'stats_response', requestId: string, totalTokens: number }
```

Client maintains `Map<requestId, resolve>`. 5s `setTimeout` rejects with null. Nexus looks up `repos.total_tokens` by `repoPath` and writes the response to the requesting socket.

### Why No Event Dedup

The broker has per-job dedup (one pending job per `repoPath + filePath + jobType`). The Nexus does NOT dedup events — every event is a new historical record. The activity log is append-only by design; duplicates from crashes or reconnects are acceptable noise in an observability system and do not affect correctness.

### `resubmitStaleFiles` Bulk Skip

When the broker client reconnects and calls `resubmitStaleFiles()`, it sets a module-level flag `_emittingBulkSubmit = true` before the loop and resets it after. The `emit()` call for `job:submitted` checks this flag and skips when `true`. This prevents hundreds of `job:submitted` events flooding the Nexus activity log on every reconnect. The `progress:update` emitted after the batch correctly captures the net state.

---

## Sources

- NEXUS-PLAN.md (this project) — complete architecture design; authoritative for event types, schema, lifecycle, and edge cases
- `src/broker/client.ts`, `src/broker/stats.ts`, `src/broker/server.ts` — existing broker pattern (this Nexus mirrors it exactly)
- Node.js v22 `node:net` documentation — per-client socket identity, connection events, `Map<Socket, State>` pattern
- [Microservices Pattern: Log Aggregation](https://microservices.io/patterns/observability/application-logging.html) — centralized log sink pattern; fire-and-forget event collection
- [OpenTelemetry Collector Unix Socket Issue #11941](https://github.com/open-telemetry/opentelemetry-collector/issues/11941) — UDS for internal telemetry; confirms the pattern for local-only observability
- [Four Considerations When Designing Systems For Graceful Degradation — New Relic](https://newrelic.com/blog/observability/design-software-for-graceful-degradation) — optional service = no impact on core path; circuit breaker not needed when fire-and-forget already drops events
- [SQLite Optimizations For Ultra High-Performance — PowerSync](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance) — 50x speedup from batched transactions vs individual inserts; 500ms flush window confirmed
- [Log Formatting: 8 Best Practices — Sematext](https://sematext.com/blog/log-formatting-8-best-practices-for-better-readability/) — fixed-width columns for `tail -f` readability; local timezone for interactive monitoring
- [JSON→SQLite one-time migration reruns — GitHub issue](https://github.com/anomalyco/opencode/issues/16885) — critical: DB file existence is NOT a safe migration gate; use dedicated migration marker
- [Batches in SQLite — Turso](https://turso.tech/blog/batches-in-sqlite-838e0961) — write queue pattern with time window debounce

---

*Feature research for: FileScopeMCP v1.3 Nexus observability service*
*Researched: 2026-03-24*
