# Pitfalls Research

**Domain:** MCP server production hardening — testing, spec compliance, auto-registration, broker lifecycle
**Researched:** 2026-04-17
**Confidence:** HIGH (all findings verified against official MCP SDK docs, Node.js docs, and project source)

---

## Critical Pitfalls

### Pitfall 1: stdout Pollution Crashes the MCP Transport

**What goes wrong:**
Any non-JSON-RPC byte written to stdout — `console.log()`, a stray `process.stdout.write()`, a dependency that logs to stdout at startup, or a Node.js deprecation warning — corrupts the message framing for the client. The custom `StdioTransport` already has a 10MB overflow guard and deferred file-only logging enabled at the top of `mcp-server.ts`, but if any new code path or imported library writes to stdout (e.g., a tree-sitter native module emitting a build warning, or a new `console.log` added during development), the entire session silently breaks: the client receives a partial JSON-RPC frame and the parse fails.

**Why it happens:**
Developers add debug logging during feature work and forget to redirect it. Third-party native modules (tree-sitter, better-sqlite3) occasionally emit startup warnings to stdout when built with different flags than expected.

**How to avoid:**
- Add a test that spawns the built `dist/mcp-server.js` as a child process, sends a valid `initialize` request, and asserts that every byte on stdout parses as a valid newline-delimited JSON-RPC frame.
- Assert the first byte on stdout is `{` as a quick smoke check.
- Lint rule or test that asserts no `console.log` call exists in `src/` outside of `src/nexus/` (which legitimately uses stdout for the API server).

**Warning signs:**
- `SyntaxError: Unexpected token` in client logs immediately on connection.
- Sporadic "message too large" errors in `mcp-server.log` without a correspondingly large tool call.
- A test passes in isolation but fails when run after a test that imports a native module for the first time.

**Phase to address:** MCP transport integration test phase.

---

### Pitfall 2: Vitest Parallel Execution with a Singleton SQLite Connection

**What goes wrong:**
The project uses module-level singleton state in `src/db/db.ts` (`getSqlite()` returns a single shared connection). When Vitest runs test files in parallel workers (the default), two test files that both call `openDatabase()` targeting the same path — or that import the same singleton module — can race. The first worker's `afterAll` closes the DB while the second worker's test is mid-query, producing non-deterministic "SQLITE_MISUSE: Database is closed" errors.

The existing tests already use `beforeAll`/`afterAll` with unique `mkdtemp` paths, which is correct — but Vitest's default `isolate: true` (threads pool) gives each file its own module registry, so this works. The trap is any future change that adds `singleThread: true`, `--no-isolate`, or `fileParallelism: false` to the vitest config for a "performance optimization" — that breaks the isolation and causes flakes.

**Why it happens:**
Vitest parallel file execution is correct behavior. The risk is introduced when someone disables isolation to speed up a slow test run without understanding the DB singleton consequence.

**How to avoid:**
- Never set `singleThread: true` or `isolate: false` in `vitest.config.ts`.
- Every test file that opens a DB must use `os.tmpdir()` + `mkdtemp` with a unique suffix — never a fixed path like `/tmp/filescope-test.db`.
- Add a CI assertion: if flakes appear, run `vitest run --no-file-parallelism` to confirm it is a parallelism issue before changing the config.

**Warning signs:**
- Tests pass with `--no-file-parallelism` but fail in default parallel mode.
- "SQLITE_MISUSE" or "Database is closed" errors appearing in only a subset of CI runs.
- A test that imports `../../src/db/db.js` throws a stale handle error from a previous test file.

**Phase to address:** All subsystem test phases (any phase that writes new tests touching the DB).

---

### Pitfall 3: Testing Tool Handlers Directly Instead of Through the MCP Dispatch Layer

**What goes wrong:**
Tests that call internal tool handler functions directly — by reaching into the server object or exporting them — bypass the JSON-RPC dispatch layer entirely. These tests pass but verify nothing about: (a) Zod schema validation rejecting bad input, (b) the `isError` / `content` response shape the SDK enforces, or (c) capability negotiation. When a tool's Zod schema changes, the test still passes because it never exercises schema validation.

