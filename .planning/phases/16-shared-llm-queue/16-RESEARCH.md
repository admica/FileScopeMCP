# Phase 16: Broker Core - Research

**Researched:** 2026-03-22
**Domain:** Node.js Unix socket IPC, in-memory priority queue, LLM job dispatch, process lifecycle
**Confidence:** HIGH

## Summary

Phase 16 builds a standalone broker process that owns all Ollama communication for the FileScopeMCP ecosystem. The broker is architecturally simple: a Unix domain socket server, an in-memory priority heap, a dedup map, and a serial job worker that calls Ollama via the existing Vercel AI SDK adapter. All the hard primitives (net, readline, AbortController, process signals) are Node.js built-ins with no new npm dependencies required.

The existing codebase provides almost everything the broker needs to reuse: `createLLMModel()` from `adapter.ts`, all three prompt builders from `prompts.ts`, the Zod structured output schemas from `types.ts`, and the `runJob` logic pattern from `pipeline.ts`. The broker's `src/broker/main.ts` entry point just needs to wire these into a socket server rather than a SQLite polling loop.

The most implementation-sensitive areas are: (1) lazy-deletion dedup across the heap and the dedup map, (2) clean AbortController threading through `generateText`'s `abortSignal` parameter for the 120s timeout, and (3) the shutdown sequence ordering — current job must fully resolve or abort before the socket is unlinked. Everything else is straightforward plumbing.

**Primary recommendation:** Build the broker as a flat set of modules under `src/broker/` — queue, worker, server, config, logger — with `main.ts` as the entry point that assembles them and registers signal handlers.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Broker startup UX**
- Auto-started by first MCP instance as a detached background process (Phase 17 spawns, Phase 16 must handle gracefully)
- `broker.default.json` ships in repo root — broker copies it to `~/.filescope/broker.json` on first run if missing (broker resolves default via `__dirname` relative path)
- Verbose startup logging: PID, socket path, model name, config path, Ollama connectivity result, Node version, timestamp
- Ollama connectivity check on startup: warn if unreachable, continue anyway (self-healing)
- PID guard on duplicate start: log "Broker already running (PID XXXX)", exit 0
- Stop mechanism: SIGTERM only — standard Unix, no special flags or MCP tools

**broker.json config**
- Auto-created from `broker.default.json` in repo if `~/.filescope/broker.json` doesn't exist
- Three top-level fields: `llm`, `jobTimeoutMs`, `maxQueueSize`
- `llm`: `provider`, `model`, `baseURL`, `maxTokensPerCall`
- Defaults: `openai-compatible`, `qwen2.5-coder:14b`, `http://localhost:11434/v1`, 1024 tokens per call
- `jobTimeoutMs`: 120000 (120 seconds)
- `maxQueueSize`: 1000
- Priority aging deferred to SCALE-02
- Invalid/malformed config: fail-fast with clear error, exit 1

**Error & edge case behavior**
- Job failures: return error to client, move to next job. No broker-side retries
- Queue full (maxQueueSize reached): reject new submission with error
- Stale socket/PID on startup: detect via PID file — if PID doesn't exist or isn't running, remove stale socket and PID, start fresh
- Ollama unreachable during job processing: return error result to client, continue next job

**Logging behavior**
- Log destination: `~/.filescope/broker.log` (append)
- Per-job lifecycle events: received, processing started, completed (with token count), failed (with error)
- Client connect/disconnect events logged
- ISO timestamps: `[2026-03-22T03:15:42.123Z] job received summary for src/foo.ts`
- No log rotation
- Manual start with TTY: also logs to stdout

### Claude's Discretion
- Priority queue data structure (heap, sorted array, etc.)
- Broker internal source file organization within `src/broker/`
- Wire format message shapes (derivable from NDJSON protocol + requirements)
- Zod schema for broker.json validation (consistent with existing config-utils.ts pattern)
- Retry delay semantics if retry is ever added
- Whether Ollama startup check validates model existence or just server reachability

