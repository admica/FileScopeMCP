# Feature Research

**Domain:** Local IPC job broker for multi-instance LLM coordination — FileScopeMCP v1.2
**Researched:** 2026-03-21
**Confidence:** HIGH (existing codebase audit + IPC/broker pattern research + Node.js net module docs)

---

## Context

This is a SUBSEQUENT MILESTONE research document. FileScopeMCP v1.0 + v1.1 already ship: LLM pipeline (dequeue loop, job execution, result writing), multi-provider adapter (Ollama via openai-compatible, Anthropic), structured output with JSON repair fallback, TokenBudgetGuard rate limiting, per-repo SQLite job queue with priority tiers and dedup, cascade engine, and file importance scoring (0–10).

v1.2 adds a **standalone broker process** that centralizes all Ollama communication. Multiple FileScopeMCP instances (one per repo) connect to the broker via Unix domain socket. The broker holds the only Ollama connection and orders work by file importance across all repos. Each instance falls back to calling Ollama directly when the broker is unavailable.

The question is: **what features are table stakes for this kind of local IPC job broker, what are differentiators, and what should be skipped?**

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that any local IPC job broker must have. Missing these makes the system unreliable or unusable.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Unix domain socket server at well-known path | Any process broker must have a stable address; UDS avoids port conflicts and is 50% lower latency than TCP loopback; PM2 and other Node.js process managers use this exact pattern | LOW | `net.createServer()` + `server.listen('~/.filescope/broker.sock')`; Node.js `net` module handles this natively; unlink stale socket file on startup before binding |
| Newline-delimited JSON (NDJSON) message framing | TCP/UDS is a byte stream; JSON objects must be delimited; NDJSON is the established convention (no embedded newlines, `\n` as separator); used by Language Server Protocol, node-ipc, and most local RPC protocols | LOW | Each message is compact JSON + `\n`; accumulate incoming bytes until `\n`, then `JSON.parse`; straightforward buffer-splitting loop in the `data` handler |
| In-memory priority queue ordered by importance DESC, created_at ASC | The core value proposition: high-importance files process before low-importance ones across all repos; without this, instances still compete round-robin | MEDIUM | Binary max-heap (O(log n) insert and dequeue); no npm library needed — ~60 lines of TypeScript; importance 0–10 as primary key, creation timestamp as tiebreaker; queue holds `BrokerJob` objects referencing the submitting socket |
| Job dedup: one pending job per (file_path, job_type) per repo | Without dedup, a repo with rapidly changing files floods the queue with redundant work; same dedup contract as the v1.0 local queue; insert-time dedup is the right place to enforce this | LOW | On `submit`, check if an identical pending job already exists in the heap (same `repoPath + filePath + jobType`); if yes, replace its payload and refresh the creation timestamp (latest content wins); if no, insert new job |
| Job timeout: cancel hung Ollama calls after 120s | Ollama can hang indefinitely on malformed input or GPU memory pressure; without a timeout the broker becomes permanently blocked | LOW | `AbortController` + `setTimeout(120_000)` wrapping the Ollama call via Vercel AI SDK; on timeout: abort the signal, respond to the submitting instance with `status: 'timeout'`, move to next job |
| Graceful shutdown: reset in-progress job, drain connections cleanly | On SIGTERM the broker must not leave an in-progress job orphaned or leave instance connections abruptly closed | LOW | SIGTERM handler: mark current in-progress job as failed (respond to submitting instance), close the server (stops new connections), allow existing connections to drain with a short timeout, then exit |
| PID file at `~/.filescope/broker.pid` | Standard single-instance guard pattern; prevents two broker processes from racing; also lets instances check if broker is alive before connecting | LOW | Write `process.pid` to `~/.filescope/broker.pid` on startup; delete on clean shutdown; if PID file exists at startup: send signal 0 to PID — if process is live, log conflict and exit; if process is dead, remove stale PID file and continue |
| Stale socket cleanup on startup | If the broker crashed, the socket file remains on disk; attempting to bind over it fails with EADDRINUSE | LOW | On startup: if `broker.sock` exists, attempt to `connect` to it; if connection refused → socket is stale, unlink it; if connection succeeds → another broker is running, log conflict and exit |
| Instance-side client: submit jobs, receive results asynchronously | Instances need a client that submits a `BrokerJob` and resolves a promise when the broker responds with the result or an error | MEDIUM | Client maintains a persistent connection; sends `submit` message, awaits a response tagged by `jobId`; in-flight map: `Map<jobId, { resolve, reject }>` keyed by `jobId` to correlate responses with pending promises |
| Graceful degradation: direct Ollama mode when broker unavailable | Zero-config for single-repo users; if broker is not running, instances must fall back to calling Ollama directly without user intervention | LOW | Client `connect()` catches `ENOENT` (no socket file) and `ECONNREFUSED` (socket exists but no listener); on either error: set `brokerAvailable = false`; pipeline falls through to existing `LLMPipeline` direct mode; no user-visible failure |
| Auto-reconnect with backoff on broker disconnect | Network-adjacent: if the broker restarts mid-session, instances must reconnect without user action; without this, all instances stop processing LLM jobs until manually restarted | LOW | On `close` or `error` event: exponential backoff starting at 1s, doubling to max 30s; jitter ±20% to avoid thundering herd when broker restarts; reset backoff timer on successful reconnect; cap retry count at ~20 before giving up and switching to direct mode |

