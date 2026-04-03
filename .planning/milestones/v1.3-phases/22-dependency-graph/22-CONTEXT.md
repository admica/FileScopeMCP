# Phase 22: Dependency Graph - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

An interactive Cytoscape.js dependency graph visualization replaces the file tree in the left panel via a toggle. Nodes represent files (sized by importance, colored by directory), edges represent local imports. Hover highlights connections, click navigates to file detail. Directory subtree filtering manages node count. No system view (Phase 23), no heat colors or staleness icons on tree (Phase 24).

</domain>

<decisions>
## Implementation Decisions

### Graph Library
- **D-01:** **Cytoscape.js** for the dependency graph (locked in Phase 20 D-02). NEXUS-19 references "D3.js force-directed" but this is superseded — the Phase 20 discussion explicitly chose Cytoscape.js for graph interactions (zoom, pan, hover, click, layout algorithms) and D3.js only for auxiliary charts in Phase 23. NEXUS-PLAN.md's tech stack section also says Cytoscape.js.

### Node Visual Encoding
- **D-02:** **Nodes sized by importance score** (0-10 scale maps to node diameter). Minimum size ensures all nodes are visible/clickable.
- **D-03:** **Nodes colored by top-level directory** — files under `src/broker/` get one color, `src/db/` another, etc. This creates natural visual clusters matching how developers think about codebase structure. A color legend shows the mapping. Root-level files get a neutral/default color.
- **D-04:** **Edge arrows** show dependency direction (source → target). Edges are thin, semi-transparent, highlighted on hover.

### Graph Interactions
- **D-05:** **Hover a node** highlights it + its direct dependencies (outgoing) and dependents (incoming) in accent colors. Dims all other nodes/edges. Shows a small tooltip with file name, importance, and summary (first ~80 chars).
- **D-06:** **Click a node** navigates via URL hash (`#/project/:repo/file/:path`) — reuses Phase 21's existing navigation pattern. This loads the file's detail panel on the right and highlights the file in the tree (when toggled back to tree view).
- **D-07:** **Hover an edge** shows a tooltip with source → target file names.
- **D-08:** **Zoom, pan, drag** are Cytoscape.js built-in behaviors — no custom implementation needed. Drag-to-rearrange individual nodes uses Cytoscape's `grab` events.

### Tree ↔ Graph Toggle
- **D-09:** **Left panel toggle** — a small toggle control (e.g., segmented button: "Tree | Graph") at the top of the left panel switches between FileTree and DependencyGraph. The detail panel (right side) stays visible in both modes. The resizable divider from Phase 21 works the same way.
- **D-10:** **Hash route extension** — graph view adds a route type: `#/project/:repo/graph` shows the graph in the left panel with stats/default in detail. `#/project/:repo/graph/file/:path` shows graph with that node highlighted + detail panel for the file.

### Directory Subtree Filter
- **D-11:** **Dropdown above the graph canvas** listing all top-level directories (src/, tests/, etc.) plus an "All" option. Selecting a directory filters to show only files under that subtree PLUS any external files they depend on or that depend on them (so cross-boundary edges remain visible).
- **D-12:** **Performance target**: Repos under 500 files render the full graph. For larger repos, the filter defaults to the largest directory instead of "All" to keep initial node count manageable (~200 nodes max for smooth interaction).

### API Endpoint
- **D-13:** **New endpoint**: `GET /api/project/:repoName/graph` returns the full dependency graph data:
  ```
  {
    nodes: [{ path, name, importance, isDir: false, directory, hasSummary, isStale }],
    edges: [{ source: sourcePath, target: targetPath }]
  }
  ```
  Single fetch, frontend does all filtering/layout. Only includes `local_import` dependencies (not package imports). `directory` field is the top-level directory for color mapping.
- **D-14:** Optional query param `?dir=src/broker` for server-side subtree pre-filtering (reduces payload for large repos). Without param, returns all nodes/edges.

