# Phase 31: Test Infrastructure - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 6 new/modified files
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `tests/integration/mcp-transport.test.ts` | test (integration) | request-response | `tests/integration/file-pipeline.test.ts` | role-match |
| `tests/integration/broker-lifecycle.test.ts` | test (integration) | event-driven | `tests/integration/file-pipeline.test.ts` | role-match |
| `tests/integration/mcp-stdout.test.ts` | test (integration) | request-response | `tests/integration/file-pipeline.test.ts` | role-match |
| `tests/unit/file-watcher.test.ts` | test (unit) | event-driven | `tests/unit/broker-queue.test.ts` | exact |
| `tests/unit/config-loading.test.ts` | test (unit) | CRUD | `tests/unit/tool-outputs.test.ts` | role-match |
| `vitest.config.ts` | config | — | `vitest.config.ts` (self, modify) | exact |

---

## Pattern Assignments

### `tests/integration/mcp-transport.test.ts` (integration test, request-response)

**Analog:** `tests/integration/file-pipeline.test.ts`

**Imports pattern** (`tests/integration/file-pipeline.test.ts` lines 1-13):
```typescript
// tests/integration/file-pipeline.test.ts lines 1-13
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { openDatabase, closeDatabase, getSqlite } from '../../src/db/db.js';
```

**Additional imports needed for mcp-transport.test.ts** (from RESEARCH.md Pattern 1):
```typescript
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ServerCoordinator } from '../../src/coordinator.js';
import { registerTools } from '../../src/mcp-server.js';  // requires export added
import { openDatabase, closeDatabase } from '../../src/db/db.js';
```

**DB + temp dir lifecycle pattern** (`tests/integration/file-pipeline.test.ts` lines 55-67):
```typescript
// tests/integration/file-pipeline.test.ts lines 55-67
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pipeline-test-'));
  dbPath = path.join(tmpDir, '.filescope', 'test.db');
  mkdirSync(path.join(tmpDir, '.filescope'), { recursive: true });
  setProjectRoot(tmpDir);
  setConfig({ excludePatterns: [], fileWatching: { enabled: false } } as any);
  openDatabase(dbPath);
});

afterAll(async () => {
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

**MCP transport setup pattern** (from RESEARCH.md Pattern 1 — InMemoryTransport wiring):
```typescript
// Wire McpServer + ServerCoordinator + InMemoryTransport in beforeAll
let server: McpServer;
let client: Client;
let coordinator: ServerCoordinator;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-transport-test-'));
  dbPath = path.join(tmpDir, '.filescope', 'test.db');
  mkdirSync(path.join(tmpDir, '.filescope'), { recursive: true });
  openDatabase(dbPath);

  coordinator = new ServerCoordinator();
  await coordinator.init(tmpDir);               // real SQLite, NOT initServer() — avoids argv/cwd side effects

  server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerTools(server, coordinator);           // requires: export function registerTools in mcp-server.ts

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
});

