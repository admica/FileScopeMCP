---
phase: 20-server-skeleton-repo-discovery
plan: 02
subsystem: ui
tags: [svelte5, vite, tailwindcss, spa, hash-router, dark-mode]

requires:
  - phase: 20-server-skeleton-repo-discovery/20-01
    provides: Fastify API server with /api/repos and /api/project/:repoName/stats endpoints

provides:
  - Svelte 5 SPA bundle compiled to dist/nexus/static/ via Vite
  - Hash router handling /project/:name, /system, /settings, and home routes
  - Navbar with dynamic repo tabs (from /api/repos), System tab, and Settings gear
  - StatsCard component showing 5 aggregate metrics per repo
  - Project route that fetches and displays per-repo stats
  - System and Settings stub routes with future-phase references
  - Dev workflow: vite dev server on :5173 with /api proxy to Fastify :1234

affects:
  - 20-03 (package.json scripts already present, build output ready for nexus main.ts integration)
  - Phase 21 (file tree panel will be added inside Project.svelte)
  - Phase 22 (Cytoscape graph will be added as a new route or panel)
  - Phase 23 (System.svelte stub ready for broker/token UI)
  - Phase 24 (Settings.svelte stub ready for repo management UI)

tech-stack:
  added:
    - svelte 5.55.1 (devDependency — compiles away at build time)
    - "@sveltejs/vite-plugin-svelte" ^7.0.0 (devDependency)
    - vite ^8.0.3 (devDependency)
    - tailwindcss ^4.2.2 (devDependency)
    - "@tailwindcss/vite" ^4.2.2 (devDependency)
  patterns:
    - Svelte 5 runes exclusively — $state(), $derived.by(), $effect(), $props()
    - Tailwind v4 via @import "tailwindcss" in app.css, no tailwind.config.js needed
    - Dark-mode-only via :root CSS custom properties (no dark: prefix, no toggle)
    - Hand-rolled hash router using hashchange event + $state + $derived.by
    - Vite root at src/nexus/ui, outDir ../../../dist/nexus/static (3 levels up)

key-files:
  created:
    - src/nexus/ui/vite.config.ts
    - src/nexus/ui/svelte.config.js
    - src/nexus/ui/index.html
    - src/nexus/ui/app.css
    - src/nexus/ui/main.ts
    - src/nexus/ui/App.svelte
    - src/nexus/ui/lib/api.ts
    - src/nexus/ui/lib/stores.ts
    - src/nexus/ui/components/Navbar.svelte
    - src/nexus/ui/components/StatsCard.svelte
    - src/nexus/ui/routes/Project.svelte
    - src/nexus/ui/routes/System.svelte
    - src/nexus/ui/routes/Settings.svelte
  modified: []

key-decisions:
  - "Hand-rolled hash router — 3 routes, no nested routing, svelte-spa-router not needed"
  - "lib/stores.ts is a plain mutable module — components own $state() reactivity, no svelte.ts rune file needed at this scale"
  - "Dark-mode-only via :root CSS custom properties — cleaner than dark: prefix for a no-toggle dashboard"

patterns-established:
  - "Svelte 5 rune-only pattern: $props() not export let, $state()/$effect()/$derived.by() throughout"
  - "Tailwind v4 zero-config: single @import tailwindcss in app.css, Vite plugin in vite.config.ts"
  - "Vite root co-located with SPA source (src/nexus/ui/), outDir uses relative path to reach project root"

requirements-completed:
  - NEXUS-12
  - NEXUS-13

duration: 3min
completed: 2026-04-01
---

# Phase 20 Plan 02: Server Skeleton Repo Discovery Summary

**Svelte 5 SPA with Vite + Tailwind v4, hash router, dynamic repo navbar, and per-repo stats card — Vite build produces dist/nexus/static/ in 213ms**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-01T19:47:47Z
- **Completed:** 2026-04-01T19:50:28Z
- **Tasks:** 2
- **Files modified:** 13 created, 0 modified

## Accomplishments
- Complete Svelte 5 SPA scaffold: vite.config.ts, index.html, app.css, main.ts, App.svelte — all using Svelte 5 runes exclusively
- Hand-rolled hash router in App.svelte using $state + $derived.by + hashchange event — handles /project/:name, /system, /settings, home
- Navbar with dynamic repo tabs (populated from /api/repos fetch), active tab highlighting via border-blue-500, offline indicator
- StatsCard component showing 5 metrics in a responsive grid: total files, % summarized, % with concepts, stale count, local deps
- Vite build verified: dist/nexus/static/index.html + assets/index-*.js + assets/index-*.css produced cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Vite + Tailwind + Svelte scaffold with entry point and hash router** - `4008403` (feat)
2. **Task 2: Navbar, StatsCard, and route components** - `decf237` (feat)

**Plan metadata:** (to be added in final commit)

## Files Created/Modified
- `src/nexus/ui/vite.config.ts` - Vite config: svelte() + tailwindcss() plugins, root src/nexus/ui, outDir dist/nexus/static, /api proxy to :1234
- `src/nexus/ui/svelte.config.js` - Svelte preprocessor for TypeScript in script blocks
- `src/nexus/ui/index.html` - SPA HTML shell: class="dark" on html, bg-gray-950 on body, mounts main.ts
- `src/nexus/ui/app.css` - @import tailwindcss + dark theme CSS custom properties + monospace font
- `src/nexus/ui/main.ts` - Svelte 5 mount() to #app element, imports app.css
- `src/nexus/ui/App.svelte` - Root component: hash router, fetchRepos on load, renders route components
- `src/nexus/ui/lib/api.ts` - fetchRepos() and fetchProjectStats() with typed RepoListItem/RepoStats responses
- `src/nexus/ui/lib/stores.ts` - Shared mutable state holder for repos list
- `src/nexus/ui/components/Navbar.svelte` - Top nav: dynamic repo tabs, System, Settings gear, active highlighting
- `src/nexus/ui/components/StatsCard.svelte` - 5-metric stats grid card using $props()
- `src/nexus/ui/routes/Project.svelte` - Per-repo view: $effect fetches stats, renders StatsCard
- `src/nexus/ui/routes/System.svelte` - Stub: references Phase 23
- `src/nexus/ui/routes/Settings.svelte` - Stub: references Phase 24

## Decisions Made
- Hand-rolled hash router over svelte-spa-router — 3 routes is simple enough, saves a dependency
- lib/stores.ts as plain mutable module — components own their $state(), no need for a .svelte.ts rune file
- CSS custom properties for dark theme — dark-mode-only dashboard has no use for dark: prefix variants

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SPA builds to dist/nexus/static/ — ready for Fastify to serve via @fastify/static (Plan 01 already handles this)
- Project.svelte has placeholder for Phase 21 file tree panel
- System.svelte and Settings.svelte stubs reference their future phases (23 and 24)
- Dev workflow: `npm run dev:nexus-ui` starts Vite on :5173 with /api proxy; `npm run build:nexus-ui` produces production bundle

---
*Phase: 20-server-skeleton-repo-discovery*
*Completed: 2026-04-01*

## Self-Check: PASSED

- All 13 source files: FOUND
- Commit 4008403 (Task 1): FOUND
- Commit decf237 (Task 2): FOUND
- dist/nexus/static/index.html: FOUND
- dist/nexus/static/assets/*.js and *.css: FOUND
