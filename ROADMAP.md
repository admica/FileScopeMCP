# FileScopeMCP Roadmap

This document tracks known bugs, architectural gaps, and planned features. Items are grouped by category and roughly prioritized within each section.

---

## Completed (v1.0+)

Items below have been implemented and are listed here for historical context.

### Bug Fixes
- **Concurrency: no mutex on tree mutations** — Added `AsyncMutex` serializing all watcher and sweep mutations.
- **`calculateImportance` non-idempotent** — Formula now always recalculates from base; canonical and idempotent.
- **`@modelcontextprotocol/sdk` hardcoded importance bonus** — Flattened to equal weight for all package imports.
- **`debounceMs` config field stored but never applied** — Field removed; effective debounce is 2 s constant + chokidar 300 ms stability threshold.
- **Dead `.blade.php`/`.phtml` code** — Removed unreachable patterns and unused `SUPPORTED_EXTENSIONS`.
- **Integrity sweep ignores `autoRebuildTree`** — Now respects the config flag.
- **Dead modules: `grouping-rules.ts` and `layout-engine.ts`** — Deleted.
- **Integrity sweep and watcher can double-save** — Serialized via mutex.
- **Watcher restart resets `restartAttempts` too eagerly** — Now requires 60 s stability before resetting backoff counter.
- **Importance propagation shallow (depth 1 only)** — `recalculateImportanceForAffected` now propagates transitively through dependents with visited-set cycle protection.
- **`normalizePath` consolidation** — Unified into `canonicalizePath` with cosmetic and resolution modes.

### Architecture
- **Replace polling integrity sweep with mtime-based lazy validation** — One-time startup sweep replaces the 30 s polling loop. Per-file mtime checks on MCP tool access catch changes missed by the watcher. No more periodic full-tree scans.
- **SQLite storage** — Replaced JSON file persistence with SQLite + WAL mode. drizzle-orm typed schema. Auto-migration from legacy JSON trees.
- **Test coverage** — 880+ tests covering change detection, cascade engine, LLM pipeline, SQLite migration, MCP server integration, repository layer, coordinator lifecycle, cycle detection, streaming scan, `.filescopeignore`, symbol extraction, call-site edges, community detection, search tokenization, path-portability invariants, and InMemoryTransport integration.

### Features
- **Summary auto-generation** — Full background LLM pipeline with multi-provider support (Anthropic, Ollama, OpenAI-compatible).
- **Cycle detection** — Iterative Tarjan's SCC algorithm detects all circular dependency groups. Exposed via `detect_cycles` and `get_cycles_for_file` MCP tools.
- **Community detection** — Louvain clustering on import graph groups tightly-coupled files. Exposed via `get_communities` MCP tool.
- **Go language support** — `import` statement parsing with `go.mod` module resolution. Tree-sitter symbol extraction.
- **Ruby language support** — `require` and `require_relative` parsing with `.rb` probing. Tree-sitter symbol extraction.
- **Python language support** — Tree-sitter AST for both dependency edges and symbol extraction.
- **Symbol extraction** — Tree-sitter-based extraction of functions, classes, interfaces, types, enums, consts, modules, and structs for TS/JS, Python, Go, and Ruby. Exposed via `find_symbol` MCP tool.
- **Call-site edges** — TS/JS call-expression resolution linking caller symbols to callee symbols with confidence scoring. Exposed via `find_callers` and `find_callees` MCP tools.
- **Changed-since tracking** — `list_changed_since` tool finds files modified after a timestamp or git SHA.
- **Metadata search** — `search` tool queries across symbols, purpose, summaries, and paths with ranked results.
- **Streaming directory scan** — `scanDirectory` converted to async generator using `fs.promises.opendir`. Eliminates full-tree memory buildup.
- **`.filescopeignore` support** — Gitignore-syntax exclusion file loaded at startup, applied alongside `config.json` exclude patterns.
- **Exclusion pattern persistence** — `exclude_and_remove` saves patterns to `config.json` (replaced legacy `FileScopeMCP-excludes.json`).
- **Daemon mode** — Standalone `--daemon` operation with PID guard, graceful shutdown, and file-only logging.
- **Coordinator config reload** — `init()` reloads `config.json` from disk each time, so runtime edits take effect without server restart.
- **Ghost record purge** — `purgeRecordsOutsideRoot()` cleans database records from wrong project paths.
- **Nexus dashboard** — Web UI at `localhost:1234` for visual codebase exploration across repos. File trees, dependency graphs, live broker activity, per-repo health.

---

## Open Items

### Bug Fixes & Correctness

#### `PackageDependency` false positives
`PackageDependency.fromPath()` in `types.ts` has a hardcoded fallback list (`react`, `axios`, `uuid`, `yup`, `express`, `firebase`, `date-fns`) used when a path doesn't contain `node_modules`. Any resolved path containing these strings gets misclassified.

**Fix:** Remove the hardcoded list and only classify packages whose path contains `node_modules/`, or require the import string to start with the bare package name.

---

### Architecture

#### Eliminate `reconstructTreeFromDb` bridge
The coordinator reconstructs a `FileNode` tree from SQLite for tools that expect the legacy tree shape. This adds overhead and complexity. Refactoring tools to query SQLite directly would simplify the data path.

---

#### Separate in-memory model from persistence (further)
SQLite + WAL solved the partial-write corruption concern, but the coordinator still rebuilds the full `FileNode` tree for several operations. Working directly against the SQLite model would improve both clarity and memory usage on large projects.

---

### Features

#### Git integration
Surface version-control context alongside dependency data:
- Mark files changed in the current working tree (unstaged/staged)
- Show last-commit date per file as a proxy for "recently active"
- Optional: weight importance by recency so stale files rank lower

Note: explicitly out of scope for the current milestone. Listed here for future consideration.

---

#### File watching: per-directory granularity
Currently file watching is a global toggle. Per-directory enable/disable would allow ignoring noisy directories while watching the rest.

---

#### Call-site edges for Python, Go, Ruby
TS/JS call-site edge extraction is complete. Extending `find_callers` / `find_callees` to Python, Go, and Ruby requires per-language call-expression AST walkers and resolution logic.

---

#### Performance: large codebase handling
- Benchmark and optimize for repos with 10k+ files

---

#### Richer language support
Some edge cases remain:
- **TypeScript/JavaScript:** dynamic `import()` with variable arguments
- **Python:** `importlib` dynamic imports
- **Rust:** complex `mod` path resolution in workspaces
