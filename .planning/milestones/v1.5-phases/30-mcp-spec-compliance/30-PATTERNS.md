# Phase 30: MCP Spec Compliance - Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 3 (1 primary source, 2 test files)
**Analogs found:** 3 / 3 (all files are modifications of existing files — no new files created)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/mcp-server.ts` | service / MCP tool host | request-response | `src/mcp-server.ts` (self — in-place refactor) | exact |
| `src/mcp-server.test.ts` | test | request-response | `tests/unit/tool-outputs.test.ts` | exact |
| `tests/unit/tool-outputs.test.ts` | test | request-response | `src/mcp-server.test.ts` | exact |

## Pattern Assignments

---

### `src/mcp-server.ts` (MCP tool host, request-response — in-place refactor)

**Analog:** `src/mcp-server.ts` (self — the refactor happens inside this file)

This is a single-file refactor. All 13 tool registrations, the capabilities declaration,
and the `createMcpResponse()` helper are replaced in place. Patterns for what to copy
from and what to produce are documented below.

---

#### Current pattern to DELETE (all 13 occurrences) — lines 178-533

**Current `server.tool()` call shape** (lines 178-182, representative):
```typescript
server.tool("set_base_directory", "Override the base directory to analyze a subdirectory or different project path", {
  path: z.string().describe("The absolute path to the project directory"),
}, async (params: { path: string }) => {
  return await coordinator.init(params.path);
});
```

**Current capabilities declaration to DELETE** (lines 161-165):
```typescript
const server = new McpServer(serverInfo, {
  capabilities: {
    tools: { listChanged: true }
  }
});
```

---

#### Target pattern A: `registerTool()` for tools WITH input params

**Copy this shape for all 10 tools that accept at least one parameter:**
```typescript
server.registerTool("list_files", {
  title: "List Files",
  description: "<enriched description — what it returns, when to use it vs alternatives, preconditions>",
  inputSchema: {
    maxItems: z.number().optional().describe("Cap response to N files sorted by importance. Omit for full tree."),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ maxItems }) => {
  if (!coordinator.isInitialized()) {
    return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
  }
  // ... tool body unchanged ...
  return mcpSuccess({ files: [...] });
});
```

Key structural rules:
- `inputSchema` is a **raw Zod shape** (`{ field: z.string() }`) — NOT wrapped in `z.object()`
- Destructured args in callback signature (e.g., `{ maxItems }`) — not a `params` object
- All existing `params.fieldName` references become bare `fieldName` after destructuring
- `createMcpResponse(data)` becomes `mcpSuccess(data)`
- `createMcpResponse(msg, true)` becomes `mcpError("CODE", msg)`
- `projectPathNotSetError` variable is deleted; replaced by inline `mcpError("NOT_INITIALIZED", ...)`

---

#### Target pattern B: `registerTool()` for zero-argument tools

**Copy this shape for `status` and `detect_cycles`** (currently `server.tool("status", "...", {}, async () => {...})`):
```typescript
server.registerTool("status", {
  title: "System Status",
  description: "<enriched description>",
  inputSchema: {},   // empty object — keeps callback signature consistent
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async () => {
  if (!coordinator.isInitialized()) {
    return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first.");
  }
  // ... tool body unchanged ...
  return mcpSuccess({ ... });
});
```

---

#### Target pattern C: McpServer constructor (no capabilities arg)

**Source:** `src/mcp-server.ts` lines 161-165 (current — DELETE the options object)

```typescript
// AFTER (remove the second arg entirely):
const server = new McpServer(serverInfo);
```

SDK registers `tools.listChanged: true` internally on the first `registerTool()` call.
The user-space declaration is redundant and misleading — remove it per D-04.

---

#### Replacement helper functions

**DELETE** `createMcpResponse()` (lines 119-151). **ADD** these two helpers in its place:

```typescript
// Source pattern: RESEARCH.md "Error Code Helper" section
type ErrorCode = "NOT_INITIALIZED" | "INVALID_PATH" | "BROKER_DISCONNECTED" | "NOT_FOUND" | "OPERATION_FAILED";

function mcpError(code: ErrorCode, message: string): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: code, message }) }],
    isError: true,
  };
}

function mcpSuccess(data: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, ...data }) }],
  };
}
```

Note: `ToolResponse` is imported from `./types.js` (line 8 — already imported, no change needed).

---

#### Per-tool annotation classification (D-06)

| Tool name | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
|-----------|-------------|-----------------|----------------|---------------|
| `list_files` | true | false | true | false |
| `find_important_files` | true | false | true | false |
| `get_file_summary` | true | false | true | false |
| `search` | true | false | true | false |
| `status` | true | false | true | false |
| `detect_cycles` | true | false | true | false |
| `get_cycles_for_file` | true | false | true | false |
| `get_communities` | true | false | false | false |
| `set_file_summary` | false | false | true | false |
| `set_file_importance` | false | false | true | false |
| `set_base_directory` | false | false | true | false |
| `exclude_and_remove` | false | true | false | false |
| `scan_all` | false | false | false | true |

Note on `get_communities`: `idempotentHint: false` because repeated calls with same args may
trigger Louvain recomputation on dirty state (not purely idempotent in process terms), though
the outcome is deterministic. Leave at discretion of planner.

---

#### Error code mapping for each tool's existing error branches

| Current pattern | Replace with |
|-----------------|--------------|
| `return projectPathNotSetError` | `return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first.")` |
| `createMcpResponse("File not found: ${params.filepath}", true)` | `mcpError("NOT_FOUND", "File not found: ${filepath}")` |
| `createMcpResponse("Failed to set file importance: " + error, true)` | `mcpError("OPERATION_FAILED", "Failed to set file importance: " + error)` |
| `createMcpResponse("Failed to exclude and remove file or pattern: " + error, true)` | `mcpError("OPERATION_FAILED", "Failed to exclude and remove: " + error)` |
| `{ content: [{ type: "text", text: "Error: Broker not connected..." }], isError: true }` (line 372) | `mcpError("BROKER_DISCONNECTED", "Broker not connected. Check LLM config in .filescope/config.json (llm.enabled must be true).")` |
| `createMcpResponse("No communities detected..." , true)` | `mcpError("NOT_FOUND", "No communities detected (no local import edges).")` |
| `createMcpResponse("File not found in any community: ...")` | `mcpError("NOT_FOUND", "File not found in any community: ${file_path}")` |

