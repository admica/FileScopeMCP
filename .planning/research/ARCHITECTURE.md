# Architecture Research

**Domain:** LLM Broker — standalone broker process integrated into FileScopeMCP v1.2
**Researched:** 2026-03-21
**Confidence:** HIGH (direct codebase audit of all affected source files)

---

## Context: What Ships Today (v1.1 Baseline)

Reading the live code establishes the precise integration surface. Key facts:

- `ServerCoordinator` (coordinator.ts) owns the full lifecycle: DB open, FileWatcher, LLMPipeline start/stop, PID guard.
- `LLMPipeline` (llm/pipeline.ts) polls `llm_jobs` in the local `.filescope.db` via `dequeueNextJob()`. It holds the `LanguageModel` instance (from `adapter.ts`) and `TokenBudgetGuard` (rate-limiter.ts).
- `adapter.ts` calls `createAnthropic` or `createOpenAICompatible` from the Vercel AI SDK. Returns a `LanguageModel`.
- `prompts.ts` builds string prompts for `summary`, `concepts`, and `change_impact` job types.
- `types.ts` (llm/types.ts) holds `LLMConfig`, `LLMConfigSchema`, `ConceptsSchema`, `ChangeImpactSchema`.
- `cascade-engine.ts` and `llm-diff-fallback.ts` call `insertLlmJobIfNotPending()` from `db/repository.ts` to enqueue jobs into the local `llm_jobs` table.
- `coordinator.ts` calls `isLlmBudgetExhausted()` which delegates to `TokenBudgetGuard.isExhausted()` — this `isExhausted` callback is threaded into `cascadeStale` and `markSelfStale` as a circuit breaker.
- esbuild bundles everything via a single entry point list into `dist/`. There is no separate entry point today.
- Build command: `esbuild src/...all files... --format=esm --target=es2020 --outdir=dist --platform=node`

---

## System Overview — v1.2 Broker Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  INSTANCE PROCESSES  (one per repo, same as today)                               │
│                                                                                   │
│  ┌──────────────────────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Coordinator (repo A)             │  │  Coordinator (repo B)                 │  │
│  │  FileWatcher, scan, MCP tools     │  │  FileWatcher, scan, MCP tools         │  │
│  │                                   │  │                                       │  │
│  │  cascade-engine.ts                │  │  cascade-engine.ts                    │  │
│  │  llm-diff-fallback.ts             │  │  llm-diff-fallback.ts                 │  │
│  │       │ submitJob()               │  │       │ submitJob()                   │  │
│  │       ▼                           │  │       ▼                               │  │
│  │  broker-client.ts ──────────────► │  │  broker-client.ts ──────────────────► │  │
│  │  (reconnect, dedup, fallback)     │  │  (reconnect, dedup, fallback)         │  │
│  └──────────────────────────────────┘  └──────────────────────────────────────┘  │
└─────────────────────────────────┬───────────────────────────────────────────────┘
                                   │  Unix domain socket: ~/.filescope/broker.sock
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│  BROKER PROCESS  (src/broker/main.ts → dist/broker.js)                           │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Socket Server (net.createServer)                                        │    │
│  │  Accepts connections from instances                                      │    │
│  │  Protocol: newline-delimited JSON                                        │    │
│  └────────────────────────────────┬────────────────────────────────────────┘    │
│                                    │                                              │
│  ┌─────────────────────────────────▼──────────────────────────────────────┐     │
│  │  In-Memory Priority Queue                                                │     │
│  │  Map<jobId, Job> sorted by (importance DESC, created_at ASC)            │     │
│  │  One pending job per (file_path + job_type + repo_path) — dedup at      │     │
│  │  insert time (latest content wins)                                       │     │
│  └─────────────────────────────────┬──────────────────────────────────────┘     │
│                                    │                                              │
│  ┌─────────────────────────────────▼──────────────────────────────────────┐     │
│  │  Worker Loop (single, sequential)                                        │     │
│  │  Dequeues highest-importance pending job                                 │     │
│  │  Reads file content (fs.readFile)                                        │     │
│  │  Builds prompt (prompts.ts — shared code)                                │     │
│  │  Calls Ollama (adapter.ts — shared code)                                 │     │
│  │  Sends result back to instance via socket                                │     │
│  │  Job timeout: 120s (in-flight Ollama call)                               │     │
│  └─────────────────────────────────┬──────────────────────────────────────┘     │
│                                    │                                              │
│  ┌─────────────────────────────────▼──────────────────────────────────────┐     │
│  │  Token Stats (~/.filescope/stats.json)                                   │     │
│  │  Per-repo lifetime token usage, written after each job                   │     │
│  └─────────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
                          ┌──────────────────┐
                          │  Ollama (GPU)     │
                          │  Single process   │
                          │  Single GPU       │
                          └──────────────────┘
