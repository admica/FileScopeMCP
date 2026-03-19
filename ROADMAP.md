# FileScopeMCP Roadmap

This document tracks known bugs, architectural gaps, and planned features. Items are grouped by category and roughly prioritized within each section.

---

## Bug Fixes & Correctness

### ~~Concurrency: no mutex on tree mutations~~ Fixed
Added `AsyncMutex` in `mcp-server.ts`. Both `handleFileEvent` (debounce callback) and `startIntegritySweep` now call `treeMutex.run(async () => { … })`, serializing all `updateFileNodeOnChange` / `addFileNode` / `removeFileNode` + `saveFileTree` calls.

---

### ~~`calculateImportance` non-idempotent / two divergent importance formulas~~ Fixed
`calculateImportance` started from the node's existing importance value instead of recalculating from base, so calling `recalculate_importance` multiple times produced different (ever-increasing) results. Separately, `calculateImportance` (initial scan + tool) and `calculateNodeImportance` (incremental updates) had divergent logic. Both fixed: `calculateImportance` now delegates entirely to `calculateNodeImportance`, which always recalculates from `calculateInitialImportance`. The formula is now canonical and idempotent.

---

### ~~`@modelcontextprotocol/sdk` hardcoded importance bonus~~ Fixed
The formula gave +2 for files importing `@modelcontextprotocol/sdk` but only +1 for all other packages. Flattened to `Math.min(pkgDeps.length, 1)` for all package imports equally.

---

### ~~`debounceMs` config field stored but never applied~~ Fixed
`FileWatchingConfig.debounceMs` was exposed via `update_file_watching_config`, saved to disk, and returned by `get_file_watching_status`, but the actual debounce in `handleFileEvent` used a hardcoded `DEBOUNCE_DURATION_MS = 2000` constant and `FileWatcher.start()` hardcoded `awaitWriteFinish.stabilityThreshold: 300`. The config field has been removed entirely. The effective debounce is 2 s (module-level constant) plus chokidar's 300 ms write-finish stability threshold.

---

### ~~Dead `.blade.php`/`.phtml` code~~ Fixed
`.blade.php` in `IMPORT_PATTERNS` was unreachable (`path.extname('file.blade.php')` returns `.php`, not `.blade.php`). `.blade.php` and `.phtml` were listed in the `SUPPORTED_EXTENSIONS` constant, which itself was declared but never referenced anywhere. All removed. Laravel-specific directory importance bonuses (`app/Http/Controllers`, `app/Models`, `app/Providers`) also removed — too framework-specific for a generic tool.

---

### ~~`SUPPORTED_EXTENSIONS` constant declared but never used~~ Fixed
Removed entirely.

---

### Importance propagation is shallow (depth 1 only)
`recalculateImportanceForAffected` only updates the changed file and its direct dependencies. In a chain `A → B → C`, adding a new dependent to `A` never updates `C`'s score. There is even a `// Potential future enhancement` comment acknowledging this at `file-utils.ts:1346`.

**Fix:** After each node's importance changes, enqueue its dependents for recalculation. Use a visited-set to prevent infinite loops on cycles.

---

### ~~Integrity sweep ignores `autoRebuildTree`~~ Fixed
`startIntegritySweep` now checks `config.fileWatching.autoRebuildTree` before entering the mutex and healing the tree, consistent with the guard already in `handleFileEvent`.

---

### Watcher restart resets `restartAttempts` too eagerly
In `FileWatcher.restart()`, `restartAttempts` is reset to `0` immediately when `start()` succeeds (`file-watcher.ts:149`). If the watcher fails again quickly, the exponential backoff resets and the watcher hammers restarts with no real ceiling.

**Fix:** Only reset `restartAttempts` after the watcher has been stable for a minimum period (e.g., 60 seconds) rather than on the first successful start.

---

### ~~Dead modules: `grouping-rules.ts` and `layout-engine.ts`~~ Fixed
Both files were deleted when diagram/visualization code was stripped from the codebase.

---

