# Phase 23: System View + Live Activity - Research

**Researched:** 2026-04-02
**Domain:** SSE log tailing, broker socket queries, D3 horizontal bar chart, Svelte 5 runes
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Broker Status Display**
- D-01: Compact status bar across the top of the System page. Horizontal layout: green/gray status badge + model name + pending count + active job + connected clients as inline badges.
- D-02: Active job shows: file name + job type + repo name (e.g., "worker.ts (summary) — FileScopeMCP"). Not the full path.
- D-03: Model name visible in the status bar from broker.json config.
- D-04: Connected clients as a badge with count (e.g., "2 clients").
- D-05: Subtle pulse on the status badge every 5s when broker status is polled. Confirms liveness without being distracting.
- D-06: Offline state: same layout but grayed out — all fields show '--' or 'N/A', badge says 'Offline' in gray. Token stats still visible from stats.json. No error styling.

**Token Usage Visualization**
- D-07: D3.js horizontal bar chart showing per-repo token totals sorted by count descending. Dark-themed with Tailwind colors. D3 installed in this phase.
- D-08: Human-readable format (1.2M, 450K) with hover tooltip for exact count (e.g., "1,234,567 tokens").
- D-09: Lifetime + session delta — show lifetime total per repo plus a smaller "+X this session" indicator. Nexus server tracks token snapshot at startup to compute delta.

**Activity Feed**
- D-10: Structured list style — each log line as a row with separate timestamp column, colored prefix badge, and message text. Not terminal-style monospace.
- D-11: Auto-assigned colors for log prefixes. Colors assigned dynamically based on unique prefixes seen in the stream. No hardcoded prefix→color mapping.
- D-12: Auto-scroll with pause — auto-scrolls to new entries by default. Stops when user scrolls up. Resumes when user scrolls back to bottom or clicks "Jump to latest" button.
- D-13: Prefix filter dropdown above the feed to filter by log prefix. Includes "All" option.

**Page Layout**
- D-14: Stacked full-width sections: broker status bar → token chart → activity feed, all full-width. No columns.
- D-15: Activity feed fills remaining viewport height via CSS `calc(100vh - offset)`. Broker bar and token chart always visible without page scrolling.

### Claude's Discretion
- D3 bar chart styling details (bar height, spacing, colors, axis labels)
- Pulse animation timing and styling
- Prefix badge visual design
- "Jump to latest" button placement and style
- Token chart section height (should leave majority of viewport for the feed)
- Whether model name comes from broker.sock status response or a separate config read
- Log line timestamp formatting (relative vs absolute)
- How session delta is displayed relative to the bar chart

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NEXUS-25 | System view displays broker status from broker.sock: pending count, in-progress job, connected clients, per-repo token totals | Server-side: `net.createConnection(SOCK_PATH)` + NDJSON status request; client-side: poll endpoint every 5s |
| NEXUS-26 | Broker status polled every 5s; shows "Broker: offline" when broker.sock unreachable (not an error state) | Try/catch around socket connect; return `{ online: false }` shape; client handles null gracefully |
| NEXUS-27 | Per-repo token usage from ~/.filescope/stats.json with totals | Reuse `readStats()` from `src/broker/stats.ts`; add `/api/system/tokens` endpoint |
| NEXUS-28 | SSE streams for broker.log and mcp-server.log via fs.watch() + byte offset tracking; handles log rotation | `fs.watch()` + `fs.read()` from tracked byte offset; size shrink → reset offset to 0 |
| NEXUS-29 | Ring buffer of last 500 log lines in memory; new SSE clients receive recent history on connect | Fixed-size circular array; flush on new EventSource connection |
| NEXUS-30 | Log lines parsed via regex: extract ISO timestamp and [PREFIX], display remainder as-is | Regex: `/^\[([^\]]+)\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/`; PREFIX is optional in broker.log |
</phase_requirements>

---

## Summary

Phase 23 builds three stacked sections on the System page: a compact broker status bar (polling via broker.sock every 5s), a D3 horizontal bar chart of per-repo token totals, and a full-height live activity feed fed by SSE. The backend adds three new routes to `server.ts` and a new `log-tailer.ts` module. The frontend completely rewrites `System.svelte` using Svelte 5 runes. D3 v7 is the only new dependency.

