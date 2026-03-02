# FileScopeMCP Roadmap

This document tracks known bugs, architectural gaps, and planned features. Items are grouped by category and roughly prioritized within each section.

---

## 🐛 Bug Fixes & Correctness

### ~~Concurrency: no mutex on tree mutations~~ ✅ Fixed
Added `AsyncMutex` in `mcp-server.ts`. Both `handleFileEvent` (debounce callback) and `startIntegritySweep` now call `treeMutex.run(async () => { … })`, serializing all `updateFileNodeOnChange` / `addFileNode` / `removeFileNode` + `saveFileTree` calls.

---

### ~~`calculateImportance` non-idempotent / two divergent importance formulas~~ ✅ Fixed
`calculateImportance` started from the node's existing importance value instead of recalculating from base, so calling `recalculate_importance` multiple times produced different (ever-increasing) results. Separately, `calculateImportance` (initial scan + tool) and `calculateNodeImportance` (incremental updates) had divergent logic. Both fixed: `calculateImportance` now delegates entirely to `calculateNodeImportance`, which always recalculates from `calculateInitialImportance`. The formula is now canonical and idempotent.

---

### ~~`@modelcontextprotocol/sdk` hardcoded importance bonus~~ ✅ Fixed
The formula gave +2 for files importing `@modelcontextprotocol/sdk` but only +1 for all other packages. Flattened to `Math.min(pkgDeps.length, 1)` for all package imports equally.

---

### ~~`debounceMs` config field stored but never applied~~ ✅ Fixed
`FileWatchingConfig.debounceMs` was exposed via `update_file_watching_config`, saved to disk, and returned by `get_file_watching_status`, but the actual debounce in `handleFileEvent` used a hardcoded `DEBOUNCE_DURATION_MS = 2000` constant and `FileWatcher.start()` hardcoded `awaitWriteFinish.stabilityThreshold: 300`. The config field has been removed entirely. The effective debounce is 2 s (module-level constant) plus chokidar's 300 ms write-finish stability threshold.

---

### ~~Dead `.blade.php`/`.phtml` code~~ ✅ Fixed
`.blade.php` in `IMPORT_PATTERNS` was unreachable (`path.extname('file.blade.php')` returns `.php`, not `.blade.php`). `.blade.php` and `.phtml` were listed in the `SUPPORTED_EXTENSIONS` constant, which itself was declared but never referenced anywhere. All removed. Laravel-specific directory importance bonuses (`app/Http/Controllers`, `app/Models`, `app/Providers`) also removed — too framework-specific for a generic tool.

---

### ~~`SUPPORTED_EXTENSIONS` constant declared but never used~~ ✅ Fixed
Removed entirely.

---

### Importance propagation is shallow (depth 1 only)
`recalculateImportanceForAffected` only updates the changed file and its direct dependencies. In a chain `A → B → C`, adding a new dependent to `A` never updates `C`'s score. There is even a `// Potential future enhancement` comment acknowledging this at `file-utils.ts:1346`.

**Fix:** After each node's importance changes, enqueue its dependents for recalculation. Use a visited-set to prevent infinite loops on cycles.

---

### ~~Integrity sweep ignores `autoRebuildTree`~~ ✅ Fixed
`startIntegritySweep` now checks `config.fileWatching.autoRebuildTree` before entering the mutex and healing the tree, consistent with the guard already in `handleFileEvent`.

---

### Watcher restart resets `restartAttempts` too eagerly
In `FileWatcher.restart()`, `restartAttempts` is reset to `0` immediately when `start()` succeeds (`file-watcher.ts:149`). If the watcher fails again quickly, the exponential backoff resets and the watcher hammers restarts with no real ceiling.

**Fix:** Only reset `restartAttempts` after the watcher has been stable for a minimum period (e.g., 60 seconds) rather than on the first successful start.

---

### ~~Dead modules: `grouping-rules.ts` and `layout-engine.ts`~~ ✅ Fixed
Both files were deleted when diagram/visualization code was stripped from the codebase.

---

### ~~Integrity sweep and watcher can double-save~~ ✅ Fixed (via mutex)
The `treeMutex` serializes both paths so `saveFileTree` is never called from two concurrent mutations. A dirty-flag + debounced save would be a further optimization but is not required for correctness.

