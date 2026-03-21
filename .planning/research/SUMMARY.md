# Project Research Summary

**Project:** FileScopeMCP v1.2 — LLM Broker
**Domain:** Unix domain socket IPC broker for multi-instance LLM coordination
**Researched:** 2026-03-21
**Confidence:** HIGH

## Executive Summary

FileScopeMCP v1.2 adds a standalone broker process that centralizes all Ollama communication across multiple per-repo instances. The broker design is well-established: a Unix domain socket server with NDJSON framing, an in-memory priority heap ordered by file importance, and a single sequential worker loop. The existing stack (TypeScript 5.8, Node.js 22, Vercel AI SDK, better-sqlite3, esbuild) requires zero new npm dependencies — all IPC, framing, and queue capabilities are covered by Node.js built-ins and a 35-line custom binary heap.

The recommended approach is a 5-phase build sequence driven by a clear dependency rule: the instance-side client with transparent fallback comes first (zero behavior change while wiring callers), then the broker process, then the pipeline dual-mode refactor, then schema cleanup, then `get_llm_status` update. This order preserves the existing direct-Ollama fallback path throughout integration, so no phase introduces a regression. Shared code (`adapter.ts`, `prompts.ts`, `types.ts`) is safe to import from both the broker and instances because it is stateless. The module boundary constraint is well-defined and documented.

The top risks are all implementation-level, not architectural. Stale socket files, partial NDJSON data events, and the `server.close()` hang on shutdown are three must-solve correctness issues that produce hard-to-diagnose failures if skipped. In-flight job tracking on the client side (the `pendingJobs` map) is the other non-optional piece: without it, jobs are silently lost when the broker restarts mid-call. All of these have known, tested prevention patterns documented in PITFALLS.md.

---

## Key Findings

### Recommended Stack

The v1.2 milestone adds zero new runtime dependencies. All five new capability domains — Unix domain socket server/client, NDJSON framing, in-memory priority queue, reconnecting client, and second esbuild entry point — are satisfied by Node.js 22 built-ins (`node:net`, `node:readline`) and pure TypeScript. The broker reuses `adapter.ts`, `prompts.ts`, and `types.ts` from the existing LLM stack without modification.

**Core new capabilities (no new packages):**
- `node:net` — Unix domain socket server and client; avoids port conflicts, ~50% lower latency than TCP loopback
- `node:readline` — NDJSON framing over socket streams; handles buffer accumulation and partial reads correctly
- Custom TypeScript binary heap (~35 lines) — importance DESC / created_at ASC comparator; `removeByKey()` for dedup upsert
- `esbuild` (existing) — second entry point for `src/broker/main.ts`; separate `--bundle` build produces self-contained `dist/broker.js`
- `better-sqlite3` (existing) — broker uses it only for token stats persistence at `~/.filescope/stats.json`

**Packages explicitly rejected:** `node-ipc` (malicious code, CVE-2022-23812), `@datastructures-js/priority-queue` (wraps ~35 lines of heap code), `ndjson` npm package (wraps `readline`), `socket.io` / `ws` (browser/TCP targets, unnecessary weight for local-only IPC).

### Expected Features

**Must have for v1.2 (P1 — all required for correctness):**
- Standalone broker binary: Unix socket server, in-memory priority heap, NDJSON protocol
- Job dedup on `(repoPath, filePath, jobType)` — latest content wins on replace
- 120s job timeout via `AbortController`
- PID file guard and stale socket cleanup (probe before unlink, not blind delete)
- Broker builds prompts and calls Ollama; routes result back to submitting instance socket
- Instance-side broker client with in-flight `Map<jobId, resolver>` for promise correlation
- Graceful degradation: `ENOENT`/`ECONNREFUSED` triggers direct-Ollama mode via existing `LLMPipeline`
- Auto-reconnect with exponential backoff + jitter (cap 30s)
- Startup resubmission batching (top N by importance, prevents queue flood on restart)
- Graceful shutdown: track `activeConnections`, call `socket.destroy()` on each
- Remove legacy `llm_jobs` and `llm_runtime_state` tables from local DB
- Remove `TokenBudgetGuard` gating (keep stats counter)

**Should have for v1.2 (P2 — add when feasible):**
- Token stats persistence at `~/.filescope/stats.json` with per-repo lifetime totals
- `get_llm_status` reports broker mode, queue depth, in-progress job, token stats
- File-deleted cancellation: `fs.stat()` check before Ollama dispatch