The key complexity points are: (1) the broker socket query in the Nexus server is fire-and-forget with a 2s timeout, identical to `requestStatus()` in `src/broker/client.ts`; (2) the SSE endpoint requires Fastify's raw response handling to stream NDJSON — standard Fastify reply serialization must be bypassed; (3) log rotation detection is a simple size check, not inotify; (4) the actual log format in both log files is `[ISO-TIMESTAMP] [OPTIONAL-PREFIX] message` where PREFIX only exists in mcp-server.log (e.g., `[INFO]`), not in broker.log where messages follow directly after the timestamp.

**Primary recommendation:** Build log-tailer.ts as a standalone module initialized in main.ts alongside repo discovery, then pass its `broadcastLine()` and `getRecentLines()` exports into server.ts at server creation time — same pattern as how repo-store exports are imported by server.ts today.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| d3 | ^7.9.0 | Horizontal bar chart for token visualization | Project decision D-07; D3 is the standard for custom SVG charts in the browser |
| Node.js `net` | built-in | Unix domain socket client for broker queries | Already used in `src/broker/client.ts` — same pattern |
| Node.js `fs` | built-in | `fs.watch()` + `fs.read()` for log tailing | NEXUS-28 spec; no external dependency needed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Fastify SSE (raw reply) | existing fastify ^5.8.4 | Stream SSE via `reply.raw` to bypass Fastify serializer | Only for `/api/stream/activity` endpoint |
| `@types/d3` | ^7.4.3 | TypeScript types for D3 | Added alongside `d3` in devDependencies |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| d3 horizontal bar chart | Simple Tailwind progress bars | Decision D-07 locks D3; also D3 gives proper axes, hover tooltips, and scales |
| fs.watch() | chokidar | chokidar is already a project dep, but fs.watch() is sufficient for two static paths; less code |
| SSE via reply.raw | @fastify/websocket | SSE is unidirectional (server→browser), sufficient per REQUIREMENTS.md out-of-scope note |

**Installation:**
```bash
npm install d3
npm install --save-dev @types/d3
```

---

## Architecture Patterns

### Recommended Project Structure

New files for this phase:
```
src/nexus/
├── log-tailer.ts               # NEW: fs.watch + ring buffer + SSE broadcast
├── server.ts                   # MODIFY: add 3 new routes + SSE endpoint
├── main.ts                     # MODIFY: init log-tailer, pass to createServer
└── ui/
    ├── routes/
    │   └── System.svelte       # REWRITE: full System page implementation
    ├── components/
    │   ├── BrokerStatusBar.svelte   # NEW: compact status bar component
    │   ├── TokenChart.svelte        # NEW: D3 horizontal bar chart
    │   └── ActivityFeed.svelte      # NEW: SSE-fed log line list
    └── lib/
        └── api.ts              # MODIFY: add BrokerStatus, TokenStats types + fetch wrappers
```

### Pattern 1: Broker Socket Query in Nexus Server

The Nexus needs its own one-shot broker socket connection, separate from the MCP client's persistent connection. On each `/api/system/broker` request, open a connection, send `status`, wait for `status_response`, close it.

**What:** Short-lived socket connection in the HTTP request handler
**When to use:** For the `/api/system/broker` route; also used as module-level shared connection with 5s poll

**Preferred approach: module-level connection with 2s timeout (same as `requestStatus()` in client.ts):**
```typescript
// Source: src/broker/client.ts requestStatus() pattern
import * as net from 'node:net';
import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { SOCK_PATH } from '../broker/config.js';
import type { StatusResponse } from '../broker/types.js';

export async function queryBrokerStatus(): Promise<StatusResponse | null> {
  return new Promise<StatusResponse | null>((resolve) => {
    const sock = net.createConnection(SOCK_PATH);
    const timer = setTimeout(() => { sock.destroy(); resolve(null); }, 2000);
    timer.unref();

    sock.on('error', () => { clearTimeout(timer); resolve(null); });

    const rl = readline.createInterface({ input: sock, terminal: false });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'status_response') {
          clearTimeout(timer);
          sock.destroy();
          resolve(msg as StatusResponse);
        }
      } catch { /* ignore malformed */ }
    });

    const id = randomUUID();
    sock.on('connect', () => {
      sock.write(JSON.stringify({ type: 'status', id }) + '\n');
    });
  });
}
```