```

---

## Component Boundaries: New vs Modified

### New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `broker/main.ts` | `src/broker/main.ts` → `dist/broker.js` | Broker process entry point. Starts socket server, worker loop, signal handlers. Loads LLM config from `~/.filescope/broker-config.json` or falls back to local `config.json`. |
| `broker/server.ts` | `src/broker/server.ts` | Socket server using Node.js `net` module. Accepts connections from instances, parses newline-delimited JSON messages, dispatches `submit`, `cancel`, `status` requests. |
| `broker/queue.ts` | `src/broker/queue.ts` | In-memory priority queue. Holds `Map<jobId, PendingJob>`. Dedup logic: if a pending job exists for same `(file_path, job_type, repo_path)`, replace its payload and reset created_at (latest content wins). Priority: importance DESC, created_at ASC. |
| `broker/worker.ts` | `src/broker/worker.ts` | Sequential worker loop. Polls the queue, claims one job, reads file content, calls adapter/prompts (shared code), sends result to the waiting instance connection, updates token stats. |
| `llm/broker-client.ts` | `src/llm/broker-client.ts` | Instance-side client. Connects to `~/.filescope/broker.sock`. Exposes `submitJob(job): Promise<JobResult>`. Handles: reconnection with exponential backoff, timeout, graceful degradation to direct mode if broker is not available. |

### Modified Components

| Component | File | What Changes |
|-----------|------|-------------|
| `pipeline.ts` | `src/llm/pipeline.ts` | Dual-mode: if `BrokerClient.isConnected()` then submit job to broker and await result; else fall through to direct Ollama (existing behavior). The dequeue loop becomes a broker-response listener or stays as polling in direct mode. Remove `TokenBudgetGuard` gating. |
| `cascade-engine.ts` | `src/cascade/cascade-engine.ts` | Replace `insertLlmJobIfNotPending(filePath, type, tier)` with `submitJob(filePath, type, payload)`. Remove `isExhausted` parameter from `cascadeStale` and `markSelfStale`. |
| `llm-diff-fallback.ts` | `src/change-detector/llm-diff-fallback.ts` | Replace `insertLlmJobIfNotPending` with `submitJob`. |
| `coordinator.ts` | `src/coordinator.ts` | Wire `BrokerClient` lifecycle: connect on init, disconnect on shutdown. Remove budget guard persistence. Remove `isLlmBudgetExhausted()` / `getLlmLifetimeTokensUsed()` methods that feed into cascade. |
| `db/repository.ts` | `src/db/repository.ts` | Remove: `insertLlmJob`, `insertLlmJobIfNotPending`, `dequeueNextJob`, `markJobInProgress`, `markJobDone`, `markJobFailed`, `recoverOrphanedJobs`, `loadLlmRuntimeState`, `saveLlmRuntimeState`. Retain: `writeLlmResult`, `clearStaleness`, `markStale`. |
| `db/schema.ts` | `src/db/schema.ts` | Remove `llm_jobs` and `llm_runtime_state` table definitions. Coordinator drops them at init. |
| `mcp-server.ts` | `src/mcp-server.ts` | Update `get_llm_status` tool to read broker status via `BrokerClient.getStatus()` (pending count, in_progress, per-repo token stats). |
| `rate-limiter.ts` | `src/llm/rate-limiter.ts` | Simplify to a stats-only token counter. Remove `canConsume()`, `isExhausted()`, `exhausted` circuit-breaker flag. Keep `recordActual()`, `getLifetimeTokensUsed()`. Broker has no per-instance rate limiting. |
| `esbuild command` | `package.json` | Add `src/broker/main.ts` as a second entry point. Output: `dist/broker.js`. |

### Unchanged Components

| Component | Why Unchanged |
|-----------|--------------|
| `adapter.ts` | Shared by both broker and instances. Broker imports it directly. No changes needed — it is already provider-agnostic. |
| `prompts.ts` | Shared by broker. Broker builds prompts for all three job types. Pure functions, no state. No changes. |
| `llm/types.ts` | `LLMConfig`, `ConceptsSchema`, `ChangeImpactSchema` are shared. Broker reads `LLMConfig` from a config file; instances no longer use it for pipeline construction. |
| `cascade-engine.ts` BFS logic | The BFS walk, `visited` Set, depth cap, and `buildDependentPayload` all stay. Only the job insertion call changes (`submitJob` instead of `insertLlmJobIfNotPending`). |
| `writeLlmResult`, `clearStaleness`, `markStale` | These write results back to the local `.filescope.db`. The broker sends result text over the socket; the instance's pipeline receives it and calls these functions as before. |
| FileWatcher, scan, dependency parsing | Entirely unaffected by the broker. |
| MCP tool surface (all tools except `get_llm_status`) | No changes. |

---

## Shared Code Strategy

The critical question: which modules can be safely imported by both the broker process (`dist/broker.js`) and instance processes (`dist/mcp-server.js`, `dist/coordinator.js`) without creating circular dependencies or inappropriate coupling?

### Tier 1: Safe to share — pure functions, no process state

| Module | Shared By | Notes |
|--------|-----------|-------|
| `llm/adapter.ts` | Broker (creates `LanguageModel`), instances (if direct fallback) | Pure factory function. Creates a new `LanguageModel` per call. No singleton, no module-level state beyond imports. Safe. |
| `llm/prompts.ts` | Broker (builds prompts for all job types) | Pure string-builder functions. No imports from other project modules. No state. Trivially safe. |
| `llm/types.ts` | Broker reads `LLMConfig`; instances pass job type strings | Type definitions and Zod schemas. No runtime state. Safe. |
| `types.ts` | Both use `FileNode` etc. | Type definitions. No runtime state. Safe. |
| `logger.ts` | Both write to stderr | Stateless function. Both processes use separate stderr streams. Safe. |

### Tier 2: Safe to share — but broker reads, instances write

| Module | Used By Broker | Used By Instances | Risk |
|--------|---------------|-------------------|------|
| `db/repository.ts` | Broker does NOT import it | Instances write results via `writeLlmResult`, `clearStaleness` | No risk — broker has no SQLite dependency at all. Broker speaks over the socket, not to the DB. |

### Tier 3: Instance-only — must NOT be imported by broker

| Module | Reason |
|--------|--------|
| `db/db.ts`, `db/repository.ts`, `db/schema.ts` | Broker has no local `.filescope.db`. Would create a spurious DB connection. |
| `coordinator.ts` | Orchestrates instance lifecycle. Broker has its own simpler lifecycle. |
| `mcp-server.ts` | MCP transport is instance-only. |
| `file-utils.ts`, `file-watcher.ts` | File system monitoring is instance-only. |
| `cascade/cascade-engine.ts` | Staleness propagation is instance-only. |

### Tier 4: Broker-only — must NOT be imported by instances (except broker-client.ts)

| Module | Reason |
|--------|--------|
| `broker/server.ts` | Socket server. Instances only need the client. |
| `broker/queue.ts` | In-memory queue lives in the broker process. |
| `broker/worker.ts` | Worker loop runs in broker. |

**Key constraint:** `broker-client.ts` is the only broker-related module that instances import. It has no dependency on any broker-side modules. Circular dependency risk is zero by this design.

---

## IPC Protocol

The broker uses a Unix domain socket (`~/.filescope/broker.sock`) with newline-delimited JSON framing. This is the simplest possible wire format for Node.js `net.Socket` and avoids HTTP overhead.

### Message Types (instance → broker)

```typescript
// Submit a job
{ type: 'submit', jobId: string, repoPath: string, filePath: string, jobType: 'summary'|'concepts'|'change_impact', importance: number, payload?: string }

