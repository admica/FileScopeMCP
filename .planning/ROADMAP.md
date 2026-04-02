# Roadmap: FileScopeMCP

## Milestones

- ✅ **v1.0 Autonomous File Metadata** — Phases 1-9 (shipped 2026-03-19)
- ✅ **v1.1 Hardening** — Phases 10-15 (shipped 2026-03-20)
- ✅ **v1.2 LLM Broker** — Phases 16-19 (shipped 2026-03-23)
- 🚧 **v1.3 Nexus** — Phases 20-24 (in progress)

## Phases

<details>
<summary>✅ v1.0 Autonomous File Metadata (Phases 1-9) — SHIPPED 2026-03-19</summary>

- [x] Phase 1: SQLite Storage (3/3 plans) — completed 2026-03-02
- [x] Phase 2: Coordinator + Daemon Mode (2/2 plans) — completed 2026-03-03
- [x] Phase 3: Semantic Change Detection (2/2 plans) — completed 2026-03-18
- [x] Phase 4: Cascade Engine + Staleness (2/2 plans) — completed 2026-03-18
- [x] Phase 5: LLM Processing Pipeline (3/3 plans) — completed 2026-03-18
- [x] Phase 6: Verification & Tech Debt Cleanup (2/2 plans) — completed 2026-03-18
- [x] Phase 7: Fix change_impact Pipeline (1/1 plan) — completed 2026-03-18
- [x] Phase 8: Integration Fixes (2/2 plans) — completed 2026-03-19
- [x] Phase 9: Verification Documentation (2/2 plans) — completed 2026-03-19

See: `.planning/milestones/v1.0-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.1 Hardening (Phases 10-15) — SHIPPED 2026-03-20</summary>

- [x] Phase 10: Code Quality and Bug Fixes — completed 2026-03-19
- [x] Phase 11: .filescopeignore Support — completed 2026-03-19
- [x] Phase 12: Go and Ruby Language Support — completed 2026-03-19
- [x] Phase 13: Streaming Directory Scan — completed 2026-03-20
- [x] Phase 14: mtime-Based Lazy Validation — completed 2026-03-20
- [x] Phase 15: Cycle Detection — completed 2026-03-20

See: `.planning/milestones/v1.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.2 LLM Broker (Phases 16-19) — SHIPPED 2026-03-23</summary>

- [x] Phase 16: Broker Core (2/2 plans) — completed 2026-03-22
- [x] Phase 17: Instance Client + Pipeline Wiring (2/2 plans) — completed 2026-03-22
- [x] Phase 18: Cleanup (2/2 plans) — completed 2026-03-22
- [x] Phase 19: Observability (2/2 plans) — completed 2026-03-23

See: ROADMAP.md Phase Details below for full phase details (not yet archived).

</details>

### v1.3 Nexus (In Progress)

**Milestone Goal:** Visual code exploration dashboard that opens existing per-repo databases and log files directly — cross-repo observability without a new daemon or protocol. Fastify API + Svelte 5 SPA + Cytoscape.js/D3 + Tailwind dark mode on 0.0.0.0:1234.

**Design document:** `NEXUS-PLAN.md`

- [x] **Phase 20: Server Skeleton + Repo Discovery** (3 plans) — Fastify server, CLI entry point, nexus.json registry, auto-discovery, per-repo read-only DB connections, Svelte 5 SPA with navbar, hash routing, stats card, static file serving, graceful shutdown (completed 2026-04-01)
- [x] **Phase 21: File Tree + Detail Panel** (2 plans) — Collapsible directory tree with lazy loading, file detail panel (summary, concepts, change impact, exports, deps, staleness), directory aggregate panel (completed 2026-04-02)
- [x] **Phase 22: Dependency Graph** (2 plans) — Cytoscape.js interactive dependency map, node sizing/coloring by importance, hover/click interactions, zoom/pan/drag, directory filter, tree/graph toggle (completed 2026-04-02)
- [ ] **Phase 23: System View + Live Activity** (2 plans) — Broker status polling via broker.sock, token usage D3 bar chart, SSE log tailing (fs.watch + ring buffer), log line parsing, activity feed with prefix filter
- [ ] **Phase 24: Polish** — Importance heat colors, staleness icons, tab status indicators, settings page (add/remove repos), responsive layout

## Phase Details