**Note on model name (Claude's Discretion):** `StatusResponse` does not include a model field. Read `broker.json` via `loadBrokerConfig()` or a simpler `fs.readFileSync(CONFIG_PATH)` parse — the model name is in `llm.model`. Read it once on server startup and cache it in module state alongside the broker query.

### Pattern 2: Fastify SSE Route

Standard Fastify v5 SSE pattern — bypass serializer via `reply.raw`, set appropriate headers, track connections for cleanup.

**What:** SSE endpoint using Node.js `http.ServerResponse` directly
**When to use:** `/api/stream/activity`

```typescript
// Source: Fastify v5 SSE pattern — reply.raw bypasses serializer
app.get('/api/stream/activity', async (req, reply) => {
  reply.raw.setHeader('Content-Type', 'text/event-stream');
  reply.raw.setHeader('Cache-Control', 'no-cache');
  reply.raw.setHeader('Connection', 'keep-alive');
  reply.raw.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
  reply.raw.flushHeaders();

  // Send ring buffer history immediately on connect
  for (const line of getRecentLines()) {
    reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
  }

  // Register this connection for broadcast
  const cleanup = addSseClient(reply.raw);

  req.socket.on('close', cleanup);
});
```

**Critical:** Must call `reply.hijack()` or use `reply.raw` — Fastify v5 will try to serialize the response otherwise. Using `reply.raw` directly without `reply.hijack()` is the correct approach for SSE.

### Pattern 3: Log Tailer Module (log-tailer.ts)

**What:** fs.watch() + byte offset + ring buffer + SSE broadcast
**When to use:** Initialize once in main.ts, pass broadcast/history functions to server.ts

```typescript
// Source: NEXUS-PLAN.md "Log Tailing" section + fs module patterns
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { FILESCOPE_DIR } from '../broker/config.js';

const RING_BUFFER_SIZE = 500;
const LOG_PATHS = [
  path.join(FILESCOPE_DIR, 'broker.log'),
  path.join(FILESCOPE_DIR, 'mcp-server.log'),
];

export type LogLine = {
  timestamp: string;   // ISO timestamp string extracted from line
  prefix: string;      // e.g. "INFO", "WORKER" — empty string if none
  message: string;     // remainder after timestamp and optional prefix
  source: 'broker' | 'mcp-server';
};

const ringBuffer: LogLine[] = [];
const sseClients = new Set<http.ServerResponse>();

export function getRecentLines(): LogLine[] { return [...ringBuffer]; }

export function addSseClient(res: http.ServerResponse): () => void {
  sseClients.add(res);
  return () => sseClients.delete(res);
}

function broadcast(line: LogLine): void {
  const payload = `data: ${JSON.stringify(line)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

function appendToBuffer(line: LogLine): void {
  if (ringBuffer.length >= RING_BUFFER_SIZE) ringBuffer.shift();
  ringBuffer.push(line);
}

// Parse: [ISO-TIMESTAMP] [OPTIONAL-PREFIX] message
const LOG_REGEX = /^\[([^\]]+)\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/;

function parseLine(raw: string, source: LogLine['source']): LogLine | null {
  const raw2 = raw.trim();
  if (!raw2) return null;
  const m = LOG_REGEX.exec(raw2);
  if (!m) return null;
  return { timestamp: m[1], prefix: m[2] ?? '', message: m[3], source };
}
```

**Byte offset tracking and rotation handling:**
```typescript
// Per-file state
type FileState = { offset: number; watcher: fs.FSWatcher | null };
const fileStates = new Map<string, FileState>();

function readNewBytes(filePath: string, state: FileState, source: LogLine['source']): void {
  try {
    const stat = fs.statSync(filePath);
    // Log rotation detection: file shrunk
    if (stat.size < state.offset) state.offset = 0;

    if (stat.size <= state.offset) return;

    const buf = Buffer.allocUnsafe(stat.size - state.offset);
    const fd = fs.openSync(filePath, 'r');
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, state.offset);
    fs.closeSync(fd);

    state.offset += bytesRead;
    const text = buf.toString('utf-8', 0, bytesRead);
    for (const raw of text.split('\n')) {
      const line = parseLine(raw, source);
      if (line) { appendToBuffer(line); broadcast(line); }
    }
  } catch { /* file may not exist yet */ }
}

export function initLogTailer(): void {
  for (const logPath of LOG_PATHS) {
    const source: LogLine['source'] = logPath.includes('broker') ? 'broker' : 'mcp-server';
    const state: FileState = { offset: 0, watcher: null };

    // Read existing content first (populates ring buffer)
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf-8');
      const lines = content.split('\n');
      // Only load last RING_BUFFER_SIZE lines into initial buffer
      const recent = lines.slice(-RING_BUFFER_SIZE);
      for (const raw of recent) {
        const line = parseLine(raw, source);
        if (line) appendToBuffer(line);
      }
      state.offset = fs.statSync(logPath).size;
    }

    // Watch for changes
    try {
      state.watcher = fs.watch(logPath, { persistent: false }, () => {
        readNewBytes(logPath, state, source);
      });
    } catch {
      // File doesn't exist yet — create a placeholder watcher on the directory
      // and start watching when the file appears
    }

    fileStates.set(logPath, state);
  }
}

