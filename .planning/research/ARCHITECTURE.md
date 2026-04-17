# Architecture Research

**Domain:** Production hardening of an existing MCP server + standalone LLM broker
**Researched:** 2026-04-17
**Confidence:** HIGH

---

## Existing System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Claude Code (MCP host)                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │             MCP stdio JSON-RPC (per-repo process)                    │    │
│  └─────────────────────────┬────────────────────────────────────────────┘    │
└───────────────────────────-┼─────────────────────────────────────────────────┘
                             │ stdin/stdout
┌────────────────────────────▼─────────────────────────────────────────────────┐
│                    dist/mcp-server.js (MCP mode)                              │
│                                                                               │
│  StdioTransport  ──▶  McpServer (SDK v1.27.1)                                │
│                         │                                                     │
│                         ▼  registerTools() — 14 tools via server.tool()      │
│                    ServerCoordinator                                           │
│                    ┌─────────────────────────────────────────┐                │
│                    │  AsyncMutex (serializes tree mutations)  │                │
│                    │  FileWatcher (chokidar, 2s debounce)    │                │
│                    │  ChangeDetector (AST + LLM diff)        │                │
│                    │  CascadeEngine                           │                │
│                    │  BrokerClient (connect/submit)           │                │
│                    └──────────────────┬──────────────────────┘                │
│                                      │                                        │
│                    ┌─────────────────▼──────────────────────┐                │
│                    │  SQLite (.filescope/data.db)             │                │
│                    │  drizzle-orm + better-sqlite3, WAL mode  │                │
│                    │  tables: files, file_dependencies,       │                │
│                    │          file_communities, schema_version│                │
│                    └─────────────────────────────────────────┘                │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Unix socket IPC (NDJSON)
                                       │ ~/.filescope/broker.sock
┌──────────────────────────────────────▼───────────────────────────────────────┐
│                    dist/broker/main.js (singleton daemon)                     │
│                                                                               │
│  BrokerServer (net.Server)                                                    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  PriorityQueue (binary heap, dedup map, lazy deletion)               │    │
│  │  BrokerWorker (serial Ollama calls via Vercel AI SDK)                │    │
│  │  PID guard + stale socket cleanup on startup                         │    │
│  │  Stats persistence (~/.filescope/stats.json)                         │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│                                                                               │
│  Lifecycle files:                                                             │
│    ~/.filescope/broker.sock   — Unix domain socket                           │
│    ~/.filescope/broker.pid    — PID file (live guard)                        │
│    ~/.filescope/broker.log    — structured log                               │
│    ~/.filescope/broker.json   — config (auto-copied from broker.default.json)│
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities (Existing)

| Component | Responsibility | Key Files |
|-----------|---------------|-----------|
| `StdioTransport` | Custom stdio JSON-RPC transport with 10MB buffer guard | `src/mcp-server.ts` |
| `McpServer` (SDK) | MCP protocol, tool dispatch, `listChanged` notification | `src/mcp-server.ts` |
| `ServerCoordinator` | All orchestration state: init, file tree, watcher, broker connect | `src/coordinator.ts` |
| `registerTools()` | Binds 14 MCP tools to coordinator methods + repository calls | `src/mcp-server.ts` |
| `AsyncMutex` | Serializes all tree mutations (watcher + integrity sweep) | `src/coordinator.ts` |
| `FileWatcher` | chokidar wrapper, 2s debounce, `.filescopeignore` support | `src/file-watcher.ts` |
| `ChangeDetector` | Tree-sitter AST diff for TS/JS/Python/Rust/C/C++; LLM fallback | `src/change-detector/` |
| `CascadeEngine` | BFS staleness propagation through dependency graph | `src/cascade/cascade-engine.ts` |
| `BrokerClient` | Unix socket client, reconnect loop, auto-spawn broker if absent | `src/broker/client.ts` |
| `BrokerServer` | Net.Server over Unix socket, routes submit/status to queue+worker | `src/broker/server.ts` |
| `PriorityQueue` | Binary heap with dedup map (repoPath+filePath+jobType), lazy deletion | `src/broker/queue.ts` |
| `BrokerWorker` | Serial LLM call loop, AbortController timeout, result callbacks | `src/broker/worker.ts` |
| `Repository` | All SQL via drizzle-orm; hides DB from callers | `src/db/repository.ts` |
| `LanguageConfig` | O(1) dispatch to tree-sitter or regex extractor per extension | `src/language-config.ts` |
| `CommunityDetection` | Louvain via graphology; dirty-flag cache invalidation | `src/community-detection.ts` |

