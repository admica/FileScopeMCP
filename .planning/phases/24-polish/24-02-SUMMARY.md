---
phase: 24-polish
plan: 02
subsystem: ui
tags: [svelte, fastify, sqlite, nexus, sse, tailwind]

# Dependency graph
requires:
  - phase: 23-system-view-live-activity
    provides: Nexus server with /api/repos and Svelte SPA navbar
provides:
  - Colored status dots on navbar repo tabs (green/orange/gray)
  - Extended /api/repos response with staleCount and dbMtimeMs fields
  - getStaleCount() function in repo-store.ts
  - 30s periodic polling for live dot status updates
affects: [24-polish, nexus-ui, nexus-api]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Derive UI dot color from two API fields: dbMtimeMs (recency) and staleCount (pending work)"
    - "Polling with cancelled flag + clearInterval for leak-free Svelte $effect cleanup"

key-files:
  created: []
  modified:
    - src/nexus/repo-store.ts
    - src/nexus/server.ts
    - src/nexus/ui/lib/api.ts
    - src/nexus/ui/components/Navbar.svelte
    - src/nexus/ui/App.svelte

key-decisions:
  - "5-minute window for 'recent activity' detection via data.db mtime — simple and sufficient"
  - "Orange dot when staleCount > 0 but not recent — signals work queued without false-green"

patterns-established:
  - "Status dot logic: online check first, then recency (green), then stale (orange), then gray"

requirements-completed: [NEXUS-33]

# Metrics
duration: 10min
completed: 2026-04-03
---

# Phase 24 Plan 02: Navbar Repo Status Dots Summary

**Colored status dots on Nexus navbar repo tabs derived from data.db mtime (green) and stale file count (orange/gray), refreshed every 30 seconds**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-04-03T14:55:00Z
- **Completed:** 2026-04-03T15:05:32Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added `getStaleCount()` to repo-store.ts — counts files with any stale metadata field via a single SQL query
- Extended `/api/repos` response to include `staleCount` and `dbMtimeMs` per repo (reads data.db mtime via `fs.statSync`)
- Updated `RepoListItem` type in api.ts with the two new fields
- Added `dotColor()` function to Navbar.svelte — green if dbMtimeMs within 5 min, orange if staleCount > 0, gray otherwise
- Replaced one-shot fetchRepos effect in App.svelte with a 30s polling loop with `cancelled` flag and `clearInterval` cleanup

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend backend /api/repos with staleCount and dbMtimeMs** - `d16e625` (feat)
2. **Task 2: Add status dots to Navbar tabs and periodic repo polling** - `d048659` (feat)

## Files Created/Modified
- `src/nexus/repo-store.ts` - Added `getStaleCount()` function; updated module comment exports list
- `src/nexus/server.ts` - Added `node:path` import; included `getStaleCount` in repo-store import; extended `/api/repos` handler
- `src/nexus/ui/lib/api.ts` - Extended `RepoListItem` type with `staleCount` and `dbMtimeMs` fields
- `src/nexus/ui/components/Navbar.svelte` - Added `dotColor()` function and colored dot `<span>` in repo tabs; added `flex items-center gap-1.5` classes
- `src/nexus/ui/App.svelte` - Replaced one-shot repos load with 30s polling interval and cleanup

## Decisions Made
- 5-minute threshold for "recent" data.db mtime — intuitive window matching typical MCP activity burst patterns
- Orange dot when staleCount > 0 but not recent — correctly distinguishes active-and-processing (green) from queued-but-idle (orange)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None - `npm run build:nexus-ui` succeeded first try. Pre-existing Svelte warnings from DependencyGraph.svelte and ActivityFeed.svelte are unrelated to this plan's changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Navbar status dots are fully functional; ready for plan 24-03
- build:nexus-ui passes cleanly for deployment

## Self-Check

- [x] `getStaleCount` in repo-store.ts: FOUND
- [x] `staleCount` in server.ts: FOUND
- [x] `dbMtimeMs` in api.ts: FOUND
- [x] `dotColor` in Navbar.svelte: FOUND
- [x] `setInterval` in App.svelte: FOUND
- [x] Commit d16e625: FOUND
- [x] Commit d048659: FOUND

## Self-Check: PASSED

---
*Phase: 24-polish*
*Completed: 2026-04-03*