### Deferred Ideas (OUT OF SCOPE)
- Priority aging (SCALE-02)
- Log rotation
- `--check`/`--status` CLI flag
- Systemd/launchd service file
- Broker health endpoint
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| BROKER-01 | Broker process listens on Unix domain socket at ~/.filescope/broker.sock | Node.js `net.createServer(sockPath, ...)` — verified working on Node v22 |
| BROKER-02 | Broker creates ~/.filescope/ directory on first run if it doesn't exist | `fs.mkdirSync(dir, { recursive: true })` — verified |
| BROKER-03 | Broker reads LLM config (provider, model, baseURL) from ~/.filescope/broker.json | Zod schema pattern from config-utils.ts; `broker.default.json` already exists at repo root |
| BROKER-04 | Broker writes PID file at ~/.filescope/broker.pid and cleans up stale socket/PID on startup | `process.kill(pid, 0)` throws ESRCH if process not running — verified; PID file written via fs.writeFileSync |
| BROKER-05 | Broker maintains in-memory priority queue ordered by importance DESC, created_at ASC | Min-heap with composite comparator — verified correct dequeue order |
| BROKER-06 | Broker deduplicates pending jobs per (repoPath, filePath, jobType) | Map<string, job> with lazy heap deletion — verified pattern |
| BROKER-07 | Broker builds prompts from file content and calls Ollama with structured output fallback | Direct reuse of adapter.ts + prompts.ts + pipeline.ts runJob pattern |
| BROKER-08 | Broker processes one job at a time (serialized Ollama access) | Single worker loop with `await runJob()` — no concurrency needed |
| BROKER-09 | Broker enforces 120s timeout per job | `generateText({ abortSignal })` — abortSignal parameter confirmed in AI SDK v6 types |
| BROKER-10 | Broker performs graceful shutdown on SIGTERM/SIGINT | Signal handler with idempotency guard; wait for current job to resolve/abort before socket unlink |
| BROKER-11 | Broker drops pending jobs for a connection when that connection closes | Filter queue by connectionId on 'close' event; remove from dedup map |
| BROKER-12 | Broker built as separate esbuild entry point (src/broker/main.ts -> dist/broker.js) | Add `src/broker/main.ts` to existing esbuild command; `--format=esm --platform=node` already set |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:net` | built-in (Node v22) | Unix domain socket server | The locked IPC mechanism; no deps needed |
| `node:readline` | built-in (Node v22) | NDJSON line parsing on socket streams | Standard pattern for line-delimited protocols |
| `node:fs` / `node:fs/promises` | built-in | PID/sock file management, config auto-copy, log appending | Already used throughout the codebase |
| `node:path` / `node:os` | built-in | Resolve `~/.filescope/` paths | Already used throughout the codebase |
| `zod` | ^3.25.28 (existing) | broker.json config validation | Already in package.json; consistent with config-utils.ts pattern |
| `ai` (Vercel AI SDK) | ^6.0.116 (existing) | `generateText` with `abortSignal` for LLM calls | Already in package.json; powers existing pipeline |
| `@ai-sdk/openai-compatible` | ^2.0.35 (existing) | Ollama provider factory | Already in package.json |

### Reused Internal Modules (no new code)
| Module | What to Reuse |
|--------|---------------|
| `src/llm/adapter.ts` | `createLLMModel(config)` — broker calls this directly |
| `src/llm/prompts.ts` | `buildSummaryPrompt`, `buildConceptsPrompt`, `buildChangeImpactPrompt` |
| `src/llm/types.ts` | `ConceptsSchema`, `ChangeImpactSchema` Zod schemas |
| `src/llm/pipeline.ts` | Reference for `runJob()` pattern — NOT imported, used as implementation guide only |
| `src/logger.ts` | `enableDaemonFileLogging()` + TTY detection already implemented |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| `esbuild` ^0.27.3 | Bundle `src/broker/main.ts` to `dist/broker.js` | During build; add entry to existing build command |
| `broker.default.json` | Default config shipped in repo root | Broker copies to `~/.filescope/broker.json` on first run |

**Installation:** No new dependencies required. All tools are either Node.js built-ins or already in package.json.

---

## Architecture Patterns

### Recommended Project Structure
```
src/broker/
├── main.ts          # Entry point: init, config load, socket start, signal handlers
├── config.ts        # BrokerConfig type + Zod schema + load/init-from-default logic
├── queue.ts         # PriorityQueue class (min-heap + dedup map)
├── worker.ts        # Serial job processor: dequeue loop, runJob(), timeout enforcement
├── server.ts        # Unix socket server: accept connections, NDJSON parsing, message routing
└── logger.ts        # Broker-specific logger wrapping src/logger.ts with file+TTY output
```

`dist/broker.js` — esbuild output, run as `node dist/broker.js`

### Pattern 1: Unix Socket Server with NDJSON
**What:** `net.createServer()` with a per-connection `readline.createInterface` for line-delimited JSON
**When to use:** For all client-to-broker and broker-to-client messaging
**Example:**
```typescript
// Verified: Node v22 net + readline NDJSON pattern
import * as net from 'node:net';
import * as readline from 'node:readline';

