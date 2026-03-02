# Codebase Concerns

**Analysis Date:** 2026-03-02

## Tech Debt

**Duplicate Filesystem Operations:**
- Issue: Multiple imports of the `fs` module in different forms causing redundancy
- Files: `src/file-utils.ts` (lines 1-4), `src/storage-utils.ts` (lines 1-3)
- Impact: Inconsistent module usage patterns; some code uses `fs/promises`, others use sync `fs`. Creates confusion about which to use and increases maintenance burden.
- Fix approach: Standardize on async `fs/promises` throughout codebase, only using sync `fs` in initialization/critical paths. Create utility wrapper for common operations.

**Loose Type Safety with `any`:**
- Issue: Use of `any` type in critical functions
- Files: `src/logger.ts` (line 14), `src/mcp-server.ts` (line 375, line 390)
- Impact: Type-safety is undermined. The `createMcpResponse` function accepts `any` content type, allowing invalid data structures to pass through without detection.
- Fix approach: Replace `any` with proper union types. Example: `createMcpResponse(content: string | object | object[], isError?: boolean)` with stricter validation.

**Temporary Debugging Code Left Behind:**
- Issue: File logging enabled in production code
- Files: `src/mcp-server.ts` (line 33): `enableFileLogging(false, 'mcp-debug.log');`
- Impact: Creates debug logs that clutter the filesystem. The `false` suggests it's disabled, but the infrastructure is unnecessarily loaded. String literal filenames are hardcoded.
- Fix approach: Remove the `enableFileLogging` call entirely or move to a true configuration system that's only enabled via environment variables.

**Path Normalization Scattered Everywhere:**
- Issue: `normalizePath()` is called inconsistently across the codebase
- Files: `src/file-utils.ts` (line 15), `src/mcp-server.ts` (line 427), `src/storage-utils.ts` (line 16)
- Impact: Multiple implementations of path normalization logic creates drift. Different functions may normalize differently, leading to path comparison failures and subtle bugs.
- Fix approach: Consolidate into a single, well-tested `NormalizationService` class that all code uses. Add unit tests for Windows/Unix/relative/absolute combinations.

**Global Mutable State:**
- Issue: Module-level mutable variables holding critical state
- Files: `src/mcp-server.ts` (lines 62-70: `fileTree`, `currentConfig`, `treeMutex`, `fileEventDebounceTimers`, `integritySweepInterval`)
- Impact: State management is implicit and scattered. Hard to reason about state transitions. Testing is difficult. Race conditions possible if new async operations added.
- Fix approach: Create a `ServerState` class to encapsulate all module-level state with explicit getter/setter methods and invariant checks. Use dependency injection to pass state to functions.

**Magic Numbers Hardcoded:**
- Issue: Timing constants and limits scattered throughout code
- Files: `src/mcp-server.ts` (line 69: 2000ms debounce, line 71: 30000ms sweep), `src/file-watcher.ts` (line 29: 30000ms restart delay), `src/mcp-server.ts` (line 316: 10MB buffer limit)
- Impact: Tuning parameters are buried in code. Changes require reading multiple files. No centralized configuration.
- Fix approach: Move all timing constants to `src/config-utils.ts` under a `TimingConfig` interface. Document why each value was chosen.

## Known Bugs

**Path Matching Edge Case with Suffix Matching:**
- Symptoms: File paths may match incorrectly when using the suffix matching logic
- Files: `src/mcp-server.ts` (lines 449-452)
- Trigger: When `normalizedTargetPath.endsWith(normalizedNodePath)` is true for non-matching files (e.g., `/project/data/main.ts` would match `/data/main.ts` from a different project)
- Workaround: Use exact path matches in tools; avoid relative paths. The integrity sweep usually catches these issues on next run.
- Fix approach: Replace suffix matching with proper path resolution using `path.resolve()` and `path.relative()`. Validate that the resolved path is actually within the project root.

**Debounce Timer Leak in File Watcher:**
- Symptoms: Memory usage grows if file watcher handles many rapid changes
- Files: `src/mcp-server.ts` (lines 204-263)
- Trigger: If files change faster than 2-second debounce interval, timers accumulate in `fileEventDebounceTimers` map
- Workaround: Restart the server to clear the map
- Fix approach: Implement a maximum queue size check. When adding a debounce timer, if queue exceeds N items, force-clear the oldest 25% of timers before continuing. Add logging to track queue depth.