### Differentiators (Competitive Advantage)

Features that go beyond the minimum contract and make the broker meaningfully better.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Cross-repo importance ordering (not per-repo round-robin) | The core reason for having a broker at all; without this, instances queue independently and a low-importance repo blocks a high-importance repo's urgent work | LOW | The heap compares by `importance DESC, created_at ASC` across all submitted jobs regardless of `repoPath`; this is already the heap sort key — the differentiator is ensuring the heap is global, not per-instance |
| Startup resubmission batching (top N by importance) | On instance startup, there may be many stale/pending jobs queued from before the last shutdown; submitting all of them immediately floods the broker queue with low-importance work that blocks current interactive work | LOW | On startup: load pending work from local state, sort by importance DESC, submit only the top N (e.g., 10) immediately; submit remaining lazily as the queue drains; "top N" is configurable in config.json |
| Token stats persistence across sessions | Users want to see how much GPU work the system is doing over time; the stats table in shared queue (Phase 16 design) already tracks this per-repo | LOW | Broker maintains a running stats counter per `repoPath`; on job completion, increment `lifetime_tokens_used` for that repo; persist stats to `~/.filescope/stats.json` on graceful shutdown; load on startup; expose via `get_llm_status` MCP tool |
| `get_llm_status` MCP tool reports broker mode | Operators need to know if the instance is in broker mode or direct mode, what the queue depth is, and what's currently in-progress | LOW | Tool reports: `mode: 'broker' | 'direct'`, `brokerConnected: boolean`, `pendingJobs: number` (per this repo), `inProgressJob: { filePath, jobType } | null`, `lifetimeTokensUsed: number` (per repo from stats); no schema change needed |
| Job cancellation when file is deleted before processing | If a file is deleted after its job is queued but before the broker processes it, the broker will fail to read it and retry unnecessarily | LOW | Broker checks `fs.stat(filePath)` before dispatching the job to Ollama; if `ENOENT`: respond with `status: 'cancelled'` + `reason: 'file_deleted'`; instance side marks the job done and calls `clearStaleness`; this is the same pattern as the existing `readFileOrFail` in pipeline.ts |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| HTTP/REST API instead of Unix socket | "HTTP is more debuggable and standard" | HTTP adds TCP port management, potential external exposure, header parsing overhead, and content-length framing complexity; for a local-only tool running inside a single machine, Unix domain sockets are strictly better: ~50% lower latency, no port conflict risk, filesystem-level access control | Use Unix socket + NDJSON; for debugging, log all messages at DEBUG level; add a `broker-status` CLI subcommand that connects and dumps status |
| Multi-worker broker (concurrent Ollama calls) | "More throughput with parallel GPU workers" | The single 16GB VRAM GPU cannot benefit from concurrent Ollama calls — they serialize at the GPU driver level anyway; multiple workers add locking complexity with zero throughput gain on this hardware | One worker; design documents that the architecture supports N workers when multi-GPU is added, but do not build it now |
| Broker-side prompt building (moving prompts out of instances) | "Centralizes LLM interaction, avoids Zod schema serialization across IPC" | **This is already in scope per PROJECT.md** — broker builds prompts, removing the need to serialize Zod schemas across the socket boundary; the broker receives `{ filePath, jobType, payload?, fileContent }` and calls `buildSummaryPrompt` etc. locally | Build as designed: broker owns prompt construction and Ollama interaction; instances submit jobs with raw file content, not with serialized prompt strings |
| Persistent job queue (SQLite in broker) | "Jobs should survive broker restart" | The broker is a transient coordinator, not a database; jobs are transient work derived from file changes that will re-trigger if needed; a SQLite queue adds open-file contention with instance DBs, adds schema migration concerns for the broker itself; in-memory queue is the correct model for a process broker | In-memory queue; instances resubmit stale jobs on reconnect (startup resubmission batching covers this) |
| Formal protocol versioning / handshake | "Instances and broker might be at different versions" | Premature complexity for a local tool used by a single developer; all processes are updated together; if a mismatch occurs, the error will be obvious (JSON parse error or unknown message type); a versioned handshake requires both sides to maintain version negotiation forever | Log unknown message types and ignore gracefully; add a TODO comment noting where version negotiation would go; defer to v1.3 |
| Broker hot-reload of config / model | "Change the Ollama model without restarting the broker" | Broker is a background daemon; restarting it takes < 1 second and instances auto-reconnect; hot-reload adds live mutation of the Ollama client object, which is hard to test correctly | Restart broker to change config; document this clearly |
| Rate limiting / throttling in the broker | "Prevent overloading Ollama" | The single-worker design already serializes all Ollama calls; there is no concurrency to throttle; the removed `TokenBudgetGuard` gating was the only consumer of rate limiting; keeping stats-only token counting is sufficient | Serialize via single worker; track token stats for monitoring; do not gate |

