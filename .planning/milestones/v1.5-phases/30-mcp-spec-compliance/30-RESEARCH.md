# Phase 30: MCP Spec Compliance - Research

**Researched:** 2026-04-17
**Domain:** MCP SDK 1.27.1 tool registration API, ToolAnnotations, structured error responses
**Confidence:** HIGH — all critical claims verified from installed SDK source

## Summary

This phase is a targeted refactor of `src/mcp-server.ts`. All 13 tools are currently registered with the deprecated `server.tool()` API and carry no annotations, leaving MCP clients to assume worst-case behavior for every tool. The migration to `registerTool(name, config, cb)` is a mechanical transformation: the description and Zod schema fields move from positional arguments into a config object, and annotation fields are added to the same config object.

The `listChanged` situation has a subtlety worth knowing: the SDK **always** calls `server.registerCapabilities({ tools: { listChanged: true } })` internally when `setToolRequestHandlers()` runs (which fires on the first `registerTool` or `server.tool` call). The user-space declaration `capabilities: { tools: { listChanged: true } }` in the `McpServer` constructor options is therefore redundant, not the cause of the problem. The actual fix (D-04) is to remove it from the user-space constructor options to avoid any future confusion — the SDK will still declare it, but that is harmless because the SDK also always calls `sendToolListChanged()` on every `_createRegisteredTool()` invocation.

The `outputSchema` feature in `registerTool` requires that the callback return `{ structuredContent: {...}, content: [...] }` — not just `content`. If `outputSchema` is declared but `structuredContent` is absent from the return, the SDK throws `McpError(InvalidParams)`. Given that all 13 tools currently return via `createMcpResponse()` which only produces `{ content, isError }`, using `outputSchema` requires modifying every callback return to also supply `structuredContent`. The CONTEXT.md decision (D-02) leaves `outputSchema` use at Claude's discretion; the path of least resistance is to skip `outputSchema` on all tools and rely on the `content[0].text` JSON string approach — it is simpler and the `{ ok: true/false }` response structure is enforced by convention rather than SDK validation.

