# Phase 28: MCP Polish - Research

**Researched:** 2026-04-09
**Domain:** MCP tool parameter extension and repository layer enrichment (TypeScript, SQLite, Drizzle ORM)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `list_files` and `find_important_files` both gain a `maxItems` optional parameter (`z.number().optional()`). When provided, responses are capped at that many files. When omitted, current behavior is preserved (no truncation).
- **D-02:** `get_communities` does NOT get `maxItems` — not in scope for this phase.
- **D-03:** When `maxItems` constrains results, the response includes `truncated: true` and `totalCount: <total number of matching files>` at the top level so the caller knows results are incomplete.
- **D-04:** When results are not truncated (all results fit within `maxItems` or `maxItems` not provided), `truncated` and `totalCount` are omitted from the response to avoid noise.
- **D-05:** When `maxItems` is provided, `list_files` returns a flat list of files sorted by importance descending (not the tree structure).
- **D-06:** When `maxItems` is omitted, `list_files` continues to return the tree structure via `coordinator.getFileTree()` — current behavior preserved.
- **D-07:** Each file in the flat list includes: `path`, `importance`, `hasSummary`, and staleness fields (same shape as `find_important_files` items).
- **D-08:** Replace existing `limit` parameter with `maxItems` on `find_important_files`. The `minImportance` filter parameter is kept as-is.
- **D-09:** Add `truncated` and `totalCount` fields to the response when `maxItems` constrains results.
- **D-10:** Change `dependencies` field in `get_file_summary` response from `string[]` to `Array<{path: string, edgeType: string, confidence: number}>`.
- **D-11:** Keep `dependents` as `string[]` — only dependencies need edge metadata.
- **D-12:** New repository helper: `getDependenciesWithEdgeMetadata(filePath: string)` returns `Array<{target_path: string, edge_type: string, confidence: number}>`. The existing `getDependencies()` stays unchanged.

### Claude's Discretion

- Whether to create a shared helper for building truncated response wrappers or inline it
- Internal variable naming and helper function organization
- Test structure (new test file vs extending existing mcp-server tests)
- Whether to add `weight` to the dependency enrichment response (success criteria only requires edge_type and confidence, weight is optional)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | Token budget parameter on list-returning MCP tools caps response size by item count | `find_important_files` already demonstrates the query-filter-sort-slice pattern; `list_files` gains same pattern when `maxItems` is provided |
| MCP-02 | Existing MCP tools surface new edge types and confidence in their responses | `file_dependencies` table already has `edge_type`, `confidence`, `confidence_source` columns (schema.ts lines 40-43); `getDependenciesWithEdgeMetadata()` query is a direct SELECT of those columns |
| EDGE-04 | `get_file_summary` MCP tool returns edge types and confidence for dependencies | `get_file_summary` handler reads `node.dependencies` (currently `string[]` from `getDependencies()`); swapping to `getDependenciesWithEdgeMetadata()` delivers the enriched shape |
</phase_requirements>

## Summary

Phase 28 is the final polish phase of v1.4. It makes three small, self-contained changes to existing MCP tool handlers and one new repository function. All supporting infrastructure (schema columns, extractor writes, community tools) exists from prior phases.

The `maxItems` parameter for `list_files` and `find_important_files` follows an already-established pattern: call `getAllFiles()`, filter, sort by importance descending, slice to `maxItems`, and map to response shape. The `find_important_files` tool is the reference implementation — `list_files` with `maxItems` is a direct copy of that pattern. The only novel logic is the conditional `truncated`/`totalCount` metadata spread, which uses the same `...(condition && { field: value })` idiom already used for staleness fields throughout `mcp-server.ts`.

The dependency enrichment in `get_file_summary` requires one new repository function (`getDependenciesWithEdgeMetadata`) that queries the same `file_dependencies` table with the same `WHERE dependency_type = 'local_import'` filter but also selects `edge_type` and `confidence` columns instead of just `target_path`. The `get_file_summary` handler then replaces its `node.dependencies` reference with a call to this new function.

**Primary recommendation:** Implement as two waves — Wave 1 adds the repository function and `get_file_summary` enrichment (EDGE-04), Wave 2 adds `maxItems` to both list tools (MCP-01, MCP-02). Each wave is independently testable.

## Standard Stack

