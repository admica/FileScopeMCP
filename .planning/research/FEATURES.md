# Feature Research

**Domain:** Production-grade MCP server hardening (FileScopeMCP v1.5)
**Researched:** 2026-04-17
**Confidence:** HIGH (MCP SDK via Context7 + Claude Code docs via WebFetch + MCP spec via WebSearch + live codebase inspection)

---

## Context: What "Production-Grade" Means for This Domain

FileScopeMCP is a stdio-transport MCP server used as a per-repo daemon by LLM agents (primarily Claude Code). "Production-grade" means: agents never need to know it exists, it never corrupts state on restart, it fails loudly with actionable messages, and its test suite catches regressions before they reach agents.

The four categories from the milestone scope map to discrete feature groups:

1. **Comprehensive testing** — MCP transport/protocol layer coverage
2. **MCP spec compliance** — resources, prompts, notifications, tool schema hardening
3. **Zero-config agent integration** — .mcp.json, registration improvements
4. **Graceful lifecycle management** — broker hardening, crash recovery, shutdown correctness

**Current state summary from codebase inspection:**
- 15 tool registrations using the `server.tool()` v1 API pattern (no `ctx` parameter access)
- Only `tools: { listChanged: true }` declared in capabilities — never fires
- No resources, no prompts, no progress notifications
- `install-mcp-claude.sh` manually edits `~/.claude.json`; no `.mcp.json` in repo root
- `mcp-server.test.ts` (734 lines) tests DB functions only — zero transport-level protocol tests
- Broker lifecycle (PID guard, socket cleanup, SIGTERM) is well-implemented but untested

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features LLM agents and developers assume exist. Missing these = trust in the server breaks.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| MCP transport tests (end-to-end tool invocation via protocol) | Agents call tools through the JSON-RPC layer; unit-only DB tests leave the full protocol path untested and invisible to CI | MEDIUM | Use `InMemoryTransport` to connect a real `McpServer` + `McpClient` in vitest, invoke `client.callTool()`, assert on response shape. In SDK v1.27.1 (installed), still importable from `@modelcontextprotocol/sdk/inMemory.js`. |
| Tool schema compliance via `registerTool()` with `z.object()` | MCP SDK v2 requires `inputSchema` to be a `z.object()` not a raw shape; the v1 `server.tool(name, rawShape, handler)` is deprecated and blocks access to the `ctx` object | LOW | All 15 `server.tool()` calls must migrate to `server.registerTool()` with `inputSchema: z.object({...})`. Mechanical change. |
| Tool annotations (`readOnlyHint: true` on query tools) | MCP 2025-11-25 spec added tool annotations; `readOnlyHint: true` prevents agents from treating read-only tools as state-mutating | LOW | Apply to all 13 read-only tools (list_files, find_important_files, get_file_summary, status, detect_cycles, get_cycles_for_file, get_communities, search). Zero code beyond the annotation object. |
| `.mcp.json` project-scoped config in repo root | Claude Code auto-discovers `.mcp.json` in project root — no `claude mcp add` or manual `~/.claude.json` editing required. Contributors get zero-config setup on clone. | LOW | Create `.mcp.json` with `--base-dir=${workspaceFolder}` so the server self-targets the current project. Commit to git. |
| `notifications/tools/list_changed` fires after init | Server declares `tools: { listChanged: true }` but never sends the notification. Clients that connect before init completes see an empty tool list until they explicitly re-query. | LOW | One call to `server.sendToolListChanged()` inside coordinator's init completion callback. Lets Claude Code refresh its tool list automatically. |
| Broker lifecycle tests (PID guard, socket cleanup, SIGTERM) | The broker's crash-safety logic is well-coded but entirely untested. Any refactor can silently break PID deduplication or leave zombie sockets. | MEDIUM | Test `checkPidGuard()` with: no PID file, stale PID file (dead PID), live PID file (running). Test broker start + SIGTERM + verify socket/PID file removed. |
| Structured error responses with parseable error indicator | LLM agents need machine-readable error reasons, not just `isError: true` with free text. The current `createMcpResponse(text, true)` pattern produces opaque blobs. | MEDIUM | Standardize all error paths to return `{ ok: false, error: "CODE", message: "..." }` JSON object instead of raw strings. Agents can branch on `ok`. |

### Differentiators (Competitive Advantage)