// Cancel a pending job (e.g., file deleted before processing)
{ type: 'cancel', jobId: string }

// Query broker status
{ type: 'status' }
```

### Message Types (broker → instance)

```typescript
// Job result (sent to the instance that submitted the job)
{ type: 'result', jobId: string, success: true, text: string, totalTokens: number }
{ type: 'result', jobId: string, success: false, error: string }

// Status response
{ type: 'status', pendingCount: number, inProgress: boolean, repoStats: Record<string, number> }
```

### Connection Lifecycle

- Instance connects to broker socket on coordinator init. If socket does not exist, broker is unavailable — fallback to direct mode.
- Connection is persistent. The broker associates each connection with the `repoPath` sent in the first `submit` message.
- If the connection drops (broker restart, crash), `broker-client.ts` retries with exponential backoff (1s, 2s, 4s... up to 30s cap).
- The broker does NOT attempt to reconnect to instances — instances reconnect.

### Job Timeout

Broker starts a 120s timer when a job goes `in_progress`. If Ollama does not respond within 120s, the broker cancels the job, sends `{ type: 'result', success: false, error: 'timeout' }` to the waiting instance, and continues to the next job.

---

## Dual-Mode Pipeline (broker vs direct)

`pipeline.ts` supports two modes. The mode is determined at runtime by whether `BrokerClient.isConnected()` returns true.

### Broker Mode (primary)

```
cascade-engine / llm-diff-fallback
  → submitJob(filePath, jobType, payload)  [broker-client.ts]
  → socket message to broker
  → broker reads file, builds prompt, calls Ollama
  → broker sends result back via socket
  → pipeline receives result
  → writeLlmResult(filePath, jobType, text)  [repository.ts]
  → clearStaleness(filePath, jobType)
