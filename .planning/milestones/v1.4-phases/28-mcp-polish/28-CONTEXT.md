# Phase 28: MCP Polish - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a `maxItems` token budget parameter to `list_files` and `find_important_files` MCP tools that truncates results by item count with explicit truncation metadata (`truncated`, `totalCount`). Enrich `get_file_summary` to expose edge types and confidence scores for each dependency edge.

This phase modifies existing MCP tools only. No new tools, no new extraction logic, no schema changes.

</domain>

<decisions>
## Implementation Decisions

### Token Budget Parameter
- **D-01:** `list_files` and `find_important_files` both gain a `maxItems` optional parameter (z.number().optional()). When provided, responses are capped at that many files. When omitted, current behavior is preserved (no truncation).
- **D-02:** `get_communities` does NOT get `maxItems` — not in scope for this phase.
- **D-03:** When `maxItems` constrains results, the response includes `truncated: true` and `totalCount: <total number of matching files>` at the top level so the caller knows results are incomplete.
- **D-04:** When results are not truncated (all results fit within `maxItems` or `maxItems` not provided), `truncated` and `totalCount` are omitted from the response to avoid noise.

### list_files Behavior
- **D-05:** When `maxItems` is provided, `list_files` returns a flat list of files sorted by importance descending (not the tree structure). This is because "ordered by importance" requires a flat list, and truncating a tree by leaf count is meaningless.
- **D-06:** When `maxItems` is omitted, `list_files` continues to return the tree structure via `coordinator.getFileTree()` — current behavior preserved.
- **D-07:** Each file in the flat list includes: `path`, `importance`, `hasSummary`, and staleness fields (same shape as `find_important_files` items).

### find_important_files Parameter
- **D-08:** Replace existing `limit` parameter with `maxItems`. Zero legacy installs — no backward compatibility concern. The `minImportance` filter parameter is kept as-is.
- **D-09:** Add `truncated` and `totalCount` fields to the response when `maxItems` constrains results.

### Dependency Enrichment in get_file_summary
- **D-10:** Change `dependencies` field in `get_file_summary` response from `string[]` to `Array<{path: string, edgeType: string, confidence: number}>`. Each dependency edge now carries its type (e.g., 'imports', 'inherits', 're_exports') and confidence score (e.g., 1.0 for EXTRACTED, 0.8 for INFERRED).
- **D-11:** Keep `dependents` as `string[]` — only dependencies need edge metadata per the success criteria. Dependents are the inverse query and their edge metadata is on the source file's dependency entries.
- **D-12:** New repository helper: `getDependenciesWithEdgeMetadata(filePath: string)` returns `Array<{target_path: string, edge_type: string, confidence: number}>` instead of just `string[]`. The existing `getDependencies()` stays for use by other callers.

### Claude's Discretion
- Whether to create a shared helper for building truncated response wrappers or inline it
- Internal variable naming and helper function organization
- Test structure (new test file vs extending existing mcp-server tests)
- Whether to add `weight` to the dependency enrichment response (success criteria only requires edge_type and confidence, weight is optional)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### MCP Tool Implementations
- `src/mcp-server.ts` lines 182-186 -- `list_files` tool (currently returns tree, needs maxItems parameter)
- `src/mcp-server.ts` lines 188-220 -- `find_important_files` tool (has `limit` parameter, needs replacement with `maxItems` + truncation metadata)
- `src/mcp-server.ts` lines 222-254 -- `get_file_summary` tool (dependencies currently `string[]`, needs enrichment)
- `src/mcp-server.ts` lines 117-145 -- `createMcpResponse()` helper function

### Repository Layer
- `src/db/repository.ts` lines 193-202 -- `getDependencies()` returns `string[]` (needs enriched sibling)
- `src/db/repository.ts` lines 209-217 -- `getDependents()` returns `string[]` (no changes needed)
- `src/db/repository.ts` lines 224-231 -- `getAllLocalImportEdges()` (pattern for querying edge data)
- `src/db/repository.ts` lines 330+ -- `getAllFiles()` (used for flat list generation)

### Schema
- `src/db/schema.ts` lines 28-47 -- `file_dependencies` table with edge_type, confidence, confidence_source, weight columns

### Coordinator
- `src/coordinator.ts` lines 84-91 -- `getFileTree()` returns nested tree (used by current `list_files`)
- `src/coordinator.ts` lines 88 -- `getAllFiles()` from repository (used for flat list when maxItems provided)

### Prior Phase Context
- `.planning/phases/25-schema-foundation-languageconfig-scaffolding/25-CONTEXT.md` -- D-01 (schema columns), D-10 (EdgeResult type)
- `.planning/phases/26-multi-language-tree-sitter-extraction/26-CONTEXT.md` -- D-07/D-08/D-09 (richer edge types)

### Requirements
- `.planning/REQUIREMENTS.md` -- MCP-01, MCP-02, EDGE-04 map to this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getAllFiles()` in repository.ts: Returns all files as FileNode objects without deps. Already used by `find_important_files` — reusable for flat `list_files` with `maxItems`.
- `getStaleness()` in repository.ts: Returns per-field staleness data. Already used by both `list_files` and `find_important_files` — reusable for flat list items.
- `createMcpResponse()` in mcp-server.ts: Helper that formats any data into MCP response shape. Can wrap truncation metadata.

### Established Patterns
- `find_important_files` already demonstrates the pattern: query `getAllFiles()`, filter, sort by importance, slice, map to response shape. `list_files` with `maxItems` follows the same pattern.
- Zod parameter schemas on all tools with `.optional().describe()` annotations.
- Response objects use conditional spread: `...(condition && { field: value })` for optional fields.

### Integration Points
- `getDependencies()` in repository.ts is called by `getFile()` (which is called by `get_file_summary`). The enriched version needs to sit alongside or replace this call in `get_file_summary`.
- `mcp-server.ts` tool registration at lines 182-254 — three tools to modify.

</code_context>

<specifics>
## Specific Ideas

- This is the final phase of v1.4. It's a polish phase — small, focused changes to expose the rich edge data built in Phases 25-27 through the MCP tool interface.
- The `maxItems` parameter is specifically for LLM token budget management: when an LLM calls `list_files` on a large project, it needs to cap response size. The `truncated` + `totalCount` metadata lets the LLM know it's seeing a subset and can request more if needed.
- Edge metadata in `get_file_summary` is the payoff of the entire v1.4 milestone — the LLM can now see whether a dependency was reliably extracted from AST (confidence 1.0) vs. regex-guessed (0.8), and what kind of relationship it is (imports vs inherits vs re_exports).

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 28-mcp-polish*
*Context gathered: 2026-04-09*
