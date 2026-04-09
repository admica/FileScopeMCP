# Phase 27: Community Detection - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Group files in the dependency graph into communities using Louvain clustering via graphology. Persist community membership to the `file_communities` SQLite table and expose results through a new `get_communities` MCP tool that identifies communities by their highest-importance file (the representative), not raw integer IDs. Implement dirty-flag cache invalidation so Louvain only recomputes when the graph changes.

This phase adds community detection logic only. No MCP tool changes to existing tools (Phase 28), no new edge types or extraction changes.

</domain>

<decisions>
## Implementation Decisions

### Graph Construction
- **D-01:** Only `local_import` edges feed the Louvain graph. Package imports are external dependencies and don't represent coupling between project files.
- **D-02:** The graph is treated as undirected for clustering purposes. Community detection cares about "these files are coupled," not import direction. Convert directed edges to undirected by adding both directions.
- **D-03:** Edge weights (reference count from Phase 26) are used as Louvain edge weights. More references between files = stronger coupling = more likely to cluster together.
- **D-04:** Edge confidence is ignored for clustering. Both EXTRACTED (1.0) and INFERRED (0.8) edges represent real dependencies. Filtering by confidence would create incomplete communities.

### Module Structure
- **D-05:** New `src/community-detection.ts` module following the `cycle-detection.ts` pattern: pure algorithm module with no imports from other project modules except types. Entry point: `detectCommunities(edges, importances) => CommunityResult[]`.
- **D-06:** Uses `graphology` (graph data structure) + `graphology-communities-louvain` (Louvain algorithm) as npm dependencies. These are well-maintained, TypeScript-friendly, and purpose-built for this.
- **D-07:** The module builds an undirected weighted graphology graph from edge rows, runs Louvain, then maps integer community IDs to representative file paths using importance scores.

### Cache Invalidation
- **D-08:** Module-level `dirty` flag in community-detection.ts (or coordinator). `setEdges()` sets `dirty = true` after writing edges. No per-file tracking — any edge change dirties the entire community cache.
- **D-09:** No minimum change threshold. Any edge write marks dirty. Louvain on a few hundred files runs in <100ms; threshold complexity isn't justified.
- **D-10:** Cached results stored in SQLite (`file_communities` table) and in memory. The dirty flag controls whether to recompute or return cached data.

### Computation Trigger
- **D-11:** Lazy computation on first `get_communities` MCP query. No Louvain at coordinator startup — avoids slowing init for a feature nobody may query.
- **D-12:** On query: check dirty flag. If dirty (or no cached data), run Louvain, persist to `file_communities`, clear flag, return results. If clean, read from `file_communities` table.

### MCP Tool Design
- **D-13:** New `get_communities` MCP tool. No parameters required (returns all communities). Optional `file_path` parameter to filter to a specific file's community.
- **D-14:** Each community in the response contains: `representative` (path of highest-importance file), `members` (array of file paths), `size` (member count).
- **D-15:** When called with `file_path`, returns only the single community containing that file. When called without, returns all communities sorted by size descending.

### Repository Layer
- **D-16:** New repository functions: `setCommunities(communities: CommunityResult[])` to bulk-write community assignments, `getCommunities()` to read all, `getCommunityForFile(path)` to read one file's community.
- **D-17:** `setCommunities()` uses a transaction: DELETE all rows from `file_communities`, then INSERT all new assignments. This is a full replace (Louvain recomputes everything).

### Claude's Discretion
- graphology graph construction details (addNode/addEdge patterns)
- Louvain resolution parameter (default is fine)
- Internal helper function naming
- Test fixture design (graph shapes for testing clustering)
- Whether to add a `community_id` column to the `files` table for faster single-file lookups (optional optimization)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 25/26 Foundation (direct prerequisites)
- `.planning/phases/25-schema-foundation-languageconfig-scaffolding/25-CONTEXT.md` -- Schema decisions including file_communities table
- `.planning/phases/26-multi-language-tree-sitter-extraction/26-CONTEXT.md` -- Edge types, weights, and confidence labels this phase clusters on
- `src/db/schema.ts` -- file_communities table definition (already created in Phase 25)
- `src/db/repository.ts` -- setEdges() function (line 267) where dirty flag integrates

### Graph Algorithm Pattern
- `src/cycle-detection.ts` -- Pure graph algorithm module pattern to follow (buildAdjacencyList, iterativeTarjanSCC, detectCycles)
- `src/cycle-detection.test.ts` -- Test patterns for graph algorithm modules

### MCP Tool Pattern
- `src/mcp-server.ts` lines 392-430 -- detect_cycles and get_cycles_for_file tools (pattern for graph analysis MCP tools)

### Database Layer
- `src/db/schema.ts` lines 49-57 -- file_communities table: community_id (integer), file_path (text), index on community_id
- `src/db/repository.ts` -- Existing CRUD patterns for bulk operations

### Requirements
- `.planning/REQUIREMENTS.md` -- COMM-01 through COMM-04 map to this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `cycle-detection.ts` buildAdjacencyList(): Builds directed adjacency list from edge rows. Community detection needs a similar step but undirected + weighted.
- `detect_cycles` MCP tool: Pattern for graph analysis MCP tools — fetches edges from DB, runs algorithm, formats response.
- `getAllEdges()` / raw SQLite query on file_dependencies: Source of edge data for building the Louvain graph.
- `getAllFiles()` in repository.ts: Source of importance scores for selecting community representatives.

### Established Patterns
- Pure algorithm modules (cycle-detection.ts): No side effects, no imports from project modules, pure functions taking data in and returning results.
- MCP tool registration pattern: `server.tool(name, description, schema, handler)` in mcp-server.ts.
- Better-sqlite3 sync reads: ~1ms per query, no async overhead needed for DB reads.
- Transaction pattern: `getSqlite().transaction(() => { ... })()` for atomic bulk writes.

### Integration Points
- `setEdges()` in repository.ts:267 — Must set dirty flag after edge writes.
- `registerTools()` in mcp-server.ts:163 — Where get_communities tool is registered.
- `coordinator.ts` — May need to expose dirty-flag API or hold the community cache state.

</code_context>

<specifics>
## Specific Ideas

- Edge weights from Phase 26 are specifically designed to feed into community detection — "more references between files = stronger edge for clustering" (Phase 26, D-12 context).
- The `cycle-detection.ts` module is the closest existing pattern: pure graph algorithm, deterministic output, tested with fixture graphs. Follow this pattern.
- Community representatives (highest-importance file per cluster) give communities meaningful names instead of integer IDs — this is a key UX decision from the roadmap.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 27-community-detection*
*Context gathered: 2026-04-09*
