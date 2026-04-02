# Phase 23: System View + Live Activity - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

The System tab shows cross-repo broker status, per-repo token usage, and a live-updating activity feed streamed from log files via SSE. Three stacked sections on a single page: compact broker status bar at top, D3 horizontal bar chart for token usage in the middle, and a scrollable SSE-fed activity feed filling the remaining viewport. No settings page (Phase 24), no heat colors or staleness icons (Phase 24).

</domain>

<decisions>
## Implementation Decisions

### Broker Status Display
- **D-01:** **Compact status bar** across the top of the System page. Horizontal layout: green/gray status badge + model name + pending count + active job + connected clients as inline badges.
- **D-02:** **Active job shows**: file name + job type + repo name (e.g., "worker.ts (summary) — FileScopeMCP"). Not the full path.
- **D-03:** **Model name visible** in the status bar from broker.json config.
- **D-04:** **Connected clients** as a badge with count (e.g., "2 clients").
- **D-05:** **Subtle pulse** on the status badge every 5s when broker status is polled. Confirms liveness without being distracting.
- **D-06:** **Offline state**: same layout but grayed out — all fields show '--' or 'N/A', badge says 'Offline' in gray. Token stats still visible from stats.json. No error styling — offline is expected when broker isn't running.

### Token Usage Visualization
- **D-07:** **D3.js horizontal bar chart** showing per-repo token totals sorted by count descending. Dark-themed with Tailwind colors. D3 is installed in this phase per Phase 20 D-02 decision (D3 for auxiliary charts).
- **D-08:** **Human-readable format** (1.2M, 450K) with **hover tooltip for exact count** (e.g., "1,234,567 tokens").
- **D-09:** **Lifetime + session delta** — show lifetime total per repo plus a smaller "+X this session" indicator. Nexus server tracks token snapshot at startup to compute delta.

### Activity Feed
- **D-10:** **Structured list** style — each log line as a row with separate timestamp column, colored prefix badge, and message text. Not terminal-style monospace.
- **D-11:** **Auto-assigned colors** for log prefixes. Colors assigned dynamically based on unique prefixes seen in the stream. No hardcoded prefix→color mapping.
- **D-12:** **Auto-scroll with pause** — auto-scrolls to new entries by default. Stops auto-scrolling when user scrolls up. Resumes when user scrolls back to bottom or clicks a "Jump to latest" button.
- **D-13:** **Prefix filter dropdown** above the feed to filter by log prefix (show only [BROKER] lines, only [WORKER], etc.). Includes an "All" option.

### Page Layout
- **D-14:** **Stacked full-width sections**: broker status bar → token chart → activity feed, all full-width. No columns.
- **D-15:** **Activity feed fills remaining viewport** height via CSS `calc(100vh - offset)`. Broker bar and token chart always visible without page scrolling.

### Claude's Discretion
- D3 bar chart styling details (bar height, spacing, colors, axis labels)
- Pulse animation timing and styling
- Prefix badge visual design
- "Jump to latest" button placement and style
- Token chart section height (should leave majority of viewport for the feed)
- Whether model name comes from broker.sock status response or a separate config read
- Log line timestamp formatting (relative vs absolute)
- How session delta is displayed relative to the bar chart

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Nexus Design
- `NEXUS-PLAN.md` — Full architecture. Read: "System View" section for layout, "Log Tailing" for SSE/ring buffer spec, "Broker Status" for socket queries, "Token Stats" for stats.json format.

### Requirements
- `.planning/REQUIREMENTS.md` — NEXUS-25 through NEXUS-30 define the system view and live activity requirements.

### Broker Types & Stats
- `src/broker/types.ts` — `StatusResponse` type: `pendingCount`, `inProgressJob`, `connectedClients`, `repoTokens`. This is the exact shape returned by broker.sock status queries.
- `src/broker/stats.ts` — `readStats()`, `STATS_PATH`, `BrokerStats` type. Reads `~/.filescope/stats.json` with `repoTokens: Record<string, number>`.
- `src/broker/config.ts` — `FILESCOPE_DIR` constant, broker config loading.

### Existing Nexus Code (Phase 20-22 deliverables)
- `src/nexus/server.ts` — Existing Fastify routes. New broker status + SSE routes added here.
- `src/nexus/repo-store.ts` — `getDb()`, `getRepoStats()`, `getGraphData()` patterns. Stats.json reading could follow similar pattern.
- `src/nexus/ui/lib/api.ts` — Existing fetch wrappers and types. New `fetchBrokerStatus()`, `fetchTokenStats()` wrappers added here.
- `src/nexus/ui/routes/System.svelte` — Current placeholder ("coming in Phase 23"). This file gets completely rewritten.
- `src/nexus/ui/App.svelte` — Hash router already has `system` route type pointing to System.svelte.
- `src/nexus/ui/components/Navbar.svelte` — System tab already wired in navbar.

### Prior Phase Context
- `.planning/phases/20-server-skeleton-repo-discovery/20-CONTEXT.md` — D-01 through D-13 (Svelte 5, Tailwind dark-only, Fastify JSON API, D3 for auxiliary charts, hash router)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `StatusResponse` type in `src/broker/types.ts` — exact broker status shape, reuse directly
- `readStats()` in `src/broker/stats.ts` — reads stats.json, reuse for token data
- `api.ts` fetch wrapper pattern — `encodeURIComponent(repoName)`, error handling, typed returns
- `server.ts` Fastify route pattern — `app.get<{ Params }>('/api/...', async (req, reply) => {...})`
- Svelte 5 runes throughout: `$state()`, `$derived()`, `$effect()`, `$props()`
- Tailwind dark-only: `bg-gray-900`, `text-gray-100`, `border-gray-700`

### Established Patterns
- better-sqlite3 `db.prepare().all()` / `.get()` for queries
- Component pattern: `$props()` for inputs, callback props for events
- Hash routing: `window.location.hash` changes drive route state in App.svelte

### Integration Points
- `server.ts` — add `/api/system/broker` route (queries broker.sock), `/api/system/tokens` route (reads stats.json), `/api/stream/activity` SSE endpoint
- `api.ts` — add `BrokerStatus`, `TokenStats` types + fetch wrappers + SSE EventSource setup
- `System.svelte` — complete rewrite replacing placeholder
- `package.json` — add `d3` dependency (per Phase 20 D-02)

</code_context>

<specifics>
## Specific Ideas

- The stacked layout was chosen after comparing three ASCII mockups — user confirmed they want the clean vertical stacking with activity feed filling remaining space
- D3 horizontal bar chart specifically chosen over simple tables or cards for token visualization
- Session delta tracking: Nexus server snapshots stats.json on startup, computes delta on each request
- Prefix filter dropdown in the activity feed — user wants to filter by [BROKER], [WORKER], etc.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 23-system-view-live-activity*
*Context gathered: 2026-04-02*
