# Phase 27: Community Detection - Research

**Researched:** 2026-04-09
**Domain:** Graph community detection, graphology, SQLite persistence, MCP tool design
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Only `local_import` edges feed the Louvain graph. Package imports are external dependencies.
- **D-02:** Graph is treated as undirected for clustering. Convert directed edges by adding both directions.
- **D-03:** Edge weights (reference count from Phase 26) are used as Louvain edge weights.
- **D-04:** Edge confidence is ignored for clustering. Both EXTRACTED (1.0) and INFERRED (0.8) edges are included.
- **D-05:** New `src/community-detection.ts` module following the `cycle-detection.ts` pattern. Entry point: `detectCommunities(edges, importances) => CommunityResult[]`.
- **D-06:** Uses `graphology` + `graphology-communities-louvain` as npm dependencies.
- **D-07:** Module builds undirected weighted graphology graph, runs Louvain, maps integer IDs to representative file paths using importance scores.
- **D-08:** Module-level `dirty` flag. `setEdges()` sets `dirty = true` after writing edges.
- **D-09:** No minimum change threshold. Any edge write marks dirty.
- **D-10:** Cached results stored in SQLite (`file_communities` table) and in memory. Dirty flag controls recompute vs. cached read.
- **D-11:** Lazy computation on first `get_communities` MCP query. No Louvain at coordinator startup.
- **D-12:** On query: check dirty flag. If dirty (or no cached data), run Louvain, persist, clear flag, return. If clean, read from DB.
- **D-13:** New `get_communities` MCP tool. No required parameters. Optional `file_path` to filter to one community.
- **D-14:** Each community in response contains: `representative` (path of highest-importance file), `members` (array of paths), `size` (member count).
- **D-15:** Without `file_path`, returns all communities sorted by size descending. With `file_path`, returns single community containing that file.
- **D-16:** New repository functions: `setCommunities(communities)`, `getCommunities()`, `getCommunityForFile(path)`.
- **D-17:** `setCommunities()` uses a transaction: DELETE all from `file_communities`, INSERT all new assignments. Full replace.

### Claude's Discretion

- graphology graph construction details (addNode/addEdge patterns)
- Louvain resolution parameter (default is fine)
- Internal helper function naming
- Test fixture design (graph shapes for testing clustering)
- Whether to add a `community_id` column to the `files` table for faster single-file lookups

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| COMM-01 | Louvain clustering groups files into communities using the dependency graph | graphology + graphology-communities-louvain provide the algorithm; `UndirectedGraph` from graphology is the correct type; louvain() returns a `Record<string, number>` partition map |
| COMM-02 | Community results cached with dirty-flag invalidation (recomputes on graph changes) | Module-level `let dirty = true` in community-detection.ts; setEdges() in repository.ts sets the flag after writes; cache stored in `file_communities` table |
| COMM-03 | `get_communities` MCP tool returns community members by file path (not integer IDs) | `server.tool()` pattern from mcp-server.ts lines 392-428; integer IDs from Louvain are mapped to representative file paths using importance scores |
| COMM-04 | Community membership stored in SQLite (`file_communities` table) | Table already exists in schema.ts lines 51-57; `setCommunities()` / `getCommunities()` repository functions needed |

</phase_requirements>

## Summary

Phase 27 adds community detection to FileScopeMCP's dependency graph. The implementation centers on three things: a pure algorithm module (`community-detection.ts`) that wraps graphology + Louvain, a repository layer for persisting community membership to the existing `file_communities` table, and a new `get_communities` MCP tool that returns human-readable results keyed by representative file path.

The technical stack is fully determined: `graphology` (0.26.0) provides the `UndirectedGraph` data structure, `graphology-communities-louvain` (2.0.2) provides the Louvain algorithm. Both are actively maintained and TypeScript-friendly. The pattern to follow is `cycle-detection.ts` — a pure function module with no imports from other project modules.

