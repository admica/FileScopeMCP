# Stack Research

**Domain:** Production-grade MCP server hardening — testing infrastructure, MCP spec compliance, and broker lifecycle management
**Researched:** 2026-04-17
**Confidence:** HIGH

## Context

This is a targeted v1.5 addition to an existing TypeScript 5.8 / Node.js 22 / ESM / esbuild stack.
The core stack is validated and NOT re-researched here. This document covers only the
**new capability domains** for the v1.5 Production-Grade MCP Intelligence Layer milestone:

1. MCP transport mocking for in-process tool call testing
2. Unix domain socket testing for the broker server/client
3. File watcher testing for chokidar-based watchers with debounce
4. MCP spec compliance validation tooling
5. Process lifecycle management patterns (no new library needed)

**Retained stack (do not change):** TypeScript 5.8, Node.js 22, ESM, esbuild,
`@modelcontextprotocol/sdk@1.27.1`, `chokidar`, `zod`, `vitest@3.2.4`, `@vitest/coverage-v8`,
`better-sqlite3`, `drizzle-orm`, `tree-sitter` (all grammars), `graphology` ecosystem,
Vercel AI SDK, Fastify 5, Svelte 5, Vite 8.

**Current test setup:** `vitest@3.2.4`, `@vitest/coverage-v8@3.1.4`, 260+ tests passing,
`globals: true`, `environment: 'node'`, v8 coverage with text/json/html reporters.
Tests live in `src/**/*.test.ts` and `tests/**/*.test.ts`.

---

## Recommended Stack — New Additions Only

### Core Testing Infrastructure

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `memfs` | `^4.57.2` | In-memory file system for chokidar watcher tests | Officially recommended by the Vitest team for fs mocking. Replaces real-fs calls with an in-memory vol; avoids flaky timing-based watcher tests. Used via `vi.mock('node:fs')` + `vi.mock('node:fs/promises')` pointing at memfs. v4.x is the current major. |
| `@modelcontextprotocol/inspector` | `^0.21.2` | MCP spec compliance smoke-testing via CLI | The official MCP protocol compliance tool. CLI mode (`--cli`) produces JSON output suitable for scripting. Used as a `devDependency` and invoked via npm script against the built server binary to verify tool schemas, capabilities, and response shapes comply with the MCP spec. Not used in the vitest suite itself — a separate npm script. |

**NOT adding (see What NOT to Add section):**
- No new test runner — vitest@3.2.4 is the right version (do not upgrade to v4 yet)
- No additional assertion libraries — vitest's built-in Chai assertions are sufficient
- No process manager library (PM2, execa, etc.) — Node.js `child_process` is sufficient for the broker lifecycle patterns needed

### What's Already Available (No New Packages)

| Capability | Source | How |
|------------|--------|-----|
| MCP transport mocking | `@modelcontextprotocol/sdk@1.27.1` (already installed) | `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js` — verified importable in this project. Pairs a server-side and client-side transport for in-process MCP testing without spawning a subprocess. |
| MCP client for tool invocation | `@modelcontextprotocol/sdk@1.27.1` (already installed) | `Client` from `@modelcontextprotocol/sdk/client/index.js` — provides `listTools()` and `callTool()`. Used with `InMemoryTransport` to exercise MCP tools without any stdio involvement. |
| Unix socket testing | Node.js 22 `node:net` (built-in) | `net.createServer()` / `net.createConnection()` with a per-test socket path (e.g., `\0filescope-test-${process.pid}` for Linux abstract sockets that auto-cleanup). Wrap callbacks in Promises for vitest's async test pattern. |
| Fake timers for debounce/backoff | `vitest@3.2.4` (already installed) | `vi.useFakeTimers()` / `vi.advanceTimersByTime()` — vitest uses `@sinonjs/fake-timers` internally. Controls setTimeout/setInterval debounce in watcher and broker reconnect logic without real-time waits. |
| Process signal testing | Node.js 22 `process` (built-in) | `process.emit('SIGTERM')` to trigger shutdown handlers in tests. Broker lifecycle cleanup (PID files, socket unlink) verified by testing the registered signal handlers directly without spawning child processes. |