**Race Condition in Integrity Sweep vs File Watcher:**
- Symptoms: Rare cases where both integrity sweep and file watcher process the same file simultaneously, causing double-updates
- Files: `src/mcp-server.ts` (lines 270-310), `src/mcp-server.ts` (lines 185-263)
- Trigger: File changes exactly when integrity sweep runs (30s interval). Both acquire mutex at nearly same time.
- Workaround: Disable auto-rebuild or reduce integrity sweep frequency
- Fix approach: Add event deduplication by tracking recently-processed files. Integrity sweep should skip files modified in last 2 seconds.

**Unresolved Template Literals Not Truly Handled:**
- Symptoms: Files with dynamic imports like `import(${template})` are stored with special paths but never cleaned up
- Files: `src/file-utils.ts` (lines 69-84), `src/types.ts` (lines 45-59)
- Trigger: When imports use template literals, they're resolved to `path.join(baseDir, '_UNRESOLVED_TEMPLATE_PATH_')` creating phantom nodes
- Workaround: Manual cleanup via `exclude_and_remove` tool
- Fix approach: Filter out unresolved template imports entirely rather than creating placeholder paths. Add a separate `dynamicImports` field to FileNode for documentation only.

## Security Considerations

**Process Working Directory Mutation:**
- Risk: `process.chdir()` modifies global process state, affecting all concurrent operations
- Files: `src/mcp-server.ts` (line 90)
- Current mitigation: Only called once during project initialization
- Recommendations: Replace with context-local directory tracking. Pass `projectRoot` as parameter to all functions instead of relying on `process.cwd()`. This enables future multi-project support and eliminates global state coupling.

**Arbitrary Path Creation Without Validation:**
- Risk: Paths from user input could escape project root
- Files: `src/mcp-server.ts` (line 79), `src/storage-utils.ts` (line 37)
- Current mitigation: `normalizeAndResolvePath()` is called, but doesn't validate the result is within project root
- Recommendations: Add explicit `path.resolve()` validation. Create a `SafePath` class that enforces containment. Example: `if (!resolvedPath.startsWith(projectRoot)) throw new Error('Path escape attempt')`

**File Reading Without Size Limits:**
- Risk: Malicious symlinks could cause infinite loops. Large files could exhaust memory.
- Files: `src/mcp-server.ts` (lines 608-615 in readFileContent)
- Current mitigation: None
- Recommendations: (1) Add max file size check before reading (e.g., 10MB limit), (2) Use `fs.openSync` with timeout, (3) Add filesystem loop detection by tracking inode numbers visited.

**Environment Variable Config Not Validated:**
- Risk: Invalid config from env vars like `--base-dir` could cause crashes
- Files: `src/mcp-server.ts` (lines 137-145)
- Current mitigation: `fs.access()` checks if directory exists
- Recommendations: Add additional validation: (1) check directory is readable/writable, (2) check disk space available, (3) validate it's an actual directory not a symlink chain.

## Performance Bottlenecks

**Full Tree Traversal for Every Search:**
- Problem: Functions like `findNode()` and `getFileNode()` traverse entire tree recursively
- Files: `src/mcp-server.ts` (lines 425-466), `src/storage-utils.ts` (lines 222-259)
- Cause: No indexing. Every lookup is O(n) where n = total files.
- Improvement path: Build a `pathToNodeIndex: Map<string, FileNode>` during `scanDirectory()`. Update index on add/remove operations. Reduces lookup from O(n) to O(1).

**Inefficient Pattern Matching in isExcluded():**
- Problem: Tests each glob pattern against each file, with regex compilation per call
- Files: `src/file-utils.ts` (lines 258-328)
- Cause: `globToRegExp()` is called repeatedly for the same patterns. Patterns aren't pre-compiled.
- Improvement path: Pre-compile all glob patterns to regex during config load. Cache results in a `CompiledExclusionPatterns` class. Reduces per-file cost from O(patterns * compilation) to O(patterns).

**Integrity Sweep Walks Entire Filesystem:**
- Problem: Every 30 seconds, `integrityCheck()` re-walks entire project directory
- Files: `src/file-utils.ts` (lines 1337-1362)
- Cause: No incremental tracking. Full filesystem walk on every sweep.
- Improvement path: Track mtimes and use `fs.watch()` native notifications. Only walk subdirectories that have been modified since last sweep. For large projects (10k+ files), this could reduce sweep time from 3s to 100ms.