The MCP SDK provides `InMemoryTransport` for fast in-process testing without spawning a child process. In SDK v1 it was importable from `@modelcontextprotocol/sdk/inMemory.js`; in SDK v2 it moved to `@modelcontextprotocol/core` (internal, testing-only). Verify the import path against the installed SDK version before use.

**Why it happens:**
Bypassing the transport is faster to write and avoids JSON-RPC message framing complexity. It feels like "unit testing the handler," but skips the layer that actually runs in production.

**How to avoid:**
- For tool contract tests (verify schema, response shape, error handling), use `StdioClientTransport` by spawning the built `dist/mcp-server.js` as a child process — this tests the exact binary users run.
- For fast unit-style tests of tool behavior, use `InMemoryTransport` from the SDK to exercise the full dispatch path without process spawn overhead.
- Reserve direct calls to helper functions only for pure business logic (dependency parsing, importance scoring) that does not involve the MCP dispatch layer.

**Warning signs:**
- Test file imports internal handler functions that are not exported from `mcp-server.ts`.
- Tool tests pass despite a deliberately broken Zod schema (e.g., adding `z.never()` to a required field).
- No test covers what happens when a required parameter is omitted.

**Phase to address:** MCP transport integration test phase.

---

### Pitfall 4: The `.claude.json` Auto-Registration Target Has Changed

**What goes wrong:**
The existing `install-mcp-claude.sh` writes `mcpServers` into `~/.claude.json`. As of 2025-2026, Claude Code **no longer reads `mcpServers` from `~/.claude.json`** reliably — the field is ignored or causes a schema validation error depending on the version. The correct registration path in current Claude Code is:

- Use `claude mcp add FileScopeMCP -- node /path/to/dist/mcp-server.js` (CLI-based, persists to user scope correctly).
- Or provide a `.mcp.json` at the project root (project-scoped, version-controlled, auto-loaded when the project opens).

The script currently writes the right JSON but may be targeting the wrong file, meaning users run `install-mcp-claude.sh`, see "Registered successfully," restart Claude Code, and find the server is not loaded.

**Why it happens:**
Claude Code changed its config schema between 2024 and 2025. The registration path that worked in v1.x no longer works in v2.x. Official documentation lags the actual binary behavior.

**How to avoid:**
- Replace the bespoke file-write approach with `claude mcp add` using the official CLI.
- Write a `.mcp.json` at the repo root as the zero-config project-scoped fallback — this is automatically loaded when someone opens the project in Claude Code without any script execution.
- The installation script must verify registration succeeded by running `claude mcp list` and checking for the server name in output, rather than declaring success based on file write alone.
- On Windows, the script must use `cmd /c` wrapper for commands and handle the fact that `--mcp-config` CLI flag is unreliable in some Claude Code versions.

**Warning signs:**
- `claude mcp list` does not show `FileScopeMCP` after running the script.
- Server appears registered in `~/.claude.json` but never starts when Claude Code opens a project.
- Users on Claude Code 2.x report it works; users on 1.x report it does not (version skew on registration mechanism).

**Phase to address:** Zero-config integration phase.

---

### Pitfall 5: PID File Race Condition — PID Recycled to a Different Process

**What goes wrong:**
The broker's `isPidRunning()` check uses `process.kill(pid, 0)` (signal 0 = existence probe). If the broker crashed and the OS recycled its PID to a different process (possible on busy Linux systems under the 32-bit PID space, common in containers), `kill(pid, 0)` returns success. The broker client believes the broker is alive, does not spawn a new one, and then fails to connect to the socket (which no longer exists). Connection attempt fails, the reconnect timer kicks in, but the broker is never respawned because `spawnBrokerIfNeeded` keeps seeing the PID as "alive."

**Why it happens:**
PID recycling is fundamental OS behavior. The window between broker crash and PID recycle is small but real on systems running many short-lived processes (CI, Docker containers, developer machines with many npm scripts).

