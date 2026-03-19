---
phase: 03-semantic-change-detection
plan: 02
subsystem: change-detection
tags: [tree-sitter, ast, semantic-diff, llm-jobs, coordinator, file-utils]

# Dependency graph
requires:
  - phase: 03-01
    provides: ExportSnapshot/SemanticChangeSummary types, ast-parser.ts, semantic-diff.ts, getExportsSnapshot/setExportsSnapshot/insertLlmJob repository functions

provides:
  - ChangeDetector class (public entry point for classifying file changes)
  - queueLlmDiffJob for unsupported languages
  - Coordinator now runs classify() on every file change event
  - TS/JS import parsing in file-utils uses AST extraction instead of regex (CHNG-04)
affects:
  - 04-cascade-engine (consumes SemanticChangeSummary.affectsDependents for cascade decisions)
  - 05-llm-pipeline (consumes llm_jobs rows queued by queueLlmDiffJob)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - ChangeDetector routes .ts/.js/.tsx/.jsx via AST path; all other extensions return heuristic 'unknown'
    - LLM fallback is fire-and-forget — queues row in llm_jobs, returns conservative summary immediately
    - Coordinator calls classify() BEFORE updateFileNodeOnChange — semantic context captured before metadata update
    - file-utils uses isTreeSitterLanguage(ext) gate to select AST vs regex import extraction

key-files:
  created:
    - src/change-detector/change-detector.ts
    - src/change-detector/llm-diff-fallback.ts
    - src/change-detector/change-detector.test.ts
  modified:
    - src/file-utils.ts (replaced TS/JS regex with AST extraction in scanDirectory + analyzeNewFile)
    - src/coordinator.ts (added ChangeDetector init, handleFileEvent integration, shutdown cleanup)
    - package.json (added change-detector.ts and llm-diff-fallback.ts to build script)

key-decisions:
  - "ChangeDetector._classifyWithLlmFallback does not cache non-TS/JS content — returns 'unknown' immediately; Phase 5 can enhance with content hashing for real diffs"
  - "queueLlmDiffJob truncates at MAX_DIFF_BYTES=16384 to prevent DB bloat and LLM context overflow"
  - "changeSummary declared in case 'change' block with void cast — Phase 4 will wire affectsDependents into CascadeEngine there"

patterns-established:
  - "Pattern: ChangeDetector sits between file event and DB update — classify first, then mutate"
  - "Pattern: LLM fallback always returns conservative affectsDependents=true (safe default for unknown changes)"

requirements-completed: [CHNG-03, CHNG-04, CHNG-05]

# Metrics
duration: 4min
completed: 2026-03-17
---

# Phase 3 Plan 02: ChangeDetector + Coordinator Integration Summary

**ChangeDetector class routes TS/JS files through AST snapshot diffing and wires into coordinator handleFileEvent; TS/JS import parsing in file-utils replaced with extractSnapshot() calls eliminating regex false positives**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-17T20:33:25Z
- **Completed:** 2026-03-17T20:38:00Z
- **Tasks:** 2 (Task 1 TDD, Task 2 auto)
- **Files modified:** 5

## Accomplishments
- ChangeDetector.classify() implemented: AST path for .ts/.tsx/.js/.jsx, heuristic 'unknown' for unsupported languages
- queueLlmDiffJob implemented: inserts llm_job with change_impact type, priority_tier=2, truncates at 16KB
- file-utils updated: removed .ts/.tsx/.js/.jsx from IMPORT_PATTERNS; both scanDirectory and analyzeNewFile now use extractSnapshot() for TS/JS files (CHNG-04)
- Coordinator wired: classify() called before updateFileNodeOnChange on every 'change' event; SemanticChangeSummary logged
- 138 tests passing, build clean with all new files

## Task Commits

Each task was committed atomically:

1. **TDD RED: add failing tests for ChangeDetector and queueLlmDiffJob** - `c1a3c87` (test)
2. **Task 1: Implement ChangeDetector, LLM fallback, and AST import extraction** - `bfba8f0` (feat)
3. **Task 2: Wire ChangeDetector into coordinator handleFileEvent** - `50e3411` (feat)

_Note: TDD task has two commits (test → feat)_

## Files Created/Modified
- `src/change-detector/change-detector.ts` - ChangeDetector class with classify() method
- `src/change-detector/llm-diff-fallback.ts` - queueLlmDiffJob with 16KB truncation
- `src/change-detector/change-detector.test.ts` - 10 tests covering both classes
- `src/file-utils.ts` - Replaced TS/JS regex import parsing with AST extraction; IMPORT_PATTERNS now only has non-TS/JS languages
- `src/coordinator.ts` - Added changeDetector property, init, handleFileEvent wiring, shutdown cleanup
- `package.json` - Added change-detector.ts and llm-diff-fallback.ts to esbuild script

## Decisions Made
- `ChangeDetector._classifyWithLlmFallback` does not cache non-TS/JS content: returns 'unknown' immediately without queuing an LLM job since there's no previous content to diff against. Phase 5 can enhance this with content hashing to generate real diffs.
- `queueLlmDiffJob` truncates diffs at `MAX_DIFF_BYTES = 16 * 1024` (16 384 bytes) with a `... [truncated]` suffix to prevent DB bloat.
- `changeSummary` in coordinator's case 'change' block is cast with `void` to suppress unused-variable warnings — Phase 4 will use `changeSummary.affectsDependents` in the CascadeEngine.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Typecheck passed on first run after implementation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 3 complete: every file change now produces a SemanticChangeSummary with changeType and affectsDependents
- CHNG-03 (LLM fallback), CHNG-04 (AST import parsing), CHNG-05 (affectsDependents signal) all fulfilled
- Phase 4 CascadeEngine can consume `changeSummary.affectsDependents` from the coordinator's handleFileEvent case 'change' block
- No blockers

## Self-Check: PASSED

All files and commits verified present.

---
*Phase: 03-semantic-change-detection*
*Completed: 2026-03-17*