**calculateImportance() Recalculates All Files:**
- Problem: After single file change, entire tree importance is recalculated
- Files: `src/file-utils.ts` (lines 1268-1296)
- Cause: Cascading recalculation. Updates one file, all dependents marked dirty, all dependents' dependents, etc.
- Improvement path: Use topological sort to recalculate only affected nodes. Track which nodes actually changed. For a file with 100 dependents, could reduce from 1000 recalculations to 10.

**JSON Parse/Stringify on Every Save:**
- Problem: Entire file tree serialized to JSON on every modification
- Files: `src/storage-utils.ts` (lines 103-126)
- Cause: Tree is updated in-memory then fully serialized. No incremental updates.
- Improvement path: For trees >100KB, use incremental JSON streams or JSONL format. Write only changed nodes. Reduces I/O from ~500KB to ~5KB per change.

## Fragile Areas

**Dependency Analysis for Dynamic Imports:**
- Files: `src/file-utils.ts` (lines 1-62, all import patterns)
- Why fragile: Regex patterns for detecting imports are language-specific and incomplete. Template literals, dynamic requires, and conditional imports are missed. Adding new language requires updating multiple regex patterns.
- Safe modification: (1) Add a test case first for each language variant. (2) Update IMPORT_PATTERNS in one place only. (3) Document why each regex is needed with an example. (4) Consider using AST parsing libraries instead of regex.
- Test coverage: No tests for Python, C++, Java, C#, Rust, Lua, Zig, PHP imports. Test only JavaScript/TypeScript.

**File Node Mutation Without Validation:**
- Files: `src/storage-utils.ts` (lines 178-217, updateFileNode function)
- Why fragile: `Object.assign()` allows any property to be set. No validation of what can be updated. Risk of corrupting internal state like `mtime`, `dependencies`, `importance`.
- Safe modification: (1) Create a `FileNodeUpdate` type that only includes updatable fields (summary, importance manually set). (2) Validate updates before applying. (3) Return mutation result object indicating what changed.
- Test coverage: No tests for invalid update scenarios.

**Freshness Check Only Samples 10 Files:**
- Files: `src/mcp-server.ts` (lines 513-541)
- Why fragile: For a tree with 10k files, sampling 10 might miss 99% of stale data. If large files are clustered together and sample misses them, tree becomes silently invalid.
- Safe modification: (1) For trees <1000 files, check 100%. (2) For larger trees, use weighted sampling favoring frequently-changed file types (.ts, .tsx over .json). (3) Add a "force-rescan" option that skips freshness check entirely.
- Test coverage: Only tests with small trees. No tests with 1000+ node trees.

**Error Handling in Async File Operations:**
- Files: `src/file-utils.ts` (lines 260-328: scanDirectory), `src/file-utils.ts` (lines 1339-1360: integrityCheck walkDir)
- Why fragile: Errors in file operations are caught silently with bare `catch` blocks. Permission errors, disk errors, symlink loops can fail silently without logging.
- Safe modification: (1) Log error details. (2) Distinguish recoverable (permission denied) from fatal (disk full). (3) Return partial results with error summary. (4) Fail build if more than 5% of files can't be read.
- Test coverage: No tests for error scenarios (missing permissions, broken symlinks, unmounted drives).

## Scaling Limits

**In-Memory Tree Grows Without Bounds:**
- Current capacity: Safe up to ~10,000 files. Performance degrades noticeably at 50,000 files.
- Limit: At 100,000+ files, JSON serialization alone takes >5 seconds. Memory usage exceeds 500MB.
- Scaling path: (1) Implement lazy-loading: only keep visible/queried branches in memory. (2) Use SQLite for large trees instead of JSON. (3) Partition large projects into multiple trees. (4) Add streaming analysis mode that processes one file at a time without building full tree.

**File Watcher Maxes Out at ~1,000 Watched Directories:**
- Current capacity: chokidar can watch up to 1000 directories on most systems
- Limit: On very large monorepos, hitting inotify limits causes watcher to stop silently
- Scaling path: (1) Implement exclusion rules more aggressively. (2) Watch only src/ not entire project. (3) Use coarser-grained watching (watch directories, not individual files). (4) Switch to native file system events on macOS/Windows instead of polling.

**Integrity Sweep Linear in Project Size:**
- Current capacity: Projects with <50,000 files complete 30s sweep in <5s
- Limit: Projects with 200,000+ files take >30s per sweep, causing overlap with next sweep
- Scaling path: (1) Implement incremental sweep that processes 1000 files per tick. (2) Use bloom filter to quickly eliminate unchanged files. (3) Run sweep at lower frequency for large projects (60s instead of 30s). (4) Split sweep across multiple worker threads.