**Defer to v1.3+:**
- Formal protocol version handshake (all processes update together today)
- Multi-worker support (only useful with multi-GPU hardware)
- Broker CLI (`filescope broker start|stop|status`)

**Anti-features (explicitly rejected for v1.2):**
- HTTP/REST API — port conflicts and header overhead; Unix socket is strictly better for local-only IPC
- Concurrent Ollama workers — single GPU serializes at driver level; adding workers brings locking complexity with zero throughput gain
- Persistent broker SQLite queue — in-memory queue is correct when there is exactly one consumer; shared SQLite is needed only for multiple competing consumers (Phase 16 design was superseded by the broker pattern)
- Broker hot-reload of config — restart takes < 1 second, clients auto-reconnect

### Architecture Approach

The broker is a protocol boundary, not a dependency. Instances and the broker share stateless pure modules (`adapter.ts`, `prompts.ts`, `types.ts`, `logger.ts`) at the source level but share no runtime state. The broker owns all LLM interaction including prompt construction; instances submit raw job data and receive result text. `broker-client.ts` is the only broker-facing module that instances import, and it communicates exclusively over the socket. This eliminates circular dependency risk by design.

**Major new components:**
1. **`src/broker/main.ts`** — Broker process entry point; starts socket server, worker loop, signal handlers; owns PID file lifecycle
2. **`src/broker/server.ts`** — Unix socket server (`net.createServer`); parses NDJSON, dispatches `submit`/`cancel`/`status` messages; tracks `activeConnections` for clean shutdown
3. **`src/broker/queue.ts`** — In-memory binary max-heap; dedup on `(repoPath, filePath, jobType)`; priority aging (+1 per 5 min wait) prevents starvation
4. **`src/broker/worker.ts`** — Sequential Ollama worker loop; reads file, builds prompt, calls `generateText`, routes result back to submitting instance socket; 120s timeout per job
5. **`src/llm/broker-client.ts`** — Instance-side client; `submitJob()` hides broker-vs-direct mode switching; in-flight `Map<jobId, resolver>`; exponential backoff reconnect; re-queues `pendingJobs` on disconnect

**Modified components (key changes):** `cascade-engine.ts` and `llm-diff-fallback.ts` swap `insertLlmJobIfNotPending()` for `submitJob()`; `pipeline.ts` gains dual-mode (broker response listener or direct dequeue loop); `coordinator.ts` wires broker lifecycle and drops budget guard; `db/repository.ts` loses all job CRUD functions; `db/schema.ts` drops `llm_jobs`/`llm_runtime_state`; `rate-limiter.ts` becomes stats-only counter.

**Unchanged:** `adapter.ts`, `prompts.ts`, `llm/types.ts`, FileWatcher, all MCP tools except `get_llm_status`, `writeLlmResult`, `clearStaleness`, `markStale`.

### Critical Pitfalls

1. **Stale socket `EADDRINUSE` on crash** — Probe the socket before touching it: connect to check for a live broker; on `ECONNREFUSED` unlink the stale file. Never blind-delete. Register `process.on('exit')` cleanup. Two brokers racing to delete is worse than not deleting.

2. **NDJSON framing breaks on partial `data` events** — Never `JSON.parse()` raw `data` events. Always wrap the socket in `readline.createInterface({ input: socket, crlfDelay: Infinity })` and handle the `line` event. Partial reads are guaranteed on payloads > ~4KB. This is the single most common IPC bug in Node.js systems.

3. **`server.close()` does not close existing connections — broker hangs on shutdown** — `server.close()` stops new connections only. Track all accepted sockets in `activeConnections: Set<net.Socket>`, call `socket.destroy()` on each in the SIGTERM/SIGINT handler. Without this, the broker never exits and subsequent restarts fail with `BROKER_ALREADY_RUNNING`.

4. **In-flight job lost when broker disconnects during processing** — Instance must maintain `pendingJobs: Map<jobId, JobRequest>`. On disconnect, all entries re-enqueue to the local fallback queue. Remove entries only on explicit `result` acknowledgment from the broker.

5. **Startup race — instance connects before broker is ready** — The broker client must use exponential backoff with jitter (starting 100ms) for the initial connect, not a single fail-fast attempt. Three instances starting simultaneously must all connect within 30 seconds.

---

## Implications for Roadmap

Research establishes a clear 5-phase build sequence derived from dependency constraints. The key rule: the client with fallback must exist before callers can be migrated; the broker process must exist before broker mode can be tested; schema cleanup must come last to preserve the fallback path during validation.

