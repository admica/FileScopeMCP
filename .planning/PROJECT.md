# FileScopeMCP

## What This Is

A fully autonomous file intelligence system that watches project directories and maintains rich, up-to-date metadata about every file — summaries, relationships, key concepts, and change impact — so LLMs can query structured knowledge about a codebase without reading raw files. Includes a standalone LLM broker for cross-repo job coordination and a visual code exploration dashboard (Nexus) for cross-repo observability.

## Core Value

LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## Current State

Shipped v1.3 Nexus (2026-04-03). All four milestones complete.

**Architecture:**
- MCP server (per-repo daemon): file watching, metadata maintenance, MCP tool interface
- LLM broker (singleton): standalone process coordinating all Ollama access via Unix socket IPC
- Nexus dashboard: Fastify API + Svelte 5 SPA at 0.0.0.0:1234, read-only SQLite access

**Tech stack:** TypeScript 5.8, Node.js 22, ESM, esbuild, better-sqlite3, drizzle-orm, tree-sitter, chokidar, zod, vitest, Vercel AI SDK, Fastify 5, Svelte 5, Vite 8, Tailwind CSS 4, Cytoscape.js, D3.js

**Codebase:** ~13K LOC TypeScript | 250+ tests passing | 24 phases shipped across 4 milestones

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
- ✓ Fastify JSON API + Svelte 5 SPA dashboard with auto-discovery — v1.3
- ✓ Interactive dependency map via Cytoscape.js — v1.3
- ✓ File tree with importance heat colors, staleness icons, lazy expand — v1.3
- ✓ File detail panel (summary, concepts, change impact, deps, exports, staleness) — v1.3
- ✓ Directory aggregate panel (file count, avg importance, % stale) — v1.3
- ✓ System view with broker status and per-repo token stats — v1.3
- ✓ SSE log tailing with ring buffer and live activity feed — v1.3
- ✓ Navbar repo health status dots (green/orange/gray) — v1.3
- ✓ Settings page with repo remove/blacklist/restore management — v1.3
- ✓ Responsive collapsible layout for project view — v1.3

### Active

<!-- Current scope. Building toward these. -->

(None — planning next milestone)

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
- Authentication / access control for Nexus — read-only viewer on trusted LAN, no secrets exposed
- WebSocket transport for Nexus — SSE sufficient for log streaming, no bidirectional needed

## Context

Shipped v1.0 (9 phases, 9,515 LOC), v1.1 (6 phases, hardening + language support), v1.2 (4 phases, LLM broker), and v1.3 (5 phases, Nexus dashboard). 250+ tests passing. The system is a complete autonomous file intelligence platform with a standalone LLM broker and a visual code exploration dashboard.

Tech stack: TypeScript 5.8, Node.js 22, ESM, esbuild, @modelcontextprotocol/sdk, chokidar, zod, vitest, better-sqlite3, drizzle-orm, tree-sitter, Vercel AI SDK, Fastify 5, Svelte 5, Vite 8, Tailwind CSS 4, Cytoscape.js, D3.js.

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
| Read-only dashboard over event daemon | All data already in data.db/broker.log/stats.json — no middleman | ✓ Good |
| Svelte 5 + Vite over htmx templates | Rich interactivity (graph, tree, SSE) needs client-side framework | ✓ Good |
| Cytoscape.js for dependency graph | Mature graph library with built-in layout algorithms and interactions | ✓ Good |
| Hash-based routing (hand-rolled) | Only ~5 routes, avoids a dependency | ✓ Good |
| Auto-discovery + blacklist over manual add | Repos appear automatically, users only manage removals | ✓ Good |
| Per-request SQLite queries (no cache) | Sync reads ~1ms via better-sqlite3, caching adds complexity | ✓ Good |

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
*Last updated: 2026-04-03 after v1.3 Nexus milestone*