---

#### `set_base_directory` error handling note (Pitfall 4)

`set_base_directory` currently returns `coordinator.init(params.path)` directly.
`coordinator.init()` returns `ToolResponse` with its own format.
Per RESEARCH.md Pitfall 4 and assumption A2: accept that `set_base_directory` success/error
format is coordinator-controlled. The tool handler wraps the result — normalize at the handler
level if needed, but do not change `coordinator.ts`.

---

### `src/mcp-server.test.ts` (test, static-source verification)

**Analog:** `src/mcp-server.test.ts` (self — one line change in the existing test)

**Current assertion pattern** (line 537):
```typescript
expect(src).toContain(`server.tool("${toolName}"`);
```

**Target assertion pattern** (same line, updated string):
```typescript
expect(src).toContain(`server.registerTool("${toolName}"`);
```

The test at lines 509-539 reads `src/mcp-server.ts` as a text file and checks that each
of the 13 tool names appears in a `server.tool("name"` call. After migration, the call
becomes `server.registerTool("name"` — update the string literal accordingly.

No other changes to this test file.

---

### `tests/unit/tool-outputs.test.ts` (test, static-source verification)

**Analog:** `src/mcp-server.test.ts` (mirror of the same pattern)

**Current assertion pattern** (line 444):
```typescript
expect(src).toContain(`server.tool("${tool}"`);
```

**Target assertion pattern** (same line, updated string):
```typescript
expect(src).toContain(`server.registerTool("${tool}"`);
```

The test at lines 420-447 is structurally identical to the one in `mcp-server.test.ts`.
Same single-line change: update the string from `server.tool(` to `server.registerTool(`.

No other changes to this test file.

---

## Shared Patterns

### Initialization Guard (applies to 12 of 13 tools)

**Source:** `src/mcp-server.ts` lines 187, 221, 261, 301, etc. (current `projectPathNotSetError` usage)

Every tool except `set_base_directory` begins with this guard. After migration:
```typescript
if (!coordinator.isInitialized()) {
  return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
}
```

Delete the `projectPathNotSetError` variable (line 173-176). Replace all 12 return sites
with the inline `mcpError()` call above.

---

### File-Not-Found Guard (applies to `get_file_summary`, `set_file_summary`, `set_file_importance`, `get_cycles_for_file`)

**Source:** `src/mcp-server.ts` lines 264-267, 305-308, 330-340, 469-472

Pattern after migration:
```typescript
const normalizedPath = normalizePath(filepath);
const node = getFile(normalizedPath);
if (!node) {
  return mcpError("NOT_FOUND", `File not found in database: ${filepath}`);
}
```

---

### Broker Connection Guard (applies to `scan_all`)

**Source:** `src/mcp-server.ts` lines 371-373

Pattern after migration:
```typescript
if (!brokerIsConnected()) {
  return mcpError("BROKER_DISCONNECTED", "Broker not connected. Check LLM config in .filescope/config.json (llm.enabled must be true).");
}
```

---

### Success Response Wrapping (applies to all tools)

**Source:** `src/mcp-server.ts` lines 192, 200-214, 251-255, etc. (current `createMcpResponse(data)` calls)

All calls to `createMcpResponse(someObject)` (no second arg or `false`) become:
```typescript
return mcpSuccess({ field1: value1, field2: value2 });
```

The `mcpSuccess` helper spreads the data object: `{ ok: true, ...data }`.
Existing response data shapes are preserved — no field changes, just wrapper change.

---

## No Analog Found

All files modified in this phase have existing analogs. No net-new files are created.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| — | — | — | All changes are in-place modifications of existing files |

---

## Migration Order Recommendation

For the planner: the three files must be modified in this order to keep the test suite
passing between steps:

1. `src/mcp-server.ts` — migrate all 13 tools, replace helper, update constructor
2. `src/mcp-server.test.ts` — update `server.tool(` string to `server.registerTool(`
3. `tests/unit/tool-outputs.test.ts` — update `server.tool(` string to `server.registerTool(`

Steps 2 and 3 can be done simultaneously (they are independent of each other, dependent only on step 1).

---

## Metadata

**Analog search scope:** `src/mcp-server.ts`, `src/mcp-server.test.ts`, `tests/unit/tool-outputs.test.ts`, `src/types.ts`, `src/coordinator.ts`, `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`
**Files scanned:** 7
**Pattern extraction date:** 2026-04-17
