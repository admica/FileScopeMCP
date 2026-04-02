---
phase: 21-file-tree-detail-panel
plan: 01
subsystem: api
tags: [fastify, better-sqlite3, typescript, nexus, sqlite, svelte]

# Dependency graph
requires:
  - phase: 20-server-skeleton-repo-discovery
    provides: Fastify server factory, repo-store pattern, api.ts fetch wrapper pattern
provides:
  - getTreeEntries, getFileDetail, getDirDetail query functions in repo-store.ts
  - Four new Fastify API routes: GET /api/project/:repoName/tree, /tree/*, /file/*, /dir/*
  - TypeScript types and fetch wrappers in api.ts for all three new endpoints
affects: [21-02-file-tree-detail-panel, future Svelte components consuming tree/file/dir data]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "better-sqlite3 prepare().all()/.get() query pattern extended to three new query shapes"
    - "Fastify wildcard params via req.params['*'] for file path segments containing slashes"
    - "Non-wildcard route registered before wildcard for same path prefix (Fastify order-sensitive)"

key-files:
  created: []
  modified:
    - src/nexus/repo-store.ts
    - src/nexus/server.ts
    - src/nexus/ui/lib/api.ts

key-decisions:
  - "Wildcard routes (/tree/*, /file/*, /dir/*) use req.params['*'] — file paths with slashes remain unencoded, as encoding would break wildcard matching"
  - "Separate root /tree route registered before /tree/* wildcard — Fastify v5 is order-sensitive"
  - "getDirDetail uses path LIKE ? with dirPath/% to include all descendants, not just direct children"
  - "getTreeEntries uses two-param LIKE query (path LIKE X AND path NOT LIKE X/%) to restrict to direct children only"

patterns-established:
  - "Query function returns plain object with camelCase keys; SQLite snake_case column names mapped in function body"
  - "JSON blob columns (concepts, change_impact, exports_snapshot) wrapped in try/catch safeParse helper returning null on failure"
  - "Boolean conversion: Boolean(r.is_directory) pattern wraps SQLite integer 0/1 booleans"

requirements-completed: [NEXUS-15, NEXUS-16, NEXUS-18]

# Metrics
duration: 2min
completed: 2026-04-02
---

# Phase 21 Plan 01: Tree + File + Dir API Endpoints Summary

**Three SQLite query functions and four Fastify routes provide file-tree browsing and detail data for the Nexus dashboard frontend**

## Performance

- **Duration:** 2 min
- **Started:** 2026-04-02T03:36:49Z
- **Completed:** 2026-04-02T03:38:58Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `getTreeEntries`, `getFileDetail`, `getDirDetail` to repo-store.ts following the existing `getRepoStats` query pattern
- Registered four new Fastify routes in server.ts: tree root, tree wildcard, file wildcard, dir wildcard — in correct order for Fastify v5
- Added full TypeScript types (TreeEntry, TreeResponse, FileDetail, DirDetail, ConceptsResult, ChangeImpactResult, ExportSnapshot, ExportedSymbol) and three fetch wrappers to api.ts
- `npm run build:nexus` passes with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Add SQLite query functions to repo-store.ts** - `26abbc5` (feat)
2. **Task 2: Add API routes to server.ts and fetch wrappers to api.ts** - `4b44d79` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `src/nexus/repo-store.ts` - Added getTreeEntries, getFileDetail, getDirDetail query functions plus TreeEntryRow type
- `src/nexus/server.ts` - Updated import, added 4 new Fastify routes for tree/file/dir endpoints
- `src/nexus/ui/lib/api.ts` - Added 8 TypeScript type exports and 3 fetch wrapper functions

## Decisions Made

- Wildcard routes use `req.params['*']` to capture path segments with slashes unencoded — encoding would break wildcard route matching in Fastify
- Non-wildcard `/tree` registered before wildcard `/tree/*` — Fastify v5 matches routes in registration order
- `getDirDetail` queries all descendants via `path LIKE '${dirPath}/%'` (recursive), while `getTreeEntries` additionally uses `path NOT LIKE '${dirPath}/%/%'` to restrict to direct children only

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three API endpoints are ready for consumption by Phase 21 Plan 02 Svelte components
- `fetchTree`, `fetchFileDetail`, `fetchDirDetail` typed wrappers ready to import in Svelte components
- Build system verified working end-to-end

---
*Phase: 21-file-tree-detail-panel*
*Completed: 2026-04-02*