The key implementation detail is the dirty flag. `setEdges()` in repository.ts must set a module-level flag after each write. When `get_communities` is queried, it checks the flag: if dirty, run Louvain and persist; if clean, read from `file_communities`. The dirty flag starts as `true` so the first query always runs Louvain.

**Primary recommendation:** Follow the `cycle-detection.ts` pattern exactly. One pure module, one entry-point function, data in/results out. The only novelty vs. cycle detection is the Louvain library call and the representative-selection step.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| graphology | 0.26.0 | Graph data structure (nodes, edges, attributes) | Official spec-compliant JS/TS graph library; ~890K weekly downloads; TypeScript declarations included |
| graphology-communities-louvain | 2.0.2 | Louvain community detection algorithm | Official graphology standard library package; purpose-built for this use case; handles weighted undirected graphs |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | (already installed) | Persist community membership | Already used throughout project; same sync pattern |
| drizzle-orm | (already installed) | Schema types for file_communities | Already used throughout project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| graphology | jlouvain | graphology is 45x faster (52ms vs 2368ms on 1000-node graph); better maintained |
| graphology-communities-louvain | Hand-rolled Louvain | Louvain has tricky modularity math; library handles edge weights, resolution, fast local moves optimization |

**Installation:**
```bash
npm install graphology graphology-communities-louvain
```

The `build` script in package.json will also need `src/community-detection.ts` added to the esbuild entry list.

## Architecture Patterns

### Recommended Project Structure

New files to create:
```
src/
├── community-detection.ts      # Pure algorithm module (new)
├── community-detection.test.ts # Unit tests (new)
├── db/
│   └── repository.ts           # Add setCommunities, getCommunities, getCommunityForFile, getAllLocalImportEdgesWithWeights
└── mcp-server.ts               # Add get_communities tool registration
```

Existing files to modify:
```
src/db/repository.ts    # New functions + dirty flag export
src/mcp-server.ts       # Register get_communities tool
package.json            # Add graphology deps, add community-detection.ts to build script
```

### Pattern 1: Pure Algorithm Module (follow cycle-detection.ts exactly)

**What:** `community-detection.ts` takes plain data arrays (no DB, no imports from project), builds a graphology graph, runs Louvain, returns typed results.
**When to use:** Always — this is the established project pattern for graph algorithms.

```typescript
// Source: cycle-detection.ts pattern + graphology docs
import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';

export interface CommunityResult {
  communityId: number;          // Raw integer from Louvain
  representative: string;       // Path of highest-importance member
  members: string[];            // All file paths in this community
  size: number;                 // members.length
}

export function detectCommunities(
  edges: Array<{ source_path: string; target_path: string; weight: number }>,
  importances: Map<string, number>
): CommunityResult[] {
  if (edges.length === 0) return [];

  const graph = new UndirectedGraph();

  // Add nodes (mergeNode avoids duplicate-add errors)
  for (const { source_path, target_path } of edges) {
    if (!graph.hasNode(source_path)) graph.addNode(source_path);
    if (!graph.hasNode(target_path)) graph.addNode(target_path);
  }

  // Add edges — undirected so A->B and B->A collapse to one edge
  // mergeEdge merges attributes on the existing edge if already present
  for (const { source_path, target_path, weight } of edges) {
    if (!graph.hasEdge(source_path, target_path)) {
      graph.addEdge(source_path, target_path, { weight });
    } else {
      // Accumulate weight if edge already exists from the other direction
      const existing = graph.getEdgeAttribute(source_path, target_path, 'weight') as number;
      graph.setEdgeAttribute(source_path, target_path, 'weight', existing + weight);
    }
  }

  // Run Louvain — returns Record<nodeKey, communityId>
  // getEdgeWeight: 'weight' tells the algorithm to use our weight attribute
  const partition = louvain(graph, { getEdgeWeight: 'weight' });

  // Group nodes by integer community ID
  const groups = new Map<number, string[]>();
  for (const [filePath, communityId] of Object.entries(partition)) {
    if (!groups.has(communityId)) groups.set(communityId, []);
    groups.get(communityId)!.push(filePath);
  }

  // Map each group to CommunityResult with representative = highest-importance member
  return Array.from(groups.entries()).map(([communityId, members]) => {
    const representative = members.reduce((best, path) => {
      return (importances.get(path) ?? 0) >= (importances.get(best) ?? 0) ? path : best;
    }, members[0]);
    return { communityId, representative, members: members.sort(), size: members.length };
  });
}
```