**Primary recommendation:** Migrate all 13 tools to `registerTool()` with a raw-shape `inputSchema`, add annotations per the D-06 classification, remove the `capabilities` constructor option, refactor `createMcpResponse()` into a helper that returns `{ ok: false, error: "CODE", message: "..." }` objects on error paths. Do not use `outputSchema` — it forces a breaking change to all 13 callback return signatures with no significant benefit for this use case.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Migrate all 13 tools from `server.tool()` to `registerTool(name, config, cb)` with config object containing `title`, `description`, `inputSchema`, `annotations`.
- **D-02:** Use `outputSchema` on `registerTool` where it adds value for response format consistency. SDK validates response shape at registration time — no custom wrapper needed.
- **D-03:** No backward compatibility shims, no legacy code paths. Delete `server.tool()` calls entirely.
- **D-04:** Remove `tools: { listChanged: true }` from server capabilities. Tool list is static.
- **D-05:** Annotate ALL 13 tools explicitly. SDK defaults are `destructiveHint: true` and `openWorldHint: true` — unannotated tools are assumed worst-case. Every tool must opt out of bad defaults.
- **D-06:** Classification:
  - **Read-only** (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`): `list_files`, `find_important_files`, `get_file_summary`, `search`, `status`, `detect_cycles`, `get_cycles_for_file`, `get_communities`
  - **Metadata writers** (`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`): `set_file_summary`, `set_file_importance`, `set_base_directory`
  - **Destructive** (`readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: false`, `openWorldHint: false`): `exclude_and_remove`
  - **External interaction** (`readOnlyHint: false`, `destructiveHint: false`, `idempotentHint: false`, `openWorldHint: true`): `scan_all`
- **D-07:** Return structured `{ ok: false, error: "CODE", message: "..." }` objects. Error codes: `NOT_INITIALIZED`, `INVALID_PATH`, `BROKER_DISCONNECTED`, `NOT_FOUND`, `OPERATION_FAILED`.
- **D-08:** Enrich all tool descriptions for LLM consumers — what it returns, when to use vs alternatives, preconditions.
- **D-09:** Uniform JSON response objects: `{ ok: true, ...data }` on success, `{ ok: false, error: "CODE", message: "..." }` on error.

### Claude's Discretion
- Exact error code values (within the ~4-5 code taxonomy)
- Tool description wording (optimized for LLM consumption)
- Whether `outputSchema` is used on all tools or only complex ones
- `idempotentHint` classification for edge cases

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SPEC-01 | All 13+ tools migrated from `server.tool()` to `registerTool()` with `z.object()` input schemas | SDK 1.27.1 `registerTool` signature verified from `mcp.d.ts:150-157`; raw-shape inputSchema (not `z.object()` wrapper) confirmed from SDK examples |
| SPEC-02 | False `listChanged: true` capability removed or backed by actual `sendToolListChanged` calls | SDK always registers `listChanged:true` internally; removing from constructor options is the correct hygiene fix |
| SPEC-03 | Tool annotations added (readOnlyHint, destructiveHint, openWorldHint) per MCP spec | `ToolAnnotations` interface verified from `spec.types.d.ts:1097-1135`; all 5 hint fields confirmed |
| SPEC-04 | Structured MCP error codes returned instead of generic error strings | Current `createMcpResponse(string, true)` pattern identified; replacement `{ ok: false, error, message }` in content[0].text is the standard approach |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool registration API migration | MCP Server layer (`src/mcp-server.ts`) | — | All 13 registrations are in `registerTools()` in this single file |
| Capability declaration | MCP Server constructor | SDK internal | SDK owns `listChanged` internally; user-space change is removing the redundant declaration |
| Tool annotations | MCP Server layer | — | `annotations` field in `registerTool` config object |
| Error response format | MCP Server layer | `coordinator.ts` (for init errors) | `createMcpResponse()` helper is in `mcp-server.ts`; coordinator `init()` returns `ToolResponse` that flows through |
| Test assertions | `src/mcp-server.test.ts`, `tests/unit/tool-outputs.test.ts` | — | Two test files check for `server.tool("name"` string in source — must update to `registerTool` pattern |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | 1.27.1 | MCP server base, tool registration, capability management | Already installed — this is the only SDK in use |
| `zod` | (project's existing version) | Input schema raw shapes for `inputSchema` config field | Already used for inline schemas; same API, moved into config object |

**Version verification:** `@modelcontextprotocol/sdk@1.27.1` confirmed from `node_modules/@modelcontextprotocol/sdk/package.json`. [VERIFIED: local node_modules]

**Installation:** No new packages needed. Phase is a refactor of existing dependencies.

### Key API: `registerTool` Signature
```typescript
// Source: node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts:150-157
server.registerTool(
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema?: ZodRawShapeCompat | AnySchema;  // raw shape OR z.object()
    outputSchema?: ZodRawShapeCompat | AnySchema;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  },
  cb: ToolCallback<InputArgs>
): RegisteredTool;
```

**Critical:** `inputSchema` accepts a **raw shape** (`{ field: z.string() }`) directly — not a `z.object()` wrapper. The SDK wraps it internally. All SDK examples use raw shapes. Using `z.object({ field: z.string() })` also works (it satisfies `AnySchema`), but raw shape is the idiomatic approach. [VERIFIED: SDK examples in `node_modules/@modelcontextprotocol/sdk/dist/esm/examples/`]

## Architecture Patterns

### System Architecture Diagram

```
Client (Claude Code)
        |
        | JSON-RPC over stdio
        v
  StdioTransport (custom, in mcp-server.ts)
        |
        v
  McpServer (SDK) ← registerTool() calls populate _registeredTools map
        |
        | dispatches to registered callback
        v
  registerTools() in mcp-server.ts
    ├── coordinator.isInitialized() guard → NOT_INITIALIZED error
    ├── coordinator methods (for complex ops)
    └── repository functions (for pure DB reads)
        |
        v
  ToolResponse: { content: [{ type: "text", text: JSON.stringify({ok, ...}) }] }
```

### Current vs Target Registration Pattern

**Current (deprecated `server.tool()`):**
```typescript
// Source: src/mcp-server.ts:184
server.tool("list_files", "List all files in the project...", {
  maxItems: z.number().optional().describe("...")
}, async (params) => {
  // returns createMcpResponse(...)
});
```

**Target (`registerTool()`):**
```typescript
// Pattern: SDK examples + mcp.d.ts:150-157
server.registerTool("list_files", {
  title: "List Files",
  description: "List all files in the project with importance rankings. Returns a file tree (no maxItems) or flat sorted list (with maxItems). Call status first to verify initialization. Prefer find_important_files when you only need high-importance files.",
  inputSchema: {
    maxItems: z.number().optional().describe("Cap response to N files sorted by importance. Omit for full tree.")
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ maxItems }) => {
  if (!coordinator.isInitialized()) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "NOT_INITIALIZED", message: "Call set_base_directory first or restart with --base-dir." }) }], isError: true };
  }
  // ...
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, files: [...] }) }] };
});
```

### ToolAnnotations Interface (Full)
```typescript
// Source: node_modules/@modelcontextprotocol/sdk/dist/esm/spec.types.d.ts:1097-1135
interface ToolAnnotations {
  title?: string;           // human-readable name (note: title also goes in config root)
  readOnlyHint?: boolean;   // default: false — tool does NOT modify environment
  destructiveHint?: boolean; // default: true  — tool MAY perform destructive updates
  idempotentHint?: boolean;  // default: false — repeated calls with same args = same result
  openWorldHint?: boolean;   // default: true  — tool interacts with external systems
}
```

**SDK defaults are the worst-case.** An unannotated tool is assumed: destructive, non-idempotent, open-world. Every tool MUST explicitly declare its actual behavior.

### Error Response Pattern (SPEC-04)
```typescript
// Pattern replacing createMcpResponse(string, true)
function errorResponse(code: string, message: string): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: code, message }) }],
    isError: true,
  };
}