Features beyond what most MCP servers provide. These increase agent trust and discoverability.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| MCP Prompts for common agent workflows | Expose curated prompt templates (`get-onboarding-context`, `find-entry-points`, `explain-community`) via `server.registerPrompt()`. Claude Code shows these in slash command discovery. Turns raw tools into a guided interface. | MEDIUM | Uses `server.registerPrompt()` API (v2). Each prompt composes 2–3 tool calls into a pre-built message sequence. Most MCP servers expose only raw tools. |
| Progress notifications for `scan_all` | `scan_all` runs for seconds on large repos. Without `notifications/progress`, the agent's context stalls with no feedback. With progress, agents can show real state. | MEDIUM | Requires `registerTool` migration first (to get `ctx` access). Add progress callback to coordinator scan loop that calls `ctx.mcpReq.notify()` when a progressToken is provided. |
| MCP Resources for file summaries with push | Expose file metadata as MCP resources (`filescope://summary/<path>`) so clients can subscribe and receive `notifications/resources/updated` when the watcher detects changes. True push intelligence. | HIGH | Requires `server.registerResource()` + `ResourceTemplate` + wiring `sendResourceUpdated()` into the change handler. Most MCP servers do not implement resources. High complexity — own phase or milestone. |
| Conformance test via `@modelcontextprotocol/conformance` | Running the official MCP conformance suite proves spec compliance end-to-end beyond unit tests. `npx @modelcontextprotocol/conformance server --scenario server-initialize` | MEDIUM | Conformance runner targets HTTP transport. Requires a thin HTTP shim wrapper around the existing stdio server, or running the conformance tests against a local test server instance. |
| Health endpoint: stable `ok` flag in `status` tool | `status` tool already returns rich JSON. The differentiator is a guaranteed `ok: boolean` at top level that orchestrators can parse without text extraction. Schema stabilization. | LOW | Add `ok: true` to happy-path `status` response and `ok: false` to error paths. Document the schema. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Sampling (server requests LLM completion from client) | "MCP supports it, add it for spec completeness" | FileScopeMCP has its own LLM via the broker. Using client sampling creates a dependency on whatever model the agent runs — different quality, different cost, breaks local-first design. | Keep broker as the sole LLM interface. |
| Elicitation (server prompts user for input mid-tool) | "Interactive config flows" | FileScopeMCP is a background daemon. No interactive user session exists. Elicitation would silently block in daemon mode. | Config via file (broker.json), CLI flags, or MCP tool parameters. |
| HTTP/SSE transport alongside stdio | "More clients could connect" | One instance per project, one agent session at a time. HTTP adds port conflict risk, auth concerns, and concurrency complexity. PROJECT.md: "no dual-mode fallbacks." | stdio is correct for this use case. |
| Full MCP 2025-11-25 async Tasks spec | Latest spec has infrastructure for async long-running tasks | Significant complexity for a feature that progress notifications already cover. `scan_all` rarely exceeds 10s. | Progress notifications + 5s shutdown timeout. |
| OAuth / capability authorization | Enterprise MCP spec mandates OAuth 2.1 | FileScopeMCP is localhost-only. No network exposure, no shared secrets. Auth adds friction with zero security gain. Explicitly out of scope in PROJECT.md. | N/A — trusted localhost process only. |
| Retry logic for LLM/broker failures inside tools | "Handle transient broker unavailability transparently" | Project memory: "rare model failures self-heal, don't add retry complexity." Retries hide bugs, inflate response times, and make tests non-deterministic. | Let broker timeout propagate as error. Agents retry at their discretion. |
| Per-tool token budget in config file | "Different tools should have different default token limits" | Over-engineered. Single global `maxResponseTokens` covers 95% of use cases. Per-tool config adds schema complexity for negligible benefit. | Callers override per-call via `maxTokens` parameter (already present on list_files). |

---

## Feature Dependencies

