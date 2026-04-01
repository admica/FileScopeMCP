# Requirements: FileScopeMCP v1.3

**Defined:** 2026-04-01
**Core Value:** LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## v1.3 Requirements

Requirements for the Nexus milestone. Read-only web dashboard that opens existing per-repo databases and log files — cross-repo observability without a new daemon or protocol. Each requirement maps to roadmap phases.

### Server & CLI

- [x] **NEXUS-01**: Fastify HTTP server binds to 0.0.0.0:1234 by default with --port and --host CLI flag overrides
- [x] **NEXUS-02**: `filescope-nexus` CLI entry point registered via package.json bin field
- [x] **NEXUS-03**: esbuild builds src/nexus/main.ts → dist/nexus/main.js alongside existing MCP and broker entry points
- [x] **NEXUS-04**: Static files (CSS, JS, vendored htmx/D3) served from dist/nexus/static/

### Repo Discovery

- [x] **NEXUS-05**: Reads repo list from ~/.filescope/nexus.json on startup
- [x] **NEXUS-06**: Auto-discovers repos by scanning ~ children for .filescope/data.db when nexus.json doesn't exist; writes discovered list to nexus.json
- [x] **NEXUS-07**: Validates each repo's data.db on startup; missing repos marked "offline" (not removed from registry)
- [x] **NEXUS-08**: Periodic recheck (60s) reconnects repos whose data.db becomes available mid-session

### Database Access

- [x] **NEXUS-09**: Opens each repo's .filescope/data.db read-only via better-sqlite3 with WAL mode
- [x] **NEXUS-10**: Re-queries SQLite on every HTTP request — no caching layer
- [x] **NEXUS-11**: DB connections are long-lived (opened once on startup, closed on shutdown)

### Page Shell & Routing

- [x] **NEXUS-12**: HTML shell page with top navbar (per-repo project tabs, System tab, Settings gear), htmx and D3 script tags
- [x] **NEXUS-13**: Route structure: GET / (shell), GET /project/:repoName, GET /system, GET /settings, plus htmx partial endpoints
- [x] **NEXUS-14**: Graceful shutdown on SIGTERM/SIGINT: close DB connections, stop log tailers, close SSE connections, stop HTTP server

### File Tree & Detail Panel

- [ ] **NEXUS-15**: Collapsible directory tree in left panel — directories first, then files alphabetically, lazy-load on expand
- [ ] **NEXUS-16**: htmx partial swaps for tree expand/collapse and detail panel loading (no full-page reloads)
- [ ] **NEXUS-17**: File detail panel renders: summary (or "Pending..."), importance score, ConceptsResult (purpose + tag groups for functions/classes/interfaces/exports), ChangeImpactResult (risk badge + summary + lists), dependencies (clickable), dependents (clickable), package dependencies with versions, per-field staleness, ExportSnapshot (name, kind, signature)
- [ ] **NEXUS-18**: Directory detail panel renders: total files, average importance, % with summaries, % stale, top files by importance (clickable)

### Dependency Graph

- [ ] **NEXUS-19**: D3.js force-directed graph visualization of file_dependencies WHERE dependency_type = 'local_import'
- [ ] **NEXUS-20**: Graph nodes sized by importance, colored by directory or file type
- [ ] **NEXUS-21**: Hover a node highlights its direct dependencies and dependents; click opens file detail panel
- [ ] **NEXUS-22**: Zoom, pan, and drag-to-rearrange interactions on the graph canvas
- [ ] **NEXUS-23**: Directory subtree filter (e.g., show only src/broker/ and its external deps) to manage node count
- [ ] **NEXUS-24**: Tree ↔ Graph toggle switches left panel between directory tree and dependency graph

### System View & Live Activity

- [ ] **NEXUS-25**: System view displays broker status from broker.sock: pending count, in-progress job, connected clients, per-repo token totals
- [ ] **NEXUS-26**: Broker status polled every 5s; shows "Broker: offline" when broker.sock unreachable (not an error state)
- [ ] **NEXUS-27**: Per-repo token usage from ~/.filescope/stats.json with totals
- [ ] **NEXUS-28**: SSE streams for broker.log and mcp-server.log via fs.watch() + byte offset tracking; handles log rotation (size shrink → reset offset)
- [ ] **NEXUS-29**: Ring buffer of last 500 log lines in memory; new SSE clients receive recent history immediately on connect
- [ ] **NEXUS-30**: Log lines parsed via regex: extract ISO timestamp and [PREFIX], display remainder as-is

### Navigation & Settings (Polish)