```

The pipeline's `dequeueLoop` is replaced by a response listener registered on `BrokerClient`. When a result arrives for a job the instance submitted, the callback runs `writeLlmResult` and `clearStaleness`. The instance never builds prompts or calls Ollama directly.

### Direct Mode (fallback when broker unavailable)

The existing dequeue loop is kept as-is. `dequeueNextJob()` polls the local `llm_jobs` table. If the broker is down or was never started, the instance processes jobs directly via `adapter.ts` + `prompts.ts`, exactly as in v1.1.

**Implementation note:** Direct fallback requires `llm_jobs` to still exist in local DB when the broker is unavailable. The schema removal only happens if the project explicitly drops the table (Phase plan must clarify: either keep the table for fallback, or accept that direct fallback only works before the table is dropped).

**Recommendation:** Keep the `llm_jobs` table and `insertLlmJobIfNotPending` for the fallback path in Phase 1. Drop them only after broker mode is validated in Phase 2.

---

## Build System Changes

Current esbuild command builds all source files into `dist/` as individual files (not a bundle). Adding the broker requires:

1. Adding `src/broker/main.ts` to the entry point list.
2. No structural change — esbuild handles multiple entry points in the same command.

```bash
# Add to existing esbuild command:
src/broker/main.ts src/broker/server.ts src/broker/queue.ts src/broker/worker.ts src/llm/broker-client.ts
```

`dist/broker.js` is the broker entry point. `dist/mcp-server.js` remains the instance entry point. Both reference the shared `dist/llm/adapter.js`, `dist/llm/prompts.js`, `dist/llm/types.js` as they already exist in `dist/`.

---

## Data Flow

### Job Submission Flow (broker mode)

```
[File change detected by FileWatcher]
     │
     ▼
