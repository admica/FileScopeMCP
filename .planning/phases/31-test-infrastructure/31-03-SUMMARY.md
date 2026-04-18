---
phase: 31-test-infrastructure
plan: "03"
subsystem: test-infrastructure
tags: [testing, vitest, file-watcher, config-utils, chokidar, mocking]
dependency_graph:
  requires: []
  provides:
    - tests/unit/file-watcher.test.ts
    - tests/unit/config-loading.test.ts
  affects:
    - src/file-watcher.ts
    - src/config-utils.ts
    - src/cascade/cascade-engine.ts
    - src/change-detector/change-detector.ts
tech_stack:
  added: []
  patterns:
    - vi.mock('chokidar') with EventEmitter for filesystem watcher isolation
    - fs.mkdtemp() + afterAll fs.rm() for temp dir test lifecycle
key_files:
  created:
    - tests/unit/file-watcher.test.ts
    - tests/unit/config-loading.test.ts
  modified: []
decisions:
  - Shared mock EventEmitter increased to setMaxListeners(50) to prevent spurious MaxListenersExceededWarning when multiple FileWatcher instances accumulate listeners in one test run
  - TEST-06 and TEST-07 gap audits found no gaps — existing tests already satisfy all required behaviors
  - Task 3 produced no file changes (audit-only result); committed as documentation in summary
metrics:
  duration_minutes: 12
  tasks_completed: 3
  files_created: 2
  files_modified: 0
  tests_added: 16
  completed_date: "2026-04-18"
---

# Phase 31 Plan 03: File Watcher and Config Loading Tests Summary

**One-liner:** FileWatcher event dispatch and ignore-pattern tests via vi.mock('chokidar') plus config loading edge case coverage for all four loadConfig code paths.

## Tasks Completed

| Task | Name | Commit | Result |
|------|------|--------|--------|
| 1 | Create file watcher unit tests with mocked chokidar | bda2524 | 11 tests, 265 lines |
| 2 | Create config loading edge case tests | ed1e0af | 5 tests, 79 lines |
| 3 | Audit cascade engine and change detector test coverage | no-files-changed | No gaps found |

## What Was Built

### Task 1: tests/unit/file-watcher.test.ts (265 lines, 11 tests)

FileWatcher unit tests using `vi.mock('chokidar')` to inject a controllable EventEmitter. No real filesystem watchers are opened. Tests:

**Event dispatch (add/change/unlink):**
- Registered callback is called for 'add' event with correct (path, 'add') args
- Registered callback is called for 'change' event
- Registered callback is called for 'unlink' event
- Multiple callbacks (cb1, cb2) both receive each event
- `chokidar.watch` is invoked with the base directory

**Config-based event filtering:**
- `watchForNewFiles: false` prevents 'add' callbacks from firing
- `watchForChanged: false` prevents 'change' callbacks from firing
- `watchForDeleted: false` prevents 'unlink' callbacks from firing

**Ignore pattern tests (path-level filtering in onFileEvent):**
- `ignoreDotFiles: true` prevents callback for `.hidden-file.ts` (relative path matches `/(^|[\/\\])\../`)
- `excludePatterns: ['**/node_modules/**']` prevents callback for `node_modules/foo/index.js` while allowing `src/app.ts`

**Stop behavior:**
- No callbacks called before any events are emitted post-stop (verified guard state)

### Task 2: tests/unit/config-loading.test.ts (79 lines, 5 tests)

Config loading edge case tests using a temp directory (created in `beforeAll`, removed in `afterAll` via `fs.rm`). Covers all four code paths in `loadConfig()`:

1. **Missing file** → `loadConfig('/tmp/.../nonexistent/config.json')` → returns `DEFAULT_CONFIG` with `version === '1.0.0'`
2. **Malformed JSON** → `{not valid json!!!}` → JSON.parse error caught → returns `DEFAULT_CONFIG`
3. **Invalid Zod schema** → `{ notAValidField: 42, anotherBad: 'value' }` → ConfigSchema.parse fails → returns `DEFAULT_CONFIG`
4. **Valid config** → full valid JSON matching ConfigSchema → returns parsed config with correct values (`baseDirectory`, `excludePatterns`, `fileWatching.maxWatchedDirectories`)
5. **Empty file** → `''` → JSON.parse error caught → returns `DEFAULT_CONFIG`

Threat model mitigations confirmed: `afterAll` calls `fs.rm(tmpDir, { recursive: true, force: true })` (T-31-07).

### Task 3: TEST-06 and TEST-07 Audit

**No gaps found in either test file.** Both existing test files satisfy all required behaviors.

**TEST-06 (cascade engine) — disposition: COVERED by existing tests**

`src/cascade/cascade-engine.test.ts` (421 lines) satisfies all TEST-06 requirements:
- Staleness propagation through dependency chains: "marks A, B, C all stale and queues 9 LLM jobs when A has dependents B->C chain" — 3-level chain, all stale
- Marking a file stale marks its dependents stale: same test confirms B and C staleness
- Multi-level propagation: confirmed by the A->B->C chain test with `cascadeStale(aPath, { timestamp: 2000 })`
- Files with no dependents are unaffected by cascade: "marks only the changed file when it has zero dependents" — only 3 submitJob calls for 1 file

**TEST-07 (change detector) — disposition: COVERED by existing tests**

`src/change-detector/change-detector.test.ts` (279 lines) satisfies all TEST-07 requirements:
- AST-level change detection: "classifies a .ts file and returns SemanticChangeSummary with confidence=ast"
- Breaking change classification: "produces affectsDependents=true for an export signature change on a .ts file" — changeType='exports-changed'
- "No changes" / body-only case: "produces affectsDependents=false for a body-only change on a .ts file" — changeType='body-only', same exported signature, different body content

## Verification Results

```
Tests  11 passed (11) — tests/unit/file-watcher.test.ts
Tests   5 passed (5)  — tests/unit/config-loading.test.ts
Tests  28 passed (28) — src/cascade/cascade-engine.test.ts + src/change-detector/change-detector.test.ts
─────────────────────────────────────────────────────
Tests  44 passed (44) — combined run, 4 test files
```

All tests pass. No real filesystem watchers opened. Temp dirs cleaned up.

## Deviations from Plan

**1. [Rule 2 - Enhancement] setMaxListeners(50) on shared mock EventEmitter**
- **Found during:** Task 1 verification
- **Issue:** The mock EventEmitter is shared across all 11 tests in the file. Each `FileWatcher.start()` call registers 'error' and 'ready' event listeners. With the default limit of 10, Node.js emits a `MaxListenersExceededWarning` after the 11th listener.
- **Fix:** Added `mockWatcher.setMaxListeners(50)` in the vi.mock factory
- **Files modified:** tests/unit/file-watcher.test.ts
- **Commit:** bda2524 (included in same commit)

**2. Task 3 no-commit result**
- No file modifications required — audit found no gaps. Task 3 documented in this summary only.

## Known Stubs

None — no stub patterns found in created files.

## Threat Flags

None — test files do not introduce new network endpoints, auth paths, or file access patterns beyond controlled temp directories.

## Self-Check: PASSED

Files exist:
- tests/unit/file-watcher.test.ts: FOUND (265 lines)
- tests/unit/config-loading.test.ts: FOUND (79 lines)
- .planning/phases/31-test-infrastructure/31-03-SUMMARY.md: FOUND (this file)

Commits exist:
- bda2524: feat(31-03): add FileWatcher unit tests with mocked chokidar — FOUND
- ed1e0af: feat(31-03): add config loading edge case tests covering all loadConfig paths — FOUND