// Usage:
if (!coordinator.isInitialized()) return errorResponse("NOT_INITIALIZED", "...");
if (!node) return errorResponse("NOT_FOUND", `File not found: ${params.filepath}`);
if (!brokerIsConnected()) return errorResponse("BROKER_DISCONNECTED", "...");
```

### Success Response Pattern (SPEC-04 / D-09)
```typescript
// Pattern for uniform { ok: true, ...data } success responses
function successResponse(data: object): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, ...data }) }],
  };
}
```

### Zero-Argument Tools (status, detect_cycles)
```typescript
// Tools with no inputs: use empty inputSchema or omit entirely
server.registerTool("status", {
  title: "System Status",
  description: "...",
  inputSchema: {},   // empty object, not undefined, for clarity
  annotations: { readOnlyHint: true, destructiveHint: false, ... },
}, async () => { ... });
```

### Anti-Patterns to Avoid
- **Wrapping inputSchema in `z.object()`:** The SDK accepts raw shapes directly. `z.object({ field: z.string() })` works but is redundant — use `{ field: z.string() }` as the raw shape.
- **Omitting annotations:** Unannotated tools default to destructive and open-world. Even tools that the programmer considers "obviously safe" must be explicitly annotated.
- **Using `outputSchema` without changing return type:** If `outputSchema` is declared, the callback MUST return `{ structuredContent: {...}, content: [...] }`. Missing `structuredContent` throws `McpError(InvalidParams)` from SDK's `validateToolOutput`. Since all current callbacks return via `createMcpResponse()` (content-only), do not add `outputSchema` unless all 13 return signatures are updated simultaneously.
- **String error messages:** `createMcpResponse("File not found", true)` produces unstructured text. An LLM agent cannot programmatically distinguish error codes. Always use the `{ ok: false, error, message }` pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input schema validation | Custom validator | Zod raw shape in `inputSchema` | SDK validates at call time; errors returned as MCP protocol errors automatically |
| Capability advertisement | Custom JSON merging | SDK `registerCapabilities()` (internal) | SDK merges capabilities internally on first tool registration |
| Tool list serialization | JSON serializer | SDK `ListToolsRequestSchema` handler | SDK already handles this; just provide `inputSchema` and `annotations` in config |

**Key insight:** The SDK does all protocol-level work. The implementation task is purely: restructure the registration call and refactor the error helper.

## Common Pitfalls

### Pitfall 1: outputSchema Requires structuredContent in Return
**What goes wrong:** Developer adds `outputSchema: { ok: z.boolean(), ... }` to `registerTool` config, but the callback still returns `createMcpResponse(data)` which produces `{ content, isError }` without `structuredContent`. SDK throws `McpError(InvalidParams, "Tool X has an output schema but no structured content was provided")`.
**Why it happens:** The requirement to add `structuredContent` to every return is non-obvious from the type signature alone.
**How to avoid:** Either (a) skip `outputSchema` entirely (recommended for this phase) or (b) update ALL 13 callback returns to supply `structuredContent` alongside `content`.
**Warning signs:** TypeScript will not catch this at compile time — it's a runtime SDK validation error.

### Pitfall 2: SDK Always Declares listChanged Internally
**What goes wrong:** Developer removes `capabilities: { tools: { listChanged: true } }` from constructor options, expects MCP clients to stop caching tool lists. But clients still receive `listChanged: true` because the SDK registers it internally on first `registerTool` call.
**Why it happens:** The SDK calls `server.registerCapabilities({ tools: { listChanged: true } })` in `setToolRequestHandlers()`, which fires on every `registerTool()` call.
**How to avoid:** Understand that the constructor-level removal is about code hygiene and eliminating the explicit user declaration — not about changing the advertised capability. The spec behavior is technically unchanged. If true non-listChanged behavior were needed, a different SDK or protocol version would be required.
**Warning signs:** This is not a pitfall for THIS phase's goal — removing from constructor options is still the right change per D-04.

### Pitfall 3: Test Assertions Expect `server.tool(` String Pattern
**What goes wrong:** Two test files check source code for `server.tool("name"` as a registration existence test. After migration, these assertions fail even though tools work correctly.
**Why it happens:** The tests use static source-code grep rather than runtime introspection.
**How to avoid:** Update the string pattern in both test files simultaneously with the source migration:
  - `src/mcp-server.test.ts:537` — expects `server.tool("${toolName}"`
  - `tests/unit/tool-outputs.test.ts:444` — same pattern for all 13 tools
  Update both to `registerTool("${toolName}"` (or `registerTool(` if the test doesn't need name precision).
**Warning signs:** Test suite fails with `Expected to contain "server.tool("list_files""` after migration.

### Pitfall 4: `coordinator.init()` Returns `ToolResponse`, Not Structured Error
**What goes wrong:** `set_base_directory` delegates to `coordinator.init(params.path)` and returns its result directly. If SPEC-04 uniform error format is needed on init failures, the coordinator's return value must also conform — but changing coordinator risks breaking other callers.
**Why it happens:** The coordinator is shared between MCP mode and daemon mode.
**How to avoid:** Either (a) accept that `set_base_directory` errors don't use the structured error format (coordinator controls its response), or (b) wrap coordinator result in a normalizer. Keep coordinator unchanged; normalize at the tool handler level.
**Warning signs:** `set_base_directory` error responses don't match the `{ ok: false }` pattern.

### Pitfall 5: Empty inputSchema for Zero-Arg Tools
**What goes wrong:** Passing `inputSchema: undefined` or omitting `inputSchema` for zero-argument tools (`status`, `detect_cycles`) causes the callback's `args` type to be `{}` (empty object) but the SDK still expects the callback to accept an `extra` argument as the only parameter, not as the second.
**Why it happens:** When `inputSchema` is `undefined`, `ToolCallback<undefined>` signature is `(extra: Extra) => ...` — the args parameter is gone entirely.
**How to avoid:** Use `inputSchema: {}` (empty raw shape) to keep the `(args, extra) => ...` signature consistent across all tools, or explicitly type the zero-arg callback as `(_, extra) =>`.
**Warning signs:** TypeScript error on `extra.signal` or similar extra-arg access.

## Code Examples

### Complete registerTool Example with All Fields
```typescript
// Source: SDK examples + mcp.d.ts:150-157 + spec.types.d.ts:1097-1135
server.registerTool("get_file_summary", {
  title: "Get File Summary",
  description: "Returns full intelligence for a single file: LLM-generated summary, importance score (0-10), dependency list with edge types, dependents, package dependencies, concepts, change impact, and staleness flags. Use this before editing a file or when you need to understand a file's role. Returns NOT_FOUND if the file is not in the scan database.",
  inputSchema: {
    filepath: z.string().describe("Absolute or relative path to the file"),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ filepath }) => {
  if (!coordinator.isInitialized()) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "NOT_INITIALIZED", message: "Server not initialized. Call set_base_directory first." }) }], isError: true };
  }
  const normalizedPath = normalizePath(filepath);
  const node = getFile(normalizedPath);
  if (!node) {
    return { content: [{ type: "text", text: JSON.stringify({ ok: false, error: "NOT_FOUND", message: `File not found in database: ${filepath}` }) }], isError: true };
  }
  return { content: [{ type: "text", text: JSON.stringify({ ok: true, path: node.path, /* ... */ }) }] };
});
```

### Removing listChanged from Constructor
```typescript
// BEFORE
const server = new McpServer(serverInfo, {
  capabilities: {
    tools: { listChanged: true }  // Remove this entire block
  }
});