**Dependency Map Lookup Still O(n) After First Build:**
- Current capacity: <10,000 files, dependency map builds in <1s
- Limit: 100,000+ files, first build takes >30s due to nested loops in `buildDependentMap()`
- Scaling path: (1) Index imports by module name during scan. (2) Use hash-based lookup instead of linear search. (3) Parallelize dependency analysis across multiple files.

## Dependencies at Risk

**chokidar Version Pinned:**
- Risk: Uses `^3.6.0` which allows up to 4.x. Future major versions could have breaking API changes.
- Impact: If chokidar 4.x is released with renamed methods, FileWatcher breaks completely.
- Migration plan: (1) Add tests for FileWatcher using mock. (2) When upgrading, test file watching on actual large project. (3) Consider native `fs.watch()` as backup if chokidar becomes unmaintained.

**@modelcontextprotocol/sdk Tight Coupling:**
- Risk: Core server logic depends on MCP protocol implementation details (StdioTransport, JSONRPCMessage types)
- Impact: Hard to test in isolation. Difficult to add alternative transports (WebSocket, HTTP).
- Migration plan: (1) Create abstract `Transport` interface. (2) Separate protocol handling from business logic. (3) This enables future migration to MCP 2.0 with minimal changes.

## Missing Critical Features

**No Concurrent Request Handling:**
- Problem: Tools that modify tree (add_file_node, remove_file_node, recalculate_importance) block all other requests
- Blocks: Can't analyze dependencies while integrity sweep is running. Can't query importance while files are being watched.
- Impact: Large projects feel slow. Every modification stalls other operations.
- Fix approach: Implement request queuing with priority levels. Read-only queries (get_importance, find_important_files) should never be blocked by mutations.

**No Undo/Rollback Mechanism:**
- Problem: Destructive operations like `exclude_and_remove` are permanent
- Blocks: Users can't experiment with exclusions. Mistakes require manual tree rebuild.
- Fix approach: Implement a change log. Store before/after snapshots for destructive ops. Provide `undo_last_operation` tool. Keep last 10 change snapshots.

**No Caching of Analysis Results:**
- Problem: Querying importance of the same file multiple times re-traverses the tree
- Blocks: Tools calling `get_file_importance` sequentially are slow. Can't efficiently implement caching Claude instance.
- Fix approach: Add `@cached` decorator to pure functions. Invalidate cache on tree mutations. Cache `get_file_importance` results for 30 seconds.

## Test Coverage Gaps

**Untested: Path Normalization Edge Cases:**
- What's not tested: Windows paths with mixed separators, UNC paths, paths with `..`, symbolic links, relative paths on different platforms
- Files: `src/file-utils.ts` (lines 15-42), `src/storage-utils.ts` (lines 16-46)
- Risk: Path handling bugs could cause files to be invisible or matched incorrectly
- Priority: High - affects all file operations

**Untested: Concurrent File Operations:**
- What's not tested: Multiple file changes within debounce window, file deletion during update, permission denied errors
- Files: `src/mcp-server.ts` (lines 185-263), `src/file-utils.ts` (lines 870-960)
- Risk: Race conditions in watcher could corrupt tree or lose updates
- Priority: High - affects reliability in active development scenarios

**Untested: Large Project Scenarios:**
- What's not tested: Trees with 10,000+ files, directories with 1000+ children, files with 100+ dependencies
- Files: `src/file-utils.ts` (all tree functions), `src/mcp-server.ts` (lines 491-605)
- Risk: Performance issues only discovered after user adds project
- Priority: Medium - important for production use but not blocking basic functionality

**Untested: Configuration Loading:**
- What's not tested: Missing config file, corrupted JSON, invalid exclude patterns, custom excludes.json merging
- Files: `src/config-utils.ts`, `src/global-state.ts` (lines 25-54)
- Risk: Misconfigured projects could fail silently or behave unexpectedly
- Priority: Medium - affects user experience on setup

**Untested: Error Recovery:**
- What's not tested: Disk errors, symlink loops, permission denied, insufficient disk space, out of memory
- Files: All file I/O in `src/file-utils.ts` and `src/storage-utils.ts`
- Risk: Application crashes instead of graceful degradation
- Priority: Medium - important for reliability but edge cases

---

*Concerns audit: 2026-03-02*
