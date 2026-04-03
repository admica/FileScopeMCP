# Phase 22: Dependency Graph - Research

**Researched:** 2026-04-01
**Domain:** Cytoscape.js graph visualization, Svelte 5 integration, Fastify API extension
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Cytoscape.js for the dependency graph (not D3.js — NEXUS-19 is superseded by Phase 20 D-02)
- **D-02:** Nodes sized by importance score (0-10 scale maps to node diameter); minimum size ensures all nodes are visible/clickable
- **D-03:** Nodes colored by top-level directory; root-level files get neutral/default color; color legend shown
- **D-04:** Edge arrows show dependency direction (source → target); thin, semi-transparent, highlighted on hover
- **D-05:** Hover a node highlights direct dependencies (outgoing) and dependents (incoming) in accent colors; dims all other nodes/edges; tooltip shows file name, importance, ~80-char summary
- **D-06:** Click a node navigates via URL hash (`#/project/:repo/file/:path`) — reuses Phase 21 navigation
- **D-07:** Hover an edge shows tooltip with source → target file names
- **D-08:** Zoom, pan, drag are Cytoscape.js built-in behaviors — no custom implementation
- **D-09:** Toggle at top of left panel ("Tree | Graph") switches between FileTree and DependencyGraph; detail panel stays visible
- **D-10:** Hash route extension: `#/project/:repo/graph` and `#/project/:repo/graph/file/:path`
- **D-11:** Dropdown above graph listing all top-level directories plus "All"; filters to subtree PLUS its external deps
- **D-12:** Repos under 500 files render full graph; larger repos default to largest directory (~200 nodes max)
- **D-13:** `GET /api/project/:repoName/graph` returns `{ nodes: [...], edges: [...] }`; only `local_import` dependencies
- **D-14:** Optional `?dir=src/broker` query param for server-side subtree pre-filtering

### Claude's Discretion
- Cytoscape.js layout algorithm choice (cose, fcose, cola, dagre — whatever produces best visual clustering)
- Exact color palette for directory-based node coloring
- Tooltip styling and positioning
- Toggle button visual design (segmented control, tabs, icon buttons)
- Node minimum/maximum sizes
- Edge styling (solid, dashed, curved)
- Animation/transition timing for hover highlights
- Whether filter dropdown shows file counts per directory

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NEXUS-19 | Cytoscape.js (not D3.js) force-directed graph of `file_dependencies WHERE dependency_type = 'local_import'` | Graph data query pattern in repo-store.ts; Cytoscape.js init + fcose layout |
| NEXUS-20 | Graph nodes sized by importance, colored by directory | Cytoscape.js style function `ele.data()` mapping; color palette assignment by top-level dir |
| NEXUS-21 | Hover a node highlights direct dependencies and dependents; click opens file detail panel | `cy.on('mouseover')` + `closedNeighborhood()` + CSS class pattern; hash navigation reuse |
| NEXUS-22 | Zoom, pan, and drag-to-rearrange interactions | Cytoscape.js built-in (no extra code); `userZoomingEnabled`, `userPanningEnabled`, `boxSelectionEnabled` defaults |
| NEXUS-23 | Directory subtree filter limiting visible nodes to subtree + external deps | Client-side filter on loaded data; `?dir=` API param for large repos |
| NEXUS-24 | Tree ↔ Graph toggle switches left panel | Toggle state in Project.svelte; conditional render FileTree or DependencyGraph component |
</phase_requirements>

## Summary

Phase 22 adds an interactive Cytoscape.js dependency graph as an alternative left-panel view, toggling with the existing file tree. The backend adds one new Fastify route that queries `file_dependencies WHERE dependency_type = 'local_import'` and joins with `files` for node metadata. The frontend creates two new Svelte 5 components (`DependencyGraph.svelte` and `GraphFilter.svelte`) and extends `App.svelte` routing plus `Project.svelte` toggle logic.

Cytoscape.js 3.33.x ships its own TypeScript types (no `@types/cytoscape` needed). The `cytoscape-fcose` extension (v2.2.0) provides the best force-directed layout for this use case. All interactions — zoom, pan, drag — are built in. The hover-highlight-with-dimming pattern uses `cy.on('mouseover')` + CSS classes, a well-established Cytoscape.js idiom. Tooltips are best implemented as simple HTML `<div>` elements positioned manually (avoids Popper.js/Tippy.js dependency overhead for a small number of on-demand tooltips).