```
Tool Schema Compliance (registerTool migration)
    └──required-by──> Progress Notifications (ctx access required)
    └──required-by──> Tool Annotations (part of registerTool config object)
    └──required-by──> notifications/tools/list_changed (sendToolListChanged API)
    └──blocks──>      nothing (backward-compatible migration)

MCP Transport Tests
    └──requires──> InMemoryTransport (from @modelcontextprotocol/sdk/inMemory.js)
    └──requires──> McpClient import (from @modelcontextprotocol/sdk/client/index.js)
    └──enhances──> all existing unit tests (transport layer now covered)

.mcp.json project-scoped config
    └──independent──> (pure config file, no code dependency)
    └──replaces──>    install-mcp-claude.sh as primary onboarding path

MCP Prompts
    └──requires──> Tool Schema Compliance (registerTool first for consistency)
    └──enhances──> existing tool results (wraps them into message sequences)

Progress Notifications for scan_all
    └──requires──> Tool Schema Compliance (ctx parameter only available in registerTool)
    └──requires──> coordinator scan loop accepts progress callback

MCP Resources with push notifications
    └──requires──> Tool Schema Compliance (must use registerTool v2 API pattern)
    └──requires──> watcher change events (already present in coordinator)
    └──requires──> ResourceTemplate for dynamic per-file URIs
    └──conflicts-with──> "query-based not push-based" design note in PROJECT.md
                         (resolve explicitly before implementing)

Broker Lifecycle Tests
    └──tests──> existing broker/main.ts PID guard and shutdown logic (no new code)
    └──requires──> vitest + tmp directory helpers (already present)
    └──requires──> process signal mocking strategy
```

### Dependency Notes

- **Tool schema compliance must precede notifications and progress:** The v2 `registerTool()` API is the only way to access `ctx.mcpReq` for sending notifications/progress. Current `server.tool()` v1 calls have no `ctx` parameter.
- **Resources require explicit design decision:** PROJECT.md states "real-time streaming of changes to MCP clients — query-based, not push-based" is out of scope. Resources with `sendResourceUpdated()` are push-based. This conflict must be resolved before building resources.
- **.mcp.json is independent:** Can ship in any phase, zero risk, zero code dependency on other features.

---

## Category Analysis

### Category 1: Comprehensive Testing of MCP Transport/Tools

**Current state:** 512 tests across unit and integration test files. Zero tests exercise the MCP protocol stack end-to-end. No test sends a JSON-RPC `tools/call` message and validates the response shape through the full MCP protocol layer.

**What's missing:**
- `McpServer` + `McpClient` connected via `InMemoryTransport` in vitest, with `client.callTool()` calls asserting on structured responses
- Broker IPC tests: verify the NDJSON socket protocol handles `submit`/`status`/`result` message flow
- Config subsystem: `loadBrokerConfig()` default resolution, `~/.filescope/` directory creation on first run
- Watcher: debounce behavior, exclusion pattern matching, restart backoff reset

**Implementation note on InMemoryTransport:** At SDK v1.27.1 (installed), `InMemoryTransport` is importable from `@modelcontextprotocol/sdk/inMemory.js` using the v1 path. The SDK v2 migration moves it to `@modelcontextprotocol/core` (internal, testing only). The upgrade path is documented and non-breaking.

**Complexity:** MEDIUM overall. Each test category is LOW individually, but wiring the full `McpClient`/`McpServer` pair requires understanding the SDK client API.

**Priority: P1 — this is the largest gap between "has unit tests" and "production-grade."**

### Category 2: MCP Spec Compliance

**Current state:** `tools: { listChanged: true }` declared but notification never fires. Tool schemas use the v1 raw shape API. No resources, no prompts, no progress notifications. No tool annotations.

**Table stakes (ship in v1.5):**
- Migrate all 15 `server.tool()` calls to `server.registerTool()` with `inputSchema: z.object({...})` (required for SDK v2 compatibility and `ctx` access)
- Add `readOnlyHint: true` annotation to all read-only tools
- Wire `server.sendToolListChanged()` to coordinator init event

**Differentiators (v1.5 if time permits, otherwise v1.5.x):**
- MCP Prompts for common agent queries
- Progress notifications for `scan_all`

**Deferred (own milestone or spike):**
- MCP Resources with `notifications/resources/updated` — HIGH complexity, conflicts with stated "query-based not push-based" design
- Sampling and elicitation — anti-features for this server's design

**Complexity:** LOW–MEDIUM for table stakes. HIGH for resources.

### Category 3: Zero-Config Agent Integration

**Current state:** `install-mcp-claude.sh` manually edits `~/.claude.json`. Multiple platform-specific `mcp.json.*` variant files exist. No `.mcp.json` in repo root. The existing `run.sh` passes an empty `--base-dir=""` argument (broken for non-specific paths).

**What ".mcp.json zero-config" means in practice:**
1. User clones FileScopeMCP
2. `npm run build`
3. Claude Code auto-discovers `.mcp.json` at project root
4. `FileScopeMCP` appears in the tool list — pointed at the project being analyzed (via `${workspaceFolder}`)
5. No manual `claude mcp add` command, no editing JSON files

