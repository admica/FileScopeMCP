# Phase 38: MCP Surface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 38-mcp-surface
**Areas discussed:** Repository query design, filePath disambiguation, unresolvedCount computation, Integration test fixtures
**Mode:** `--auto` — all areas auto-selected, recommended defaults chosen

---

## Repository Query Design

| Option | Description | Selected |
|--------|-------------|----------|
| LEFT JOIN + self-loop WHERE | JOIN symbol_dependencies + symbols + files, exclude self-loops in WHERE | ✓ |
| Subquery-first approach | Find symbol IDs first, then query symbol_dependencies | |

**User's choice:** [auto] LEFT JOIN + self-loop WHERE — standard JOIN pattern matching existing `findSymbols` approach
**Notes:** Two-query pattern (COUNT + SELECT-with-LIMIT) mirrors `findSymbols` at repository.ts:1049. Self-loop exclusion via `WHERE caller_symbol_id != callee_symbol_id` per ROADMAP cross-cutting notes.

---

## filePath Disambiguation

| Option | Description | Selected |
|--------|-------------|----------|
| Filter target symbol's file | filePath narrows which symbol(s) to look up callers/callees for | ✓ |
| Filter result items' file | filePath filters the returned caller/callee items by their file path | |

**User's choice:** [auto] Filter target symbol's file — consistent with find_symbol's implicit path scoping
**Notes:** When multiple symbols share a name (e.g., reopened Ruby classes), filePath disambiguates WHICH symbol's callers/callees to return. Without filePath, all matching symbols included.

---

## unresolvedCount Computation

| Option | Description | Selected |
|--------|-------------|----------|
| Dangling FK count at query time | COUNT symbol_dependencies rows where opposite-side symbol ID no longer exists in symbols table | ✓ |
| Always zero (defer) | Return 0, document as future enhancement | |
| Store at extraction time | Add unresolved counter to Phase 37's write path (scope creep) | |

**User's choice:** [auto] Dangling FK count at query time — honest staleness signal from existing data, no Phase 37 changes
**Notes:** Leverages Phase 37's caller-authoritative/callee-eventual-consistency model (D-19). Non-zero when a callee file was renamed/deleted without re-scanning its callers. Computed via `NOT IN (SELECT id FROM symbols)` subquery.

---

## Integration Test Fixtures

| Option | Description | Selected |
|--------|-------------|----------|
| Multi-file TS with cross-file calls | Two+ TS files with import+call pattern, extend existing mcp-transport.test.ts | ✓ |
| Separate test file | New test file dedicated to find_callers/find_callees | |

**User's choice:** [auto] Multi-file TS with cross-file calls — consistent with v1.5 mcp-transport.test.ts pattern
**Notes:** Extend existing beforeAll with additional fixture files. Test envelope shape, maxItems clamping, self-loop exclusion, empty results, NOT_INITIALIZED error.

---

## Claude's Discretion

- Exact SQL query shape (subquery vs JOIN for symbol lookup step)
- Whether getCallers and getCallees share a private helper
- Whether unresolvedCount query is inlined or factored
- Fixture file content for integration tests
- Ordering of tool descriptions in registerTools()

## Deferred Ideas

None — discussion stayed within phase scope.
