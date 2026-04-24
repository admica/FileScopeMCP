# Phase 34 Deferred Items

Pre-existing test failures discovered during Plan 01 execution, confirmed via `git stash && npx vitest run` to be unrelated to Plan 01 changes (repository.ts + repository.symbols.test.ts only).

## Pre-existing failures (out of scope for Plan 01)

### 1. `tests/unit/parsers.test.ts` — "very large file does not crash (10K lines)"
- **File:** `tests/unit/parsers.test.ts:475`
- **Failure:** Timeout at 5000ms default test timeout.
- **Verified pre-existing:** Reproduces without Plan 01 changes.
- **Scope:** Parser / ast-parser performance on 10K-line files — entirely outside Phase 34 MCP surface scope.
- **Action:** None. Track for parser/performance-focused phase if adoption telemetry shows it matters.

### 2. `tests/integration/mcp-stdout.test.ts` — "first byte of mcp-server.js stdout is { (ASCII 0x7B)"
- **File:** `tests/integration/mcp-stdout.test.ts`
- **Failure:** MCP stdout pollution smoke test.
- **Verified pre-existing:** Failed before Plan 01 commits; unrelated to repository helpers.
- **Scope:** MCP server binary stdout cleanliness — not changed by Plan 01 (which only adds repository helpers).
- **Action:** None. Likely an environmental issue or prior regression. Track separately.

## Plan 01 scope verification

- Full Plan 01 target (`src/db/repository.symbols.test.ts`): all 36 tests pass (18 pre-existing + 18 new).
- `npm run build`: clean exit.
- `npx tsc --noEmit`: clean.
