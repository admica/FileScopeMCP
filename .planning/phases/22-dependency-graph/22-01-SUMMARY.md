---
phase: 22-dependency-graph
plan: 01
subsystem: api
tags: [cytoscape, graph, dependency-graph, fastify, svelte, sqlite]

# Dependency graph
requires:
  - phase: 21-file-tree-detail-panel
    provides: Svelte SPA router, FileTree/FileDetail components, api.ts fetch wrapper patterns
provides:
  - GET /api/project/:repoName/graph endpoint returning local_import nodes and edges
  - getGraphData() query function in repo-store.ts
  - GraphNode, GraphEdge, GraphData TypeScript types in repo-store.ts
  - GraphNode, GraphEdge, GraphResponse TypeScript types in ui/lib/api.ts
  - fetchGraph() fetch wrapper in ui/lib/api.ts
  - cytoscape and cytoscape-fcose npm packages installed
affects:
  - 22-02 (DependencyGraph Svelte component consumes fetchGraph() and graph types)

# Tech tracking
tech-stack:
  added:
    - cytoscape@3.33.1 (graph visualization library, bundled into Svelte UI)
    - cytoscape-fcose@2.2.0 (force-directed layout algorithm for cytoscape)
  patterns:
    - getGraphData() follows repo-store query pattern: db param + optional filter, returns typed object
    - Graph route follows Fastify route pattern: getDb(), 404 guard, query function, return result
    - fetchGraph() follows api.ts fetch wrapper pattern: encodeURIComponent(repoName), error on !res.ok

key-files:
  created: []
  modified:
    - src/nexus/repo-store.ts
    - src/nexus/server.ts
    - src/nexus/ui/lib/api.ts
    - package.json

key-decisions:
  - "Only local_import edges included in graph (not package_import) — package deps are not meaningful for visualization"
  - "dirFilter uses LIKE pattern on both source and target — subtree files plus their external connections included"
  - "directory field mapped from first path segment — enables color-grouping by top-level dir in visualization"
  - "Paths IN query for node metadata — single round-trip fetch for all referenced files"

patterns-established:
  - "Graph route: optional Querystring typed param { dir?: string } for subtree filter"
  - "fetchGraph() encodes dir param via encodeURIComponent() — query param values need encoding unlike hash path segments"

requirements-completed:
  - NEXUS-19
  - NEXUS-13

# Metrics
duration: 2min
completed: 2026-04-02
---

# Phase 22 Plan 01: Dependency Graph API Endpoint Summary

**GET /api/project/:repoName/graph endpoint with getGraphData() SQLite query, GraphNode/GraphEdge/GraphResponse types, fetchGraph() wrapper, and cytoscape/cytoscape-fcose installed**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-02T05:10:09Z
- **Completed:** 2026-04-02T05:11:51Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Installed cytoscape and cytoscape-fcose npm packages as runtime dependencies for the Svelte UI bundle
- Added GraphNode, GraphEdge, GraphData types and getGraphData() query function to repo-store.ts — queries local_import edges with optional subtree filter, fetches file metadata in a single IN query
- Added GET /api/project/:repoName/graph Fastify route with optional ?dir= query param to server.ts
- Added GraphNode, GraphEdge, GraphResponse types and fetchGraph() wrapper to ui/lib/api.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Install cytoscape deps and add getGraphData() to repo-store.ts** - `d6f91da` (feat)
2. **Task 2: Add graph API route to server.ts and graph types + fetchGraph() to api.ts** - `7775108` (feat)

**Plan metadata:** (docs commit — see final commit)

## Files Created/Modified
- `src/nexus/repo-store.ts` - Added GraphNode, GraphEdge, GraphData types and getGraphData() function
- `src/nexus/server.ts` - Added GET /api/project/:repoName/graph route with optional ?dir= filter
- `src/nexus/ui/lib/api.ts` - Added GraphNode, GraphEdge, GraphResponse types and fetchGraph() wrapper
- `package.json` - Added cytoscape and cytoscape-fcose dependencies

## Decisions Made
- Only local_import edges included (not package_import) — package deps not meaningful for dependency graph visualization
- dirFilter LIKE pattern on both source and target — shows subtree files plus their external connections
- directory field mapped from first path segment — enables top-level dir color-grouping in visualization
- fetchGraph() encodes dir query param value (unlike hash path segments which contain meaningful slashes)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (DependencyGraph Svelte component) can now import fetchGraph(), GraphNode, GraphEdge, GraphResponse from ui/lib/api.ts
- Backend endpoint is live once nexus server starts — returns { nodes, edges } JSON
- cytoscape and cytoscape-fcose are available for import in Svelte components

---
*Phase: 22-dependency-graph*
*Completed: 2026-04-02*
