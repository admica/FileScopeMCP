# Nexus — Design Plan

## What Is It

The Nexus is the web dashboard for FileScopeMCP. One browser tab shows you everything the system knows — across all your repos, in real time. No more tailing log files.

```
Browser
  ├── Tab: wtfij           ← file tree + metadata + deps
  ├── Tab: StardustHarvest ← file tree + metadata + deps
  └── Tab: FileScopeMCP    ← file tree + metadata + deps

Dashboard Server (single process)
  ├── reads ~/.filescope/stats.json         (token stats)
  ├── reads ~/.filescope/broker.log         (live activity)
  ├── reads ~/.filescope/mcp-server.log     (per-instance activity)
  ├── queries broker via broker.sock        (queue depth, current job)
  └── for each repo:
      └── reads .filescope/data.db          (file tree, summaries, deps, importance)
```

No new daemon. No event plumbing. No NDJSON protocol. The data already exists — this is a read-only viewer that opens the existing databases and log files.

## Why

The original Nexus concept was an event-collection daemon — a second process that received events from MCP instances and wrote them to a separate database. But MCP instances already persist everything to `data.db`, the broker already logs activity, and `stats.json` already tracks tokens. That daemon would have been a middleman between data that already exists and the thing you actually want to look at.

The Nexus skips the middleman. It opens the existing databases and log files directly — read-only, zero new protocols, zero new IPC.

## Architecture

### Single Process

One Node.js process. Runs when you want it, stops when you close it. Not a daemon — you start it, open the browser, and look at your data.

```
$ filescope-nexus
Nexus: http://0.0.0.0:1234
Found 3 projects:
  - FileScopeMCP  (/home/autopcap/FileScopeMCP)
  - wtfij         (/home/autopcap/wtfij)
  - StardustHarvest (/home/autopcap/StardustHarvest)
```

### Tech Stack

- **Backend**: Node.js + Fastify — pure JSON API server + static file host
- **Frontend**: Svelte 5 SPA (runes: `$state()`, `$derived()`, `$effect()`) compiled with Vite
- **Graph visualization**: Cytoscape.js for the interactive dependency map, D3.js for auxiliary charts/sparklines
- **Styling**: Tailwind CSS, dark mode only — developer dashboard aesthetic
- **Database access**: better-sqlite3 (already a project dependency) opening each repo's `data.db` read-only
- **Build**: Vite compiles Svelte → `dist/nexus/static/`, esbuild compiles Fastify → `dist/nexus/main.js`
- **Routing**: Hash router (`/#/project/wtfij`, `/#/system`, `/#/settings`)

### Architecture Split

```
Fastify (Node.js, port 1234)         Svelte SPA (browser)
├── JSON API endpoints            →  ├── Fetches data, renders UI
├── SSE streams                   →  ├── Live activity feed
├── Static file serving           →  └── Compiled JS/CSS bundle
└── Broker socket proxy
```

Fastify does data. Svelte does presentation. No server-rendered HTML — all rendering is client-side.

### Network Binding

Binds to `0.0.0.0:1234` by default — accessible from other machines on the LAN. Override with CLI flags:

```
$ filescope-nexus --port 9999
$ filescope-nexus --host 127.0.0.1    # localhost only
```

No authentication. This is a read-only viewer of code metadata on a trusted LAN.

### Dev Workflow

Two processes during development:
- **Vite dev server** (port 5173) — hot module replacement for Svelte components
- **Fastify** (port 1234) — JSON API
- Vite proxies `/api/*` and SSE requests to Fastify

Production: Fastify serves the Vite-built bundle from `dist/nexus/static/` alongside the API.

### Why Svelte + Cytoscape

The Nexus is a visual code exploration tool, not a log viewer. The interactive dependency map is the primary interface — nodes for files, edges for imports, hover for details, click for drill-down. This requires rich client-side interactivity that server-rendered HTML can't deliver.

Svelte compiles away at build time — near-zero runtime overhead. Cytoscape.js provides graph interactions (zoom, pan, hover, click, layout algorithms) out of the box. D3 handles auxiliary visualizations. Tailwind + dark mode gives the modern developer tool aesthetic.

## Repo Discovery

The Nexus needs to know which repos to show. Three sources, checked in order:

### 1. Registry File (primary)

`~/.filescope/nexus.json`:
```json
{
  "repos": [
    { "path": "/home/autopcap/FileScopeMCP", "name": "FileScopeMCP" },
    { "path": "/home/autopcap/wtfij", "name": "wtfij" },
    { "path": "/home/autopcap/StardustHarvest", "name": "StardustHarvest" }
  ]
}
```

The `name` field is the display name in the navbar. Defaults to the directory basename if omitted.

### 2. Auto-discovery (bootstrap)

If `nexus.json` doesn't exist, scan 2 levels deep from home for `.filescope/data.db`:
- Check `~/*/` and `~/*/*/` for `.filescope/data.db` (catches `~/projects/foo` without recursive explosion)
- Write the discovered list to `nexus.json` so it's stable on subsequent starts

### 3. Manual add/remove

Nexus UI has a settings page to add/remove repos. Updates `nexus.json`.

### Validation on Startup

For each registered repo:
- Check `.filescope/data.db` exists and is readable
- If missing, mark as "offline" in the UI (gray tab, not removed)
- Re-check periodically (every 60s) so repos that come online mid-session appear

## Data Access

### Per-Repo SQLite (read-only)

Each repo's `.filescope/data.db` is opened with `better-sqlite3` in read-only mode (`{ readonly: true }`). WAL mode allows concurrent reads while the MCP instance writes.

**Freshness**: Re-query SQLite on every HTTP request. Sync reads via better-sqlite3 are ~1ms — no caching layer needed. The browser always sees current data.

**Queries the Nexus needs:**

| Query | Source Table | Purpose |
|-------|-------------|---------|
| All files + directories | `files` | File tree construction |
| File metadata (summary, importance, concepts, staleness) | `files` | Detail panel |
| Dependencies for file | `file_dependencies WHERE source_path = ?` | Outgoing edges |
| Dependents for file | `file_dependencies WHERE target_path = ?` | Incoming edges |
| Full dependency graph | `file_dependencies WHERE dependency_type = 'local_import'` | Visualization |
| LLM coverage stats | `files` (count WHERE summary IS NOT NULL, etc.) | Progress indicators |
| Stale file count | `files` (count WHERE summary_stale_since IS NOT NULL, etc.) | Health indicator |

### Broker Status (live)

Connect to `~/.filescope/broker.sock` as a client. Send a `status` message, receive `status_response`:
- `pendingCount` — jobs waiting in queue
- `inProgressJob` — what the LLM is working on right now
- `connectedClients` — how many MCP instances are connected
- `repoTokens` — cumulative tokens per repo

Poll every 5s. If broker is down, show "Broker: offline" — not an error.

### Token Stats

Read `~/.filescope/stats.json` for historical token totals. Fall back to broker's `repoTokens` if stats.json is missing.

### Log Tailing (SSE)

For live activity feeds:
- Tail `~/.filescope/broker.log` for LLM job activity
- Tail `~/.filescope/mcp-server.log` for MCP instance activity
- Stream new lines to the browser via Server-Sent Events (SSE)
- Ring buffer of last 500 lines in memory — new browser connections get recent history immediately

**Tailing mechanism**: `fs.watch()` on each log file. On change event, `fs.read()` from last known byte offset. Handles log rotation (if file size shrinks, reset offset to 0).

**Log line parsing**: Existing log format is `[ISO-8601] [PREFIX] message...`. Parse with a simple regex: extract timestamp and prefix, display the rest as-is. No attempt to impose structure beyond what the logs already have — if we want richer structured display later, we improve the log format at the source, not build a fragile parser in the Nexus.

## UI Layout

### Navigation

Top navbar with:
- **Logo/title**: "Nexus"
- **Project tabs**: One per repo (e.g., "wtfij", "StardustHarvest", "FileScopeMCP")
- **System tab**: Broker status, cross-repo token stats, live activity log
- **Settings**: Add/remove repos

Active tab is highlighted. Tabs show a small status indicator:
- Green dot: MCP instance connected (broker reports it as a client)
- Gray dot: No active MCP instance
- Orange dot: Has stale files (LLM work pending)

### Project View (per-repo tab)

Two-panel layout:

