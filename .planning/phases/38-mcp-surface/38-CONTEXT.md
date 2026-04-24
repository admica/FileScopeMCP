# Phase 38: MCP Surface - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning
**Mode:** `--auto` — recommended defaults auto-selected, logged inline per decision

<domain>
## Phase Boundary

Register `find_callers` and `find_callees` MCP tools via `registerTool()`, backed by repository helpers that JOIN `symbol_dependencies`, and ship InMemoryTransport integration tests that lock the response contract. Phase 37 populated the data; Phase 38 exposes it.

In scope:
- Repository helpers `getCallers(name, filePath?, limit)` and `getCallees(name, filePath?, limit)` in `src/db/repository.ts`
- `find_callers` and `find_callees` tool registration via `registerTool()` with `ToolAnnotations` in `src/mcp-server.ts`
- InMemoryTransport integration tests in `tests/integration/mcp-transport.test.ts` (extend existing suite)
- Tool descriptions documenting Ruby limitations and caller/callee staleness model

Out of scope:
- Python / Go / Ruby call-site edges → v1.8
- Transitive (multi-hop) call-graph queries → OUT OF SCOPE per PROJECT.md
- Any changes to Phase 37's extraction or write path
- Deferred-item closure → Phase 39

</domain>

<decisions>
## Implementation Decisions

### Repository helper query design
- **D-01:** `getCallers(name, filePath?, limit)` finds target symbol(s) matching `name` (exact match, case-sensitive), then queries `symbol_dependencies WHERE callee_symbol_id IN (target_ids) AND caller_symbol_id != callee_symbol_id` (self-loop exclusion). INNER JOIN `symbols` (for caller info) + INNER JOIN `files` (for caller path). Returns `{items, total, unresolvedCount}`.
- **D-02:** `getCallees(name, filePath?, limit)` — reversed: find caller symbol(s) matching `name`, then query `symbol_dependencies WHERE caller_symbol_id IN (caller_ids) AND caller_symbol_id != callee_symbol_id`. INNER JOIN `symbols` (for callee info) + INNER JOIN `files` (for callee path). Same envelope shape.
- **D-03:** Both helpers use two queries: (1) COUNT for `total` (pre-LIMIT, post-self-loop-filter), (2) SELECT with LIMIT for `items`. Matches `findSymbols` pattern (repository.ts:1049).
- **D-04:** `filePath` parameter filters the TARGET symbol's defining file — narrows which symbol(s) to look up callers/callees for. When omitted, all symbols matching `name` are included. Consistent with `find_symbol` implicit path disambiguation.
- **D-05:** Query ordering: `path ASC, start_line ASC` for deterministic results.

### unresolvedCount computation
- **D-06:** `unresolvedCount` is computed via a separate COUNT query using LEFT JOIN: count `symbol_dependencies` rows where the opposite-side symbol ID does not resolve (i.e., the FK target no longer exists in the `symbols` table — dangling ref from callee-side eventual consistency per Phase 37 D-19). For `find_callers`: count rows where `caller_symbol_id NOT IN (SELECT id FROM symbols)`. For `find_callees`: count rows where `callee_symbol_id NOT IN (SELECT id FROM symbols)`.
- **D-07:** This is an honest staleness signal — agents see how many edges were orphaned by file edits since the caller was last scanned. Zero in a freshly-scanned repo. Non-zero after a callee file is renamed/deleted without re-scanning its callers.

### Tool registration
- **D-08:** Both tools registered with `ToolAnnotations`: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. Matches `find_symbol` annotations exactly.
- **D-09:** `maxItems` parameter: `z.coerce.number().int().optional()`, clamped to `[1, 500]`, default 50. Same schema as `find_symbol`.
- **D-10:** `name` parameter: `z.string().min(1)` — exact match, no wildcard/GLOB (unlike `find_symbol`). Symbol name must match exactly. If multiple symbols share the name (e.g., reopened Ruby classes), all their callers/callees are returned.
- **D-11:** `filePath` parameter: `z.string().optional()` — when provided, restricts the symbol lookup to that file. No path normalization at tool layer (repository handles canonical paths).
- **D-12:** Response envelope: `{ok: true, items: [{path, name, kind, startLine, confidence}], total, truncated?: true, unresolvedCount}`. No `endLine`, no `isExport` (Pitfall 16 prevention — lighter response for navigation, not full symbol detail). `truncated` present only when `items.length < total`.

