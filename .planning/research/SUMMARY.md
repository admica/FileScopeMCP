# Project Research Summary

**Project:** FileScopeMCP v1.3 — Nexus Observability Service
**Domain:** Centralized event sink / observability daemon for a local multi-process LLM tooling system
**Researched:** 2026-03-24
**Confidence:** HIGH

## Executive Summary

FileScopeMCP v1.3 adds the Nexus: a standalone daemon that receives events from all running MCP instances over a Unix domain socket, persists them to a SQLite database (`nexus.db`), and writes a human-readable fixed-width log file that developers can monitor with `tail -f`. The Nexus is architecturally identical to the existing LLM broker — same PID guard, same NDJSON framing, same auto-spawn pattern, same reconnect model — making it a greenfield addition with zero architectural unknowns. The entire milestone requires no new npm dependencies; every capability is covered by Node.js 22 built-ins and existing dependencies (`better-sqlite3`, `esbuild`).

The recommended implementation approach is a strict linear six-phase build: types and store first (testable in isolation), server and daemon second, client third, MCP wiring fourth, stats migration fifth, and end-to-end verification last. This ordering is driven by hard dependency requirements — the client can't be integrated before the server API is stable, and the stats migration should only run after the core event pipeline is proven. The Nexus must be a pure fire-and-forget event sink; the single exception (stats query/response for the `status` MCP tool) is best avoided entirely by having MCP instances read `nexus.db` directly with a read-only `better-sqlite3` connection, which eliminates a 2-second timeout regression in the `status` tool.

The dominant risk class is the observability daemon accidentally becoming a critical-path dependency. If `nexusConnect()` is implemented as an async function that coordinator init awaits — mirroring the broker pattern — any Nexus startup failure (missing binary, disk full, permission denied) will break the user's Claude session. The fix is simple but must be a design constraint enforced from day one: `nexusConnect()` must be void (not async), must never throw, and must never be awaited. All other pitfalls (spawn races, WAL flush on shutdown, log rotation events lost, ring buffer bloat) have mechanical solutions documented in PITFALLS.md and can be prevented with targeted unit and integration tests written alongside each phase.

---

## Key Findings

### Recommended Stack

This is a zero-dependency-addition milestone. All new capabilities are covered by the retained stack. The only "new" technology decisions are scoped to implementation choices within existing dependencies.

**Core technologies and their v1.3 roles:**

- **`better-sqlite3` (raw, no Drizzle):** `nexus.db` uses the same `createRequire(import.meta.url)` loading pattern as `src/db/db.ts`. The Nexus schema is two fixed tables with known columns — Drizzle's value is schema evolution, which doesn't apply here. Raw prepared statements + `db.transaction()` for batch inserts are the correct choice, as already demonstrated in `broker/stats.ts`.
- **`node:net` + `node:readline`:** The Nexus server and client are structurally identical to `broker/server.ts` and `broker/client.ts`. Unix domain socket at `~/.filescope/nexus.sock`, NDJSON framing via `readline.createInterface`. No new IPC mechanism needed.
- **`fs.appendFileSync` (not a stream):** Log file writes must use synchronous append, not a writable stream. Streams create an EBADF/ENOENT window during the 10MB log rotation rename sequence. At the Nexus's event volume (~200 events/minute peak), sync append performance is indistinguishable from a stream.
- **Plain `T[]` array + self-rescheduling `setTimeout`:** Write batching uses a self-rescheduling `setTimeout` (not `setInterval`) draining a plain array. Libraries such as `better-queue` or `p-queue` are over-engineering for an 8-line pattern.
- **Custom ring buffer (20 lines of TypeScript):** 1000 events at ~200 bytes each = ~200KB. No circular buffer library needed.
- **esbuild (third entry point):** Add `src/nexus/main.ts` to the existing flat entry-point list. Identical configuration, output at `dist/nexus/main.js`.

See `.planning/research/STACK.md` for full implementation patterns with code.

### Expected Features

**Must have — v1.3 launch (Nexus is not useful without these):**