### Core (already installed, no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `zod` | ^3.x | Tool parameter schemas with `.optional().describe()` | Already used for all MCP tool parameters |
| `better-sqlite3` (via `getSqlite()`) | existing | Raw SQL for `getDependenciesWithEdgeMetadata` | Consistent with `getAllLocalImportEdges()`, `getStaleness()` pattern |
| `drizzle-orm` (via `getDb()`) | existing | ORM for simple queries | Already used by `getDependencies()` |
| `@modelcontextprotocol/sdk` | existing | `McpServer.tool()` registration | All tool handlers use this |

No new packages required. This phase is purely additive to existing files.

**Installation:** None required.

## Architecture Patterns

### Recommended Change Topology

```
src/
├── db/repository.ts        # ADD getDependenciesWithEdgeMetadata() alongside getDependencies()
└── mcp-server.ts
    ├── list_files           # MODIFY: add maxItems param, flat-list branch
    ├── find_important_files # MODIFY: rename limit→maxItems, add truncation metadata
    └── get_file_summary     # MODIFY: swap node.dependencies for enriched query result
```

### Pattern 1: Conditional Truncation Metadata (existing idiom)

**What:** When `maxItems` is provided and slicing occurs, spread `truncated` and `totalCount` into the response object using the existing conditional-spread pattern.
**When to use:** `find_important_files` and `list_files` (with `maxItems`) handlers.
**Example:**

```typescript
// Source: mcp-server.ts — existing staleness pattern, same idiom
const allMatching = allFiles
  .filter(f => !f.isDirectory && (f.importance || 0) >= minImportance)
  .sort((a, b) => (b.importance || 0) - (a.importance || 0));

const isTruncated = maxItems !== undefined && allMatching.length > maxItems;
const results = isTruncated ? allMatching.slice(0, maxItems) : allMatching;

return createMcpResponse({
  // ... file items ...
  ...(isTruncated && { truncated: true }),
  ...(isTruncated && { totalCount: allMatching.length }),
});
```

### Pattern 2: getDependenciesWithEdgeMetadata (new repository function)

**What:** A companion to `getDependencies()` that fetches `edge_type` and `confidence` alongside the target path. Use raw SQLite (same as `getAllLocalImportEdges()`) for direct column access without ORM type juggling.
**When to use:** Called exclusively from `get_file_summary` handler.
**Example:**

```typescript
// Source: repository.ts — modeled on getAllLocalImportEdges() raw-SQL pattern
export function getDependenciesWithEdgeMetadata(filePath: string): Array<{
  target_path: string;
  edge_type: string;
  confidence: number;
}> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT target_path, edge_type, confidence FROM file_dependencies WHERE source_path = ? AND dependency_type = 'local_import'"
    )
    .all(filePath) as Array<{ target_path: string; edge_type: string; confidence: number }>;
}
```

### Pattern 3: list_files Dual-Mode Branch

**What:** `list_files` has two code paths gated on whether `maxItems` is present. The `maxItems`-absent path calls `coordinator.getFileTree()` (preserved). The `maxItems`-present path calls `getAllFiles()` and processes exactly like `find_important_files`.
**When to use:** `list_files` handler only.

```typescript
// Conceptual structure of modified list_files handler
server.tool("list_files", "...", {
  maxItems: z.number().optional().describe("Cap response to N files, sorted by importance. Omit for full tree.")
}, async (params: { maxItems?: number }) => {
  if (!coordinator.isInitialized()) return projectPathNotSetError;

  if (params.maxItems === undefined) {
    // D-06: preserve existing tree structure
    return createMcpResponse(coordinator.getFileTree());
  }

  // D-05, D-07: flat list sorted by importance
  const allFiles = getAllFiles().filter(f => !f.isDirectory);
  const sorted = allFiles.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  const isTruncated = sorted.length > params.maxItems;
  const results = isTruncated ? sorted.slice(0, params.maxItems) : sorted;

  return createMcpResponse({
    files: results.map(file => {
      const fileStale = getStaleness(file.path);
      return {
        path: file.path,
        importance: file.importance || 0,
        hasSummary: !!file.summary,
        ...(fileStale.summaryStale !== null && { summaryStale: fileStale.summaryStale }),
        ...(fileStale.conceptsStale !== null && { conceptsStale: fileStale.conceptsStale }),
        ...(fileStale.changeImpactStale !== null && { changeImpactStale: fileStale.changeImpactStale }),
      };
    }),
    ...(isTruncated && { truncated: true }),
    ...(isTruncated && { totalCount: sorted.length }),
  });
});
```

