# Project Research Summary

**Project:** FileScopeMCP v1.5 — Production-Grade MCP Intelligence Layer
**Domain:** MCP server hardening — testing infrastructure, spec compliance, auto-registration, broker lifecycle
**Researched:** 2026-04-17
**Confidence:** HIGH

## Executive Summary

FileScopeMCP is a stdio-transport MCP server that provides LLM agents (primarily Claude Code) with structured, graph-aware understanding of a codebase. The v1.5 milestone is not a feature expansion — it is a production hardening pass on an already-functional system. The work divides into four discrete concerns: closing the protocol-layer test gap (zero MCP transport-level tests exist today), migrating to the current MCP SDK tool registration API, fixing two real reliability bugs in broker lifecycle management, and replacing a broken auto-registration script with a zero-config `.mcp.json` approach. Every item has clear implementation paths, no design unknowns, and minimal new dependencies (only `memfs` and `@modelcontextprotocol/inspector` need to be added).

The recommended implementation order follows a strict dependency chain. Broker lifecycle hardening and MCP spec compliance can proceed in parallel because they are entirely independent of each other. Test infrastructure must come after both because the new test files verify the hardened, spec-compliant code — writing them against the old `server.tool()` API would require immediately rewriting them. Auto-registration comes last because the binary it registers should be fully hardened before the install path is stabilized. This ordering avoids test churn and ensures every piece of work is verified before it ships.

The two highest-risk areas are both known and preventable. First, stdout pollution: any non-JSON-RPC byte written to stdout silently breaks the MCP session — a smoke test that asserts the first byte from `dist/mcp-server.js` is `{` catches this at CI time. Second, broker PID recycling: `process.kill(pid, 0)` can return success for a dead broker PID recycled to a different OS process — the fix is a two-factor liveness check (PID alive AND socket exists). Both carry LOW recovery cost if they slip through and are fully documented in PITFALLS.md.

---

## Key Findings

### Recommended Stack

The existing stack requires no significant changes. TypeScript 5.8, Node.js 22 ESM, vitest 3.2.4, `@modelcontextprotocol/sdk@1.27.1`, `better-sqlite3`, `drizzle-orm`, `chokidar`, and all other current packages are confirmed correct for this milestone.

Two new dev dependencies are the complete install step: `memfs@^4.57.2` for in-memory filesystem mocking in watcher tests (officially recommended by the Vitest team), and `@modelcontextprotocol/inspector@^0.21.2` for the MCP spec compliance smoke script (the official reference client from the MCP team). All other testing needs are already available — `InMemoryTransport` from the installed SDK, Unix socket testing via Node.js `node:net`, fake timers via vitest, and process signal testing via `process.emit()`.

**Core technologies for v1.5:**
- `memfs@^4.57.2`: in-memory filesystem for chokidar watcher tests — chokidar uses OS-level inotify that does not fire on real memfs writes, so mock chokidar's `watch()` return value and emit events manually; `memfs` provides the fs mock for any code that calls `node:fs` directly
- `@modelcontextprotocol/inspector@^0.21.2`: official MCP compliance CLI — invoked as an npm script (`test:mcp-compliance`), not inside vitest; produces JSON output for CI assertion
- `InMemoryTransport` (from `@modelcontextprotocol/sdk/inMemory.js`, already installed): in-process MCP transport for tool contract tests — 10-50x faster than subprocess spawning, exercises full JSON-RPC dispatch path without any process boundary
- `vi.useFakeTimers()` (vitest built-in): controls debounce timing in watcher tests without real waits
- Linux abstract sockets (`\0filescope-test-${process.pid}`): broker test isolation — auto-cleanup, no unlink needed; safe for WSL2/Linux-only project

**Version pinning note:** Do NOT upgrade vitest to v4.x in this milestone. The `vi.restoreAllMocks()` behavior change and coverage V8 number drift require a separate migration audit.

### Expected Features

FileScopeMCP v1.5 defines "production-grade" as: agents never need to know the server exists, it never corrupts state on restart, it fails with actionable messages, and its test suite catches regressions before they reach agents.