afterAll(async () => {
  await client.close();
  await server.close();
  await coordinator.shutdown();
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

**Tool call + response assertion pattern** (from RESEARCH.md Pattern 1 code examples):
```typescript
// Pattern for every smoke test — parse JSON from result.content[0].text
it('list_files returns ok:true with files array', async () => {
  const result = await client.callTool({ name: 'list_files', arguments: {} });
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.ok).toBe(true);
  expect(Array.isArray(parsed.files)).toBe(true);
});

it('get_file_summary returns ok:false NOT_FOUND for unknown path', async () => {
  const result = await client.callTool({ name: 'get_file_summary', arguments: { path: '/nonexistent.ts' } });
  const parsed = JSON.parse(result.content[0].text);
  expect(parsed.ok).toBe(false);
  expect(parsed.error).toBe('NOT_FOUND');
});
```

**Mock for broker connection** (`tests/integration/file-pipeline.test.ts` lines 35-44):
```typescript
// tests/integration/file-pipeline.test.ts lines 35-44
// Mock broker to prevent actual socket connections
vi.mock('../../src/broker/client.js', () => ({
  submitJob: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => false),
  requestStatus: vi.fn(),
  resubmitStaleFiles: vi.fn(),
}));
```

**Production code change required:** Add `export` keyword to `registerTools` in `src/mcp-server.ts` line 148:
```typescript
// src/mcp-server.ts line 148 — change:
function registerTools(server: McpServer, coordinator: ServerCoordinator): void {
// to:
export function registerTools(server: McpServer, coordinator: ServerCoordinator): void {
```

---

### `tests/integration/broker-lifecycle.test.ts` (integration test, event-driven)

**Analog:** `tests/integration/file-pipeline.test.ts` (lifecycle pattern) + `src/broker/client.ts` (waitForSocket)

**Imports pattern**:
```typescript
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import * as os from 'node:os';
import { SOCK_PATH, PID_PATH } from '../../src/broker/config.js';
```

**Pool pragma** (file-level comment — avoids changing global vitest config):
```typescript
// @vitest-pool forks
// Required: SIGTERM propagation needs forked processes, not threads.
// Place at top of file — vitest hoists this pragma.
```

**Broker binary path** (verified in RESEARCH.md):
```typescript
// src/broker/client.ts lines 146-148 — runtime resolution pattern:
// At test time use process.cwd() since we run from repo root:
const BROKER_BIN = path.join(process.cwd(), 'dist/broker/main.js');
```

**Skip guard when binary missing** (RESEARCH.md Pitfall 1):
```typescript
// At top of describe block — skip gracefully if not built
const brokerBinExists = existsSync(path.join(process.cwd(), 'dist/broker/main.js'));

describe.skipIf(!brokerBinExists)('broker lifecycle', () => {
  // ... tests
});
```

**beforeAll cleanup + afterEach try/finally** (D-07 requirement + RESEARCH.md Pitfall 2):
```typescript
let broker: ChildProcess | null = null;

beforeAll(async () => {
  // Clean any existing broker to prevent socket contention (Pitfall 2)
  try {
    if (existsSync(PID_PATH)) {
      const pid = parseInt(readFileSync(PID_PATH, 'utf-8').trim(), 10);
      if (!isNaN(pid)) process.kill(pid, 'SIGTERM');
      await new Promise<void>(r => setTimeout(r, 500));
    }
  } catch { /* ignore if no broker running */ }
  rmSync(SOCK_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
});

afterAll(async () => {
  rmSync(SOCK_PATH, { force: true });
  rmSync(PID_PATH, { force: true });
});

afterEach(async () => {
  try {
    if (broker && !broker.killed) broker.kill('SIGTERM');
  } finally {
    broker = null;
    await new Promise<void>(r => setTimeout(r, 300)); // wait for socket cleanup
  }
});
```

**waitForSocket helper** (copied from `src/broker/client.ts` lines 324-335 — private, must be inlined):
```typescript
// src/broker/client.ts lines 324-335 — replicate in test file:
async function waitForSocket(
  sockPath: string,
  pollIntervalMs: number,
  maxWaitMs: number,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (existsSync(sockPath)) return true;
    await new Promise<void>(r => setTimeout(r, pollIntervalMs));
  }
  return existsSync(sockPath);
}
```

**Lifecycle test pattern** (RESEARCH.md Pattern 2):
```typescript
it('broker creates PID file and socket on spawn', async () => {
  broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });
  const ready = await waitForSocket(SOCK_PATH, 500, 10_000);
  expect(ready).toBe(true);
  expect(existsSync(PID_PATH)).toBe(true);
}, 15_000);

it('broker exits cleanly on SIGTERM and removes socket + PID', async () => {
  broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });
  await waitForSocket(SOCK_PATH, 500, 10_000);

  broker.kill('SIGTERM');
  await new Promise<void>(r => broker!.on('exit', r));
  broker = null;

  expect(existsSync(SOCK_PATH)).toBe(false);
  expect(existsSync(PID_PATH)).toBe(false);
}, 15_000);
```

---

### `tests/integration/mcp-stdout.test.ts` (integration test, request-response)

**Analog:** `tests/integration/file-pipeline.test.ts` (lifecycle and process management pattern)

**Imports pattern**:
```typescript
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as os from 'node:os';
```

**First-byte smoke test** (RESEARCH.md Pattern 4 with stdin trigger from open question A3):
```typescript
// D-12/D-13: first byte of mcp-server.js stdout must be '{' (JSON)
// Use /tmp as cwd — minimal files, fast scan, no .filescope to confuse init
it('first byte of mcp-server.js stdout is { (ASCII 0x7B)', async () => {
  const serverBin = path.join(process.cwd(), 'dist/mcp-server.js');
  const proc = spawn(process.execPath, [serverBin], {
    cwd: os.tmpdir(),
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  try {
    const firstChunk = await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for MCP server stdout')), 8_000);

      proc.stdout!.once('data', (chunk: Buffer) => {
        clearTimeout(timer);
        resolve(chunk);
      });

      // Trigger output: send MCP initialize request to stdin
      const initMsg = JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', clientInfo: { name: 'smoke', version: '1' }, capabilities: {} },
      }) + '\n';
      proc.stdin!.write(initMsg);
    });

    expect(firstChunk[0]).toBe(0x7B); // '{'
  } finally {
    proc.kill('SIGTERM');
    await new Promise<void>(r => proc.on('exit', r));
  }
}, 10_000);
```

---

### `tests/unit/file-watcher.test.ts` (unit test, event-driven)

**Analog:** `tests/unit/broker-queue.test.ts` (pure unit test with helpers, no DB, no temp dirs)

**Imports pattern** (`tests/unit/broker-queue.test.ts` lines 1-8):
```typescript
// tests/unit/broker-queue.test.ts lines 1-8
import { describe, it, expect, beforeEach } from 'vitest';
```

**Additional imports for file-watcher.test.ts**:
```typescript
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { EventEmitter } from 'node:events';
```

**vi.mock must be at module top level** (RESEARCH.md Pitfall 6 — hoisting requirement):
```typescript
// MUST be at module top level — vitest hoists vi.mock to top of file.
// Place before any imports that use chokidar transitively.

vi.mock('chokidar', () => {
  const { EventEmitter } = require('node:events');
  const mockWatcher = new EventEmitter() as EventEmitter & {
    close: () => Promise<void>;
  };
  mockWatcher.close = vi.fn().mockResolvedValue(undefined);
  return {
    default: {
      watch: vi.fn().mockReturnValue(mockWatcher),
    },
    __mockWatcher: mockWatcher,
  };
});
```

**FileWatcher import and global-state setup** (from `src/file-watcher.ts` lines 1-6 — dependencies):
```typescript
import { FileWatcher } from '../../src/file-watcher.js';
import { setConfig, setProjectRoot } from '../../src/global-state.js';
import * as chokidar from 'chokidar';
```

**beforeEach reset pattern** (`tests/unit/broker-queue.test.ts` lines 41-43):
```typescript
// tests/unit/broker-queue.test.ts lines 41-43
beforeEach(() => {
  queue = new PriorityQueue();
});
```

**Adapted for file-watcher**:
```typescript
let watcher: FileWatcher;
const mockConfig = {
  enabled: true,
  ignoreDotFiles: false,
  autoRebuildTree: true,
  maxWatchedDirectories: 1000,
  watchForNewFiles: true,
  watchForDeleted: true,
  watchForChanged: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  setProjectRoot('/tmp/test-project');
  setConfig({ excludePatterns: [], fileWatching: mockConfig } as any);
  watcher = new FileWatcher(mockConfig, '/tmp/test-project');
});

afterEach(() => {
  // stop() clears throttle timers — prevent timer leaks
  watcher.stop();
});
```

**Event dispatch test pattern** (from `src/file-watcher.ts` lines 74-83 — what addEventCallback and onFileEvent do):
```typescript
it('calls registered callbacks for add event', () => {
  const cb = vi.fn();
  watcher.addEventCallback(cb);
  watcher.start();

  // Emit add event through mock chokidar instance
  const mockWatcher = (chokidar as any).__mockWatcher;
  mockWatcher.emit('add', '/tmp/test-project/new-file.ts');

  expect(cb).toHaveBeenCalledWith('/tmp/test-project/new-file.ts', 'add');
});

it('does not call callbacks after stop()', () => {
  const cb = vi.fn();
  watcher.addEventCallback(cb);
  watcher.start();
  watcher.stop();

  const mockWatcher = (chokidar as any).__mockWatcher;
  mockWatcher.emit('change', '/tmp/test-project/file.ts');

  expect(cb).not.toHaveBeenCalled();
});
```

---

### `tests/unit/config-loading.test.ts` (unit test, CRUD)

**Analog:** `tests/unit/tool-outputs.test.ts` (temp dir setup, pure function testing)

**Imports pattern** (`tests/unit/tool-outputs.test.ts` lines 1-9):
```typescript
// tests/unit/tool-outputs.test.ts lines 1-8
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
```

**No DB needed — config-loading is pure async I/O**:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { loadConfig } from '../../src/config-utils.js';
```

**Temp dir lifecycle** (`tests/unit/tool-outputs.test.ts` lines 29-31, 71-74):
```typescript
// tests/unit/tool-outputs.test.ts lines 29-31, 71-74
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-loading-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

**Three code path tests** (from `src/config-utils.ts` lines 204-257 — the three fall-through branches):
```typescript
// Path 1: missing file → DEFAULT_CONFIG (config-utils.ts line 215-219)
it('missing config file returns DEFAULT_CONFIG', async () => {
  const config = await loadConfig('/tmp/definitely-nonexistent-dir/config.json');
  expect(config.excludePatterns).toBeInstanceOf(Array);
  expect(config.version).toBe('1.0.0');
  expect(config.fileWatching?.enabled).toBeDefined();
});

// Path 2: malformed JSON → caught by JSON.parse → DEFAULT_CONFIG (config-utils.ts lines 244-249)
it('malformed JSON returns DEFAULT_CONFIG', async () => {
  const configPath = path.join(tmpDir, 'bad.json');
  await fs.writeFile(configPath, '{invalid json here}');
  const config = await loadConfig(configPath);
  expect(config.version).toBe('1.0.0');
});

// Path 3: valid JSON failing Zod schema → DEFAULT_CONFIG (config-utils.ts line 239 ConfigSchema.parse)
it('valid JSON with wrong schema returns DEFAULT_CONFIG', async () => {
  const configPath = path.join(tmpDir, 'wrong-schema.json');
  await fs.writeFile(configPath, JSON.stringify({ notAValidField: true }));
  const config = await loadConfig(configPath);
  expect(config.version).toBe('1.0.0');
});

// Path 4: valid JSON + valid schema → returns parsed config (config-utils.ts lines 239-244)
it('valid config returns parsed values', async () => {
  const configPath = path.join(tmpDir, 'valid.json');
  const validConfig = {
    baseDirectory: '/my/project',
    excludePatterns: ['**/node_modules'],
    fileWatching: { enabled: false, ignoreDotFiles: true, autoRebuildTree: false,
      maxWatchedDirectories: 100, watchForNewFiles: true, watchForDeleted: true, watchForChanged: true },
    version: '1.0.0',
    llm: { enabled: false },
  };
  await fs.writeFile(configPath, JSON.stringify(validConfig));
  const config = await loadConfig(configPath);
  expect(config.baseDirectory).toBe('/my/project');
  expect(config.excludePatterns).toEqual(['**/node_modules']);
  expect(config.version).toBe('1.0.0');
});
```

---

### `vitest.config.ts` (config, modify existing)

**Analog:** Self — current file at `vitest.config.ts` (lines 1-13).

**Current state** (`vitest.config.ts` lines 1-13):
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
```

**Target state** (D-11: add per-subsystem include/exclude to coverage):
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // pool stays at default 'threads'; broker-lifecycle.test.ts uses // @vitest-pool forks pragma
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Scope coverage to production code with meaningful gap visibility.
      // Excludes: nexus Svelte UI (untestable in node env), type-only files, test files.
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
        'src/nexus/**',
        'src/types.ts',
        'src/**/*.test.ts',
        'tests/**',
      ],
    },
  },
});
```

**Key constraint:** Do NOT add `pool: 'forks'` globally — it increases startup time for the full 512-test suite. Use `// @vitest-pool forks` file-level pragma on `broker-lifecycle.test.ts` only.

---

## Shared Patterns

### ESM Import Extension Convention
**Source:** Every existing test file (`.js` extension on local imports)
**Apply to:** All new test files
```typescript
// Correct — ESM requires .js extension even for .ts source files:
import { openDatabase } from '../../src/db/db.js';
import { FileWatcher } from '../../src/file-watcher.js';
import { loadConfig } from '../../src/config-utils.js';
// Wrong:
import { openDatabase } from '../../src/db/db';  // missing .js
```

### Vitest Globals (No Import Needed)
**Source:** `tests/unit/tool-outputs.test.ts` lines 5 vs `tests/unit/broker-queue.test.ts` lines 4
**Apply to:** All new test files — two conventions exist in the codebase:
- `src/*.test.ts` files: explicit import from 'vitest' (`import { describe, it, expect } from 'vitest'`)
- When using `vi.mock`, always import `vi` explicitly from 'vitest'

Prefer explicit imports for all new test files (clearer, matches more recent files).

### Temp Directory Lifecycle
**Source:** `tests/unit/tool-outputs.test.ts` lines 29-31 and `tests/integration/file-pipeline.test.ts` lines 55-67
**Apply to:** `mcp-transport.test.ts`, `config-loading.test.ts`
```typescript
let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'PREFIX-test-'));
  // ... additional setup
});

afterAll(async () => {
  // Always close DB before removing dir
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});
```

### Broker Mock (Prevent Socket Connections)
**Source:** `tests/integration/file-pipeline.test.ts` lines 35-44 and `src/cascade/cascade-engine.test.ts` lines 11-13
**Apply to:** `mcp-transport.test.ts` (coordinator.init() triggers broker connect)
```typescript
vi.mock('../../src/broker/client.js', () => ({
  submitJob: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => false),
  requestStatus: vi.fn(),
  resubmitStaleFiles: vi.fn(),
}));
```

### Process Lifecycle Cleanup (try/finally)
**Source:** D-07 + RESEARCH.md Pattern 2
**Apply to:** `broker-lifecycle.test.ts`, `mcp-stdout.test.ts`
```typescript
// Always use try/finally for spawned child processes — prevents orphans on test failure
try {
  // test body
} finally {
  proc.kill('SIGTERM');
  await new Promise<void>(r => proc.on('exit', r));
}
```

### describe.skipIf Guard for Binary-Dependent Tests
**Source:** RESEARCH.md Pitfall 1 (broker binary not built)
**Apply to:** `broker-lifecycle.test.ts`
```typescript
import { existsSync } from 'node:fs';
const BROKER_BIN = path.join(process.cwd(), 'dist/broker/main.js');
describe.skipIf(!existsSync(BROKER_BIN))('broker lifecycle', () => { /* ... */ });
```

---

## No Analog Found

All files in this phase have analogs. No entries.

---

## Production Code Change Required

| File | Change | Scope | Reason |
|------|--------|-------|--------|
| `src/mcp-server.ts` line 148 | Add `export` to `registerTools` function | One word added | `mcp-transport.test.ts` must call `registerTools(server, coordinator)` from test scope |

This is additive (not refactoring) — it adds no behavior, only makes an existing function importable.

---

## Metadata

**Analog search scope:** `tests/unit/`, `tests/integration/`, `src/**/*.test.ts`
**Source files read:** `file-pipeline.test.ts`, `tool-outputs.test.ts`, `broker-queue.test.ts`, `cascade-engine.test.ts`, `change-detector.test.ts`, `mcp-server.test.ts`, `file-watcher.ts`, `broker/main.ts`, `broker/client.ts`, `broker/config.ts`, `config-utils.ts`, `mcp-server.ts`, `vitest.config.ts`, `coordinator.ts`
**Files scanned:** 14
**Pattern extraction date:** 2026-04-17
