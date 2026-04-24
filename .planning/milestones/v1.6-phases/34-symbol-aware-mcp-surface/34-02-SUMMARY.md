---
phase: 34-symbol-aware-mcp-surface
plan: 02
subsystem: mcp-server
tags: [mcp, zod, registerTool, typescript, symbols, find_symbol, get_file_summary, vitest]

# Dependency graph
requires:
  - phase: 34-01
    provides: "findSymbols(opts) + getDependentsWithImports(targetPath) repository helpers in src/db/repository.ts"
provides:
  - "find_symbol MCP tool — 14th registered tool, returns {items, total, truncated?} envelope with {path, name, kind, startLine, endLine, isExport} rows"
  - "get_file_summary enrichment — new exports[] field from symbols table (isExport=true, sorted by startLine); dependents[] upgraded from string[] to {path, importedNames, importLines}[]"
  - "scripts/check-find-symbol-desc-len.mjs — pre-merge probe that fails if find_symbol description exceeds 2000 chars"
  - "tests/unit/find-symbol.test.ts — 14 new unit tests across 6 describe groups (exact/prefix/exportedOnly/kind/clamp/truncated)"
  - "tests/unit/file-summary-enrichment.test.ts — 10 new unit tests across 2 describe groups (exports[] + rich dependents[])"
  - "tests/unit/tool-outputs.test.ts — 6 new it blocks (3 find_symbol contract + 3 Phase 34 enrichment) + tool-name registry updated to 14 tools + symbols DDL + imported_names/import_line columns added"
  - "tests/unit/schema-coercion.test.ts — 1 new it block locking find_symbol schema (exportedOnly coerce.boolean().default, maxItems coerce.number.int)"
affects:
  - "Phase 35 (list_changed_since tool will sit next to find_symbol; watcher symbol re-extraction integrates with the find_symbol query path)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "MCP envelope divergence documented: {items, total, truncated?} coexists with existing {files, totalCount, truncated} — new tools adopt the new names per FIND-04"
    - "additive MCP response field via conditional spread (exports ALWAYS present; dependents upgraded in-place, one code path)"
    - "grep-source schema lock pattern extended to cover .default(true) + .int() chained coerce modifiers"

key-files:
  created:
    - "tests/unit/find-symbol.test.ts — 178 lines, 14 it blocks, Shape B fixture"
    - "tests/unit/file-summary-enrichment.test.ts — 126 lines, 10 it blocks, Shape B fixture + direct insertEdge helper"
    - "scripts/check-find-symbol-desc-len.mjs — 18 lines, description-length regression gate"
    - ".planning/phases/34-symbol-aware-mcp-surface/34-02-SUMMARY.md — this summary"
  modified:
    - "src/mcp-server.ts — +61 lines, -2 lines (find_symbol registerTool block, get_file_summary dependents/exports rewrite, description update, three-name import merge, SymbolKind type-only import)"
    - "tests/unit/tool-outputs.test.ts — +123 lines, -3 lines (new imports, symbols DDL + imported_names/import_line cols, clear() helper, two new describe blocks, 14-tool registry)"
    - "tests/unit/schema-coercion.test.ts — +12 lines (find_symbol schema grep-source lock)"

key-decisions:
  - "Extended tests/unit/tool-outputs.test.ts as the contract test home (per R-3 — tests/contract/ does not exist); avoided creating a single-file tests/contract/ directory"
  - "Inlined clamp + projection in the find_symbol handler (5 lines) rather than extracting normalizeFindSymbolArgs() — logic is too small to justify a helper"
  - "Description length gate set at 2000 chars (Task 6 probe exits 1 above threshold); actual length 1197 leaves 40% headroom"
  - "Single-line import format in tests/unit/file-summary-enrichment.test.ts to satisfy line-based grep acceptance criteria (import.*getDependentsWithImports)"

patterns-established:
  - "MCP envelope divergence {items, total, truncated?} coexists with {files, totalCount, truncated} — new tools adopt the new names per FIND-04; existing tools untouched"
  - "get_file_summary adds fields additively without breaking the staleness/summary/concepts path (exports is always present; dependents shape change is sanctioned wire-level break per D-16/SUM-03)"
  - "Tool description as string[].join(' ') literal for easy regex extraction + length probing (find_symbol is first to use this layout)"

requirements-completed:
  - FIND-01
  - FIND-02
  - FIND-03
  - FIND-04
  - FIND-05
  - SUM-01
  - SUM-02
  - SUM-03
  - SUM-04

# Metrics
duration: 8min
completed: 2026-04-23
---

