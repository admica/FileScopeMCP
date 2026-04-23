# Phase 30: MCP Spec Compliance - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Migrate all MCP tool registrations from deprecated `server.tool()` to `registerTool()` with proper input schemas, annotations, and truthful capability declarations. Fix false `listChanged` capability. Add structured error responses. No new tools, no new features — only spec compliance for existing tools.

</domain>

<decisions>
## Implementation Decisions

### Tool Registration API (SPEC-01)
- **D-01:** Migrate all 13 tools from `server.tool()` (deprecated in SDK 1.27.1) to `registerTool(name, config, cb)` with config object containing `title`, `description`, `inputSchema`, `annotations`.
- **D-02:** Use `outputSchema` on `registerTool` where it adds value for response format consistency. SDK validates response shape at registration time — no custom wrapper needed.
- **D-03:** No backward compatibility shims, no legacy code paths. Delete `server.tool()` calls entirely.

### listChanged Capability (SPEC-02)
- **D-04:** Remove `tools: { listChanged: true }` from server capabilities. Tool list is static — never changes at runtime. No `sendToolListChanged()` call needed.

### Tool Annotations (SPEC-03)
- **D-05:** Annotate ALL 13 tools explicitly. SDK defaults are `destructiveHint: true` and `openWorldHint: true` — unannotated tools are assumed worst-case by MCP clients. Every tool must opt out of bad defaults.
- **D-06:** Classification:
  - **Read-only tools** (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`): `list_files`, `find_important_files`, `get_file_summary`, `search`, `status`, `detect_cycles`, `get_cycles_for_file`, `get_communities`
  - **Metadata writers** (`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`): `set_file_summary`, `set_file_importance`, `set_base_directory`
  - **Destructive** (`readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: false`): `exclude_and_remove`
  - **External interaction** (`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`): `scan_all` (triggers Ollama LLM calls via broker)

### Structured Error Responses (SPEC-04)
- **D-07:** Return structured `{ ok: false, error: "CODE", message: "..." }` objects. Small code set (~4-5 codes): `NOT_INITIALIZED`, `INVALID_PATH`, `BROKER_DISCONNECTED`, `NOT_FOUND`, `OPERATION_FAILED`.

### Tool Descriptions
- **D-08:** Enrich all tool descriptions for LLM consumers. Each description should state: what it returns, when to use it vs alternatives, and preconditions. This is the primary tool selection signal for LLM agents.

### Response Format
- **D-09:** Uniform JSON response objects across all tools. Success responses use `{ ok: true, ...data }`. Error responses use `{ ok: false, error: "CODE", message: "..." }`. Leverage `outputSchema` on `registerTool` to enforce shape where SDK supports it.

### Claude's Discretion
- Exact error code values (within the ~4-5 code taxonomy)
- Tool description wording (optimized for LLM consumption)
- Whether `outputSchema` is used on all tools or only complex ones
- `idempotentHint` classification for edge cases

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### MCP SDK (installed v1.27.1)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` lines 147-157 — `registerTool()` signature with config object
- `node_modules/@modelcontextprotocol/sdk/dist/esm/spec.types.d.ts` lines 1097-1135 — `ToolAnnotations` interface (5 hints: title, readOnlyHint, destructiveHint, idempotentHint, openWorldHint)

### Source Files
- `src/mcp-server.ts` — All 13 tool registrations, `createMcpResponse()` helper, server capabilities declaration
- `src/coordinator.ts` — `ServerCoordinator` class used by tool handlers

### Requirements
- `.planning/REQUIREMENTS.md` §MCP Spec Compliance — SPEC-01 through SPEC-04

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createMcpResponse()` at `mcp-server.ts:119-151` — Current response helper. Will be replaced/refactored to produce uniform JSON objects with `ok` field.
- `registerTools()` function at `mcp-server.ts:172` — Existing wrapper that registers all tools. Migration happens inside this function.

### Established Patterns
- All tools registered in a single `registerTools()` function — migration stays in same function
- Zod schemas already used for input params (inline `z.string()`, `z.number().optional()` etc.) — move to `inputSchema` in config object
- `coordinator.isInitialized()` guard used by most tools — becomes `NOT_INITIALIZED` error code

### Integration Points
- `src/mcp-server.ts` lines 161-165 — Server capabilities object (remove `listChanged`)
- `src/mcp-server.ts` line 602 — `registerTools()` call site (unchanged, just internal migration)
- `src/mcp-server.test.ts` line 537 — Tests assert `server.tool("name"` in source — must update to `registerTool`
- `tests/unit/tool-outputs.test.ts` line 444 — Same pattern, must update

</code_context>

<specifics>
## Specific Ideas

- Tool is for LLMs, not humans — descriptions and response formats should be optimized for machine parsing
- No legacy installs exist — no migrations or concessions for old code paths
- SDK 1.27.1 `registerTool` supports `outputSchema` for SDK-enforced response validation

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 30-mcp-spec-compliance*
*Context gathered: 2026-04-17*