### Phase 1: Broker Client with Transparent Fallback

**Rationale:** The client is the integration seam. Building it first with a working fallback path migrates all callers (`cascade-engine.ts`, `llm-diff-fallback.ts`) to the new `submitJob()` interface without any behavior change. All existing tests must pass at the end of this phase. No broker process exists yet.

**Delivers:** `src/llm/broker-client.ts` with `submitJob()`, in-flight map, exponential backoff reconnect, re-queue on disconnect, and direct-mode fallback wired to existing `LLMPipeline`. Callers updated.

**Addresses:** Instance-side client (table stakes), graceful degradation, auto-reconnect, mode-switch correctness.

**Avoids:** Mode-switch double-processing (pitfall 5); in-flight job loss on broker disconnect (pitfall 4); startup race (pitfall 3 — backoff wired here).

**Research flag:** Standard patterns. No additional research needed.

### Phase 2: Broker Process (Server, Queue, Worker)

**Rationale:** Once the client exists, the broker can be built and tested end-to-end. The client switches from fallback to socket mode automatically when the broker is running.

**Delivers:** `src/broker/main.ts`, `server.ts`, `queue.ts`, `worker.ts`. Second esbuild `--bundle` entry point producing `dist/broker.js`. PID file guard, stale socket recovery, graceful shutdown with `activeConnections` tracking, priority aging in queue dequeue, socket path length validation.

**Addresses:** Broker process (table stakes P1), priority heap with starvation protection, NDJSON protocol, PID guard, stale socket cleanup, job timeout, file-deleted cancellation.

**Avoids:** Stale socket `EADDRINUSE` (pitfall 1); NDJSON partial reads (pitfall 2); `server.close()` hang (pitfall 10); socket path > 103 bytes (pitfall 8); esbuild broker using wrong build mode — must use `--bundle` separate from main build, not added to the file list (pitfall 7).

**Research flag:** Standard patterns. No additional research needed.

### Phase 3: Pipeline Dual-Mode Refactor

**Rationale:** Depends on Phase 2 — the broker must exist to test the broker response path. The pipeline's polling dequeue loop is replaced by a broker response listener in broker mode. `TokenBudgetGuard` gating is removed; `rate-limiter.ts` simplified to stats-only counter. `coordinator.ts` wires broker lifecycle (connect on init, disconnect on shutdown).

**Delivers:** `pipeline.ts` in dual-mode (broker response listener or direct dequeue loop). `rate-limiter.ts` simplified. `coordinator.ts` with broker client lifecycle and budget guard removed.

**Addresses:** Remove `TokenBudgetGuard` gating; token stats persistence; `get_llm_status` broker reporting.

**Avoids:** `~/.filescope/` directory missing on first run — `mkdirSync({ recursive: true })` before any file writes (pitfall 11).

**Research flag:** Standard patterns. No additional research needed.

### Phase 4: Schema Cleanup

**Rationale:** Must come after broker mode is validated in a real session. Dropping `llm_jobs` and `llm_runtime_state` removes the direct-mode fallback persistence layer permanently. Only safe once broker mode has been exercised end-to-end.

**Delivers:** `db/repository.ts` with all job CRUD functions removed. `db/schema.ts` without `llm_jobs`/`llm_runtime_state`. `coordinator.ts` `init()` drops the tables at startup on existing DBs.

**Addresses:** Clean up Phase 16 artifacts (shared SQLite queue design superseded by the broker pattern; in-memory queue is correct because the broker is the single consumer).

**Avoids:** Premature deletion — if done during Phases 1–3, the direct-mode fallback path breaks during testing.

**Research flag:** Straightforward migration. No additional research needed.

### Phase 5: `get_llm_status` Update and Stats Visibility

**Rationale:** Independent of Phases 1–4 conceptually, but requires a running broker for meaningful output. Placed last to avoid testing a tool before the broker exists.

**Delivers:** `get_llm_status` MCP tool reporting `mode: 'broker' | 'direct'`, `brokerConnected`, `pendingJobs`, `inProgressJob`, and `lifetimeTokensUsed` per repo from `~/.filescope/stats.json`.

**Addresses:** Token stats persistence; operator visibility; differentiator features (P2).

**Research flag:** Standard MCP tool pattern. No additional research needed.

### Phase Ordering Rationale