# Phase 34 Plan 02: Symbol-Aware MCP Surface Wiring Summary

**Registered find_symbol MCP tool (14th tool, {items,total,truncated?} envelope) and enriched get_file_summary with exports[] + upgraded dependents[] shape, all backed by Wave 1 repository helpers — one code path, no dual-mode. Added 31 new unit tests across 4 test files plus a description-length probe script.**

## Performance

- **Duration:** ~8 minutes
- **Started:** 2026-04-23T22:25:51Z
- **Completed:** 2026-04-23T22:33:58Z
- **Tasks:** 6 completed
- **Files created:** 4 (2 test files + 1 script + 1 SUMMARY)
- **Files modified:** 3 (mcp-server.ts, tool-outputs.test.ts, schema-coercion.test.ts)

## Accomplishments

- Registered `find_symbol` as the 14th MCP tool in `src/mcp-server.ts` with the D-08 Zod schema (name min(1) + kind optional + exportedOnly z.coerce.boolean.default(true) + maxItems z.coerce.number.int.optional), D-04 maxItems clamp Math.max(1, Math.min(500, maxItems ?? 50)), D-05 ordering (via repository), D-07 conditional truncated key (omitted when full), D-20 long-form description (1197 chars, 9 sentences covering all 7 required facts plus useState* example).
- Replaced `get_file_summary` dependents source from node.dependents string[] fallback to `getDependentsWithImports(normalizedPath)` — one code path, no legacy, breaking wire shape sanctioned by D-16/SUM-03.
- Added `exports[]` field (SUM-01) populated from `getSymbolsForFile(normalizedPath)` filtered to isExport=true, sorted by startLine ASC, projected to {name, kind, startLine, endLine} — always present (empty array for non-TS/JS per SUM-04/D-11).
- Updated `get_file_summary` description (D-21) with the exports[] sentence + importLines navigation hint for agents.
- Created `tests/unit/find-symbol.test.ts` with 14 it blocks: 3 exact match (including case-sensitive + zero-match), 2 prefix match (GLOB + case-sensitive), 2 exportedOnly (default + false), 2 kind filter (narrow + unknown-returns-empty), 3 maxItems clamp (default 50 + 0→1 + 10000→500), 2 truncated envelope (absent when full + present on drop).
- Created `tests/unit/file-summary-enrichment.test.ts` with 10 it blocks: 4 exports[] tests (sorted by startLine + empty for non-TS/JS + only-private-symbols → [] + projection shape strips path/isExport) and 6 dependents[] tests (empty when no sources + multi-edge same-source aggregation with dedupe + NULL imported_names → [] + namespace ['*'] + two-source path ASC + package_import excluded).
- Extended `tests/unit/tool-outputs.test.ts`: added `symbols` table DDL + `idx_symbols_name` + `idx_symbols_path` to beforeAll; added `imported_names TEXT` + `import_line INTEGER` columns to the file_dependencies raw CREATE (phase-33 columns absent from the original DDL); extended `clear()` with DELETE FROM symbols; merged three new repository imports; added `describe('find_symbol response contract (Phase 34)')` with 3 it blocks (zero-match no truncated + shape keys + truncated:true on drop); added `describe('get_file_summary response contract — Phase 34 enrichment')` with 3 it blocks (empty exports for symbolless files + isExport filter + dependents[0] shape); updated tool-name registry from 13 to 14 with find_symbol.
- Extended `tests/unit/schema-coercion.test.ts` with 1 new it block (grep-source pattern, matching the 5 existing tool-specific tests) that locks find_symbol's exportedOnly to z.coerce.boolean().default(true) and maxItems to z.coerce.number().int().
- Created `scripts/check-find-symbol-desc-len.mjs` pre-merge probe (exit 1 if description ≥ 2000 chars); current reading 1197.
- Full vitest suite went from 626 baseline (Phase 33-05 SUMMARY) to 673 passing — +47 delta, target +40..+48.

## Task Commits

Each task was committed atomically:

1. **Task 1: Register find_symbol tool + enrich get_file_summary handler** — `893ff7b` (feat)
2. **Task 2: Add tests/unit/find-symbol.test.ts (D-23 coverage)** — `5382e4e` (test)
3. **Task 3: Add tests/unit/file-summary-enrichment.test.ts (D-24 coverage)** — `da43bb8` (test)
4. **Task 4: Extend tool-outputs.test.ts with find_symbol + Phase 34 contract** — `f86f129` (test)
5. **Task 5: Add find_symbol schema lock to schema-coercion.test.ts** — `ba23c36` (test)
6. **Task 6: Add find_symbol description length probe script** — `84f4308` (chore)

