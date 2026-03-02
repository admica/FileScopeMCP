# Architecture

**Analysis Date:** 2026-03-02

## Pattern Overview

**Overall:** Layered MCP (Model Context Protocol) server with active-listening pattern for autonomous file system monitoring and dependency tracking.

**Key Characteristics:**
- Active background monitoring via file system watcher (chokidar) with debouncing
- Incremental dependency analysis and importance score recalculation
- Atomic mutations through async mutex to prevent concurrent state corruption
- Multi-language import parsing with regex-based extraction
- Periodic self-healing integrity sweep for missed changes
- Persistent storage layer with freshness validation before cache reuse

## Layers

**Transport Layer:**
- Purpose: Bidirectional JSON-RPC communication with Claude via stdio
- Location: `src/mcp-server.ts` (lines 315-387, class `StdioTransport`)
- Contains: Buffer management, message serialization/deserialization
- Depends on: `@modelcontextprotocol/sdk` for message formats
- Used by: MCP server instance for all client communication

**Server/Tools Layer:**
- Purpose: Expose MCP tools as entry points for external operations
- Location: `src/mcp-server.ts` (lines 618-1099, tool registrations)
- Contains: Tool definitions, parameter validation (Zod), request routing
- Depends on: All business logic layers below
- Used by: MCP framework to dispatch client requests
- Key tools: `set_project_path`, `create_file_tree`, `list_files`, `get_file_importance`, `find_important_files`, `get_file_summary`, `set_file_summary`, `read_file_content`, `set_file_importance`, `recalculate_importance`, `toggle_file_watching`, `update_file_watching_config`, `exclude_and_remove`

**Synchronization Layer:**
- Purpose: Serialize all tree mutations to prevent concurrent corruption
- Location: `src/mcp-server.ts` (lines 39-48, class `AsyncMutex`)
- Contains: Promise queue for atomic execution
- Depends on: None (standalone)
- Used by: File watcher event handler and integrity sweep

**Orchestration Layer:**
- Purpose: Coordinate initialization, file monitoring, and periodic maintenance
- Location: `src/mcp-server.ts` (lines 73-320)
- Contains: Server initialization, project setup, file watcher lifecycle, integrity sweep scheduling
- Key functions: `initializeServer()`, `initializeProject()`, `initializeFileWatcher()`, `handleFileEvent()`, `startIntegritySweep()`
- Depends on: All layers below
- Used by: Server startup and event handlers

**File System Watching Layer:**
- Purpose: Monitor file system changes and emit events
- Location: `src/file-watcher.ts` (class `FileWatcher`)
- Contains: Chokidar wrapper with event throttling, pattern-based ignoring
- Depends on: `chokidar` for file system events, `file-utils.ts` for pattern matching
- Used by: Orchestration layer via callback registration

**File Analysis Layer:**
- Purpose: Parse imports, build dependency graphs, calculate importance scores
- Location: `src/file-utils.ts`
- Contains: Functions for directory scanning, import extraction, dependency mapping, importance calculation
- Key functions: `scanDirectory()`, `buildDependentMap()`, `calculateImportance()`, `addFileNode()`, `removeFileNode()`, `updateFileNodeOnChange()`, `integrityCheck()`
- Depends on: File I/O, regex patterns for multiple languages
- Used by: Orchestration layer

**Storage Layer:**
- Purpose: Persist and retrieve file tree data and configuration
- Location: `src/storage-utils.ts`, `src/config-utils.ts`
- Contains: JSON file I/O, tree caching, path normalization
- Key functions: `saveFileTree()`, `loadFileTree()`, `loadConfig()`, `saveConfig()`, `createFileTreeConfig()`
- Depends on: File system (fs/promises)
- Used by: File analysis layer and orchestration

**Global State Layer:**
- Purpose: Manage project root, configuration, and exclude patterns
- Location: `src/global-state.ts`
- Contains: Project root setter/getter, config setter/getter, custom exclude pattern management
- Depends on: File system for reading `FileScopeMCP-excludes.json`
- Used by: All other layers for accessing context

**Type System:**
- Purpose: Define core data structures
- Location: `src/types.ts`
- Contains: `FileNode`, `Config`, `FileTreeConfig`, `FileTreeStorage`, `PackageDependency`, `FileWatchingConfig`
- Depends on: None (definitions only)
- Used by: All layers for type checking

**Logging:**
- Purpose: Debug output with optional file-based persistence
- Location: `src/logger.ts`
- Contains: Timestamp-prefixed logging to stderr and optional file
- Depends on: File system for log file writing
- Used by: All layers

## Data Flow

**Project Initialization Flow:**

1. Server starts → `initializeServer()` loads `config.json`
2. If `--base-dir` argument present → calls `initializeProject(projectPath)`
3. `initializeProject()` → sets global project root → creates `FileTreeConfig`
4. → calls `buildFileTree(config)`
5. `buildFileTree()` → tries to load cached tree from disk → validates freshness via spot-check mtime sampling
6. If fresh → returns cached tree; if stale → full rescan via `scanDirectory()`
7. `scanDirectory()` recursively reads directory → builds tree structure → returns root `FileNode`
8. `buildDependentMap()` parses all files for imports → extracts dependencies → builds reverse dependency lists
9. `calculateImportance()` weights each file based on dependents, dependencies, file type, location, name
10. `saveFileTree()` persists tree+config to JSON
11. `initializeFileWatcher()` starts chokidar watching
12. `startIntegritySweep()` begins 30-second interval for self-healing