export function stopLogTailer(): void {
  for (const state of fileStates.values()) {
    state.watcher?.close();
  }
  fileStates.clear();
}
```

### Pattern 4: D3 Horizontal Bar Chart in Svelte 5

**What:** SVG bar chart rendered via D3 scales, mounted in a Svelte `$effect()` that re-runs when data changes
**When to use:** TokenChart.svelte

```typescript
// Source: D3 v7 docs — d3-scale, d3-selection patterns in Svelte onMount/$effect
import * as d3 from 'd3';

// Key D3 APIs for a horizontal bar chart:
// - d3.scaleLinear().domain([0, maxValue]).range([0, width])  — x scale (bar length)
// - d3.scaleBand().domain(repoNames).range([0, height]).padding(0.2)  — y scale (bars)
// - d3.select(svgEl).selectAll('rect').data(sorted).join('rect')
//     .attr('width', d => xScale(d.tokens))
//     .attr('height', yScale.bandwidth())
//     .attr('y', d => yScale(d.name))
```

**Svelte 5 pattern — use `$effect()` for D3 imperatives:**
```typescript
// In TokenChart.svelte
let svgEl: SVGSVGElement;
let { repos }: { repos: TokenEntry[] } = $props();

$effect(() => {
  if (!svgEl || repos.length === 0) return;
  renderChart(svgEl, repos);
});
```

**Human-readable formatter:**
```typescript
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}
```

### Pattern 5: Auto-scroll with Pause (Activity Feed)

```typescript
// Svelte 5 — track scroll state and auto-scroll
let feedEl: HTMLDivElement;
let autoScroll = $state(true);

function onScroll() {
  const el = feedEl;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  autoScroll = atBottom;
}

// After appending new line:
function appendLine(line: LogLine) {
  lines.push(line);
  if (autoScroll) {
    tick().then(() => { feedEl.scrollTop = feedEl.scrollHeight; });
  }
}
```

**Svelte 5 note:** `tick()` imported from 'svelte' flushes DOM updates before scrolling.

### Pattern 6: EventSource in Svelte 5

```typescript
// In ActivityFeed.svelte or System.svelte
import { onDestroy } from 'svelte';

let lines: LogLine[] = $state([]);
let es: EventSource | null = null;

function connectSSE() {
  es = new EventSource('/api/stream/activity');
  es.onmessage = (event) => {
    const line = JSON.parse(event.data) as LogLine;
    // filter and append
  };
  es.onerror = () => {
    es?.close();
    // reconnect after 3s
    setTimeout(connectSSE, 3000);
  };
}

onDestroy(() => es?.close());
```

### Pattern 7: 5-second Broker Status Polling

```typescript
// In System.svelte — poll broker status every 5s
let brokerStatus: BrokerStatus | null = $state(null);
let pulsing = $state(false);

