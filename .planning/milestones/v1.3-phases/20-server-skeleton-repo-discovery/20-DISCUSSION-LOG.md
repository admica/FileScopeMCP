# Phase 20: Server Skeleton + Repo Discovery - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 20-server-skeleton-repo-discovery
**Areas discussed:** Tech stack, graph library, styling, config naming, discovery scope, shell page, dark mode, routing, graph in Phase 20

---

## Tech Stack (pre-discussion pivot)

User initiated a tech stack rethink before gray area selection. Original plan used htmx + vanilla JS + D3. User's vision: "modern cutting edge webapp feel", interactive 2D map as primary UI, hover interactions on nodes and edges, "has to look pretty."

Four options presented:
| Option | Description | Selected |
|--------|-------------|----------|
| Option A: Vanilla JS + D3 | Current plan evolved. Full control, no framework. | |
| Option B: Vanilla JS + Cytoscape | Purpose-built graph lib, no framework. | |
| Option C: React + React Flow | Gold standard node-based UI. Requires React. | |
| Option D: Svelte + D3/Cytoscape | Svelte compiles away, near-zero runtime. Modern reactive UI. | ✓ |

**User's choice:** Option D — Svelte + D3 or Cytoscape
**Notes:** User wanted modern feel without heavy framework runtime.

---

## Graph Library

| Option | Description | Selected |
|--------|-------------|----------|
| Cytoscape.js (Recommended) | Graph interactions built-in, CSS-like styling | |
| D3.js | Total creative freedom, more hand-coding | |
| Cytoscape + D3 hybrid | Cytoscape for map, D3 for charts/sparklines | ✓ |

**User's choice:** Cytoscape + D3 hybrid
**Notes:** None

## Styling

| Option | Description | Selected |
|--------|-------------|----------|
| Tailwind CSS (Recommended) | Utility-first, fast iteration, modern look | ✓ |
| Plain CSS (Svelte scoped) | No dependency, full control, slower polish | |

**User's choice:** Tailwind CSS
**Notes:** None

## Config Naming

| Option | Description | Selected |
|--------|-------------|----------|
| nexus.json (Recommended) | Consistent with broker.json naming | ✓ |
| Keep dashboard.json | Describes function not product name | |

**User's choice:** nexus.json
**Notes:** None

## Auto-Discovery Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Scan 2 levels deep (Recommended) | ~/\*/ and ~/\*/\*/ — catches ~/projects/foo | ✓ |
| Immediate children only | Only ~/foo/ — simplest | |
| Configurable depth | Default 2, --scan-depth N flag | |

**User's choice:** Scan 2 levels deep
**Notes:** None

## Shell Page Content

| Option | Description | Selected |
|--------|-------------|----------|
| Stats summary card (Recommended) | Aggregate stats from data.db per repo | ✓ |
| Raw file list table | Simple HTML table, placeholder | |
| Just a placeholder | "Coming soon" message | |

**User's choice:** Stats summary card
**Notes:** None

## Dark Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Dark mode only (Recommended) | One theme, dark. Developer dashboard. | ✓ |
| Dark default + light toggle | Ship dark, add toggle | |
| Light default | Standard light, dark deferred | |

**User's choice:** Dark mode only
**Notes:** None

## Client-Side Routing

| Option | Description | Selected |
|--------|-------------|----------|
| Hash router (Recommended) | /#/project/wtfij — no server config needed | ✓ |
| History API router | Clean URLs, requires Fastify catch-all | |
| No router | Conditional rendering, no URL support | |

**User's choice:** Hash router
**Notes:** None

## Graph Libraries in Phase 20

| Option | Description | Selected |
|--------|-------------|----------|
| Skeleton only (Recommended) | Defer Cytoscape/D3 install to Phase 22 | ✓ |
| Install + placeholder | Install early, empty container | |

**User's choice:** Skeleton only
**Notes:** None

---

## Claude's Discretion

- Svelte component file structure
- Fastify plugin organization
- Exact Tailwind dark theme palette
- Hash router implementation choice
- Vite proxy configuration

## Deferred Ideas

None — discussion stayed within phase scope.