**How to avoid:**
- Add a two-factor liveness check: PID alive AND socket file exists. If PID appears alive but socket is absent, treat as stale regardless of the PID check.
- The current code in `spawnBrokerIfNeeded` checks `SOCK_PATH` first, but the case "SOCK_PATH missing AND PID_PATH present with live-seeming PID" is not explicitly handled — add a branch: if socket is absent and PID appears alive, write a warning and respawn anyway after removing the PID file.
- Optionally: store a broker-specific token (not just the PID) in the PID file and check it via `/proc/<pid>/cmdline` or a broker-written startup marker.

**Warning signs:**
- `[broker-client] Connection error: ENOENT` appearing repeatedly without any respawn attempt.
- `broker.pid` contains a PID that `ps aux | grep filescope` does not show.
- Broker client log shows "Connected to broker" never appearing after a broker crash.

**Phase to address:** Broker lifecycle hardening phase.

---

### Pitfall 6: Socket File Left Behind After SIGKILL or OOM Kill

**What goes wrong:**
The broker's shutdown handler removes `broker.sock` on clean `SIGTERM`/`SIGINT`. But if the process is killed with `SIGKILL` (OOM killer, `kill -9`, system reboot) or crashes with an uncaught exception before the handler runs, `broker.sock` is left on disk. The next `spawnBrokerIfNeeded` call checks for the socket, finds it, checks the PID — if the PID is truly dead (`ESRCH`), the stale cleanup path in `checkPidGuard()` runs correctly.

The remaining risk: two MCP instances starting simultaneously both see the socket and both try to clean it up, potentially racing on `fs.rmSync`. A second risk: uncaught exceptions in broker startup (before the signal handlers are registered) crash the process without cleanup.

**Why it happens:**
Unix sockets are not automatically cleaned up by the OS when a process exits — unlike TCP ports that are released by the kernel. The application is solely responsible for cleanup, but cleanup handlers only run if the process exits normally.

**How to avoid:**
- Add `process.on('uncaughtException', (err) => { cleanup(); throw err; })` and `process.on('unhandledRejection', ...)` handlers that attempt synchronous socket/PID cleanup before re-throwing. Unregistered cleanup handlers are the specific gap.
- Add a force-exit timeout (e.g., 10 seconds) to the shutdown sequence so a hung in-flight LLM job does not prevent socket cleanup.
- For the simultaneous spawn race: the `checkPidGuard()` cleanup is a write-then-start sequence that cannot be fully atomic without a file lock. Accept the rare race — the reconnect timer provides recovery — but document this as a known non-critical race.

**Warning signs:**
- `Error: EADDRINUSE: address already in use` in broker startup logs despite no running broker process.
- `ls -la ~/.filescope/` shows `broker.sock` but no broker in `ps aux`.
- Two broker processes running simultaneously (two entries in `ps aux | grep broker.js`).

**Phase to address:** Broker lifecycle hardening phase.

---

### Pitfall 7: Declaring `listChanged: true` Without Sending the Notification

**What goes wrong:**
The current `mcp-server.ts` declares `capabilities: { tools: { listChanged: true } }`. This tells clients "I will send a `notifications/tools/list_changed` notification when my tool list changes." If the server never sends this notification, spec-compliant clients may cache a stale tool list. Conversely, if the capability is removed during an audit, clients that relied on the notification will stop re-fetching after dynamic registration.

For FileScopeMCP specifically, tools are registered once at startup and never change at runtime, so `listChanged: true` is a false advertisement. The server should declare `listChanged: false` (or omit the field, which defaults to false) until dynamic tool registration is implemented.

**Why it happens:**
`listChanged: true` was set optimistically. The SDK does not enforce the contract — it will not throw if a server declares the capability but never sends the notification. The mismatch is invisible until a strict client encounters it.