---

## Installation

```bash
# New dev dependencies
npm install -D memfs @modelcontextprotocol/inspector
```

That is the complete install step. No other packages needed.

---

## Integration Patterns

### Pattern 1: In-Process MCP Tool Testing (InMemoryTransport)

The correct pattern for testing MCP tool handlers without spawning a subprocess:

```typescript
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// In your test:
const server = new McpServer({ name: 'test', version: '1.0.0' });
// Register tools the same way your production code does

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);

const client = new Client({ name: 'test-client', version: '1.0.0' });
await client.connect(clientTransport);

const tools = await client.listTools();
const result = await client.callTool({ name: 'get_file_summary', arguments: { path: '/some/file.ts' } });

await client.close();
```

**Why this pattern:** Tests the actual MCP protocol layer (JSON-RPC serialization, tool dispatch, response shapes) without any process boundaries. `InMemoryTransport` is verified present in the installed SDK v1.27.1 at `dist/esm/inMemory.js` and importable from `@modelcontextprotocol/sdk/inMemory.js`.

**Important SDK version note:** The Context7/migration docs mention `InMemoryTransport` was moved in a v2 SDK refactor. The installed SDK is v1.27.1 (not v2) — `InMemoryTransport` is importable from the public `inMemory.js` path and `createLinkedPair()` is confirmed working.

### Pattern 2: Unix Socket Testing (Broker)

```typescript
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

// Use Linux abstract socket (no file cleanup needed)
const SOCK = `\0filescope-test-${process.pid}`;

describe('BrokerServer', () => {
  let server: net.Server;

  beforeAll(() => new Promise<void>((resolve) => {
    server = net.createServer(handleConnection);
    server.listen(SOCK, resolve);
  }));

  afterAll(() => new Promise<void>((resolve) => {
    server.close(() => resolve());
  }));

  it('handles submit message', () => new Promise<void>((resolve) => {
    const client = net.createConnection(SOCK, () => {
      client.write(JSON.stringify({ type: 'submit', ... }) + '\n');
    });
    client.once('data', (data) => {
      const msg = JSON.parse(data.toString());
      expect(msg.type).toBe('result');
      client.destroy();
      resolve();
    });
  }));
});
```

**Abstract socket note:** `\0<name>` is Linux-only and auto-cleans when all refs close — no `fs.unlinkSync` cleanup needed. The project already targets Linux/WSL2 only (confirmed in PROJECT.md runtime constraint), so this is safe.

**Alternatively** use `path.join(os.tmpdir(), 'filescope-test-' + process.pid + '.sock')` for portability, with explicit unlink in `afterAll`.

### Pattern 3: File Watcher Testing (chokidar + memfs)

```typescript
import { vi } from 'vitest';
import { fs, vol } from 'memfs';

vi.mock('node:fs', async () => {
  const { fs } = await vi.importActual('memfs') as typeof import('memfs');
  return { default: fs, ...fs };
});
vi.mock('node:fs/promises', async () => {
  const { fs } = await vi.importActual('memfs') as typeof import('memfs');
  return { default: fs.promises, ...fs.promises };
});

// Mock chokidar to emit events manually (avoids real FS watching)
const mockWatcher = new EventEmitter();
vi.mock('chokidar', () => ({
  default: { watch: vi.fn(() => mockWatcher) },
}));

beforeEach(() => {
  vol.reset();  // Fresh in-memory fs for each test
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('debounces rapid file changes', () => {
  mockWatcher.emit('change', '/src/foo.ts');
  mockWatcher.emit('change', '/src/foo.ts');
  vi.advanceTimersByTime(500); // advance past debounce window
  expect(handleChange).toHaveBeenCalledTimes(1); // deduplicated
});
```

