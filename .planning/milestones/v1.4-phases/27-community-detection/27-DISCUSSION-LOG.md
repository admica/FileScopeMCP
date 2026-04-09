# Phase 27: Community Detection - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-09
**Phase:** 27-community-detection
**Areas discussed:** Graph Construction, Cache Invalidation, MCP Tool Response, Computation Trigger
**Mode:** --auto (all decisions auto-selected)

---

## Graph Construction

| Option | Description | Selected |
|--------|-------------|----------|
| Local imports only, weighted, undirected | Only local_import edges, use reference count weights, treat as undirected | auto |
| All edges including package imports | Include package_import edges in graph | |
| Local imports only, unweighted | Ignore edge weights, treat all edges equally | |

**User's choice:** [auto] Local imports only, weighted, undirected (recommended default)
**Notes:** Package imports are external and don't indicate project file coupling. Undirected because community detection is about mutual coupling, not direction. Weights from Phase 26 strengthen tightly-coupled pairs.

| Option | Description | Selected |
|--------|-------------|----------|
| Ignore confidence -- use all edges equally | Both EXTRACTED and INFERRED edges treated the same for clustering | auto |
| Weight by confidence | Use confidence score as additional edge weight factor | |
| Filter low-confidence edges | Only cluster on EXTRACTED (1.0) edges | |

**User's choice:** [auto] Ignore confidence (recommended default)
**Notes:** Both tiers represent real dependencies. Filtering would create incomplete communities.

---

## Cache Invalidation

| Option | Description | Selected |
|--------|-------------|----------|
| Dirty flag + lazy recompute on query | setEdges() sets dirty=true, get_communities checks flag and recomputes if needed | auto |
| Recompute on every setEdges() call | Immediate recompute after each edge write | |
| Timer-based recompute | Recompute every N seconds if dirty | |

**User's choice:** [auto] Dirty flag + lazy recompute (recommended default)
**Notes:** Avoids wasted computation when nobody queries communities. Simple and efficient.

| Option | Description | Selected |
|--------|-------------|----------|
| No threshold -- any edge change marks dirty | Single boolean flag, any write dirties cache | auto |
| N-change threshold before recompute | Track change count, recompute after N changes | |

**User's choice:** [auto] No threshold (recommended default)
**Notes:** Louvain on hundreds of files is <100ms. Threshold adds complexity for no measurable benefit.

---

## MCP Tool Response

| Option | Description | Selected |
|--------|-------------|----------|
| Representative + members + count | Each community shows highest-importance file, member list, and size | auto |
| Representative + count only | Minimal response, query individual files for members | |
| Full stats (concepts, avg importance, etc.) | Rich metadata per community | |

**User's choice:** [auto] Representative + members + count (recommended default)
**Notes:** Balanced between minimal and over-detailed. Consumers can query individual files for more detail.

---

## Computation Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Lazy on first query | No Louvain at startup, compute on first get_communities call | auto |
| Eager at coordinator startup | Run Louvain during init() | |
| Background after scan completes | Queue Louvain as a post-init background task | |

**User's choice:** [auto] Lazy on first query (recommended default)
**Notes:** Avoids slowing coordinator startup. Fits the per-request philosophy.

---

## Claude's Discretion

- graphology graph construction details
- Louvain resolution parameter
- Internal helper function naming
- Test fixture design
- Optional optimizations (community_id column on files table)

## Deferred Ideas

None -- discussion stayed within phase scope.
