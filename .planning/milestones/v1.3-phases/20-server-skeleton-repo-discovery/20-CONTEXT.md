# Phase 20: Server Skeleton + Repo Discovery - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Running `filescope-nexus` starts a Fastify HTTP server that discovers all FileScopeMCP repos, opens their databases read-only, serves a Svelte SPA with per-repo tabs, and provides JSON API endpoints. This phase delivers the foundation — no file tree, no graph, no live activity. Just the server, the shell, and a per-repo stats summary card.

</domain>

<decisions>
## Implementation Decisions

### Tech Stack (applies to ALL Nexus phases, not just Phase 20)
- **D-01:** Frontend framework is **Svelte 5** (runes: `$state()`, `$derived()`, `$effect()`), compiled as a client-side SPA. No SvelteKit — plain Svelte with Vite.
- **D-02:** Graph visualization uses **Cytoscape.js** for the main dependency map (Phase 22) and **D3.js** for auxiliary charts/sparklines (Phase 23). Neither is installed in Phase 20.
- **D-03:** Styling via **Tailwind CSS** with Vite plugin integration. **Dark mode only** — no light theme, no toggle. Developer dashboard aesthetic.
- **D-04:** Backend is **Fastify** serving JSON API endpoints + static files. No server-rendered HTML partials — Fastify is a pure API server.
- **D-05:** Build pipeline: **Vite** compiles Svelte SPA to `dist/nexus/static/`. **esbuild** compiles Fastify server to `dist/nexus/main.js`. Two separate build commands.

### Client-Side Routing
- **D-06:** **Hash router** (`/#/project/wtfij`, `/#/system`, `/#/settings`). No server-side catch-all needed. Fastify serves `index.html` at `/`, Svelte handles routing from there.

### Dev Workflow
- **D-07:** Development uses two processes: Vite dev server (port 5173) with HMR for Svelte, Fastify (port 1234) for the API. Vite proxies `/api/*` requests to Fastify. Production: Fastify serves the Vite-built bundle from `dist/nexus/static/`.

### Registry & Discovery
- **D-08:** Registry file renamed to **`~/.filescope/nexus.json`** (not dashboard.json). Consistent with broker.json naming.
- **D-09:** Auto-discovery scans **2 levels deep** from home: `~/*/` and `~/*/*/` for `.filescope/data.db`. Catches `~/projects/foo` without recursive explosion. Results written to nexus.json on first discovery.

### Shell Page (Phase 20 deliverable)
- **D-10:** Each project tab shows a **stats summary card** from data.db: total files, % summarized, % with concepts, stale count, total dependencies. Useful from day one — no placeholder pages.

### Database Access
- **D-11:** Read-only `better-sqlite3` with WAL mode, re-query per request (~1ms sync reads), no caching. Long-lived connections closed on shutdown.

### CLI Entry Point
- **D-12:** `filescope-nexus` via package.json `bin` field. Default `0.0.0.0:1234`, override with `--port` and `--host` flags. CLI args parsed from `process.argv` (no dependency).

### New Dependencies (Phase 20)
- **D-13:** Runtime: `fastify`. Build/dev: `svelte`, `@sveltejs/vite-plugin-svelte`, `vite`, `tailwindcss`, `@tailwindcss/vite`. Cytoscape and D3 deferred to Phases 22-23.

### Claude's Discretion
- Svelte component file structure within `src/nexus/ui/`
- Fastify plugin organization
- Exact Tailwind color palette for dark theme
- Hash router implementation (lightweight library vs hand-rolled)
- Vite proxy configuration specifics

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Nexus Design
- `NEXUS-PLAN.md` — Full architecture document. Note: tech stack section is being updated to reflect Svelte/Cytoscape/Tailwind decisions from this context. Read for: repo discovery logic, data access patterns, API endpoints, lifecycle, edge cases.

### Database Schema & Access
- `src/db/schema.ts` — SQLite table definitions (files, file_dependencies). Needed for: stats queries, understanding what data is available.
- `src/db/repository.ts` — CRUD API the Nexus should NOT use directly (it opens DBs read-only with raw better-sqlite3, not through the repository layer).
- `src/db/db.ts` — How WAL mode and pragmas are set. Reference for read-only DB opening pattern.

### Broker IPC (for System View in later phases)
- `src/broker/types.ts` — Wire protocol messages (StatusResponse fields). Needed for: understanding what broker status data is available.
- `src/broker/stats.ts` — stats.json format and path. Needed for: token usage display.
- `src/broker/config.ts` — Global paths (SOCK_PATH, PID_PATH, LOG_PATH). Needed for: where to find broker.sock, broker.log.

### LLM Result Types (for detail panel rendering in Phase 21)
- `src/llm/types.ts` — ConceptsResult, ChangeImpactResult structures. Needed for: rendering file metadata.
- `src/change-detector/types.ts` — ExportSnapshot structure. Needed for: rendering exports.

### Existing Build System
- `package.json` — Current esbuild build command (line 8). Nexus build commands must coexist with existing MCP server and broker builds.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `better-sqlite3` already in dependencies — Nexus reuses it for read-only DB access
- `src/broker/config.ts` exports `SOCK_PATH`, `PID_PATH`, `LOG_PATH`, `STATS_PATH` — Nexus imports these constants directly
- `src/broker/stats.ts` has `readStats()` — could be imported for token display, or Nexus reads stats.json directly

### Established Patterns
- esbuild builds individual .ts files to dist/ (not bundled) — Nexus backend follows same pattern
- ESM throughout (`"type": "module"`, `.js` extension imports) — Nexus backend must be ESM
- better-sqlite3 loaded via `createRequire` (CJS addon in ESM project) — `src/db/db.ts` line ~20 shows the pattern
- Global paths in `~/.filescope/` — Nexus adds `nexus.json` alongside existing `broker.json`, `stats.json`

### Integration Points
- `package.json` scripts and bin field — add `nexus`, `build:nexus-api`, `build:nexus-ui`
- `~/.filescope/` directory — add nexus.json
- `dist/` output directory — add `dist/nexus/` subtree

</code_context>

<specifics>
## Specific Ideas

- User wants "modern cutting edge webapp feel" — not a log viewer, a visual code exploration tool
- The graph/map visualization is the PRIMARY interface, not a side panel
- "It has to look pretty" — dark mode developer dashboard aesthetic, polished UI
- Hover on nodes to see file/dir details, hover on connection lines to see dependency info
- 2D map showing hierarchy, connections, linkages between nodes

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 20-server-skeleton-repo-discovery*
*Context gathered: 2026-04-01*