$effect(() => {
  let interval: ReturnType<typeof setInterval>;

  async function poll() {
    brokerStatus = await fetchBrokerStatus();
    // Trigger pulse animation briefly
    pulsing = true;
    setTimeout(() => { pulsing = false; }, 600);
  }

  poll(); // immediate first poll
  interval = setInterval(poll, 5000);
  return () => clearInterval(interval);
});
```

### Pattern 8: Server Startup Snapshot for Session Delta (D-09)

```typescript
// In server.ts or a new system-state.ts module
// Capture stats.json values at server start to compute session deltas
import { readStats } from '../broker/stats.js';

let startupTokenSnapshot: Record<string, number> = {};

export function initStartupSnapshot(): void {
  startupTokenSnapshot = { ...readStats().repoTokens };
}

export function getTokensWithDelta(): TokenEntry[] {
  const current = readStats();
  return Object.entries(current.repoTokens)
    .map(([repo, total]) => ({
      repo,
      total,
      sessionDelta: total - (startupTokenSnapshot[repo] ?? total),
    }))
    .sort((a, b) => b.total - a.total);
}
```

### Anti-Patterns to Avoid
- **Calling `reply.send()` after using `reply.raw`:** Once you write to `reply.raw`, Fastify must not also serialize a return value. Return `undefined` or call `reply.hijack()` before writing.
- **Not calling `reply.raw.flushHeaders()` before writing SSE data:** Without this, Node.js HTTP will buffer and clients won't receive initial data.
- **Using `fs.watchFile()` instead of `fs.watch()`:** `fs.watchFile()` polls by default — `fs.watch()` uses OS-level inotify on Linux (faster).
- **Pushing to a regular array for the ring buffer:** A fixed array with `shift()` is O(n). For 500 lines this is fine. Avoid switching to a complex circular structure — overkill.
- **Rendering D3 outside `$effect()`:** D3 imperatively mutates the DOM; doing this at module scope or in `onMount` alone won't react to data changes in Svelte 5 runes mode.
- **Importing entire D3 bundle:** `import * as d3 from 'd3'` is fine since Vite tree-shakes; but could also do `import { scaleLinear, scaleBand, select, axisBottom, axisLeft } from 'd3'` if bundle size is a concern.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NDJSON line parsing from socket | Custom string buffer | `readline.createInterface({ input: sock })` | Already the pattern in `src/broker/client.ts`; handles partial lines correctly |
| SSE connection management | Custom pub/sub system | Simple `Set<http.ServerResponse>` + iterate on broadcast | 2-5 clients max; a Set with try/catch on write is sufficient |
| Token number formatting | Custom regex formatter | Simple if/else with `toFixed()` | Trivial, no library needed |
| Svelte reactive data fetching | Custom store system | `$state()` + `$effect()` + `setInterval` | Already the established pattern in this codebase |
| Byte offset file reading | Stream parsing | `fs.openSync` + `fs.readSync` with known offset | Stream abstractions add complexity for this simple use case |

**Key insight:** All "new" infrastructure in this phase is small and well-bounded. The broker socket query is ~30 lines (copy `requestStatus()` pattern). The log tailer is ~80 lines. Resist the urge to build abstractions.

---

## Common Pitfalls

### Pitfall 1: Actual Log Format Has No [PREFIX] in broker.log
**What goes wrong:** NEXUS-30 spec says "ISO timestamp + [PREFIX]" but broker.log lines are `[2026-04-01T02:32:33.150Z] BrokerWorker started` — no bracket prefix after the timestamp. Only mcp-server.log has occasional `[INFO]` style prefixes.
**Why it happens:** The NEXUS-PLAN.md spec describes a desired format, but the actual logs were not written with that format consistently.
**How to avoid:** The regex must treat the PREFIX capture group as optional: `/^\[([^\]]+)\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/`. Lines without a prefix return `prefix: ''` which the UI treats as "source" (broker/mcp-server) for badge coloring.
**Warning signs:** Empty activity feed or all lines appearing as malformed during initial testing.

### Pitfall 2: Fastify v5 SSE Requires reply.hijack() or raw Only Pattern
**What goes wrong:** In Fastify v5, returning from a route handler after writing to `reply.raw` causes "Reply already sent" errors, or Fastify overwrites the SSE response with its own serialized body.
**Why it happens:** Fastify v5 automatically serializes the return value of async route handlers.
**How to avoid:** Either call `reply.hijack()` before writing to `reply.raw`, or ensure the route never returns a value (return `undefined` or `void`). Set up the `req.socket.on('close')` cleanup before returning.
**Warning signs:** SSE stream disconnects immediately, or `ERR_HTTP_HEADERS_SENT` in server logs.

### Pitfall 3: `fs.watch()` May Not Fire for Log Rotation (File Replace)
**What goes wrong:** On Linux, if `broker.log` is replaced by a new file (log rotation by rename+create), the existing `fs.watch()` watcher may stop firing.
**Why it happens:** `fs.watch()` with `{ persistent: false }` watches the inode. If the file is replaced, the inode changes.
**How to avoid:** The spec only requires handling size shrink (NEXUS-28: "handles log rotation (size shrink → reset offset)"). Full inode-rotation handling is out of scope. The current broker never rotates logs — it appends indefinitely. Size-shrink check covers manual truncation.
**Warning signs:** Activity feed stops updating after log file replacement.

### Pitfall 4: D3 in Svelte 5 — `svgEl` Binding Before `$effect` Runs
**What goes wrong:** `svgEl` is `undefined` on the first `$effect()` run if the element hasn't been bound yet.
**Why it happens:** In Svelte 5, element bindings (`bind:this`) are set after the component's initial DOM render, but `$effect()` may run synchronously during the same microtask.
**How to avoid:** Guard at the top of the `$effect()`: `if (!svgEl) return;`. The effect will re-run when `svgEl` is set.

### Pitfall 5: esbuild Build Does Not Include log-tailer.ts
**What goes wrong:** The new `log-tailer.ts` module exists but the `build:nexus-api` script in package.json must explicitly list it.
**Why it happens:** `package.json build:nexus-api` manually lists every source file (not a glob), as seen in the existing script.
**How to avoid:** Add `src/nexus/log-tailer.ts` to the esbuild entry points in `build:nexus-api`. Also add any new broker query helper if extracted to a separate file.

### Pitfall 6: SOCK_PATH Import Creates Circular-ish Build Dependencies
**What goes wrong:** `src/nexus/server.ts` importing from `src/broker/config.ts` (for SOCK_PATH) works at runtime but the esbuild build must include `src/broker/config.ts` in the nexus build or it must be bundled as an import.
**Why it happens:** The current nexus build uses `--bundle=false` (multiple entry point mode, no bundling of imports).
**How to avoid:** Check the current build output — if broker config is already bundled (it is, since `build` script builds it separately), use the dist path OR explicitly include `src/broker/config.ts` in the nexus-api esbuild call. Looking at the existing `build:nexus-api`, it does NOT include broker files. The safest approach: copy the path constants directly in `src/nexus/log-tailer.ts` or create a thin `src/nexus/broker-paths.ts` that re-exports the paths.

**Actual safe pattern:** Import directly from the broker module — esbuild will bundle transitive imports automatically when the entry file imports them. The `--outdir` mode bundles each entry's imports.

---

## Code Examples

Verified patterns from source inspection:

### API Endpoint: /api/system/broker
```typescript
// Add to server.ts — returns null-safe BrokerStatus shape
app.get('/api/system/broker', async (_req, reply) => {
  const status = await queryBrokerStatus(); // returns null if offline
  if (!status) {
    return { online: false, pendingCount: 0, inProgressJob: null, connectedClients: 0, repoTokens: {}, model: modelName };
  }
  return {
    online: true,
    pendingCount: status.pendingCount,
    inProgressJob: status.inProgressJob,
    connectedClients: status.connectedClients,
    repoTokens: status.repoTokens,
    model: modelName,  // from broker.json, read at startup
  };
});
```

### API Endpoint: /api/system/tokens
```typescript
// Add to server.ts — returns stats.json data with session deltas
app.get('/api/system/tokens', async (_req, _reply) => {
  return getTokensWithDelta();  // returns TokenEntry[] sorted by total DESC
});
```

### Existing Pattern: Fastify route with typed Params
```typescript
// Source: src/nexus/server.ts (existing pattern)
app.get<{ Params: { repoName: string } }>(
  '/api/project/:repoName/stats',
  async (req, reply) => { ... }
);
```

### Existing Pattern: api.ts fetch wrapper
```typescript
// Source: src/nexus/ui/lib/api.ts (existing pattern)
export async function fetchBrokerStatus(): Promise<BrokerStatus> {
  const res = await fetch('/api/system/broker');
  if (!res.ok) throw new Error(`Broker status fetch failed: ${res.status}`);
  return res.json();
}