---

## What v1.5 Hardening Adds: New vs Modified Components

### New Components

```
tests/
├── integration/
│   ├── file-pipeline.test.ts       — EXISTS: scan→dep→importance→cascade
│   ├── broker-lifecycle.test.ts    — NEW: spawn, connect, disconnect, crash recovery
│   └── mcp-transport.test.ts       — NEW: in-process MCP tool call contracts
└── unit/
    ├── broker-queue.test.ts        — EXISTS: full PriorityQueue coverage
    ├── parsers.test.ts             — EXISTS: all language parsers
    ├── ast-diffing.test.ts         — EXISTS: semantic diff
    ├── dependency-graph.test.ts    — EXISTS: graph operations
    ├── importance-scoring.test.ts  — EXISTS: scoring logic
    └── tool-outputs.test.ts        — EXISTS: MCP response shape contracts

scripts/
└── register-mcp.ts                 — NEW: replaces install-mcp-claude.sh with
                                           programmatic Claude Code registration
```

### Modified Components

| Component | What Changes | Why |
|-----------|-------------|-----|
| `src/mcp-server.ts` | `server.tool()` → `server.registerTool()` with `inputSchema: z.object(...)`, add `annotations` per-tool, bump `version` string to `"1.5.0"`, add `logging: {}` capability | MCP spec compliance: standard schema, tool behavior hints, structured logging capability |
| `src/mcp-server.ts` → `registerTools()` | Add `readOnlyHint: true` on read-only tools, `destructiveHint: true` on exclude_and_remove | Spec-compliant annotations help agents understand tool semantics |
| `src/broker/main.ts` | Add `process.on('uncaughtException')` and `process.on('unhandledRejection')` handlers that clean up PID/socket files before exiting | Lifecycle hardening: ensures files are cleaned up on crash, not just on SIGTERM/SIGINT |
| `src/broker/client.ts` | Replace hardcoded 500ms sleep after spawn with socket-existence poll (100ms interval, up to 3s total) | Eliminates flaky startup race on slow or loaded machines |
| `src/coordinator.ts` | Ensure `shutdown()` removes `instance.pid` even when shutdown throws | Consistent instance lifecycle; prevent stale PID accumulation |

---

## Integration Points: How New Work Plugs Into Existing Architecture

### 1. Test Infrastructure Integration

**How tests connect to existing code — no new production abstractions needed.**

The codebase already has a clean, testable architecture. `ServerCoordinator` works without MCP transport (tested in `coordinator.test.ts`). `PriorityQueue` is a pure class (tested in `broker-queue.test.ts`). Repository functions are pure SQL that need only an open DB.

The established test pattern across the codebase:

```typescript
// Established pattern (from file-pipeline.test.ts, tool-outputs.test.ts, coordinator.test.ts)
beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'test-prefix-'));
  openDatabase(path.join(tmpDir, 'test.db'));
  setProjectRoot(tmpDir);
  setConfig({ excludePatterns: [], fileWatching: { enabled: false } } as any);
});
afterAll(async () => {
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// Mock broker to prevent socket connections (from file-pipeline.test.ts)
vi.mock('../../src/broker/client.js', () => ({
  submitJob: vi.fn(), connect: vi.fn(), disconnect: vi.fn(),
  isConnected: vi.fn(() => false), requestStatus: vi.fn(),
  resubmitStaleFiles: vi.fn(),
}));
```

**New pattern for MCP transport tests** — in-process tool dispatch via `InMemoryTransport`:

```typescript
// tests/integration/mcp-transport.test.ts
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Wire real McpServer + real ServerCoordinator, bypass stdio entirely
const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
const client = new Client({ name: 'test', version: '1.0.0' }, {});
await client.connect(clientTransport);

// Call a real tool through the full dispatch path
const result = await client.callTool({ name: 'list_files', arguments: {} });
expect(result.isError).toBe(false);
```

This tests the full `registerTools()` dispatch path without spawning a process. `InMemoryTransport` is available at `@modelcontextprotocol/sdk/inMemory.js` in the installed v1.27.1 SDK. The SDK migration guide notes it is now considered internal/testing-only in v2, but the installed version fully supports it.

**What does NOT need a test:** `logger.ts`, `storage-utils.ts`, `types.ts`, `confidence.ts` — trivial constants/re-exports with no testable logic. `broker/main.ts` — entry point glue whose lifecycle is covered by `broker-lifecycle.test.ts` spawning the actual binary.