- [ ] **NEXUS-31**: Importance displayed as heat-colored indicator on file tree entries (gray→blue→green→yellow→red for 0→10)
- [ ] **NEXUS-32**: Per-file staleness icon in tree (⟳ stale, ✓ fresh)
- [ ] **NEXUS-33**: Tab status indicators on navbar: green dot (MCP instance connected), gray dot (no active instance), orange dot (stale files pending)
- [ ] **NEXUS-34**: Settings page: add repo (POST /api/repos {path, name?}), remove repo (DELETE /api/repos/:repoName), updates nexus.json and opens/closes DB connections immediately
- [ ] **NEXUS-35**: Responsive layout adapting to different screen widths

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Nexus Read-Write Extensions

- **NRW-01**: File content viewer — show actual source code alongside metadata (read from disk)
- **NRW-02**: Importance editor — inline click-to-edit importance scores, write back to data.db
- **NRW-03**: Scan trigger — button to trigger re-scan via broker or MCP instance
- **NRW-04**: Search — full-text search across summaries and concepts

### Nexus Visualization

- **NVIS-01**: Cycle visualization — highlight circular dependencies in graph view (data available via detect_cycles)
- **NVIS-02**: Dark mode — CSS variable-based theme switching

### Nexus Infrastructure

- **NINF-01**: Broker tap — subscribe to broker events directly for richer live data (replaces log tailing)

### Language Support (carried from v1.1)

- **LANG-03**: Barrel re-export parsing for TypeScript/JavaScript
- **LANG-04**: Python relative imports and importlib
- **LANG-05**: Rust mod declarations

### Scaling (carried from v1.2)

- **SCALE-01**: Broker supports configurable maxConcurrent workers for multi-GPU setups
- **SCALE-02**: Priority aging prevents low-importance job starvation under sustained high load

### Resilience (carried from v1.2)

- **RESIL-01**: Version handshake on connect — broker rejects incompatible client versions
- **RESIL-02**: Persistent token stats across broker restarts

## Out of Scope

| Feature | Reason |
|---------|--------|
| Nexus event-collection daemon | All data already exists in per-repo data.db, broker.log, and stats.json — no middleman needed |
| Authentication / access control | Read-only viewer on a trusted LAN; no secrets exposed |
| React / Vue framework | Svelte 5 chosen for near-zero runtime overhead; compiles away at build time |
| Write-back to data.db | v1.3 is strictly read-only; write features deferred to future milestone |
| WebSocket transport | SSE sufficient for log streaming; no bidirectional communication needed |
| Daemon mode for Nexus | Runs in foreground by design; user can wrap in tmux/screen |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| NEXUS-01 | Phase 20 | Complete |
| NEXUS-02 | Phase 20 | Complete |
| NEXUS-03 | Phase 20 | Complete |
| NEXUS-04 | Phase 20 | Complete |
| NEXUS-05 | Phase 20 | Complete |
| NEXUS-06 | Phase 20 | Complete |
| NEXUS-07 | Phase 20 | Complete |
| NEXUS-08 | Phase 20 | Complete |
| NEXUS-09 | Phase 20 | Complete |
| NEXUS-10 | Phase 20 | Complete |
| NEXUS-11 | Phase 20 | Complete |
| NEXUS-12 | Phase 20 | Complete |
| NEXUS-13 | Phase 20 | Complete |
| NEXUS-14 | Phase 20 | Complete |
| NEXUS-15 | Phase 21 | Pending |
| NEXUS-16 | Phase 21 | Pending |
| NEXUS-17 | Phase 21 | Pending |
| NEXUS-18 | Phase 21 | Pending |
| NEXUS-19 | Phase 22 | Pending |
| NEXUS-20 | Phase 22 | Pending |
| NEXUS-21 | Phase 22 | Pending |
| NEXUS-22 | Phase 22 | Pending |
| NEXUS-23 | Phase 22 | Pending |
| NEXUS-24 | Phase 22 | Pending |
| NEXUS-25 | Phase 23 | Pending |
| NEXUS-26 | Phase 23 | Pending |
| NEXUS-27 | Phase 23 | Pending |
| NEXUS-28 | Phase 23 | Pending |
| NEXUS-29 | Phase 23 | Pending |
| NEXUS-30 | Phase 23 | Pending |
| NEXUS-31 | Phase 24 | Pending |
| NEXUS-32 | Phase 24 | Pending |
| NEXUS-33 | Phase 24 | Pending |
| NEXUS-34 | Phase 24 | Pending |
| NEXUS-35 | Phase 24 | Pending |

**Coverage:**
- v1.3 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0

---
*Requirements defined: 2026-04-01*
*Last updated: 2026-04-01 after roadmap creation*