- **Client before broker:** Callers must be migrated to `submitJob()` before the broker can be tested. Building the fallback path first means zero regression risk during Phase 2 broker development.
- **Broker before pipeline refactor:** The dual-mode dequeue loop in `pipeline.ts` cannot be meaningfully tested without a live broker responding over the socket.
- **Schema cleanup last:** The `llm_jobs` table is required by the direct-mode fallback path during Phases 1–3. Dropping it before broker validation is a silent data-loss risk.
- **Stats/status last:** Non-critical visibility feature; depends on broker being operational and token stats being written.

### Research Flags

Phases needing deeper `/gsd:research-phase` during planning:
- None. All four research files report HIGH confidence backed by official Node.js docs and direct codebase audit of all affected source files. Patterns are fully established.

Phases with standard patterns (skip additional research):
- **All 5 phases:** Node.js `net`, `readline`, esbuild multi-entry, and the broker IPC pattern are exhaustively documented. The shared-code safety tiers (Tier 1–4) are explicitly mapped in ARCHITECTURE.md.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All capabilities verified against Node.js 22 official docs; esbuild docs; live codebase inspection; zero new dependencies confirmed |
| Features | HIGH | Existing codebase audited directly; prior Phase 16 plan reviewed; broker IPC pattern literature reviewed; anti-features argued from first principles |
| Architecture | HIGH | Every affected source file inspected; module boundary constraints (Tier 1–4) defined and verified; shared-code safety justified per module |
| Pitfalls | HIGH | All 12 pitfalls sourced from official Node.js docs or direct codebase audit; prevention patterns include runnable TypeScript; "Looks Done But Isn't" checklist provided |

**Overall confidence:** HIGH

### Gaps to Address

- **`llm_jobs` retention timing during fallback (Phase 4 boundary):** Architecture research flags this explicitly: keep `llm_jobs` for fallback in Phases 1–3, drop only after broker mode is validated. The plan should be explicit about which coordinator `init()` migration to apply and when. Not a research gap — just a sequencing decision that must be documented in the Phase 4 plan.

- **Broker config loading path:** Architecture notes the broker loads LLM config from `~/.filescope/broker-config.json` or falls back to a local `config.json`. The shared-config path and config schema for the broker process need to be defined at the start of Phase 2. Low risk — `LLMConfig` / `LLMConfigSchema` already exist in `types.ts` and the broker reuses them unchanged.

- **Priority aging threshold:** Pitfalls research suggests +1 importance per 5 minutes waiting, capped at 10. This constant should be validated against real session behavior rather than treated as fixed. Expose it in broker config rather than hardcoding.

---

## Sources

### Primary (HIGH confidence)
- Node.js v22 `node:net` documentation — `createServer`, `createConnection`, socket path IPC, `server.close()` behavior, `EADDRINUSE`, backpressure
- Node.js `readline` documentation — `createInterface({ input })`, `line` event, `crlfDelay: Infinity`
- Node.js Backpressuring in Streams — `drain` event, `socket.write()` return value
- esbuild API documentation — multiple entry points, `--bundle`, `--external`, `--outdir`
- Direct codebase audit: `src/coordinator.ts`, `src/llm/pipeline.ts`, `src/llm/adapter.ts`, `src/llm/prompts.ts`, `src/llm/types.ts`, `src/llm/rate-limiter.ts`, `src/cascade/cascade-engine.ts`, `src/change-detector/llm-diff-fallback.ts`, `src/db/repository.ts`, `src/db/schema.ts`, `package.json`
- `.planning/PROJECT.md` — v1.2 milestone requirements and key decisions
- `.planning/phases/16-shared-llm-queue/PLAN.md` — prior shared-SQLite-queue design (superseded by broker pattern)
- Snyk advisory CVE-2022-23812 — `node-ipc` supply chain incident

### Secondary (MEDIUM confidence)
- nodevibe.substack.com — Unix domain socket ~50% latency advantage over TCP loopback; PM2 UDS pattern
- HuggingFace TNG: Efficient Request Queueing for LLM Performance — broker pattern, priority vs round-robin trade-offs
- Aging (scheduling) — Wikipedia — aging mechanism, +1 per wait threshold definition
- starvation-free-priority-queue GitHub — aging function reference implementation
- esbuild issue #2303 — module dedup and code splitting constraints in ESM-only builds
- Apache Kafka KIP-144 — exponential backoff with jitter, max cap, reset on success
- socket.io reconnect discussion — backoff state not resetting on reconnect as a known bug class

---

*Research completed: 2026-03-21*
*Ready for roadmap: yes*
