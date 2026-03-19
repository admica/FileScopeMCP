# Phase 4: Cascade Engine + Staleness - Verification

**Verified:** 2026-03-19
**Test command:** `npx vitest run src/cascade/cascade-engine.test.ts src/mcp-server.test.ts`
**Result:** All tests pass (28 tests across 2 test files)

---

## CASC-01: When a file's API surface changes, all direct dependents in the dependency graph have their metadata marked stale

**Status:** VERIFIED
**Evidence:**
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > marks A, B, C all stale and queues 9 LLM jobs when A has dependents B->C chain`
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > marks only the changed file when it has zero dependents`
**Behavior confirmed:** `cascadeStale` traverses the dependency graph via BFS and marks all reachable dependents stale; files with no dependents result in only the root file being marked.

---

## CASC-02: Staleness is tracked per semantic field: summary, concepts, and change_impact each have independent staleSince timestamps

**Status:** VERIFIED
**Evidence:**
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > marks A, B, C all stale and queues 9 LLM jobs when A has dependents B->C chain`
- `src/cascade/cascade-engine.test.ts` -- `markSelfStale > marks only summary and concepts stale (NOT change_impact), queues 2 jobs`
- `src/cascade/cascade-engine.test.ts` -- `upsertFile staleness preservation > does not clobber staleness columns when upsertFile is called after markStale`
**Behavior confirmed:** The three staleness timestamps (`summary_stale_since`, `concepts_stale_since`, `change_impact_stale_since`) are managed independently — `markSelfStale` sets only summary and concepts (body-only changes do not affect impact assessment), while `cascadeStale` sets all three.

---

## CASC-03: MCP query responses include staleness timestamps alongside metadata so LLMs can decide whether to trust the data

**Status:** VERIFIED
**Evidence:**
- `src/mcp-server.test.ts` -- `Staleness injection into MCP response shape > fresh file: no staleness fields appear in get_file_summary response shape`
- `src/mcp-server.test.ts` -- `Staleness injection into MCP response shape > stale file: summaryStale appears in get_file_summary response shape`
- `src/mcp-server.test.ts` -- `Staleness injection into MCP response shape > fully stale file: all three fields appear in get_file_importance response shape`
**Behavior confirmed:** Staleness fields (`summaryStale`, `conceptsStale`, `changeImpactStale`) are conditionally injected into MCP responses — omitted when null (no API contract change for fresh files), included when non-null so LLMs can assess data freshness.

---

## CASC-04: Cascade propagation detects and handles circular dependencies without infinite loops

**Status:** VERIFIED
**Evidence:**
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > terminates with circular deps (A->B->A), visits each file once`
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > stops at depth cap (depth >= 10 is not visited)`
**Behavior confirmed:** BFS traversal uses a visited set to prevent revisiting files in circular dependency chains, and a depth cap of 10 prevents unbounded traversal in deeply nested graphs.

---

## CASC-05: Cascade jobs are queued with priority ordering: interactive queries (tier 1) > file-change cascades (tier 2) > background sweeps (tier 3)

**Status:** VERIFIED (test evidence + code inspection)
**Evidence:**
- `src/cascade/cascade-engine.test.ts` -- `insertLlmJobIfNotPending > inserts a pending job row for the given file+type` (priority_tier=2 for cascade jobs)
- Code inspection: `src/llm/pipeline.test.ts` TEST_CONFIG uses `priority_tier: 1` for interactive queries
- Code inspection: `src/db/repository.ts` `dequeueNextJob` uses `ORDER BY priority_tier ASC` — lower tier number dequeued first
**Behavior confirmed:** Cascade jobs are inserted with `priority_tier=2`; the dequeue query uses ascending sort ensuring tier-1 interactive jobs are always processed before tier-2 cascade jobs.