**Implementation:**
- `.mcp.json` in repo root: `{ "mcpServers": { "FileScopeMCP": { "command": "node", "args": ["<dist>/mcp-server.js", "--base-dir=${workspaceFolder}"] } } }` — committed to git
- `install-mcp-claude.sh` updated to use `claude mcp add` CLI instead of direct JSON editing (for user-scoped registration when project-scope is not appropriate)

**Complexity: LOW. Pure config, no code.**

### Category 4: Graceful Lifecycle Management

**Current state:**
- MCP server: SIGTERM/SIGINT handlers with 5s forced-exit fallback (`gracefulShutdown()` in mcp-server.ts)
- Broker: PID guard, stale socket cleanup, SIGTERM drain with current-job completion await
- Both appear well-implemented in code

**Gap:** The implementation correctness is asserted only by code review, not by tests. Any refactor can silently break PID deduplication or leave zombie sockets.

**What needs tests:**
- `checkPidGuard()`: (a) no PID file → start normally, (b) stale PID file with dead PID → remove files and start, (c) live PID file with running process → exit 0 without starting
- Broker start + SIGTERM → socket file removed, PID file removed, exit code 0
- MCP server stdin close → coordinator.shutdown() called within 5s
- Force-exit fallback: coordinator.shutdown() hangs → process exits with code 1 within timeout

**Implementation strategy:** Tests for signal handling require either `vi.spyOn(process, 'on')` for unit-level mocking, or spawning the broker as a child process in integration tests and sending real signals. The child process approach is more reliable for testing actual file cleanup.

**Complexity: MEDIUM.** Signal mocking in Node.js tests has subtleties. Child process spawning in vitest requires `forked` mode or `globalSetup`.

---

## MVP Definition

### Ship in v1.5 (This Milestone)

These are the table stakes and low-complexity differentiators that define "production-grade."

- [ ] **Tool schema compliance** — Migrate all 15 `server.tool()` calls to `registerTool()` with `z.object()` input schemas. Required for SDK v2 compatibility and for accessing `ctx`.
- [ ] **Tool annotations** — Add `readOnlyHint: true` to all 13 read-only tools. `destructiveHint: true` to state-mutating tools (set_file_summary, set_file_importance, scan_all, exclude_and_remove, set_base_directory).
- [ ] **`notifications/tools/list_changed`** — Fire `server.sendToolListChanged()` when coordinator completes init. One line of code.
- [ ] **MCP transport tests** — vitest suite: connect `McpServer` + `McpClient` via `InMemoryTransport`, invoke each tool category (query, mutation, status), assert on response structure. This closes the biggest test coverage gap.
- [ ] **Broker lifecycle tests** — PID guard deduplication + SIGTERM cleanup verified under tests.
- [ ] **`.mcp.json` project-scoped config** — Commit working `.mcp.json` to repo root for auto-discovery.
- [ ] **Structured error codes** — Standardize all error response paths to `{ ok: false, error: "ERROR_CODE", message: "..." }`.

### Add After Core Is Stable (v1.5.x)

- [ ] **MCP Prompts** — `get-onboarding-context` and `find-entry-points` prompts. Adds discoverability but not critical for agent correctness.
- [ ] **Progress notifications for `scan_all`** — Coordinator progress callback → `notifications/progress`. Requires registerTool migration to complete first.
- [ ] **Conformance test runner** — Run `@modelcontextprotocol/conformance` against server in CI. Requires resolving the HTTP shim question.

### Defer to v1.6+

- [ ] **MCP Resources with push notifications** — `filescope://summary/<path>` + `notifications/resources/updated`. HIGH complexity, conflicts with "query-based" design constraint. Needs explicit design spike.
- [ ] **Output schema validation** — Add `outputSchema: z.object({...})` to structured JSON tools for client-side validation. Low complexity but requires schema design work for each tool's output shape.

---

## Feature Prioritization Matrix