### Claude's Discretion
- Cytoscape.js layout algorithm choice (cose, fcose, cola, dagre — whatever produces the best visual clustering)
- Exact color palette for directory-based node coloring
- Tooltip styling and positioning
- Toggle button visual design (segmented control, tabs, icon buttons)
- Node minimum/maximum sizes
- Edge styling (solid, dashed, curved)
- Animation/transition timing for hover highlights
- Whether the filter dropdown also shows file counts per directory

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Nexus Design
- `NEXUS-PLAN.md` — Full architecture. Read: "Dependency Graph View" section for visualization spec, API Endpoints for `/graph` contract, Edge Cases > Large Repos for performance guidance.

### Requirements
- `.planning/REQUIREMENTS.md` — NEXUS-19 through NEXUS-24 define the dependency graph requirements. Note: NEXUS-19 says "D3.js" but this is superseded by Phase 20 D-02 (Cytoscape.js).

### Database Schema
- `src/db/schema.ts` — `file_dependencies` table: source_path, target_path, dependency_type, package_name. Graph uses `dependency_type = 'local_import'` rows only.

### Existing Code (Phase 20-21 deliverables)
- `src/nexus/repo-store.ts` — `getDb()` for database access, `getRepoStats()` as query pattern template. New `getGraphData()` function added here.
- `src/nexus/server.ts` — Existing routes. New `/api/project/:repoName/graph` route added here.
- `src/nexus/ui/lib/api.ts` — Existing fetch wrappers and types. New `fetchGraph()` wrapper and graph types added here.
- `src/nexus/ui/App.svelte` — Hash router with Route type. Needs `project-graph` route type.
- `src/nexus/ui/routes/Project.svelte` — Two-panel layout. Left panel needs toggle between FileTree and new DependencyGraph component.
- `src/nexus/ui/components/FileTree.svelte` — Reference for left-panel component pattern (props, events, loading state).
- `src/nexus/ui/components/DetailPanel.svelte` — Right panel stays as-is; graph clicks trigger it via hash navigation.

### Phase 20-21 Context (prior decisions that carry forward)
- `.planning/phases/20-server-skeleton-repo-discovery/20-CONTEXT.md` — D-01 through D-13 (Svelte 5, Tailwind dark-only, Fastify JSON API, hash router, Cytoscape.js for graph)
- `.planning/phases/21-file-tree-detail-panel/21-CONTEXT.md` — D-01 through D-17 (panel layout, URL hash binding, lazy loading, click navigation)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `repo-store.ts` — `getDb()` and query patterns (prepare/all/get) reusable for graph data query
- `api.ts` — fetch wrapper pattern (encodeURIComponent for repoName, error handling)
- `App.svelte` hash router — already parses multiple route types, easy to extend
- `Project.svelte` two-panel layout — left panel content is swappable
- `DetailPanel.svelte` — automatically responds to URL hash changes, no modification needed for graph clicks

### Established Patterns
- Svelte 5 runes: `$state()`, `$derived()`, `$effect()`, `$props()`
- Tailwind dark-only: `bg-gray-900`, `text-gray-100`, `border-gray-700`
- Fastify route: `app.get<{ Params }>('/api/...', async (req, reply) => {...})`
- better-sqlite3: `db.prepare().all()` / `.get()`
- Component pattern: `$props()` for inputs, callback props for events (e.g., `onSelectFile`)

### Integration Points
- `repo-store.ts` — add `getGraphData()` query function
- `server.ts` — add `/api/project/:repoName/graph` route
- `api.ts` — add `GraphNode`, `GraphEdge`, `GraphResponse` types + `fetchGraph()` wrapper
- `App.svelte` — add `project-graph` route type, parse `#/project/:repo/graph` hash
- `Project.svelte` — add toggle state, conditionally render FileTree or DependencyGraph
- New: `src/nexus/ui/components/DependencyGraph.svelte` — Cytoscape.js canvas component
- New: `src/nexus/ui/components/GraphFilter.svelte` — directory filter dropdown

</code_context>

<specifics>
## Specific Ideas

- The graph/map visualization is the PRIMARY interface, not a side panel (from Phase 20 specifics)
- "It has to look pretty" — dark mode developer dashboard aesthetic, polished UI
- Hover on nodes to see file/dir details, hover on connection lines to see dependency info
- 2D map showing hierarchy, connections, linkages between nodes
- Cytoscape.js chosen specifically for its rich graph interaction model (zoom, pan, hover, click, layout algorithms)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 22-dependency-graph*
*Context gathered: 2026-04-02*
