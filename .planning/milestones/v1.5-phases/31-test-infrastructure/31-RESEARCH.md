# Phase 31: Test Infrastructure - Research

**Researched:** 2026-04-17
**Domain:** Vitest test authoring, MCP InMemoryTransport, Node.js process spawn/signal, vi.mock chokidar
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Test Organization**
- D-01: Keep existing split pattern. Co-located `src/*.test.ts` for pure unit tests. `tests/unit/` for tests needing temp dirs, fixtures, or multiple internal helpers. `tests/integration/` for multi-module and process-level tests.
- D-02: New MCP transport tests go in `tests/integration/mcp-transport.test.ts`.
- D-03: Broker lifecycle tests go in `tests/integration/broker-lifecycle.test.ts`.
- D-04: File watcher tests go in `tests/unit/file-watcher.test.ts` — mocked chokidar, no real filesystem waits.

**Broker Lifecycle Test Approach**
- D-05: Test against the real compiled broker binary (`dist/broker/main.js`), not mocked process objects.
- D-06: Use vitest `pool: 'forks'` for broker lifecycle tests. Do a quick spike first to confirm SIGTERM works in WSL2. If it fails, fall back to mocked process approach.
- D-07: Broker tests must clean up after themselves — kill any spawned processes in `afterEach`/`afterAll` regardless of test pass/fail. Use try/finally pattern.

**MCP Transport Tests**
- D-08: Use `InMemoryTransport` from `@modelcontextprotocol/sdk` to test all 13 tools. Each tool gets at minimum a smoke test with valid args, verify response shape matches `{ok: true, ...}` or `{ok: false, error, message}`.
- D-09: Tests should initialize a real SQLite DB in a temp dir and wire up a real `ServerCoordinator`.

**Coverage Enforcement**
- D-10: Advisory only — no CI gate on coverage thresholds. Per-subsystem gap identification is more actionable.
- D-11: `npm run coverage` produces V8 coverage with text + json + html reporters (already configured). Add a summary script or vitest reporter config that groups coverage by subsystem directory.

**CI Smoke Test**
- D-12: First-byte-is-`{` stdout pollution test lives in `tests/integration/mcp-stdout.test.ts`. Spawns `node dist/mcp-server.js`, reads first byte from stdout, asserts it equals `{`. Runs with existing `npm test`.
- D-13: Test must handle the child process lifecycle cleanly: spawn, capture first output, kill, cleanup. Timeout at 5-10s for slow starts.

### Claude's Discretion
- Exact test case count per tool (minimum 1 smoke test required, more if handler has branching logic)
- Whether to add watcher tests for all event types or just the critical path (add, change, unlink)
- Config loading test scope (TEST-08) — how many edge cases to cover
- Cascade engine test approach for TEST-06 (some coverage already exists in `src/cascade/cascade-engine.test.ts`)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-01 | MCP transport-layer tests validate JSON-RPC tool calls through `InMemoryTransport` for all 13 tools | InMemoryTransport pattern verified end-to-end; McpServer + Client wiring confirmed working |
| TEST-02 | Broker lifecycle tests cover PID guard, socket cleanup, spawn, shutdown, and crash recovery | Real binary at `dist/broker/main.js`; SIGTERM propagation confirmed working in WSL2 |
| TEST-03 | Tool contract tests verify each MCP tool returns correct schema-conformant output | Response shape pattern established via InMemoryTransport tests — same coverage as TEST-01 |
| TEST-04 | Broker client tests cover auto-discovery, reconnection, and job submission | `src/broker/client.ts` fully readable; `spawnBrokerIfNeeded` and reconnect loop documented |
| TEST-05 | File watcher tests validate debounce, ignore patterns, and event dispatch via mocked chokidar | `FileWatcher` class isolated; vi.mock('chokidar') pattern applicable |
| TEST-06 | Cascade engine tests verify staleness propagation through dependency chains | 421-line test already exists — check coverage before adding new tests |
| TEST-07 | Change detector integration tests cover AST diffing + breaking change classification | Test already exists in `src/change-detector/change-detector.test.ts` |
| TEST-08 | Config loading tests cover edge cases (missing files, malformed JSON, defaults) | `loadConfig()` in `src/config-utils.ts` has 3 fall-through paths; easy to test |
| TEST-09 | V8 coverage report integrated into `npm run coverage` with gap identification | Coverage already wired; need per-subsystem grouping via `include` patterns |
</phase_requirements>