**Must have (table stakes for v1.5):**
- MCP transport tests via `InMemoryTransport` — largest coverage gap; zero protocol-layer tests exist today
- Tool schema compliance migration (`server.tool()` → `server.registerTool()` with `z.object()`) — required for SDK v2 compatibility and `ctx` parameter access; mechanical change across 15 registrations
- Tool annotations (`readOnlyHint: true` on 13 read-only tools, `destructiveHint: true` on `exclude_and_remove`) — MCP 2025-11-25 spec requirement
- `.mcp.json` project-scoped config at repo root — zero-config Claude Code auto-discovery on clone; primary replacement for broken `install-mcp-claude.sh`
- Broker lifecycle tests (PID guard deduplication + SIGTERM cleanup) — broker is well-coded but completely untested
- Structured error codes (`{ ok: false, error: "CODE", message: "..." }`) — agents need machine-readable error reasons, not opaque `isError: true` blobs
- `notifications/tools/list_changed` wired to coordinator init — capability is declared but notification never fires; fix to `tools: {}` until it does, then wire it

**Should have (P2, add if scope permits within v1.5):**
- MCP Prompts (`get-onboarding-context`, `find-entry-points`) — guided agent workflows via slash command discovery; requires `registerTool()` migration first for API consistency
- Progress notifications for `scan_all` — requires `registerTool()` migration to complete first (needs `ctx` access for `ctx.mcpReq.notify()`)