- Nexus daemon with PID guard and stale socket cleanup on startup
- Unix socket server (`~/.filescope/nexus.sock`) with NDJSON framing
- First-message identity protocol: `repo:init` establishes `Map<Socket, RepoConnection>`
- Event routing to three destinations: in-memory state, SQLite batch queue, log file
- Append-only human-readable log at `~/.filescope/nexus.log` — fixed-width columns, local time, log rotation at 10MB keeping 3 files
- SQLite `nexus.db` with `repos` + `activity` tables, WAL mode, write batching (500ms / 50 events), 30-day activity pruning
- In-memory ring buffer (1000 events) storing slim `RingEntry` projections (not raw `NexusEvent` objects)
- Cross-repo aggregate stats counters (live, rebuilt from event stream on Nexus restart)
- Nexus client (`src/nexus/client.ts`) with auto-spawn, fire-and-forget `emit()`, 10s reconnect timer (unref'd), progress debounce (every 10th completion or 60s)
- MCP integration: coordinator emits `repo:init` / `repo:disconnect` / `files:changed`; broker client emits `job:submitted` / `job:completed` / `job:error` (with bulk-submit skip flag); mcp-server wraps all 11 tool handlers for `tool:called` timing
- Graceful degradation: `emit()` is a silent no-op when disconnected — zero impact on core MCP functionality
- Graceful shutdown: flush pending batch, WAL checkpoint, close DB, unlink socket + PID

**Should have — add after core is proven (v1.3 Phase 5):**

- Stats migration: `stats.json` → `nexus.db` one-time import using MAX semantics (idempotent, safe to repeat on every startup)
- MCP `status` tool reads `total_tokens` directly from `nexus.db` via read-only `better-sqlite3` connection — eliminates the need for a `query:stats` socket protocol entirely
- `repos` table becomes authoritative for token stats, replacing `broker/stats.ts` / `stats.json`

**Defer to v1.4+:**

- HTTP server + SSE endpoint for browser dashboard (reads from `nexus.db` + in-memory ring buffer)
- Broker status tap (Nexus connects to broker as passive observer)
- Cross-repo job throughput visualization

See `.planning/research/FEATURES.md` for the full prioritization matrix and dependency graph.

### Architecture Approach

The Nexus is a new `src/nexus/` module directory that mirrors the `src/broker/` structure. Five new files (`types.ts`, `store.ts`, `server.ts`, `client.ts`, `main.ts`) contain all new code. Four existing files receive surgical additive changes only (`coordinator.ts`, `broker/client.ts`, `mcp-server.ts`, `package.json`). One file is removed in Phase 5 (`broker/stats.ts`) after Nexus becomes the authoritative token stats source.

**Major components:**

1. `nexus/types.ts` — Protocol contract: `NexusEvent` union (8 event types), `RepoConnection` interface, path constants for sock/pid/log/db files. No imports from broker or coordinator — pure protocol definition.
2. `nexus/store.ts` — `NexusStore` class: SQLite schema initialization (WAL mode, two tables, three indexes), `ActivityBatcher` (self-rescheduling setTimeout, 50-event threshold), log append with `appendFileSync`, rename-based log rotation, `RingBuffer<RingEntry>`, `flushPendingBatch()` + `checkpoint()` for shutdown. Testable in complete isolation.
3. `nexus/server.ts` — `NexusServer` class: `net.createServer()`, per-client `readline` interface, `Map<Socket, RepoConnection>` for connection identity, event dispatch to store. Composes `NexusStore`.
4. `nexus/main.ts` — Entry point: PID guard (write PID before binding socket), `server.listen()` with `EADDRINUSE → process.exit(0)` handler, SIGTERM/SIGINT shutdown sequence.
5. `nexus/client.ts` — Module-level socket state (mirrors `broker/client.ts` exactly). `nexusConnect()` is void and never throws. `emit()` is a no-op when disconnected. Auto-spawn + 10s reconnect timer (unref'd). Progress debounce counter.

**Key module boundary rule:** `nexus/client.ts` does not import from `broker/`. The dependency direction is `broker/client.ts → nexus/client.ts → nexus/types.ts`. The coordinator is the only module that calls both `brokerConnect` and `nexusConnect`.

See `.planning/research/ARCHITECTURE.md` for the full system diagram, data flow sequences, and build configuration changes.

### Critical Pitfalls

1. **Nexus becomes critical path** — If `nexusConnect()` is implemented as `async` and awaited in coordinator init (copying the broker pattern), any Nexus failure breaks the user's Claude session. Prevention: `nexusConnect()` must be `void`, never async, never throws, never awaited. Write a verification test: delete `dist/nexus/main.js`, confirm coordinator starts clean.

2. **Multi-instance spawn race produces duplicate Nexus daemons** — Three MCP instances starting simultaneously all pass the `existsSync(SOCK_PATH)` check before any Nexus has bound. Three processes race to `server.listen()`. The two losers must exit via `process.exit(0)` (not crash) on `EADDRINUSE`. The PID file must be written BEFORE binding the socket, so EADDRINUSE cleanup can remove both atomically.

3. **WAL shutdown loses the last flush batch** — The shutdown sequence must call `flushPendingBatch()` then `db.pragma('wal_checkpoint(TRUNCATE)')` then `db.close()` in that order. Closing the DB before flushing drops up to 499ms of events.

4. **Ring buffer memory bloat from large event payloads** — The ring buffer must store `RingEntry` projections (id, timestamp, eventType, repoPath, pre-formatted summary string), not raw `NexusEvent` objects. A `files:changed` event for a 500-file cascade could be 15KB; 1000 of those is 15MB just in the ring buffer. Define the `RingEntry` type before implementing the ring buffer.

5. **`query:stats` creates a latency regression in the `status` tool** — If stats are fetched via a socket request/response, the `status` tool acquires a 2-second timeout dependency on the Nexus being up. Preferred solution: the MCP instance opens `nexus.db` directly with a read-only `better-sqlite3` connection per status call. Zero latency, zero timeout, Nexus remains a pure sink.

See `.planning/research/PITFALLS.md` for 10 critical pitfalls with full prevention patterns and the "Looks Done But Isn't" checklist.

---

## Implications for Roadmap

Based on research, the implementation follows a strict linear dependency chain. There is no parallelism in the build order — each phase depends on the previous.

### Phase 1: Types and Store

**Rationale:** `types.ts` is the protocol contract that all other phases depend on. `store.ts` is the only Nexus component with no external process dependencies — it can be written and fully unit-tested without a running server or client. This is where the highest-impact pitfalls live (WAL shutdown flush, batch timer accumulation, ring buffer memory, log rotation correctness) and they must be solved before the server is built on top.

**Delivers:** `nexus/types.ts` (NexusEvent union, RepoConnection, path constants) and `nexus/store.ts` (NexusStore class with SQLite schema, ActivityBatcher, RingBuffer<RingEntry>, log append, rotation). Both are fully unit-tested in isolation.

**Addresses features:** SQLite persistence, write batching, 30-day pruning, in-memory ring buffer, fixed-width log format, log rotation, graceful shutdown flush sequence.

**Avoids pitfalls:** WAL shutdown batch loss (Pitfall 3), batch timer accumulation (Pitfall 4), ring buffer memory bloat (Pitfall 9), log rotation event loss (Pitfall 7).

**Research flag:** Standard patterns — no deeper research needed. All implementation patterns are in STACK.md with working code.

### Phase 2: Server and Daemon

**Rationale:** With types and store complete, the Nexus server can be built and tested as a standalone process. The PID guard, spawn race handling, and connection identity model must be correct before the client can be built against it.

**Delivers:** `nexus/server.ts` (NexusServer class: socket accept, NDJSON parsing, connection map, event routing) and `nexus/main.ts` (PID guard with PID written before socket bind, SIGTERM/SIGINT handlers, `EADDRINUSE → process.exit(0)` handler). The Nexus can be started, connected to with raw socket scripts, and verified end-to-end.

**Addresses features:** Daemon PID guard, stale socket cleanup, NDJSON framing, connection identity, event routing, graceful shutdown.

**Avoids pitfalls:** Multi-instance spawn race (Pitfall 2), socket cleanup race (Pitfall 8), repo:init ordering violations (Pitfall 5).

**Research flag:** Standard patterns — broker/main.ts and broker/server.ts are direct reference implementations. No deeper research needed.

### Phase 3: Nexus Client

**Rationale:** The client API must be finalized before MCP wiring begins — the coordinator, broker client, and mcp-server all import from `nexus/client.ts`. The critical constraint (nexusConnect is void, never async, never throws) must be validated against the running server before integration.

**Delivers:** `nexus/client.ts` (module-level socket state, `nexusConnect()` as void, `emit()` as no-op when disconnected, auto-spawn, 10s reconnect timer unref'd, progress debounce, `repo:init` as first message on every new connection).

**Addresses features:** Auto-spawn, graceful degradation, reconnect, progress debounce.

**Avoids pitfalls:** Nexus becomes critical path (Pitfall 1), repo:init ordering on reconnect (Pitfall 5).

**Research flag:** Standard patterns — broker/client.ts is the reference implementation. Key test to write: delete nexus binary, confirm coordinator init completes cleanly with zero error logs.

### Phase 4: MCP Integration

**Rationale:** With the client API stable, the three existing files that emit events can be modified. Changes are additive and surgical — no existing logic is modified, only new emit calls are inserted at well-defined points.

**Delivers:** Modified `coordinator.ts` (nexusConnect/nexusDisconnect lifecycle, repo:init + repo:disconnect + files:changed events), modified `broker/client.ts` (job:submitted with bulk-skip flag, job:completed, job:error), modified `mcp-server.ts` (timing wrapper for all 11 tool handlers emitting tool:called), updated `package.json` esbuild entry points.

**Addresses features:** Full MCP event emission across all 11 tools, coordinator lifecycle events, broker job events.

**Avoids pitfalls:** resubmitStaleFiles bulk-submit spam (implemented via `_bulkResubmit` flag in broker/client.ts).

**Research flag:** Standard patterns — no deeper research needed. All integration points are exactly specified in ARCHITECTURE.md.

### Phase 5: Stats Migration and Cutover

**Rationale:** This phase is deliberately separated from the core build. Running it after Phase 4 is proven means the Nexus is already accumulating real `job:completed` token data before the historical import. Stats migration must use MAX semantics (idempotent, safe to repeat on every startup) rather than a "once only" gate — the "import only if DB is empty" check fails when the DB already has live event data.

**Delivers:** Stats migration on Nexus startup (`stats.json` → `nexus.db` using MAX semantics), MCP `status` tool reads `total_tokens` directly from `nexus.db` via read-only `better-sqlite3` connection (no socket query protocol), removal of `accumulateTokens` calls from broker, removal of `broker/stats.ts`.

**Addresses features:** Historical token data preservation, Nexus as authoritative stats source, `status` tool accuracy post-migration.

**Avoids pitfalls:** Stats migration race (Pitfall 6), query:stats latency regression (Pitfall 10).

**Research flag:** One decision required before coding: confirm the "direct DB read" approach (Option A from Pitfall 10) is acceptable. This eliminates the `query:stats` socket protocol entirely. Option A is strongly recommended — it removes a protocol complexity class and prevents a latency regression.

### Phase 6: End-to-End Verification

**Rationale:** Integration behaviors that can't be verified by phase-level unit tests — multi-instance resilience, tail-f monitoring experience, kill-and-reconnect cycles.

**Delivers:** All items from the PITFALLS.md "Looks Done But Isn't" checklist verified. Key scenarios: 5 simultaneous MCP instances → exactly one Nexus process, SIGTERM with 40 pending events → all 40 in nexus.db, log rotation with 1000-byte threshold → all lines present across rotation boundary, Nexus down → status tool responds in <300ms.

**Research flag:** No research needed — checklist is fully specified in PITFALLS.md.

### Phase Ordering Rationale

- Types before everything: `nexus/types.ts` is imported by client, server, and store. Nothing can be built without it.
- Store before server: server composes store; store must be tested standalone so failures in store logic are isolated from server logic.
- Server before client: client integration tests require a running server; the client API (specifically nexusConnect's void return) is validated against the real server before MCP wiring locks in the API.
- Client before MCP wiring: all three modified files (`coordinator.ts`, `broker/client.ts`, `mcp-server.ts`) import from the same client module. The client API must be final before touching three separate files.
- Stats migration last: the migration runs on top of a live, proven event pipeline. Running it earlier would be migrating into an unproven store.

### Research Flags

Phases needing deeper research during planning: none. All implementation patterns are fully specified with working code samples from direct codebase inspection. The broker implementation is the reference implementation — every Nexus pattern has a 1:1 broker analog.

Phases with standard patterns (skip research-phase): all six phases. The research was conducted against the live codebase and authoritative design document (NEXUS-PLAN.md). Confidence is HIGH across all areas.

One decision to confirm before Phase 5 begins: whether direct `nexus.db` read (Option A) or socket query protocol (Option B) is used for the `status` tool stats. Research strongly recommends Option A — it eliminates an entire protocol complexity class and a latency regression.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All patterns derived from direct inspection of working production code in the same codebase. Zero new dependencies — every library and API is already in use and confirmed working. |
| Features | HIGH | NEXUS-PLAN.md is a complete authoritative design document written by the project owner. Feature set is fully specified including anti-features and deferral rationale. |
| Architecture | HIGH | Broker is the direct reference implementation. Component boundaries, data flow, and integration points were verified against actual source files (`broker/client.ts`, `broker/main.ts`, `broker/server.ts`, `coordinator.ts`). |
| Pitfalls | HIGH | Ten pitfalls identified from broker implementation post-mortem, Node.js official docs, SQLite WAL official docs, and direct codebase audit. Each has a tested prevention pattern and recovery strategy. |

**Overall confidence:** HIGH

### Gaps to Address

- **Stats query mechanism (Phase 5 decision):** Research identifies two options for how the MCP `status` tool reads token stats after migration. Option A (direct `nexus.db` read with read-only `better-sqlite3`) is recommended and eliminates the `query:stats` protocol entirely. Option B (socket request/response with 200ms timeout) is the fallback. Decide at Phase 5 start and code accordingly.

- **Direct DB read connection caching:** PITFALLS.md flags that opening a new `Database()` per `status` call adds ~10ms overhead. If `status` is called frequently, the MCP instance should cache the read-only handle. Minor implementation detail but worth noting in Phase 5.

- **`stats.json` retention after migration:** PITFALLS.md recommends never deleting `stats.json` (keep broker writing it as a no-op backup). This means `broker/stats.ts` may not be fully removed in Phase 5 — only the `accumulateTokens` call path is removed. Confirm the exact scope of `broker/stats.ts` removal during Phase 5 planning.

---

## Sources

### Primary (HIGH confidence)

- `/home/autopcap/FileScopeMCP/NEXUS-PLAN.md` — authoritative design document: event types, schema, lifecycle, edge cases, phased implementation plan
- `/home/autopcap/FileScopeMCP/src/broker/client.ts` — reference implementation for module-level socket client, auto-spawn, reconnect, progress debounce
- `/home/autopcap/FileScopeMCP/src/broker/main.ts` — reference implementation for PID guard, `isPidRunning()`, SIGTERM/SIGINT shutdown
- `/home/autopcap/FileScopeMCP/src/broker/server.ts` — reference implementation for NexusServer class structure, connection set management
- `/home/autopcap/FileScopeMCP/src/broker/stats.ts` — stats migration source and cutover surface
- `/home/autopcap/FileScopeMCP/src/coordinator.ts` — integration point analysis for lifecycle hooks
- `/home/autopcap/FileScopeMCP/src/db/db.ts` — `createRequire` pattern for better-sqlite3, WAL pragma configuration
- `/home/autopcap/FileScopeMCP/package.json` — esbuild command structure, confirmed dependency versions
- [Node.js v22 `node:fs` docs](https://nodejs.org/api/fs.html) — `appendFileSync`, `renameSync`, `statSync` behavior
- [Node.js v22 `node:net` docs](https://nodejs.org/api/net.html) — `server.close()` semantics, `EADDRINUSE` behavior
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — `db.transaction()`, `db.pragma()`, `db.close()`, synchronous write semantics
- [SQLite WAL mode official docs](https://www.sqlite.org/wal.html) — checkpoint behavior, `wal_checkpoint(TRUNCATE)`, `PRAGMA synchronous` levels, crash safety

### Secondary (MEDIUM confidence)

- [SQLite Optimizations For Ultra High-Performance — PowerSync](https://www.powersync.com/blog/sqlite-optimizations-for-ultra-high-performance) — 50x speedup from batched transactions vs individual inserts; 500ms flush window confirmed
- [Log Formatting Best Practices — Sematext](https://sematext.com/blog/log-formatting-8-best-practices-for-better-readability/) — fixed-width columns for `tail -f` readability; local timezone for interactive monitoring
- [Microservices Pattern: Log Aggregation](https://microservices.io/patterns/observability/application-logging.html) — centralized log sink pattern; fire-and-forget event collection
- [JSON→SQLite migration reruns issue](https://github.com/anomalyco/opencode/issues/16885) — DB file existence is not a safe migration gate; use dedicated migration marker
- [Batches in SQLite — Turso](https://turso.tech/blog/batches-in-sqlite-838e0961) — write queue pattern with time window debounce
- [Four Considerations When Designing Systems For Graceful Degradation — New Relic](https://newrelic.com/blog/observability/design-software-for-graceful-degradation) — optional service contract; fire-and-forget drops events without circuit breaker

---

*Research completed: 2026-03-24*
*Ready for roadmap: yes*