| Feature | Agent Value | Implementation Cost | Priority |
|---------|-------------|---------------------|----------|
| MCP transport tests (InMemoryTransport) | HIGH | MEDIUM | P1 |
| Tool schema compliance (registerTool + z.object) | HIGH | LOW | P1 |
| Tool annotations (readOnlyHint) | HIGH | LOW | P1 |
| .mcp.json zero-config registration | HIGH | LOW | P1 |
| Broker lifecycle tests | HIGH | MEDIUM | P1 |
| notifications/tools/list_changed | MEDIUM | LOW | P1 |
| Structured error codes | MEDIUM | MEDIUM | P1 |
| MCP Prompts (guided workflows) | MEDIUM | MEDIUM | P2 |
| Progress notifications for scan_all | MEDIUM | MEDIUM | P2 |
| Conformance test runner | LOW | HIGH | P3 |
| MCP Resources + push notifications | HIGH | HIGH | P3 |
| Output schema per-tool | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for v1.5 milestone to be "production-grade"
- P2: Natural extension of P1 work; add within the milestone if scope permits
- P3: Deferred — own milestone or spike required

---

## Existing Features: Do Not Re-Implement

The following are already present and well-implemented in the codebase. v1.5 work is testing and hardening, not rebuilding:

- PID guard + stale socket cleanup on broker startup (`broker/main.ts`)
- SIGTERM/SIGINT handlers for both broker and MCP server
- Coordinator 5-second forced-exit fallback on shutdown
- File watcher with debouncing and restart backoff
- Broker priority queue with job dedup
- Auto-init to CWD on MCP server start
- `tools: { listChanged: true }` capability declaration
- Unix socket NDJSON IPC protocol in broker/server.ts

---

## Dependency on Existing Components

| Existing Component | How v1.5 Changes It |
|-------------------|---------------------|
| `src/mcp-server.ts` | Migrate `server.tool()` to `server.registerTool()`; add tool annotations; wire `sendToolListChanged()`; standardize error response format |
| `src/broker/main.ts` | No code changes — add tests exercising `checkPidGuard()` and shutdown sequence |
| `src/broker/server.ts` | No code changes — add integration tests for socket IPC message handling |
| `src/coordinator.ts` | Add progress callback parameter to scan methods (for progress notifications in P2) |
| `tests/unit/` | New file: `mcp-transport.test.ts` for InMemoryTransport protocol tests |
| `tests/unit/` | New file: `broker-lifecycle.test.ts` for PID guard and shutdown tests |
| `.mcp.json` (new) | New file at repo root — project-scoped Claude Code registration |

---

## Sources

- [MCP TypeScript SDK via Context7](https://context7.com/modelcontextprotocol/typescript-sdk/llms.txt): `registerTool()`, `registerResource()`, `registerPrompt()`, `InMemoryTransport`, `sendToolListChanged()`, progress notifications, server capabilities — HIGH confidence
- [MCP SDK Migration Guide](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration.md): v1→v2 API changes, `InMemoryTransport` relocation to `@modelcontextprotocol/core` — HIGH confidence
- [MCP Server Docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md): `registerTool` with `inputSchema`, `outputSchema`, `annotations`, resource templates, prompt registration — HIGH confidence
- [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp): `.mcp.json` project scope, `claude mcp add` CLI, scoping behavior (project vs user vs local) — HIGH confidence
- [MCP Tools Spec 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25/server/tools): tool annotations spec (`readOnlyHint`, `idempotentHint`, `destructiveHint`), `listChanged` capability, `outputSchema` — HIGH confidence
- [MCP Spec Lifecycle](https://modelcontextprotocol.io/specification/2025-03-26/basic/lifecycle): stdio shutdown sequence (close stdin → wait → SIGTERM → SIGKILL) — HIGH confidence
- [Unit Testing MCP Servers — MCPcat](https://mcpcat.io/guides/writing-unit-tests-mcp-servers/): in-memory testing as table stakes pattern — MEDIUM confidence
- [mcp-server-e2e-testing-example](https://github.com/mkusaka/mcp-server-e2e-testing-example): canonical InMemoryTransport + vitest pattern with stdio and SDK approaches — MEDIUM confidence
- [MCP November 2025 Spec overview](https://medium.com/@dave-patten/mcps-next-phase-inside-the-november-2025-specification-49f298502b03): async tasks, elicitation, enterprise governance additions — MEDIUM confidence
- Live codebase inspection: `src/mcp-server.ts`, `src/broker/main.ts`, `src/broker/server.ts`, `tests/unit/`, `tests/integration/`, `package.json` — HIGH confidence

---

*Feature research for: FileScopeMCP v1.5 Production-Grade MCP Intelligence Layer*
*Researched: 2026-04-17*