### ~~Integrity sweep and watcher can double-save~~ Fixed (via mutex)
The `treeMutex` serializes both paths so `saveFileTree` is never called from two concurrent mutations. A dirty-flag + debounced save would be a further optimization but is not required for correctness.

---

## Architecture

### Replace polling integrity sweep with mtime-based lazy validation
The integrity sweep runs on a fixed interval regardless of activity. On large repos this is wasteful. Instead, validate a node's mtime lazily when it is first accessed (e.g., on `get_file_importance`) and only run a full sweep on explicit user request or on `create_file_tree`.

---

### ~~Separate in-memory model from persistence~~ Partially addressed in v1.0
The original concern was partial-write corruption from in-memory state being serialized to JSON. v1.0 replaced JSON storage with SQLite + WAL mode, which provides atomic writes natively — a partial crash cannot leave the database in an inconsistent state. The coordinator still uses a `reconstructTreeFromDb` bridge pattern to serve the legacy `FileNode` tree interface. A deeper refactor to eliminate the bridge and work directly against the SQLite model would improve clarity, but is no longer a correctness concern.

---

### ~~Test coverage~~ Substantially addressed in v1.0
v1.0 added 180 tests covering:
- Change detection (tree-sitter AST diffing, LLM fallback, export snapshot diffing)
- Cascade engine (BFS propagation, circular dependency protection, per-field staleness)
- LLM pipeline (job queue, priority ordering, token budget, orphan recovery)
- SQLite migration (JSON-to-SQLite auto-migration)
- MCP server integration (tool invocations, coordinator lifecycle)
- Repository layer (all CRUD operations)

Remaining gaps: full watcher debounce integration tests and large-codebase performance benchmarks.

---

## Features

### Cycle detection
The dependency parser doesn't detect circular imports. v1.0's cascade engine has circular dependency protection (visited set in BFS) that prevents infinite staleness propagation, but does not perform full SCC detection or expose cycle membership via tools.

**Still to implement:**
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

Note: per PROJECT.md, git integration is explicitly out of scope for the current milestone. Listed here for future consideration.

---

### ~~Summary auto-generation~~ Done in v1.0
v1.0 added a full background LLM pipeline that auto-generates summaries, concepts, and change impact assessments for all files. The `toggle_llm` MCP tool enables/disables the pipeline at runtime. This is now a first-class feature, not a hint — no separate `generate_summaries` tool is needed.

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
Currently file watching is a global toggle. This is less relevant now that the system runs one instance per project, but per-directory granularity remains a useful enhancement.

---

### Performance: large codebase handling
- Stream `scanDirectory` results instead of building the full tree in memory before returning
- Add an optional `.filescopeignore` file (gitignore syntax) as an alternative to the `excludePatterns` config
- Lazy-load file content in `read_file_content` — don't buffer entire files for large binaries

---

## Code Quality

- **Double `fs` import in `file-utils.ts`** — both `import * as fs from 'fs'` and `import * as fsPromises from 'fs/promises'` and `import * as fsSync from 'fs'` are present. Consolidate to a single `fs/promises` import with sync operations imported separately where needed.
- **`normalizePath` consolidation** — `normalizePath` is defined in `file-utils.ts` but re-exported and used inconsistently alongside `normalizeAndResolvePath` from `storage-utils.ts`; consolidate to one canonical function
- **`console.error` routing** — `console.error` is used in `logger.ts` itself (two occurrences) but the rest of the codebase routes through `log()`. Ensure all error logging is consistent.
- **`firebase` false positive** — `PackageDependency.fromPath()` in `types.ts` has a hardcoded fallback list `['react', 'axios', 'uuid', 'yup', 'express', 'firebase', 'date-fns']` used when a path doesn't contain `node_modules`. Any resolved path containing these strings gets misclassified. Fix: remove the hardcoded list and only classify packages whose path contains `node_modules/`, or require the import string to start with the bare package name (no path separator).
- **`createFileTree` dead code** — exported from `file-utils.ts` but never imported anywhere; remove or internalize.