### Pattern 2: Dirty Flag in repository.ts

**What:** Module-level mutable flag that `setEdges()` sets after each write. Exported so the MCP tool handler can check and reset it.
**When to use:** Single-source dirty tracking — any edge write invalidates the full community cache.

```typescript
// In src/db/repository.ts — add near top of file
// Module-level dirty flag: true means community cache is stale
let _communitiesDirty = true;  // start dirty — first query always runs Louvain

export function isCommunitiesDirty(): boolean {
  return _communitiesDirty;
}

export function markCommunitiesDirty(): void {
  _communitiesDirty = true;
}

export function clearCommunitiesDirty(): void {
  _communitiesDirty = false;
}

// Then modify setEdges() to call markCommunitiesDirty() after its writes:
export function setEdges(sourcePath: string, edges: EdgeResult[]): void {
  // ... existing logic ...
  markCommunitiesDirty();  // <-- add this at the end
}
```

### Pattern 3: Repository Functions for file_communities

**What:** `setCommunities()`, `getCommunities()`, `getCommunityForFile()`.
**When to use:** All community persistence. No direct SQL in mcp-server.ts or community-detection.ts.

```typescript
// In src/db/repository.ts — import file_communities from schema
import { files, file_dependencies, file_communities } from './schema.js';

export interface StoredCommunity {
  communityId: number;
  representative: string;
  members: string[];
  size: number;
}

export function setCommunities(communities: CommunityResult[]): void {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM file_communities').run();
    for (const c of communities) {
      for (const filePath of c.members) {
        sqlite.prepare(
          'INSERT INTO file_communities (community_id, file_path) VALUES (?, ?)'
        ).run(c.communityId, filePath);
      }
    }
  });
  tx();
}

export function getCommunities(): StoredCommunity[] {
  // Returns all communities assembled from file_communities rows.
  // Requires a join or two-pass query to also get representatives.
  // Simplest approach: read all rows, group in JS.
  const sqlite = getSqlite();
  const rows = sqlite.prepare(
    'SELECT community_id, file_path FROM file_communities ORDER BY community_id'
  ).all() as Array<{ community_id: number; file_path: string }>;
  // ... group and reconstruct StoredCommunity[] ...
}

export function getCommunityForFile(filePath: string): StoredCommunity | null {
  const sqlite = getSqlite();
  const row = sqlite.prepare(
    'SELECT community_id FROM file_communities WHERE file_path = ?'
  ).get(filePath) as { community_id: number } | undefined;
  if (!row) return null;
  // Fetch all members of that community
  // ...
}
```

### Pattern 4: New Repository Query for Edges with Weights

**What:** `getAllLocalImportEdgesWithWeights()` — extends the existing `getAllLocalImportEdges()` pattern.
**Why needed:** `getAllLocalImportEdges()` only returns `source_path` and `target_path`. Louvain needs `weight`.

```typescript
export function getAllLocalImportEdgesWithWeights(): Array<{
  source_path: string;
  target_path: string;
  weight: number;
}> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT source_path, target_path, weight FROM file_dependencies WHERE dependency_type = 'local_import'"
    )
    .all() as Array<{ source_path: string; target_path: string; weight: number }>;
}
```

### Pattern 5: MCP Tool Handler (follow detect_cycles pattern)

**What:** `get_communities` tool registered in `registerTools()` in mcp-server.ts.
**When to use:** Always follow the established tool pattern.

