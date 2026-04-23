---
phase: 30-mcp-spec-compliance
plan: "01"
subsystem: mcp-server
tags: [mcp, spec-compliance, api-migration, annotations, structured-responses]
dependency_graph:
  requires: []
  provides: [mcp-tool-registrations, structured-error-responses, tool-annotations]
  affects: [src/mcp-server.ts]
tech_stack:
  added: []
  patterns: [registerTool-config-object, mcpError-mcpSuccess-helpers, ErrorCode-type, ToolAnnotations]
key_files:
  modified:
    - src/mcp-server.ts
decisions:
  - "Tasks 1 and 2 committed as single atomic unit: file does not compile until all createMcpResponse calls are removed, so split commits would break TypeScript invariant"
  - "list_files tree mode wraps FileNode in mcpSuccess({ tree: ... }) for uniform ok:true response format"
  - "search result passed through as-is via type cast — searchFiles returns structured data that is spread into ok:true wrapper"
  - "set_base_directory is the one tool that returns coordinator.init() result directly per research Pitfall 4 / Assumption A2 — coordinator.ts not modified"
metrics:
  duration: "~18 minutes"
  completed: "2026-04-17"
  tasks_completed: 2
  files_modified: 1
---

# Phase 30 Plan 01: MCP Spec Compliance — registerTool Migration Summary

Migrated all 13 MCP tools from deprecated `server.tool()` to `server.registerTool()` with proper config objects, explicit `ToolAnnotations`, enriched descriptions, and uniform structured JSON responses (`{ ok: true/false, ... }`).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Replace response helpers and remove listChanged capability | 0e721da | src/mcp-server.ts |
| 2 | Migrate all 13 tools to registerTool with annotations, descriptions, and structured responses | 0e721da | src/mcp-server.ts |

## What Was Built

**mcpError() / mcpSuccess() helpers** — Replace the polymorphic `createMcpResponse()` with two focused helpers:
- `mcpError(code: ErrorCode, message: string)` returns `{ ok: false, error: code, message }` with `isError: true`
- `mcpSuccess(data: Record<string, unknown>)` returns `{ ok: true, ...data }`
- `ErrorCode` type: `NOT_INITIALIZED | INVALID_PATH | BROKER_DISCONNECTED | NOT_FOUND | OPERATION_FAILED`

**Constructor cleanup** — Removed `{ capabilities: { tools: { listChanged: true } } }` from `McpServer` constructor. The SDK registers `listChanged` internally on first `registerTool()` call; the user-space declaration was redundant.

**13-tool migration** — Every `server.tool(name, description, schema, cb)` call converted to `server.registerTool(name, config, cb)` with:
- `title` — human-readable tool name
- `description` — enriched description for LLM consumption (states what it returns, when to use it, preconditions)
- `inputSchema` — Zod raw shape (NOT wrapped in z.object())
- `annotations` — explicit `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` for all 13 tools
- Destructured callback params (e.g., `{ filepath }` instead of `params: { filepath: string }`)

**Error code mapping applied:**
- 12 `projectPathNotSetError` usages → `mcpError("NOT_INITIALIZED", ...)`
- File not found paths → `mcpError("NOT_FOUND", ...)`
- Broker disconnected inline response → `mcpError("BROKER_DISCONNECTED", ...)`
- catch blocks → `mcpError("OPERATION_FAILED", ...)`
- All success `createMcpResponse(data)` → `mcpSuccess(data)`

## Verification Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` exits 0 | PASS |
| `server.tool()` count = 0 | PASS (0) |
| `server.registerTool()` count = 13 | PASS (13) |
| `annotations:` count = 13 | PASS (13) |
| `readOnlyHint:` count = 13 | PASS (13) |
| `destructiveHint:` count = 13 | PASS (13) |
| `openWorldHint:` count = 13 | PASS (13) |
| `createMcpResponse` count = 0 | PASS (0) |
| `listChanged` count = 0 | PASS (0) |
| Error codes present (NOT_INITIALIZED, NOT_FOUND, OPERATION_FAILED, BROKER_DISCONNECTED) | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Tasks 1 and 2 committed as single atomic unit**
- **Found during:** Task 1 verification
- **Issue:** Plan specified committing Task 1 before Task 2, but Task 1 deletes `createMcpResponse()` while Task 2 replaces its call sites. The file does not compile after Task 1 alone — `npx tsc --noEmit` emits 20+ errors. Committing Task 1 separately would leave the repo in a broken state.
- **Fix:** Executed both tasks sequentially before committing, producing a single compile-clean commit covering both.
- **Files modified:** src/mcp-server.ts
- **Commit:** 0e721da

## Known Stubs

None — all tool handlers are fully wired with real data sources.

## Threat Flags

None — no new network endpoints, auth paths, or trust boundaries introduced. Input schemas are unchanged from the prior `server.tool()` registrations; only the registration API and response format changed.

## Self-Check: PASSED

- `src/mcp-server.ts` modified: confirmed (git diff --stat HEAD~1 HEAD shows 1 file, 255 insertions, 161 deletions)
- Commit 0e721da exists: confirmed (`git log --oneline -1` = `0e721da feat(30-01): migrate all 13 MCP tools...`)
- TypeScript compiles: confirmed (`npx tsc --noEmit` exits 0)
- All 13 registerTool() calls present: confirmed (grep -c = 13)