**Defer to v1.6+:**
- MCP Resources with `notifications/resources/updated` — HIGH complexity, conflicts with the "query-based not push-based" design constraint in PROJECT.md; requires explicit design spike before implementation
- `outputSchema` per-tool — add only to `status` tool (the one with a stable response shape); adding to all 14 tools creates the `outputSchema` + `isError` SDK bug (issue #699) with no agent benefit for freeform text tools

**Anti-features to never implement:**
- Sampling / elicitation — broker is the sole LLM interface; client sampling breaks local-first design and creates model quality dependency on the agent's LLM
- HTTP/SSE transport alongside stdio — PROJECT.md: "no dual-mode fallbacks"
- Retry logic in tools — project memory: "rare model failures self-heal, don't add retry complexity"

### Architecture Approach

The existing architecture is clean and testable by design. `ServerCoordinator` is instantiable without MCP transport. The repository layer is pure SQL behind a boundary. The broker client is a module-level singleton that must be `vi.mock`'d in all non-lifecycle tests. v1.5 adds no new architectural layers — it hardens existing ones and fills test gaps.

v1.5 modifies three source files and adds two new test files and two new non-test files. No other files change.

**Components modified in v1.5:**
1. `src/mcp-server.ts` — migrate to `registerTool()`, add annotations, bump version to `1.5.0`, add `logging: {}` capability, standardize error response format
2. `src/broker/main.ts` — add `emergencyCleanup()` + `uncaughtException` / `unhandledRejection` handlers; prevents zombie sockets on crash (currently unregistered handlers are the gap)
3. `src/broker/client.ts` — replace hardcoded 500ms sleep after spawn with 100ms-interval socket-existence poll (up to 3s); eliminates flaky startup race on loaded machines

**New files:**
1. `tests/integration/mcp-transport.test.ts` — `McpServer` + `McpClient` via `InMemoryTransport`; exercises full tool dispatch path
2. `tests/integration/broker-lifecycle.test.ts` — spawns actual broker binary; tests PID guard, SIGTERM cleanup, crash recovery; only test that must NOT mock `broker/client.ts`
3. `.mcp.json` — project root, committed to git; project-scoped Claude Code auto-discovery
4. `scripts/register-mcp.ts` — TypeScript port of `install-mcp-claude.sh`; uses `claude mcp add` CLI instead of direct `~/.claude.json` writes (which are broken in Claude Code 2.x)

### Critical Pitfalls

1. **stdout pollution crashes the MCP transport** — Any non-JSON-RPC byte (debug log, native module warning) silently corrupts JSON-RPC framing. Prevention: add a CI smoke test asserting the first byte from `dist/mcp-server.js` is `{`. Warning sign: `SyntaxError: Unexpected token` in client logs immediately on connection.

2. **PID recycled to a different process** — `process.kill(pid, 0)` returns success for a dead broker PID recycled by the OS to another process. Broker client believes broker is alive, never respawns, connection fails indefinitely. Prevention: two-factor liveness check — PID alive AND socket file exists; if socket absent but PID "alive," respawn anyway after removing the PID file.

3. **`listChanged: true` declared but notification never fires** — Strict MCP clients cache a stale tool list. Prevention: change to `tools: {}` (omit = defaults false) until `sendToolListChanged()` is actually wired to coordinator init completion. A false `listChanged: true` is currently in production.

4. **`outputSchema` added without returning `structuredContent`** — SDK issue #699 makes this a runtime error, not a type error. Prevention: add `outputSchema` only to `status` tool. Never add it to tools that use `createMcpResponse()` (which returns `content` only, not `structuredContent`).

5. **Orphaned child processes from integration tests** — Tests that spawn `dist/mcp-server.js` and fail mid-assertion leave orphans holding SQLite WAL locks, causing cascading `SQLITE_BUSY` failures. Prevention: register `process.on('exit', ...)` cleanup handler in test setup tracking all spawned child PIDs; use `afterEach` (not just `afterAll`) to kill per-test spawns; never use `detached: true` for test-spawned processes.

6. **`.claude.json` registration target broken in Claude Code 2.x** — `install-mcp-claude.sh` writes to `~/.claude.json` which is ignored or rejected in current Claude Code versions. Prevention: replace with `claude mcp add` CLI calls and/or `.mcp.json` at project root. Verify success by running `claude mcp list`, not by checking file contents.

7. **Reconnect timer fires during MCP server shutdown** — If the broker reconnect timer fires between SIGTERM receipt and `process.exit()`, it may call `spawnBrokerIfNeeded()` (spawning a new broker) and subsequently call `resubmitStaleFiles()` after the DB is closed (SQLITE_MISUSE). Prevention: call `disconnect()` as the very first step in the MCP server shutdown sequence, before stopping the file watcher or closing the DB.

---

## Implications for Roadmap

Research establishes a clear phase ordering driven by the dependency chain documented in ARCHITECTURE.md. Phases 1 and 2 are independent and can proceed in parallel. Phase 3 depends on both. Phase 4 is pure config with no code dependency on the others but should target a hardened binary.

### Phase 1: Broker Lifecycle Hardening

**Rationale:** Self-contained to `broker/main.ts` and `broker/client.ts`. No dependencies on other v1.5 work. Eliminates the two real reliability bugs (crash cleanup gap, spawn timing race) before any test infrastructure is written. Writing lifecycle tests (Phase 3) against a hardened broker is the correct order.

**Delivers:** Crash-safe broker — socket and PID files always cleaned up on uncaught exception; broker startup latency bounded to actual socket-existence time (up to 3s) instead of a fixed 500ms worst-case; correct shutdown ordering in coordinator.

**Addresses (from FEATURES.md):** Broker lifecycle tests (P1), SIGTERM cleanup correctness, PID guard deduplication.

**Avoids (from PITFALLS.md):** Pitfall 2 (PID recycling — two-factor liveness check), Pitfall 6 (socket orphan on SIGKILL — uncaughtException handler), Pitfall 9 (reconnect timer fires during shutdown — disconnect() first in shutdown sequence).

**Code changes:** `src/broker/main.ts` (add `emergencyCleanup()`, `uncaughtException`, `unhandledRejection` handlers), `src/broker/client.ts` (socket poll replaces 500ms sleep), `src/coordinator.ts` (minor: harden `shutdown()` PID cleanup on throw).

**Research flag:** Standard Node.js stdlib patterns — no deeper research needed.

### Phase 2: MCP Spec Compliance

**Rationale:** Entirely self-contained to `src/mcp-server.ts`. No dependency on broker changes or test infrastructure. Can run in parallel with Phase 1. Writing MCP transport tests (Phase 3) against the `registerTool()` API is correct — writing them against the deprecated `server.tool()` API would require immediate rewriting.

**Delivers:** Spec-compliant tool registration with proper annotations, correct `listChanged` capability advertisement, structured error codes that LLM agents can parse programmatically, server version bumped to `1.5.0`.

**Addresses (from FEATURES.md):** All P1 spec compliance items — `registerTool()` migration (15 calls), tool annotations (13 read-only + 2 destructive), `listChanged` fix, structured error codes `{ ok: false, error: "CODE", message: "..." }`.

**Avoids (from PITFALLS.md):** Pitfall 3 (`listChanged: true` without notification — fix to `tools: {}` or wire the notification), Pitfall 4 (over-implementing unused capabilities — no Resources/Prompts/Sampling capabilities unless handlers exist), Pitfall 4 (`outputSchema` SDK bug — add only to `status` tool).

**Code changes:** `src/mcp-server.ts` only — `server.tool()` → `server.registerTool()`, add annotations per-tool, fix `tools: { listChanged: true }` to `tools: {}`, bump version to `"1.5.0"`, add `logging: {}` capability, standardize error response format across all 15 tool handlers.

**Research flag:** Mechanical migration — SDK migration guide fully documents the API change. No deeper research needed.

### Phase 3: Test Infrastructure

**Rationale:** Depends on both Phase 1 (broker-lifecycle.test.ts is only meaningful after crash cleanup handlers exist) and Phase 2 (mcp-transport.test.ts verifies `registerTool()` API, not the deprecated API). This phase closes the largest quality gap: zero MCP protocol-layer test coverage today despite 512 tests existing.

**Delivers:** Full protocol-layer test coverage — `InMemoryTransport`-based tool contract tests, broker lifecycle integration tests (spawn/connect/SIGTERM/crash-recovery), watcher debounce tests. Stdout cleanliness smoke test added to CI.

**Addresses (from FEATURES.md):** MCP transport tests (P1 — highest priority), broker lifecycle tests (P1), watcher/config subsystem coverage.

**Avoids (from PITFALLS.md):** Pitfall 1 (stdout pollution — add `first byte = {` smoke test), Pitfall 2 (Vitest parallel DB race — enforce `mkdtemp` uniqueness, never share DB paths), Pitfall 3 (testing handlers directly — use `InMemoryTransport`, not internal handler imports), Pitfall 10 (orphaned child processes — register exit cleanup handler for all spawned children).

**New packages:** `npm install -D memfs @modelcontextprotocol/inspector`

**New files:** `tests/integration/mcp-transport.test.ts`, `tests/integration/broker-lifecycle.test.ts`

**Research flag:** The broker lifecycle integration test involves spawning a real binary in vitest's worker pool. Confirm `pool: 'forks'` behavior with spawned children in WSL2 before full test authoring — a 30-minute spike is recommended. Recovery if it needs adjustment is low-risk (use explicit `child.kill()` rather than relying on signal propagation).

### Phase 4: Zero-Config Auto-Registration

**Rationale:** Depends on nothing except the build pipeline being stable and the binary being hardened. Implement last so the binary registered with Claude Code is the fully hardened v1.5 binary. The `.mcp.json` file itself has zero code dependencies — pure config committed to git. The `scripts/register-mcp.ts` TypeScript port replaces direct `~/.claude.json` file writes (broken in Claude Code 2.x) with `claude mcp add` CLI calls.

**Delivers:** Zero-config setup — clone + `npm run build` = working FileScopeMCP in Claude Code, no manual script execution. `.mcp.json` at repo root provides project-scoped auto-discovery. `scripts/register-mcp.ts` provides user-scoped registration. Install script verifies success by running `claude mcp list`.

**Addresses (from FEATURES.md):** `.mcp.json` project-scoped config (P1), `install-mcp-claude.sh` replacement.

**Avoids (from PITFALLS.md):** Pitfall 4 (`.claude.json` target broken in Claude Code 2.x — must use `claude mcp add` CLI or `.mcp.json`).

**New files:** `.mcp.json` (repo root, committed to git), `scripts/register-mcp.ts`

**Research flag:** Standard Claude Code MCP docs. `.mcp.json` format is fully specified. No deeper research needed.

### Phase Ordering Rationale

- Phases 1 and 2 are fully independent — work them in parallel if two developers are available, or in either order if sequential.
- Phase 3 cannot start until both Phase 1 and Phase 2 are complete. Writing tests against pre-migration code creates immediate rework.
- Phase 4 is pure config and can technically happen any time after Phase 1, but placing it last ensures the registered binary is the fully hardened version.
- P2 features (MCP Prompts, progress notifications) require Phase 2 to complete first (need `ctx` from `registerTool()`). Treat as stretch goals within Phase 3 or as a Phase 5 if scope is tight. Progress notifications also need a coordinator change (progress callback parameter) not covered in Phase 2.

### Research Flags

Phases with standard patterns (no additional research needed):
- **Phase 1 (Broker hardening):** `uncaughtException` pattern and socket poll are well-documented Node.js stdlib patterns. Direct code changes with no design unknowns.
- **Phase 2 (MCP spec compliance):** Mechanical migration fully documented in SDK migration guide. All 15 call sites enumerated in the research.
- **Phase 4 (Auto-registration):** `.mcp.json` format fully specified in Claude Code docs. Pure config file and a TypeScript port of an existing shell script.

Phase needing a targeted spike before full authoring:
- **Phase 3 (Test infrastructure), broker lifecycle tests:** Confirm vitest `pool: 'forks'` behavior with spawned child processes in WSL2 before writing the full `broker-lifecycle.test.ts`. Low-risk — the spike is one test invocation to verify signal propagation works as expected.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Two new packages verified via live npm registry. `InMemoryTransport` import path verified by running `node --input-type=module` against the installed SDK v1.27.1. Vitest v3 vs v4 decision verified against official v4 release notes. |
| Features | HIGH | Based on MCP spec 2025-11-25, official SDK docs via Context7, Claude Code MCP docs, and direct codebase inspection. All 15 `server.tool()` call sites enumerated. Feature priorities reflect confirmed capability gaps, not speculation. |
| Architecture | HIGH | All architectural claims verified against actual source files (`src/mcp-server.ts` 615 lines, `src/broker/main.ts`, `src/broker/client.ts`, `tests/integration/file-pipeline.test.ts`). No inferred relationships. |
| Pitfalls | HIGH | All critical pitfalls sourced from official Node.js docs, MCP SDK issue tracker (issue #699, issue #4976), official Claude Code docs, and direct source code audit. Each has specific warning signs, phase assignments, and recovery strategies. |

**Overall confidence:** HIGH

### Gaps to Address

- **MCP Resources design conflict:** FEATURES.md identifies that `notifications/resources/updated` conflicts with PROJECT.md's "query-based not push-based" constraint. This conflict must be resolved before v1.6 scoping. It is cleanly deferred from v1.5 — no gap for the current milestone.

- **P2 feature scope:** Whether MCP Prompts and progress notifications land in v1.5 or slip to v1.5.x depends on velocity after Phase 2 completes. Progress notifications also require a coordinator change (progress callback parameter) not scoped into Phase 2. This is an execution dependency, not a research gap.

- **WSL2 vitest fork pool + child process signal propagation:** Low-risk gap. A 30-minute spike to confirm `SIGTERM` propagates correctly from vitest worker to spawned child processes in WSL2 before writing the full broker lifecycle test. Recovery if it fails: use explicit `child.kill()`.

---

## Sources

### Primary (HIGH confidence)

- `/home/autopcap/FileScopeMCP/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.d.ts` — confirmed `InMemoryTransport.createLinkedPair()` in installed v1.27.1
- `node --input-type=module` live verification — confirmed `InMemoryTransport` import path works
- `/modelcontextprotocol/typescript-sdk` via Context7 — `registerTool`, `InMemoryTransport`, migration guide, `sendToolListChanged`, progress notifications, tool annotations
- MCP Spec 2025-11-25 (tools, lifecycle, annotations): https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- MCP TypeScript SDK migration guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration.md
- Claude Code MCP documentation (`.mcp.json`, `claude mcp add`): https://code.claude.com/docs/en/mcp
- Vitest file system mocking docs: https://vitest.dev/guide/mocking/file-system
- Vitest fake timers docs: https://vitest.dev/guide/mocking/timers
- Vitest 4.0 release notes (rationale for staying on v3): https://vitest.dev/blog/vitest-4
- Node.js `net` docs (abstract socket pattern): https://nodejs.org/api/net.html
- Direct codebase inspection: `src/mcp-server.ts`, `src/coordinator.ts`, `src/broker/main.ts`, `src/broker/client.ts`, `src/broker/server.ts`, `tests/integration/file-pipeline.test.ts`, `tests/unit/broker-queue.test.ts`, `package.json`

### Secondary (MEDIUM confidence)

- MCP Inspector GitHub: https://github.com/modelcontextprotocol/inspector — confirmed `--cli` flag and JSON output for automation
- MCPcat unit testing guide: https://mcpcat.io/guides/writing-unit-tests-mcp-servers/ — in-memory testing as table stakes pattern
- mcp-server-e2e-testing-example: https://github.com/mkusaka/mcp-server-e2e-testing-example — canonical InMemoryTransport + vitest pattern

### Tertiary (informational)

- MCP TypeScript SDK issue #699 (`outputSchema` + `isError` runtime error): https://github.com/modelcontextprotocol/typescript-sdk/issues/699
- Claude Code `.claude.json` schema change issue #4976: https://github.com/anthropics/claude-code/issues/4976
- Node.js graceful shutdown with SIGKILL timeout pattern: https://dev.to/axiom_agent_1dc642fa83651/nodejs-graceful-shutdown-the-right-way-sigterm-connection-draining-and-kubernetes-fp8
- NearForm MCP implementation tips and pitfalls: https://nearform.com/digital-community/implementing-model-context-protocol-mcp-tips-tricks-and-pitfalls/

---

*Research completed: 2026-04-17*
*Ready for roadmap: yes*
