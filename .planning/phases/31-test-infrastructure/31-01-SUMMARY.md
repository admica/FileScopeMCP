---
phase: 31-test-infrastructure
plan: "01"
subsystem: test-infrastructure
tags: [testing, vitest, mcp, integration-tests, coverage]
dependency_graph:
  requires: []
  provides: [mcp-transport-tests, coverage-scoping]
  affects: [src/mcp-server.ts, vitest.config.ts, tests/integration/]
tech_stack:
  added: []
  patterns: [InMemoryTransport test harness, real SQLite in temp dir, broker mock]
key_files:
  created:
    - tests/integration/mcp-transport.test.ts
  modified:
    - src/mcp-server.ts
    - vitest.config.ts
decisions:
  - "Used InMemoryTransport.createLinkedPair() from MCP SDK for in-process transport testing (no stdio, no subprocess)"
  - "Adapted tool list to actual registered tools — plan interfaces section was outdated (listed v1.0 tool names, current code has v1.4 names)"
  - "Did not pre-open DB before coordinator.init() — coordinator.init() manages DB lifecycle internally (calls openDatabase and closeDatabase)"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-18T06:48:25Z"
  tasks_completed: 2
  files_modified: 3
  tests_added: 22
---

# Phase 31 Plan 01: MCP Transport Integration Tests and Coverage Scoping Summary

MCP transport-layer integration tests exercising all 13 registered tools through InMemoryTransport with a real SQLite DB and real ServerCoordinator, plus V8 coverage scoping to 8 production subsystem directories.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Export registerTools and scope vitest coverage config | 9c03718 | src/mcp-server.ts, vitest.config.ts |
| 2 | Create MCP transport integration tests for all 13 tools | cb81460 | tests/integration/mcp-transport.test.ts |

## What Was Built

**Task 1 — Two minimal production changes:**

1. `src/mcp-server.ts` line 148: Added `export` keyword to `registerTools`. This enables test code to import and call `registerTools(server, coordinator)` directly without needing to start the full MCP server process. This is the only change to the file.

2. `vitest.config.ts`: Replaced the 13-line config with a 29-line config that scopes V8 coverage to 8 production subsystem directories (`src/broker/**`, `src/cascade/**`, `src/change-detector/**`, `src/db/**`, `src/coordinator.ts`, `src/file-watcher.ts`, `src/config-utils.ts`, `src/mcp-server.ts`) and excludes Nexus Svelte UI (`src/nexus/**`), pure type files (`src/types.ts`), and test files.

**Task 2 — MCP transport integration tests:**

`tests/integration/mcp-transport.test.ts` (338 lines, 22 test cases) exercises all 13 MCP tools:
1. `list_files` — tree mode and flat maxItems mode
2. `find_important_files` — with and without maxItems
3. `get_file_summary` — success on tracked file, NOT_FOUND on nonexistent
4. `set_file_summary` — success, NOT_FOUND error path
5. `set_file_importance` — success, NOT_FOUND error path
6. `scan_all` — BROKER_DISCONNECTED (broker mocked as disconnected)
7. `search` — matching query and empty-result query
8. `status` — project/llm/broker/fileWatching fields present
9. `exclude_and_remove` — response is valid (ok:true or error with defined error field)
10. `detect_cycles` — cycles array and counts, zero cycles for simple project
11. `get_cycles_for_file` — empty cycles for tracked file, NOT_FOUND for missing file
12. `get_communities` — communities array with totalCommunities count
13. `set_base_directory` — re-init to same tmpDir, valid response

Test infrastructure: `beforeAll` creates temp dir, writes `sample.ts`, calls `coordinator.init(tmpDir)` (not `initServer()` — per RESEARCH.md anti-pattern), creates `McpServer`, calls `registerTools`, creates `InMemoryTransport` pair, connects client. `afterAll` closes client, server, coordinator, DB, removes tmpDir.

## Verification

```
npx vitest run tests/integration/mcp-transport.test.ts
 ✓ tests/integration/mcp-transport.test.ts (22 tests) 139ms
 Test Files  1 passed (1)
      Tests  22 passed (22)

grep "export function registerTools" src/mcp-server.ts
  → line 148: export function registerTools(server: McpServer, coordinator: ServerCoordinator): void {

npx tsc --noEmit
  → exit 0 (no type errors)

grep -c "src/broker" vitest.config.ts
  → 1 (coverage.include contains src/broker/**)
```

## Deviations from Plan

### Auto-adapted Issues

**1. [Rule 1 - Adaptation] Tool list in plan interfaces was outdated**
- **Found during:** Task 2, when creating the test file
- **Issue:** The plan's `<interfaces>` section listed 13 tool names from an older codebase version (e.g., `get_dependencies`, `get_dependents`, `check_staleness`, `get_project_overview`, `search_files`, `refresh_file`, `get_change_impact`, `get_file_communities`, `rebuild_communities`). None of these tool names exist in the current `src/mcp-server.ts`. The actual registered tools are: `set_base_directory`, `list_files`, `find_important_files`, `get_file_summary`, `set_file_summary`, `set_file_importance`, `scan_all`, `search`, `status`, `exclude_and_remove`, `detect_cycles`, `get_cycles_for_file`, `get_communities`.
- **Fix:** Wrote tests against the actual 13 tools currently registered in `mcp-server.ts`. All 22 tests pass.
- **Files modified:** tests/integration/mcp-transport.test.ts
- **Commit:** cb81460

**2. [Rule 1 - Adaptation] DB lifecycle managed by coordinator.init()**
- **Found during:** Task 2, reviewing coordinator.ts
- **Issue:** The plan's `beforeAll` pseudocode called `openDatabase(...)` before `coordinator.init(tmpDir)`. But `coordinator.init()` internally calls `closeDatabase()` then `openDatabase()` at `tmpDir/.filescope/data.db`. Pre-opening a different DB path would be immediately overridden.
- **Fix:** Removed the explicit `openDatabase` call from the test setup. Let `coordinator.init(tmpDir)` manage the DB lifecycle entirely. The `afterAll` still calls `closeDatabase()` defensively after `coordinator.shutdown()` (which already calls `closeDatabase()`).
- **Files modified:** tests/integration/mcp-transport.test.ts
- **Commit:** cb81460

## Known Stubs

None.

## Threat Flags

No new security-relevant surface introduced. Tests are isolated to `os.tmpdir()` subdirectories and in-process transport only.

## Self-Check: PASSED

- [x] `tests/integration/mcp-transport.test.ts` exists (338 lines)
- [x] `export function registerTools` present at line 148 of `src/mcp-server.ts`
- [x] `vitest.config.ts` contains `include:` inside `coverage:` block with 8 patterns
- [x] Commit 9c03718 exists: `feat(31-01): export registerTools and scope vitest coverage config`
- [x] Commit cb81460 exists: `feat(31-01): add MCP transport integration tests for all 13 tools`
- [x] All 22 tests pass
- [x] TypeScript compiles with no errors
