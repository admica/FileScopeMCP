# FileScopeMCP

## What This Is

A fully autonomous file intelligence system that watches project directories and maintains rich, up-to-date metadata about every file — summaries, relationships, key concepts, and change impact — so LLMs can query structured knowledge about a codebase without reading raw files. Runs as a standalone daemon or as an MCP server, with a background LLM that handles all metadata maintenance automatically.

## Core Value

LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## Current Milestone: v1.3 Nexus

**Goal:** Read-only web dashboard that opens existing per-repo databases and log files directly — cross-repo observability without a new daemon or protocol.

**Target features:**
- Fastify JSON API server + Svelte 5 SPA (Vite + Tailwind CSS, dark mode only)
- Interactive dependency map via Cytoscape.js, auxiliary charts via D3.js
- Repo discovery: `~/.filescope/nexus.json` registry with 2-level auto-discovery fallback
- Per-repo file tree with importance heat colors, staleness indicators, and lazy directory expansion
- File detail panel: summary, concepts, change impact, exports, dependencies/dependents, staleness
- D3 force-directed dependency graph with hover/click interactions and directory filtering
- System view: broker status (via broker.sock), per-repo token stats, live activity feed
- SSE log tailing of broker.log and mcp-server.log via fs.watch() + ring buffer
- CLI entry point (`filescope-nexus`) with `--port` and `--host` flags, default `0.0.0.0:1234`
- Read-only SQLite access (WAL mode, re-query per request), no writes to any FileScopeMCP data
- Graceful degradation (broker down = "offline" badge, repo DB missing = "offline" tab)

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Recursive directory scanning with file tree building — existing
- ✓ Multi-language import/dependency parsing (JS/TS, Python, C/C++, Rust, Lua, Zig, PHP, C#, Java, Go, Ruby) — v1.1
- ✓ File importance scoring (0-10 scale based on dependents, type, location) — existing
- ✓ Real-time file system watching with debounced change detection — existing
- ✓ Atomic state mutations via async mutex — existing
- ✓ Incremental tree updates on file change — existing
- ✓ Self-healing integrity sweep (startup sweep + lazy mtime validation) — v1.1
- ✓ Persistent SQLite storage with WAL mode — v1.0
- ✓ MCP tool interface (20+ tools for querying and managing file metadata) — existing
- ✓ Manual summary get/set via MCP tools — existing
- ✓ File content reading via MCP — existing
- ✓ Configurable file watching (toggle, update config) — existing
- ✓ Exclude patterns and tree management — existing
- ✓ SQLite storage with transparent JSON migration — v1.0
- ✓ Standalone coordinator + daemon mode (24/7 operation) — v1.0
- ✓ AST-level semantic change detection for TS/JS — v1.0
- ✓ LLM-powered diff fallback for unsupported languages — v1.0
- ✓ Cascade engine: staleness propagation through dependency graph — v1.0
- ✓ Per-field staleness tracking (summary, concepts, change_impact) — v1.0
- ✓ Background LLM auto-generates summaries, concepts, and change impact — v1.0
- ✓ Multi-provider LLM adapter (OpenAI-compatible, Anthropic, Ollama, vLLM) — v1.0
- ✓ LLM toggle on/off via config or MCP tool — v1.0
- ✓ Token budget limits and rate limiting — v1.0
- ✓ Priority-ordered job queuing (interactive > cascade > background) — v1.0
- ✓ Circular dependency protection in cascade — v1.0
- ✓ Full backward compatibility with existing MCP tools — v1.0
- ✓ BFS transitive importance propagation with cycle safety — v1.1
- ✓ Watcher restart backoff reset (60s stability timer) — v1.1
- ✓ .filescopeignore support with gitignore semantics — v1.1
- ✓ Go and Ruby language support — v1.1
- ✓ Streaming async directory scan with two-pass SQLite integration — v1.1
- ✓ mtime-based lazy validation replacing polling integrity sweep — v1.1
- ✓ Cycle detection (Tarjan's SCC) via MCP tools — v1.1
- ✓ Code quality consolidation (fs imports, canonicalizePath, dead code removal) — v1.1
- ✓ Standalone broker process with in-memory priority queue and Ollama processing — v1.2
- ✓ Unix domain socket IPC at ~/.filescope/broker.sock — v1.2
- ✓ Broker builds prompts and handles structured output fallback — v1.2
- ✓ Cross-repo importance-based job prioritization (importance DESC, created_at ASC) — v1.2
- ✓ Instance-side broker client with auto-discovery and reconnection — v1.2
- ✓ Job dedup (one pending job per file+type per repo, latest content wins) — v1.2
- ✓ Job timeout (120s) for hung Ollama calls — v1.2
- ✓ Stale socket/PID cleanup on broker startup — v1.2
- ✓ Startup resubmission batching (stale files by importance on reconnect) — v1.2
- ✓ Config migration: LLM model config moved to broker, instance has enabled-only — v1.2
- ✓ Broker status reporting via MCP tool — v1.2
- ✓ Remove legacy llm_jobs/llm_runtime_state tables and local job queue — v1.2
- ✓ Interactive dependency map via Cytoscape.js — v1.3 (Phase 22)
- ✓ File detail panel (summary, concepts, deps, staleness) — v1.3 (Phase 21)

### Active

<!-- Current scope. Building toward these. -->

- Fastify JSON API + Svelte 5 SPA dashboard — v1.3 (Phase 20 delivered server + SPA scaffold)
- Per-repo file tree with importance heat colors — v1.3
- System view with broker status and token stats — v1.3
- SSE log tailing — v1.3

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Multi-project in a single instance — one instance per project, simpler isolation
- Real-time streaming of changes to MCP clients — query-based, not push-based
- Code generation or refactoring — this is a read/analysis tool, not a writer
- Git integration (blame, history, branch awareness) — file-system level only
- Nexus event-collection daemon — original concept replaced by read-only dashboard; all data already exists in per-repo data.db, broker.log, and stats.json
- Vector embedding search — structured metadata serves LLM needs better
- Full AST caching in storage — ASTs too large and go stale immediately
- Lazy file content for large codebases — deferred to future milestone
- Multi-GPU / concurrent broker workers — design supports it, implement when needed
- Broker hot-reload of config/model — restart broker to change config
- Formal version handshake between broker and instances — defer to future milestone

## Context

Shipped v1.0 (9 phases, 9,515 LOC), v1.1 (6 phases, hardening + language support), and v1.2 (4 phases, LLM broker). 250+ tests passing. The system is a complete autonomous file intelligence platform with a standalone LLM broker coordinating all Ollama access.

v1.3 builds the Nexus — a visual code exploration dashboard that opens existing per-repo SQLite databases and log files to provide cross-repo observability. No new daemon or IPC protocol — the data already exists. Architecture fully designed in NEXUS-PLAN.md. Fastify API + Svelte 5 SPA + Cytoscape.js/D3 + Tailwind dark mode, accessible on the LAN at `0.0.0.0:1234`.

**Phase 20 complete** (2026-04-01): Server skeleton + repo discovery — Fastify backend with CLI entry, 2-level repo auto-discovery, read-only SQLite connections, JSON API, Svelte 5 SPA with hash router, dark navbar, stats cards.

**Phase 21 complete** (2026-04-02): File tree + detail panel — collapsible directory tree with lazy loading, file detail panel (summary, concepts, change impact, exports, deps, staleness), directory aggregate panel.

**Phase 22 complete** (2026-04-02): Dependency graph — Cytoscape.js interactive dependency map with fcose layout, importance-based node sizing, directory-based coloring, hover highlighting, click-to-detail navigation, directory subtree filter, tree/graph toggle.

Tech stack: TypeScript 5.8, Node.js 22, ESM, esbuild, @modelcontextprotocol/sdk, chokidar, zod, vitest, better-sqlite3, drizzle-orm, tree-sitter, Vercel AI SDK.

## Constraints

- **Runtime**: Node.js 22 — must stay compatible, no native modules that limit portability
- **MCP compatibility**: Must maintain backward compatibility with existing MCP tool interface
- **One instance per project**: Simplifies state management and isolation
- **Single GPU**: Broker must serialize LLM calls — one at a time
- **Zero-config for single repo**: Broker is optional — single-repo users must not need it

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid AST + LLM change analysis | AST is fast/free for supported languages, LLM covers the rest | ✓ Good |
| SQLite over JSON for storage | Richer queries, scales better with metadata growth | ✓ Good |
| Multi-provider LLM adapter | Flexibility across local and cloud providers | ✓ Good |
| Smart cascade over full cascade | Prevents unnecessary LLM calls on dependents | ✓ Good |
| Dual-mode (daemon + MCP server) | Daemon keeps metadata fresh 24/7; MCP mode for lighter use | ✓ Good |
| One instance per project | Clean isolation, no cross-project state complexity | ✓ Good |
| Background LLM is opt-in | System works without it; toggle via config or MCP | ✓ Good |
| better-sqlite3 via createRequire | Native ESM project needs CJS addon loading | ✓ Good |
| Vercel AI SDK for LLM abstraction | Unified interface across providers | ✓ Good |
| Standalone broker over leader election | Predictable, no failover complexity, clean separation | ✓ Good |
| In-memory queue over shared SQLite | Broker is a service not a database; jobs are transient | ✓ Good |
| Unix domain socket over TCP/HTTP | Local-only, no port conflicts, fast IPC | ✓ Good |
| Broker builds prompts | Avoids Zod schema serialization; centralizes LLM interaction | ✓ Good |
| No dual-mode fallback | Broker or no LLM — single code path, no complexity | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-02 after Phase 22 completion*
