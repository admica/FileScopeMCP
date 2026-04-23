# Phase 31: Test Infrastructure - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Close protocol-layer and subsystem test gaps. Add MCP transport tests (InMemoryTransport), broker lifecycle tests, file watcher tests, and V8 coverage reporting. No new features, no refactoring of production code — only tests and test infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Test Organization
- **D-01:** Keep existing split pattern. Co-located `src/*.test.ts` for pure unit tests of the module they sit next to. `tests/unit/` for tests that need temp dirs, fixtures, or test multiple internal helpers. `tests/integration/` for multi-module and process-level tests.
- **D-02:** New MCP transport tests (InMemoryTransport) go in `tests/integration/mcp-transport.test.ts` — they exercise the full tool dispatch path through the MCP protocol layer.
- **D-03:** Broker lifecycle tests go in `tests/integration/broker-lifecycle.test.ts` — they spawn and signal real processes.
- **D-04:** File watcher tests go in `tests/unit/file-watcher.test.ts` — mocked chokidar, no real filesystem waits.

### Broker Lifecycle Test Approach
- **D-05:** Test against the real compiled broker binary (`dist/broker.js`), not mocked process objects. Real binary tests catch actual bugs that mocking would miss.
- **D-06:** Use vitest `pool: 'forks'` for broker lifecycle tests since signal propagation requires actual forked processes. Per STATE.md concern: do a quick spike first to confirm SIGTERM works in WSL2. If it fails, fall back to mocked process approach.
- **D-07:** Broker tests must clean up after themselves — kill any spawned processes in `afterEach`/`afterAll` regardless of test pass/fail. Use a try/finally pattern to prevent orphaned broker processes.

### MCP Transport Tests
- **D-08:** Use `InMemoryTransport` from `@modelcontextprotocol/sdk` to test all 13 tools through the actual JSON-RPC dispatch path. Each tool gets at minimum a smoke test (call with valid args, verify response shape matches `{ok: true, ...}` or `{ok: false, error, message}`).
- **D-09:** Tests should initialize a real SQLite DB in a temp dir and wire up a real `ServerCoordinator` — test the full handler path, not mocked responses.

### Coverage Enforcement
- **D-10:** Advisory only — no CI gate on coverage thresholds. Gating on numbers leads to threshold gaming (testing trivial lines). Per-subsystem gap identification is more actionable.
- **D-11:** `npm run coverage` produces V8 coverage with text + json + html reporters (already configured). Add a summary script or vitest reporter config that groups coverage by subsystem directory (src/broker/, src/db/, src/change-detector/, etc.) so gaps are visible per-area.

### CI Smoke Test
- **D-12:** First-byte-is-`{` stdout pollution test lives in `tests/integration/mcp-stdout.test.ts`. Spawns `node dist/mcp-server.js`, reads first byte from stdout, asserts it equals `{`. Runs with existing `npm test` — no separate CI step needed.
- **D-13:** Test must handle the child process lifecycle cleanly: spawn, capture first output, kill, cleanup. Timeout at 5-10s for slow starts.

### Claude's Discretion
- Exact test case count per tool (minimum 1 smoke test required, more if handler has branching logic)
- Whether to add watcher tests for all event types or just the critical path (add, change, unlink)
- Config loading test scope (TEST-08) — how many edge cases to cover
- Cascade engine test approach for TEST-06 (some coverage already exists in `src/cascade/cascade-engine.test.ts`)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Test Infrastructure
- `vitest.config.ts` — Test runner configuration (globals, v8 coverage, include patterns)
- `package.json` — Test scripts (`test`, `coverage`)
- `tests/unit/tool-outputs.test.ts` — Existing tool contract test pattern (DB setup, temp dirs)
- `tests/integration/file-pipeline.test.ts` — Existing integration test pattern (real SQLite, real file ops)

### MCP Transport (for D-08, D-09)
- `src/mcp-server.ts` — All 13 tool registrations via `registerTool()`, `createMcpResponse()` helper
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` — `McpServer` class, `InMemoryTransport`
- `src/coordinator.ts` — `ServerCoordinator` used by all tool handlers

### Broker Lifecycle (for D-05, D-06, D-07)
- `src/broker/main.ts` — Entry point, PID guard, crash handlers, shutdown handlers
- `src/broker/client.ts` — `spawnBrokerIfNeeded()` with poll loop
- `src/broker/server.ts` — `BrokerServer.shutdown()` drain logic
- `src/broker/config.ts` — Broker config schema

### File Watcher (for D-04)
- `src/file-watcher.ts` — FileWatcher class with chokidar integration
- `src/coordinator.ts` — Watcher event callbacks

### Existing Tests (understand patterns before adding new ones)
- `src/cascade/cascade-engine.test.ts` — Cascade tests already exist (check coverage before adding TEST-06)
- `src/change-detector/change-detector.test.ts` — Change detector tests exist (check coverage for TEST-07)
- `src/mcp-server.test.ts` — MCP server unit tests (734 lines, check what's covered)

### Requirements
- `.planning/REQUIREMENTS.md` — TEST-01 through TEST-09

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/unit/tool-outputs.test.ts` pattern: temp SQLite DB setup with `beforeAll`/`afterAll` lifecycle — reuse for MCP transport tests
- `tests/integration/file-pipeline.test.ts` pattern: real file system + real DB for integration testing
- `src/mcp-server.test.ts` (734 lines): existing MCP server tests — check overlap with TEST-01/TEST-03 before writing new tests
- `src/cascade/cascade-engine.test.ts`: existing cascade tests — check if TEST-06 is already covered

### Established Patterns
- Vitest globals (`describe`, `it`, `expect` without imports) — follow this convention
- Temp dir creation: `fs.mkdtemp(path.join(os.tmpdir(), 'prefix-'))` in `beforeAll`
- DB lifecycle: `openDatabase(dbPath)` in `beforeAll`, `closeDatabase()` in `afterAll`
- ESM imports with `.js` extension: `from '../../src/db/db.js'`

### Integration Points
- `vitest.config.ts` include patterns already cover `tests/**/*.test.ts` — new files auto-discovered
- `package.json` scripts: `test` and `coverage` already wired — no changes needed
- Broker tests need `dist/broker.js` built first — add `npm run build` prerequisite or use `globalSetup`

### Current Test Stats
- 22 test files, 512 tests, all passing
- ~7,100 lines of test code total
- No mocking framework in use (vi.mock available from vitest but unused)
- No broker/transport/watcher tests exist yet

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User deferred all gray area decisions to Claude's judgment.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 31-test-infrastructure*
*Context gathered: 2026-04-17*
