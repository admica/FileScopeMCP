---
phase: 13-streaming-directory-scan
plan: 02
subsystem: file-scan
tags: [streaming, coordinator, two-pass, sqlite, dependency-extraction, typescript]

# Dependency graph
requires:
  - phase: 13-streaming-directory-scan
    plan: 01
    provides: AsyncGenerator<FileNode> scanDirectory — consumed in Pass 1
  - phase: 12-language-import-parsing
    provides: resolveGoImports, resolveRubyImports — called in coordinator Pass 2
provides:
  - buildFileTree() two-pass streaming integration in coordinator.ts
  - Re-enabled 16 dependency extraction tests using direct function calls
  - Two-pass pipeline integration test
affects: [file-scan, coordinator, sqlite-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "better-sqlite3 transaction() wrapper for batched upserts (BATCH_SIZE=100)"
    - "for await consuming AsyncGenerator<FileNode> from scanDirectory in coordinator"
    - "goModuleName cached once before Pass 2 loop — avoids go.mod re-reads per file"
    - "reconstructTreeFromDb + buildDependentMap + calculateImportance for Pass 2b importance"
    - "Direct function call pattern for dependency extraction tests — no scanDirectory wrapper"

key-files:
  created: []
  modified:
    - src/coordinator.ts
    - src/file-utils.ts
    - src/file-utils.test.ts

key-decisions:
  - "buildFileTree two-pass replaces shim that collected generator into synthetic root"
  - "resolveGoImports, resolveRubyImports, IMPORT_PATTERNS, extractImportPath, extractPackageVersion, resolveImportPath, isUnresolvedTemplateLiteral, getAllFileNodes exported from file-utils.ts for coordinator use"
  - "extractSnapshot and isTreeSitterLanguage imported directly from change-detector/ast-parser.js in coordinator (not re-exported through file-utils)"
  - "fs/promises used as fs in coordinator (existing alias) — no new import needed"
  - "Skipped tests converted to direct resolveGoImports/resolveRubyImports calls — tests no longer depend on scanDirectory's behavior"

requirements-completed: [PERF-02]

# Metrics
duration: ~6min
completed: 2026-03-20
---

# Phase 13 Plan 02: Coordinator Streaming Integration Summary

**buildFileTree() rewritten with two-pass streaming: Pass 1 batch-upserts FileNodes to SQLite via batched transactions, Pass 2 extracts dependencies per-file, Pass 2b calculates importance via reconstructTreeFromDb — 16 previously skipped dependency tests re-enabled using direct extraction function calls**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-20T02:41:52Z
- **Completed:** 2026-03-20T02:47:40Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Rewrote `buildFileTree()` rescan section with two-pass streaming architecture:
  - **Pass 1:** `for await (const node of scanDirectory(...))` streams FileNodes into SQLite via `sqlite.transaction()` batched upserts with `BATCH_SIZE = 100`
  - **Pass 2:** Iterates `getAllFiles()` path index, extracts dependencies per-file using `resolveGoImports`, `resolveRubyImports`, `extractSnapshot` (AST), and `IMPORT_PATTERNS` (regex fallback), stores via `setDependencies()`
  - **Pass 2b:** Reconstructs tree from SQLite via `reconstructTreeFromDb`, runs `buildDependentMap` + `calculateImportance`, batch-upserts importance values back to SQLite
- Removed the Plan 01 shim that eagerly collected the generator into a synthetic root
- Removed `saveFileTree` call — Pass 1 handles persistence directly
- Exported 8 previously private functions/constants from `file-utils.ts`: `resolveGoImports`, `resolveRubyImports`, `resolveImportPath`, `extractImportPath`, `extractPackageVersion`, `isUnresolvedTemplateLiteral`, `IMPORT_PATTERNS`, `getAllFileNodes`
- Added `PackageDependency`, `getDependencies`, `setDependencies`, `extractSnapshot`, `isTreeSitterLanguage` imports to `coordinator.ts`
- Re-enabled all 16 skipped dependency tests by converting them to direct extraction function calls (no `scanDirectory` wrapper)
- Added Two-pass pipeline integration test verifying scan + extract deps flow end-to-end
- All 74 tests pass with zero skips; TypeScript compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite buildFileTree for two-pass streaming consumption** - `3c9dcc2` (feat)
2. **Task 2: Re-enable skipped dependency tests and verify full pipeline** - `dd1f2a3` (feat)

## Files Created/Modified

- `src/coordinator.ts` - `buildFileTree()` rescan section replaced with two-pass streaming; new imports for PackageDependency, getDependencies, setDependencies, extractSnapshot, isTreeSitterLanguage, and all file-utils extraction functions
- `src/file-utils.ts` - 8 private functions/constants exported: resolveGoImports, resolveRubyImports, resolveImportPath, extractImportPath, extractPackageVersion, isUnresolvedTemplateLiteral, IMPORT_PATTERNS, getAllFileNodes
- `src/file-utils.test.ts` - 16 `it.skip()` → `it()` conversions using direct extraction calls; all TODO comments removed; pipeline integration test added

## Decisions Made

- **extractSnapshot from ast-parser directly:** The plan specified importing `extractSnapshot` from `file-utils.js`, but it's imported (not re-exported) there. Imported directly from `./change-detector/ast-parser.js` in coordinator — cleaner and avoids adding another re-export.
- **`fs.readFile` not `fsPromises.readFile`:** coordinator.ts imports `fs/promises` as `fs` (not as `fsPromises`), so Pass 2 uses `fs.readFile(filePath, 'utf-8')` to stay consistent with existing coordinator code style.
- **Skipped tests use direct calls:** Option A from the plan (simpler) — test the extraction functions directly rather than running the full coordinator. This is cleaner and avoids needing SQLite in unit tests.

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as designed. The only adaptation was the `extractSnapshot` import path (from `ast-parser.js` directly rather than `file-utils.js`) which was a clarification, not a deviation.

## Issues Encountered

None. TypeScript compilation passed on first attempt. All 74 tests passed on first run.

## Next Phase Readiness

- PERF-02 is complete: full scan pipeline is streaming — no full in-memory tree built during initial scan
- `buildFileTree` holds `treeMutex` for both passes (called from within `treeMutex.run()` in `initialize()`)
- goModuleName cached once before Pass 2 loop prevents repeated go.mod reads
- `reconstructTreeFromDb` + `buildDependentMap` + `calculateImportance` pattern reused in Pass 2b — consistent with existing coordinator approach
- All dependency tests active and passing — regression risk from future changes is visible

---
*Phase: 13-streaming-directory-scan*
*Completed: 2026-03-20*