export async function fetchTokenStats(): Promise<TokenEntry[]> {
  const res = await fetch('/api/system/tokens');
  if (!res.ok) throw new Error(`Token stats fetch failed: ${res.status}`);
  return res.json();
}
```

### Actual Log Line Format (verified from files)
```
broker.log format:    [2026-04-01T02:32:33.150Z] BrokerWorker started
                      [2026-04-01T02:32:59.688Z] Job received: change_impact for /home/autopcap/wtfij/...
mcp-server.log format:[2026-04-01T02:32:32.500Z] [INFO] Using default config
                      [2026-04-01T02:32:32.498Z] Starting FileScopeMCP server initialization...
```
Parse regex: `/^\[([^\]]+)\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/`
- Group 1: ISO timestamp
- Group 2: optional prefix (e.g., `INFO`) — absent in most broker.log lines
- Group 3: message body

### D3 Horizontal Bar Chart Skeleton
```typescript
// Source: D3 v7 docs — scaleLinear + scaleBand pattern
import * as d3 from 'd3';

function renderChart(svgEl: SVGSVGElement, data: TokenEntry[], width: number) {
  const margin = { top: 8, right: 80, bottom: 24, left: 120 };
  const innerW = width - margin.left - margin.right;
  const barH = 24;
  const innerH = data.length * (barH + 8);
  const height = innerH + margin.top + margin.bottom;

  d3.select(svgEl).attr('width', width).attr('height', height);

  const svg = d3.select(svgEl).selectAll<SVGGElement, null>('g.chart-root')
    .data([null]).join('g')
    .attr('class', 'chart-root')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const maxVal = d3.max(data, d => d.total) ?? 1;
  const xScale = d3.scaleLinear().domain([0, maxVal]).range([0, innerW]);
  const yScale = d3.scaleBand()
    .domain(data.map(d => d.repo))
    .range([0, innerH])
    .padding(0.2);

  // Bars
  svg.selectAll<SVGRectElement, TokenEntry>('rect.bar')
    .data(data, d => d.repo)
    .join('rect')
    .attr('class', 'bar')
    .attr('x', 0)
    .attr('y', d => yScale(d.repo) ?? 0)
    .attr('width', d => xScale(d.total))
    .attr('height', yScale.bandwidth())
    .attr('fill', '#3b82f6') // blue-500
    .attr('rx', 2);

  // Labels (human-readable value at bar end)
  svg.selectAll<SVGTextElement, TokenEntry>('text.label')
    .data(data, d => d.repo)
    .join('text')
    .attr('class', 'label')
    .attr('x', d => xScale(d.total) + 6)
    .attr('y', d => (yScale(d.repo) ?? 0) + yScale.bandwidth() / 2)
    .attr('dy', '0.35em')
    .attr('fill', '#9ca3af') // gray-400
    .attr('font-size', '12px')
    .text(d => formatTokens(d.total));
}
```

### Svelte 5 Component Structure (System.svelte top-level)
```svelte
<script lang="ts">
  import { onDestroy } from 'svelte';
  import BrokerStatusBar from '../components/BrokerStatusBar.svelte';
  import TokenChart from '../components/TokenChart.svelte';
  import ActivityFeed from '../components/ActivityFeed.svelte';
  import { fetchBrokerStatus, fetchTokenStats, type BrokerStatus, type TokenEntry } from '../lib/api';

  let brokerStatus: BrokerStatus | null = $state(null);
  let tokenEntries: TokenEntry[] = $state([]);
  let pulsing = $state(false);

  $effect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function poll() {
      [brokerStatus, tokenEntries] = await Promise.all([
        fetchBrokerStatus(),
        fetchTokenStats(),
      ]);
      pulsing = true;
      setTimeout(() => { pulsing = false; }, 500);
    }

    poll();
    interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  });