```
┌──────────────────────────────────────────────────────────┐
│  [wtfij] [StardustHarvest] [FileScopeMCP]  [System] [⚙] │
├──────────────┬───────────────────────────────────────────┤
│              │                                           │
│  File Tree   │  Detail Panel                            │
│              │                                           │
│  ▸ src/      │  src/coordinator.ts                      │
│    ▸ broker/ │  ─────────────────                       │
│    ▸ db/     │  Importance: 8/10                        │
│    config.ts │  Summary: Orchestrates file scanning...  │
│    types.ts  │  Concepts: [coordinator, file-watcher,   │
│              │            dependency-graph]              │
│  ▸ tests/    │                                           │
│  package.json│  Dependencies (7):                       │
│              │    → src/broker/client.ts                 │
│              │    → src/db/repository.ts                 │
│              │    → src/file-utils.ts                    │
│              │                                           │
│              │  Dependents (3):                          │
│              │    ← src/mcp-server.ts                    │
│              │    ← tests/coordinator.test.ts            │
│              │                                           │
│  [Tree] [Graph]  Staleness: ● Fresh                    │
│              │                                           │
├──────────────┴───────────────────────────────────────────┤
│  Progress: 127/343 summarized │ 89/343 concepts │ Queue: 12 │
└──────────────────────────────────────────────────────────┘
```

#### File Tree (left panel)

- Collapsible directory tree, sorted: directories first, then files alphabetically
- Each file shows importance as a colored indicator (heat: gray→blue→green→yellow→red for 0→10)
- Staleness shown as a small icon (⟳ stale, ✓ fresh)
- Click a file → loads detail panel via htmx partial swap
- Click a directory → expands/collapses, also shows aggregate stats in detail panel

#### Detail Panel (right panel)

