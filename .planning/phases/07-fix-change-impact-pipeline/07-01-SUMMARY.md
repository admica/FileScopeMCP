---
phase: 07-fix-change-impact-pipeline
plan: 01
subsystem: change-detection, cascade-engine, llm-pipeline
tags: [llm, change-detection, cascade, payload, git-diff]
dependency_graph:
  requires: [05-llm-processing-pipeline, 03-semantic-change-detection, 04-cascade-engine-staleness]
  provides: [CHNG-03, LLM-03, change_impact-pipeline-e2e]
  affects: [llm-pipeline, coordinator]
tech_stack:
  added: [node:child_process (execSync for git diff)]
  patterns: [git-diff-helper, payload-propagation, tdd-red-green]
key_files:
  created:
    - src/change-detector/git-diff.ts
  modified:
    - src/change-detector/change-detector.ts
    - src/change-detector/ast-parser.ts
    - src/db/repository.ts
    - src/cascade/cascade-engine.ts
    - src/coordinator.ts
    - src/change-detector/change-detector.test.ts
    - src/cascade/cascade-engine.test.ts
    - package.json
decisions:
  - "Use execSync git diff HEAD -- <file> as primary diff source; fall back to file content with [new/untracked file] prefix"
  - "log() used in ast-parser.ts (not warn()) — parse failures suppressed in daemon mode"
  - "ChangeContext interface is internal to cascade-engine.ts (not exported)"
  - "summary and concepts jobs carry no payload — only change_impact gets payload"
  - "Dependent payload header + content truncated at 14KB to fit within 16KB llm_jobs limit"
metrics:
  duration: "4 min"
  completed_date: "2026-03-18"
  tasks_completed: 2
  files_changed: 8
---

# Phase 7 Plan 1: Fix change_impact Pipeline Summary

**One-liner:** Wired git-diff-based LLM fallback for non-TS/JS files with payload propagation through cascadeStale to enable end-to-end change_impact assessment.

## What Was Built

### Task 1: Git diff helper, LLM fallback wiring, payload support, ast-parser logger fix

**New file: `src/change-detector/git-diff.ts`**
- Exports `getGitDiffOrContent(filePath, projectRoot): Promise<string>`
- Runs `git diff HEAD -- <file>` via execSync; returns diff if non-empty
- Falls back to file content with `[new/untracked file]\n` prefix when git diff empty or git unavailable
- Returns `[file content unavailable]` when file read also fails
- Never throws — all errors handled internally (established codebase pattern)

**`src/change-detector/change-detector.ts`**
- `_classifyWithLlmFallback` now calls `getGitDiffOrContent` then `queueLlmDiffJob` instead of returning hardcoded unknown summary
- Import added: `getGitDiffOrContent` from `./git-diff.js`

**`src/db/repository.ts`**
- `insertLlmJobIfNotPending` extended with optional `payload?: string` 4th parameter
- Passes payload through to `insertLlmJob` — all existing callers unchanged (backward-compatible)

**`src/change-detector/ast-parser.ts`**
- Import added: `log` from `../logger.js`
- `console.warn` on line 128 replaced with `log()` — suppressed in daemon mode

**`package.json`**
- Added `src/change-detector/git-diff.ts` to esbuild build script

### Task 2: cascadeStale changeContext extension and coordinator wiring

**`src/cascade/cascade-engine.ts`**
- New internal `ChangeContext` interface: `{ directPayload, changeType, changedFilePath }`
- New `buildDependentPayload(changeContext, dependentFilePath)`: reads file content, truncates at 14KB, formats with upstream change header
- `cascadeStale` extended to accept `opts.changeContext?: ChangeContext`
- BFS loop: root file gets `directPayload`, dependents get `buildDependentPayload()`, no changeContext = null payload (backward compat for unlink case)
- summary/concepts jobs never receive payload — only change_impact does

**`src/coordinator.ts`**
- On `case 'change'` with `affectsDependents=true`: constructs `changeContext` from `changeSummary` and passes to `cascadeStale`
- Unlink path (`case 'unlink'`) unchanged — no changeContext passed

## Tests Added

**`src/change-detector/change-detector.test.ts`** (11 new tests):
- `getGitDiffOrContent`: untracked file returns `[new/untracked file]` prefix + content
- `getGitDiffOrContent`: non-existent file returns `[file content unavailable]`
- `insertLlmJobIfNotPending with payload`: payload passes through to job row
- `insertLlmJobIfNotPending with payload`: works without payload (backward compat)
- `ChangeDetector LLM fallback wiring`: `.py` classify queues change_impact job with non-null payload
- `ast-parser logger usage`: ast-parser.ts contains no `console.warn` calls

**`src/cascade/cascade-engine.test.ts`** (5 new tests):
- `cascadeStale with changeContext`: root file gets directPayload
- `cascadeStale with changeContext`: dependent file gets upstream change info + content payload
- `cascadeStale with changeContext`: no changeContext = null payload (backward compat)
- `cascadeStale with changeContext`: large dependent file content truncated at 14KB
- `cascadeStale with changeContext`: summary/concepts jobs have null payload even with changeContext

## Verification Results

- 176 tests pass (was 165 before this plan — 11 new tests)
- TypeScript compiles cleanly (`tsc --noEmit` exits 0)
- esbuild succeeds with git-diff.ts included
- No `console.warn` in ast-parser.ts
- `insertLlmJobIfNotPending` has `payload?` parameter
- `cascadeStale` accepts `changeContext` in opts
- `git-diff` in package.json build script

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- src/change-detector/git-diff.ts: FOUND
- src/change-detector/change-detector.ts: FOUND
- src/cascade/cascade-engine.ts: FOUND
- commit cbfed95 (task 1): FOUND
- commit fd757ab (task 2): FOUND
- 176 tests pass
- tsc --noEmit: PASS
- npm run build: PASS
