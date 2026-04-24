# Milestones

## v1.7 Multi-Lang Symbols + Call-Site Edges (Shipped: 2026-04-24)

**Phases completed:** 4 phases (36-39), 8 plans
**Requirements:** 17/17 satisfied
**Stats:** 52 commits | 54 files changed | +8,537 / -71 lines | 1 day (Apr 24, 2026)
**Codebase:** 20,118 LOC TypeScript | 845+ tests

**Key accomplishments:**

- Multi-language symbol extraction — Python, Go, Ruby extractors via tree-sitter (`tree-sitter-go@0.25.0`, `tree-sitter-ruby@0.23.1`); `find_symbol` returns symbols for all languages; top-level only with language-specific `isExport` heuristics
- Call-site edge extraction — TS/JS `call_expression` resolution in single-pass AST walk populates `symbol_dependencies` table with caller/callee relationships; local calls at confidence 1.0, imported calls at 0.8, unresolvable silently discarded
- `find_callers(name, filePath?, maxItems?)` and `find_callees(name, filePath?, maxItems?)` MCP tools (tools 16 and 17) — agents can answer "who calls foo" via one-hop `symbol_dependencies` JOIN queries; self-loops filtered, `unresolvedCount` for honest signal
- Five-step `deleteFile()` cascade — materialize symbol IDs → both-sides DELETE `symbol_dependencies` → DELETE `file_dependencies` → DELETE `symbols` → DELETE `files`; regression-tested in `watcher-symbol-lifecycle.test.ts`
- Bulk backfill pipeline — multi-lang symbols via three per-language `kv_state` gates; call-site edges via `call_site_edges_bulk_extracted` with three-key precondition enforcement; auto-runs at boot
- Historical debt closure — all 7 deferred quick-task items from v1.0-v1.5 formally closed; STATE.md Deferred Items table at zero entries

---

## v1.6 Symbol-Level Intelligence (Shipped: 2026-04-23)

**Phases completed:** 3 phases (33-35), 10 plans, 10 tasks
**Requirements:** 30/30 satisfied
**Stats:** 40 commits | 154 files changed | +14,331 / -96 lines | 1 day (Apr 23, 2026)
**Known deferred items at close:** 7 (see STATE.md Deferred Items) — all historical quick-task slugs from v1.0-v1.5, no v1.6 work affected
**Tech debt at close:** 2 phases (33, 35) shipped without `/gsd-verify-work` — VERIFICATION.md generated retroactively from audit + test files; REQUIREMENTS.md traceability table reconciled at close

**Key accomplishments:**

- Symbol extraction during scan — TS/JS files populate a `symbols` SQLite table with top-level declarations (function/class/interface/type/enum/const, line range, `isExport` flag) via a single-pass AST walk shared with edge extraction; migration-time bulk-extract gated by `kv_state` flag
- Import-name metadata on dependency edges — `file_dependencies` gains `imported_names` + `import_line` columns, namespace imports record `*`, additive migration preserves pre-v1.6 rows
- `find_symbol(name, kind?, exportedOnly=true, maxItems?)` MCP tool — case-sensitive exact + trailing-`*` prefix match via SQLite GLOB, standardized `{items, total, truncated?: true}` envelope, clamp `[1, 500]`
- `get_file_summary` enrichment — new `exports: [{name, kind, startLine, endLine}]` field sorted by startLine; `dependents[]` upgraded from `string[]` to `[{path, importedNames, importLines}]` with NULL-coerced to `[]` for non-TS/JS files
- `list_changed_since(since, maxItems?)` MCP tool — dual-mode dispatch (ISO-8601 timestamp via `Date.parse`, 7+ char git SHA via `execFileSync git diff` + DB intersection); extended ErrorCode union with `INVALID_SINCE | NOT_GIT_REPO`; no deletion tombstones (CHG-05)
- Watcher lifecycle hardened for symbols — file-change events re-extract via single-pass walk, unlink invokes transactional cascade (`file_dependencies` + `symbols` + `files` in one `sqlite.transaction()`); `watcher-symbol-lifecycle.test.ts` regression guard with paranoid `SELECT COUNT(*)` post-delete
- `scripts/inspect-symbols.mjs` CLI (`npm run inspect-symbols <path>`) for parser debugging; 14th→15th MCP tool registered; performance gate passed at +13.75% self-scan / +9.64% medium-repo (both under 15% soft threshold)

---

## v1.5 Production-Grade MCP Intelligence Layer (Shipped: 2026-04-23)

**Phases completed:** 4 phases (29-32), 11 plans, 17 tasks
**Requirements:** 20/21 satisfied (BRKR-04 partial — see audit)
**Stats:** 54 commits | 104 files changed | +7,767 / -11,206 lines | 6 days (Apr 17-22, 2026)
**Known deferred items at close:** 11 (see STATE.md Deferred Items) — 7 orphaned quick-task slugs + 4 tech-debt items

**Key accomplishments:**