**Why vi.mock chokidar instead of real fs events:** Chokidar uses OS-level inotify/kqueue/FSEvents which don't fire on memfs writes. Mocking chokidar's `watch()` return value gives full control over event timing and avoids flaky real-watcher tests.

### Pattern 4: MCP Inspector Compliance Script

Add to `package.json` scripts (not a vitest test):

```json
"scripts": {
  "test:mcp-compliance": "npx @modelcontextprotocol/inspector --cli node dist/mcp-server.js -- --project /tmp/test-repo 2>/dev/null | node scripts/verify-compliance.cjs"
}
```

The inspector CLI outputs JSON. A small Node.js script (`scripts/verify-compliance.cjs`) parses the JSON and asserts required tools exist with correct schema shapes. This runs in CI after `npm run build`, separate from the vitest suite.

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `InMemoryTransport` (built-in to SDK) | `StdioClientTransport` spawning a subprocess | Subprocess tests are slow (200-500ms per spawn), hard to control timing, and don't isolate the tool handler logic from process startup. InMemoryTransport tests are synchronous and 10-50x faster. |
| `InMemoryTransport` (built-in to SDK) | Mocking the entire `McpServer` | Mocking McpServer means not testing the actual MCP dispatch layer. InMemoryTransport exercises the real JSON-RPC serialization path. |
| `memfs` for fs mocking | Real temp directories | Real directories require cleanup, are affected by OS file system limits, and make tests depend on disk I/O timing. memfs is instantaneous and deterministic. |
| `vi.mock('chokidar', ...)` | Real chokidar with memfs | Chokidar uses OS-level inotify which does NOT fire for memfs writes — mixing them produces tests that never emit events. Mock chokidar entirely and emit events manually. |
| `vi.useFakeTimers()` for debounce | `setTimeout` with real waits | Real waits make watcher debounce tests take 500ms+ each. Fake timers make them instant. |
| Linux abstract sockets (`\0name`) | Temp file sockets | Abstract sockets auto-cleanup, need no unlink, and don't risk path length issues (`sockaddr_un.sun_path` limit is 107 bytes on Linux). The project is WSL2/Linux only. |
| `@modelcontextprotocol/inspector` CLI | Writing a custom MCP client validator | Inspector is the official reference client maintained by the MCP team. It knows about all protocol nuances. A custom validator would need constant maintenance as the spec evolves. |
| vitest@3.2.4 (keep current) | Upgrade to vitest@4.x | Vitest 4 requires Vite >= 6 (currently on Vite 8 — this is actually compatible), but the coverage V8 changes produce different coverage numbers and `vi.restoreAllMocks()` behavior changed (no longer resets `vi.fn()` mocks). The v3 → v4 migration risk is not worth it for this milestone. Upgrade is a separate task. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `execa` or `cross-spawn` | Adding a subprocess library for broker lifecycle testing adds a dependency purely for test infrastructure. The broker's signal handlers and PID cleanup can be tested by calling the registered handlers directly (no subprocess needed). | `process.emit('SIGTERM')` to trigger shutdown logic directly in unit tests |
| `pm2` or `forever` | Process managers for production runtime. The broker is a standalone Node.js process managed by users, not by a process manager. Adding PM2 coupling would complicate zero-config goals. | SIGTERM/SIGINT handlers + PID file pattern (pure Node.js stdlib) |
| `jest-mock-extended` or `sinon` | Redundant with vitest's built-in `vi.fn()`, `vi.spyOn()`, and `vi.mock()`. Adding another mock library creates two mock systems in the same codebase. | `vi.fn()`, `vi.spyOn()`, `vi.mock()` (already in vitest) |
| `@vitest/ui` | Browser-based test UI. No value for CI or LLM-agent workflows. Adds overhead. | `vitest --reporter=verbose` for human review |
| `supertest` or `axios` for broker testing | HTTP testing libraries are irrelevant — the broker uses Unix domain socket + NDJSON, not HTTP. | `node:net` directly |
| `nock` or `msw` | HTTP interceptors for mocking network calls. The system uses a local Ollama instance, and LLM calls should be vi.mock'd at the Vercel AI SDK adapter level, not intercepted at HTTP. | `vi.mock('../../src/broker/worker.js', ...)` to prevent real Ollama calls in tests |
| `@modelcontextprotocol/core` | Internal MCP SDK package only meant for testing per migration docs. The public `@modelcontextprotocol/sdk/inMemory.js` path is sufficient and stable in v1.27.1. | `@modelcontextprotocol/sdk/inMemory.js` (already installed) |
| `vitest-memfs` (companion package) | Adds snapshot-based filesystem matchers. The project doesn't need filesystem snapshot testing — it needs mocked fs for watcher isolation. The base `memfs` package is sufficient. | `memfs` directly |