---

## 🏗️ Architecture

### Replace polling integrity sweep with mtime-based lazy validation
The integrity sweep runs on a fixed interval regardless of activity. On large repos this is wasteful. Instead, validate a node's mtime lazily when it is first accessed (e.g., on `get_file_importance`) and only run a full sweep on explicit user request or on `create_file_tree`.

---

### Separate in-memory model from persistence
Currently `fileTree` is both the live working object and what gets serialized. This makes it fragile — a partial mutation that crashes before `saveFileTree` leaves the JSON inconsistent.

**Fix:** Introduce a write-ahead or copy-on-write pattern: mutate a working copy, then atomically swap and save. A temp-file + rename approach for `saveFileTree` would prevent partial-write corruption.

---

### Test coverage
Only `file-utils.test.ts` exists, covering path normalization. The following are completely untested:
- `updateFileNodeOnChange` diff logic
- `addFileNode` / `removeFileNode` reverse-dep map updates
- Importance recalculation after graph changes
- Integrity check detection (stale / missing / new)
- Watcher debounce and event filtering

**Fix:** Add unit tests for each of the above using Vitest with a mocked filesystem (`memfs` or similar).

---

## ✨ Features

### Cycle detection
The dependency parser doesn't detect circular imports. Cycles silently break the importance propagation loop guard (which doesn't exist yet), and an AI navigating a cyclic dependency will get misleading importance scores.

**Implement:**
- Detect cycles during `scanDirectory` using DFS with gray/black node coloring (Tarjan's SCC gives you the full component, not just a boolean)
- Store cycle membership on each `FileNode` (e.g. `cycleGroup?: string`)
- Expose cycle information via `get_file_importance` and `find_important_files`
- Cap importance propagation when a cycle is detected to prevent infinite recalculation

---

### Git integration
Surface version-control context alongside dependency data:
- Mark files changed in the current working tree (unstaged/staged)
- Show last-commit date per file as a proxy for "recently active"
- Optional: weight importance by recency so stale files rank lower

---

### Richer language support
Current import parsers are regex-based and miss common patterns:
- **TypeScript/JavaScript:** dynamic `import()`, `require()` with variables, barrel re-exports (`export * from`)
- **Python:** relative imports (`from . import`), `importlib`
- **Rust:** `mod` declarations resolving to `mod.rs` or same-name files
- **Go:** not supported at all
- **Ruby:** not supported at all

---

### File watching: per-tree enable/disable
Currently file watching is a global toggle. Users with multiple project trees loaded should be able to watch some and not others.

---

### Summary auto-generation hint
Add a `generate_summaries` tool (or flag on `create_file_tree`) that prompts the calling AI to read and summarize all files above a given importance threshold, using the existing `set_file_summary` tool. This is already mentioned in the README as a manual workflow — make it a first-class tool action.

---

### Performance: large codebase handling
- Stream `scanDirectory` results instead of building the full tree in memory before returning
- Add an optional `.filescopeignore` file (gitignore syntax) as an alternative to the `excludePatterns` config
- Lazy-load file content in `read_file_content` — don't buffer entire files for large binaries

---

## 🧹 Code Quality

- Remove the double `fs` import in `file-utils.ts` (both `import * as fs` and `import * as fsSync from "fs"`)
- `normalizePath` is defined in `file-utils.ts` but re-exported and used inconsistently alongside `normalizeAndResolvePath` from `storage-utils.ts` — consolidate to one canonical function
- `console.error` is used for operational logging in `file-watcher.ts`, `storage-utils.ts`, `config-utils.ts`, and `global-state.ts`; all four should route through the `logger.ts` `log()` function
- `firebase` appearing as a package dependency is a false positive: `PackageDependency.fromPath()` in `types.ts` has a hardcoded fallback list `['react', 'axios', 'uuid', 'yup', 'express', 'firebase', 'date-fns']` used when a path doesn't contain `node_modules`. Any resolved path containing these strings gets misclassified. Fix: remove the hardcoded list and only classify packages whose path contains `node_modules/`, or require the import string to start with the bare package name (no path separator).
- `createFileTree` exported function in `file-utils.ts` is dead code — exported but never imported anywhere