**How to avoid:**
- MCP spec compliance audit: change `tools: { listChanged: true }` to `tools: {}` (omitted defaults to false).
- Rule: never set `listChanged: true` unless the codebase actually calls `server.sendToolsChangedNotification()` or equivalent somewhere.
- Add a test: verify the capability object in the `initialize` response matches what is actually implemented.

**Warning signs:**
- Capability object shows `listChanged: true` in the `initialize` response.
- `grep -r 'list_changed\|listChanged\|toolsChanged' src/` returns no results in server code.

**Phase to address:** MCP spec compliance audit phase.

---

### Pitfall 8: Over-Implementing Unused MCP Capabilities

**What goes wrong:**
Adding Resources, Prompts, or Sampling capabilities to pass a compliance checklist when the server does not implement them. The SDK accepts the capability declaration but when a client calls `resources/list` or `prompts/list` and gets a `-32601 Method not found` error, the client may treat it as a broken server rather than a server that simply has no resources. A closely related trap: adding `outputSchema` to tools that return plain text creates the obligation to also return `structuredContent` — if omitted, the TypeScript SDK (issue #699) throws `MCP error -32602: Tool has an output schema but no structured content was provided`.

**Why it happens:**
A "compliance checklist" approach leads to declaring capabilities by writing config rather than by wiring up handlers. Someone adds a capability entry to appear compliant without implementing the handler.

**How to avoid:**
- Rule: every declared capability must have a corresponding registered handler.
- For FileScopeMCP: do not add Resources, Prompts, or Sampling capabilities. The server is tools-only. Keep the surface minimal.
- Do not add `outputSchema` to any tool unless the handler also returns `structuredContent`. The backward-compatibility benefit is marginal; the `isError` + `outputSchema` bug risk is real (SDK v1.12+ issue).
- Audit rule: `initialize` response capabilities must exactly match what is implemented, verified by a test that calls each advertised method and asserts a non-error response.

**Warning signs:**
- The `initialize` response capabilities object lists `resources`, `prompts`, or `sampling` but no handlers are registered for those methods.
- A tool registration includes `outputSchema` but the handler calls `createMcpResponse(...)` which produces `content` only.

**Phase to address:** MCP spec compliance audit phase.

---

### Pitfall 9: Broker Client Reconnect Timer Firing During MCP Server Shutdown

**What goes wrong:**
`startReconnectTimer()` calls `reconnectTimer.unref()` so it does not hold the event loop open. This is correct. But `unref()` only prevents the timer from blocking process exit — it does not prevent the timer from firing if the event loop remains active for other reasons (open file handles from chokidar watchers, open SQLite WAL checkpoint, or a pending coordinator operation during shutdown).

If the reconnect timer fires during server shutdown (between `SIGTERM` received and `process.exit()` called), it calls `spawnBrokerIfNeeded()`, which may spawn a new broker process that outlives the MCP server. Additionally, when `resubmitStaleFiles()` is called on reconnect after the DB has been closed, it throws "SQLITE_MISUSE: Database is closed" — caught and logged, but it may trigger another reconnect cycle.

**Why it happens:**
The reconnect timer and the shutdown sequence were designed independently. The timer is fire-and-forget; shutdown assumes nothing is in-flight.

**How to avoid:**
- Call `disconnect()` (which calls `clearReconnectTimer()` and sets `_intentionalDisconnect = true`) as the very first step in the MCP server's shutdown sequence, before stopping the file watcher or closing the DB.
- Add a guard in `resubmitStaleFiles()`: if `getSqlite()` throws (DB not open), return immediately without logging an error level message.
- Document the required shutdown ordering as a code comment in the coordinator's shutdown method: (1) disconnect broker client, (2) stop file watcher, (3) close DB.

**Warning signs:**
- `[broker-client] resubmitStaleFiles error: SQLITE_MISUSE: Database is closed` appearing in logs during server shutdown.
- A broker process visible in `ps aux` after the MCP server process has exited.
- MCP server process does not exit cleanly after `SIGTERM` and requires manual `kill -9`.

**Phase to address:** Broker lifecycle hardening phase.

---

### Pitfall 10: Integration Tests That Spawn Child Processes Leave Orphans on Test Failure

**What goes wrong:**
Integration tests that spawn `dist/mcp-server.js` as a child process to test the full stdio path leave orphaned server processes when a test assertion throws before the `afterAll` teardown runs. These orphans hold SQLite WAL locks and prevent subsequent test runs from opening the DB at the same path, causing cascading "SQLITE_BUSY: database is locked" failures that look like DB corruption.

On Linux, a child process re-parented to PID 1 when its parent (the Vitest worker) exits runs indefinitely until it is killed manually. On CI agents, these accumulate across runs.

**Why it happens:**
Vitest does not automatically kill child processes spawned by tests. `child.unref()` only prevents the parent from waiting — it does not kill the child when the parent exits (that would require `child.kill()` in the parent's exit handler).

**How to avoid:**
- Register a `process.on('exit', ...)` cleanup handler in test setup that kills all spawned child PIDs collected into a module-level `Set<ChildProcess>`.
- In `afterEach` (not just `afterAll`), kill any process spawned in that test block.
- Never pass `detached: true` to test-spawned child processes.
- Add a CI assertion: `pgrep -f 'dist/mcp-server'` after `vitest run` should return empty.

**Warning signs:**
- `SQLITE_BUSY: database is locked` errors appearing in test output that cannot be reproduced by running a single test file in isolation.
- `ps aux | grep mcp-server` shows leftover processes after `vitest run` exits.
- Test suite execution time increases progressively across repeated CI runs (orphan accumulation).

**Phase to address:** MCP transport integration test phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Call tool handlers directly in tests, bypassing SDK dispatch | Faster test authoring | Misses Zod schema validation, response shape enforcement, capability checks | Never — use InMemoryTransport or child process spawn |
| `listChanged: true` without sending notifications | Appears spec-compliant | Strict clients cache stale tool lists; misleading capability advertising | Never — set to false or implement the notification |
| Shared fixed DB path across test files | Simpler setup | Race conditions under parallel Vitest workers | Never — always use `mkdtemp` unique per test file |
| `process.exit(0)` immediately on SIGTERM in the broker | Simple shutdown | In-flight LLM job abandoned; result lost; file stays stale | Never — await current job (already implemented, must not regress) |
| Adding capability declarations without handler implementations | Looks complete in compliance audit | `-32601 Method not found` errors when clients probe those capabilities | Never — only declare what is implemented |
| Skipping `disconnect()` before closing DB in coordinator shutdown | One less shutdown step | `resubmitStaleFiles` SQLITE_MISUSE errors during teardown; potential orphaned broker | Never — enforce shutdown ordering |
| Writing registration config to `~/.claude.json` instead of using `claude mcp add` | Works on older Claude Code versions | Silently fails on Claude Code 2.x; no error feedback to user | Never for new installs — use CLI |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Claude Code MCP registration | Writing `mcpServers` to `~/.claude.json` (works in older versions, broken in 2025+) | Use `claude mcp add` CLI or write a `.mcp.json` at project root for project-scoped auto-load |
| Vitest + better-sqlite3 singleton | Opening the DB in a `beforeAll` shared across parallel workers | Each test file opens its own unique temp DB via `mkdtemp`; closes it in its own `afterAll` |
| MCP SDK `InMemoryTransport` | Importing from wrong path after SDK v2 restructure | Verify import path in installed SDK version; fall back to child process spawn for final integration tests |
| `StdioClientTransport` in tests | Not configuring `stdio: ['pipe', 'pipe', 'inherit']` | Always inherit stderr so server log output flows to the test terminal for debugging |
| Broker Unix socket in CI | Tests create `~/.filescope/broker.sock` on CI agents that persist between runs | Mock `SOCK_PATH` / `PID_PATH` to a `mkdtemp` unique per test run; clean up in `afterAll` |
| `tree-sitter` native module | May print version info or warnings to stdout on some build variants | Smoke test: first stdout byte from `dist/mcp-server.js` must be `{` |
| MCP `outputSchema` on tools | Adding it "for spec completeness" without returning `structuredContent` | Only add `outputSchema` if the handler returns `structuredContent`; SDK issue #699 makes this a runtime error |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| `resubmitStaleFiles()` on every broker reconnect flooding the queue on large repos | LLM throughput drops to zero after broker restart; queue fills immediately | Cap resubmission to top-N files by importance (e.g., 50) on reconnect | Repos with >1,000 stale files after a broker outage |
| Vitest running 260+ tests without `pool: 'forks'` on WSL2 | Tests time out due to thread contention in WSL2 (workers are slower than native Linux threads) | Set `pool: 'forks'` in `vitest.config.ts` for WSL2 development | Any Vitest run in WSL2 with heavy native module use (tree-sitter, better-sqlite3) |
| Integration tests spawning real `dist/mcp-server.js` before the build is current | Test passes against stale binary; fails in CI after code changes | Add a pre-test assertion that `dist/mcp-server.js` mtime is newer than `src/mcp-server.ts` mtime | Any CI pipeline that runs tests without an explicit build step |
| Broker shutdown awaiting `getCurrentJobPromise()` indefinitely | Broker never stops during graceful shutdown if an LLM call hangs | The existing 120-second job timeout in `worker.ts` is the backstop — verify this timeout is tested | Any broker shutdown where the current Ollama call is hung |

---

## "Looks Done But Isn't" Checklist

- [ ] **MCP spec compliance audit:** Tool names are all present — verify `claude mcp list` shows all 13 tools AND that calling each one returns a valid `content` array (not an empty object or a `-32601` error).
- [ ] **`listChanged` capability:** Appears set to `true` in current code — verify it is changed to `false` or that a notification is actually sent somewhere.
- [ ] **Auto-registration:** `install-mcp-claude.sh` (or the replacement) exits 0 and prints success — verify by running `claude mcp list` afterward, not just checking file contents.
- [ ] **Broker lifecycle:** Broker starts cleanly after install — verify by killing the broker with `kill -9` and confirming it respawns within 10 seconds via the reconnect timer.
- [ ] **Socket stale cleanup:** Broker startup correctly removes stale socket — verify by creating a fake `broker.sock` (no broker running), then starting the broker and confirming it starts without EADDRINUSE.
- [ ] **Test isolation:** Tests pass in parallel — verify with default `vitest run` (parallel mode) and confirm no flakiness across 5 consecutive runs.
- [ ] **stdout cleanliness:** MCP server emits only JSON-RPC frames on stdout — verify with `node dist/mcp-server.js 2>/dev/null | head -c 1` which must return `{`.
- [ ] **Shutdown ordering:** MCP server shuts down without leaving orphan broker processes — verify with `kill <pid>` then `ps aux | grep broker.js` returns empty.
- [ ] **Test teardown kills children:** Integration tests that spawn child processes — verify with `pgrep -f dist/mcp-server` returning empty after `vitest run` completes.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| stdout pollution discovered in production | MEDIUM | Add logging redirect, rebuild binary, re-register server; users re-run install script |
| Vitest parallel DB race causing flaky CI | LOW | Add `fileParallelism: false` to vitest config as immediate fix; root-cause and fix the shared state |
| Auto-registration broken (wrong config file) | LOW | `claude mcp remove FileScopeMCP && claude mcp add ...` using the CLI |
| PID file stale / socket orphan on user machine | LOW | Delete `~/.filescope/broker.pid` and `~/.filescope/broker.sock` manually; broker respawns on next file-change activity |
| `listChanged: true` with no notification handler | LOW | One-line capability change and rebuild; no user-visible breakage unless using a strict client |
| Orphaned child processes from integration tests | MEDIUM | `pkill -f 'dist/mcp-server'` in CI cleanup step; add process tracking to test setup |
| Broker reconnect loop on dead socket (PID recycle) | LOW | `disconnect()` call stops the timer; add socket-existence check to `spawnBrokerIfNeeded` |
| Broker shutdown hangs on in-flight LLM call | LOW | The 120-second job timeout in `worker.ts` is the backstop; if needed, add a 30-second shutdown deadline with `process.exit(1)` fallback |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| stdout pollution crashes MCP transport | MCP transport integration test phase | `node dist/mcp-server.js 2>/dev/null \| jq -c .` returns only valid JSON objects |
| Vitest parallel DB race | All test phases (enforce from phase 1) | `vitest run` passes 5x in a row without flakiness |
| Testing handlers directly, bypassing schema | MCP transport test phase | Tests use `StdioClientTransport` or `InMemoryTransport`; no internal imports of handler functions |
| `.claude.json` registration target change | Zero-config integration phase | `claude mcp list` shows server after registration script; verified on fresh user install |
| PID recycled to different process | Broker lifecycle hardening phase | `kill -9 <broker>; sleep 5` then verify reconnect and respawn succeed |
| Socket left on SIGKILL | Broker lifecycle hardening phase | `kill -9 <broker>; node dist/broker.js` starts cleanly without EADDRINUSE |
| `listChanged: true` without notification | MCP spec compliance audit phase | Capability object shows `listChanged: false` or notification is tested explicitly |
| Over-implementing unused capabilities | MCP spec compliance audit phase | `initialize` response capabilities match exactly what is implemented; each advertised capability tested |
| Reconnect timer fires during shutdown | Broker lifecycle / process management phase | `kill <mcp-server>` exits cleanly; no "SQLITE_MISUSE" in logs; no orphan broker processes |
| Orphaned child processes in integration tests | MCP transport integration test phase | `pgrep -f dist/mcp-server` returns empty after test suite completes |

---

## Sources

- MCP TypeScript SDK official docs via Context7 — server capabilities, tool registration, `isError`, `InMemoryTransport` import path: https://github.com/modelcontextprotocol/typescript-sdk
- MCP TypeScript SDK migration guide (v1 to v2, `InMemoryTransport` move, Standard Schema requirement): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration.md
- MCP spec 2025-06-18 tools capabilities and `listChanged`: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP TypeScript SDK issue #699 (`outputSchema` + `isError` runtime error): https://github.com/modelcontextprotocol/typescript-sdk/issues/699
- NearForm: MCP implementation tips, tricks and pitfalls: https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/
- Claude Code MCP documentation: https://code.claude.com/docs/en/mcp
- Claude Code `.claude.json` config file location issue (schema change): https://github.com/anthropics/claude-code/issues/4976
- Windows MCP guide (cmd wrapper, path pitfalls): https://github.com/BunPrinceton/claude-mcp-windows-guide
- MCPcat unit testing guide for MCP servers: https://mcpcat.io/guides/writing-unit-tests-mcp-servers/
- Claude Code undocumented breaking change (structuredContent priority): https://github.com/anthropics/claude-code/issues/9962
- Node.js Unix socket stale cleanup known issue: https://github.com/nodejs/node/issues/24963
- Node.js graceful shutdown with SIGKILL timeout pattern: https://dev.to/axiom_agent_1dc642fa83651/nodejs-graceful-shutdown-the-right-way-sigterm-connection-draining-and-kubernetes-fp8
- Vitest pool isolation configuration: https://vitest.dev/config/pool
- SQLite in-memory testing — connection lifecycle pitfall: https://oneuptime.com/blog/post/2026-02-02-sqlite-testing/view
- Vitest parallel truncation race condition (integration testing): https://www.simplethread.com/isolated-integration-testing-with-remix-vitest-and-prisma/
- Project source review (direct code audit): `src/broker/main.ts`, `src/broker/client.ts`, `src/broker/server.ts`, `src/mcp-server.ts`, `tests/integration/file-pipeline.test.ts`, `install-mcp-claude.sh`

---
*Pitfalls research for: v1.5 Production-Grade MCP Intelligence Layer — testing, spec compliance, auto-registration, broker lifecycle*
*Researched: 2026-04-17*
