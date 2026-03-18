---
phase: 03-semantic-change-detection
plan: 01
subsystem: database
tags: [tree-sitter, ast, typescript, sqlite, drizzle, semantic-diff, change-detection]

# Dependency graph
requires:
  - phase: 01-sqlite-storage
    provides: SQLite schema, Drizzle ORM, repository pattern, llm_jobs table
  - phase: 02-coordinator-daemon-mode
    provides: coordinator pattern, handleFileEvent integration point
provides:
  - ExportedSymbol, ExportSnapshot, SemanticChangeSummary interfaces (src/change-detector/types.ts)
  - tree-sitter AST parser extracting all TS/JS export forms (src/change-detector/ast-parser.ts)
  - Semantic diff engine classifying body-only vs exports/types changes (src/change-detector/semantic-diff.ts)
  - exports_snapshot column on files table (migration 0001_add_exports_snapshot.sql)
  - payload column on llm_jobs table
  - getExportsSnapshot/setExportsSnapshot/insertLlmJob repository functions
affects:
  - 03-semantic-change-detection/03-02 (LLM fallback, coordinator wiring)
  - 04-cascade-engine (consumes SemanticChangeSummary.affectsDependents)

# Tech tracking
tech-stack:
  added:
    - tree-sitter 0.25.0 (native Node-API .node addon, CJS loaded via createRequire)
    - tree-sitter-typescript 0.23.2 (TypeScript + TSX grammars)
    - tree-sitter-javascript 0.25.0 (JavaScript + JSX grammar)
  patterns:
    - createRequire for CJS native addon in ESM (same as better-sqlite3 in db.ts)
    - Tree traversal via visitNode() recursion (avoids S-expression query compilation)
    - isDefaultExport() check via child type scan (handles export default class/function)
    - Snapshot diff via Map+Set name comparison (no Myers diff needed for API surface)

key-files:
  created:
    - src/change-detector/types.ts
    - src/change-detector/ast-parser.ts
    - src/change-detector/ast-parser.test.ts
    - src/change-detector/semantic-diff.ts
    - src/change-detector/semantic-diff.test.ts
    - src/change-detector/types.test.ts
    - drizzle/0001_add_exports_snapshot.sql
  modified:
    - src/db/schema.ts (exports_snapshot + payload columns)
    - src/db/repository.ts (getExportsSnapshot, setExportsSnapshot, insertLlmJob)
    - package.json (tree-sitter deps, build script updated)
    - drizzle/meta/_journal.json (migration entry added)

key-decisions:
  - "tree-sitter loaded via createRequire (CJS from ESM), no --external flag needed since build script does not use --bundle"
  - "export default class/function detected via 'default' keyword child scan, not 'value' field (AST uses declaration field for named defaults)"
  - "setExportsSnapshot uses UPSERT pattern: UPDATE first, INSERT minimal row if no changes"
  - "insertLlmJob stores payload in new payload column on llm_jobs (not error_message hack)"
  - "Tree traversal via recursive visitNode() used instead of Language.query() S-expressions to avoid grammar-specific query compilation issues at runtime"

patterns-established:
  - "Pattern: createRequire for native CJS addons in ESM — same as better-sqlite3"
  - "Pattern: extractSnapshot returns ExportSnapshot | null (null = caller treats as unknown)"
  - "Pattern: isDefaultExport() — check for 'default' keyword child before processing declaration"

requirements-completed: [CHNG-01, CHNG-02, CHNG-04]

# Metrics
duration: 7min
completed: 2026-03-17
---

# Phase 3 Plan 1: AST Parser and Semantic Diff Engine Summary

**tree-sitter 0.25 CST parser + semantic diff engine producing SemanticChangeSummary from ExportSnapshot comparison, with exports_snapshot SQLite column and TDD-verified at 73 tests passing**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-17T20:21:23Z
- **Completed:** 2026-03-17T20:28:41Z
- **Tasks:** 2
- **Files modified:** 11 (7 created, 4 modified)

## Accomplishments