// AFTER
const server = new McpServer(serverInfo);
// Note: SDK still internally declares tools.listChanged:true when any tool is registered
```

### Error Code Helper
```typescript
// Source: pattern synthesized from CONTEXT.md D-07, D-09
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

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool(name, desc, schema, cb)` | `server.registerTool(name, config, cb)` | SDK 1.27.1 | Config object consolidates all metadata; cleaner for additions (outputSchema, _meta) |
| No annotations | `ToolAnnotations` in config | MCP spec 2025-11-25 | MCP clients now use hints for UI and safety decisions |
| Generic error strings | Structured `{ ok, error, message }` | Phase 30 | LLM agents can branch on error code without string parsing |

**Deprecated/outdated:**
- `server.tool()`: All overloads marked `@deprecated` in SDK 1.27.1. Use `registerTool` instead.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Removing `capabilities.tools` from McpServer constructor options has no observable effect on MCP clients because SDK registers it anyway | Pitfall 2 | LOW — SDK behavior verified from source; only risk is a different SDK version in production |
| A2 | `set_base_directory` errors are acceptable to leave as coordinator-controlled responses rather than structured `{ ok: false }` | Pitfall 4 | LOW — only affects one tool's error branch; coordinator could be wrapped if needed |

## Open Questions

1. **Should `outputSchema` be used at all in this phase?**
   - What we know: Using `outputSchema` requires every callback to return `structuredContent` alongside `content`, which is a breaking change to all 13 callbacks.
   - What's unclear: Whether D-02 ("use where it adds value") implies any tools should have it.
   - Recommendation: Skip `outputSchema` for all 13 tools in this phase. The `{ ok: true/false }` shape is enforced by convention and the `mcpSuccess`/`mcpError` helpers. Revisit in a future phase if SDK-level output validation becomes a requirement.

2. **Is `idempotentHint: true` correct for `set_base_directory`?**
   - What we know: Calling `set_base_directory("/same/path")` repeatedly re-initializes the coordinator to the same path — effectively idempotent in outcome.
   - What's unclear: Whether re-initialization triggers side effects (file watcher restart, DB reconnect) that make it non-idempotent in process.
   - Recommendation: Set `idempotentHint: true` per D-06. If coordinator re-init is costly, that is a future concern.

## Environment Availability

Step 2.6: SKIPPED — this phase is a pure source code refactor of `src/mcp-server.ts`. No external tools, services, or runtimes beyond the project's TypeScript build chain are needed. TypeScript compiler and Vitest are already verified working in this project.

## Security Domain

This phase has no security-relevant changes. All modifications are to API surface declarations (annotations, registration method), error response format, and capability advertisement. No authentication, authorization, cryptography, or input validation logic is introduced or modified. The input schemas already existed as inline Zod schemas; moving them to `inputSchema` in the config object does not change their validation behavior.

## Sources

### Primary (HIGH confidence)
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` — `registerTool()` signature (lines 150-157), all `server.tool()` overloads marked deprecated, `ToolCallback` type
- `node_modules/@modelcontextprotocol/sdk/dist/esm/spec.types.d.ts` — `ToolAnnotations` interface (lines 1097-1135), all 5 hint fields with defaults documented
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js` — `setToolRequestHandlers()` always registers `listChanged:true`; `_createRegisteredTool()` always calls `sendToolListChanged()`; `validateToolOutput()` throws when `outputSchema` present but `structuredContent` absent
- `node_modules/@modelcontextprotocol/sdk/dist/esm/server/zod-compat.d.ts` — `ZodRawShapeCompat` is `Record<string, AnySchema>` — confirms raw shape (not `z.object()`) is the native type for `inputSchema`
- SDK examples (`jsonResponseStreamableHttp.js`, `toolWithSampleServer.js`, `progressExample.js`) — confirm raw shape `inputSchema` usage pattern
- `src/mcp-server.ts` — all 13 current tool registrations, capabilities declaration, `createMcpResponse()` helper
- `src/mcp-server.test.ts:510-539` — test that greps source for `server.tool("name"` pattern — must be updated
- `tests/unit/tool-outputs.test.ts:420-446` — same test pattern — must be updated

### Secondary (MEDIUM confidence)
- None — all claims verified from local installed sources

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — installed SDK source read directly
- Architecture: HIGH — all 13 tools inspected in `mcp-server.ts`; callback patterns confirmed
- Pitfalls: HIGH — SDK implementation logic read from `mcp.js` (not just type signatures)

**Research date:** 2026-04-17
**Valid until:** SDK version pinned at 1.27.1; valid until SDK upgrade
