---
phase: 22-dependency-graph
plan: 02
subsystem: ui
tags: [cytoscape, graph, dependency-graph, svelte, svelte5, routing, toggle]

# Dependency graph
requires:
  - phase: 22-01
    provides: fetchGraph(), GraphNode, GraphEdge, GraphResponse types, cytoscape/cytoscape-fcose installed
provides:
  - DependencyGraph.svelte Cytoscape.js component with fcose layout, hover highlight/dim, click nav, tooltip
  - GraphFilter.svelte directory filter dropdown with file counts
  - App.svelte: project-graph and project-graph-file Route types, /graph hash parsing
  - Project.svelte: Tree/Graph toggle, conditional DependencyGraph rendering, showGraph prop
affects:
  - (none downstream in phase 22)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - cytoscape.use(fcose) at module level (not inside onMount) prevents duplicate registration
    - closedNeighborhood() for hover highlight — includes node + all adjacent nodes + connecting edges
    - ResizeObserver on container div + cy.resize() (not cy.fit()) for panel resize
    - filterGraph() client-side subtree: inSubtree = path.startsWith(dir + '/'), keeps cross-boundary edges
    - Graph routes parsed BEFORE /file/ and /dir/ in hash parser to avoid wrong fallback match
    - showGraph boolean prop drives conditional rendering between FileTree and DependencyGraph
    - flex-1 min-h-0 on graph container div — critical for Cytoscape height calculation

key-files:
  created:
    - src/nexus/ui/components/DependencyGraph.svelte
    - src/nexus/ui/components/GraphFilter.svelte
  modified:
    - src/nexus/ui/App.svelte
    - src/nexus/ui/routes/Project.svelte

key-decisions:
  - "cytoscape.use(fcose) at module level: prevents duplicate registration if component re-mounts"
  - "Graph routes parsed before /file/ and /dir/ in hash parser: avoids /project/Foo/graph matching as project name 'Foo/graph'"
  - "flex-1 min-h-0 on graph container: without min-h-0 flex item won't shrink and Cytoscape height is 0"
  - "onFilterChange callback in DependencyGraph: allows parent to set graphFilterDir from inside graph (D-12 trigger)"

requirements-completed:
  - NEXUS-20
  - NEXUS-21
  - NEXUS-22
  - NEXUS-23
  - NEXUS-24

# Metrics
duration: ~4min
completed: 2026-04-02
---

# Phase 22 Plan 02: Dependency Graph UI Components Summary

**Cytoscape.js DependencyGraph component with fcose layout, hover highlight/dim/tooltip, click navigation, directory color palette, directory filter dropdown, Tree/Graph toggle in left panel, and extended App.svelte routing for graph views**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-02T05:14:30Z
- **Completed:** 2026-04-02T05:18:10Z
- **Tasks:** 2 code tasks + 1 pending human verification
- **Files modified:** 4

## Accomplishments

- Created DependencyGraph.svelte (269 lines): Cytoscape.js with fcose force-directed layout, 8-color directory palette, importance-based node sizing (12 + importance * 3), hover highlights via closedNeighborhood() with dimmed/highlighted classes, edge hover tooltip, tap-to-navigate, ResizeObserver for panel resize, large-graph D-12 auto-filter trigger
- Created GraphFilter.svelte: directory dropdown with file counts, sorted by count descending, shows "All (N)" plus per-directory options
- Extended App.svelte Route type with project-graph and project-graph-file variants; hash parser checks /graph/file/ and /graph before /file/ and /dir/ (prevents route collision)
- Updated Project.svelte with showGraph prop, Tree/Graph toggle buttons, $effect-driven fetchGraph() on graph activation, D-12 auto-filter for >500 nodes, conditional DependencyGraph/FileTree rendering

## Task Commits

Each task was committed atomically:

1. **Task 1: Create DependencyGraph.svelte and GraphFilter.svelte** - `d8d2c57` (feat)
2. **Task 2: Extend App.svelte routing and add tree/graph toggle to Project.svelte** - `60e7468` (feat)

**Plan metadata:** (docs commit — see final commit)

## Files Created/Modified

- `src/nexus/ui/components/DependencyGraph.svelte` - New: Cytoscape.js graph visualization component (269 lines)
- `src/nexus/ui/components/GraphFilter.svelte` - New: Directory filter dropdown (37 lines)
- `src/nexus/ui/App.svelte` - Extended Route type and hash parser for graph routes
- `src/nexus/ui/routes/Project.svelte` - Added showGraph prop, toggle buttons, graph data fetching, conditional rendering

## Decisions Made

- `cytoscape.use(fcose)` at module level (not inside onMount) — prevents duplicate registration errors if the component mounts/unmounts multiple times
- Graph routes parsed before /file/ and /dir/ in hash parser — avoids `#/project/Foo/graph` matching as project name `Foo/graph`
- `flex-1 min-h-0` on graph container div — without min-h-0, the flex item won't shrink and Cytoscape measures container height as 0
- `onFilterChange` callback passed into DependencyGraph — allows the D-12 large-graph check inside onMount to propagate the auto-selected filter dir back up to Project.svelte state

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

Build warning: `tooltipEl` is bound via `bind:this` but declared without `$state()`. This is expected — DOM bindings don't need to be reactive state. Warning does not affect functionality, build exits 0.

## User Setup Required

Visual verification is required (Task 3 — checkpoint:human-verify):
1. Build and start: `npm run build:nexus && npm run nexus`
2. Open browser to http://localhost:1234
3. Verify Tree/Graph toggle, graph renders with colored nodes, hover highlights, click navigates, filter dropdown works

## Next Phase Readiness

- All code is committed and built
- Awaiting user visual verification (Task 3 checkpoint)
- After approval, requirements NEXUS-19 through NEXUS-24 are complete

## Self-Check: PASSED

- FOUND: src/nexus/ui/components/DependencyGraph.svelte
- FOUND: src/nexus/ui/components/GraphFilter.svelte
- FOUND: .planning/phases/22-dependency-graph/22-02-SUMMARY.md
- FOUND commit: d8d2c57 (Task 1)
- FOUND commit: 60e7468 (Task 2)

---
*Phase: 22-dependency-graph*
*Completed: 2026-04-02*
