---
phase: 33-symbol-extraction-foundation
plan: 03
subsystem: change-detector/parser
tags: [parser, tree-sitter, symbols, imports, tdd]
requires: [33-01]
provides:
  - src/db/symbol-types.ts (Symbol, SymbolKind)
  - src/change-detector/ast-parser.ts (ImportMeta export, widened RicherEdgeData.symbols + RicherEdgeData.importMeta)
affects:
  - src/change-detector/ast-parser.ts (extended in place)
tech-stack:
  added: []
  patterns:
    - "Single AST parse shared across multiple accumulators (SYM-02 single-pass guarantee)"
    - "Pure-type module (symbol-types.ts) outside the esbuild entry set, erased at compile"
    - "Mirror-style helper pattern: extractImportedNames() reuses buildImportNameMap() traversal shape"
    - "positionSource override on extractBareTopLevelSymbol() to preserve decorator startLine for classes (Pitfall 7)"
key-files:
  created:
    - src/db/symbol-types.ts
    - src/change-detector/ast-parser.symbols.test.ts
  modified:
    - src/change-detector/ast-parser.ts
decisions:
  - "Inlined extractBareTopLevelSymbol with switch-on-node.type rather than a kind-mapping dispatch table, to make the let/var/ambient skip paths explicit and avoid name-lookup overhead"
  - "Added optional positionSource parameter to extractBareTopLevelSymbol (rather than duplicating the switch into extractExportedSymbol) — decorator lines now attach to the export_statement span uniformly"
  - "Did NOT add src/db/symbol-types.ts to the esbuild entry set in package.json — the module is pure types and is erased at compile by `import type` usage in ast-parser.ts"
metrics:
  duration_minutes: 5
  duration_seconds: 314
  completed: 2026-04-23
  tasks_total: 3
  tasks_completed: 3
  files_created: 2
  files_modified: 1
  tests_added_describe_blocks: 12
  tests_added_it_blocks: 31
  parser_parse_call_count: 2
---

# Phase 33 Plan 03: Extract Symbols + Import Metadata from Single AST Walk Summary

Widened the TS/JS parser so `extractRicherEdges()` emits symbol rows and per-import metadata inside the same tree-sitter walk that was already producing dependency edges — no second `parser.parse()` call introduced. Delivered the narrow `Symbol` type (distinct from the semantic-diff `ExportedSymbol`), exported a new `ImportMeta` interface, and verified all six kinds + decorator + JSX-arrow + re-export-skip + named/anonymous-default + aliased-import + multi-import-same-target behavior against real tree-sitter output with 30 new tests (all green) and zero regression across the 595-test suite.

## Objective Delivered

Per plan 33-03 objective: "Widen the TS/JS parser so a single AST walk produces both edges (as today) and symbols + per-import metadata (new)." All three tasks completed in order (type module, RED tests, GREEN implementation), each with its own atomic commit.

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `128f484` | feat(33-03): add Symbol + SymbolKind type module for find_symbol |
| 2 | `0e66843` | test(33-03): add failing tests for extractRicherEdges symbol + importMeta |
| 3 | `aef4ca1` | feat(33-03): widen extractRicherEdges — emit symbols + importMeta in single AST walk |

## What Was Built

### Task 1 — `src/db/symbol-types.ts`

Pure-type module with:
- `SymbolKind` union: `'function' | 'class' | 'interface' | 'type' | 'enum' | 'const'`
- `Symbol` interface: `name, kind, startLine, endLine, isExport`

Deliberately separate from `src/change-detector/types.ts`'s `ExportedSymbol` (which retains its `signature` field and the semantic-diff kinds `variable`/`default`). Keeps find_symbol's row shape decoupled from semantic-diff churn.

### Task 2 — `src/change-detector/ast-parser.symbols.test.ts` (RED phase)

31 `it` blocks across 12 `describe` groups covering:

- Six kinds emitted with correct `isExport` + 1-indexed lines (function, class, interface, type, enum, const)
- Generator functions classified as `function`
- Decorator-wrapped class captures the decorator's startLine (Pitfall 7)
- JSX/arrow-const (`export const Foo = () => <div/>;`) classified as `function` (SYM-07)
- Multi-binding const (`export const a = 1, b = 2;`) emits one symbol per declarator
- `export let` / `export var` / ambient `declare` skipped (Pitfall 1, Pitfall 2)
- Named default class/function emitted, anonymous default skipped (D-06)
- Re-export shapes (`export * from`, `export { x } from`, `export type { X } from`) skipped (SYM-08)
- Import metadata: named, default (`["default"]`), namespace (`["*"]`), mixed default+named, aliased (ORIGINAL exported name, not local alias), multi-import-same-target → two ImportMeta entries with separate lines (D-08)

Red phase confirmed: every assertion failed with the unwidened return shape.