The integration with Svelte 5 uses `onMount` for Cytoscape initialization (DOM must exist first) and `$effect()` to re-run layout when graph data or filter changes. A `ResizeObserver` is needed to call `cy.resize()` when the left panel is resized via the drag divider.

**Primary recommendation:** Use `cytoscape` + `cytoscape-fcose` as devDependencies for the UI bundle; keep tooltip implementation as plain HTML DOM (no extra library); initialize Cytoscape in `onMount`, destroy in `onDestroy`, resize with `ResizeObserver`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| cytoscape | ^3.33.1 | Graph rendering, interactions, layout | Locked decision D-01; ships own TS types in 3.31+ |
| cytoscape-fcose | ^2.2.0 | fCoSE force-directed layout extension | Fastest CoSE-family layout, best for general dependency graphs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new for backend) | — | better-sqlite3 already present | Graph data query uses existing DB connection pattern |
| (no cytoscape-popper) | — | Tooltips | Avoid: per-performance warning; plain DOM div is sufficient |
| (no @types/cytoscape) | — | TypeScript types | Avoid: cytoscape 3.31+ ships own types; @types/cytoscape is now a stub |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| fcose | dagre | Dagre better for strict DAGs/trees; this repo graph has cycles, so force-directed wins |
| fcose | cola | Cola adds constraints support (unneeded here); fcose is faster and simpler |
| plain DOM tooltip | cytoscape-popper + tippy.js | Popper/Tippy adds ~30KB+; performance warning for large graphs; overkill for simple tooltips |
| fcose | cose (built-in) | Built-in cose needs more parameter tweaking; fcose gives better results with less config |

**Installation:**
```bash
npm install cytoscape cytoscape-fcose
```

Note: `cytoscape-fcose` peer-depends on `cytoscape`. Both go in `dependencies` (they are runtime deps for the UI bundle, but bundled by Vite). In practice they can also be `devDependencies` since Vite bundles them into `dist/nexus/static/`.

## Architecture Patterns

### Recommended Project Structure (additions only)
```
src/nexus/
├── repo-store.ts           # ADD: getGraphData() function
├── server.ts               # ADD: GET /api/project/:repoName/graph route
└── ui/
    ├── lib/
    │   └── api.ts          # ADD: GraphNode, GraphEdge, GraphResponse types + fetchGraph()
    ├── routes/
    │   └── Project.svelte  # MODIFY: toggle state, conditional render
    ├── App.svelte           # MODIFY: project-graph route type + hash parsing
    └── components/
        ├── DependencyGraph.svelte   # NEW: Cytoscape.js canvas component
        └── GraphFilter.svelte       # NEW: directory filter dropdown
```

### Pattern 1: getGraphData() Query (repo-store.ts)
**What:** Single SQL query joining `file_dependencies` and `files` for graph payload
**When to use:** Called by the new `/api/project/:repoName/graph` route

```typescript
// Source: based on existing getFileDetail() query patterns in repo-store.ts
export type GraphNode = {
  path: string;
  name: string;
  importance: number;
  directory: string;   // top-level directory (e.g. "src", "tests"); "" for root-level files
  hasSummary: boolean;
  isStale: boolean;
};

export type GraphEdge = {
  source: string;
  target: string;
};

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

export function getGraphData(
  db: InstanceType<typeof Database>,
  dirFilter?: string
): GraphData {
  // Edges: all local_import dependencies
  let edgeQuery = `
    SELECT source_path AS source, target_path AS target
    FROM file_dependencies
    WHERE dependency_type = 'local_import'
  `;
  const edgeParams: string[] = [];
  if (dirFilter) {
    // Server-side pre-filter: both endpoints in subtree OR one endpoint in subtree
    edgeQuery += ` AND (source_path LIKE ? OR target_path LIKE ?)`;
    edgeParams.push(`${dirFilter}/%`, `${dirFilter}/%`);
  }
  const edges = db.prepare(edgeQuery).all(...edgeParams) as GraphEdge[];

  // Collect unique file paths from edges
  const pathSet = new Set<string>();
  for (const e of edges) { pathSet.add(e.source); pathSet.add(e.target); }
  if (pathSet.size === 0) return { nodes: [], edges: [] };

  // Nodes: fetch metadata for all referenced files
  const placeholders = Array.from(pathSet).map(() => '?').join(',');
  const fileRows = db.prepare(`
    SELECT path, name, importance,
           (summary IS NOT NULL) AS has_summary,
           (summary_stale_since IS NOT NULL OR concepts_stale_since IS NOT NULL
            OR change_impact_stale_since IS NOT NULL) AS is_stale
    FROM files WHERE path IN (${placeholders}) AND is_directory = 0
  `).all(...Array.from(pathSet)) as Array<{
    path: string; name: string; importance: number | null;
    has_summary: number; is_stale: number;
  }>;

  const nodes: GraphNode[] = fileRows.map(r => ({
    path: r.path,
    name: r.name,
    importance: r.importance ?? 0,
    directory: r.path.includes('/') ? r.path.split('/')[0] : '',
    hasSummary: Boolean(r.has_summary),
    isStale: Boolean(r.is_stale),
  }));

  return { nodes, edges };
}
```