```typescript
// In registerTools() — after detect_cycles and get_cycles_for_file
server.tool("get_communities", "Get file communities detected by Louvain clustering", {
  file_path: z.string().optional().describe("Filter to the community containing this file path"),
}, async (params: { file_path?: string }) => {
  if (!coordinator.isInitialized()) return projectPathNotSetError;

  // Check dirty flag — recompute if needed
  if (isCommunitiesDirty() || (await getCommunities()).length === 0) {
    const edges = getAllLocalImportEdgesWithWeights();
    const allFiles = getAllFiles();
    const importances = new Map(allFiles.map(f => [f.path, f.importance ?? 0]));
    const communities = detectCommunities(edges, importances);
    setCommunities(communities);
    clearCommunitiesDirty();
  }

  const allCommunities = getCommunities();  // reads from SQLite

  if (params.file_path) {
    const normalizedPath = normalizePath(params.file_path);
    const community = getCommunityForFile(normalizedPath);
    if (!community) return createMcpResponse(`File not found in any community: ${params.file_path}`, true);
    return createMcpResponse(community);
  }

  // Sort by size descending
  const sorted = allCommunities.sort((a, b) => b.size - a.size);
  return createMcpResponse({ communities: sorted, totalCommunities: sorted.length });
});
```

### Anti-Patterns to Avoid

- **Parallel edges on UndirectedGraph:** `graphology`'s `UndirectedGraph` (non-Multi) will throw if you call `addEdge` twice between the same node pair. Use `hasEdge()` check or `mergeEdge()` — see Pattern 1 above.
- **Mixed graph with Louvain:** `graphology-communities-louvain` does not support mixed graphs (some directed, some undirected edges). Always use `UndirectedGraph` or `Graph({ type: 'undirected' })`.
- **Re-running Louvain on startup:** D-11 is explicit: lazy, not eager. Do not call `detectCommunities` during `coordinator.init()`.
- **Storing representative separately:** The `file_communities` schema only has `community_id` and `file_path`. Derive the representative at read time (highest-importance member in a group). Do not add a `representative` column to the schema — that would create redundancy and a maintenance burden.
- **Calling `getCommunities()` inside `setCommunities()`:** These are separate operations. The tool handler does: setCommunities → clearDirty → getCommunities. Never nest them.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Louvain modularity optimization | Custom graph partitioning | graphology-communities-louvain | Louvain involves iterative modularity gain computations, dendrogram construction, and local move optimizations — high correctness surface area |
| Graph data structure | Custom adjacency list for Louvain | graphology UndirectedGraph | graphology handles node/edge deduplication, attribute storage, and the interface expected by the communities library |
| Community ID deduplication | Tracking which integers are which | louvain() return value | Returns a stable `Record<string, number>` partition — group by integer ID directly |

**Key insight:** graphology + graphology-communities-louvain are a tightly coupled pair. The Louvain library is designed specifically for graphology graphs and will not work with a plain adjacency list.

## Common Pitfalls

### Pitfall 1: Parallel Edge Error on UndirectedGraph
**What goes wrong:** `graphology` throws `"Graph.addEdge: an edge linking 'A' to 'B' already exists"` when you attempt to add an edge in both directions (A→B then B→A) on a non-multi undirected graph.
**Why it happens:** An `UndirectedGraph` treats A-B and B-A as the same edge. When the raw DB has both `A→B` and `B→A` as directed edges (Phase 26 stores one direction), iterating them and calling `addEdge` twice will hit the duplicate.
**How to avoid:** Use `hasEdge(src, tgt)` before `addEdge`, or use `mergeEdge` which is idempotent. When both directions exist with different weights, accumulate the weights on the existing edge (see Pattern 1 code above).
**Warning signs:** Any `Graph.addEdge` error in community-detection.ts tests.

