---
phase: 24-polish
plan: 03
subsystem: ui
tags: [svelte5, fastify, settings, blacklist, repo-management]

# Dependency graph
requires:
  - phase: 24-02
    provides: fetchRepos, RepoListItem, and repo list API already in place
provides:
  - DELETE /api/repos/:repoName -- blacklists a repo, closes DB, writes nexus.json
  - GET /api/repos/blacklist -- returns blacklisted repo paths with derived names
  - POST /api/repos/:repoName/restore -- removes from blacklist, re-opens DB
  - Settings page with active repos table and blacklist section
  - Startup blacklist filtering in main.ts
affects:
  - nexus-ui
  - nexus-api

# Tech tracking
tech-stack:
  added: []
  patterns:
    - GET /api/repos/blacklist registered before DELETE /api/repos/:repoName to avoid Fastify param collision
    - onRefresh callback prop pattern: Settings mutates data, calls back into App to sync navbar state

key-files:
  created: []
  modified:
    - src/nexus/discover.ts
    - src/nexus/repo-store.ts
    - src/nexus/server.ts
    - src/nexus/main.ts
    - src/nexus/ui/lib/api.ts
    - src/nexus/ui/routes/Settings.svelte
    - src/nexus/ui/App.svelte

key-decisions:
  - "GET /api/repos/blacklist registered before /:repoName DELETE -- Fastify is order-sensitive; blacklist literal must precede the param route"
  - "onRefresh callback prop from App.svelte to Settings -- avoids lifting all state; App re-fetches repos so navbar tabs update immediately on remove/restore"
  - "blacklist stored as array of path strings in nexus.json -- minimal schema change, names are derived from path at read time"

patterns-established:
  - "Blacklist route ordering: always register /api/repos/blacklist before /api/repos/:repoName"

requirements-completed: [NEXUS-34]

# Metrics
duration: 2min
completed: 2026-04-03
---

# Phase 24 Plan 03: Settings Page -- Repo Remove/Blacklist/Restore Summary

**Repo management settings page with DELETE/restore API, nexus.json blacklist persistence, and immediate navbar tab updates on remove/restore**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-03T15:10:40Z
- **Completed:** 2026-04-03T15:13:18Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Backend: NexusRegistry extended with optional blacklist field; removeRepo() closes DB and removes from in-memory map
- Three new API routes: GET /api/repos/blacklist, DELETE /api/repos/:repoName, POST /api/repos/:repoName/restore
- Startup filtering: blacklisted repos skipped when opening DB connections in main.ts
- Frontend: Settings page rewritten with Active Repositories table (Remove button, confirm dialog) and Blacklisted Repositories section (Restore button, always visible)
- App.svelte passes onRefresh callback so navbar tabs disappear/reappear immediately after mutations

## Task Commits

Each task was committed atomically:

1. **Task 1: Backend -- blacklist schema, repo remove/restore functions, API routes** - `8fd2510` (feat)
2. **Task 2: Frontend -- Settings page with repo table and blacklist management** - `27c6392` (feat)

**Plan metadata:** (docs commit to follow)

## Files Created/Modified
- `src/nexus/discover.ts` - Extended NexusRegistry with `blacklist?: string[]`
- `src/nexus/repo-store.ts` - Added removeRepo() function
- `src/nexus/server.ts` - Added GET /api/repos/blacklist, DELETE /api/repos/:repoName, POST /api/repos/:repoName/restore; imports readRegistry/writeRegistry/removeRepo/openRepo
- `src/nexus/main.ts` - Blacklist filtering during startup repo loop
- `src/nexus/ui/lib/api.ts` - BlacklistEntry type, fetchBlacklist, removeRepoApi, restoreRepoApi
- `src/nexus/ui/routes/Settings.svelte` - Full rewrite with active repos table and blacklist section
- `src/nexus/ui/App.svelte` - Pass onRefresh callback to Settings

## Decisions Made
- GET /api/repos/blacklist registered before DELETE /api/repos/:repoName -- Fastify is order-sensitive, so the literal route must come first to avoid `blacklist` being matched as a repoName parameter
- onRefresh callback prop from App.svelte to Settings -- Settings calls back into App after each mutation so the top-level repos state (which drives navbar tabs) is updated immediately without a page reload
- blacklist stored as array of path strings in nexus.json -- minimal schema change; names are derived from `path.split('/').pop()` at read time, avoiding stale name state

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 24 (polish) is now complete -- all 3 plans executed
- Settings page provides repo lifecycle management: auto-discovery adds repos, Settings removes/restores them
- Blacklist persists in nexus.json and survives server restarts

---
*Phase: 24-polish*
*Completed: 2026-04-03*
