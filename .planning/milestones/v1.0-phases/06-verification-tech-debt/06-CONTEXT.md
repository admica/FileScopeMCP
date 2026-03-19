# Phase 6: Verification & Tech Debt Cleanup - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Close 9 partial requirements (STOR-01 through STOR-07, COMPAT-01, COMPAT-03) by creating VERIFICATION.md files for Phases 1 and 2, and fix 3+ tech debt items identified in the v1.0 audit. This is housekeeping — the requirements were already implemented in Phases 1-2, this phase formally verifies and closes them.

</domain>

<decisions>
## Implementation Decisions

### Verification depth
- Run existing tests, capture results as evidence. Add targeted integration tests only where gaps exist.
- VERIFICATION.md references test file:line and test name per requirement — no output snapshots (references stay stable, output goes stale).
- If a requirement has no existing test coverage, write a minimal focused integration test to fill the gap. One test per gap.
- Auto-mark requirements complete: if tests pass, mark the requirement as verified in VERIFICATION.md and update REQUIREMENTS.md traceability. No manual sign-off ceremony.

### Console.error scope
- Fix all four files with console.error bypass, not just the two listed in success criteria: storage-utils.ts, global-state.ts, file-watcher.ts, config-utils.ts.
- Convert to proper log levels: errors to logger.error(), lifecycle events to logger.info(), debug noise (path resolution, config dumps) to logger.debug().
- Extend the logger module with error(), warn(), info(), debug() methods. debug() suppressed in daemon mode, error() always shown. Minimal addition (~20 lines).

### DB lifecycle
- Coordinator owns the DB lifecycle — opens DB once during init, runs migration if needed, then proceeds.
- Migration becomes a function that receives an open DB handle rather than opening its own connection. Single owner, single lifecycle.
- Migration detects "already migrated" state and skips. Check if SQLite already has data; if yes, no-op. Safe for restarts and re-runs.

### Claude's Discretion
- Exact log level assignment per console.error call (which are debug vs info vs error)
- Test structure for gap-filling integration tests
- VERIFICATION.md formatting and section layout

</decisions>

<specifics>
## Specific Ideas

- This tool is built for LLM agents to use — keep it useful, not ceremonial. Verification docs should help future Claude sessions quickly understand "what's done" without re-reading Phase 1/2 code.
- Phase 6 is housekeeping before the high-value work (Phase 4 Cascade, Phase 5 LLM Pipeline). Keep it tight and fast.
- User wants honest assessment of utility at each phase — this project should remain a tool LLMs actually want to use for tracking file relationships and metadata in large codebases.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/logger.ts`: Existing logger with basic log() method and daemon-mode file logging. Extend with level methods.
- `src/db/db.ts`: openDatabase/closeDatabase singleton pattern. Migration function needs refactoring to accept handle.
- 73+ existing tests across db, repository, change-detector, and migration modules.

### Established Patterns
- TDD (RED-GREEN-REFACTOR) used consistently in Phases 1-3
- ESM with createRequire bridge for native modules (better-sqlite3, tree-sitter)
- esbuild without --bundle flag; native addons resolve from node_modules at runtime

### Integration Points
- `src/coordinator.ts:181` — openDatabase() call, the single point that should own DB lifecycle
- `src/migrate/json-to-sqlite.ts:123` — openDatabase() call to be refactored to receive handle
- `src/storage-utils.ts:10` — dead `getChildren` import to remove
- Console.error locations: storage-utils.ts (~18), global-state.ts (~6), file-watcher.ts (~20), config-utils.ts (~18)

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 06-verification-tech-debt*
*Context gathered: 2026-03-17*