[ChangeDetector.classify(filePath)]
     │
     ├─► [cascadeStale(filePath, opts)]  ← no isExhausted check
     │       │
     │       └─► submitJob(filePath, 'summary', importance)
     │           submitJob(filePath, 'concepts', importance)
     │           submitJob(filePath, 'change_impact', importance, payload)
     │                │
     │                └─► broker-client.ts
     │                         │ newline-delimited JSON over Unix socket
     │                         ▼
     │                    broker/server.ts
     │                         │
     │                         ▼
     │                    broker/queue.ts  ← dedup: one pending per file+type+repo
     │
     └─► [writeLlmResult / clearStaleness called on result callback]
```

### Job Processing Flow (broker)

```
[broker/worker.ts: dequeue loop]
     │
     ▼
[peek highest importance pending job from queue]
     │
     ▼
[fs.readFile(job.filePath)]
     │
     ▼
[prompts.buildSummaryPrompt / buildConceptsPrompt / buildChangeImpactPrompt]
     │
     ▼
[generateText({ model, prompt })]  ← via Vercel AI SDK, calls Ollama
     │
     ├─ success → { text, totalTokens }
     │   │
     │   ├─► send { type: 'result', jobId, success: true, text, totalTokens }
     │   │         back to the waiting instance connection
     │   │
     │   └─► updateStats(repoPath, totalTokens) → ~/.filescope/stats.json
     │
     └─ error/timeout → { type: 'result', jobId, success: false, error }
```

### Graceful Degradation Flow (broker unavailable)

```
[coordinator.init()]
     │
     ▼
[broker-client.connect('~/.filescope/broker.sock')]
     │
     ├─ socket exists, connection succeeds → broker mode
     │       pipeline.ts registers result listener
     │       cascade-engine calls submitJob → socket
     │
     └─ socket missing, ENOENT → direct mode
             pipeline.ts starts dequeueLoop (existing behavior)
             cascade-engine calls insertLlmJobIfNotPending (fallback)
