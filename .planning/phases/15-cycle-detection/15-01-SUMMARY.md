---
phase: 15-cycle-detection
plan: 01
subsystem: graph-algorithms
tags: [tarjan, scc, cycle-detection, sqlite, vitest, pure-function]

# Dependency graph
requires:
  - phase: 13-streaming-directory-scan
    provides: file_dependencies table with local_import and package_import rows
  - phase: 14-mtime-based-lazy-validation
    provides: repository.ts patterns for raw sqlite prepared statements
provides:
  - iterative Tarjan's SCC implementation as pure TypeScript module (src/cycle-detection.ts)
  - batch edge loader getAllLocalImportEdges() in repository.ts for Plan 02 consumption
affects:
  - 15-02 (MCP tool wiring — uses detectCycles and getAllLocalImportEdges directly)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure function module with no project imports — takes adjacency Map as input, returns string[][]"
    - "Iterative work-stack Tarjan's SCC to avoid JavaScript call stack overflow on deep graphs"
    - "Singleton SCC filtering: keep scc.length > 1 OR self-edge present"
    - "Deterministic sort: paths within group alphabetically, groups by first element"
    - "Batch edge query via getSqlite().prepare().all() for O(1) DB round-trips"

key-files:
  created:
    - src/cycle-detection.ts
    - src/cycle-detection.test.ts
  modified:
    - src/db/repository.ts
    - src/db/repository.test.ts

key-decisions:
  - "iterativeTarjanSCC uses explicit workStack array of {node, neighborIdx} frames — avoids recursion for large graphs"
  - "buildAdjacencyList adds target-only nodes with empty arrays so Tarjan's visits all graph nodes"
  - "detectCycles filters singletons: only keep SCCs where scc.length > 1 OR self-edge exists"
  - "getAllLocalImportEdges placed after getDependents() in repository.ts, grouped with dependency query functions"

patterns-established:
  - "Pattern: pure algorithm module with no project imports — takes typed input, returns typed output"
  - "Pattern: iterative DFS with work stack for graph traversal (avoids JS stack overflow)"
  - "Pattern: repository batch loader for full-graph queries (O(1) vs O(N) per-file calls)"

requirements-completed:
  - CYCL-01

# Metrics
duration: 3min
completed: 2026-03-20
---

# Phase 15 Plan 01: Cycle Detection Core Summary

**Pure iterative Tarjan's SCC algorithm (no recursion, no project imports) plus getAllLocalImportEdges batch loader for Plan 02 wiring**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-20T06:53:54Z
- **Completed:** 2026-03-20T06:56:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Implemented iterative Tarjan's SCC in `src/cycle-detection.ts` as a pure function module with no project imports
- Wrote 16 unit tests covering all behaviors: no edges, linear chain, simple cycle, triangle, self-import, two independent cycles, mixed nodes, singleton filtering, 1000-node stress test, determinism
- Added `getAllLocalImportEdges()` to `repository.ts` using a single prepared statement batch query (excludes package_import rows)
- Added 2 tests for `getAllLocalImportEdges` verifying row count, property types, and package_import exclusion

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement cycle-detection.ts pure functions and unit tests** - `71ba4db` (feat)
2. **Task 2: Add getAllLocalImportEdges batch query to repository.ts** - `9f508ed` (feat)

_Note: Task 1 was TDD — tests written first (RED), then implementation (GREEN), both committed together in one feat commit._

## Files Created/Modified

- `src/cycle-detection.ts` - Pure module: `buildAdjacencyList`, `iterativeTarjanSCC`, `detectCycles`. No project imports. Uses explicit workStack for iterative DFS.
- `src/cycle-detection.test.ts` - 16 vitest tests covering all 10 specified behaviors plus buildAdjacencyList and iterativeTarjanSCC unit tests
- `src/db/repository.ts` - Added `getAllLocalImportEdges()` after `getDependents()`, uses `getSqlite().prepare().all()` with single WHERE clause
- `src/db/repository.test.ts` - Added `getAllLocalImportEdges` import and 2-test describe block

## Decisions Made

- `buildAdjacencyList` adds target-only nodes with empty arrays so Tarjan's visits all graph nodes (targets with no outgoing edges cannot be in cycles, but Tarjan's needs to know about them)
- Singleton SCC filtering logic: `scc.length > 1 || adj.get(node)?.includes(node)` — singletons with no self-edge are not cycles
- Sorting strategy: paths within each group sorted alphabetically, groups sorted by their first element — deterministic across any hash map iteration order

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `detectCycles(edges)` and `buildAdjacencyList(edges)` are ready for Plan 02 MCP tool wiring
- `getAllLocalImportEdges()` is exported from repository.ts for Plan 02's tool handlers to call
- All 33 tests across both files pass

---
*Phase: 15-cycle-detection*
*Completed: 2026-03-20*
