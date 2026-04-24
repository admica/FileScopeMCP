# FileScopeMCP

## What This Is

A fully autonomous file intelligence system that watches project directories and maintains rich, up-to-date metadata about every file — summaries, relationships, key concepts, and change impact — so LLMs can query structured knowledge about a codebase without reading raw files. Features tree-sitter AST extraction with confidence-labeled edges, Louvain community detection, a standalone LLM broker for cross-repo job coordination, and a visual code exploration dashboard (Nexus).

## Core Value

LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## Current State

Shipped v1.6 Symbol-Level Intelligence (2026-04-23). Seven milestones complete (35 phases total). Planning next milestone.

**Architecture:**
- MCP server (per-repo daemon): file watching, metadata maintenance, MCP tool interface with 15 tools
- LLM broker (singleton): standalone process coordinating all LLM access (llama.cpp / llama-server) via Unix socket IPC
- Nexus dashboard: Fastify API + Svelte 5 SPA at 0.0.0.0:1234, read-only SQLite access

**Tech stack:** TypeScript 5.8, Node.js 22, ESM, esbuild, better-sqlite3, drizzle-orm, tree-sitter, chokidar, zod, vitest, Vercel AI SDK, Fastify 5, Svelte 5, Vite 8, Tailwind CSS 4, Cytoscape.js, D3.js, graphology

**Codebase:** ~15K LOC TypeScript | 718 tests passing (7 skipped) | 35 phases shipped across 7 milestones

## Next Milestone Goals

No active milestone. Top v1.7 candidates (see memory `project_v1_7_candidates.md`):

1. Multi-language symbol extraction (Python/Go/Ruby) — pending v1.6 adoption signal
2. Symbol-level dependency edges — call-site resolution (`who calls foo`)
3. Deletion tombstones on `list_changed_since` — enable `deleted_files` tracking