For a file:
- **Header**: Full relative path, importance score (editable via inline control)
- **Summary**: LLM-generated summary text (or "Pending..." if not yet generated)
- **Concepts**: Render `ConceptsResult` JSON — `purpose` as text, then `functions`, `classes`, `interfaces`, `exports` as tag groups with section headers
- **Change Impact**: Render `ChangeImpactResult` JSON — `riskLevel` as colored badge (green/yellow/red), `summary` as text, `affectedAreas` and `breakingChanges` as lists
- **Dependencies**: List of files this file imports, clickable (navigates tree + loads that file's detail)
- **Dependents**: List of files that import this file, clickable
- **Package Dependencies**: External packages with versions
- **Staleness**: Per-job-type status (summary: fresh, concepts: stale since 2h ago, etc.)
- **Exports**: Function/class/variable exports from `exports_snapshot` JSON — name, kind, signature

For a directory:
- **Aggregate stats**: Total files, average importance, % with summaries, % stale
- **Top files by importance**: Quick links to the most important files in this subtree

#### Toggle: Tree ↔ Graph

Below the left panel, a toggle switches between:
- **Tree view**: The standard directory hierarchy
- **Graph view**: Dependency visualization (see below)

### Dependency Graph View

Full-page (or left-panel) visualization of the dependency graph for the current repo.

**Technology**: D3.js force-directed graph

**Nodes**: Files (sized by importance, colored by directory/type)
**Edges**: Dependency arrows (source → target)

**Interactions**:
- Hover a node → highlight its direct dependencies and dependents
- Click a node → open its detail panel
- Drag nodes to rearrange
- Zoom/pan
- Filter by directory subtree (e.g., show only `src/broker/` and its external deps)
- Cluster by directory (files in the same directory pull toward each other)

**Data source**: `file_dependencies` table, `dependency_type = 'local_import'` only (package deps excluded from graph — too many, not useful visually).

**Performance**: For repos under 500 files (typical), D3 force simulation runs fine. For larger repos, the directory filter keeps the visible node count manageable.

### System View

Cross-repo overview:

```
┌────────────────────────────────────────────────┐
│  Broker Status                                 │
│  ────────────────                              │
│  Status: Running (PID 12345)                   │
│  Queue: 12 pending                             │
│  Current: wtfij/src/main.cpp (concepts)        │
│  Connected clients: 3                          │
│  Model: FileScopeMCP-brain                     │
│                                                │
│  Token Usage                                   │
│  ────────────────                              │
│  FileScopeMCP:    142,387 tokens               │
│  wtfij:            87,231 tokens               │
│  StardustHarvest:  23,104 tokens               │
│  Total:           252,722 tokens               │
│                                                │
│  Live Activity                                 │
│  ────────────────                              │
│  02:47:01 job:done   wtfij  src/main.cpp  1.3s │
│  02:47:03 job:start  FSM    src/types.ts       │
│  02:47:05 job:done   FSM    src/types.ts  1.1s │
│  02:47:06 changed    wtfij  3 files, 7 staled  │
│  ...                                           │
└────────────────────────────────────────────────┘
```

## API Endpoints

All endpoints return JSON. The Svelte SPA handles all rendering client-side. Fastify serves the SPA bundle at `/` and the API under `/api/`.

### Static

```
GET /                                    → Serves index.html (Svelte SPA entry point)
GET /assets/*                            → Vite-built JS/CSS bundles
```

### JSON API

```
GET /api/repos                            → List all repos with online/offline status
GET /api/project/:repoName/stats          → { totalFiles, withSummary, withConcepts, stale, depCount, ... }
GET /api/project/:repoName/tree           → Full file tree (directories + files with importance/staleness)
GET /api/project/:repoName/tree/:path*    → Subtree for lazy loading
GET /api/project/:repoName/file/:path*    → File detail (summary, concepts, change_impact, deps, exports, staleness)
GET /api/project/:repoName/dir/:path*     → Directory aggregate stats
GET /api/project/:repoName/graph          → { nodes: [...], edges: [...] } for Cytoscape
GET /api/broker/status                    → Broker status (proxied from broker.sock)
GET /api/tokens                           → Per-repo token totals from stats.json
```

### SSE Streams

```
GET /api/stream/activity                  → SSE: parsed log lines (all repos)
GET /api/stream/project/:repoName        → SSE: activity filtered to one repo
```

### Settings (mutating)

```
POST /api/repos                           → Add a repo { path, name? }
DELETE /api/repos/:repoName               → Remove a repo
```

## File Structure

```
src/nexus/
  main.ts              — Entry point: parse CLI args, start Fastify, discover repos, open DBs
  server.ts            — Fastify route registration, SSE setup, broker socket client
  repo-store.ts        — Opens/manages per-repo data.db connections (read-only)
  log-tailer.ts        — fs.watch() log files, ring buffer, SSE broadcast
  ui/                  — Svelte SPA (compiled by Vite)
    App.svelte         — Root component, hash router, navbar
    routes/
      Project.svelte   — Per-repo project view (stats card, later: tree + graph)
      System.svelte    — Broker status, token stats, live activity
      Settings.svelte  — Add/remove repos
    components/
      Navbar.svelte    — Top nav with repo tabs and status indicators
      StatsCard.svelte — Aggregate repo stats display
      ...              — Additional components added in later phases
    lib/
      api.ts           — Fetch wrappers for Fastify JSON endpoints
      stores.ts        — Svelte stores for shared state
    app.css            — Tailwind directives and global dark theme
```

Backend (main.ts, server.ts, repo-store.ts, log-tailer.ts) built by esbuild. Frontend (ui/) built by Vite + Svelte plugin.

### Build & CLI

Two build targets:
- **Backend**: esbuild compiles `src/nexus/main.ts` (and server.ts, repo-store.ts, log-tailer.ts) → `dist/nexus/`
- **Frontend**: Vite compiles `src/nexus/ui/` → `dist/nexus/static/`

**package.json additions**:
```json
{
  "bin": {
    "filescope-nexus": "dist/nexus/main.js"
  },
  "scripts": {
    "nexus": "node dist/nexus/main.js",
    "build:nexus-api": "esbuild src/nexus/main.ts src/nexus/server.ts src/nexus/repo-store.ts src/nexus/log-tailer.ts --format=esm --target=es2020 --outdir=dist/nexus --platform=node",
    "build:nexus-ui": "vite build --config src/nexus/ui/vite.config.ts",
    "dev:nexus-ui": "vite --config src/nexus/ui/vite.config.ts"
  },
  "dependencies": {
    "fastify": "..."
  },
  "devDependencies": {
    "svelte": "...",
    "@sveltejs/vite-plugin-svelte": "...",
    "vite": "...",
    "tailwindcss": "...",
    "@tailwindcss/vite": "..."
  }
}
```

**CLI args** (parsed with `process.argv`, no dependency):
```
filescope-nexus [--port 1234] [--host 0.0.0.0]
```

## Lifecycle

### Startup

1. Parse CLI args (`--port`, `--host`)
2. Read `~/.filescope/nexus.json` (or auto-discover)
3. For each repo, open `.filescope/data.db` read-only
4. Connect to broker socket (if available)
5. Start tailing log files (`fs.watch()` + byte offset tracking)
6. Start Fastify HTTP server on `0.0.0.0:1234` (or overrides)
7. Print URL to stdout

### Runtime

- HTTP requests query SQLite directly (synchronous reads via better-sqlite3 — fast)
- SSE connections stream log lines as they appear
- Broker status polled every 5s
- Repo DB connections are long-lived (opened once, closed on shutdown)
- New repos added via settings page get their DB opened immediately

### Shutdown

Close DB connections, stop log tailers, close SSE connections, stop HTTP server. Clean exit.

### No Daemon Mode

The Nexus is not a background daemon. It runs in a terminal. Ctrl+C stops it. If you want it persistent, run it in tmux/screen — but that's the user's choice, not ours.

## Edge Cases

### Concurrent Writes

MCP instances write to `data.db` while the Nexus reads. WAL mode handles this — readers and writers don't block each other. Each HTTP request re-queries SQLite (sync, ~1ms) so the browser always sees current data.

### Repo Goes Offline

If a repo's `data.db` disappears (directory deleted, unmounted drive), the Nexus shows "offline" for that tab. Periodic recheck (60s) reconnects when it comes back.

### Large Repos

For repos with 1000+ files, the file tree uses lazy loading — only expand directories on click, not all at once. The dependency graph uses directory-level filtering to keep node count under ~200.

### Broker Down

Nexus shows "Broker: offline" in the system view. All other functionality works — the Nexus reads SQLite directly, not through the broker.

### Multiple Dashboards

Nothing prevents running two Nexus instances. They both open DBs read-only. No conflicts. Different ports if you want both accessible.

## Future Extensions (not in v1.3 scope)

These are read-write or advanced features that can be layered on after the read-only Nexus ships:

- **File content viewer**: Show actual file contents alongside metadata (read file from disk)
- **Importance editor**: Click to adjust importance scores, writes back to data.db (breaks read-only model — would need write mode)
- **Scan trigger**: Button to trigger a re-scan (sends command to MCP instance via broker or direct socket — TBD)
- **Cycle visualization**: Highlight circular dependencies in the graph view (data available via `detect_cycles` logic)
- **Search**: Full-text search across summaries and concepts
- **Dark mode**: CSS variables make this trivial to add later
- **Broker tap**: Subscribe to broker events directly for richer live data (replaces log tailing)

## Phase Breakdown

1. **Server skeleton + repo discovery** — Fastify JSON API server, Svelte 5 SPA with Vite + Tailwind (dark mode), hash router, CLI arg parsing, `nexus.json` registry, 2-level auto-discovery, per-repo read-only DB connections, stats summary card per repo. Verify: `filescope-nexus` starts, finds repos, opens DBs, serves the Svelte shell with repo tabs and stats.
2. **File tree + detail panel** — Svelte components for collapsible file tree and metadata detail panel. File detail: summary, concepts, change impact, exports, dependencies, staleness. Directory detail: aggregate stats. Verify: click through the tree, see real data from your repos.
3. **Dependency graph** — Cytoscape.js interactive dependency map as the primary visualization. Nodes (files) sized by importance, edges (imports) with hover details. Zoom/pan/click/hover. Directory filter. Tree ↔ Graph toggle. Verify: see your dependency structure visually, hover nodes and edges for details.
4. **System view + live activity** — Broker status polling via broker.sock, token usage from stats.json (D3 sparklines), SSE log tailing via `fs.watch()` + ring buffer, live activity feed. Verify: see live LLM activity in the browser.
5. **Polish** — Navbar tab status indicators, importance heat colors, staleness icons, settings page for repo management, responsive layout.