### Phase 16: Broker Core
**Goal**: A standalone broker binary exists that instances can connect to — it accepts job submissions over a Unix domain socket, prioritizes them by importance, and processes them one at a time through Ollama
**Depends on**: Phase 15
**Requirements**: BROKER-01, BROKER-02, BROKER-03, BROKER-04, BROKER-05, BROKER-06, BROKER-07, BROKER-08, BROKER-09, BROKER-10, BROKER-11, BROKER-12
**Success Criteria** (what must be TRUE):
  1. Running `node dist/broker.js` starts a process that creates ~/.filescope/broker.sock and ~/.filescope/broker.pid; a second invocation detects the running broker and exits without clobbering the socket
  2. A client connecting and submitting two jobs for the same (repoPath, filePath, jobType) results in only one job being processed — the second submission replaces the first if still pending
  3. A job that takes longer than 120 seconds is aborted and the submitting client receives an error response; the broker continues processing the next job immediately
  4. When the broker receives SIGTERM or SIGINT it finishes the in-progress job (or aborts after timeout), closes all client connections, removes broker.sock and broker.pid, and exits cleanly
  5. When a client connection closes, all pending jobs submitted by that connection are dropped from the queue
**Plans:** 2/2 plans complete
Plans:
- [x] 16-01-PLAN.md — Foundation: broker types, config loader, and priority queue
- [x] 16-02-PLAN.md — Worker, server, main entry point, and esbuild wiring

### Phase 17: Instance Client + Pipeline Wiring
**Goal**: Instances communicate with the broker through a single submitJob() function that transparently routes to the broker when available, and all LLM callers use this new entry point; config no longer requires model details in instance config.json
**Depends on**: Phase 16
**Requirements**: CLIENT-01, CLIENT-02, CLIENT-03, CLIENT-04, CLIENT-05, PIPE-01, CONF-01, CONF-02, CONF-03
**Success Criteria** (what must be TRUE):
  1. cascade-engine.ts and llm-diff-fallback.ts call submitJob() with no direct reference to insertLlmJobIfNotPending() or the LLM pipeline — a single code change in broker-client.ts controls LLM routing for all callers
  2. When the broker is running, an instance connects on startup and all LLM jobs flow through the socket; when the broker is not running, the instance logs a connection failure and operates without LLM processing (no crash, no retry loop blocking startup)
  3. After a broker disconnect, the instance automatically reconnects every 10 seconds; jobs accumulated in the local stale-file list are resubmitted to the broker on each successful reconnect
  4. Instance config.json with only `llm.enabled: true` (no model or provider fields) produces a working instance that processes LLM jobs through the broker
  5. toggle_llm MCP tool connects to or disconnects from the broker at runtime — calling it twice toggles the instance back to its original state
**Plans:** 2/2 plans complete
Plans:
- [x] 17-01-PLAN.md — Broker client module and config simplification
- [x] 17-02-PLAN.md — Wire callers, coordinator lifecycle, toggle_llm, esbuild

### Phase 18: Cleanup
**Goal**: All legacy local job queue infrastructure is gone — no llm_jobs or llm_runtime_state tables, no pipeline.ts polling loop, no TokenBudgetGuard gating, no dead job CRUD functions, no isExhausted parameter threading
**Depends on**: Phase 17
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05
**Success Criteria** (what must be TRUE):
  1. A fresh FileScopeMCP instance startup on an existing .filescope.db that contains llm_jobs or llm_runtime_state tables produces a DB without those tables — the migration runs automatically on init
  2. Importing coordinator.ts, cascade-engine.ts, or repository.ts in a TypeScript build produces no references to insertLlmJob, insertLlmJobIfNotPending, dequeueNextJob, markJobInProgress, markJobDone, markJobFailed, recoverOrphanedJobs, loadLlmRuntimeState, saveLlmRuntimeState, or isExhausted
  3. The files src/llm/pipeline.ts and src/llm/rate-limiter.ts do not exist in the repository; all existing tests pass with no import errors
**Plans:** 2/2 plans complete
Plans:
- [x] 18-01-PLAN.md — DB migration, schema cleanup, dead module deletion, repository surgery, test fixes
- [x] 18-02-PLAN.md — isExhausted parameter removal, comment cleanup, final verification

### Phase 19: Observability
**Goal**: Operators can query the broker's current state and token usage history through the existing get_llm_status MCP tool, which now reports broker-mode details including connection status, queue depth, active job, and lifetime per-repo token totals
**Depends on**: Phase 18
**Requirements**: OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. Calling get_llm_status while connected to a broker returns a response containing: mode "broker", brokerConnected true, the number of pending jobs in the broker queue, the currently processing job's file path (or null), and per-repo lifetime token counts read from ~/.filescope/stats.json
  2. Calling get_llm_status while the broker is not running returns mode "broker", brokerConnected false, and the last-known per-repo token totals (stale but present); the tool does not error or hang
**Plans:** 2/2 plans complete
Plans:
- [x] 19-01-PLAN.md — Broker-side stats persistence and StatusResponse enrichment
- [x] 19-02-PLAN.md — Client requestStatus(), coordinator getBrokerStatus(), MCP tool update

