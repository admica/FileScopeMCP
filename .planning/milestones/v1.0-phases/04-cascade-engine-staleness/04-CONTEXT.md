# Phase 4: Cascade Engine + Staleness - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

When a file's API surface changes (detected by Phase 3's SemanticChangeSummary), propagate staleness through the dependency graph to all affected files — with per-field granularity, circular dependency protection, and priority-ordered job queuing. This phase does NOT process LLM jobs (Phase 5) — it only marks files stale and enqueues jobs.

</domain>

<decisions>
## Implementation Decisions

### Cascade Depth and Propagation
- Transitive cascade — not just direct dependents, but dependents-of-dependents
- BFS (breadth-first) walk from the changed file using getDependents() at each hop
- Depth cap of 10 (real TS dependency chains rarely exceed 5-6 hops)
- Visited set terminates cycles (CASC-04) — a file is only processed once per cascade

### Staleness in MCP Responses
- Add optional staleness fields directly to the FileNode response shape (backward compatible)
- Fields present only when non-null: summaryStale, conceptsStale, changeImpactStale (ISO timestamps or ms-since-epoch)
- Null/omitted = fresh; timestamp = stale since that time
- No opt-in flag — always include when stale. LLMs see staleness inline with metadata in a single response

### Job Priority Behavior
- Priority ordering in the queue, no preemption of in-progress jobs
- All 3 staleness fields (summary, concepts, change_impact) marked on cascade dependents — all three reference the changed file's API surface
- Changed file itself also gets all 3 fields marked stale + its own LLM jobs queued at tier 2
- Job deduplication: before inserting a pending job, check for existing pending job with same (file_path, job_type) — skip insert if one exists

### Cascade Trigger Scope
- Change events with affectsDependents=true: primary trigger — cascade to transitive dependents
- File deletion: cascade to dependents (their imports now point to nothing)
- File addition: no cascade (new files have zero dependents)
- Body-only changes (affectsDependents=false): no cascade to dependents, BUT mark the changed file's own summary_stale_since and concepts_stale_since (its summary describes its implementation, which changed)

### Claude's Discretion
- Exact BFS implementation details (queue data structure, batch vs per-node DB writes)
- Whether to batch SQLite staleness writes in a transaction for performance
- Log verbosity and format for cascade events
- Whether CascadeEngine is a class or a set of functions

</decisions>

<specifics>
## Specific Ideas

- The integration point is coordinator.ts:418 where `changeSummary` is currently voided with a Phase 4 placeholder comment
- CascadeEngine should be its own module (src/cascade/ or src/cascade-engine.ts), not inlined into the coordinator
- For file deletion cascade, the staleness mark should happen BEFORE the file is removed from the dependency graph (otherwise getDependents returns nothing)

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getDependents(filePath)` in repository.ts: already queries reverse dependency edges via SQLite index
- `getDependencies(filePath)` in repository.ts: forward edge query
- `insertLlmJob()` in repository.ts: already inserts pending jobs with priority_tier
- `llm_jobs` table in schema.ts: has priority_tier, status, file_path, job_type columns ready
- `SemanticChangeSummary` type in change-detector/types.ts: the input contract with affectsDependents boolean

### Established Patterns
- AsyncMutex in coordinator.ts: all tree mutations serialized through treeMutex.run() — cascade writes must use the same mutex
- Repository module pattern: all SQL hidden behind typed functions in repository.ts — cascade staleness writes should follow this pattern
- Change detection wiring: coordinator.ts handleFileEvent calls changeDetector.classify() then file-utils update — cascade slots in between

### Integration Points
- coordinator.ts:386-437 (handleFileEvent): cascade triggers after changeDetector.classify() and before/after updateFileNodeOnChange
- coordinator.ts:424-427 (unlink case): deletion cascade must run BEFORE removeFileNode
- repository.ts upsertFile(): currently resets staleness to null — needs to preserve existing staleness during normal upserts
- mcp-server.ts tool handlers: responses need staleness fields injected from DB staleness columns
- schema.ts files table: summary_stale_since, concepts_stale_since, change_impact_stale_since columns already exist

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 04-cascade-engine-staleness*
*Context gathered: 2026-03-17*