---

## Feature Dependencies

```
[Broker process: Unix socket server]
    └──requires──> [PID file guard]
    └──requires──> [Stale socket cleanup on startup]
    └──requires──> [In-memory priority heap]
    └──requires──> [NDJSON message framing / protocol]

[In-memory priority heap]
    └──requires──> [Binary max-heap (importance DESC, created_at ASC)]
    └──requires──> [Job dedup on submit]

[Broker processes jobs]
    └──requires──> [Job timeout (AbortController, 120s)]
    └──requires──> [Broker builds prompts] (removes Zod serialization from IPC)
    └──requires──> [File existence check before dispatch]
    └──requires──> [Response routing back to submitting instance socket]

[Instance-side broker client]
    └──requires──> [Connect to broker.sock]
    └──requires──> [In-flight job map (jobId → resolve/reject)]
    └──requires──> [NDJSON framing (same protocol as server)]
    └──enhances──> [Auto-reconnect with backoff]

[Graceful degradation]
    └──requires──> [Client connect failure detection (ENOENT, ECONNREFUSED)]
    └──requires──> [Direct Ollama mode (existing LLMPipeline)]
    └──conflicts──> [Remove existing LLMPipeline] (must keep for fallback)

[Auto-reconnect]
    └──requires──> [socket close / error handler]
    └──requires──> [Exponential backoff with jitter]
    └──enhances──> [Graceful degradation: reset mode on reconnect]

[Token stats persistence]
    └──requires──> [Stats counter per repoPath in broker]
    └──requires──> [~/.filescope/stats.json read/write]
    └──enhances──> [get_llm_status MCP tool]

[Startup resubmission batching]
    └──requires──> [Instance-side broker client connected]
    └──requires──> [Local DB: query top N pending stale jobs by importance]
    └──requires──> [Remove legacy llm_jobs table from local DB]

[Remove legacy local job queue]
    └──requires──> [Shared queue or broker mode fully operational]
    └──conflicts──> [Graceful degradation path still uses direct LLMPipeline]
    NOTE: llm_jobs removal is separate from direct-mode LLMPipeline; direct mode
          uses a fresh in-memory queue, not the old SQLite llm_jobs table
```

### Dependency Notes

- **Broker must be built before client:** The Unix socket server (broker) must exist before the instance-side client can be tested against it. Build the broker binary first, then integrate the client.
- **Graceful degradation requires LLMPipeline to remain:** The existing `LLMPipeline` class stays intact for direct mode. It is not removed as part of v1.2 — it is wrapped by the broker client so instances use it when the broker is unavailable.
- **Broker builds prompts removes Zod schema serialization concern:** The broker imports `buildSummaryPrompt`, `buildConceptsPrompt`, `buildChangeImpactPrompt` directly. Instances send `fileContent` as a string in the job payload. This eliminates the need to serialize Zod schemas across the socket boundary.
- **Job dedup is per (repoPath, filePath, jobType):** The scope must include `repoPath` because the same `filePath` can exist in two different repos. The heap dedup key is the triplet, not just `filePath + jobType`.
- **Stale socket cleanup requires checking both socket and PID:** If the socket file exists but the PID file does not (or PID is dead), the socket is stale. If both exist and the PID is live, another broker is running — this instance should exit with an error message.

