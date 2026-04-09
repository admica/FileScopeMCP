---
phase: 26-multi-language-tree-sitter-extraction
plan: "02"
subsystem: language-config
tags: [tree-sitter, ast, typescript, javascript, edge-types, weight-aggregation, re-exports, inherits]
dependency_graph:
  requires:
    - src/change-detector/ast-parser.ts (getParser, getStringFragment, extractSnapshot)
    - src/confidence.ts (EXTRACTED/INFERRED constants)
    - src/file-utils.ts (resolveImportPath, normalizePath, isUnresolvedTemplateLiteral)
    - src/language-config.ts (extractEdges, extractTsJsEdges, EdgeResult)
  provides:
    - RicherEdgeData interface and extractRicherEdges() in ast-parser.ts
    - Updated extractTsJsEdges() producing 'imports', 're_exports', 'inherits' edge types
    - resolveTsJsImport() helper for shared TS/JS resolution logic
    - Weight aggregation in extractEdges() via accumulator Map keyed by target+edgeType
  affects:
    - src/change-detector/ast-parser.ts (new interface and function, no changes to existing)
    - src/language-config.ts (rewritten extractTsJsEdges, new helper, updated extractEdges)
    - src/language-config.test.ts (new test blocks appended)
tech_stack:
  added: []
  patterns:
    - Two-phase AST walk: collect imports first, build name map, then detect inherits in same pass
    - buildImportNameMap helper for default/named/namespace import correlation with extends clauses
    - resolveTsJsImport helper to share package vs local resolution logic across three edge types
    - accumulator Map keyed by target+\x00+edgeType for weight aggregation in extractEdges()
key_files:
  modified:
    - path: src/change-detector/ast-parser.ts
      changes: Added RicherEdgeData interface, buildImportNameMap helper, extractRicherEdges() function
    - path: src/language-config.ts
      changes: Removed extractSnapshot import, added extractRicherEdges import, added resolveTsJsImport helper, rewrote extractTsJsEdges() with three edge types, added weight aggregation accumulator to extractEdges()
    - path: src/language-config.test.ts
      changes: Appended four new describe blocks — TS/JS richer edge types, edge weight aggregation, Go extraction unchanged, confidence non-null invariant
decisions:
  - "extractRicherEdges() does a single AST pass collecting all three categories — avoids multiple tree walks"
  - "buildImportNameMap walks import node recursively to handle named/default/namespace imports for inherits correlation"
  - "resolveTsJsImport helper factors shared package vs local resolution — edgeType is a parameter, no code duplication"
  - "Weight aggregation key uses \\x00 separator (target+\\x00+edgeType) — null byte never appears in file paths or edge types"
  - "Test fixtures use package imports (non-relative) to bypass fsPromises.access() file existence checks in test context"
  - "extractSnapshot() left untouched — change-detector still uses it for ExportSnapshot comparison"
metrics:
  duration: ~6 minutes
  completed: "2026-04-09"
  tasks: 2
  files: 3
requirements: [AST-05, AST-07, AST-08, EDGE-03]
---

# Phase 26 Plan 02: TS/JS Richer Edge Types + Weight Aggregation Summary

TS/JS extraction upgraded from single 'imports' edge type to three types (imports, re_exports, inherits) via new `extractRicherEdges()` in ast-parser.ts, plus weight aggregation in `extractEdges()` that sums duplicate edges by target+edgeType composite key.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Add extractRicherEdges(), richer edge types, and weight aggregation | fb9c6ec | src/change-detector/ast-parser.ts, src/language-config.ts |
| 2 | Tests for richer edge types, weight aggregation, and Go parity | e531cd1 | src/language-config.test.ts |

## What Was Built

### `extractRicherEdges()` in ast-parser.ts

New exported function that performs a single AST pass over TS/JS source, returning a `RicherEdgeData` object with three categories:
- `regularImports` — specifiers from `import_statement` nodes and `require()` / dynamic `import()` calls
- `reExportSources` — specifiers from `export_statement` nodes that have a `source` field (re-exports)
- `inheritsFrom` — `{ className, sourceSpecifier }` pairs where a class extends an imported name

The `RicherEdgeData` interface is exported for use by callers needing the raw categorized data.

The `buildImportNameMap()` helper (internal) recursively walks an `import_statement` node to build a `name → source specifier` map, handling named imports (`import { Foo }`), default imports (`import Foo`), and namespace imports (`import * as Foo`). This map is used to correlate class extends clauses with the correct import source.

Class extends detection: walks `class_declaration`/`class` nodes looking for `class_heritage` → `extends_clause` → value node. The extends class name is looked up in `importNameToSource` — only cross-file extends (imported base) produce inherits entries.

