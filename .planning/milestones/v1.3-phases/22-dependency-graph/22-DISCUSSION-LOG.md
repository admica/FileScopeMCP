# Phase 22: Dependency Graph - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-02
**Phase:** 22-dependency-graph
**Areas discussed:** Graph library, Node visual encoding, Graph-detail panel interaction, Tree/Graph toggle, Directory filter UI, Graph data endpoint
**Mode:** --auto (Claude selected recommended defaults)

---

## Graph Library Clarification

| Option | Description | Selected |
|--------|-------------|----------|
| Cytoscape.js | Rich graph interaction library (zoom, pan, hover, click, layout algorithms) — Phase 20 D-02 locked this choice | ✓ |
| D3.js force-directed | Lower-level, more customization but more implementation work — referenced in NEXUS-19 text | |

**User's choice:** [auto] Cytoscape.js (prior Phase 20 decision, ROADMAP confirms)
**Notes:** NEXUS-19 references D3.js but this was superseded by the Phase 20 context discussion.

---

## Node Visual Encoding

| Option | Description | Selected |
|--------|-------------|----------|
| Color by top-level directory | Files in same directory get same color — creates natural visual clusters | ✓ |
| Color by file type/extension | .ts = blue, .json = yellow, etc. — too many types for distinct colors | |
| Color by importance tier | Heat map (gray→red) — conflicts with sizing by importance (double-encoding) | |

**User's choice:** [auto] Color by top-level directory (recommended — matches developer mental model)
**Notes:** Importance already encoded in node size, so color encodes a different dimension.

---

## Graph Click Interaction

| Option | Description | Selected |
|--------|-------------|----------|
| Navigate via hash URL | Reuses Phase 21 navigation — click updates URL, detail panel responds automatically | ✓ |
| Graph-specific tooltip/panel | Separate overlay or sidebar within graph view — duplicates detail panel | |

**User's choice:** [auto] Navigate via hash URL (recommended — reuses existing infrastructure)
**Notes:** This means clicking a graph node behaves identically to clicking a file in the tree.

---

## Tree/Graph Toggle Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Left panel toggle (detail stays) | Segmented button switches left panel content, right detail panel always visible | ✓ |
| Graph replaces full viewport | Both panels become the graph canvas — loses detail panel context | |
| Three-way (tree, graph, both) | Adds complexity, unclear layout for "both" mode | |

**User's choice:** [auto] Left panel toggle with detail panel always visible (recommended — preserves established layout)
**Notes:** Graph and tree are alternate views of the same data; detail panel is the constant.

---

## Directory Filter UI

| Option | Description | Selected |
|--------|-------------|----------|
| Dropdown above graph | Lists top-level directories + "All" option — visible, always accessible | ✓ |
| Click tree directory to filter | Requires tree to be visible — but tree is hidden when graph is shown | |
| Type-ahead search | More powerful but higher implementation cost for this phase | |

**User's choice:** [auto] Dropdown above graph (recommended — accessible when graph is visible)
**Notes:** Tree isn't visible when graph mode is active, so tree-based filtering wouldn't work.

---

## Graph Data Endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| New /graph endpoint | Single fetch returns all nodes + edges, frontend handles filtering/layout | ✓ |
| Reuse existing queries | Multiple fetches (tree + per-file deps) — more round-trips, complex client logic | |

**User's choice:** [auto] New /graph endpoint (recommended — single fetch, simpler frontend)
**Notes:** Only local_import dependencies included. Optional ?dir= param for server-side pre-filtering.

---

## Claude's Discretion

- Cytoscape.js layout algorithm (cose, fcose, cola, dagre)
- Color palette for directory-based node coloring
- Tooltip styling and positioning
- Toggle button visual design
- Node min/max sizes
- Edge styling
- Animation timing
- Filter dropdown details

## Deferred Ideas

None — discussion stayed within phase scope.