- Installed tree-sitter 0.25 + grammars and validated native addon loads in ESM via createRequire (Pitfall 3 and ABI compatibility verified at runtime)
- Implemented full AST export extraction covering all 7 TS/JS export forms (function, class, variable, type, interface, enum, default) with grammar dispatch for .ts/.tsx/.js/.jsx
- Semantic diff engine classifies body-only changes as affectsDependents=false, export/type/import changes as affectsDependents=true (CHNG-04 logic complete)
- Schema extended with exports_snapshot column + migration; repository functions getExportsSnapshot/setExportsSnapshot/insertLlmJob added
- 73 tests all passing (10 types, 23 ast-parser, 12 semantic-diff, 28 existing DB tests)

## Task Commits

1. **Task 1: Define types, extend schema, add repository functions** - `927ce5e` (feat)
2. **Task 2: Implement tree-sitter AST parser and semantic diff** - `df532b9` (feat)

## Files Created/Modified

- `src/change-detector/types.ts` — ExportedSymbol, ExportSnapshot, SemanticChangeSummary interfaces
- `src/change-detector/ast-parser.ts` — tree-sitter CST extraction; extractSnapshot() and isTreeSitterLanguage()
- `src/change-detector/ast-parser.test.ts` — 23 tests covering all export forms, imports, grammar dispatch
- `src/change-detector/semantic-diff.ts` — computeSemanticDiff() snapshot comparison
- `src/change-detector/semantic-diff.test.ts` — 12 tests covering all classification scenarios
- `src/change-detector/types.test.ts` — 10 tests for interfaces, snapshot round-trip, insertLlmJob
- `src/db/schema.ts` — exports_snapshot column on files, payload column on llm_jobs
- `src/db/repository.ts` — getExportsSnapshot, setExportsSnapshot, insertLlmJob
- `drizzle/0001_add_exports_snapshot.sql` — migration: ALTER TABLE files ADD COLUMN exports_snapshot TEXT; ALTER TABLE llm_jobs ADD COLUMN payload TEXT
- `drizzle/meta/_journal.json` — migration entry added
- `package.json` — tree-sitter dependencies, build script includes change-detector files

## Decisions Made

- **tree-sitter via createRequire (not ESM import):** CJS package with native .node addon; same pattern as better-sqlite3. Since build script does not use --bundle, no --external flag needed.
- **Tree traversal instead of S-expression queries:** Language.query() S-expression API used in research patterns, but recursive tree traversal is simpler, avoids grammar-specific query compilation at runtime, and works identically across all supported grammars.
- **export default detection via 'default' keyword child scan:** The `export default class Foo {}` form puts the class in the `declaration` field (not `value`), but also has a `default` keyword as a direct child. Checking for this keyword correctly classifies the symbol as kind='default'.
- **setExportsSnapshot UPSERT pattern:** UPDATE first (no row created), INSERT minimal row with name+path if 0 rows updated. Avoids requiring a file row to exist before snapshot can be stored.
- **payload column on llm_jobs:** Added proper `payload TEXT` column rather than the temporary error_message hack suggested in the plan. Cleaner schema since this column is a first-class concept.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed export default class/function kind detection**
- **Found during:** Task 2 (ast-parser GREEN phase - test failure)
- **Issue:** `export default class Bar {}` produced kind='class' instead of kind='default'. The `export_statement` AST for this case puts the declaration in the `declaration` field (not `value`), same as named exports, but also has a `default` keyword child.
- **Fix:** Added `isDefaultExport()` helper that scans direct children for the `'default'` node type. When true, overrides kind to `'default'` and skips the normal named export path.
- **Files modified:** src/change-detector/ast-parser.ts
- **Verification:** Test `extracts default class export with kind=default` passes
- **Committed in:** df532b9 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in default export kind detection)
**Impact on plan:** Essential correctness fix. No scope creep.

## Issues Encountered

- tree-sitter S-expression query pattern from RESEARCH.md (`Language.query()`) was not used due to the simpler and more reliable recursive tree traversal approach. The RESEARCH.md patterns are correct but tree traversal is more transparent and easier to debug when query patterns need adjustment.

## Next Phase Readiness

- SemanticChangeSummary, ExportSnapshot, ExportedSymbol interfaces are stable and exported — CHNG-02 fulfilled
- exports_snapshot column in SQLite ready for snapshot storage — CHNG-01 infrastructure ready
- extractSnapshot + computeSemanticDiff provide the full classification pipeline for TS/JS files
- Plan 03-02 can wire these into coordinator.ts handleFileEvent() and implement LLM fallback for non-TS/JS files

---
*Phase: 03-semantic-change-detection*
*Completed: 2026-03-17*