**Existing tests NOT requiring changes:**
- All 15 existing `src/**/*.test.ts` files (260+ tests) remain valid after v1.5 changes.
- The `server.tool()` → `server.registerTool()` migration is transparent to existing coordinator/repository unit tests — they don't touch the MCP server layer.

### 2. MCP Spec Compliance Integration

**Change is entirely inside `src/mcp-server.ts` — zero other files touched.**

The installed SDK v1.27.1 already provides both `server.tool()` (deprecated) and `server.registerTool()` (current). The migration is mechanical: wrap raw Zod shapes with `z.object()`, move description into the config object, add annotations.

Before (current state):
```typescript
server.tool("list_files", "List all files in the project...", {
  maxItems: z.number().optional().describe("Cap response to N files...")
}, async (params: { maxItems?: number }) => { ... });
```

After (spec-compliant):
```typescript
server.registerTool("list_files", {
  description: "List all files in the project...",
  inputSchema: z.object({
    maxItems: z.number().optional().describe("Cap response to N files...")
  }),
  annotations: { readOnlyHint: true, idempotentHint: true }
}, async ({ maxItems }) => { ... });
```

**Annotations by tool category:**

| Tool | `readOnlyHint` | `destructiveHint` | `idempotentHint` |
|------|---------------|------------------|-----------------|
| list_files, find_important_files, get_file_summary, search, status, detect_cycles, get_cycles_for_file, get_communities | true | false | true |
| set_file_summary, set_file_importance, scan_all | false | false | true |
| set_base_directory | false | false | false |
| exclude_and_remove | false | true | true |

**Logging capability:** Add `logging: {}` to the capabilities object in the `McpServer` constructor. This satisfies spec compliance for the logging capability declaration. The `ctx.mcpReq.log()` per-call API is optional — the project uses file-based logging (`enableDaemonFileLogging`), which is correct for stdio servers. The capability declaration is the compliance item; no per-call logging wiring is needed.

**Server version:** `serverInfo.version` is currently `"1.0.0"`. Bump to `"1.5.0"` to match the milestone.

**outputSchema:** Do not add `outputSchema` to all 14 tools. The tools return freeform JSON text content that varies by query result. The only candidate is the `status` tool which returns a stable shape. Add `outputSchema` only where it provides genuine agent value — likely just `status`.

### 3. Zero-Config Auto-Registration Integration

**Current state:** `install-mcp-claude.sh` writes directly to `~/.claude.json` using a bash inline Node.js script. The script is correct but requires bash to run (problematic in some WSL2 environments). Manual step after build.

**What to add:** `scripts/register-mcp.ts` compiled to `dist/scripts/register-mcp.js` via the existing esbuild pipeline. It can be run as `node dist/scripts/register-mcp.js` or hooked into `postbuild` in `package.json`.

This script:
1. Locates `~/.claude.json` (identical logic to the shell script)
2. Writes the `FileScopeMCP` entry with `node dist/mcp-server.js`
3. Is idempotent — re-running overwrites the entry, no-ops if already registered
4. Prints a single status line

This is a TypeScript port of the existing shell script, not a redesign. The shell script can remain as a fallback.

**What NOT to do:** Do not add auto-registration to the MCP server startup path (`initServer()`). Registration is a build/install-time concern, not a runtime concern. Adding it to startup would cause the server to modify its own registration config on every connection.

### 4. Broker Lifecycle Hardening Integration

**Current state:** `broker/main.ts` has SIGTERM/SIGINT handlers that call `server.shutdown()` then remove PID/socket files. `broker/client.ts` has stale socket detection and auto-spawn with a 500ms sleep.

**Gap 1: Crash cleanup.** If the broker process crashes on an uncaught exception, the SIGTERM handler never runs. Socket and PID files persist. The next spawn attempt by `spawnBrokerIfNeeded()` finds the socket, checks the PID, discovers the process is dead, and cleans up before re-spawning. This works but creates a window where the first connection attempt after a crash fails and triggers the 10s reconnect timer instead of immediately re-spawning.

Fix in `src/broker/main.ts` — add cleanup handlers before the PID file is written:

```typescript
function emergencyCleanup(): void {
  try { fs.rmSync(SOCK_PATH, { force: true }); } catch {}
  try { fs.rmSync(PID_PATH, { force: true }); } catch {}
}

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err}`);
  emergencyCleanup();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  log(`Unhandled rejection: ${reason}`);
  emergencyCleanup();
  process.exit(1);
});
```

These must be registered after the PID file is written (otherwise cleaning up a PID file that hasn't been written yet is a no-op, which is fine, but logical order matters for clarity).

**Gap 2: Spawn timing race.** `spawnBrokerIfNeeded()` uses a hardcoded `await new Promise(r => setTimeout(r, 500))` after spawning. On a loaded machine (CI, multiple active repos), the broker may take longer than 500ms to bind the socket, causing the first `attemptConnect()` to fail and fall back to the 10s reconnect timer.

Fix in `src/broker/client.ts`:

```typescript
// Replace the 500ms sleep with a socket-existence poll
const SPAWN_POLL_INTERVAL_MS = 100;
const SPAWN_POLL_MAX_ATTEMPTS = 30; // 3 seconds total

for (let i = 0; i < SPAWN_POLL_MAX_ATTEMPTS; i++) {
  if (existsSync(SOCK_PATH)) break;
  await new Promise<void>(r => setTimeout(r, SPAWN_POLL_INTERVAL_MS));
}
// Continue to attemptConnect() regardless — if socket still absent, connection
// will fail and the reconnect timer handles retry.
```

This bounds the connect latency to actual broker startup time rather than a fixed worst-case value.

**Gap 3: Concurrent instance safety** — already handled correctly. Two MCP instances calling `spawnBrokerIfNeeded()` simultaneously will both find the socket absent, both spawn the broker binary. The broker's PID guard causes the second binary to `process.exit(0)` after reading the first's PID file. No fix needed; the design is correct.

**Gap 4: Test coverage for broker lifecycle.** `broker/client.ts` and `broker/main.ts` have zero test coverage. The new `tests/integration/broker-lifecycle.test.ts` should:
- Spawn the actual broker binary (via `child_process.spawn`)
- Poll for PID file existence (confirms startup)
- Send a status request via a real Unix socket connection
- Kill the broker and verify socket + PID files are removed
- Re-spawn and verify recovery

This is the only test that must NOT mock `broker/client.ts` — it tests the real spawn/connect path.

---

## Recommended File Structure After v1.5

```
src/
├── mcp-server.ts          — MODIFIED: registerTool + annotations + logging cap
├── coordinator.ts         — MINOR: harden shutdown() PID cleanup on throw
├── broker/
│   ├── main.ts            — MODIFIED: add uncaughtException/unhandledRejection handlers
│   ├── client.ts          — MODIFIED: socket poll replaces hardcoded 500ms sleep
│   ├── server.ts          — unchanged
│   ├── worker.ts          — unchanged
│   ├── queue.ts           — unchanged
│   ├── config.ts          — unchanged
│   ├── types.ts           — unchanged
│   └── stats.ts           — unchanged
└── [all other src files]  — unchanged

tests/
├── integration/
│   ├── file-pipeline.test.ts     — EXISTS (373 lines, no changes)
│   ├── mcp-transport.test.ts     — NEW: tool contract tests via InMemoryTransport
│   └── broker-lifecycle.test.ts  — NEW: spawn/connect/shutdown/crash-recovery
└── unit/
    ├── broker-queue.test.ts      — EXISTS (416 lines, no changes)
    ├── parsers.test.ts           — EXISTS (538 lines, no changes)
    ├── ast-diffing.test.ts       — EXISTS (462 lines, no changes)
    ├── dependency-graph.test.ts  — EXISTS (287 lines, no changes)
    ├── importance-scoring.test.ts — EXISTS (325 lines, no changes)
    └── tool-outputs.test.ts      — EXISTS (447 lines, no changes)

scripts/
└── register-mcp.ts        — NEW: Node.js Claude Code auto-registration

install-mcp-claude.sh      — KEEP: still useful as bash fallback
```

---

## Data Flow Changes in v1.5

### MCP Test Data Flow (new)

```
vitest runner
    |
    v
InMemoryTransport.createLinkedPair()
    |── (serverTransport) ────────────── McpServer.connect()
    |── (clientTransport)                     |
    |                                   registerTools(server, coordinator)
    v                                         |
Client.connect(clientTransport)         coordinator.init(tmpDir)
    |                                         |
    v                                   SQLite (tmp DB pre-populated)
client.callTool({ name, arguments })
    |── JSON-RPC over in-memory ──────▶ tool handler
    |◀── tool response ───────────────────────|
    v