const server = net.createServer((socket) => {
  const rl = readline.createInterface({ input: socket, terminal: false });
  rl.on('line', (line) => {
    const msg = JSON.parse(line);
    // handle msg
    socket.write(JSON.stringify({ type: 'result', id: msg.id }) + '\n');
  });
  socket.on('close', () => { /* drop pending jobs for this connection */ });
  socket.on('error', (err) => { /* log and discard */ });
});

server.listen('/path/to/broker.sock', () => {
  console.log('Listening');
});
```

### Pattern 2: Priority Queue — Min-Heap with Dedup Map
**What:** A binary min-heap ordered by (importance DESC, created_at ASC) + a `Map<string, QueueJob>` for O(1) dedup lookup
**When to use:** All queue operations (enqueue, dequeue, drop-by-connection)
**Key insight:** Heap removal is O(n) so use lazy deletion — mark heap entries as `cancelled: true` and skip them on pop. The dedup map is the single source of truth for active job existence.

```typescript
// Verified: correct dequeue order for importance DESC, created_at ASC
function compare(a: QueueJob, b: QueueJob): number {
  if (b.importance !== a.importance) return b.importance - a.importance; // DESC
  return a.created_at - b.created_at; // ASC (older = higher priority)
}

// Dedup key
const dedupKey = (j: QueueJob) => `${j.repoPath}|${j.filePath}|${j.jobType}`;

// On new submit: if key exists, mark old entry cancelled, replace in map
function enqueue(job: QueueJob): void {
  const key = dedupKey(job);
  const existing = dedupMap.get(key);
  if (existing) existing.cancelled = true; // lazy delete from heap
  dedupMap.set(key, job);
  heap.push(job);
}

// On dequeue: skip cancelled entries
function dequeue(): QueueJob | null {
  while (heap.size > 0) {
    const job = heap.pop()!;
    if (!job.cancelled && dedupMap.get(dedupKey(job)) === job) return job;
  }
  return null;
}
```

### Pattern 3: 120s Timeout via AbortController + generateText abortSignal
**What:** Create an AbortController per job, set a 120s setTimeout that calls `ac.abort()`, pass `ac.signal` to `generateText`
**When to use:** Every LLM call in the worker
**Confirmed:** `generateText` in Vercel AI SDK v6 accepts `abortSignal` parameter (line 1425 of index.d.ts)

```typescript
// Verified: AbortController + Promise.race pattern — aborted side throws
async function runJobWithTimeout(job: QueueJob, timeoutMs: number): Promise<JobResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await runJob(job, ac.signal); // passes signal to generateText
  } finally {
    clearTimeout(timer);
  }
}

// In runJob, pass signal to generateText:
const { text, usage } = await generateText({
  model,
  prompt: buildSummaryPrompt(job.filePath, content),
  maxOutputTokens: config.llm.maxTokensPerCall ?? 1024,
  abortSignal: signal,
});
```

### Pattern 4: PID Guard with Stale Detection
**What:** On startup, check for existing `broker.pid`; if present, check if PID is alive via `process.kill(pid, 0)`
**When to use:** Always on broker startup, before binding socket

```typescript
// Verified: process.kill(pid, 0) throws ESRCH if process not running
function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code !== 'ESRCH'; // ESRCH = no such process
  }
}

// On startup:
if (fs.existsSync(pidPath)) {
  const pid = parseInt(fs.readFileSync(pidPath, 'utf8').trim(), 10);
  if (isPidRunning(pid)) {
    log(`Broker already running (PID ${pid})`);
    process.exit(0); // Non-error exit for race conditions
  }
  // Stale: remove leftover files
  fs.rmSync(sockPath, { force: true });
  fs.rmSync(pidPath, { force: true });
}
// Write PID file before binding socket
fs.writeFileSync(pidPath, String(process.pid), 'utf8');
```

### Pattern 5: Graceful Shutdown
**What:** Single shutdown handler with idempotency guard; await current job completion (or timeout abort), then clean up
**When to use:** SIGTERM and SIGINT handlers

```typescript
// Verified: idempotency guard prevents double-shutdown on repeated signals
let shutdownStarted = false;