### Tool descriptions
- **D-13:** Both tool descriptions include:
  - Purpose statement ("Find all symbols that call / are called by the named symbol")
  - `filePath` disambiguation note
  - `maxItems` clamping and default
  - Ruby `attr_accessor` limitation (carried from `find_symbol` description)
  - Reopened Ruby class multi-result behavior
  - Staleness note: "Results reflect the last scan of each caller's file. `unresolvedCount > 0` means some edges have gone stale — trigger a `scan_all` to refresh."
  - Self-loop exclusion note
  - `NOT_INITIALIZED` error handling
  - Example usage
- **D-14:** Description format: `string[].join(' ')` literal, matching `find_symbol` pattern (repository.ts line 338).

### Integration tests
- **D-15:** Extend existing `tests/integration/mcp-transport.test.ts` — add two new `describe` blocks for `find_callers` and `find_callees`. Reuse existing `beforeAll` / `afterAll` setup (coordinator, server, client, temp dir).
- **D-16:** Test fixture: write a multi-file TS setup in `beforeAll` — file A with function `greet()` that calls `helper()` from file B. After `coordinator.init(tmpDir)`, both tools have real `symbol_dependencies` data to query.
- **D-17:** Test cases per tool:
  - Envelope shape assertion (`ok`, `items`, `total`, `unresolvedCount` present)
  - `maxItems` clamping (pass 0 → clamp to 1, pass 1000 → clamp to 500)
  - Self-loop exclusion (add a recursive call in fixture, assert it's absent from results)
  - Empty result (query non-existent symbol → `{items: [], total: 0, unresolvedCount: 0}`)
  - `NOT_INITIALIZED` error (call before `set_base_directory` → error code)
- **D-18:** Test does NOT verify `unresolvedCount > 0` scenario (would require deleting a callee file mid-test and not re-scanning — fragile). The COUNT query is tested implicitly by asserting `unresolvedCount: 0` in a clean scenario.

### Plan breakdown
- **D-19:** Two plans per ROADMAP suggestion:
  - **38-01:** Repository helpers `getCallers()` + `getCallees()` in `repository.ts` + tool registration in `mcp-server.ts` + unit tests for repository helpers
  - **38-02:** InMemoryTransport integration tests for both tools + contract assertions + `38-VERIFICATION.md` phase exit gate

### Claude's Discretion
- Exact SQL query shape (subquery vs JOIN for symbol lookup step)
- Whether `getCallers` and `getCallees` share a private helper or are two independent functions
- Whether the `unresolvedCount` query is inlined or factored into a helper
- Fixture file content for integration tests (specific function bodies)
- Whether to add a `confidence` filter parameter to the tools (not in requirements — likely omit)
- Ordering of tool descriptions relative to existing tools in `registerTools()`

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.7 roadmap + requirements
- `.planning/ROADMAP.md` §Phase 38 — goal, depends-on, requirements (MCP-01..04), success criteria, cross-cutting notes (self-loop filtering, `find_` prefix, `unresolvedCount`, response shape)
- `.planning/REQUIREMENTS.md` §MCP-01..04 — tool signatures, response envelopes, clamping rules, Ruby limitation docs
- `.planning/PROJECT.md` §Current Milestone, §Key Decisions (registerTool pattern, InMemoryTransport pattern), §Out of Scope (transitive call graphs, method-call resolution)

### Phase 37 context (data layer this phase exposes)
- `.planning/phases/37-ts-js-call-site-edge-extraction/37-CONTEXT.md` — `symbol_dependencies` write path, caller-authoritative/callee-eventual-consistency model (D-19), self-loops stored at write time (D-14), resolution confidence values (1.0 local, 0.8 imported)

### Schema
- `src/db/schema.ts` §symbol_dependencies (line 88) — `id`, `caller_symbol_id`, `callee_symbol_id`, `call_line`, `confidence`; indexes on both FK columns

### MCP tool registration pattern (precedent)
- `src/mcp-server.ts` §find_symbol (line 336) — `registerTool()` with `ToolAnnotations`, `z.coerce` schema, `maxItems` clamping, `mcpSuccess`/`mcpError` envelope, `string[].join(' ')` description pattern
- `src/mcp-server.ts` §registerTools (line 173) — tool registration function signature

### Repository query pattern (precedent)
- `src/db/repository.ts` §findSymbols (line 1049) — COUNT + SELECT-with-LIMIT two-query pattern, `buildNamePredicate`, prepared statements
- `src/db/repository.ts` §getSymbolsByName (line 1004) — simple symbol lookup by name with optional kind filter

### Integration test pattern (precedent)
- `tests/integration/mcp-transport.test.ts` — InMemoryTransport setup, `callAndParse` helper, per-tool describe blocks, temp dir + real SQLite + real coordinator

### Codebase conventions
- `.planning/codebase/CONVENTIONS.md` — ESM `.js` extensions, module-level singletons, logger usage
- `.planning/codebase/TESTING.md` — vitest patterns, DB fixture setup

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`findSymbols()`** (`src/db/repository.ts:1049`) — COUNT + SELECT pattern with LIMIT. New helpers mirror this for `symbol_dependencies` JOINs.
- **`find_symbol` tool registration** (`src/mcp-server.ts:336`) — exact template for `find_callers` / `find_callees` registration. Same `ToolAnnotations`, same `z.coerce` schema patterns, same `mcpSuccess`/`mcpError` envelope.
- **`callAndParse()` test helper** (`tests/integration/mcp-transport.test.ts:90`) — existing helper for InMemoryTransport assertions. New tests reuse it directly.
- **`InMemoryTransport.createLinkedPair()`** — already set up in test beforeAll. New describe blocks share the same server/client/coordinator.
- **`symbol_dependencies` table** (`src/db/schema.ts:88`) — dual indexes on `caller_symbol_id` and `callee_symbol_id` already exist, so both `getCallers` and `getCallees` queries hit an index.

### Established Patterns
- `registerTool()` with `ToolAnnotations` — all 15 existing tools use this pattern. Phase 38 adds tools 16 and 17.
- `maxItems` clamping `[1, 500]` default 50 — established in `find_symbol` (Phase 34), `list_files`, `find_important_files`.
- `mcpSuccess({ items, total, ...rest })` envelope — standard across all query tools.
- `NOT_INITIALIZED` error check — every tool starts with `if (!coordinator.isInitialized()) return mcpError(...)`.

### Integration Points
- **`registerTools()` in `mcp-server.ts`** — add two new `server.registerTool()` calls inside this function. No signature changes.
- **`repository.ts` exports** — add `getCallers()` and `getCallees()` exports. Imported by `mcp-server.ts` tool handlers.
- **`mcp-transport.test.ts` beforeAll** — existing setup scans `sample.ts`. Need to write additional fixture files with cross-file calls BEFORE `coordinator.init()` so symbol_dependencies are populated.

</code_context>

<specifics>
## Specific Ideas

- The `unresolvedCount` field is the key design insight: it's computed at query time from dangling FK refs (callee-side eventual consistency from Phase 37 D-19), NOT from extraction-time discard counts. This means zero changes to Phase 37's write path.
- Self-loop exclusion in the WHERE clause (`caller_symbol_id != callee_symbol_id`) mirrors the ROADMAP cross-cutting note. Self-loops are STORED (Phase 37 D-14) but filtered from results.
- The `find_callers` / `find_callees` naming uses `find_` prefix for consistency with `find_symbol` — the `get_*` prefix was explicitly rejected in REQUIREMENTS.md Out of Scope.
- Tool description should mention the staleness model: "Results reflect the last scan of each file. If a callee was renamed since its callers were scanned, some edges may be stale — `unresolvedCount` reports how many."
- Integration test fixture needs TWO files: one that defines+exports a function, another that imports+calls it. The existing `sample.ts` in mcp-transport.test.ts only has simple exports — extend with a caller file.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 38-mcp-surface*
*Context gathered: 2026-04-24*