```

---

## Startup / Discovery / Stale Socket Recovery

The broker writes its PID to `~/.filescope/broker.pid` on startup. On startup, the broker checks if the socket path exists and if the PID in the PID file corresponds to a live process. If the process is not alive, the broker deletes the stale socket and starts fresh.

Instances perform discovery identically: check if `broker.sock` exists, attempt `net.connect()`. If connect fails with `ECONNREFUSED` or `ENOENT`, the instance is in direct mode. The `broker-client.ts` retries on a timer so that if the broker starts after the instance, the instance will eventually connect and switch to broker mode.

---

## Recommended Project Structure

```
src/
├── broker/                 # Broker process (new)
│   ├── main.ts             # Entry point: starts server, worker, signal handlers
│   ├── server.ts           # Unix socket server, message dispatch
│   ├── queue.ts            # In-memory priority queue, dedup logic
│   └── worker.ts           # Sequential Ollama worker loop
├── llm/
│   ├── adapter.ts          # Shared: Vercel AI SDK LanguageModel factory
│   ├── broker-client.ts    # NEW: instance-side broker socket client
│   ├── pipeline.ts         # MODIFIED: dual-mode (broker vs direct)
│   ├── prompts.ts          # Shared: prompt builders for all job types
│   ├── rate-limiter.ts     # SIMPLIFIED: stats-only token counter
│   └── types.ts            # Shared: LLMConfig, schemas
├── cascade/
│   └── cascade-engine.ts   # MODIFIED: calls submitJob instead of insertLlmJobIfNotPending
├── change-detector/
│   └── llm-diff-fallback.ts # MODIFIED: calls submitJob
├── db/
│   ├── repository.ts       # MODIFIED: job-related functions removed
│   └── schema.ts           # MODIFIED: llm_jobs, llm_runtime_state removed
└── coordinator.ts          # MODIFIED: broker-client lifecycle, budget guard removed
```

---

## Architectural Patterns

### Pattern 1: Broker as a Protocol Boundary, Not a Dependency

**What:** The broker and instances share `adapter.ts`, `prompts.ts`, and `types.ts` at the source level. They do NOT share runtime state. The broker builds prompts and calls Ollama; instances only submit jobs and receive results. The division is strictly functional: job submission (instance side) vs job execution (broker side).

**When to use:** When shared code is pure (no side effects, no process-local state). When the same logic must run in two contexts without one context depending on the other's infrastructure.

**Trade-offs:** Requires the shared modules to be truly stateless. `adapter.ts` creates a `LanguageModel` per call (no module-level singleton) — this is already the case and must be maintained.

---

### Pattern 2: Socket Client with Transparent Fallback

**What:** `broker-client.ts` presents a single `submitJob()` interface to callers. Internally, it either sends the job over the socket (broker mode) or calls `insertLlmJobIfNotPending()` directly (direct mode). Callers — `cascade-engine.ts`, `llm-diff-fallback.ts` — see no difference.

**When to use:** When adding a new transport layer to an existing system without changing all call sites. The client absorbs the complexity of mode-switching.

**Trade-offs:** The fallback path keeps the local `llm_jobs` table alive. This is intentional for v1.2 — removing the table is a separate, later cleanup step. The dual code paths in `broker-client.ts` must be explicitly tested for both modes.

```typescript
// broker-client.ts — the only interface callers see
export async function submitJob(
  filePath: string,
  jobType: JobType,
  importance: number,
  payload?: string
): Promise<void> {
  if (isConnected()) {
    sendSocketMessage({ type: 'submit', jobId: crypto.randomUUID(), repoPath, filePath, jobType, importance, payload });
  } else {
    // Fallback: local queue
    insertLlmJobIfNotPending(filePath, jobType, 2, payload);
  }
}
```

---

### Pattern 3: In-Memory Queue over Shared SQLite

**What:** The broker holds all pending jobs in memory (`Map<string, PendingJob>`). There is no shared SQLite queue. Jobs are transient: they exist only while in the broker's memory. Persistence is NOT needed — if the broker restarts, instances resubmit on the next file change. The only durable state is `stats.json` (token counts).

**When to use:** When jobs are fire-and-forget, short-lived, and can be reconstructed on broker restart. When the queue lifetime equals the broker process lifetime.

**Trade-offs:** Jobs are lost on broker restart/crash. Instances must resubmit. This is acceptable because: (a) instances resubmit on the next file event anyway, (b) startup resubmission logic sends the top-N pending jobs from `markStale` records, (c) the alternative (shared SQLite queue) has multi-writer WAL complexity with uncertain benefit for a local-only system.

This is a deliberate deviation from the Phase 16 shared SQLite queue design (PLAN.md). Reasoning: the broker pattern centralizes all LLM access, so the coordination problem that required a shared SQLite queue (multiple processes dequeuing independently) does not exist. The broker is the single dequeuer.

---

### Pattern 4: Coordinator as Single Lifecycle Owner (Extended)

**What:** `coordinator.ts` continues to own all lifecycle, including `BrokerClient`. `brokerClient.connect()` is called during `init()`, after the DB is open and before the LLM pipeline starts. `brokerClient.disconnect()` is called during `shutdown()`, before the DB closes.

**When to use:** Consistent with the existing pattern (FileWatcher, LLMPipeline already follow this). Ensures shutdown order is deterministic.

**Trade-offs:** `coordinator.ts` grows, but private methods keep `init()` readable as a sequence of steps.

---

## Build Order (Dependency-Constrained)

```
Phase 1: broker-client.ts with transparent fallback
   - New: src/llm/broker-client.ts
   - submitJob() wraps both socket path and fallback path
   - Modify: cascade-engine.ts, llm-diff-fallback.ts to call submitJob()
   - No broker process yet — all traffic goes through fallback
   - All existing tests must pass
   Rationale: The client is the integration seam. Building it first, with fallback,
   allows modifying callers before the broker exists. Zero behavior change initially.

