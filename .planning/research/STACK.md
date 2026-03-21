# Stack Research

**Domain:** Autonomous file intelligence / MCP codebase metadata system — v1.2 LLM Broker additions
**Researched:** 2026-03-21
**Confidence:** HIGH

## Context

This is a targeted v1.2 addition to an existing TypeScript 5.8 / Node.js 22 / ESM / esbuild stack.
The core stack is validated and NOT re-researched here. This document covers only the
**new capability domains** for the v1.2 LLM Broker milestone:

1. Unix domain socket server/client (broker IPC)
2. In-memory priority queue (cross-repo job ordering)
3. NDJSON message framing over socket streams
4. Multi-process coordination (broker process lifecycle)
5. Second esbuild entry point for the broker binary

**Retained stack (do not change):** TypeScript 5.8, Node.js 22, ESM, esbuild, `@modelcontextprotocol/sdk`,
`chokidar`, `zod`, `vitest`, `better-sqlite3`, `drizzle-orm`, `tree-sitter@0.25.x`,
`tree-sitter-typescript@0.23.x`, `tree-sitter-javascript@0.25.x`, Vercel AI SDK, `ignore`.

---

## Recommended Stack — New Additions Only

### No New Runtime Dependencies Required

All five capability domains are satisfied by Node.js 22 built-ins. Zero new npm packages.

| Capability | Node.js Built-in | Why It Suffices |
|------------|-----------------|-----------------|
| Unix domain socket server | `node:net` — `net.createServer({ path })` | Full IPC server: stream-based, backpressure-aware, no port conflicts. Officially documented for IPC use. Ships in all Node.js versions. |
| Unix domain socket client | `node:net` — `net.createConnection({ path })` | Connects to the broker socket. Emits `connect`, `data`, `close`, `error` events. Reconnect pattern is plain event-listener logic (see Patterns section). |
| NDJSON framing | `node:readline` — `readline.createInterface({ input: socket })` | Buffers socket data until `\n`, emits complete lines. Each line is `JSON.parse()`d. Outbound messages are `JSON.stringify(msg) + '\n'`. No library needed. |
| In-memory priority queue | Pure TypeScript (35-line binary max-heap) | The queue holds at most hundreds of jobs. A custom comparator on `(importance DESC, created_at ASC)` is trivial to implement. Avoids a dependency that wraps ~30 lines of code. |
| Second esbuild entry point | `esbuild` (existing dev dep) — add `src/broker.ts` to entryPoints | esbuild supports multiple entry points with `entryPoints: { mcp: 'src/mcp-server.ts', broker: 'src/broker.ts' }`. Both output to `dist/`. No config changes to esbuild itself. |

---

## Implementation Patterns

### Unix Domain Socket Server (broker side)

```typescript
import net from 'node:net';
import fs from 'node:fs';

const SOCKET_PATH = `${process.env.HOME}/.filescope/broker.sock`;

// Stale socket cleanup on startup
try { fs.unlinkSync(SOCKET_PATH); } catch { /* not present — fine */ }

const server = net.createServer((socket) => {
  socket.setEncoding('utf8');
  // Wire up readline for NDJSON framing (see below)
});

server.listen(SOCKET_PATH, () => {
  // Socket created; write PID file
});

// Cleanup on exit
process.on('SIGTERM', () => { server.close(); fs.unlinkSync(SOCKET_PATH); });
process.on('SIGINT',  () => { server.close(); fs.unlinkSync(SOCKET_PATH); });
```

### NDJSON Framing (both sides)

```typescript
import readline from 'node:readline';
import type net from 'node:net';

// Receive: one JSON object per line
function attachReader(socket: net.Socket, onMessage: (msg: unknown) => void): void {
  const rl = readline.createInterface({ input: socket, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (line.trim() === '') return;
    try { onMessage(JSON.parse(line)); }
    catch { /* drop malformed line */ }
  });
}

// Send: always append \n
function send(socket: net.Socket, msg: object): void {
  socket.write(JSON.stringify(msg) + '\n');
}
```

`readline.createInterface` accepts any `Readable` stream as `input`. `net.Socket` is a `Duplex`
stream — so it works directly without any adapter. Node.js 22 official docs confirm this use case.

### In-Memory Priority Queue (broker side)

