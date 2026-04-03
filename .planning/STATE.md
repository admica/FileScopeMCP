---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Nexus
status: Phase complete — ready for verification
stopped_at: Completed 24-polish-03-PLAN.md
last_updated: "2026-04-03T15:14:06.224Z"
last_activity: 2026-04-03
progress:
  total_phases: 9
  completed_phases: 9
  total_plans: 20
  completed_plans: 20
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-01)

**Core value:** LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.
**Current focus:** Phase 24 — polish

## Current Position

Phase: 24 (polish) — EXECUTING
Plan: 3 of 3

## Performance Metrics

**Velocity:**

- Total plans completed: 0 (v1.3)
- Average duration: —
- Total execution time: —

## Accumulated Context

### Decisions

Key v1.2 architectural decisions (logged in PROJECT.md Key Decisions table):

- **Standalone broker over leader election** — separate process, clean separation of concerns
- **In-memory queue over shared SQLite** — broker is a service; jobs are transient
- **Unix domain socket over TCP/HTTP** — local-only, no port conflicts, fast IPC
- **Broker builds prompts** — centralizes all LLM interaction; avoids Zod serialization
- **No dual-mode fallback** — broker is the only LLM path; direct Ollama mode removed

v1.3 key decisions:

- **Read-only dashboard over event-collection daemon** — all data already exists in per-repo data.db, broker.log, stats.json
- **htmx + D3.js over React/Vue/Svelte** — no frontend build toolchain; 14KB htmx + D3 script tag
- **Bind 0.0.0.0:1234** — LAN-accessible, no auth (trusted network)
- **Per-request SQLite queries** — no caching; sync reads ~1ms via better-sqlite3
- **fs.watch() log tailing** — byte offset tracking, ring buffer of 500 lines for SSE
- [Phase 20-server-skeleton-repo-discovery]: Read-only better-sqlite3 connections skip journal_mode pragma — WAL set by MCP writer, read-only cannot change it
- [Phase 20-server-skeleton-repo-discovery]: Fastify factory pattern: createServer() returns configured instance, main.ts calls listen() — keeps server testable
- [Phase 20-server-skeleton-repo-discovery]: Hand-rolled hash router over svelte-spa-router — 3 routes, saves a dependency
- [Phase 20-server-skeleton-repo-discovery]: Tailwind v4 dark-mode-only via :root CSS custom properties — no dark: prefix needed without light mode toggle
- [Phase 20-server-skeleton-repo-discovery]: postbuild:nexus-api uses grep -q guard so shebang prepend is idempotent — safe to run repeatedly
- [Phase 20-server-skeleton-repo-discovery]: build:nexus chains npm run build first to produce dist/broker/config.js before nexus backend compiles
- [Phase 21]: Wildcard routes use req.params['*'] for unencoded file paths — encoding breaks Fastify wildcard matching
- [Phase 21]: Non-wildcard /tree registered before /tree/* wildcard — Fastify v5 is order-sensitive
- [Phase 21-file-tree-detail-panel]: Svelte 5 {#snippet renderEntries} for recursive tree — avoids Svelte 4 self-referencing component pattern; snippets are first-class in Svelte 5
- [Phase 21-file-tree-detail-panel]: filePath/dirPath not encoded in URL hash — they contain forward slashes required for path structure; only repoName encoded as single segment
- [Phase 22-dependency-graph]: Only local_import edges in graph (not package_import) — package deps not meaningful for dependency visualization
- [Phase 22-dependency-graph]: fetchGraph() encodes dir query param via encodeURIComponent — unlike hash path segments which contain meaningful slashes
- [Phase 22-dependency-graph]: cytoscape.use(fcose) at module level prevents duplicate registration if component re-mounts
- [Phase 22-dependency-graph]: Graph routes parsed before /file/ and /dir/ in hash parser to avoid route collision
- [Phase 22-dependency-graph]: flex-1 min-h-0 on graph container required for Cytoscape height calculation
- [Phase 22-dependency-graph]: onFilterChange callback in DependencyGraph: allows parent to set graphFilterDir from inside graph (D-12 trigger)
- [Phase 23-system-view-live-activity]: Log tailer uses byte-offset tracking so log rotation (file shrink) is detectable; SSE uses reply.hijack() to prevent Fastify interference; queryBrokerStatus creates fresh socket per call for simplicity
- [Phase 23-system-view-live-activity]: D3 renders via $effect() with clear-then-redraw approach for reactive SVG charts in Svelte 5
- [Phase 23-system-view-live-activity]: ActivityFeed buffer bounded at 2000 lines, trimmed to 1500 — prevents unbounded memory growth in long SSE sessions
- [Phase 24-polish]: 5-minute threshold for 'recent' data.db mtime — intuitive window for MCP activity detection
- [Phase 24-polish]: Orange dot when staleCount > 0 but not recent — distinguishes active-processing (green) from queued-idle (orange)
- [Phase 24-polish]: absolute left-0 top-0 bottom-0 w-0.5 span inside relative button pins 2px heat bar to row left edge regardless of depth indentation padding
- [Phase 24-polish]: treeCollapsed gates both tree and graph views — same panel, same toggle behavior
- [Phase 24-polish]: GET /api/repos/blacklist registered before /:repoName DELETE -- Fastify is order-sensitive; blacklist literal must precede param route
- [Phase 24-polish]: onRefresh callback prop from App.svelte to Settings -- Settings calls back after mutation so navbar tabs update immediately
- [Phase 24-polish]: blacklist stored as array of path strings in nexus.json -- names derived from path at read time to avoid stale name state

### Pending Todos

None.

### Blockers/Concerns

None.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260323-kgd | Auto-init MCP to CWD, rename set_project_path to set_base_directory | 2026-03-23 | 50b7016 | [260323-kgd](./quick/260323-kgd-auto-init-mcp-to-cwd-rename-set-project-/) |
| 260324-0yz | Comprehensive documentation update: README and config.example.json for v1.2 | 2026-03-24 | a96b263 | [260324-0yz](./quick/260324-0yz-comprehensive-documentation-update-readm/) |
| 260401-a19 | Fix double change_impact, structured output waste, stale broker, log noise, addFileNode | 2026-04-01 | e81dac8 | [260401-a19](./quick/260401-a19-fix-double-change-impact-and-structured-ou/) |
| Phase 20-server-skeleton-repo-discovery P01 | 4 | 2 tasks | 5 files |
| Phase 20-server-skeleton-repo-discovery P02 | 141s | 2 tasks | 13 files |
| Phase 20-server-skeleton-repo-discovery P03 | 5 | 2 tasks | 1 files |
| Phase 21 P01 | 2 | 2 tasks | 3 files |
| Phase 21-file-tree-detail-panel P02 | 4min | 3 tasks | 10 files |
| Phase 22-dependency-graph P01 | 2min | 2 tasks | 4 files |
| Phase 22-dependency-graph P02 | 4min | 3 tasks | 4 files |
| Phase 23-system-view-live-activity P01 | 15min | 2 tasks | 4 files |
| Phase 23-system-view-live-activity P02 | 3min | 2 tasks | 5 files |
| Phase 24-polish P02 | 10 | 2 tasks | 5 files |
| Phase 24-polish P01 | 129s | 2 tasks | 2 files |
| Phase 24-polish P03 | 138 | 2 tasks | 7 files |

## Session Continuity

Last activity: 2026-04-03
Stopped at: Completed 24-polish-03-PLAN.md
Resume file: None