### Pitfall 2: Louvain Non-Determinism
**What goes wrong:** Calling `detectCommunities` twice on the same graph produces different partitions. Tests using exact community membership assertions become flaky.
**Why it happens:** Louvain uses `Math.random()` for random walk traversal by default.
**How to avoid:** For tests, pass `{ randomWalk: false }` to louvain(). For production, non-determinism is acceptable — we only need stable behavior within a single session (dirty flag controls recompute timing). Tests should assert structural properties (every file appears in exactly one community, representative is a member) not exact integer IDs.
**Warning signs:** Intermittent test failures on community membership exact-match assertions.

### Pitfall 3: Empty Graph (No Local Import Edges)
**What goes wrong:** `louvain(emptyGraph)` may throw or return an empty object. `detectCommunities` must short-circuit on empty input.
**Why it happens:** New or nearly-empty projects have no local_import edges. `getAllLocalImportEdgesWithWeights()` returns `[]`.
**How to avoid:** Guard with `if (edges.length === 0) return []` at the top of `detectCommunities`, as done in `detectCycles`.
**Warning signs:** Error in get_communities handler for fresh projects.

### Pitfall 4: Isolated Nodes Not in Louvain Results
**What goes wrong:** Files with no local_import edges (no edges to/from them) may not appear in the Louvain partition at all. The partition only covers nodes actually added to the graphology graph.
**Why it happens:** Files with no local_import edges are never added to the graph via the edge-building loop (Pattern 1 only adds nodes it encounters while iterating edges). Louvain then partitions only those nodes.
**How to avoid:** This is acceptable behavior per project decisions. Isolated files simply have no community entry in `file_communities`. `getCommunityForFile` returns null for them. The MCP tool should handle null gracefully.
**Warning signs:** Files visible in `list_files` but absent from any community result.

### Pitfall 5: esbuild Build Script Not Updated
**What goes wrong:** `npm run build` produces dist/ without `community-detection.js`. The MCP server imports the module at runtime and throws `Cannot find module`.
**Why it happens:** package.json `build` script lists every source file explicitly (not a glob). New modules must be added manually.
**How to avoid:** Add `src/community-detection.ts` to the space-separated file list in the `build` script in package.json.
**Warning signs:** Module import error at server startup after a fresh build.

### Pitfall 6: getCommunities() Called Before setCommunities() Clears Dirty Flag
**What goes wrong:** The tool handler checks `isCommunitiesDirty()`, recomputes, but calls `getCommunities()` from the DB before `clearCommunitiesDirty()` runs. On next call, dirty is still true and Louvain reruns unnecessarily.
**Why it happens:** Operation order matters: setCommunities → clearDirty → getCommunities (read from DB).
**How to avoid:** Follow the sequence strictly in the tool handler. `clearCommunitiesDirty()` must be called after `setCommunities()` succeeds.

## Code Examples

Verified patterns from official sources:

### Building an Undirected Weighted Graph
```typescript
// Source: graphology official docs (graphology.github.io/mutation.html)
import { UndirectedGraph } from 'graphology';

const graph = new UndirectedGraph();
graph.addNode('src/foo.ts');
graph.addNode('src/bar.ts');
graph.addEdge('src/foo.ts', 'src/bar.ts', { weight: 3 });
// graph.size === 1 (one undirected edge)
// graph.order === 2 (two nodes)
```

### Running Louvain
```typescript
// Source: graphology-communities-louvain docs (graphology.github.io/standard-library/communities-louvain.html)
import louvain from 'graphology-communities-louvain';

// Returns Record<nodeKey, communityId>
const partition = louvain(graph, { getEdgeWeight: 'weight' });
// Example: { 'src/foo.ts': 0, 'src/bar.ts': 0, 'src/baz.ts': 1 }

// Or use louvain.assign() to set 'community' attribute directly on nodes
louvain.assign(graph, { getEdgeWeight: 'weight' });
// Then read: graph.getNodeAttribute('src/foo.ts', 'community') === 0
```

