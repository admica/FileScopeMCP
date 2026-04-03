# Milestones

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