async function shutdown(sig: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  log(`Received ${sig} — graceful shutdown`);
  // 1. Set worker stopped flag (prevents new job pickup)
  // 2. Await currentJobPromise (or it self-aborts via timeout)
  // 3. Close all client sockets
  // 4. server.close()
  // 5. fs.rmSync(sockPath, { force: true })
  // 6. fs.rmSync(pidPath, { force: true })
  // 7. process.exit(0)
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));
```

### Pattern 6: ESM Path Resolution (import.meta.url)
**What:** Because the project uses `--format=esm`, `__dirname` is not available at runtime. Use `fileURLToPath(new URL('.', import.meta.url))` instead.
**When to use:** In `src/broker/config.ts` when resolving `broker.default.json` relative to `dist/broker.js`

```typescript
// From src/db/db.ts pattern — established in this codebase
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

// Resolves to the directory containing the compiled broker.js
const brokerDir = fileURLToPath(new URL('.', import.meta.url));
// broker.default.json is one level up from dist/ at repo root
const defaultConfigPath = path.resolve(brokerDir, '../broker.default.json');
```

### Pattern 7: NDJSON Wire Protocol (4 Message Types)
**What:** All messages are newline-terminated JSON objects. Client sends submit and status; broker sends result and error.

```typescript
// Client → Broker
type SubmitMessage = {
  type: 'submit';
  id: string;         // client-generated UUID or monotonic counter
  repoPath: string;
  filePath: string;
  jobType: 'summary' | 'concepts' | 'change_impact';
  importance: number; // 0-10
  fileContent: string; // file contents (broker builds prompts)
  payload?: string;    // diff text for change_impact jobs
};

type StatusMessage = {
  type: 'status';
  id: string;
};

// Broker → Client
type ResultMessage = {
  type: 'result';
  id: string;
  jobType: 'summary' | 'concepts' | 'change_impact';
  repoPath: string;
  filePath: string;
  text: string;       // LLM output
  totalTokens: number;
};

type ErrorMessage = {
  type: 'error';
  id: string;
  code: string;       // 'timeout' | 'queue_full' | 'ollama_error' | 'parse_error'
  message: string;
  repoPath?: string;
  filePath?: string;
};
```

**Note on `id` field:** The `id` in `submit` is a correlation ID from the client. The broker uses it in `result`/`error` responses. The broker's internal job ID is separate from the client's correlation ID.

### Pattern 8: Dual-Output Logger
**What:** The existing `src/logger.ts` already has `enableDaemonFileLogging()` for file-only mode and `process.stdout.isTTY` / `process.stderr.isTTY` for TTY detection
**When to use:** Broker logger module wraps the existing logger

```typescript
// In src/broker/logger.ts or main.ts
import { enableDaemonFileLogging, enableFileLogging } from '../logger.js';
import * as path from 'node:path';
import * as os from 'node:os';

const logPath = path.join(os.homedir(), '.filescope', 'broker.log');