### Pattern 4: get_file_summary Enriched Dependencies

**What:** Replace `node.dependencies` (which is `string[]` from `getDependencies()` in `rowToFileNode`) with a direct call to `getDependenciesWithEdgeMetadata()`. Map the result to `{path, edgeType, confidence}` shape for the response.
**When to use:** `get_file_summary` handler only.

```typescript
// In get_file_summary handler (replaces line 245: dependencies: node.dependencies || [])
const depsWithMeta = getDependenciesWithEdgeMetadata(normalizedPath);
return createMcpResponse({
  // ...
  dependencies: depsWithMeta.map(d => ({
    path: d.target_path,
    edgeType: d.edge_type,
    confidence: d.confidence,
  })),
  dependents: node.dependents || [], // D-11: stays string[]
  // ...
});
```

### Anti-Patterns to Avoid

- **Modifying `getDependencies()`:** Other callers (`rowToFileNode` via `getFile()`) rely on it returning `string[]`. Add a sibling function, do not change the existing one.
- **Truncating the tree structure:** Do not try to prune `coordinator.getFileTree()` by importance — D-05 mandates switching to flat list when `maxItems` is provided.
- **Returning `truncated`/`totalCount` when not truncated:** D-04 explicitly says omit these fields when all results fit. Use conditional spread, not unconditional assignment.
- **Using `node.dependencies` for enrichment:** `node.dependencies` is populated by `rowToFileNode(row, withDeps=true)` which calls the old `getDependencies()`. Call `getDependenciesWithEdgeMetadata(normalizedPath)` directly in the handler to get edge metadata.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Response formatting | Custom JSON serializer | `createMcpResponse()` at line 117 | Already handles arrays, objects, strings, error flag |
| Conditional field inclusion | `if/else` with two object literals | `...(condition && { field: value })` spread | Established codebase pattern, less code, same runtime behavior |
| All-files query | Duplicate SQL | `getAllFiles()` from repository.ts | Already used by `find_important_files`, returns `FileNode[]` without deps overhead |
| Staleness injection | New staleness reader | `getStaleness(filePath)` from repository.ts | Already imported in mcp-server.ts |

**Key insight:** All building blocks exist. This phase is assembly, not construction.

## Common Pitfalls

### Pitfall 1: find_important_files — truncation check on pre-slice vs. post-slice count

**What goes wrong:** Checking `results.length < limit` after slicing to detect truncation — this is always false when results are fewer than limit (correctly), but the check doesn't tell you whether items were dropped.
**Why it happens:** Confusing "fewer results than max" (nothing dropped) with "results === max" (may or may not be truncated).
**How to avoid:** Compute `isTruncated = allMatching.length > maxItems` on the full unsliced array before slicing. This is the only reliable check.
**Warning signs:** `truncated: true` appearing when `totalCount === results.length`.

### Pitfall 2: Omitting the dependency_type filter in getDependenciesWithEdgeMetadata

**What goes wrong:** Returning package imports (`dependency_type = 'package_import'`) in the enriched dependency list, polluting the response with node_modules/gem paths.
**Why it happens:** The existing `getDependencies()` already filters `WHERE dependency_type = 'local_import'` — forgetting this in the new function breaks parity.
**How to avoid:** Always include `AND dependency_type = 'local_import'` in the raw SQL.
**Warning signs:** Response `dependencies` array containing paths that don't start with the project root or start with `node_modules`.

### Pitfall 3: Importing getDependenciesWithEdgeMetadata in mcp-server.ts

**What goes wrong:** Forgetting to add `getDependenciesWithEdgeMetadata` to the import list at the top of `mcp-server.ts` (lines 14-30), resulting in a TypeScript "not exported" compile error.
**Why it happens:** The import block is a named import list — new exports require adding the name.
**How to avoid:** Add the export to `repository.ts` and then add it to the import in `mcp-server.ts` in the same commit/task.

### Pitfall 4: list_files parameter schema — tool registered with no parameters currently

**What goes wrong:** The current `list_files` registration on line 182 is `server.tool("list_files", "...", async () => {...})` — no schema argument. Adding `maxItems` requires inserting a schema object as the third argument and changing the function signature from `async ()` to `async (params: { maxItems?: number })`.
**Why it happens:** The existing no-params signature differs from the three-argument form used by all other parameterized tools.
**How to avoid:** Change the registration to the three-argument form: `server.tool(name, description, { maxItems: z.number().optional().describe("...") }, async (params) => {...})`.