```typescript
// 35-line binary max-heap. No npm package needed.
// Comparator: importance DESC, created_at ASC (lower timestamp wins ties).
interface BrokerJob {
  jobId: string;
  repoPath: string;
  filePath: string;
  jobType: 'summary' | 'concepts' | 'change_impact';
  importance: number;   // 0-10, higher = dequeue first
  createdAt: number;    // Date.now() at enqueue, lower = dequeue first on ties
  fileContent?: string;
  payload?: string;
}

function compare(a: BrokerJob, b: BrokerJob): number {
  if (b.importance !== a.importance) return b.importance - a.importance; // DESC
  return a.createdAt - b.createdAt;                                       // ASC
}

class PriorityQueue {
  private heap: BrokerJob[] = [];
  enqueue(job: BrokerJob): void { /* sift-up */ }
  dequeue(): BrokerJob | undefined { /* swap, pop, sift-down */ }
  get size(): number { return this.heap.length; }
  // removeByKey(filePath, jobType, repoPath): for dedup upsert
}
```

The queue holds job objects that already carry all data the broker needs to call Ollama directly.
Instances submit full job payloads (file content included) so the broker never needs to read files.

### Reconnecting Client (instance side)

```typescript
import net from 'node:net';

class BrokerClient {
  private socket: net.Socket | null = null;
  private retryDelay = 1000;
  private stopped = false;

  connect(): void {
    if (this.stopped) return;
    const sock = net.createConnection({ path: SOCKET_PATH });

    sock.on('connect', () => { this.retryDelay = 1000; this.socket = sock; });
    sock.on('close',   () => { this.socket = null; if (!this.stopped) this.scheduleRetry(); });
    sock.on('error',   () => { sock.destroy(); });

    attachReader(sock, (msg) => this.handleMessage(msg));
  }

  private scheduleRetry(): void {
    setTimeout(() => this.connect(), this.retryDelay);
    this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }
}
```

On `ENOENT` (broker not running), `connect()` fails immediately with `error`+`close`, triggering
the retry schedule. This is the graceful degradation path — instance falls back to direct Ollama
when the broker is unreachable for too long.

### Second esbuild Entry Point

The existing build script passes individual source files. Change the `build` script in `package.json`:

```json
"build": "esbuild --bundle --format=esm --target=es2020 --platform=node --outdir=dist src/mcp-server.ts src/broker.ts"
```

Or equivalently, add `src/broker.ts` alongside `src/mcp-server.ts` in the existing
source file list. esbuild handles multiple entry points with `--outdir=dist` (required when
there are multiple inputs). Output: `dist/mcp-server.js` and `dist/broker.js`.

The broker binary is invoked directly: `node dist/broker.js`. A `"broker"` script can be
added to `package.json` for convenience. No shebang needed — this is a local tool.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `node-ipc` npm package | Deliberately injected malware in 2022 (CVE-2022-23812). Maintainer wiped files on Russian/Belarusian IPs as protest. Even post-remediation versions carry supply-chain trust deficit. | `node:net` built-in |
| `node-net-reconnect`, `net-retry-connect` | Both packages exist to wrap a 10-line `close`+`setTimeout` pattern. Adding a dependency for this is worse than owning the code. Last meaningful updates were 2018-2020. | Plain event listeners with exponential backoff |
| `@datastructures-js/priority-queue` | 285K weekly downloads but adds a dependency for ~35 lines of heap code. The broker queue needs a custom `remove(filePath, jobType, repoPath)` for dedup upsert — the library's `remove()` uses deep equality, not key-based lookup, requiring a wrapper anyway. At that point you own the complexity. | Custom TypeScript binary heap |
| `ndjson` npm package | The `ndjson` npm package wraps Node.js `readline` in a transform stream. The `readline` built-in is simpler and faster for this use case — no transform stream intermediary. `ndjson.js` itself uses `readline` internally. | `node:readline` + `JSON.parse` |
| `socket.io` or `ws` | Both target browser/TCP use cases and add significant weight. This is local IPC only, never leaves the machine, never touches a browser. | `node:net` Unix domain socket |
| Length-prefixed binary framing | More complex to implement and parse. NDJSON is sufficient for the message sizes here (job submissions are at most a few KB of file content). | NDJSON (`\n`-delimited JSON) |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Unix domain socket | TCP on localhost | Unix domain sockets avoid port conflicts, skip the network stack entirely (~50% lower latency per benchmarks), and require no port allocation logic. The broker never communicates across machines. |
| Unix domain socket | `child_process` IPC channels | `child_process` IPC requires the broker to be a child of the instance. The broker is a standalone process that outlives any single instance — instances attach to an already-running broker. |
| `node:readline` for NDJSON | Manual `data` event buffer accumulation | Manually buffering socket data, scanning for `\n`, and slicing is exactly what `readline` implements. Writing it by hand is just a buggy re-implementation. `readline` handles partial chunks, multi-byte UTF-8, and backpressure correctly. |
| Custom priority heap | Sorted array insertion | O(n) insertion for a sorted array vs O(log n) for heap. Not a performance concern at broker queue sizes, but the heap is no harder to write and the algorithmic correctness argument is cleaner. |
| Vercel AI SDK (existing) | Direct `fetch` to Ollama | The broker will reuse `createLLMModel` from the existing `adapter.ts`. The adapter already handles Ollama via `openai-compatible` provider. No change needed — broker just calls `generateText` the same way the pipeline does today. |