### Phase 20: Server Skeleton + Repo Discovery
**Goal**: Running `filescope-nexus` starts a Fastify HTTP server that discovers all FileScopeMCP repos, opens their databases read-only, and serves a Svelte 5 SPA with per-repo tabs and stats summary cards
**Depends on**: Phase 19
**Requirements**: NEXUS-01, NEXUS-02, NEXUS-03, NEXUS-04, NEXUS-05, NEXUS-06, NEXUS-07, NEXUS-08, NEXUS-09, NEXUS-10, NEXUS-11, NEXUS-12, NEXUS-13, NEXUS-14
**Canonical refs**: `NEXUS-PLAN.md` (Architecture, Repo Discovery, Data Access, Lifecycle sections)
**Success Criteria** (what must be TRUE):
  1. `npm run nexus` (or `node dist/nexus/main.js`) starts a Fastify server on 0.0.0.0:1234; `--port` and `--host` flags override defaults
  2. With no ~/.filescope/nexus.json, the server scans ~ 2 levels deep for .filescope/data.db directories, writes the discovered list to nexus.json, and serves tabs for each discovered repo
  3. With an existing nexus.json, the server opens each listed repo's data.db read-only; repos whose data.db is missing appear as "offline" tabs (not removed from registry)
  4. GET / returns a Svelte SPA with navbar showing all repo tabs, a System tab, and a Settings tab; clicking a repo tab shows a stats summary card
  5. SIGTERM/SIGINT triggers graceful shutdown: all DB connections closed, HTTP server stopped, process exits cleanly
**Plans:** 3/3 plans complete
Plans:
- [x] 20-01-PLAN.md — Backend: dependencies, discover.ts, repo-store.ts, server.ts, main.ts, build pipeline
- [x] 20-02-PLAN.md — Frontend: Svelte 5 SPA with Vite, Tailwind, hash router, Navbar, StatsCard, routes
- [x] 20-03-PLAN.md — Integration: build verification, runtime smoke test, visual checkpoint

### Phase 21: File Tree + Detail Panel
**Goal**: Clicking a repo tab shows a two-panel layout — a collapsible file tree on the left, and a metadata detail panel on the right that populates when you click a file or directory
**Depends on**: Phase 20
**Requirements**: NEXUS-15, NEXUS-16, NEXUS-17, NEXUS-18
**Canonical refs**: `NEXUS-PLAN.md` (UI Layout > Project View, File Tree, Detail Panel sections), `src/db/schema.ts` (files table columns), `src/llm/types.ts` (ConceptsResult, ChangeImpactResult), `src/change-detector/types.ts` (ExportSnapshot)
**Success Criteria** (what must be TRUE):
  1. GET /project/:repoName renders a two-panel layout with a collapsible file tree (left) and detail panel (right); directories sort first, files alphabetically within
  2. Clicking a file in the tree loads its detail panel via htmx partial swap (no full-page reload) showing: summary, importance, concepts (purpose + tag groups), change impact (risk badge + summary + lists), dependencies (clickable), dependents (clickable), package deps, staleness per field, and exports
  3. Clicking a directory shows aggregate stats: file count, average importance, % with summaries, % stale, and top files by importance (clickable)
  4. Tree expand/collapse is lazy — child nodes load via htmx when a directory is clicked, not all at once on page load
**Plans:** 2/2 plans complete
Plans:
- [x] 21-01-PLAN.md — Backend API routes + SQLite queries + frontend fetch wrappers and types
- [x] 21-02-PLAN.md — Svelte components: FileTree, DetailPanel, FileDetail, DirDetail, router extension, resizable layout

### Phase 22: Dependency Graph
**Goal**: A toggle switches the left panel from directory tree to a Cytoscape.js interactive dependency graph where files are nodes and imports are edges — interactive, filterable, and linked to the detail panel
**Depends on**: Phase 21
**Requirements**: NEXUS-19, NEXUS-20, NEXUS-21, NEXUS-22, NEXUS-23, NEXUS-24
**Canonical refs**: `NEXUS-PLAN.md` (Dependency Graph View section), `src/db/schema.ts` (file_dependencies table)
**Success Criteria** (what must be TRUE):
  1. GET /api/project/:repoName/graph returns JSON { nodes, edges } built from file_dependencies WHERE dependency_type = 'local_import'
  2. Toggling Tree / Graph in the left panel renders a Cytoscape.js graph with nodes sized by importance and colored by directory
  3. Hovering a node highlights its direct dependencies and dependents; clicking a node loads its detail panel
  4. Graph supports zoom, pan, and drag-to-rearrange; a directory filter dropdown limits visible nodes to a subtree plus its external deps
**Plans:** 2/2 plans complete
Plans:
- [x] 22-01-PLAN.md — Backend: getGraphData() query, /graph API route, frontend graph types + fetchGraph()
- [x] 22-02-PLAN.md — Frontend: DependencyGraph + GraphFilter components, App.svelte routing, Project.svelte toggle