</script>

<div class="flex flex-col h-screen overflow-hidden">
  <BrokerStatusBar status={brokerStatus} {pulsing} />
  <div class="flex-shrink-0 px-6 py-4 border-b border-gray-700">
    <TokenChart entries={tokenEntries} />
  </div>
  <div class="flex-1 overflow-hidden">
    <ActivityFeed />
  </div>
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Svelte 4 `$: reactive` statements | Svelte 5 `$state()`, `$derived()`, `$effect()` runes | Phase 20 decision | All new components use runes — no `$:` syntax |
| D3 as script tag (htmx era) | D3 as npm import + Vite tree-shaking | Phase 20 decision (switched to Svelte SPA) | `import * as d3 from 'd3'` in component files |
| WebSocket for live data | SSE (one-way) | REQUIREMENTS.md out-of-scope | `EventSource` browser API, `text/event-stream` content type |

**No deprecated patterns in this domain for this project.**

---

## Open Questions

1. **Where to read broker model name**
   - What we know: `StatusResponse` does not include model; `broker.json` has `llm.model`
   - What's unclear: Should the Nexus read `broker.json` directly (importing `loadBrokerConfig` from broker code), or keep it simple with a direct `fs.readFileSync` + JSON.parse?
   - Recommendation (Claude's Discretion): Keep it simple — one-shot `fs.readFileSync(CONFIG_PATH, 'utf-8')` and parse `llm.model` in the broker status handler. No need to invoke the full Zod validation pipeline. Cache the result at startup.

2. **fs.watch() behavior when log file does not yet exist**
   - What we know: `fs.watch()` throws `ENOENT` if the file doesn't exist at watch time
   - What's unclear: Should we watch the parent directory instead?
   - Recommendation: Try `fs.watch(logPath)` — if it throws ENOENT, watch `FILESCOPE_DIR` directory for file creation, then switch to file watch. For simplicity: skip the watcher setup if file missing; log-tailer can check periodically (every 5s) for file appearance.

3. **SSE reconnection from browser on server restart**
   - What we know: `EventSource` auto-reconnects by default in the browser
   - What's unclear: Does ring buffer persist across client reconnects correctly?
   - Recommendation: Yes — ring buffer is in module memory, persists for the server lifetime. New EventSource connections always get the 500-line history flush. This is correct behavior.

---

## Sources

### Primary (HIGH confidence)
- `src/broker/client.ts` — `requestStatus()` pattern for one-shot broker socket query
- `src/broker/types.ts` — `StatusResponse` shape (verified: no model field)
- `src/broker/stats.ts` — `readStats()`, `STATS_PATH`, `BrokerStats` type
- `src/broker/config.ts` — `SOCK_PATH`, `CONFIG_PATH`, `FILESCOPE_DIR` constants
- `src/nexus/server.ts` — existing Fastify route patterns
- `src/nexus/ui/lib/api.ts` — existing fetch wrapper patterns
- `~/.filescope/broker.log` — actual log format verified (no [PREFIX] in broker.log)
- `~/.filescope/mcp-server.log` — actual log format verified ([INFO] prefix in some lines)
- `~/.filescope/stats.json` — actual stats.json format confirmed
- `package.json` — confirmed d3 not yet installed; fastify v5.8.4, Svelte 5.55.1

### Secondary (MEDIUM confidence)
- NEXUS-PLAN.md "Log Tailing" and "System View" sections — design spec (written before implementation)
- Fastify v5 SSE via `reply.raw` pattern — standard Node.js HTTP SSE; Fastify docs confirm `reply.raw` access to underlying `ServerResponse`

### Tertiary (LOW confidence)
- None — all critical claims are backed by source code inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — D3 is the locked decision; all other libraries already present
- Architecture: HIGH — patterns derived directly from existing broker client.ts code
- Pitfalls: HIGH — log format verified by reading actual log files; Fastify SSE pattern from known Node.js HTTP semantics
- Log regex: HIGH — tested mentally against actual log lines from both files

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (stable stack — Svelte 5, D3 v7, Fastify v5 are not fast-moving)