if (process.stdout.isTTY) {
  // Interactive: logs to stdout AND file
  enableFileLogging(true, logPath);
} else {
  // Daemon/piped: logs to file only
  enableDaemonFileLogging(logPath);
}
```

### Anti-Patterns to Avoid
- **Polling for queue jobs:** The worker should immediately process the next job after completing one, with a short settle delay (50ms) rather than polling on an interval. Use recursive async scheduling similar to `scheduleNext()` in `pipeline.ts`.
- **Synchronous socket writes in critical paths:** Use `socket.write()` (async internally) — don't await individual writes or the worker stalls waiting for client ACK.
- **Hard-deleting heap entries for dedup:** O(n) heap removal creates complexity. The lazy deletion (mark `cancelled: true`) is simpler and correct.
- **Binding socket before PID check:** PID check and stale cleanup must happen before `server.listen()`, not after.
- **Treating queue drop-by-connection as a heap operation:** Drop-by-connection only needs to remove entries from the dedup map and mark heap entries cancelled — no heap rebuild required.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LLM calls | Custom fetch to Ollama HTTP API | `generateText` from `ai` + `createLLMModel` from `adapter.ts` | Handles structured output, retries, provider abstraction — already wired |
| Prompt construction | String templates in broker | `buildSummaryPrompt` etc. from `prompts.ts` | Already tested and correct |
| Structured output + JSON repair | Custom JSON extraction | `Output.object({ schema })` + fallback in `pipeline.ts` pattern | Handles Ollama's quirky JSON output |
| Config validation | Manual JSON field checking | Zod schema (same pattern as `config-utils.ts`) | Catches type errors, gives clear error messages, matches codebase style |
| File-based logging | Custom logger | `src/logger.ts` (`enableDaemonFileLogging`) | ISO timestamps already implemented; TTY detection already there |
| NDJSON line parsing | Manual buffer splitting | `readline.createInterface({ input: socket })` | Handles partial writes, backpressure, and stream lifecycle correctly |

**Key insight:** The broker is mostly glue between existing primitives. Roughly 70% of the job-execution logic already exists in `pipeline.ts` and can be lifted near-verbatim.

---

## Common Pitfalls

### Pitfall 1: Stale Socket Without Stale PID
**What goes wrong:** Broker crashes without cleaning up `broker.sock`. On next start, `net.createServer().listen(sockPath)` throws `EADDRINUSE`.
**Why it happens:** The PID-only check (`isPidRunning(pid)`) passes if the PID happens to be reused by a different process.
**How to avoid:** The stale detection logic must check: (a) `broker.pid` file exists, (b) PID in file is running, (c) AND that process actually owns the socket. For v1.2 simplicity, check only (a)+(b) — if PID file is absent or PID is dead, unlink both files unconditionally. Accept the rare false-positive of killing a reused PID as out-of-scope.
**Warning signs:** `Error: listen EADDRINUSE` on broker startup despite no broker running.

### Pitfall 2: Shutdown Race — Socket Unlinked Before Last Write
**What goes wrong:** Shutdown handler calls `server.close()` and `fs.rmSync(sockPath)` while the current job's `result` message is still being written to a client socket.
**Why it happens:** `server.close()` stops accepting new connections but does not immediately destroy existing connections.
**How to avoid:** The shutdown sequence is: (1) set stopped flag, (2) `await currentJobPromise`, (3) write result to client, (4) destroy all sockets, (5) `server.close()`, (6) `fs.rmSync`. Only unlink files after all writes complete.

### Pitfall 3: BROKER-11 — Connection Close Drops In-Progress Jobs
**What goes wrong:** A client disconnects while its job is being processed. The broker should drop it, but the worker holds a reference to the job and writes the result to a now-closed socket.
**Why it happens:** The worker picks a job before the connection closes; by job completion the socket is gone.
**How to avoid:** Track which connection submitted the in-progress job. On completion, check if that connection is still alive before writing. If connection closed mid-job, discard the result (don't crash). The requirement says "pending jobs" are dropped — an in-progress job completing into the void is acceptable.

### Pitfall 4: Lazy Deletion Dedup Map Divergence
**What goes wrong:** A job is in the heap (cancelled=true) but still in the dedup map, or vice versa. New submission of the same key finds a stale map entry.
**Why it happens:** Forgetting to remove from dedup map after the job is dequeued (or when its connection closes).
**How to avoid:** The dedup map entry for a key is removed in exactly two places: (a) when the job is dequeued and starts processing, (b) when a connection closes and its pending jobs are dropped. After dequeue, `dedupMap.delete(dedupKey(job))` immediately.

### Pitfall 5: generateText abortSignal Swallowed Exception
**What goes wrong:** `generateText` throws when the signal is aborted, but the error is caught by the structured-output fallback's try/catch, causing the fallback to also attempt a call (which also throws), resulting in confusing error logs.
**Why it happens:** The existing `pipeline.ts` fallback pattern catches all errors from the structured output call.
**How to avoid:** In the broker's `runJob`, check for AbortError before entering fallback: `if (err.name === 'AbortError') throw err;` — re-throw abort errors so they propagate to the timeout handler.

### Pitfall 6: esbuild ESM + import.meta.url Not Available
**What goes wrong:** `broker.default.json` path resolution uses `__dirname`, which is not available in `--format=esm` output.
**Why it happens:** ESM modules don't have `__dirname`. esbuild does NOT inject it for `--format=esm`.
**How to avoid:** Use `fileURLToPath(new URL('.', import.meta.url))` — this is the established pattern in this codebase (see `src/db/db.ts`).

### Pitfall 7: Server Backpressure on socket.write()
**What goes wrong:** The broker's worker loop blocks if `socket.write()` returns false (buffer full) and the broker naively awaits drain before processing the next job.
**Why it happens:** `socket.write()` is synchronous in queueing but the OS buffer can fill up if clients are slow.
**How to avoid:** Fire-and-forget `socket.write()` in the worker — don't await drain. Each result message is small (< 4KB typically). If a client is too slow, its socket will error and trigger the connection-close cleanup path. Serial job processing means only one result is written at a time anyway.

---

## Code Examples

Verified patterns from existing codebase and Node.js built-ins:

### Config Schema (follow config-utils.ts pattern)
```typescript
// src/broker/config.ts
import { z } from 'zod';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const BrokerLLMSchema = z.object({
  provider: z.enum(['anthropic', 'openai-compatible']).default('openai-compatible'),
  model: z.string().default('qwen2.5-coder:14b'),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  maxTokensPerCall: z.number().int().positive().default(1024),
});