---

## Integration with Existing Stack

### Vercel AI SDK — No Changes

The broker calls the existing `createLLMModel(config)` from `src/llm/adapter.ts` and uses
`generateText` / `Output.object` from `ai` exactly as `pipeline.ts` does today. The broker
is essentially a standalone process that runs the `runJob` logic from the pipeline, but fed
jobs via socket instead of SQLite dequeue.

### Prompt Building — Reuse `prompts.ts`

The broker imports `buildSummaryPrompt`, `buildConceptsPrompt`, `buildChangeImpactPrompt` from
the existing `src/llm/prompts.ts`. Instances send file content in the job payload so the broker
never reads the filesystem.

### `better-sqlite3` — Stats Persistence Only

The broker uses `better-sqlite3` (loaded via `createRequire`) to write token stats to
`~/.filescope/stats.json` (or a stats table in a shared DB). No Drizzle ORM needed at the
broker level — raw `better-sqlite3` statements suffice for a two-column stats table.
The per-repo instance DBs are no longer touched by the broker.

### esbuild — Add One Entry Point

No new dev tooling. The existing `esbuild` dev dependency handles the broker binary.
Add `src/broker.ts` to the entry points list. Same `--format=esm --target=es2020 --platform=node`
flags apply.

---

## Installation

No new packages to install. All capabilities are covered by:
- Node.js 22 built-ins: `node:net`, `node:readline`, `node:fs`
- Existing dependencies: `better-sqlite3`, Vercel AI SDK, `zod`, `esbuild`

The milestone is a zero-dependency-addition feature.

---

## Version Compatibility

| Component | Version | Compatibility Notes |
|-----------|---------|---------------------|
| `node:net` Unix sockets | Node.js 22.21.1 | Stable since Node.js 0.1. Socket path `~/.filescope/broker.sock` is 31 chars — well under the 107-byte Linux limit. `server.close()` automatically unlinks the socket file. |
| `node:readline` with `net.Socket` | Node.js 22.21.1 | `net.Socket` is a `Duplex` (implements `Readable`) — directly accepted as `createInterface({ input })`. `crlfDelay: Infinity` prevents spurious line splits on slow chunks. Stable API. |
| Binary heap in TypeScript | TypeScript 5.8 | Pure TypeScript, no runtime deps. Generic over job type. Compatible with ESM output target `es2020`. |
| `esbuild` multiple entry points | esbuild 0.27.3 | `entryPoints` array with multiple `.ts` files + `--outdir=dist` is the documented multi-entry pattern. Verified in esbuild docs. No config changes needed. |

---

## Sources

- [Node.js v22 `node:net` documentation](https://nodejs.org/api/net.html) — `createServer`, `createConnection`, socket path IPC, `server.close()` unlinks socket, 107-byte path limit on Linux (HIGH confidence — official docs, fetched directly)
- [Node.js Unix Domain Socket guide — nodevibe.substack.com](https://nodevibe.substack.com/p/the-nodejs-developers-guide-to-unix) — ~50% latency improvement over TCP loopback; PM2 and PostgreSQL drivers use Unix sockets for local IPC (MEDIUM confidence — web article, consistent with official docs)
- [Node.js `readline` documentation](https://nodejs.org/api/readline.html) — `createInterface({ input })` accepts any `Readable` stream; `net.Socket` is a `Duplex` (HIGH confidence — official docs)
- [CVE-2022-23812 — node-ipc malicious code](https://snyk.io/blog/peacenotwar-malicious-npm-node-ipc-package-vulnerability/) — Confirms `node-ipc` supply chain incident; motivation for avoiding it (HIGH confidence — Snyk security advisory)
- [@datastructures-js/priority-queue npm](https://www.npmjs.com/package/@datastructures-js/priority-queue) — v6.3.5, 285K weekly downloads, heap-based, TypeScript support (MEDIUM confidence — npm registry, fetched via WebSearch; version current as of research date)
- [esbuild API documentation](https://esbuild.github.io/api/) — Multiple entry points require `outdir`, object syntax for named outputs (HIGH confidence — official esbuild docs)
- Node.js 22.21.1 installed — `node --version` confirmed on host machine (HIGH confidence — direct execution)
- Existing `src/llm/adapter.ts`, `src/llm/pipeline.ts`, `src/llm/prompts.ts` — Integration points inspected directly; broker reuses all three without modification (HIGH confidence — live codebase inspection)

---

*Stack research for: FileScopeMCP v1.2 LLM Broker — new capability additions only*
*Researched: 2026-03-21*