---

## MVP Definition (v1.2)

### Launch With (v1.2)

- [ ] Standalone broker binary: Unix socket server, in-memory heap, NDJSON protocol — the core broker
- [ ] Job dedup (repoPath + filePath + jobType), 120s timeout, file-deleted cancellation — correctness guarantees
- [ ] PID file guard + stale socket cleanup — prevents dual-broker split-brain
- [ ] Broker builds prompts + calls Ollama + routes result back to submitting instance socket — full job lifecycle
- [ ] Instance-side broker client: connect, submit, receive result, in-flight map — instances work through broker
- [ ] Graceful degradation: ENOENT/ECONNREFUSED → direct Ollama mode via existing LLMPipeline — zero-config for single-repo users
- [ ] Auto-reconnect with exponential backoff + jitter — session resilience
- [ ] Startup resubmission batching (top N by importance) — prevents queue flooding on restart
- [ ] Token stats persistence at `~/.filescope/stats.json` — cross-session visibility
- [ ] `get_llm_status` reports broker mode + queue depth + in-progress job — operator visibility
- [ ] Remove legacy `llm_jobs` and `llm_runtime_state` tables from local DB — clean up Phase 16 artifacts
- [ ] Remove `TokenBudgetGuard` budget gating (keep stats counter) — no token budget for local LLM

### Add After Validation (v1.3+)

- [ ] Formal protocol version handshake — only needed if broker and instances can be at different versions (not the case today)
- [ ] Multi-worker support — only if multi-GPU hardware is added; design already supports it via worker pool abstraction
- [ ] Broker CLI (`filescope broker start|stop|status`) — quality-of-life; current flow is sufficient for development use

### Future Consideration (v2+)

- [ ] Broker-as-service with systemd unit file — deploy scenario; not needed for development use case
- [ ] Cross-machine broker (TCP transport) — out of scope; local-only tool
- [ ] Per-repo priority boosting for active Claude session — complex scheduling; file importance is sufficient for now

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Broker process + Unix socket server | HIGH | MEDIUM | P1 |
| In-memory heap (importance-ordered) | HIGH | LOW | P1 |
| NDJSON framing protocol | HIGH | LOW | P1 |
| PID file guard + stale socket cleanup | HIGH | LOW | P1 |
| Job dedup (repoPath + filePath + jobType) | HIGH | LOW | P1 |
| Job timeout 120s (AbortController) | HIGH | LOW | P1 |
| Broker builds prompts + calls Ollama | HIGH | LOW | P1 |
| Instance-side broker client + in-flight map | HIGH | MEDIUM | P1 |
| Graceful degradation (direct mode fallback) | HIGH | LOW | P1 |
| Auto-reconnect with exponential backoff | HIGH | LOW | P1 |
| Startup resubmission batching | MEDIUM | LOW | P1 |
| Graceful shutdown (drain + reset in-progress) | MEDIUM | LOW | P1 |
| Remove legacy llm_jobs / llm_runtime_state | MEDIUM | LOW | P1 |
| Remove TokenBudgetGuard gating | MEDIUM | LOW | P1 |
| Token stats persistence (stats.json) | MEDIUM | LOW | P2 |
| `get_llm_status` broker reporting | MEDIUM | LOW | P2 |
| File-deleted cancellation before dispatch | LOW | LOW | P2 |
| Formal protocol versioning | LOW | MEDIUM | P3 |
| Multi-worker support | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for v1.2 launch
- P2: Should have, add when possible within v1.2
- P3: Defer to future milestone

---

## Protocol Design Notes

### Message Types (Broker ↔ Instance)

Instance → Broker:
```json
{ "type": "submit", "jobId": "uuid", "repoPath": "/home/user/repo", "filePath": "/abs/path", "jobType": "summary|concepts|change_impact", "importance": 7, "fileContent": "...", "payload": "..." }
```

Broker → Instance:
```json
{ "type": "result", "jobId": "uuid", "status": "ok|error|timeout|cancelled", "text": "...", "totalTokens": 512 }
```

Each message is one line (compact JSON + `\n`). No other framing is needed.

### Why No JSON-RPC 2.0

JSON-RPC 2.0 adds `jsonrpc: "2.0"` fields, error code conventions, and batch request semantics. None of these are needed for a two-message-type protocol between controlled processes. Using JSON-RPC would add parsing overhead and a dependency (or hand-rolled implementation) for no practical benefit. NDJSON with explicit `type` fields is sufficient.