### Task 3 — `src/change-detector/ast-parser.ts` widened (GREEN phase)

- Exported new `ImportMeta` interface: `{ specifier, importedNames: string[], line: number }`
- Widened `RicherEdgeData` with `symbols: Symbol[]` and `importMeta: ImportMeta[]`
- New helpers: `extractImportedNames`, `extractBareTopLevelSymbol`, `extractExportedSymbol`
- Extended existing `import_statement` branch in `visitNode` to push an `ImportMeta` row alongside pushing to `regularImports` — one entry per import statement, preserving separate rows when two imports target the same module
- Added a top-level-children iteration after `visitNode(tree.rootNode)` that uses the SAME parsed tree (no second `parser.parse()` call) to emit symbols for both `export_statement` and bare top-level declarations
- Added optional `positionSource` param to `extractBareTopLevelSymbol` so decorator-wrapped classes get `startLine` from the `export_statement` span (which includes the decorator) rather than from the inner `class_declaration`

## Verification

- `npm run typecheck` exits 0 — clean
- `npx vitest run src/change-detector/ast-parser.symbols.test.ts` — **30/30 passing**
- `npx vitest run src/change-detector/ast-parser.test.ts` — **23/23 passing** (no regression)
- Full suite `npx vitest run` — **595 passed | 9 skipped | 0 failed** across 27 test files (9 skips are pre-existing, unrelated)
- `grep -c "parser.parse(" src/change-detector/ast-parser.ts` → **2** — single-pass SYM-02 guarantee verifiable (one parse call per function — `extractRicherEdges` and `extractSnapshot`)

## Requirements Satisfied

| Requirement | How verified |
|-------------|--------------|
| SYM-01 (six kinds emitted with isExport + line range) | All six kinds covered by dedicated describe groups; explicit line assertions on multi-line class + decorator cases |
| SYM-02 (single AST walk, no second parse) | `grep -c "parser.parse("` = 2; top-level symbol loop reuses `tree.rootNode` without re-parsing |
| SYM-07 (JSX components as function kind) | `const Foo = () => <div/>` test asserts kind=`function` |
| SYM-08 (re-exports do NOT populate symbols) | Three tests covering `export * from`, `export { x } from`, `export type { X } from` all assert `symbols.length === 0` |
| IMP-01 (imported names + line per import, same pass) | Tests assert specifier + 1-indexed line + names array per import_statement; populated inside the same visitNode branch as regularImports |
| IMP-02 (namespace imports → `["*"]`) | Dedicated test asserts `importedNames === ['*']` for `import * as ns from './ns.js'` |

## Tree-Sitter Node-Type Edge Cases Encountered

- **Decorator startLine discrepancy vs. RESEARCH.md:** RESEARCH.md Pitfall 7 claimed "`export_statement.startPosition.row` is the decorator's line (row 0), not the `export` keyword line (row 1)." Verified: `export_statement.startPosition.row` does include the decorator row — BUT the `declaration` field (`class_declaration`) starts at the row AFTER the decorator (row 1, post-decorator). The initial implementation passed `declNode` as the position source, giving startLine=2 for the decorated class test. Fix: added an optional `positionSource` param to `extractBareTopLevelSymbol` and pass `exportNode` from `extractExportedSymbol` — now the decorator's row propagates correctly to the symbol's startLine. Classified as Rule 1 inline fix, not a plan deviation (plan anticipated this; RESEARCH.md's wording was a minor oversimplification).

- **No other edge cases:** every other tree-sitter behavior assumed by RESEARCH.md (arrow-function value type, variable_declarator iteration, re-export source field, namespace_import walking, import_specifier name field returning the original name) matched production tree-sitter-typescript@0.23.2 output exactly.

## Deviations from Plan

None — plan executed exactly as written. The decorator startLine fix is an implementation refinement within the plan's scope (plan said "For decorator'd classes… declNode.startPosition.row is also the decorator row" — in practice this wasn't true; the optional positionSource parameter resolves the discrepancy without changing the public API shape).

## Self-Check: PASSED

- [x] `src/db/symbol-types.ts` exists — verified
- [x] `src/change-detector/ast-parser.symbols.test.ts` exists — verified
- [x] `src/change-detector/ast-parser.ts` modified (not rewritten) — verified (152 insertions, 1 deletion per commit aef4ca1)
- [x] Commit 128f484 (task 1) exists — verified
- [x] Commit 0e66843 (task 2) exists — verified
- [x] Commit aef4ca1 (task 3) exists — verified
- [x] `grep -c "parser.parse(" src/change-detector/ast-parser.ts` = 2 — verified
- [x] All 30 symbol tests pass, all 23 existing ast-parser tests pass, full suite green — verified

No stubs introduced. No new security-relevant surface (parser runs locally on in-memory source strings; no network, no IO beyond the test file's inline sources).