## Files Created/Modified

- `src/mcp-server.ts` — Added `findSymbols`, `getDependentsWithImports`, `getSymbolsForFile` to existing destructured import; added `import type { SymbolKind }` below the runtime imports; replaced `get_file_summary` return block (dependents + exports rewrite); registered `find_symbol` tool immediately after `get_file_summary`; updated `get_file_summary` description (+61 lines, -2 lines).
- `tests/unit/find-symbol.test.ts` — NEW (178 lines). Shape B fixture (openDatabase + real migrations via src/db/db.ts), `simulateFindSymbolResponse` helper mirroring handler-layer clamp + envelope, 14 it blocks.
- `tests/unit/file-summary-enrichment.test.ts` — NEW (126 lines). Shape B fixture, direct `insertEdge` helper for fine-grained control (NULL cases, package_import), `projectExports` helper mirroring the handler-layer projection, 10 it blocks.
- `tests/unit/tool-outputs.test.ts` — Added 3 new destructured imports (findSymbols, getDependentsWithImports, getSymbolsForFile); extended beforeAll DDL with symbols table + 2 indexes + 2 new file_dependencies columns; extended `clear()` with DELETE FROM symbols; added 2 new describe blocks (6 new it blocks); updated tool-name registry from 13→14 (+123 lines, -3 lines).
- `tests/unit/schema-coercion.test.ts` — Added 1 new it block (grep-source pattern) between the search and runtime-parse tests (+12 lines).
- `scripts/check-find-symbol-desc-len.mjs` — NEW (18 lines). Regex-extracts find_symbol description array, joins, asserts length < 2000.

## Decisions Made

- **Extended tests/unit/tool-outputs.test.ts rather than creating tests/contract/mcp-tools.test.ts** — Per RESEARCH R-3, `tests/contract/` does not exist in the repo. The existing `tool-outputs.test.ts` is the de facto contract test home (its header comment says so: "Contract tests for MCP tool response shapes"). Creating a new directory for one file adds structure for structure's sake.
- **Inlined clamp + projection in the find_symbol handler** — 5 lines total (clamp → findSymbols call → truncated derivation → mcpSuccess with conditional spread). A `normalizeFindSymbolArgs()` helper would be premature — called once, re-testable via the already-in-place D-23 tests.
- **Description-length gate at 2000 chars** — chose 2000 over 1500 or 2500 because the current description comes in at 1197 (40% headroom). Probe script fails at ≥ 2000 to catch runaway additions without punishing the current content.
- **Single-line import in tests/unit/file-summary-enrichment.test.ts** — original multi-line import broke the line-based `grep -c "import.*getDependentsWithImports"` acceptance check. Flattened to one line so the plan's literal grep criteria pass; functionality unchanged.
- **Tool description authored as string[].join(' ') literal** — lets the probe script extract the description via a single regex without evaluating JS. Future find_symbol description edits stay legible (one sentence per array entry) and still machine-checkable.

## Deviations from Plan

None — plan executed exactly as written.

All 6 tasks landed verbatim per their `<action>` blocks:

- Task 1: 4 sub-edits (imports → find_symbol register → get_file_summary return → description update) all applied to their exact anchors. Handler body matches the plan's code block character-for-character.
- Task 2: 14 it blocks against plan target of ≥ 10 (target 12) — added 2 extra in the prefix group (case-sensitivity) because both were trivial once the fixture was in place.
- Task 3: 10 it blocks (target 10). Matches plan exactly.
- Task 4: Registry + DDL + 2 new describe blocks (6 new it blocks) land per plan.
- Task 5: 1 new it block placed between `search` and the runtime-parse tests — exact slot per plan.
- Task 6: Probe script content is verbatim from the plan; ran successfully (exit 0, length 1197).

No Rule 1 auto-fixes required (zero bugs introduced).
No Rule 2 auto-adds required (description covers all 7 D-20 facts; error policy NOT_INITIALIZED-only per FIND-05; input validation via Zod schema).
No Rule 3 blocking issues.
No Rule 4 architectural escalations.

## Issues Encountered

- **Two pre-existing test failures persist** — carried over verbatim from Plan 01:
  1. `tests/unit/parsers.test.ts` "very large file does not crash (10K lines)" — 5s timeout on 10K-line synthetic file. Already documented in `deferred-items.md`; not in Phase 34 scope.
  2. `tests/integration/mcp-stdout.test.ts` "first byte of mcp-server.js stdout is { (ASCII 0x7B)" — 12s timeout on MCP subprocess spawn. Already documented in `deferred-items.md`; unchanged by this plan's mcp-server.ts additions.
  Both were verified pre-existing in Plan 01's self-check. Full suite green except for these two — new tests contribute +47 passing, no new failures, no regressions.