### In-Flight Map Correlation

The instance client generates a UUID `jobId` per submission. The broker echoes `jobId` back in its response. The client maintains `Map<string, { resolve, reject }>`. On `result` message: look up `jobId`, call `resolve(text)` or `reject(error)`. Pending entries are cleaned up on broker disconnect (reject all with `BrokerDisconnectedError`, triggering fallback to direct mode for any pipeline loop still waiting).

---

## Dependency on Existing Components

| Existing Component | How v1.2 Uses It |
|-------------------|-----------------|
| `src/llm/adapter.ts` | Broker imports and calls `createLLMModel()` to get the Ollama `LanguageModel` object — unchanged |
| `src/llm/prompts.ts` | Broker imports `buildSummaryPrompt`, `buildConceptsPrompt`, `buildChangeImpactPrompt` — unchanged |
| `src/llm/types.ts` | `ConceptsSchema`, `ChangeImpactSchema` used by broker for structured output — unchanged |
| `src/llm/rate-limiter.ts` | Simplified to stats-only counter (already planned in Phase 16); broker uses the counter for token tracking |
| `src/llm/pipeline.ts` | Retained as direct mode fallback; `LLMPipeline` is wrapped, not replaced; instances use it when broker unavailable |
| `src/db/repository.ts` | `writeLlmResult()`, `clearStaleness()` still called by instances on receiving broker results — unchanged |
| `src/coordinator.ts` | Wires broker client lifecycle: connect on init, disconnect on shutdown; submits jobs via client instead of local queue |
| `src/cascade/cascade-engine.ts` | Calls `submitToBroker()` instead of `insertLlmJobIfNotPending()` — swap call site only |
| `src/change-detector/llm-diff-fallback.ts` | Same swap as cascade engine |

---

## Sources

- [Node.js net module documentation](https://nodejs.org/api/net.html) — Unix domain socket server/client API, `socket.setTimeout()`, `unref()`, EADDRINUSE handling
- [The Node.js Developer's Guide to Unix Domain Sockets](https://nodevibe.substack.com/p/the-nodejs-developers-guide-to-unix) — 50% latency advantage over TCP loopback confirmed; PM2 UDS pattern
- [JSON streaming — Wikipedia](https://en.wikipedia.org/wiki/JSON_streaming) — NDJSON framing rationale; newline as safe delimiter because JSON primitives escape `\n`
- [HuggingFace TNG: Efficient Request Queueing for LLM Performance](https://huggingface.co/blog/tngtech/llm-performance-request-queueing) — per-user queue + broker pattern to prevent FIFO starvation; round-robin vs priority trade-offs
- [GitHub: heap-js](https://github.com/ignlg/heap-js) — binary heap with TypeScript, custom comparators; `heap-js` as reference if a library is preferred
- [Binary Heaps in JavaScript — DigitalOcean](https://www.digitalocean.com/community/tutorials/js-binary-heaps) — O(log n) insert/dequeue confirmed; array-based implementation pattern
- [KIP-144: Exponential backoff for broker reconnect — Apache Kafka](https://cwiki.apache.org/confluence/display/KAFKA/KIP-144:+Exponential+backoff+for+broker+reconnect+attempts) — exponential backoff with jitter, max cap, reset on success
- [socket.io exponential backoff discussion](https://github.com/socketio/socket.io/discussions/4322) — backoff state not resetting on reconnect is a known bug pattern to avoid
- [daemon-pid npm](https://www.npmjs.com/package/daemon-pid) — PID file management with start-time verification to guard against PID reuse
- [beads socket path and configuration — DeepWiki](https://deepwiki.com/steveyegge/beads/6.4-socket-path-and-configuration) — flock-based daemon lock as authoritative single-instance guard; stale PID file cleanup pattern
- [Graceful shutdown in Node.js — OneUptime](https://oneuptime.com/blog/post/2026-01-06-nodejs-graceful-shutdown-handler/view) — SIGTERM drain pattern with connection timeout guard
- Existing codebase audit: `src/llm/pipeline.ts`, `src/llm/types.ts`, `src/llm/rate-limiter.ts`, `src/coordinator.ts`, `.planning/phases/16-shared-llm-queue/PLAN.md`, `.planning/PROJECT.md`

---
*Feature research for: FileScopeMCP v1.2 LLM Broker*
*Researched: 2026-03-21*
