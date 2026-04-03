---
phase: 20-server-skeleton-repo-discovery
plan: 03
subsystem: api
tags: [fastify, svelte, vite, esbuild, nexus, integration, build, smoke-test]

# Dependency graph
requires:
  - phase: 20-server-skeleton-repo-discovery/20-01
    provides: Fastify backend with /api/repos and /api/project/:repoName/stats, esbuild build script
  - phase: 20-server-skeleton-repo-discovery/20-02
    provides: Svelte 5 SPA bundle produced by Vite to dist/nexus/static/

provides:
  - End-to-end verified Nexus server: esbuild backend + Vite SPA working together
  - dist/nexus/main.js with shebang preserved via postbuild:nexus-api script
  - build:nexus convenience script that chains full build → API build → UI build
  - Runtime smoke test: 3 repos discovered, /api/repos returns JSON, / serves SPA (HTTP 200)
  - Human-verified dashboard: dark theme, navbar with repo tabs, stats cards, hash routing, clean shutdown

affects: [phase-21, phase-22, phase-23, phase-24]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - postbuild:nexus-api ensures shebang is prepended and main.js is chmod +x after every esbuild run
    - build:nexus chains npm run build → build:nexus-api → build:nexus-ui ensuring broker/config.js exists before nexus compiles

key-files:
  created: []
  modified:
    - package.json

key-decisions:
  - "postbuild:nexus-api uses grep -q guard so shebang prepend is idempotent — safe to run repeatedly"
  - "build:nexus runs full build first to produce dist/broker/config.js which discover.ts imports at runtime"

patterns-established:
  - "Pattern: build:nexus-api + postbuild:nexus-api = always-correct shebang without manual intervention"

requirements-completed: [NEXUS-01, NEXUS-02, NEXUS-03, NEXUS-04, NEXUS-05, NEXUS-06, NEXUS-07, NEXUS-09, NEXUS-12, NEXUS-13, NEXUS-14]

# Metrics
duration: 5min
completed: 2026-04-01
---

# Phase 20 Plan 03: Build Integration + Visual Verification Summary

**Both build pipelines verified end-to-end: esbuild backend preserves shebang, Vite SPA serves from Fastify, 3 repos discovered, dark dashboard confirmed in browser**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-01T20:00:00Z
- **Completed:** 2026-04-01T20:05:00Z
- **Tasks:** 2
- **Files modified:** 1 (package.json)

## Accomplishments
- Both build targets (esbuild backend, Vite frontend) run cleanly with zero errors
- `postbuild:nexus-api` script ensures shebang (`#!/usr/bin/env node`) is always present and `chmod +x` applied after every backend build
- `build:nexus` convenience script chains full build → API build → UI build, guaranteeing `dist/broker/config.js` exists before nexus backend compiles
- Runtime smoke test passed: server discovers 3 repos, `GET /api/repos` returns JSON array, `GET /` returns HTTP 200 (SPA served)
- Human visual verification passed: dark theme, navbar with repo tabs, stats cards with real data, hash routing between views, clean SIGINT shutdown

## Task Commits

Each task was committed atomically:

1. **Task 1: Build both targets and fix any issues** - `69fc32b` (feat)
2. **Task 2: Visual verification of Nexus dashboard** - human checkpoint (no code commit)

**Plan metadata:** (docs commit created below)

## Files Created/Modified
- `package.json` - Added `postbuild:nexus-api` (shebang guard + chmod) and `build:nexus` (full chain) scripts

## Decisions Made
- `postbuild:nexus-api` uses `grep -q` guard: shebang prepend is idempotent, safe to call on every build
- `build:nexus` runs `npm run build` first so `dist/broker/config.js` exists before nexus backend is compiled — avoids cross-directory import errors at runtime

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 20 complete: Nexus server starts with `npm run nexus` or `node dist/nexus/main.js`
- `build:nexus` script gives a single command to rebuild everything from scratch
- Phase 21 can add file tree panel inside Project.svelte — backend API and SPA scaffold are ready
- Phase 22 can add Cytoscape graph route — hash router and SPA structure are in place
- Phase 23 can flesh out System.svelte stub (broker/token metrics)
- Phase 24 can flesh out Settings.svelte stub (repo management)

---
*Phase: 20-server-skeleton-repo-discovery*
*Completed: 2026-04-01*

## Self-Check: PASSED

- package.json: FOUND (contains postbuild:nexus-api and build:nexus scripts)
- dist/nexus/main.js: FOUND
- dist/nexus/static/index.html: FOUND
- Commit 69fc32b (Task 1): FOUND