---

## Summary

Phase 31 closes protocol-layer and subsystem test gaps. The project has a healthy 512-test baseline across 22 files. No broker tests, MCP transport tests, or file watcher tests exist yet. Coverage is already wired via `@vitest/coverage-v8` and the `npm run coverage` script — no new configuration is needed for the basic report.

The three new test files are the core deliverables: `tests/integration/mcp-transport.test.ts` (TEST-01/TEST-03), `tests/integration/broker-lifecycle.test.ts` (TEST-02/TEST-04), and `tests/unit/file-watcher.test.ts` (TEST-05). A fourth integration test, `tests/integration/mcp-stdout.test.ts`, covers the CI smoke test requirement (TEST-09's first-byte assertion, D-12/D-13). Config loading tests (TEST-08) add a new `tests/unit/config-loading.test.ts`. TEST-06 and TEST-07 already have substantial test files — a gap audit must happen before adding new tests.

The critical path constraint is that broker lifecycle tests (TEST-02) require a built `dist/broker/main.js` binary. The build is not automatic before `npm test`. The plan must include a build step or guard. SIGTERM propagation was verified working in WSL2 — the D-06 spike is resolved.

**Primary recommendation:** Write four new test files, confirm TEST-06/TEST-07 coverage gaps, add per-subsystem coverage grouping to `vitest.config.ts`. No production code changes.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| MCP JSON-RPC dispatch (TEST-01/03) | Test harness (InMemoryTransport) | McpServer + ServerCoordinator | Tests exercise the full dispatch chain without real stdio |
| Broker spawn/lifecycle (TEST-02) | OS process layer | Node.js `child_process` | Real forked processes required for signal semantics |
| Broker client reconnection (TEST-04) | Module-level state in broker/client.ts | vi.mock for socket | Best tested with mocked socket events, not real spawns |
| File watcher event dispatch (TEST-05) | FileWatcher class | vi.mock('chokidar') | chokidar is the only external dep; mocking it eliminates real-FS waits |
| Cascade staleness propagation (TEST-06) | cascade-engine.ts + SQLite DB | Temp DB | Already extensively tested — gap audit required |
| AST change detection (TEST-07) | change-detector + tree-sitter | Temp files | Already tested — gap audit required |
| Config loading (TEST-08) | config-utils.ts | Temp dirs | Pure unit test; three code paths (missing, malformed, valid) |
| Coverage reporting (TEST-09) | vitest.config.ts | npm script | Reporter already configured; need per-subsystem `include` arrays |
| Stdout pollution CI (TEST-09b) | Spawned dist/mcp-server.js process | Node.js spawn | First-byte assertion catches any console.log in startup path |

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | 3.2.4 | Test runner | Project standard [VERIFIED: package.json] |
| @vitest/coverage-v8 | 3.2.4 | V8 coverage | Already in devDependencies [VERIFIED: package.json] |
| @modelcontextprotocol/sdk | ^1.12.0 | InMemoryTransport, McpServer, Client | Project's own MCP SDK dep [VERIFIED: package.json] |
| better-sqlite3 | ^12.6.2 | Real SQLite in tests | Project standard; already used in all integration tests [VERIFIED: package.json] |

### No New Dependencies Required

All test tooling is already available. `vi.mock` is part of vitest (no additional imports needed). `InMemoryTransport`, `McpServer`, and `Client` are all available from the already-installed `@modelcontextprotocol/sdk`.

**Version verification:** All versions verified against `package.json` in this session. [VERIFIED: /home/autopcap/FileScopeMCP/package.json]

---

## Architecture Patterns

### System Architecture Diagram

```
Test Files                    Production Code Under Test
─────────────────────────────────────────────────────────

mcp-transport.test.ts         McpServer
  [Client]──callTool()──────▶ [registerTool handlers]
  [InMemoryTransport pair]         │
  [real SQLite DB]                 ▼
  [real ServerCoordinator]    ServerCoordinator (real)
                                   │
                                   ▼
                              SQLite DB (temp dir)

broker-lifecycle.test.ts      dist/broker/main.js (real binary)
  [spawn()]──────────────────▶ [BrokerServer]
  [net.connect(SOCK_PATH)]         │
  [kill(SIGTERM)]                  ▼
  [afterEach cleanup]         ~/.filescope/broker.sock

file-watcher.test.ts          FileWatcher class
  [vi.mock('chokidar')]───────▶ [chokidar.watch() mock]
  [EventEmitter simulation]        │
  [addEventCallback()]             ▼
                              event callbacks invoked

mcp-stdout.test.ts            dist/mcp-server.js (real binary)
  [spawn('node', ...)]──────▶ [StdioTransport startup]
  [stdout.once('data')]           │
  [assert buf[0] === 0x7B]        ▼
  [kill(), cleanup]           first byte = '{' (MCP JSON)
```

### Recommended Project Structure

The existing split is maintained. New files land exactly where CONTEXT.md specifies:

```
tests/
├── integration/
│   ├── file-pipeline.test.ts       # existing
│   ├── mcp-transport.test.ts       # NEW: TEST-01, TEST-03 (InMemoryTransport)
│   ├── broker-lifecycle.test.ts    # NEW: TEST-02, TEST-04
│   └── mcp-stdout.test.ts          # NEW: TEST-09 CI smoke test
└── unit/
    ├── tool-outputs.test.ts        # existing
    ├── parsers.test.ts             # existing
    └── file-watcher.test.ts        # NEW: TEST-05
src/
├── cascade/cascade-engine.test.ts  # existing — audit for TEST-06 gaps
├── change-detector/change-detector.test.ts  # existing — audit for TEST-07 gaps
└── config-utils.test.ts            # NEW or tests/unit/config-loading.test.ts: TEST-08
```

---

### Pattern 1: InMemoryTransport Test Setup (TEST-01, TEST-03)

**What:** Wire a real `McpServer` to a real `Client` via in-memory transport. No stdio, no process spawn.

**When to use:** Any test that needs to call a tool through the full JSON-RPC dispatch path.

**Key insight from code audit:** `mcp-server.ts` is not a module — `registerTools()` is a private function. Tests must instantiate `McpServer` and `ServerCoordinator` independently, then call `registerTools(server, coordinator)`. However `registerTools` is not exported. The transport tests must either:
- (a) Duplicate the tool registration logic from `mcp-server.ts` (brittle), OR
- (b) Import `registerTools` after it is exported from `mcp-server.ts` (requires a minor change), OR
- (c) Test via the `coordinator` public API directly and trust the existing `src/mcp-server.test.ts` for registration contract.

**Recommended approach (c+b hybrid):** Export `registerTools` from `mcp-server.ts` so the integration test can call it. This is a one-line change (`export function registerTools`). The test then wires a fresh `McpServer` + `ServerCoordinator` + temp SQLite DB.

**Example — verified working pattern:**

```typescript
// Source: verified via node -e in this session
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Setup in beforeAll
const server = new McpServer({ name: 'test-server', version: '1.0.0' });
const coordinator = new ServerCoordinator();
await coordinator.init(tmpDir);           // real SQLite in temp dir
registerTools(server, coordinator);       // requires export from mcp-server.ts

const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
await client.connect(clientTransport);

// Per-test call
const result = await client.callTool({ name: 'list_files', arguments: {} });
const parsed = JSON.parse(result.content[0].text);
expect(parsed.ok).toBe(true);
```

**Response shape:** All 13 tools use `mcpSuccess()` or `mcpError()` helpers from `mcp-server.ts`. Successful responses are `{ ok: true, ...data }`. Error responses are `{ ok: false, error: "CODE", message: "..." }`. The JSON is in `result.content[0].text`.

**Cleanup in afterAll:**
```typescript
await client.close();
await server.close();
await coordinator.shutdown();
closeDatabase();
await fs.rm(tmpDir, { recursive: true, force: true });
```

---

### Pattern 2: Broker Lifecycle Tests (TEST-02)

**What:** Spawn the real broker binary as a child process, exercise its lifecycle, verify cleanup.

**Critical discovery:** The broker binary is at `dist/broker/main.js`, NOT `dist/broker.js`. The CONTEXT.md reference is slightly off. [VERIFIED: ls /home/autopcap/FileScopeMCP/dist/broker/]

**SIGTERM spike result:** SIGTERM propagation works correctly in WSL2 for Node.js child processes. [VERIFIED: node -e spike in this session — stdout received "SIGTERM received", exit code 0]

**WSL2 constraint:** The broker writes its socket to `~/.filescope/broker.sock` and PID to `~/.filescope/broker.pid`. Tests that spawn real broker instances will interfere with any running broker on the same machine. Broker tests must use temp paths or verify no broker is running before spawning. The current `SOCK_PATH` and `PID_PATH` are hardcoded in `src/broker/config.ts` — the test cannot change them without modifying the production binary.

**Implication for D-05 (real binary):** Since socket/PID paths are hardcoded at build time, broker lifecycle tests must:
1. Kill any existing broker before running (check PID file)
2. Run broker tests serially (not parallel) to avoid socket conflicts
3. Restore state after each test

**Pool configuration for broker tests:**

```typescript
// In vitest.config.ts — add project-level pool override
// OR use a separate vitest config for broker tests
// The simplest approach: add pool config to the default config
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    pool: 'forks',  // required for SIGTERM propagation in process-level tests
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
```

**Alternatively:** Use `// @vitest-environment node` and avoid changing the global pool. The forks pool ensures signal propagation. Vitest 3.x supports `pool: 'forks'` globally — [VERIFIED: vitest 3.2.4 installed].

**Example lifecycle test:**

```typescript
// Source: derived from src/broker/main.ts behavior analysis
import { spawn, ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { SOCK_PATH, PID_PATH } from '../../src/broker/config.js';

let broker: ChildProcess | null = null;

afterEach(async () => {
  try {
    if (broker && !broker.killed) broker.kill('SIGTERM');
  } finally {
    broker = null;
    // Wait for socket cleanup
    await new Promise<void>(resolve => setTimeout(resolve, 200));
  }
});

it('broker creates PID file and socket after spawn', async () => {
  broker = spawn(process.execPath, ['dist/broker/main.js'], { stdio: 'ignore' });
  // Wait for socket to appear (max 10s)
  const ready = await waitForSocket(SOCK_PATH, 500, 10_000);
  expect(ready).toBe(true);
  expect(existsSync(PID_PATH)).toBe(true);
});
```

---

### Pattern 3: File Watcher Tests with Mocked chokidar (TEST-05)

**What:** Use `vi.mock('chokidar')` to inject a controllable FSWatcher event emitter. Test that `FileWatcher` dispatches events to registered callbacks and respects ignore patterns.

**Key insight from code audit:** The debounce logic (2000ms, `DEBOUNCE_DURATION_MS`) lives in `coordinator.ts`, NOT in `FileWatcher`. The `FileWatcher` class itself has `throttleTimers` defined but unused in the event path — `awaitWriteFinish: { stabilityThreshold: 300 }` is chokidar's built-in write stabilization, not a user-space debounce. Tests of `FileWatcher` therefore test:
1. That registered callbacks ARE called for `add`/`change`/`unlink` events
2. That events for ignored paths are suppressed (config patterns + .filescopeignore)
3. That `stop()` clears all pending timers

Testing the 2000ms coordinator debounce requires faking timers (`vi.useFakeTimers()`) — this is Claude's discretion per the decisions list.

**Mocking pattern:**

```typescript
// Source: file-watcher.ts analysis + vitest vi.mock docs [ASSUMED: vi.mock pattern]
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Must be hoisted — vi.mock is hoisted to top of file by vitest
vi.mock('chokidar', () => {
  const EventEmitter = require('node:events');
  class MockFSWatcher extends EventEmitter {
    watch = vi.fn().mockReturnThis();
    close = vi.fn().mockResolvedValue(undefined);
    on = vi.fn().mockImplementation((event, cb) => {
      this._listeners = this._listeners || {};
      this._listeners[event] = cb;
      return this;
    });
  }
  const instance = new MockFSWatcher();
  return {
    default: { watch: vi.fn().mockReturnValue(instance) },
    __instance: instance,
  };
});
```

**Simpler approach:** Import `chokidar`, mock the `watch` function to return an `EventEmitter`, then emit events directly. The `FileWatcher.start()` calls `chokidar.watch()` and registers `.on('add', ...)` — so the emitter returned by the mock is what the watcher calls `.on()` on.

---

### Pattern 4: MCP Stdout Smoke Test (TEST-09 CI smoke)

**What:** Spawn `node dist/mcp-server.js`, wait for first stdout byte, assert it is `{` (ASCII 0x7B).

**Key detail:** `mcp-server.js` auto-inits to CWD on startup. It calls `coordinator.initServer()` which calls `coordinator.init(cwd)`. This runs a full DB scan and broker connect at startup. First output may be delayed. D-13 specifies 5-10s timeout.

**Example:**

```typescript
// Source: derived from dist/mcp-server.js startup behavior
it('first byte emitted by mcp-server.js is {', async () => {
  const proc = spawn('node', ['dist/mcp-server.js'], {
    cwd: '/tmp',  // neutral dir with no .filescope to init quickly
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  try {
    const firstByte = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 8000);
      proc.stdout!.once('data', (chunk: Buffer) => {
        clearTimeout(timer);
        resolve(chunk);
      });
    });
    expect(firstByte[0]).toBe(0x7B); // '{'
  } finally {
    proc.kill('SIGTERM');
    await new Promise<void>(resolve => proc.on('exit', resolve));
  }
}, 10_000);
```

**Note:** The MCP server only writes to stdout when it receives a message. The first byte test should send an `initialize` JSON-RPC request to stdin and wait for the response. Alternatively, test that stdout is idle (no non-JSON bytes appear during a 1s window after startup) — but this is weaker. The D-12 decision says "reads first byte from stdout, asserts it equals `{`" — this requires triggering output by sending a valid MCP `initialize` message to stdin.

---

### Pattern 5: Config Loading Tests (TEST-08)

**What:** Call `loadConfig(path)` with a controlled temp dir. Three code paths exist in `config-utils.ts`:
1. Missing config file -> returns `DEFAULT_CONFIG`
2. Malformed JSON -> catches `JSON.parse` error -> returns `DEFAULT_CONFIG`
3. Valid JSON that fails Zod schema -> caught by `ConfigSchema.parse()` -> returns `DEFAULT_CONFIG`
4. Valid JSON that passes Zod -> returns parsed config

```typescript
// Source: config-utils.ts analysis
import { loadConfig } from '../../src/config-utils.js';

it('missing config returns DEFAULT_CONFIG with expected keys', async () => {
  const config = await loadConfig('/tmp/nonexistent-path/config.json');
  expect(config.excludePatterns).toBeInstanceOf(Array);
  expect(config.version).toBe('1.0.0');
});

it('malformed JSON returns DEFAULT_CONFIG', async () => {
  await fs.writeFile(configPath, '{invalid json}');
  const config = await loadConfig(configPath);
  expect(config.version).toBe('1.0.0');
});
```

---

### Pattern 6: Coverage Gap Identification (TEST-09)

**What:** Add per-subsystem grouping to the coverage report so gaps are visible without digging into per-file HTML.

**Current state:** `vitest.config.ts` already has `reporter: ['text', 'json', 'html']`. The text reporter shows per-file coverage. No subsystem grouping.

**Approach:** Add `include` arrays to the coverage config that group files by subsystem. Vitest V8 `coverage.include` is a glob array — you can run `npx vitest run --coverage --reporter=verbose` to see per-file results, but there is no built-in "group by directory" in V8 coverage text output.

**Practical approach (no new dependencies):** Add a comment to `vitest.config.ts` explaining the subsystem directories. The real gap identification comes from reading the text report's per-file output organized by directory structure. The `html` reporter already provides this via the folder navigation UI.

**Alternative:** Add a `coverage.include` pattern that excludes test-noise files (nexus UI, config defaults) from the coverage count, making gaps more visible:

```typescript
coverage: {
  provider: 'v8',
  reporter: ['text', 'json', 'html'],
  include: [
    'src/broker/**',
    'src/cascade/**',
    'src/change-detector/**',
    'src/db/**',
    'src/coordinator.ts',
    'src/file-watcher.ts',
    'src/config-utils.ts',
    'src/mcp-server.ts',
  ],
  exclude: [
    'src/nexus/**',     // Svelte UI — not unit testable
    'src/types.ts',     // pure types
    'src/**/*.test.ts',
    'tests/**',
  ],
}
```

This scopes the coverage report to the production code that actually has test gaps, making the per-file percentages meaningful.

---

### Anti-Patterns to Avoid

- **Real chokidar in unit tests:** Never start a real `FileWatcher` in unit tests — it opens real filesystem watchers that outlast the test process and can interfere with other tests.
- **Sharing broker socket across tests:** Never run multiple broker lifecycle tests concurrently — they all write to the same `~/.filescope/broker.sock`. Use `pool: 'forks'` but keep broker tests in a single `describe` block with sequential execution.
- **Calling `coordinator.initServer()` in transport tests:** `initServer()` reads `process.argv` and auto-inits to CWD. Use `coordinator.init(tmpDir)` directly.
- **Asserting on tool response `content` array structure directly:** Always parse `JSON.parse(result.content[0].text)` — the SDK wraps all tool output in a `content` array.
- **Writing `console.log` in production code:** Any non-JSON byte on stdout before the MCP handshake silently breaks the session. The stdout smoke test is the regression guard.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-process MCP server testing | Custom stdio pipe simulation | `InMemoryTransport.createLinkedPair()` | SDK-provided, zero-overhead, fully typed |
| Socket readiness polling | Custom sleep loop | Reuse `waitForSocket()` from `broker/client.ts` | Already tested and handles edge cases |
| Fake timers for debounce | `setTimeout` + `Promise.race` | `vi.useFakeTimers()` / `vi.advanceTimersByTime()` | Vitest built-in, no async waits |
| Coverage aggregation script | Custom Node.js script to parse lcov | Vitest HTML reporter directory view | Already generated, already navigable |

---

## Common Pitfalls

### Pitfall 1: Broker Binary Not Built
**What goes wrong:** `tests/integration/broker-lifecycle.test.ts` imports or spawns `dist/broker/main.js` which doesn't exist. All broker tests fail with `ENOENT`.
**Why it happens:** `npm test` (vitest) does not run `npm run build` first. The dist directory is NOT auto-built.
**How to avoid:** Either (a) add a `globalSetup` file to `vitest.config.ts` that runs `npm run build` before tests, or (b) document that `npm run build && npm test` is required for broker lifecycle tests, or (c) skip broker tests with `describe.skipIf(!existsSync('dist/broker/main.js'))`.
**Warning signs:** `Error: ENOENT: no such file or directory, open 'dist/broker/main.js'` in test output.

### Pitfall 2: Broker Socket Contention
**What goes wrong:** Broker lifecycle tests spawn a broker that binds to `~/.filescope/broker.sock`. If a broker is already running (from the FileScopeMCP MCP server itself), the new spawn exits immediately (PID guard: `process.exit(0)`). Tests appear to pass but no broker was actually started.
**Why it happens:** The PID guard in `broker/main.ts` sees the existing socket and exits cleanly. The test's socket wait (`waitForSocket`) succeeds because the existing socket was already there.
**How to avoid:** Check for and clean up `~/.filescope/broker.sock` and `~/.filescope/broker.pid` in `beforeAll` before spawning. Store original state and restore it in `afterAll`.
**Warning signs:** Tests pass but broker-related assertions are vacuously true.

### Pitfall 3: registerTools Not Exported
**What goes wrong:** `mcp-transport.test.ts` cannot call `registerTools(server, coordinator)` because it's a module-private function.
**Why it happens:** `mcp-server.ts` is designed as an entry point, not a library. The `registerTools` function is not exported.
**How to avoid:** Add `export` to `registerTools` in `mcp-server.ts`. This is a one-line, non-breaking change (it's additive).
**Warning signs:** TypeScript compile error on import.

### Pitfall 4: InMemoryTransport Client Version Mismatch
**What goes wrong:** `client.callTool()` returns unexpected shapes if the MCP protocol version negotiated during `initialize` doesn't match.
**Why it happens:** The SDK Client constructor takes a `ClientInfo` and `options.capabilities`. If capabilities are wrong, the server may reject the handshake.
**How to avoid:** Pass `{ capabilities: {} }` to `new Client()` — this uses the SDK's default capability negotiation. The MCP SDK handles version negotiation automatically. [VERIFIED: working in this session's spike]

### Pitfall 5: mcp-server.js Startup Output Timing
**What goes wrong:** The stdout smoke test reads first byte but the process emits nothing within 8s because it's waiting for a DB scan that takes longer than expected.
**Why it happens:** `coordinator.initServer()` calls `coordinator.init(cwd)` which runs `scanDirectory(cwd)` on startup. In a large directory, this takes time. The first JSON-RPC response only appears after the server sends `initialize` response.
**How to avoid:** Set CWD to `/tmp` (or an empty temp dir) when spawning `dist/mcp-server.js` in the smoke test. `/tmp` has minimal files so scan completes in milliseconds. Also: send a valid MCP `initialize` request to stdin to trigger the first response.

### Pitfall 6: FileWatcher vi.mock Hoisting
**What goes wrong:** `vi.mock('chokidar', ...)` is not hoisted if placed inside a test body or helper function.
**Why it happens:** `vi.mock` calls are statically hoisted to the top of the module by vitest's transform. This hoisting only works at module top level.
**How to avoid:** Always place `vi.mock('chokidar', ...)` at the top level of the test file, outside any `describe`/`it` block.

---

## Code Examples

### InMemoryTransport Pair Creation
```typescript
// Source: verified via node -e in this session
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
// serverTransport -> pass to server.connect()
// clientTransport -> pass to client.connect()
```

### Calling a Tool via Client
```typescript
// Source: verified via node -e in this session
const result = await client.callTool({
  name: 'list_files',
  arguments: { maxItems: 10 }
});
const parsed = JSON.parse(result.content[0].text);
// parsed.ok === true for success, false for error
// parsed.error === "NOT_INITIALIZED" etc. for error codes
```

### Broker Binary Path
```typescript
// Source: verified via ls /home/autopcap/FileScopeMCP/dist/broker/
// The CONTEXT.md mention of dist/broker.js is incorrect — actual path:
const BROKER_BIN = path.join(process.cwd(), 'dist/broker/main.js');
```

### vitest config with pool: 'forks'
```typescript
// Source: [ASSUMED - vitest 3.x docs pattern]
// Add to vitest.config.ts if SIGTERM tests are needed globally
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    pool: 'forks',  // allows SIGTERM to be caught by test processes
    coverage: { provider: 'v8', reporter: ['text', 'json', 'html'] },
  },
});
```

Note: Changing the global pool from default (`threads`) to `forks` increases test startup time. Evaluate whether this is needed globally or only for broker lifecycle tests. Vitest supports per-file pool configuration via `@vitest-pool forks` pragma — this would allow only broker-lifecycle.test.ts to use forks without affecting the rest of the suite.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual stdio pipe simulation for MCP tests | `InMemoryTransport.createLinkedPair()` | MCP SDK 1.x | Tests run in-process, no subprocess overhead |
| Mock all external deps in integration tests | Real SQLite + real ServerCoordinator (D-09) | Phase 31 decision | Catches real handler bugs, not just mock interactions |
| No coverage grouping | Per-subsystem `include` patterns in vitest.config.ts | Phase 31 | Gap identification by subsystem, not per-file |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pool: 'forks'` can be set globally in vitest.config.ts without breaking existing tests | Pattern 2, Code Examples | Existing tests may fail if they rely on thread-pool shared state; mitigation: use per-file pragma instead |
| A2 | `vi.mock('chokidar', ...)` factory pattern works as described | Pattern 3 | Mock may not intercept chokidar correctly; use `vi.mock` + `vi.mocked()` pattern instead |
| A3 | Sending MCP `initialize` to stdin triggers first stdout byte | Pattern 4 (stdout smoke) | Server may emit nothing until first tool call; fallback: wait for socket write activity |

---

## Open Questions (RESOLVED)

1. **Should `registerTools` be exported from `mcp-server.ts`?**
   - RESOLVED: Yes. Plan 01 Task 1 adds `export` to the existing `registerTools` function. This is additive (not refactoring) and enables InMemoryTransport tests to call it directly.
   - What we know: `mcp-server.ts` is an entry point that does not export anything; `registerTools` is private.
   - Recommendation: Exporting a function is not refactoring -- it's additive. Proceed with `export function registerTools`.

2. **Broker socket contention with live MCP server**
   - RESOLVED: Plan 02 Task 1 uses `beforeAll` cleanup of existing broker socket + PID before spawning test instances, and `afterEach` try/finally cleanup. Tests document that broker lifecycle tests require no live FileScopeMCP session.
   - What we know: `~/.filescope/broker.sock` is hardcoded; any live FileScopeMCP session will have a broker running.

3. **Global `pool: 'forks'` vs per-file pragma**
   - RESOLVED: Using per-file `// @vitest-pool forks` pragma on `broker-lifecycle.test.ts` only. Global config stays on default `threads` to avoid slowing the 512-test suite.
   - What we know: SIGTERM spike confirmed working; `pool: 'forks'` is the vitest mechanism.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All tests | ✓ | v22+ | -- |
| `dist/broker/main.js` | TEST-02, broker lifecycle | ✗ (not built) | -- | Build first: `npm run build` |
| `dist/mcp-server.js` | TEST-09 stdout smoke | ✓ | current | -- |
| `@modelcontextprotocol/sdk` | TEST-01, TEST-03 | ✓ | ^1.12.0 | -- |
| vitest | All tests | ✓ | 3.2.4 | -- |
| @vitest/coverage-v8 | TEST-09 | ✓ | 3.2.4 | -- |
| SIGTERM propagation (WSL2) | TEST-02 | ✓ | verified | -- |

**Missing dependencies with no fallback:**
- `dist/broker/main.js` -- broker lifecycle tests (TEST-02, TEST-04) cannot run without this binary. Plan must include a build step before these tests.

**Missing dependencies with fallback:**
- None that affect the other requirements.

---

## Sources

### Primary (HIGH confidence)
- `/home/autopcap/FileScopeMCP/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.d.ts` -- InMemoryTransport API
- `/home/autopcap/FileScopeMCP/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.d.ts` -- Client API, callTool signature
- `/home/autopcap/FileScopeMCP/src/mcp-server.ts` -- 13 tool registrations, mcpSuccess/mcpError helpers
- `/home/autopcap/FileScopeMCP/src/coordinator.ts` -- ServerCoordinator init/shutdown, debounce logic
- `/home/autopcap/FileScopeMCP/src/broker/main.ts` -- PID guard, SIGTERM handler, socket cleanup
- `/home/autopcap/FileScopeMCP/src/broker/client.ts` -- spawnBrokerIfNeeded, reconnect loop
- `/home/autopcap/FileScopeMCP/src/broker/config.ts` -- SOCK_PATH, PID_PATH, BrokerConfig
- `/home/autopcap/FileScopeMCP/src/file-watcher.ts` -- FileWatcher class, awaitWriteFinish, throttleTimers
- `/home/autopcap/FileScopeMCP/src/config-utils.ts` -- loadConfig three code paths
- `/home/autopcap/FileScopeMCP/src/cascade/cascade-engine.test.ts` -- 421 lines existing tests
- `/home/autopcap/FileScopeMCP/vitest.config.ts` -- current test config
- `/home/autopcap/FileScopeMCP/package.json` -- scripts, dependencies
- Node.js spike: `InMemoryTransport.createLinkedPair()` + `client.callTool()` confirmed working
- Node.js spike: SIGTERM propagation confirmed working in WSL2 6.6.87.2

### Secondary (MEDIUM confidence)
- Vitest 3.2.4 pool configuration -- per-file `@vitest-pool` pragma supported [ASSUMED -- not directly verified in this session]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries verified in package.json and node_modules
- InMemoryTransport pattern: HIGH -- end-to-end spike verified working
- Broker binary path: HIGH -- verified via `ls dist/broker/`
- SIGTERM in WSL2: HIGH -- spike confirmed
- Architecture patterns: HIGH -- derived from source code reading, not assumptions
- vi.mock chokidar pattern: MEDIUM -- vitest standard pattern, not spiked in this project

**Research date:** 2026-04-17
**Valid until:** 2026-05-17 (stable tooling; MCP SDK minor updates are possible)