- Broker lifecycle hardened — dual PID+socket liveness check, module-level crash handlers (uncaughtException/unhandledRejection), Promise.race-bounded drain shutdown with configurable timeout, socket-poll spawn wait replacing fixed sleep
- All 13 MCP tools migrated from deprecated `server.tool()` to `registerTool()` with `ToolAnnotations`, enriched descriptions, and uniform structured responses (`{ok: true/false, ...}`); deprecated `listChanged` capability removed
- Protocol-layer integration tests via `InMemoryTransport` exercising all 13 tools end-to-end against real SQLite + real ServerCoordinator (22+ new tests); V8 coverage scoped to 8 production subsystems
- Broker lifecycle test suite (spawn/SIGTERM/SIGKILL/PID-guard/socket/NDJSON protocol) + MCP stdout pollution CI smoke test + FileWatcher and config loading unit coverage
- Zero-config Claude Code discovery via committed `.mcp.json` dogfood config; cross-platform `scripts/register-mcp.mjs` ESM helper wired as `npm run register-mcp` with fail-soft ENOENT handling
- `build.sh` rewritten to delegate to `npm run register-mcp`; 5 legacy OS-specific install templates deleted (`install-mcp-claude.sh`, `mcp.json.{linux,mac,win.txt,claude-code}`); README Quick Start + `docs/mcp-clients.md` restructured around the new registration flow

---

## v1.4 Deep Graph Intelligence (Shipped: 2026-04-09)

**Phases completed:** 4 phases (25-28), 8 plans, 15 tasks
**Requirements:** 17/18 satisfied + 1 accepted deviation (AST-05: Go kept on regex per D-06)
**Stats:** 13 commits | 31 files changed | +5,756 / -286 lines | 1 day (Apr 9, 2026)

**Key accomplishments:**

- Schema migration adds edge_type, confidence, weight columns + file_communities table; typed confidence constants (EXTRACTED 1.0, INFERRED 0.8)
- LanguageConfig registry with extractEdges() single entry point dispatching to per-extension extractors; setEdges() writes enriched edge rows across all call sites
- Tree-sitter AST extractors for Python, Rust, C/C++ replacing regex-based parsing with EXTRACTED confidence (1.0) — 19 parity tests
- TS/JS richer edge types (imports, re_exports, inherits) via extractRicherEdges() + edge weight aggregation by target+edgeType composite key
- Louvain community detection via graphology with dirty-flag cache, SQLite persistence, and get_communities MCP tool with representative-path identification
- get_file_summary enriched with edge types and confidence; maxItems token budget on list_files and find_important_files with truncation metadata

---

## v1.3 Nexus (Shipped: 2026-04-03)

**Phases completed:** 5 phases (20-24), 12 plans
**Requirements:** 35/35 satisfied
**Stats:** 46 commits | 33 files changed | +3,448 / -272 lines | 3 days (Apr 1-3, 2026)

**Key accomplishments:**

- Fastify HTTP server with nexus.json-based repo discovery, read-only SQLite connections, and JSON API — Svelte 5 SPA with Vite + Tailwind dark mode
- Two-panel code explorer: lazy collapsible file tree with recursive snippet rendering, 8-section file detail panel, directory aggregate stats, bidirectional URL hash navigation
- Cytoscape.js interactive dependency graph with fcose layout, importance-based node sizing, directory coloring, hover highlight, click navigation, and subtree filtering
- System view: broker status polling via socket, per-repo token stats with D3 bar chart, SSE-streamed activity feed from log files with 500-line ring buffer
- Visual polish: importance heat bars (5-color scale), staleness icons, navbar repo health dots (green/orange/gray with 30s polling), responsive collapsible layout
- Settings page with repo remove/blacklist/restore management backed by persistent nexus.json

## v1.2 LLM Broker (Shipped: 2026-03-23)

**Phases completed:** 4 phases (16-19), 8 plans
**Stats:** 4 days (Mar 20-23, 2026)

**Key accomplishments:**

- Standalone broker process with in-memory priority queue, Unix domain socket IPC, and PID-guarded lifecycle
- Instance broker client with auto-spawn, 10s reconnect, and stale-file resubmission on connect
- Full legacy cleanup: dropped llm_jobs/llm_runtime_state tables, removed 9 dead CRUD functions, deleted pipeline.ts/rate-limiter.ts
- Per-repo token stats persisted to ~/.filescope/stats.json; broker status reporting via MCP tool

---

## v1.0 Autonomous File Metadata (Shipped: 2026-03-19)

**Phases completed:** 9 phases, 19 plans, 2 tasks

**Key accomplishments:**

- SQLite storage backend replacing JSON flat-file with transparent auto-migration for existing users
- Standalone coordinator + daemon mode — system runs 24/7 without MCP client connected
- AST-level semantic change detection for TS/JS with LLM-powered fallback for other languages
- Cascade engine propagating staleness through dependency graph with per-field granularity and circular dependency protection
- Multi-provider background LLM pipeline autonomously maintaining summaries, concepts, and change impact
- Full verification coverage — 28/28 requirements verified with test evidence across all 9 phases

**Stats:** 9,515 LOC TypeScript | 115 files modified | 180 tests passing | 17 days (Mar 2-19, 2026)

## v1.1 Hardening (Shipped: 2026-03-20)

**Phases completed:** 6 phases (10-15), 11 plans

**Key accomplishments:**

- BFS transitive importance propagation with cycle safety
- .filescopeignore support with full gitignore semantics
- Go and Ruby language support (go.mod resolution, require/require_relative parsing)
- Streaming async directory scan with two-pass SQLite integration
- mtime-based lazy validation replacing polling integrity sweep
- Cycle detection via iterative Tarjan's SCC exposed through MCP tools
- Code quality consolidation (fs imports, canonicalizePath, dead code removal)

**Stats:** 6 phases | 11 plans | 2 days (Mar 19-20, 2026)

---