Phase 2: broker process (main, server, queue, worker)
   - New: src/broker/main.ts, server.ts, queue.ts, worker.ts
   - Add broker/main.ts to esbuild entry points
   - broker-client.ts switches to socket path when broker is running
   Rationale: The broker can be tested end-to-end once the client is wired.

Phase 3: pipeline.ts dual-mode refactor
   - Modify: pipeline.ts dequeue loop → broker response listener
   - Modify: rate-limiter.ts → stats-only counter
   - Modify: coordinator.ts → remove budget guard persistence, add broker lifecycle
   Rationale: Depends on Phase 2 (broker must exist to test broker response path).

Phase 4: schema cleanup
   - Modify: coordinator.ts → DROP TABLE llm_jobs, llm_runtime_state on init
   - Modify: db/repository.ts → remove job CRUD functions
   - Modify: db/schema.ts → remove table definitions
   Rationale: Final cleanup. Do last, after broker mode is validated, so fallback
   path is still available during Phase 2–3 testing.

Phase 5: mcp-server.ts get_llm_status update
   - Modify: get_llm_status to call BrokerClient.getStatus() and read stats.json
   Rationale: Independent of phases 1–4, but needs broker to be running for
   meaningful output. Placed last to avoid testing a tool before the broker exists.
```

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Ollama | `createOpenAICompatible` via Vercel AI SDK — unchanged | Broker calls Ollama; instances do not (in broker mode). One call at a time. 120s timeout per job. |
| Unix domain socket | `net.createServer` / `net.createConnection` (Node.js built-in) | `~/.filescope/broker.sock`. Created by broker; connected by instances. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| cascade-engine.ts → broker-client.ts | Direct function call: `submitJob(filePath, type, payload)` | Replaces `insertLlmJobIfNotPending`. No async await needed — submit is fire-and-forget from cascade's perspective. |
| broker-client.ts → broker/server.ts | Newline-delimited JSON over Unix domain socket | Request/response matched by `jobId`. Client maintains a `Map<jobId, resolver>` for pending responses. |
| broker/worker.ts → adapter.ts, prompts.ts | Direct import — shared modules | Worker imports the same `createLLMModel` and `build*Prompt` functions used by the old pipeline. |
| broker/worker.ts → instance connection | Socket write via the connection object stored at job submission time | Broker must track which socket connection submitted each job to send the result back. |
| coordinator.ts → broker-client.ts | Lifecycle calls: `connect()` at init, `disconnect()` at shutdown | Broker client owned by coordinator, same pattern as LLMPipeline. |
| pipeline.ts → broker-client.ts | Result listener: `brokerClient.onResult(callback)` | In broker mode, the pipeline's response handler is triggered by incoming socket messages, not by polling. |

### No Changes Needed

| Component | Why Unchanged |
|-----------|--------------|
| `writeLlmResult`, `clearStaleness`, `markStale` | Still write to local `.filescope.db`. Result text arrives via socket; instance calls these identically to before. |
| `getFile`, `upsertFile`, `getDependencies` | File metadata queries are per-instance. No broker involvement. |
| FileWatcher, scan, dependency parsing | Broker has no file watching. File discovery is instance-only. |
| All MCP tools except `get_llm_status` | No change in behavior. |

---

## Anti-Patterns

### Anti-Pattern 1: Broker Reads from Instance SQLite

**What people do:** Give the broker the path to each instance's `.filescope.db` so it can look up file content, importance, and staleness.

**Why it's wrong:** Creates a cross-process SQLite access pattern where two processes (instance and broker) read/write the same file concurrently. better-sqlite3 is synchronous and single-connection — while WAL mode allows concurrent reads, writes from two processes without proper locking create corruption risk. More fundamentally, it couples the broker to instance data structure, preventing the broker from running independently.

**Do this instead:** Instances read file content and look up importance before submitting a job to the broker. The job message includes all data the broker needs (file content or file path to read, importance, payload). The broker never touches instance DBs.

---

### Anti-Pattern 2: Broker Builds a Shared SQLite Queue

**What people do:** Create `~/.filescope/queue.db` as the coordination mechanism (Phase 16 plan).

**Why it's wrong for v1.2:** The shared SQLite queue approach was designed for a world where each instance has its own dequeue loop (multiple consumers). With a dedicated broker process, there is exactly one consumer. An in-memory queue in the broker is simpler, faster, and has no multi-writer complexity. SQLite WAL + busy_timeout machinery is needed only when multiple processes compete to write and read the same table — the broker eliminates that competition.

**Do this instead:** Broker holds jobs in memory. The only shared file is `stats.json` (append-only, write-rarely), which is safe to write from one process (the broker).

---

### Anti-Pattern 3: Instance-Side Prompt Building

**What people do:** Build the prompt in the instance (using the file content and job type) before sending it to the broker.

**Why it's wrong:** Prompts can be large (16KB+ for `change_impact` jobs). Serializing and transmitting a built prompt over the socket doubles the data on the wire compared to transmitting just the file path and job type. More importantly, it couples prompt construction to the instance — if prompts change, all instances must be updated.

**Do this instead:** Broker reads the file and builds the prompt. The socket message contains `(filePath, jobType, importance, payload?)` — small, structured data. The broker owns all LLM interaction including prompt construction.

---

### Anti-Pattern 4: Broker as a Singleton Module Import

**What people do:** Implement the broker as a module that instances import directly (no separate process), calling `brokerModule.submit(job)` in-process.

**Why it's wrong:** Defeats the entire purpose of the broker. If the broker runs in the same Node.js process as the instance, it still competes on the same Ollama connection and provides no cross-repo coordination. The broker's value is as a process boundary.

**Do this instead:** Separate OS process, separate esbuild entry point, Unix socket IPC. The `broker-client.ts` is the only broker-facing module that instances import, and it communicates over a socket.

---

## Sources

- Direct codebase audit of `src/coordinator.ts`, `src/llm/pipeline.ts`, `src/llm/adapter.ts`, `src/llm/prompts.ts`, `src/llm/types.ts`, `src/llm/rate-limiter.ts`, `src/cascade/cascade-engine.ts`, `src/change-detector/llm-diff-fallback.ts`, `src/db/repository.ts`, `src/db/schema.ts`, `package.json` — HIGH confidence
- `.planning/PROJECT.md` — v1.2 milestone requirements and key decisions (HIGH confidence)
- `.planning/phases/16-shared-llm-queue/PLAN.md` — prior shared-SQLite-queue design; superseded by broker pattern (HIGH confidence — this is the baseline the broker replaces)
- Node.js `net` module docs: https://nodejs.org/api/net.html — Unix domain socket server/client API (HIGH confidence — Node.js 22 built-in)
- Vercel AI SDK `generateText`: https://sdk.vercel.ai/docs/reference/ai-sdk-core/generate-text — confirmed broker can call `generateText` same as instances (HIGH confidence — existing usage in pipeline.ts)
- Newline-delimited JSON (NDJSON) framing: https://github.com/ndjson/ndjson-spec — standard framing for socket streams (HIGH confidence — established Node.js IPC pattern)

---

*Architecture research for: FileScopeMCP v1.2 LLM Broker milestone*
*Researched: 2026-03-21*
