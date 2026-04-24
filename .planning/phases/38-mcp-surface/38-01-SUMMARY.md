---
phase: 38-mcp-surface
plan: "01"
subsystem: mcp-surface
tags: [repository, mcp-tools, call-graph, symbol-dependencies]
dependency_graph:
  requires: [phase-37-ts-js-call-site-edge-extraction]
  provides: [find_callers-mcp-tool, find_callees-mcp-tool, getCallers-export, getCallees-export]
  affects: [src/db/repository.ts, src/mcp-server.ts]
tech_stack:
  added: []
  patterns: [COUNT+SELECT-two-query-pattern, parameterized-IN-placeholders, unresolvedCount-dangling-FK-query]
key_files:
  created: [tests/unit/find-callers-callees.test.ts]
  modified: [src/db/repository.ts, src/mcp-server.ts]
decisions:
  - filePath parameter narrows target symbol lookup (not the caller's file)
  - unresolvedCount computed at query time via NOT IN (SELECT id FROM symbols)
  - Self-loop exclusion via caller_symbol_id != callee_symbol_id in WHERE (both COUNT and SELECT)
  - getCallers and getCallees are two independent functions (no shared helper) for clarity
  - description as string[].join(' ') literal matching find_symbol pattern
metrics:
  duration: "~8 minutes"
  completed: "2026-04-24"
  tasks_completed: 3
  files_changed: 3
---

# Phase 38 Plan 01: Repository Helpers + MCP Tool Registration Summary

**One-liner:** `getCallers`/`getCallees` repository helpers with parameterized `symbol_dependencies` JOINs, registered as `find_callers`/`find_callees` MCP tools (tools 16 and 17), with 14 unit tests validating query logic against a real SQLite DB.

## What Was Built

### Task 1: Repository helpers (src/db/repository.ts)

Added `getCallers(name, filePath?, limit)` and `getCallees(name, filePath?, limit)` exports after `findSymbols` and before `getSymbolsForFile`.

Both follow the COUNT + SELECT-with-LIMIT two-query pattern from `findSymbols`. Key design:

- **Symbol lookup:** `SELECT id FROM symbols WHERE name = ? [AND path = ?]` — parameterized, filePath optional
- **COUNT:** Pre-LIMIT, self-loop excluded via `caller_symbol_id != callee_symbol_id`
- **SELECT:** INNER JOIN `symbols` on the opposite-direction FK, ORDER BY `path ASC, start_line ASC`, LIMIT
- **unresolvedCount:** Separate `COUNT(*)` query for edges where the opposite-side FK `NOT IN (SELECT id FROM symbols)` — dangling FK signal per D-06
- **Early return:** `{ items: [], total: 0, unresolvedCount: 0 }` when target symbol not found
- **Parameterized throughout:** `ids` are integer PKs from prior SELECT, `placeholders` are `?` chars only (T-38-01, T-38-02, T-38-03)

### Task 2: MCP tool registration (src/mcp-server.ts)

Imported `getCallers` and `getCallees` in the repository import block. Registered two new tools after `find_symbol` and before `list_changed_since`:

- `find_callers` (tool 16): exact name match, filePath optional, maxItems clamped [1,500] default 50
- `find_callees` (tool 17): same input schema, reversed direction
- Both use `ToolAnnotations`: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false`
- Response envelope: `{ok: true, items: [{path, name, kind, startLine, confidence}], total, truncated?: true, unresolvedCount}` — no `endLine`, no `isExport` per D-12
- Descriptions include: Ruby `attr_accessor` limitation, reopened-class multi-result, staleness/unresolvedCount/scan_all note, self-loop exclusion, NOT_INITIALIZED error, filePath disambiguation, maxItems clamping, example usage
- Format: `string[].join(' ')` literal per D-14

### Task 3: Unit tests (tests/unit/find-callers-callees.test.ts)

14 tests across 8 describe blocks. Uses `setEdgesAndSymbols` to write real `symbol_dependencies` rows via a `seedCallSiteEdges` helper. Coverage:

| Test case | getCallers | getCallees |
|-----------|-----------|-----------|
| Envelope shape (items, total, unresolvedCount, confidence) | yes | yes |
| Empty result for unknown symbol | yes | yes |
| filePath filter restricts target symbol lookup | yes | yes |
| Self-loop exclusion | yes | yes |
| maxItems=0 clamped to 1 | yes | yes |
| maxItems=1000 clamped to 500 | yes | yes |
| unresolvedCount > 0 after symbol deletion | yes | yes |

All 14 tests pass.

## Commits

| Hash | Message |
|------|---------|
| 7ec833a | feat(38-01): add getCallers() and getCallees() repository helpers |
| 567f8c1 | feat(38-01): register find_callers and find_callees MCP tools |
| 47e0b46 | test(38-01): unit tests for getCallers/getCallees repository helpers |

## Deviations from Plan

None — plan executed exactly as written.

- D-13 compliance: all required description elements included (purpose, filePath, maxItems, Ruby attr_accessor, reopened-class, staleness/unresolvedCount/scan_all, self-loop, NOT_INITIALIZED, example)
- D-14 compliance: string[].join(' ') format
- T-38-01 through T-38-04 threat mitigations: all applied

## Known Stubs

None — both tools query real `symbol_dependencies` data from Phase 37 write path.

## Threat Flags

None — no new network endpoints or trust boundaries introduced. Both tools are read-only queries on local SQLite via stdio MCP child process.

## Self-Check: PASSED

- `src/db/repository.ts` — getCallers at line 1095, getCallees at line 1153: FOUND
- `src/mcp-server.ts` — find_callers at line 389, find_callees at line 428: FOUND
- `tests/unit/find-callers-callees.test.ts` — 440 lines: FOUND
- Commit 7ec833a: FOUND
- Commit 567f8c1: FOUND
- Commit 47e0b46: FOUND
- Build: clean (no errors)
- Tests: 14/14 passed