export const BrokerConfigSchema = z.object({
  llm: BrokerLLMSchema,
  jobTimeoutMs: z.number().int().positive().default(120000),
  maxQueueSize: z.number().int().positive().default(1000),
});

export type BrokerConfig = z.infer<typeof BrokerConfigSchema>;

const FILESCOPE_DIR = path.join(os.homedir(), '.filescope');
const CONFIG_PATH = path.join(FILESCOPE_DIR, 'broker.json');

export async function loadBrokerConfig(): Promise<BrokerConfig> {
  // Ensure ~/.filescope/ exists
  await fs.mkdir(FILESCOPE_DIR, { recursive: true });

  // Auto-copy from broker.default.json if missing
  const configExists = await fs.access(CONFIG_PATH).then(() => true).catch(() => false);
  if (!configExists) {
    const brokerDir = fileURLToPath(new URL('.', import.meta.url));
    const defaultPath = path.resolve(brokerDir, '../broker.default.json');
    await fs.copyFile(defaultPath, CONFIG_PATH);
  }

  const raw = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
  const result = BrokerConfigSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Invalid broker config at ${CONFIG_PATH}: ${result.error.message}`);
    process.exit(1);
  }
  return result.data;
}
```

### runJob (lifted from pipeline.ts, adapted for broker)
```typescript
// src/broker/worker.ts — job execution logic
// Source: src/llm/pipeline.ts runJob() pattern
import { generateText, Output } from 'ai';
import { createLLMModel } from '../llm/adapter.js';
import { buildSummaryPrompt, buildConceptsPrompt, buildChangeImpactPrompt } from '../llm/prompts.js';
import { ConceptsSchema, ChangeImpactSchema } from '../llm/types.js';

export async function runJob(job: ActiveJob, config: BrokerConfig, signal: AbortSignal): Promise<JobResult> {
  const model = createLLMModel(config.llm);
  const maxOutputTokens = config.llm.maxTokensPerCall ?? 1024;

  switch (job.jobType) {
    case 'summary': {
      const { text, usage } = await generateText({
        model,
        prompt: buildSummaryPrompt(job.filePath, job.fileContent),
        maxOutputTokens,
        abortSignal: signal,  // AI SDK v6 confirmed — aborts the underlying fetch
      });
      return { text: text.trim(), totalTokens: usage?.totalTokens ?? 0 };
    }
    case 'concepts': {
      try {
        const { output, usage } = await generateText({
          model,
          output: Output.object({ schema: ConceptsSchema }),
          prompt: buildConceptsPrompt(job.filePath, job.fileContent),
          maxOutputTokens,
          abortSignal: signal,
        });
        return { text: JSON.stringify(output), totalTokens: usage?.totalTokens ?? 0 };
      } catch (err: any) {
        if (err.name === 'AbortError') throw err; // Don't enter fallback on timeout
        // Ollama JSON repair fallback
        const { text, usage } = await generateText({
          model,
          prompt: buildConceptsPrompt(job.filePath, job.fileContent),
          maxOutputTokens,
          abortSignal: signal,
        });
        const parsed = JSON.parse(text.trim());
        return { text: JSON.stringify(parsed), totalTokens: usage?.totalTokens ?? 0 };
      }
    }
    // change_impact similar...
  }
}
```

### esbuild command addition
```bash
# Add src/broker/main.ts to the existing build command in package.json scripts.build
# Just append it to the space-separated source list:
esbuild ... src/broker/main.ts ... --format=esm --target=es2020 --outdir=dist --platform=node
# Output: dist/broker.js (esbuild names output after input file)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-repo SQLite llm_jobs polling | Standalone broker with in-memory queue | v1.2 design (2026-03) | Single prioritized queue across all repos |
| pipeline.ts per-instance LLM worker | broker worker.ts shared across instances | v1.2 design (2026-03) | One Ollama connection, no contention |
| Shared SQLite queue (original Phase 16 plan) | In-memory queue in broker process | Revised 2026-03 | Simpler, no SQLite WAL contention, no coordinator needed |

**Superseded:**
- `.planning/phases/16-shared-llm-queue/PLAN.md`: Old shared SQLite queue design. Should be deleted or overwritten by the new plan — it describes a fundamentally different architecture (shared queue.db, leader election).

---

## Open Questions

1. **Status message scope in Phase 16**
   - What we know: BROKER-02 (OBS-02) says broker responds to status requests with pending count, in-progress job, connected clients, per-repo breakdown. But OBS-01 and OBS-02 are Phase 19 requirements.
   - What's unclear: Should Phase 16 implement the status message handler at all, or stub it?
   - Recommendation: Implement a minimal `status` handler in Phase 16 that returns `{ type: 'status_response', pendingCount, inProgressJob, connectedClients }`. Phase 19 can enrich it with per-repo breakdown. Avoids a protocol version bump later.

2. **Connection identity tracking**
   - What we know: BROKER-11 requires dropping pending jobs per connection. Each `net.Socket` instance is the natural identity.
   - What's unclear: Should jobs store a socket reference or a connection ID string?
   - Recommendation: Store the `net.Socket` reference directly in each queue job. It's GC-safe (socket lives as long as connection is open), and `socket === job.connection` is O(1) identity check. No need for a connection ID string.

3. **File content in submit message**
   - What we know: CONTEXT.md says "Broker builds prompts from file content" — so the client sends file content with the job.
   - What's unclear: For large files, this means the file content travels over the Unix socket. At what size does this become a problem?
   - Recommendation: Not a concern for v1.2. Unix socket buffer is typically 64KB-256KB; for larger files, the socket write will still succeed, just spread across multiple kernel buffer flushes. The `readline` interface handles partial writes correctly.

---

## Sources

### Primary (HIGH confidence)
- Node.js v22 built-in modules (`net`, `readline`, `fs`, `readline`) — verified with live execution
- `node_modules/ai/dist/index.d.ts` line 1425 — `generateText` `abortSignal` parameter confirmed
- `src/llm/pipeline.ts` — `runJob()` reference implementation (this repo)
- `src/llm/adapter.ts` — `createLLMModel()` reuse confirmed (this repo)
- `src/logger.ts` — `enableDaemonFileLogging()`, TTY detection (this repo)
- `src/db/db.ts` — ESM `import.meta.url` path resolution pattern (this repo)
- `broker.default.json` — default config shape confirmed (this repo)

### Secondary (MEDIUM confidence)
- Lazy deletion heap pattern — standard algorithm; verified with working Node.js implementation
- `process.kill(pid, 0)` for PID liveness — verified on Node v22 Linux

### Tertiary (LOW confidence)
- Unix socket buffer size (64KB-256KB) — Linux kernel default; not verified for this specific WSL2 environment

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are existing deps or Node.js built-ins, verified
- Architecture: HIGH — all patterns verified with working Node.js code
- Pitfalls: HIGH — identified from direct code inspection of existing pipeline.ts and Node.js behavior
- Wire protocol: MEDIUM — shapes are derivable from requirements; exact field names are Claude's discretion

**Research date:** 2026-03-22
**Valid until:** 2026-09-22 (stable — Node.js built-ins and Vercel AI SDK v6 API are stable)