expect(result.content[0].text).toMatch(...)
```

No process spawn, no stdio, no timing dependencies. The full tool dispatch path is exercised including Zod input validation, coordinator delegation, and repository reads.

### Broker Lifecycle Data Flow (hardened)

```
MCP instance start
    |
    v coordinator.init() → brokerConnect() → spawnBrokerIfNeeded()
    |
    ├── existsSync(SOCK_PATH) + PID alive? → skip spawn
    ├── stale files? → rmSync both → spawn dist/broker/main.js (detached, unref'd)
    |         |
    |         v  poll existsSync(SOCK_PATH) × 30 × 100ms (up to 3s)
    |         v  (replaces hardcoded 500ms sleep)
    └── not running? → spawn → poll → attemptConnect()
              |
              v net.createConnection(SOCK_PATH)
              v on('connect') → resubmitStaleFiles()

Broker clean shutdown (SIGTERM/SIGINT):
    worker.stop() → await currentJobPromise → destroy connections → server.close()
    → rmSync(SOCK_PATH) → rmSync(PID_PATH) → process.exit(0)

Broker crash (uncaughtException/unhandledRejection):  [NEW v1.5]
    log(err) → rmSync(SOCK_PATH, force) → rmSync(PID_PATH, force) → process.exit(1)
    [next client connect attempt detects no socket → immediately respawns]
```

---

## Architectural Patterns in Use

### Pattern 1: Coordinator as Pure Orchestrator (existing, enables testing)

`ServerCoordinator` can be instantiated and `init(path)` called without any MCP transport. The MCP transport layer (`registerTools`) is a thin wrapper that delegates to coordinator. This means MCP transport tests can use `InMemoryTransport` to test actual tool dispatch in-process. The test for this pattern already exists in `coordinator.test.ts`.

### Pattern 2: Repository as DB Boundary (existing, enables testing)

All SQL goes through `src/db/repository.ts`. Tests open a real SQLite DB in `/tmp`, call repository functions directly, and verify state. MCP transport tests pre-populate the DB via repository functions and verify tool responses read from it correctly. Already established in `tool-outputs.test.ts` and `file-pipeline.test.ts`.

### Pattern 3: Broker Client as Module-Level Singleton (existing, requires mock)

`broker/client.ts` uses module-level state (`socket`, `reconnectTimer`, `repoPath`). Any test that exercises code calling broker functions must `vi.mock('../../src/broker/client.js', ...)`. The broker-lifecycle integration test is the only test that must use the real module — it tests actual spawn/connect behavior.

### Pattern 4: PID Guard as Idempotent Singleton Enforcer (existing, correct)

The broker uses `process.kill(pid, 0)` to detect if already running, then `process.exit(0)` on conflict. Concurrent spawn attempts are safe — the second process exits cleanly. No change needed. The lifecycle test must verify this: spawning twice yields one running broker and one harmless exit.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Testing MCP Tools via Subprocess Spawn

**What people do:** Spawn `dist/mcp-server.js` as a subprocess and send JSON-RPC messages via stdin/stdout to test tool outputs.

**Why it's wrong:** Requires a full build before tests run. Slow (process spawn overhead). Fragile (timing-dependent). `InMemoryTransport` provides the same coverage at 10x speed in-process.

**Do this instead:** Use `InMemoryTransport.createLinkedPair()` for MCP tool contract tests. Reserve process spawning for the broker lifecycle integration test where the actual detached-spawn behavior is what's being verified.

### Anti-Pattern 2: Mocking Repository Functions in MCP Tests

**What people do:** Mock `getFile`, `getAllFiles`, etc. to return fake data.

**Why it's wrong:** Tests the mock, not the code. Repository functions are pure SQL — a real SQLite DB in `/tmp` is fast (~1ms per operation via better-sqlite3), accurate, and confirms actual query behavior.

**Do this instead:** Pre-populate a real tmp SQLite DB and let the tool handlers query it naturally. Already established across 5+ test files.

### Anti-Pattern 3: Adding Retry Logic to Broker Spawn

**What people do:** Add retry loops with backoff around `spawnBrokerIfNeeded()` on connection failure.

**Why it's wrong:** The reconnect timer (10s interval in `startReconnectTimer()`) already handles transient failures. Adding retry at the spawn level creates two overlapping recovery mechanisms. The broker's PID guard means double-spawn is harmless but wasteful.

**Do this instead:** Keep the existing reconnect timer. Replace the 500ms sleep with a socket poll. The system self-heals without retry complexity.

### Anti-Pattern 4: Adding outputSchema to All Tools

**What people do:** Add Zod `outputSchema` to every `registerTool()` call as part of the spec compliance migration.

**Why it's wrong:** The tools return freeform JSON text content that varies by query result. Defining schemas for all 14 tools adds significant maintenance overhead for minimal agent benefit. Most agents treat tool output as text anyway.

**Do this instead:** Add `outputSchema` only to `status` (the only tool with a reliably stable response shape). Leave the other 13 tools with just `inputSchema` + `annotations`.

### Anti-Pattern 5: Registering MCP Server at Runtime

**What people do:** Have `initServer()` call the registration script to ensure the server is always registered with Claude Code.

**Why it's wrong:** The MCP server is already running — it was started by Claude Code using the registration entry. Modifying `~/.claude.json` from inside a running MCP process creates a race condition and is conceptually wrong (the server modifying the config that launched it).

**Do this instead:** Keep registration as a build/install-time step. `scripts/register-mcp.ts` runs once after `npm run build`.

---

## Integration Ordering: Build Sequence for v1.5

Based on dependencies between the four hardening areas, the correct build order is:

**1. Broker lifecycle hardening** — foundational; eliminates the biggest reliability gap first. Self-contained to `broker/main.ts` and `broker/client.ts`. No dependencies on other v1.5 work.

**2. MCP spec compliance** — self-contained to `src/mcp-server.ts`. No dependencies on testing infrastructure. Can proceed in parallel with broker hardening.

**3. Test infrastructure** — depends on the hardened broker (broker-lifecycle.test.ts is only meaningful after the crash cleanup handlers exist) and spec-compliant MCP server (mcp-transport.test.ts verifies the `registerTool` API, not the deprecated `server.tool` API). Writing tests against the old API would mean rewriting them immediately after the migration.

**4. Zero-config auto-registration** — depends on nothing except the build pipeline being stable. Implement last when everything else is confirmed working and the binary being registered is hardened.

This ordering avoids writing tests for code that is about to change and avoids writing the registration script before the binary it registers is fully hardened.

---

## Scaling Considerations

This is a local-only developer tool; traditional web scaling does not apply. The relevant dimensions are:

| Concern | Current State | v1.5 Impact |
|---------|---------------|-------------|
| Test suite execution time | ~260 tests, fast (SQLite in /tmp) | New tests add ~50-100 more; should stay under 15s total |
| Broker job throughput | Serial by design (single GPU) | Unchanged; lifecycle hardening does not affect throughput |
| Concurrent MCP instances | Multiple per repo are expected; WAL mode handles it | `instance.pid` is informational only; no enforcement needed |
| MCP response latency | Synchronous better-sqlite3 reads ~1ms | `registerTool` migration has zero performance impact |
| Socket poll overhead | 500ms sleep → 100ms poll | Strictly better; reduces connect latency on fast machines |

---

## Sources

- MCP TypeScript SDK v1.27.1 documentation via Context7 (`/modelcontextprotocol/typescript-sdk`): `registerTool`, `annotations` (readOnlyHint, destructiveHint, idempotentHint), `logging` capability, `InMemoryTransport`, migration guide from v1 to v2 API — HIGH confidence
- Direct codebase inspection (all claims verified against installed source):
  - `src/mcp-server.ts` (615 lines) — StdioTransport, McpServer init, registerTools, 14 tool definitions
  - `src/coordinator.ts` — AsyncMutex, init(), initServer(), shutdown(), broker connect
  - `src/broker/main.ts` — PID guard, SIGTERM/SIGINT handlers, startup sequence
  - `src/broker/client.ts` — spawnBrokerIfNeeded(), attemptConnect(), reconnect timer
  - `src/broker/queue.ts` + `src/broker/types.ts` — PriorityQueue, QueueJob, dedupKey
  - `src/db/schema.ts` + `src/db/repository.ts` — SQLite schema, all repository functions
  - `tests/integration/file-pipeline.test.ts` + `tests/unit/broker-queue.test.ts` — established test patterns
  - `package.json` — SDK v1.27.1 confirmed, vitest confirmed
  - Node.js SDK dist file inspection: `registerTool`, `tool`, `registerPrompt`, `InMemoryTransport` all present

---

*Architecture research for: FileScopeMCP v1.5 Production-Grade MCP Intelligence Layer*
*Researched: 2026-04-17*