### Updated `extractTsJsEdges()` in language-config.ts

Completely rewritten to call `extractRicherEdges()` instead of `extractSnapshot()`. Uses a new `resolveTsJsImport()` helper that takes an `edgeType` parameter and runs the full package vs local resolution logic (package detection, `PackageDependency.fromPath()`, multi-extension probe) returning a single `EdgeResult | null`.

The function processes all three categories in sequence:
1. `regularImports` → `edgeType: 'imports'`
2. `reExportSources` → `edgeType: 're_exports'`
3. `inheritsFrom[].sourceSpecifier` → `edgeType: 'inherits'`

The `extractSnapshot` import was removed since `extractTsJsEdges()` no longer calls it (the change-detector uses it directly).

### Weight Aggregation in `extractEdges()`

Replaced the direct `return await config.extract(...)` with a two-step process:
1. Call extractor to get `rawEdges`
2. Aggregate: iterate raw edges, keying by `target + \x00 + edgeType`; if key exists, increment `weight`; else insert a spread copy

This ensures duplicate imports to the same target accumulate weight (reference counting) while keeping 'imports' and 're_exports' to the same target as distinct edges (different keys).

### Tests (language-config.test.ts — 31 tests total, up from 19)

Four new `describe` blocks appended to the existing parity tests:
- **TS/JS richer edge types** (4 tests): re-export → `re_exports`, class extends imported → `inherits`, same module import+re-export → two distinct edges, same-file extends → no inherits
- **Edge weight aggregation** (2 tests): duplicate package imports → weight >= 2, import+re-export of same package → 2 separate edges each weight=1
- **Go extraction unchanged** (1 test): Go file → INFERRED confidence 0.8 on all edges
- **Confidence non-null invariant** (5 tests): Python/Rust/C/TypeScript/Go all produce non-null confidence and valid confidenceSource

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test fixtures used relative imports that fail file existence checks**
- **Found during:** Task 2 GREEN phase — 5 tests failing
- **Issue:** Plan specified fixtures like `export { Foo } from './foo'` — relative imports go through `fsPromises.access()` which fails because `/project/foo.ts` does not exist in the test environment, causing edges to be silently dropped
- **Fix:** Changed all affected fixtures to use package-style imports (`'some-package'`, `'base-pkg'`, `'shared-dep'`, `'lib-pkg'`) which are classified as package dependencies and resolve without filesystem access
- **Files modified:** src/language-config.test.ts
- **Commit:** e531cd1 (same commit, part of GREEN phase)

**2. [Rule 3 - Blocking] Grammar packages not installed in test environment**
- **Found during:** Task 2 RED phase — existing Plan 01 tests failing (12 of 19 failing)
- **Issue:** `tree-sitter-python`, `tree-sitter-rust`, `tree-sitter-c`, `tree-sitter-cpp` were added to `package.json` in Plan 01 but `npm install` had not been run in the shared `node_modules`
- **Fix:** Ran `npm install tree-sitter-python tree-sitter-rust tree-sitter-c tree-sitter-cpp` in main repo
- **Commit:** No separate commit (npm install modifies `package-lock.json` only)

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/change-detector/ast-parser.ts contains `export interface RicherEdgeData` | FOUND |
| src/change-detector/ast-parser.ts contains `export function extractRicherEdges(` | FOUND |
| src/change-detector/ast-parser.ts contains `regularImports:`, `reExportSources:`, `inheritsFrom:` | FOUND |
| src/change-detector/ast-parser.ts contains `function buildImportNameMap(` | FOUND |
| src/language-config.ts contains `extractRicherEdges` import | FOUND |
| src/language-config.ts extractTsJsEdges references `extractRicherEdges(` | FOUND |
| src/language-config.ts contains `edgeType: 're_exports'` | FOUND |
| src/language-config.ts contains `edgeType: 'inherits'` | FOUND |
| src/language-config.ts extractEdges contains `const accumulator = new Map<string, EdgeResult>()` | FOUND |
| src/language-config.ts contains `edge.target}\x00${edge.edgeType}` aggregation key | FOUND |
| src/language-config.ts contains `existing.weight += edge.weight` | FOUND |
| `npx tsc --noEmit` exits 0 | PASSED |
| `npx vitest run src/language-config.test.ts` 31/31 pass | PASSED |
| `npx vitest run src/change-detector/ast-parser.test.ts` 23/23 pass | PASSED |
| `npx vitest run` 264/264 pass | PASSED |
| commit fb9c6ec (Task 1) exists | FOUND |
| commit e531cd1 (Task 2) exists | FOUND |
