---
phase: 27-community-detection
plan: "01"
subsystem: database
tags: [graphology, louvain, community-detection, sqlite, graph-algorithms]

# Dependency graph
requires:
  - phase: 26-multi-language-tree-sitter-extraction
    provides: enriched edges with weight column in file_dependencies table
provides:
  - Pure detectCommunities() function using Louvain algorithm via graphology
  - CommunityResult interface with communityId, representative, members, size
  - Community dirty flag with isCommunitiesDirty / markCommunitiesDirty / clearCommunitiesDirty
  - getAllLocalImportEdgesWithWeights() for weighted graph construction
  - setCommunities() / getCommunities() / getCommunityForFile() SQLite persistence
  - setEdges() now marks communities dirty on every write
affects: [27-community-detection-02]

# Tech tracking
tech-stack:
  added: [graphology 0.26.0, graphology-communities-louvain 2.0.2, graphology-types 0.24.8]
  patterns:
    - Pure algorithm module pattern (no project imports, data in/results out)
    - Module-level dirty flag for lazy recomputation
    - Atomic full-replace transaction pattern for community persistence

key-files:
  created:
    - src/community-detection.ts
    - src/community-detection.test.ts
  modified:
    - src/db/repository.ts
    - package.json

key-decisions:
  - "graphology-types installed as explicit dependency to satisfy TypeScript peer dependency for AbstractGraph"
  - "Dirty flag placed in repository.ts (not community-detection.ts) — natural home alongside setEdges() writer"
  - "Weight accumulation on parallel edges (A→B and B→A from DB) via hasEdge + setEdgeAttribute pattern"

patterns-established:
  - "Pattern: pure algorithm module with UndirectedGraph + louvain() — follow cycle-detection.ts convention"
  - "Pattern: dirty flag starts true so first MCP query always runs Louvain"

requirements-completed: [COMM-01, COMM-04]

# Metrics
duration: 15min
completed: 2026-04-09
---

# Phase 27 Plan 01: Community Detection Core Summary

**Louvain community detection via graphology with weighted UndirectedGraph, SQLite persistence in file_communities, and dirty-flag cache invalidation wired to setEdges()**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-09T14:54:00Z
- **Completed:** 2026-04-09T14:57:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `src/community-detection.ts`: pure Louvain clustering module that builds a weighted undirected graphology graph, runs Louvain, maps integer IDs to CommunityResult objects with representative selection by importance score
- Added 9 unit tests covering empty guard, disconnected pairs, single component, representative selection, weight influence, structural invariants (no duplicates, sorted members, correct size)
- Extended `src/db/repository.ts` with: dirty flag (starts true), `getAllLocalImportEdgesWithWeights()`, `setCommunities()` / `getCommunities()` / `getCommunityForFile()` for full community CRUD, and `markCommunitiesDirty()` call at end of `setEdges()`

## Task Commits

Each task was committed atomically:

1. **Task 1: Install graphology deps, create community-detection.ts and tests** - `38b69ca` (feat)
2. **Task 2: Add community repository functions and dirty flag to repository.ts** - `06a3ec3` (feat)

## Files Created/Modified
- `src/community-detection.ts` - Pure detectCommunities() function: UndirectedGraph construction, Louvain run, CommunityResult[] mapping
- `src/community-detection.test.ts` - 9 unit tests for clustering correctness, representative selection, structural invariants
- `src/db/repository.ts` - Dirty flag, getAllLocalImportEdgesWithWeights(), setCommunities(), getCommunities(), getCommunityForFile(), markCommunitiesDirty() in setEdges()
- `package.json` - graphology, graphology-communities-louvain, graphology-types added to dependencies; community-detection.ts added to esbuild build script

## Decisions Made
- `graphology-types` installed as explicit dependency — it's a peer dep of `graphology` required for TypeScript compilation of `AbstractGraph` methods (`hasNode`, `addNode`, `hasEdge`, etc.)
- Dirty flag placed in `repository.ts` alongside `setEdges()` rather than in `community-detection.ts` (which is a pure algorithm module with no side effects)
- Weight accumulation pattern chosen for parallel edges: `hasEdge` + `getEdgeAttribute` + `setEdgeAttribute` rather than `mergeEdge` (which would overwrite rather than accumulate)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Installed missing graphology-types peer dependency**
- **Found during:** Task 2 (TypeScript compile verification)
- **Issue:** `graphology` depends on `graphology-types` for `AbstractGraph` type definitions but does not list it as a bundled dependency. TypeScript reported 8 errors on `UndirectedGraph` instance methods (`hasNode`, `addNode`, `hasEdge`, `addEdge`, `getEdgeAttribute`, `setEdgeAttribute`).
- **Fix:** Ran `npm install graphology-types`, which installed version 0.24.8 and added it to `package.json` dependencies.
- **Files modified:** `package.json`
- **Verification:** `npx tsc --noEmit` exits 0 with no errors.
- **Committed in:** `06a3ec3` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required for TypeScript compilation to succeed. No scope creep.

## Issues Encountered
- Worktree `git reset --soft` left working tree files at the old state — required `git checkout HEAD -- src/ .planning/ drizzle/` to restore to the correct HEAD commit before beginning work.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 01 complete: `detectCommunities()`, repository CRUD, and dirty flag are ready
- Plan 02 can wire the `get_communities` MCP tool: check dirty flag → run Louvain → persist → return results
- No blockers

---
*Phase: 27-community-detection*
*Completed: 2026-04-09*