**File Change Flow:**

1. Chokidar detects `add`/`change`/`unlink` event
2. `handleFileEvent()` → debounce timer (2 seconds)
3. Timer fires → `treeMutex.run()` acquires lock
4. Switch on event type:
   - **add**: `addFileNode()` → scan new file → add to tree → update dependents for imports
   - **change**: `updateFileNodeOnChange()` → re-parse file → diff old vs new dependencies → patch reverse-dependency map → recalculate affected importance scores
   - **unlink**: `removeFileNode()` → remove from tree → update dependents of former dependents
5. Save updated tree to disk
6. Release lock

**Importance Calculation Flow:**

1. `buildDependentMap()` runs first → traverses tree → extracts imports for each file → resolves relative/package imports → builds `dependents` array for each file
2. `calculateImportance()` → for each file:
   - Start with base weight based on file type and location
   - Add weight for each dependent (files that import this file)
   - Add weight for each dependency (files this imports)
   - Apply damping factor to prevent extreme scores
   - Clamp to 0-10 scale
3. Result: each file has `importance` property

**Integrity Sweep Flow (runs every 30 seconds):**

1. `integrityCheck()` → for each cached node:
   - Check if file still exists on disk
   - If exists: compare mtime, mark as stale if different
   - If missing: mark for removal
2. Scan actual file system → identify files not in tree
3. Return lists: staleFiles, missingFiles, newFiles
4. Auto-heal:
   - For stale: `updateFileNodeOnChange()`
   - For missing: `removeFileNode()`
   - For new: `addFileNode()`
5. Save updated tree

**State Management:**

- **In-Memory**: Module-level `fileTree` and `currentConfig` variables in `mcp-server.ts`
- **Global Context**: Project root and base config in `global-state.ts` (lazily loads custom excludes from `FileScopeMCP-excludes.json`)
- **Persistent Storage**: Full tree+config serialized to `FileScopeMCP-tree-*.json` files
- **Freshness Tracking**: Each `FileNode` stores `mtime` (modification time in ms). Before using cached tree, sample up to 10 files and verify mtimes match disk.

## Key Abstractions

**FileNode:**
- Purpose: Represents a file or directory in the codebase
- Examples: `src/types.ts`, `src/mcp-server.ts`, etc.
- Pattern: Tree structure with `children`, `dependencies` (outgoing), `dependents` (incoming), `importance` (0-10), `summary` (optional)
- Multi-language support: Parsers for JS/TS, Python, C/C++, Rust, Lua, Zig, PHP, C#, Java

**FileTreeStorage:**
- Purpose: Package tree+config for persistence
- Pattern: Wrapper around `FileNode` tree with associated `FileTreeConfig`

**FileWatchingConfig:**
- Purpose: Control which events to track and auto-rebuild behavior
- Pattern: Bitmask-like properties for granular control (watchForNewFiles, watchForChanged, watchForDeleted, autoRebuildTree)

**AsyncMutex:**
- Purpose: Serialize tree mutations
- Pattern: Promise chain that ensures only one operation mutates `fileTree` at a time

**FileWatcher (chokidar wrapper):**
- Purpose: Abstract file system events
- Pattern: Abstraction over chokidar with custom event callbacks and throttling

## Entry Points

**Server Entry Point:**
- Location: `src/mcp-server.ts` (lines 1102-1114)
- Triggers: `node dist/mcp-server.js` (built from esbuild)
- Responsibilities: Initialize server, connect to transport, register all tools, start event loop

**Tool Entry Points:**
- Location: `src/mcp-server.ts` (tool registrations)
- Triggers: Client calls via MCP protocol
- Key entry points:
  - `set_project_path`: Initialize project analysis
  - `create_file_tree`: Scan subdirectory
  - `list_files`: Get full tree
  - `get_file_importance`: Lookup single file
  - `find_important_files`: Top-N ranking
  - `toggle_file_watching`: Enable/disable auto-updates

**CLI Arguments:**
- `--base-dir=<path>`: Auto-initialize project on startup

## Error Handling

**Strategy:** Defensive with fallbacks

**Patterns:**
- Path normalization: Try to clean; fall back to input as-is
- Config loading: Missing/invalid config → use defaults
- Tree loading: Corrupted/stale tree → full rescan
- File operations: Errors logged but don't crash server (tools return error messages to client)
- Buffer overflow: Request too large → reset buffer and emit error
- File watching: Errors caught per event; watcher continues operating

## Cross-Cutting Concerns

**Logging:** All major operations log to stderr via `log()` function. Optional file logging to `mcp-debug.log` if enabled.

**Path Normalization:** All paths converted to forward slashes, deduplicated, URL-decoded. Handles Windows drive letters. Functions: `normalizePath()` in `file-utils.ts`, `normalizeAndResolvePath()` in `storage-utils.ts`

**Validation:** Zod schemas for config and tool parameters. Tool parameter types enforced at registration.

**Concurrency:** Async/await throughout. Tree mutations locked via `AsyncMutex`. File I/O is async (fs/promises).

**Platform Compatibility:** Regex-based import parsing works across all supported languages. Path handling works on Windows (backslashes) and Unix (forward slashes).

---

*Architecture analysis: 2026-03-02*