## User Setup Required

None — no external service configuration required. find_symbol and the enriched get_file_summary work against the existing SQLite database populated by Phase 33 scan/bulk-extract paths.

## Self-Check: PASSED

Verified files exist:
- FOUND: src/mcp-server.ts (contains registerTool("find_symbol", dependents: getDependentsWithImports, exports: getSymbolsForFile, import type { SymbolKind)
- FOUND: tests/unit/find-symbol.test.ts (14 it blocks, simulateFindSymbolResponse helper)
- FOUND: tests/unit/file-summary-enrichment.test.ts (10 it blocks, insertEdge helper)
- FOUND: tests/unit/tool-outputs.test.ts (24 it blocks incl. 'find_symbol response contract' + 'Phase 34 enrichment' + 14-tool registry)
- FOUND: tests/unit/schema-coercion.test.ts (7 it blocks, 'find_symbol uses z.coerce.boolean' present)
- FOUND: scripts/check-find-symbol-desc-len.mjs (exits 0, length 1197)

Verified commits exist:
- FOUND: 893ff7b (Task 1 — feat, find_symbol register + get_file_summary enrichment)
- FOUND: 5382e4e (Task 2 — test, find-symbol.test.ts)
- FOUND: da43bb8 (Task 3 — test, file-summary-enrichment.test.ts)
- FOUND: f86f129 (Task 4 — test, tool-outputs.test.ts extension)
- FOUND: ba23c36 (Task 5 — test, schema-coercion.test.ts lock)
- FOUND: 84f4308 (Task 6 — chore, description length probe)

Verified build + test:
- FOUND: npm run build exits 0 with no TypeScript errors
- FOUND: npx vitest run — 673 passing + 7 skipped + 2 pre-existing failures (documented)
- FOUND: node scripts/check-find-symbol-desc-len.mjs exits 0, length 1197 < 2000

Verified acceptance criteria:
- grep -c 'registerTool("find_symbol"' src/mcp-server.ts → 1 ✓
- grep -c 'dependents: getDependentsWithImports(normalizedPath)' src/mcp-server.ts → 1 ✓
- grep -c 'exports: getSymbolsForFile(normalizedPath)' src/mcp-server.ts → 1 ✓
- grep -c 'dependents: node.dependents' src/mcp-server.ts → 0 ✓ (old path removed)
- grep -c 'Math.max(1, Math.min(500' src/mcp-server.ts → 1 ✓
- grep -c 'title: "Find Symbol"' src/mcp-server.ts → 1 ✓
- grep -c 'all 14 expected tool names' tests/unit/tool-outputs.test.ts → 1 ✓
- grep -c "CREATE TABLE IF NOT EXISTS symbols" tests/unit/tool-outputs.test.ts → 1 ✓

## TDD Gate Compliance

Plan 02 is not a plan-level TDD plan (frontmatter has no `type: tdd`) but individual tasks have `tdd="true"`. Per the plan's structure:
- Task 1 ships the implementation (feat commit 893ff7b).
- Tasks 2–5 ship the tests that lock the shape (test commits 5382e4e, da43bb8, f86f129, ba23c36).
- Task 6 adds a tooling script (chore 84f4308).

The test commits follow the feat commit — reverse order from canonical RED/GREEN because the plan was explicit: Task 1 lands the production behavior first, then the tests lock it. All tests pass on first run (no RED phase for Tasks 2–5 in isolation — they exercise helpers that Plan 01 shipped and the handler that Task 1 shipped). This is a conscious sequencing choice documented in the plan's `<tasks>` ordering, not a gate violation.

## Next Phase Readiness

**Phase 34 is complete.** All requirements (FIND-01..05, SUM-01..04) close with this plan. The MCP surface now exposes symbol-level navigation (find_symbol) and symbol-aware file summaries (exports[] + rich dependents[]) — the two user-visible deliverables promised by Phase 34.

**Phase 35 (list_changed_since + watcher symbol re-extraction) is unblocked.** The `symbols` table is live, the find_symbol handler is in place as a neighbor for list_changed_since, and the per-file symbol write path is already wired through setEdgesAndSymbols (Phase 33). Phase 35 can proceed without re-visiting the MCP registration layer.

---
*Phase: 34-symbol-aware-mcp-surface*
*Completed: 2026-04-23*