Run `/gsd-new-milestone` to scope v1.7.

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
- ✓ LanguageConfig registry dispatching tree-sitter grammars per file extension — v1.4
- ✓ Tree-sitter AST extraction for Python, Rust, C/C++ (replacing regex) — v1.4
- ✓ Regex fallback for unsupported languages (Zig, Lua, PHP, C#, Java) — v1.4
- ✓ Richer edge types: imports, re_exports, inherits for TS/JS — v1.4
- ✓ Edge weights (reference count between file pairs) — v1.4
- ✓ Edge metadata columns (edge_type, confidence, confidence_source, weight) — v1.4
- ✓ Confidence constants (EXTRACTED 1.0, INFERRED 0.8) — v1.4
- ✓ All edges carry confidence label and score — v1.4
- ✓ get_file_summary returns edge types and confidence for dependencies — v1.4
- ✓ Louvain community detection via graphology — v1.4
- ✓ Community dirty-flag cache invalidation — v1.4
- ✓ get_communities MCP tool with representative-path identification — v1.4
- ✓ Community membership stored in SQLite file_communities table — v1.4
- ✓ Token budget (maxItems) on list_files and find_important_files — v1.4
- ✓ MCP tools surface edge types and confidence in responses — v1.4
- ✓ Broker dual PID+socket liveness check with stale-file cleanup — v1.5
- ✓ Module-level crash handlers (uncaughtException, unhandledRejection) in broker and MCP server — v1.5
- ✓ Promise.race-bounded drain shutdown with configurable drainTimeoutMs — v1.5
- ✓ Socket-poll spawn wait replacing fixed 500ms sleep — v1.5
- ✓ All 13 MCP tools migrated to registerTool() with ToolAnnotations and structured {ok} responses — v1.5
- ✓ Deprecated listChanged capability removed — v1.5
- ✓ MCP transport integration tests via InMemoryTransport for all 13 tools — v1.5
- ✓ Broker lifecycle test suite (spawn/SIGTERM/SIGKILL/PID/socket/NDJSON) — v1.5
- ✓ MCP stdout pollution CI smoke test — v1.5
- ✓ V8 coverage scoped to 8 production subsystems — v1.5
- ✓ FileWatcher and config loading unit test coverage — v1.5
- ✓ Zero-config Claude Code discovery via committed .mcp.json dogfood — v1.5
- ✓ Cross-platform scripts/register-mcp.mjs via `npm run register-mcp` — v1.5
- ✓ build.sh delegates to npm run register-mcp; 5 legacy install templates deleted — v1.5
- ✓ README Quick Start + docs/mcp-clients.md rewritten around new registration flow — v1.5
- ✓ Symbol extraction (TS/JS) — function/class/interface/type/enum/const with line ranges, persisted to `symbols` table — v1.6 (Phase 33)
- ✓ `imported_names` + `import_line` columns on `file_dependencies` (TS/JS edges) — v1.6 (Phase 33)
- ✓ `npm run inspect-symbols` CLI for parser debugging — v1.6 (Phase 33)
- ✓ `find_symbol` MCP tool — case-sensitive exact + trailing-`*` prefix, `kind` filter, `exportedOnly` default true, `{items, total, truncated?}` envelope — v1.6 (Phase 34, FIND-01..05)
- ✓ `get_file_summary.exports[]` populated from symbols table for TS/JS files — v1.6 (Phase 34, SUM-01)
- ✓ `get_file_summary.dependents[]` upgraded to `[{path, importedNames, importLines}]` — v1.6 (Phase 34, SUM-02..04)
- ✓ `list_changed_since(since, maxItems?)` MCP tool — dual-mode dispatch (ISO-8601 timestamp + 7+ char git SHA via `git diff` ∩ DB); `NOT_INITIALIZED | INVALID_SINCE | NOT_GIT_REPO` error codes; no deletion tombstones — v1.6 (Phase 35, CHG-01..05)
- ✓ Watcher lifecycle hardened for symbols — file-change re-extracts via single-pass AST walk (no separate timer); unlink invokes transactional three-DELETE cascade (`file_dependencies` + `symbols` + `files` in one `sqlite.transaction()`); mtime-based staleness shared with edges — v1.6 (Phase 35, WTC-01..03)
- ✓ PERF budget held under 15% soft threshold — self-scan +13.75% (1833→2085ms), medium-repo +9.64% (332→364ms) vs Phase 33 baseline — v1.6 (PERF-01, PERF-02)

### Active

<!-- Current scope. Building toward these. -->

None — defining next milestone.

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
- Cross-file call resolution — requires type registry, HIGH complexity
- Graph diff between scans — no clear use case
- Real-time community updates — Louvain is batch-only; dirty-flag cache is correct pattern
- One-script LLM backend setup — llama.cpp across platforms (Windows host, remote LAN, etc.) is inherently complex; zero-config goal applies to MCP/broker lifecycle only
- Method-level symbols (v1.6) — reachable via class line ranges; adds parser surface without proportional query value
- Cross-file call-site resolution (`who calls foo`) — needs full type registry, HIGH complexity
- Fuzzy symbol search — exact + prefix match sufficient for known-name lookup
- Re-export transitive symbols (`export * from './foo'`) — parser complexity not justified; direct exports only
- Symbol importance scoring — file-level importance is already approximate, per-symbol is noise
- `get_neighborhood` 2-hop graph tool — audit cut (2026-04-23): with symbol+line data, one-hop suffices; tree demos look cool but bloat at edit time
- `find_risky_files` (changeImpact-sorted list) — audit cut (2026-04-23): LLM-generated risk scores unreliable; agents verify via tests
- `summarize_paths` immediate-queue tool — audit cut (2026-04-23): agents prefer raw file over paragraph-about-file when editing
- Deletion-tracking on `list_changed_since` — deferred until `deleted_files` tombstone table needed elsewhere

## Context

Shipped v1.0 (9 phases), v1.1 (6 phases), v1.2 (4 phases), v1.3 (5 phases), v1.4 (4 phases), v1.5 (4 phases), and v1.6 (3 phases). The system is a complete autonomous file intelligence platform with a standalone LLM broker, a visual code exploration dashboard (Nexus), rich graph intelligence — tree-sitter AST extraction for Python/Rust/C/C++/Go/TS/JS with richer edge types (imports, re_exports, inherits), edge weights, confidence labels, Louvain community detection, token budget caps on MCP tool responses — a production-grade agent surface — MCP spec-compliant registerTool() for all 15 tools with structured responses, hardened broker lifecycle (dual liveness check, crash handlers, drain-bounded shutdown), 718 tests including MCP transport integration coverage, and zero-config Claude Code auto-discovery via committed .mcp.json + cross-platform register-mcp helper — plus symbol-level intelligence: TS/JS symbol extraction driven by a single-pass AST walk shared with edge extraction, `find_symbol` MCP tool with GLOB prefix match and standardized envelope, `get_file_summary` enriched with `exports[]` + rich `dependents[]` (importedNames, importLines), and `list_changed_since` tool with dual ISO-8601 / git-SHA dispatch for post-edit re-orientation.

Tech stack: TypeScript 5.8, Node.js 22, ESM, esbuild, @modelcontextprotocol/sdk, chokidar, zod, vitest, better-sqlite3, drizzle-orm, tree-sitter, graphology, Vercel AI SDK, Fastify 5, Svelte 5, Vite 8, Tailwind CSS 4, Cytoscape.js, D3.js.

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
| LanguageConfig registry pattern | O(1) dispatch by extension, Phase 26+ adds entries without touching dispatch | ✓ Good |
| extractEdges() single entry point | All dependency extraction through one function, eliminates multi-branch dispatch | ✓ Good |
| Direct AST extractors over buildAstExtractor scaffold | Phase 26 bypassed the scaffold for cleaner per-language extractors | ✓ Good |
| Go kept on regex (D-06) | No stable tree-sitter-go npm grammar; regex resolveGoImports works correctly | ✓ Good |
| graphology for Louvain clustering | Mature graph library with community detection algorithms, minimal deps | ✓ Good |
| Dirty-flag cache for communities | Louvain is batch-only; recompute only when edges change, not on every query | ✓ Good |
| maxItems rename over backward compat | Zero legacy installs — clean API naming without shims | ✓ Good |
| Dual PID+socket liveness check | Stale PID alone lies when OS recycles PIDs — socket presence confirms real broker | ✓ Good (v1.5) |
| Module-level crash handlers | Catches errors during all execution phases including startup | ✓ Good (v1.5) |
| registerTool() over server.tool() | Current MCP SDK API; deprecated form removes annotations and structured responses | ✓ Good (v1.5) |
| InMemoryTransport for MCP tests | Protocol-layer coverage without subprocess overhead | ✓ Good (v1.5) |
| Committed .mcp.json at repo root | Claude Code auto-discovers per-repo MCP servers when scope matches CWD | ✓ Good (v1.5) |
| ESM .mjs register script | Cross-platform (macOS/Linux/Windows) without bash dependency; process.execPath handles nvm/volta | ✓ Good (v1.5) |
| Fail-soft ENOENT on claude CLI | Never break ./build.sh for users without Claude Code installed | ✓ Good (v1.5) |
| Symbol extraction in single AST pass alongside edges | Avoid second `parser.parse()` per file; PERF-critical for scan wall-time | ✓ Good (v1.6) |
| Additive schema for symbols (no breaking changes) | Preserve existing tool response shapes; `dependents[]` upgrade is the only wire change | ✓ Good (v1.6) |
| TS/JS only symbol extraction in v1.6 | Ruthless scope cut — ship daily-use surface first, expand on adoption signal | ✓ Good (v1.6) |
| No deletion tombstones on `list_changed_since` | Intersection with DB drops deletions inherently; tombstone table deferred | ✓ Good (v1.6) |
| GLOB prefix-match with bracket-escape for `find_symbol` | SQLite GLOB is natively case-sensitive; no PRAGMA, no new indexes | ✓ Good (v1.6) |
| Inlined `getDependentsWithImports` return type | Single call site; new interface would be noise | ✓ Good (v1.6) |
| `find_symbol` description as `string[].join(' ')` literal | Length probe regex-extracts without JS eval | ✓ Good (v1.6) |
| Transactional three-DELETE cascade in `deleteFile()` | Watcher unlink never leaves orphaned symbols; one `sqlite.transaction()` closure | ✓ Good (v1.6) |
| JSX components as `function` kind | Reachable via existing AST nodes; no `component` kind heuristic needed | ✓ Good (v1.6) |

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
*Last updated: 2026-04-24 after v1.6 Symbol-Level Intelligence milestone shipped*