---

## Version Compatibility

| Package | Version | Compatible With | Notes |
|---------|---------|-----------------|-------|
| `memfs@^4.57.2` | latest | Node.js 22, vitest@3.2.4, ESM | v4.x works with both `node:fs` and `node:fs/promises` mocking. Load via `vi.importActual('memfs')` in mock factory. |
| `@modelcontextprotocol/inspector@^0.21.2` | latest | Node.js 22 | Used only as `npx` invocation in npm scripts or as devDep. Not imported into test files. |
| `@modelcontextprotocol/sdk@1.27.1` (existing) | installed | `InMemoryTransport` confirmed available at `dist/esm/inMemory.js` | The migration note about `InMemoryTransport` moving to `@modelcontextprotocol/core` applies to a hypothetical future v2 SDK — not the current v1.27.1. Import from `@modelcontextprotocol/sdk/inMemory.js`. |
| `vitest@3.2.4` (existing) | installed | Node.js 22, `@sinonjs/fake-timers` built-in | Do NOT upgrade to v4 in this milestone. The coverage V8 changes and `vi.restoreAllMocks()` behavior change in v4 would require a separate migration audit. |

---

## Sources

- `/home/autopcap/FileScopeMCP/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.d.ts` — confirmed `InMemoryTransport.createLinkedPair()` available in v1.27.1 (HIGH confidence — live codebase)
- `node --input-type=module` verification — confirmed `import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'` works and `createLinkedPair` is a function (HIGH confidence — live verification)
- `/modelcontextprotocol/typescript-sdk` via Context7 — confirmed InMemoryTransport usage pattern, StdioClientTransport for subprocess testing, Client listTools/callTool API (HIGH confidence — official docs)
- `npm view memfs version` — confirmed v4.57.2 is current (HIGH confidence — live npm registry)
- `npm view @modelcontextprotocol/inspector version` — confirmed v0.21.2 is current (HIGH confidence — live npm registry)
- [Vitest file system mocking docs](https://vitest.dev/guide/mocking/file-system) — official recommendation of memfs for fs mocking (HIGH confidence — official docs)
- [Vitest fake timers docs](https://vitest.dev/guide/mocking/timers) — confirmed vi.useFakeTimers() / vi.advanceTimersByTime() API (HIGH confidence — official docs)
- [MCP Inspector GitHub](https://github.com/modelcontextprotocol/inspector) — confirmed CLI mode (`--cli` flag), JSON output for automation (HIGH confidence — official)
- [Node.js net docs](https://nodejs.org/api/net.html) — confirmed Linux abstract socket pattern `\0name` for test isolation (HIGH confidence — official docs)
- [Vitest 4.0 release notes](https://vitest.dev/blog/vitest-4) — confirmed breaking changes in vi.restoreAllMocks() and coverage V8; rationale for staying on v3 (HIGH confidence — official release notes)

---

*Stack research for: FileScopeMCP v1.5 Production-Grade MCP Intelligence Layer — new testing capabilities only*
*Researched: 2026-04-17*