### Phase 23: System View + Live Activity
**Goal**: The System tab shows cross-repo broker status, token usage, and a live-updating activity feed streamed from log files via SSE
**Depends on**: Phase 22
**Requirements**: NEXUS-25, NEXUS-26, NEXUS-27, NEXUS-28, NEXUS-29, NEXUS-30
**Canonical refs**: `NEXUS-PLAN.md` (System View, Log Tailing, Broker Status, Token Stats sections), `src/broker/types.ts` (StatusResponse), `src/broker/stats.ts` (stats.json format)
**Success Criteria** (what must be TRUE):
  1. GET /system renders broker status (pending count, in-progress job, connected clients, model name) and per-repo token totals; broker status refreshes via polling every 5s
  2. When broker.sock is unreachable, System view shows "Broker: offline" without errors; token totals fall back to stats.json
  3. GET /api/stream/activity returns an SSE stream of parsed log lines from broker.log and mcp-server.log; new connections receive the last 500 lines from the ring buffer immediately
  4. Log lines are parsed via regex (ISO timestamp + [PREFIX]); the activity feed updates in real time as new log entries appear
**Plans:** 2 plans
Plans:
- [ ] 23-01-PLAN.md — Backend: log-tailer.ts, broker socket query, token stats with session delta, SSE endpoint
- [ ] 23-02-PLAN.md — Frontend: BrokerStatusBar, TokenChart (D3), ActivityFeed (SSE), System.svelte page layout

### Phase 24: Polish
**Goal**: Visual refinements that make the Nexus informative at a glance — importance heat colors, staleness icons, tab status dots, a settings page for repo management, and responsive layout
**Depends on**: Phase 23
**Requirements**: NEXUS-31, NEXUS-32, NEXUS-33, NEXUS-34, NEXUS-35
**Canonical refs**: `NEXUS-PLAN.md` (Navigation, File Tree, UI Layout sections)
**Success Criteria** (what must be TRUE):
  1. File tree entries show importance as a heat-colored indicator (gray/blue/green/yellow/red scaling 0-10) and staleness as an icon (stale or fresh)
  2. Navbar tabs show a status dot: green (MCP instance connected per broker), gray (no active instance), orange (repo has stale files)
  3. GET /settings renders a page where users can add a repo by path and remove existing repos; changes take effect immediately (DB opened/closed, tab appears/disappears) without server restart
  4. Layout remains usable at viewport widths from 1024px to 2560px

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. SQLite Storage | v1.0 | 3/3 | Complete | 2026-03-02 |
| 2. Coordinator + Daemon Mode | v1.0 | 2/2 | Complete | 2026-03-03 |
| 3. Semantic Change Detection | v1.0 | 2/2 | Complete | 2026-03-18 |
| 4. Cascade Engine + Staleness | v1.0 | 2/2 | Complete | 2026-03-18 |
| 5. LLM Processing Pipeline | v1.0 | 3/3 | Complete | 2026-03-18 |
| 6. Verification & Tech Debt | v1.0 | 2/2 | Complete | 2026-03-18 |
| 7. Fix change_impact Pipeline | v1.0 | 1/1 | Complete | 2026-03-18 |
| 8. Integration Fixes | v1.0 | 2/2 | Complete | 2026-03-19 |
| 9. Verification Documentation | v1.0 | 2/2 | Complete | 2026-03-19 |
| 10. Code Quality and Bug Fixes | v1.1 | 2/2 | Complete | 2026-03-19 |
| 11. .filescopeignore Support | v1.1 | 2/2 | Complete | 2026-03-19 |
| 12. Go and Ruby Language Support | v1.1 | 2/2 | Complete | 2026-03-19 |
| 13. Streaming Directory Scan | v1.1 | 2/2 | Complete | 2026-03-20 |
| 14. mtime-Based Lazy Validation | v1.1 | 1/1 | Complete | 2026-03-20 |
| 15. Cycle Detection | v1.1 | 2/2 | Complete | 2026-03-20 |
| 16. Broker Core | v1.2 | 2/2 | Complete | 2026-03-22 |
| 17. Instance Client + Pipeline Wiring | v1.2 | 2/2 | Complete | 2026-03-22 |
| 18. Cleanup | v1.2 | 2/2 | Complete | 2026-03-22 |
| 19. Observability | v1.2 | 2/2 | Complete | 2026-03-23 |
| 20. Server Skeleton + Repo Discovery | v1.3 | 3/3 | Complete    | 2026-04-01 |
| 21. File Tree + Detail Panel | v1.3 | 2/2 | Complete    | 2026-04-02 |
| 22. Dependency Graph | v1.3 | 2/2 | Complete    | 2026-04-02 |
| 23. System View + Live Activity | v1.3 | 0/2 | Planned | -- |
| 24. Polish | v1.3 | 0/? | Pending | -- |
