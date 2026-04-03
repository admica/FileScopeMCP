---
phase: 20-server-skeleton-repo-discovery
plan: 01
subsystem: api
tags: [fastify, svelte, vite, tailwindcss, better-sqlite3, nexus, http-server]

# Dependency graph
requires:
  - phase: 16-18-broker
    provides: FILESCOPE_DIR constant from src/broker/config.ts
  - phase: db-foundation
    provides: better-sqlite3 createRequire pattern from src/db/db.ts
provides:
  - Fastify HTTP server with /api/repos and /api/project/:repoName/stats endpoints
  - nexus.json registry read/write with 2-level home directory repo auto-discovery
  - Per-repo read-only better-sqlite3 connection pool with offline recheck
  - CLI entry point with --port/--host args and graceful SIGTERM/SIGINT shutdown
  - build:nexus-api esbuild script producing dist/nexus/*.js
affects: [20-02-svelte-ui, 20-03-integration]

# Tech tracking
tech-stack:
  added: [fastify@5, "@fastify/static@9", svelte@5, vite@8, tailwindcss@4, "@tailwindcss/vite@4", "@sveltejs/vite-plugin-svelte@7"]
  patterns:
    - Read-only better-sqlite3 via createRequire (matches src/db/db.ts pattern)
    - Fastify factory function pattern (createServer returns configured instance, caller calls listen)
    - nexus.json as persistent repo registry in ~/.filescope/

key-files:
  created:
    - src/nexus/discover.ts
    - src/nexus/repo-store.ts
    - src/nexus/server.ts
    - src/nexus/main.ts
  modified:
    - package.json

key-decisions:
  - "Read-only DB connections: no journal_mode pragma — WAL already set by MCP writer"
  - "32MB cache_size pragma on read-only connections for query performance"
  - "recheckInterval.unref() — periodic 60s recheck doesn't keep process alive alone"
  - "staticDir resolved relative to __dirname so it works from any cwd"

patterns-established:
  - "Pattern: Fastify factory — createServer() returns configured instance, main.ts calls listen()"
  - "Pattern: nexus.json absent = auto-discover; present = use as-is (offline repos tracked, not removed)"
  - "Pattern: read-only better-sqlite3 via createRequire(import.meta.url) matches existing db.ts pattern"

requirements-completed: [NEXUS-01, NEXUS-02, NEXUS-03, NEXUS-04, NEXUS-05, NEXUS-06, NEXUS-07, NEXUS-08, NEXUS-09, NEXUS-10, NEXUS-11, NEXUS-13, NEXUS-14]

# Metrics
duration: 4min
completed: 2026-04-01
---

# Phase 20 Plan 01: Server Skeleton + Repo Discovery Summary

**Fastify HTTP server with nexus.json-based repo discovery, read-only SQLite connections, and JSON API for repo listing and per-repo file stats**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-01T07:00:04Z
- **Completed:** 2026-04-01T07:04:35Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Built complete Nexus backend: 4 TypeScript source files, all compiling cleanly
- Server discovers repos via 2-level home directory glob scan, persists to nexus.json
- Read-only better-sqlite3 connections with 32MB cache, offline repos tracked and rechecked every 60s
- `npm run build:nexus-api` produces dist/nexus/*.js; server starts and discovers repos on first run

## Task Commits

Each task was committed atomically:

1. **Task 1: Install deps, create discover.ts and repo-store.ts** - `44e6e41` (feat)
2. **Task 2: Create server.ts, main.ts, and add build scripts** - `1253574` (feat)

**Plan metadata:** (docs commit, created below)

## Files Created/Modified
- `src/nexus/discover.ts` - NexusRepo/NexusRegistry types, nexus.json read/write, 2-level discoverRepos()
- `src/nexus/repo-store.ts` - Per-repo read-only DB connections, openRepo, getRepos, getDb, closeAll, recheckOffline, getRepoStats
- `src/nexus/server.ts` - Fastify factory with /api/repos and /api/project/:repoName/stats routes
- `src/nexus/main.ts` - CLI entry point: arg parsing, discovery, DB opens, 60s recheck, graceful shutdown
- `package.json` - Added fastify/@fastify/static deps, svelte/vite/tailwind devDeps, build:nexus-api/build:nexus-ui/nexus scripts, filescope-nexus bin field

## Decisions Made
- Read-only better-sqlite3 connections use `cache_size = -32000` but skip `journal_mode` — WAL was set by the MCP writer, read-only connections cannot change journal mode
- Fastify factory pattern: `createServer()` returns the configured instance, `main.ts` calls `server.listen()` — keeps server creation testable
- `recheckInterval.unref()` prevents the 60s interval from keeping the process alive when everything else exits

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed fs.promises.glob AsyncIterator spread**
- **Found during:** Task 1 (discover.ts)
- **Issue:** `fs.promises.glob()` returns `AsyncIterator<string>` not a plain array — TypeScript TS2488 error when using spread `[...level1, ...level2]`
- **Fix:** Replaced spread with `for await` loops to collect results into plain arrays before merging
- **Files modified:** src/nexus/discover.ts
- **Verification:** `npx tsc --noEmit` passes with no errors
- **Committed in:** 44e6e41 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** TypeScript correctness fix — no scope creep.

## Issues Encountered
- `node dist/nexus/main.js` errors with missing `dist/broker/config.js` if nexus API is built before the main build — resolved by running `npm run build` first. Not a bug; separate build targets are expected to run independently after full build.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Nexus backend complete: server starts, discovers repos, serves JSON API
- Plan 02 (Svelte UI) can now implement the frontend against `/api/repos` and `/api/project/:repoName/stats`
- Static dir (`dist/nexus/static/`) will be populated by Plan 02's Vite build

---
*Phase: 20-server-skeleton-repo-discovery*
*Completed: 2026-04-01*