### Pattern 2: Fastify Graph Route (server.ts)
**What:** New GET route with optional `?dir=` query param
**When to use:** New endpoint for graph data

```typescript
// Source: existing Fastify route pattern in server.ts
app.get<{ Params: { repoName: string }; Querystring: { dir?: string } }>(
  '/api/project/:repoName/graph',
  async (req, reply) => {
    const db = getDb(req.params.repoName);
    if (!db) { reply.code(404); return { error: 'Repo not found or offline' }; }
    const dirFilter = req.query.dir;
    return getGraphData(db, dirFilter);
  }
);
```

### Pattern 3: Cytoscape.js Svelte 5 Component (DependencyGraph.svelte)
**What:** Initialize Cytoscape in `onMount`, destroy in `onDestroy`, resize with `ResizeObserver`
**When to use:** This is THE pattern for any third-party imperative DOM library in Svelte 5

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import cytoscape from 'cytoscape';
  import fcose from 'cytoscape-fcose';
  import type { GraphNode, GraphEdge } from '../lib/api';

  cytoscape.use(fcose);  // register once at module level

  let { nodes, edges, selectedPath, onSelectFile }: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    selectedPath: string | null;
    onSelectFile: (path: string) => void;
  } = $props();

  let container: HTMLDivElement;
  let cy: ReturnType<typeof cytoscape> | null = null;
  let resizeObserver: ResizeObserver;

  onMount(() => {
    cy = cytoscape({
      container,
      elements: buildElements(nodes, edges, COLOR_MAP),
      style: buildStyle(COLOR_MAP),
      layout: { name: 'fcose', animate: true, randomize: false },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    // Hover: highlight neighbors, dim others
    cy.on('mouseover', 'node', (e) => {
      const node = e.target;
      const neighborhood = node.closedNeighborhood();
      cy!.elements().difference(neighborhood).addClass('dimmed');
      neighborhood.addClass('highlighted');
      showTooltip(node);
    });
    cy.on('mouseout', 'node', () => {
      cy!.elements().removeClass('dimmed highlighted');
      hideTooltip();
    });
    cy.on('mouseover', 'edge', (e) => showEdgeTooltip(e.target));
    cy.on('mouseout', 'edge', () => hideTooltip());

    // Click: navigate to file detail
    cy.on('tap', 'node', (e) => {
      onSelectFile(e.target.id());
    });

    // Resize: call cy.resize() when left panel is resized by user drag
    resizeObserver = new ResizeObserver(() => {
      cy?.resize();
      cy?.fit();
    });
    resizeObserver.observe(container);
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    cy?.destroy();
    cy = null;
  });

  // Re-run layout when data changes
  $effect(() => {
    if (!cy) return;
    cy.elements().remove();
    cy.add(buildElements(nodes, edges, COLOR_MAP));
    cy.layout({ name: 'fcose', animate: true, randomize: false }).run();
    cy.fit();
  });
</script>

<div bind:this={container} class="w-full h-full"></div>
```

### Pattern 4: Node Sizing by Importance
**What:** Style function maps importance (0-10) to node diameter
**When to use:** Node style definition in `buildStyle()`

```typescript
// Source: Cytoscape.js official docs — style function values
// Importance 0 → 12px diameter, importance 10 → 42px diameter
// Formula: 12 + importance * 3
{
  selector: 'node',
  style: {
    'width':  (ele: cytoscape.NodeSingular) => 12 + (ele.data('importance') as number) * 3,
    'height': (ele: cytoscape.NodeSingular) => 12 + (ele.data('importance') as number) * 3,
    'background-color': (ele: cytoscape.NodeSingular) => ele.data('color') as string,
    'label': (ele: cytoscape.NodeSingular) => ele.data('name') as string,
    'font-size': 10,
    'color': '#e5e7eb',          // Tailwind gray-200 — readable on dark background
    'text-valign': 'bottom',
    'text-halign': 'center',
  }
}
```

### Pattern 5: Directory Color Mapping
**What:** Assign a color to each top-level directory from a fixed dark-mode palette
**When to use:** Build COLOR_MAP before initializing Cytoscape; pass to node data

```typescript
// Source: design decision D-03; color palette at Claude's discretion
// Dark-mode developer palette — distinct but not harsh on dark background
const DIRECTORY_COLORS = [
  '#60a5fa', // blue-400
  '#34d399', // emerald-400
  '#f472b6', // pink-400
  '#fb923c', // orange-400
  '#a78bfa', // violet-400
  '#facc15', // yellow-400
  '#22d3ee', // cyan-400
  '#f87171', // red-400
];
const ROOT_COLOR = '#9ca3af'; // gray-400 for root-level files

function buildColorMap(nodes: GraphNode[]): Record<string, string> {
  const dirs = [...new Set(nodes.map(n => n.directory).filter(Boolean))];
  const map: Record<string, string> = { '': ROOT_COLOR };
  dirs.forEach((dir, i) => {
    map[dir] = DIRECTORY_COLORS[i % DIRECTORY_COLORS.length];
  });
  return map;
}
```

### Pattern 6: App.svelte Route Extension
**What:** Add `project-graph` route type and two new hash patterns
**When to use:** When extending the existing hand-rolled hash router

```typescript
// Extend the Route type union in App.svelte:
type Route =
  | { type: 'project'; name: string }
  | { type: 'project-file'; name: string; filePath: string }
  | { type: 'project-dir'; name: string; dirPath: string }
  | { type: 'project-graph'; name: string }                          // NEW
  | { type: 'project-graph-file'; name: string; filePath: string }  // NEW
  | { type: 'system' }
  | { type: 'settings' }
  | { type: 'home' };

// In $derived.by() parser — add before the plain /project/ check:
// '#/project/Foo/graph'          → { type: 'project-graph', name: 'Foo' }
// '#/project/Foo/graph/file/bar' → { type: 'project-graph-file', name: 'Foo', filePath: 'bar' }
const graphFileIdx = rest.indexOf('/graph/file/');
const graphIdx = rest.indexOf('/graph');
if (graphFileIdx !== -1) {
  return {
    type: 'project-graph-file',
    name: decodeURIComponent(rest.slice(0, graphFileIdx)),
    filePath: rest.slice(graphFileIdx + 12),
  };
}
if (graphIdx !== -1 && rest.slice(graphIdx) === '/graph') {
  return { type: 'project-graph', name: decodeURIComponent(rest.slice(0, graphIdx)) };
}
```

### Pattern 7: Project.svelte Toggle State
**What:** Boolean toggle between FileTree and DependencyGraph in left panel
**When to use:** The toggle is driven by route prop, not local state

```svelte
<!-- Project.svelte receives new prop: showGraph -->
<!-- Or: derive showGraph from the route type passed from App.svelte -->
let {
  repoName, filePath, dirPath, showGraph,
}: { repoName: string; filePath: string | null; dirPath: string | null; showGraph: boolean } = $props();

<!-- Toggle button at top of left panel -->
<div class="flex gap-1 p-2 border-b border-gray-700">
  <button
    class="px-3 py-1 text-xs rounded {!showGraph ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}"
    onclick={() => window.location.hash = `#/project/${encodeURIComponent(repoName)}`}
  >Tree</button>
  <button
    class="px-3 py-1 text-xs rounded {showGraph ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}"
    onclick={() => window.location.hash = `#/project/${encodeURIComponent(repoName)}/graph`}
  >Graph</button>
</div>
```

### Anti-Patterns to Avoid
- **Initializing Cytoscape outside `onMount`:** The container div is not in the DOM until after mount. Cytoscape requires a real DOM element; calling it before mount produces "container not found" errors.
- **Not calling `cy.destroy()` in `onDestroy`:** Leaks event listeners and rendering loops; Svelte's reactivity can rebuild the component multiple times when navigating between repos.
- **Not using `ResizeObserver`:** Cytoscape does NOT automatically detect container resize (only window resize). The left panel is resizable via drag divider — without `ResizeObserver` the graph will misalign click/hover targets after resize.
- **Calling `cytoscape.use(fcose)` inside `onMount`:** Plugin registration is global — call it once at module level, not on every mount.
- **Setting container height to 0 or auto:** Cytoscape requires explicit height. Use `h-full` with the parent having a fixed height, not unbounded flex.
- **Encoding file paths in URL hash:** Phase 21 established that `filePath` is NOT encoded in the hash (it contains slashes that are load-bearing for path structure). The graph's click navigation must follow the same pattern.
- **Fetching graph data with file paths URL-encoded:** The graph endpoint `/api/project/:repoName/graph` should use `encodeURIComponent` only for `repoName`, not for the `dir=` query param (paths passed as-is, matching existing tree endpoint conventions).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Force-directed layout | Custom physics simulation | `cytoscape-fcose` | Spring embedder algorithms are mathematically complex; fcose is tuned and fast |
| Zoom/pan/drag | Custom pointer event handlers | Cytoscape.js built-in | Cytoscape handles these natively; interference causes double-handling bugs |
| Node neighborhood traversal | Manual BFS through edges array | `node.closedNeighborhood()` | Cytoscape graph model has this built in; manual traversal is O(n) over JS array |
| Graph element lifecycle | Manual add/remove DOM nodes | `cy.elements().remove()` + `cy.add()` | Cytoscape manages its own canvas rendering |
| TypeScript types | Type declarations for cy | cytoscape 3.31+ own types | Bundled since 3.31.0 — no stub `@types/cytoscape` needed |

**Key insight:** Cytoscape.js is a complete graph interaction runtime. Use its API for all graph operations; Svelte only manages the container div and reactive data updates.

## Common Pitfalls

### Pitfall 1: Container Height is Zero
**What goes wrong:** Graph renders but is invisible; Cytoscape logs no error
**Why it happens:** The left panel container uses `flex-1` but Cytoscape measures explicit pixels at init time. If the container has no resolved height (e.g., parent is `display:flex` with no fixed height in the chain), `cy.resize()` reads 0.
**How to avoid:** Ensure the container div for DependencyGraph uses `style="height: calc(100vh - Xrem)"` or is inside a parent with a known pixel height. Use `h-full` on the div and ensure the parent chain has a fixed height (same constraint as `FileTree` which uses `height: calc(100vh - 3rem)`).
**Warning signs:** Graph appears but click/hover hit targets are in wrong position; `cy.height()` returns 0.

### Pitfall 2: `cytoscape.use()` Called Multiple Times
**What goes wrong:** `fcose` extension throws "Extension already registered" error on Svelte HMR or component re-mount
**Why it happens:** If `cytoscape.use(fcose)` is inside `onMount`, it runs on every component mount
**How to avoid:** Call `cytoscape.use(fcose)` once at the module top level in `DependencyGraph.svelte`; it is idempotent at module scope since the module is loaded once.

### Pitfall 3: Hash Route Parsing Order
**What goes wrong:** `#/project/Foo/graph` matches the plain `/project/` branch before reaching the `/graph` check, returning `{ type: 'project', name: 'Foo/graph' }`
**Why it happens:** The existing parser in `App.svelte` does `rest.indexOf('/file/')` then `rest.indexOf('/dir/')` — `/graph` has no similar check yet. The order of `indexOf` checks matters.
**How to avoid:** Add `/graph` checks BEFORE the fallback `{ type: 'project' }` return, and check for `/graph/file/` before `/graph` (specific before general).

### Pitfall 4: Large Graph Initial Load (>500 nodes)
**What goes wrong:** fcose layout hangs the browser tab for seconds on first render
**Why it happens:** Force-directed layouts are O(n²) at worst; 500+ nodes with many edges can take 3-5s
**How to avoid:** Implement D-12 — if `nodes.length > 500`, default filter dropdown to the largest directory, not "All". Fetch with `?dir=` from the start for large repos. Check `nodes.length` in `DependencyGraph.svelte` before running layout; if > 500, emit a warning and suggest using the filter.
**Warning signs:** Browser DevTools shows long scripting task on first graph render.

### Pitfall 5: Svelte $effect Runs on First Mount Before cy Exists
**What goes wrong:** `$effect` that calls `cy.elements().remove()` runs before `onMount`, throwing "Cannot read properties of null"
**Why it happens:** Svelte 5 `$effect` runs after DOM mutations but the initialization order is: render DOM → effects → onMount. If `cy` is `$state(null)` and the effect checks `if (!cy) return`, the data-driven effect needs to be guarded.
**How to avoid:** Guard all `$effect` blocks that use `cy` with `if (!cy) return`. Alternatively, initialize `cy` synchronously in `onMount` before any effects that depend on it can fire (this is the reliable pattern since `onMount` runs after the initial `$effect` flush).

### Pitfall 6: Better-sqlite3 IN Clause with Large Sets
**What goes wrong:** SQL query `WHERE path IN (?, ?, ... 500 items)` hits SQLite's variable limit or is slow
**Why it happens:** SQLite default variable limit is 999; large repos can have 500+ unique file paths in the graph
**How to avoid:** The `getGraphData()` query collects paths from edges first, then queries files. For repos with >999 unique paths in graph edges, use a temp table or chunked queries. In practice the 500-node filter (D-12) caps this at ~500 paths, well under the limit. Document the assumption.

## Code Examples

Verified patterns from official sources:

### Cytoscape.js Init with fcose
```typescript
// Source: cytoscape.js official docs (https://js.cytoscape.org/) + fcose GitHub README
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

cytoscape.use(fcose); // register once at module level

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [
    { data: { id: 'a', importance: 8, color: '#60a5fa', name: 'coordinator.ts' } },
    { data: { id: 'b', importance: 3, color: '#34d399', name: 'types.ts' } },
    { data: { source: 'a', target: 'b' } }
  ],
  style: [
    {
      selector: 'node',
      style: {
        'width':  (ele) => 12 + ele.data('importance') * 3,
        'height': (ele) => 12 + ele.data('importance') * 3,
        'background-color': 'data(color)',
        'label': 'data(name)',
        'color': '#e5e7eb',
        'font-size': 10,
        'text-valign': 'bottom',
      }
    },
    {
      selector: 'edge',
      style: {
        'width': 1,
        'line-color': '#4b5563',        // gray-600
        'target-arrow-color': '#4b5563',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'opacity': 0.6,
      }
    },
    { selector: '.dimmed', style: { 'opacity': 0.08 } },
    { selector: '.highlighted', style: { 'opacity': 1 } },
    { selector: 'edge.highlighted', style: { 'line-color': '#60a5fa', 'opacity': 0.8 } },
  ],
  layout: { name: 'fcose', animate: true, randomize: false },
});
```

### Hover Highlight + Dim Pattern
```typescript
// Source: Cytoscape.js docs + community pattern (https://js.cytoscape.org/)
cy.on('mouseover', 'node', (e) => {
  const node = e.target;
  // closedNeighborhood() = the node itself + all neighbors + connecting edges
  const neighborhood = node.closedNeighborhood();
  cy.elements().difference(neighborhood).addClass('dimmed');
  neighborhood.addClass('highlighted');
});

cy.on('mouseout', 'node', () => {
  cy.elements().removeClass('dimmed highlighted');
});
```

### Client-Side Subtree Filter
```typescript
// Source: CONTEXT.md D-11 logic — filter nodes to subtree + external deps
function filterGraph(
  allNodes: GraphNode[],
  allEdges: GraphEdge[],
  selectedDir: string
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  if (!selectedDir) return { nodes: allNodes, edges: allEdges };

  const inSubtree = (path: string) => path.startsWith(selectedDir + '/');

  // Keep edges where at least one endpoint is in the subtree
  const filteredEdges = allEdges.filter(
    e => inSubtree(e.source) || inSubtree(e.target)
  );

  // Keep nodes that appear in filtered edges
  const keepPaths = new Set<string>();
  filteredEdges.forEach(e => { keepPaths.add(e.source); keepPaths.add(e.target); });
  const filteredNodes = allNodes.filter(n => keepPaths.has(n.path));

  return { nodes: filteredNodes, edges: filteredEdges };
}
```

### fetchGraph API wrapper (api.ts)
```typescript
// Source: existing fetch wrapper patterns in src/nexus/ui/lib/api.ts
export type GraphNode = {
  path: string;
  name: string;
  importance: number;
  directory: string;
  hasSummary: boolean;
  isStale: boolean;
};
export type GraphEdge = { source: string; target: string };
export type GraphResponse = { nodes: GraphNode[]; edges: GraphEdge[] };

export async function fetchGraph(repoName: string, dir?: string): Promise<GraphResponse> {
  const base = `/api/project/${encodeURIComponent(repoName)}/graph`;
  const url = dir ? `${base}?dir=${encodeURIComponent(dir)}` : base;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Graph fetch failed: ${res.status}`);
  return res.json();
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| D3.js force-directed for dependency graphs | Cytoscape.js with fcose extension | Phase 20 D-02 | Cytoscape has richer graph API (neighborhood queries, tap events, layout extensions) |
| `@types/cytoscape` from DefinitelyTyped | cytoscape ships own types (3.31.0+) | Jan 2025 | Don't install `@types/cytoscape`; it's now a stub that may conflict |
| `cose` (built-in) as default layout | `fcose` (extension) as recommended | 2022, still current in 2025 | fcose is 2x faster and needs less parameter tweaking; cose built-in is now legacy |
| Popper.js for tooltips | `@floating-ui` API change; Popper.js deprecated | 2023 | cytoscape-popper's tippyFactory pattern changed; for simple tooltips, plain DOM div avoids the complexity |

**Deprecated/outdated:**
- `cytoscape-qtip`: qtip2 is unmaintained, no proper npm/webpack support — do not use
- `@types/cytoscape`: now a stub since Cytoscape 3.31.0 ships own types — do not install

## Open Questions

1. **fcose on very sparse or disconnected graphs**
   - What we know: fcose works well on connected graphs with clear clustering
   - What's unclear: If the repo has many isolated files (no local imports), they float to edges; may look cluttered
   - Recommendation: Handle gracefully — isolated nodes (no edges) can be excluded from layout initially; add a "show isolated" toggle if needed. Not blocking.

2. **SQLite IN clause with >999 paths**
   - What we know: SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999
   - What's unclear: Whether any real repo in this project set will hit this in practice
   - Recommendation: The 500-node performance cap (D-12) means paths in one query stay under 500. Document the assumption in a code comment.

3. **Tooltip positioning near graph edges**
   - What we know: Plain DOM `<div>` tooltip positioned via `mousemove` clientX/clientY works universally
   - What's unclear: Whether tooltip at cursor position or at node position looks better
   - Recommendation: At Claude's discretion — position near cursor (simpler to implement, no Popper dependency).

## Validation Architecture

> Skipped — `workflow.nyquist_validation` is `false` in `.planning/config.json`.

## Sources

### Primary (HIGH confidence)
- [Cytoscape.js Official Docs](https://js.cytoscape.org/) — initialization, style functions, event API, resize, destroy
- [cytoscape npm page](https://www.npmjs.com/package/cytoscape) — version 3.33.1 confirmed current
- [cytoscape-fcose GitHub](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose) — v2.2.0, registration pattern, layout options
- [Cytoscape.js 3.31.0 release blog](https://blog.js.cytoscape.org/2025/01/13/3.31.0-release/) — TypeScript first-party support confirmed

### Secondary (MEDIUM confidence)
- [cytoscape-popper GitHub README](https://github.com/cytoscape/cytoscape.js-popper) — tooltip/popper integration pattern (verified, avoided for simplicity)
- [Cytoscape.js layout blog post](https://blog.js.cytoscape.org/2020/05/11/layouts/) — fcose recommendation as "first layout to try" for force-directed
- [cytoscape-fcose npm](https://www.npmjs.com/package/cytoscape-fcose) — 220K weekly downloads, v2.2.0 confirmed

### Tertiary (LOW confidence)
- Svelte 5 + Cytoscape Gist (community example) — initialization pattern matches official docs; not independently verified for Svelte 5 runes specifically

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cytoscape 3.33.1 and fcose 2.2.0 confirmed via npm; TypeScript types built-in confirmed via 3.31.0 release blog
- Architecture: HIGH — all integration points are extensions of existing Phase 20-21 code; patterns directly follow existing repo-store.ts and api.ts conventions
- Pitfalls: HIGH — container height, ResizeObserver, cy.destroy() patterns are documented in official Cytoscape.js docs; hash parsing order pitfall is direct inspection of existing App.svelte code

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (Cytoscape.js has monthly feature releases; fcose is stable/inactive)
