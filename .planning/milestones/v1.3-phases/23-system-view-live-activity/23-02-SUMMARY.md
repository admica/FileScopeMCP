---
phase: 23-system-view-live-activity
plan: 02
subsystem: ui
tags: [nexus, svelte5, d3, sse, broker-status, token-chart, activity-feed, tailwind]

# Dependency graph
requires:
  - phase: 23-01
    provides: GET /api/system/broker, GET /api/system/tokens, GET /api/stream/activity SSE endpoint
  - phase: 22-dependency-graph
    provides: Svelte 5 rune patterns, D3 integration pattern, $effect cleanup, min-h-0 flex overflow pattern

provides:
  - src/nexus/ui/lib/api.ts — BrokerStatus, TokenEntry, LogLine types; fetchBrokerStatus(), fetchTokenStats() wrappers
  - src/nexus/ui/components/BrokerStatusBar.svelte — compact horizontal status bar with online/offline badge, pulse animation
  - src/nexus/ui/components/TokenChart.svelte — D3 horizontal bar chart of per-repo token totals with human-readable labels and session delta
  - src/nexus/ui/components/ActivityFeed.svelte — SSE-fed live log line list with auto-scroll, prefix filter, Jump to latest
  - src/nexus/ui/routes/System.svelte — Full System page: status bar + token chart + activity feed stacked vertically

affects:
  - Future phases adding more System tab sections (metrics, settings panel)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - D3 imperative rendering in Svelte 5 $effect() with svgEl bind:this — same approach as Cytoscape pattern from Phase 22
    - SSE EventSource in Svelte 5 component: connectSSE() function, $effect for lifecycle, onerror reconnect with setTimeout
    - Auto-scroll with pause: feedEl.scrollHeight - scrollTop - clientHeight < 50 threshold, tick().then() for DOM flush before scroll
    - Dynamic prefix color assignment via Map<string, string> — colors assigned by insertion order, not hardcoded

key-files:
  created:
    - src/nexus/ui/components/BrokerStatusBar.svelte
    - src/nexus/ui/components/TokenChart.svelte
    - src/nexus/ui/components/ActivityFeed.svelte
  modified:
    - src/nexus/ui/lib/api.ts
    - src/nexus/ui/routes/System.svelte

key-decisions:
  - "D3 renders via $effect() with d3.select(svgEl).selectAll('*').remove() on each reactive update — simplest approach for reactive SVG charts in Svelte 5"
  - "SVG title elements provide hover tooltips for exact token counts — native browser behavior, no custom tooltip needed"
  - "ActivityFeed buffer bounded at 2000 lines, trimmed to 1500 on overflow — prevents unbounded memory growth in long-running sessions"
  - "npm install needed before build (d3 in package.json but missing from node_modules in worktree)"

patterns-established:
  - "D3 pattern: bind:this on SVG element, $effect renders with clear-then-redraw, parentElement.clientWidth for responsive sizing"
  - "SSE pattern in Svelte 5: connectSSE() with EventSource, $effect returns cleanup that closes connection"
  - "Pulse animation: pulsing state set to true then reset after 500ms via setTimeout — toggles CSS animation class"

requirements-completed: [NEXUS-25, NEXUS-26, NEXUS-27, NEXUS-28, NEXUS-29, NEXUS-30]

# Metrics
duration: ~3min
completed: 2026-04-02
---

# Phase 23 Plan 02: System View + Live Activity — Frontend Summary

**System tab fully implemented: compact broker status bar with pulse animation, D3 horizontal token bar chart with session delta, and SSE-fed activity feed with auto-scroll and prefix filtering**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-02T15:26:28Z
- **Completed:** 2026-04-02T15:29:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Extended `api.ts` with BrokerStatus, TokenEntry, LogLine types and fetchBrokerStatus/fetchTokenStats wrappers
- Created BrokerStatusBar: compact horizontal bar showing online/offline badge (with pulse animation), model name, pending count, active job (filename + jobType + repoName), and connected client count
- Created TokenChart: D3 horizontal bar chart rendering per-repo token totals with human-readable labels (1.2M, 450K format), SVG title tooltips for exact counts, and green session delta indicators
- Created ActivityFeed: SSE connection to /api/stream/activity with auto-scroll (pauses on user scroll, resumes at bottom), prefix filter dropdown with dynamically-assigned colors, "Jump to latest" button, 2000-line client buffer
- Rewrote System.svelte: three-section stacked layout (status bar + token chart + activity feed), 5s polling via setInterval in $effect, pulsing state toggled after each poll

## Task Commits

Each task was committed atomically:

1. **Task 1: Add types and fetch wrappers to api.ts, create BrokerStatusBar and TokenChart components** - `ef8fed8` (feat)
2. **Task 2: Create ActivityFeed component and rewrite System.svelte page** - `33eb3fe` (feat)

## Files Created/Modified
- `src/nexus/ui/lib/api.ts` — Added BrokerStatus, TokenEntry, LogLine types and fetchBrokerStatus/fetchTokenStats fetch wrappers
- `src/nexus/ui/components/BrokerStatusBar.svelte` — Compact horizontal status bar with online/offline pill badge, model name, pending count, active job display, client count, pulse-fade CSS animation
- `src/nexus/ui/components/TokenChart.svelte` — D3 horizontal bar chart: xScale/yScale, repo name labels, blue bars with SVG title tooltips, value labels in human-readable format, green session delta text
- `src/nexus/ui/components/ActivityFeed.svelte` — EventSource SSE client, auto-scroll with 50px threshold, tick().then() for DOM flush, prefix filter dropdown, dynamic color map, Jump to latest button, 3s reconnect on error
- `src/nexus/ui/routes/System.svelte` — Complete rewrite: stacked flex-col layout at calc(100vh - 48px), three sections stacked, 5s setInterval polling, pulsing trigger

## Decisions Made
- Used D3's `d3.select(svgEl).selectAll('*').remove()` approach for clearing and re-rendering on reactive updates — simplest for reactive charts without persistent layout state
- SVG native `<title>` elements for hover tooltips — avoids custom tooltip overlay implementation
- Buffer bounded at 2000 lines with trim to 1500 — balances memory use against losing recent context on trim

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing d3 from node_modules**
- **Found during:** Task 2 build verification
- **Issue:** d3 was in package.json but not in node_modules (worktree node_modules hadn't been updated after Phase 01 added the dependency)
- **Fix:** Ran `npm install` to install the 69 missing packages including d3
- **Files modified:** node_modules/ (not committed, .gitignore'd)
- **Verification:** Build succeeded after install
- **Committed in:** n/a (node_modules not committed)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking)
**Impact on plan:** Quick fix, no scope creep.

## Issues Encountered
- d3 in package.json but not installed in node_modules — resolved by running `npm install`

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 23 is now complete: all three backend endpoints (Plan 01) and full System tab UI (Plan 02) delivered
- System tab shows live broker status, token usage, and activity feed when Nexus server is running
- Phase 24 can proceed: settings page, file tree heat colors, staleness indicators per the roadmap

## Self-Check: PASSED

- FOUND: src/nexus/ui/lib/api.ts
- FOUND: src/nexus/ui/components/BrokerStatusBar.svelte
- FOUND: src/nexus/ui/components/TokenChart.svelte
- FOUND: src/nexus/ui/components/ActivityFeed.svelte
- FOUND: src/nexus/ui/routes/System.svelte
- FOUND commit: ef8fed8 (Task 1)
- FOUND commit: 33eb3fe (Task 2)