### Using mergeEdge for Idempotent Edge Insertion
```typescript
// Source: graphology official docs
graph.mergeEdge('A', 'B', { weight: 2 });  // creates edge
graph.mergeEdge('A', 'B', { weight: 5 });  // merges attributes (weight would be 5, NOT 2+5)
// For weight accumulation, use hasEdge + setEdgeAttribute instead (see Pattern 1)
```

### setCommunities Transaction Pattern
```typescript
// Source: existing better-sqlite3 transaction pattern in repository.ts
const tx = getSqlite().transaction(() => {
  getSqlite().prepare('DELETE FROM file_communities').run();
  const stmt = getSqlite().prepare(
    'INSERT INTO file_communities (community_id, file_path) VALUES (?, ?)'
  );
  for (const c of communities) {
    for (const filePath of c.members) {
      stmt.run(c.communityId, filePath);
    }
  }
});
tx();
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| jlouvain (slow, unmaintained) | graphology-communities-louvain | ~2022 | 45x faster; TypeScript support; official graphology ecosystem |
| Integer-keyed community results | Representative-file keyed results | Phase 27 design decision | LLMs and humans can read community names without looking up IDs |

**Deprecated/outdated:**
- `luccitan/graphology-communities`: Explicitly marked OBSOLETE on GitHub. Replaced by `graphology-communities-louvain` (official standard library package).

## Open Questions

1. **Should isolated nodes (no local_import edges) get their own singleton communities?**
   - What we know: They are not added to the graphology graph, so Louvain does not assign them any community ID.
   - What's unclear: Whether the planner should create a post-processing step to assign singletons.
   - Recommendation: Per project decisions, leave them unassigned. `getCommunityForFile` returns null for isolated files. The tool response simply omits them. This avoids polluting the communities result with N singleton communities for leaf files.

2. **Where exactly does the dirty flag module live?**
   - What we know: D-08 says "Module-level dirty flag in community-detection.ts (or coordinator)."
   - What's unclear: community-detection.ts is supposed to be a pure algorithm module with no side effects — a mutable dirty flag does not belong there.
   - Recommendation: Place the dirty flag and its accessors (`isCommunitiesDirty`, `markCommunitiesDirty`, `clearCommunitiesDirty`) in `repository.ts` alongside `setEdges()`. This is the natural home since `setEdges()` is the writer that must set the flag, and repository.ts already has state (`getSqlite()`). The MCP handler imports the accessors from repository.ts.

## Sources

### Primary (HIGH confidence)
- graphology official docs (graphology.github.io/mutation.html) — addNode, addEdge, mergeEdge, UndirectedGraph API
- graphology-communities-louvain official docs (graphology.github.io/standard-library/communities-louvain.html) — louvain(), options, return type
- npm registry — graphology: 0.26.0; graphology-communities-louvain: 2.0.2 (confirmed via `npm info`)
- src/cycle-detection.ts — canonical pattern for pure algorithm modules in this project
- src/db/repository.ts — existing patterns for bulk writes, transactions, raw sqlite queries
- src/db/schema.ts — `file_communities` table definition (already created in Phase 25)
- src/mcp-server.ts lines 392-428 — detect_cycles / get_cycles_for_file tool patterns

### Secondary (MEDIUM confidence)
- graphology GitHub repo — confirmed luccitan/graphology-communities is OBSOLETE, replaced by official package
- Performance benchmark (52ms on 1000-node/9724-edge graph) — from official graphology docs, not independently reproduced

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions confirmed via npm info; API confirmed via official docs
- Architecture: HIGH — pattern is directly derived from existing cycle-detection.ts code in the repo
- Pitfalls: HIGH for parallel-edge and non-determinism (well-known graphology behaviors); MEDIUM for isolated-node behavior (not explicitly tested)

**Research date:** 2026-04-09
**Valid until:** 2026-05-09 (stable libraries; graphology releases are infrequent)