### Pitfall 5: Staleness in flat list_files response — N+1 query risk

**What goes wrong:** Calling `getStaleness(file.path)` inside the `.map()` for every file item — this fires one SQL query per file, creating N+1 behavior for large projects.
**Why it happens:** `find_important_files` already does this (it returns a limited slice), but `list_files` with `maxItems` also slices first, so the number of `getStaleness` calls is bounded by `maxItems`, not total file count.
**How to avoid:** Only call `getStaleness` after slicing, not on the full unsliced array. The implementation in Pattern 3 above already does this correctly by mapping after slicing.

## Code Examples

Verified patterns from existing source:

### Conditional spread (staleness injection — existing pattern)

```typescript
// Source: mcp-server.ts lines 212-216 (find_important_files handler)
...(fileStale.summaryStale !== null && { summaryStale: fileStale.summaryStale }),
...(fileStale.conceptsStale !== null && { conceptsStale: fileStale.conceptsStale }),
...(fileStale.changeImpactStale !== null && { changeImpactStale: fileStale.changeImpactStale }),
```

### Raw SQL pattern for edge queries (existing)

```typescript
// Source: repository.ts lines 224-231 (getAllLocalImportEdges)
export function getAllLocalImportEdges(): Array<{ source_path: string; target_path: string }> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT source_path, target_path FROM file_dependencies WHERE dependency_type = 'local_import'"
    )
    .all() as Array<{ source_path: string; target_path: string }>;
}
```

### Schema columns available for EDGE-04 (confirmed from schema.ts lines 40-43)

```typescript
// file_dependencies table — columns ready to query:
edge_type:          text('edge_type').notNull().default('imports'),
confidence:         real('confidence').notNull().default(0.8),
confidence_source:  text('confidence_source').notNull().default('inferred'),
weight:             integer('weight').notNull().default(1),
```

### Zod optional parameter (existing pattern)

```typescript
// Source: mcp-server.ts lines 188-190 (find_important_files)
{
  limit: z.number().optional().describe("Number of files to return (default: 10)"),
  minImportance: z.number().optional().describe("Minimum importance score (0-10)")
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `getDependencies()` returns `string[]` | `getDependenciesWithEdgeMetadata()` returns `Array<{target_path, edge_type, confidence}>` | Phase 28 (this phase) | `get_file_summary` callers can see edge relationship type and reliability |
| `find_important_files` `limit` parameter | `maxItems` parameter with `truncated`/`totalCount` metadata | Phase 28 (this phase) | LLM callers can detect truncation and request more |
| `list_files` returns tree unconditionally | `list_files` returns tree when no `maxItems`, flat list when `maxItems` provided | Phase 28 (this phase) | Token-budget-aware callers get bounded responses |

**No deprecated items to remove** — `getDependencies()` stays for `rowToFileNode` internal use.

## Open Questions

None. All decisions are locked in CONTEXT.md and all relevant code is verified by reading source.

## Sources

### Primary (HIGH confidence)

- `src/mcp-server.ts` — lines 182-254: three tool handlers being modified; lines 117-149: `createMcpResponse()` helper
- `src/db/repository.ts` — lines 193-202: `getDependencies()` (reference for new sibling); lines 224-231: `getAllLocalImportEdges()` (raw SQL pattern); lines 332-340: `getAllFiles()`
- `src/db/schema.ts` — lines 28-47: `file_dependencies` table with `edge_type`, `confidence`, `confidence_source`, `weight` columns confirmed
- `src/language-config.ts` — lines 79-96: `EdgeResult` interface; confidence values are `1.0` (EXTRACTED) and `0.8` (INFERRED)
- `src/mcp-server.test.ts` — lines 1-91: test DB setup pattern; vitest framework confirmed
- `.planning/phases/28-mcp-polish/28-CONTEXT.md` — all implementation decisions

### Secondary (MEDIUM confidence)

- `package.json` — `"test": "vitest"` confirms test runner and command

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new libraries; all code paths verified against actual source files
- Architecture: HIGH — patterns are direct transcriptions of existing code, not inferred
- Pitfalls: HIGH — identified by reading actual call sites and type signatures

**Research date:** 2026-04-09
**Valid until:** Phase is stable TypeScript-only changes; research valid until phase is implemented
