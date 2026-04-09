---
phase: 25-schema-foundation-languageconfig-scaffolding
plan: 02
subsystem: language-config
tags: [dependency-extraction, language-config, edge-metadata, ast, regex, confidence]

# Dependency graph
requires:
  - phase: 25-01
    provides: "EXTRACTED/INFERRED confidence constants and ConfidenceSource type from src/confidence.ts; edge_type/confidence/confidence_source/weight columns in file_dependencies schema"
provides:
  - "src/language-config.ts: LanguageConfig registry, EdgeResult interface, extractEdges() dispatch function, buildAstExtractor() Phase-26 scaffold"
  - "src/db/repository.ts: setEdges() writing enriched edge rows with confidence/type/weight metadata"
  - "src/file-utils.ts: analyzeNewFile() delegates to extractEdges(), returns edges alongside legacy shape; call sites use setEdges()"
  - "src/coordinator.ts: bulk-scan pass 2 replaced with extractEdges()+setEdges() — no inline dispatch"
affects: [26-ast-grammar-plug-in, dependency-graph, cascade-engine, cycle-detection]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "LanguageConfig registry pattern: Map<ext, { extract }> for O(1) dispatch — Phase 26 adds entries without touching dispatch logic"
    - "EdgeResult carries all enriched metadata (confidence, edgeType, weight, isPackage) as a single composable value"
    - "Go module name cached per projectRoot in module-level Map to avoid re-reading go.mod per file in bulk scan"
    - "buildAstExtractor() closure with grammarFailed flag: per-language grammar load isolation for Phase 26 plug-in"

key-files:
  created:
    - src/language-config.ts
  modified:
    - src/db/repository.ts
    - src/file-utils.ts
    - src/coordinator.ts

key-decisions:
  - "One-directional import: repository.ts imports EdgeResult from language-config.ts, never reverse — prevents circular dependency"
  - "analyzeNewFile() returns edges alongside legacy { dependencies, packageDependencies } shape for zero-impact call site migration"
  - "setDependencies() retained in repository.ts for migrate/json-to-sqlite.ts backward compatibility — not removed"
  - "extractSnapshot/isTreeSitterLanguage removed from file-utils.ts and coordinator.ts imports — now fully encapsulated in language-config.ts"
  - "Go module name cached at language-config module level (not coordinator) so all paths (bulk-scan + incremental) benefit"

patterns-established:
  - "All dependency extraction flows through extractEdges(filePath, content, projectRoot) — single entry point"
  - "All edge writes use setEdges(sourcePath, edges[]) — enriched columns always populated"
  - "Extension registry pattern for adding new language support: registry.set(ext, { extract: fn }) in language-config.ts"

requirements-completed: [AST-01, AST-06]

# Metrics
duration: 5min
completed: 2026-04-09
---

# Phase 25 Plan 02: LanguageConfig Registry + setEdges() Wiring Summary

**LanguageConfig registry dispatching TS/JS to AST (1.0 confidence), Go/Ruby to specialized resolvers (0.8), all IMPORT_PATTERNS languages to regex extractors (0.8), with setEdges() writing enriched edge columns across all call sites**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-09T13:39:50Z
- **Completed:** 2026-04-09T13:44:25Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- Created `src/language-config.ts` (472 lines): EdgeResult type, full registry initialization, extractEdges() public API, and buildAstExtractor() Phase-26 scaffold
- Added `setEdges()` to `repository.ts` writing all four enriched columns (edge_type, confidence, confidence_source, weight)
- Replaced `analyzeNewFile()` body with a 30-line delegate to `extractEdges()` — eliminates the original 130-line multi-branch dispatch
- Replaced coordinator bulk-scan pass 2 dispatch block (~110 lines) with a 20-line `extractEdges()+setEdges()` loop
- Both incremental call sites (`updateFileNodeOnChange`, `addFileNode`) migrated to `setEdges()`
- TypeScript compiles without errors

## Task Commits

1. **Task 1: Create LanguageConfig registry with extractEdges()** - `3a47308` (feat)
2. **Task 2: Create setEdges() and wire extractEdges into all call sites** - `83ec406` (feat)

## Files Created/Modified

- `src/language-config.ts` — New: LanguageConfig registry, EdgeResult type, extractEdges() dispatch, buildAstExtractor() scaffold
- `src/db/repository.ts` — Added: setEdges() function + EdgeResult import; setDependencies() retained for backward compat
- `src/file-utils.ts` — Rewrote: analyzeNewFile() body; updated imports (removed extractSnapshot, isTreeSitterLanguage, setDependencies)
- `src/coordinator.ts` — Replaced: bulk-scan dispatch block; updated imports (removed resolveGoImports, resolveRubyImports, resolveImportPath, isUnresolvedTemplateLiteral, extractPackageVersion, readGoModuleName, IMPORT_PATTERNS, extractImportPath, extractSnapshot, isTreeSitterLanguage, setDependencies)

## Decisions Made

- One-directional dependency: `repository.ts` imports `EdgeResult` from `language-config.ts`, never the reverse — prevents circular dependency since language-config must not know about the DB layer
- `analyzeNewFile()` return type extended to include `edges: EdgeResult[]` alongside the legacy shape — allows call sites to use `setEdges()` without breaking the in-memory tree update logic that consumes `dependencies`/`packageDependencies`
- `setDependencies()` retained in `repository.ts` (not removed) — `migrate/json-to-sqlite.ts` still uses it for backward compatibility
- Go module name cached at the `language-config.ts` module level in a `Map<string, string | null>` keyed by `projectRoot` — ensures all call paths (bulk-scan and incremental) benefit from caching, not just the coordinator

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 26 can add a new language by: (1) writing a grammar loader, (2) calling `buildAstExtractor(loadGrammar, regexFallback)`, (3) adding `registry.set(ext, { grammarLoader, extract })` in language-config.ts
- All dependency extraction now flows through a single `extractEdges()` entry point with enriched metadata
- All edge writes populate `edge_type`, `confidence`, `confidence_source`, `weight` columns in `file_dependencies`
- TypeScript compiles cleanly; no blockers for Phase 26

---
*Phase: 25-schema-foundation-languageconfig-scaffolding*
*Completed: 2026-04-09*
