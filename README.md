# FileScopeMCP (Model Context Protocol) Server

**Understand your codebase — ranked, related, summarized, and kept up to date automatically.**

<!-- Add Badges Here (e.g., License, Version, Build Status) -->
[![Build Status](https://github.com/admica/FileScopeMCP/actions/workflows/build.yml/badge.svg)](https://github.com/admica/FileScopeMCP/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.x-green)](https://nodejs.org/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/admica/FileScopeMCP)](https://archestra.ai/mcp-catalog/admica__filescopemcp)

A TypeScript-based MCP server that ranks files by importance, tracks bidirectional dependencies, stores AI-generated summaries, and autonomously keeps all of that data fresh in the background as your codebase changes.

## Overview

FileScopeMCP is an **active-listening backend**. Once pointed at a project it:

1. Scans the codebase and builds a dependency graph with 0–10 importance scores for every file.
2. Watches the filesystem with chokidar. When files are added, changed, or deleted it incrementally updates dependency lists, recalculates importance scores, and persists the result — no manual rescan needed.
3. Runs a self-healing integrity sweep every 30 seconds to catch anything the watcher missed (e.g. changes made while the server was offline).

All of this information is exposed to your AI assistant through the Model Context Protocol so it always has accurate, up-to-date context about your codebase structure.

## Features

- **🎯 File Importance Ranking**
  - Rank every file on a 0–10 scale based on its role in the dependency graph.
  - Weighted formula considers incoming dependents, outgoing dependencies, file type, location, and name significance.
  - Instantly surface the most critical files in any project.

- **🔗 Dependency Tracking**
  - Bidirectional dependency relationships: which files import a given file (dependents) and which files it imports (dependencies).
  - Distinguishes local file dependencies from package dependencies.
  - Multi-language support: Python, JavaScript, TypeScript, C/C++, Rust, Lua, Zig, PHP, C#, Java.

- **🔄 Autonomous Background Updates**
  - Filesystem watcher detects `add`, `change`, and `unlink` events in real time.
  - Incremental updates: re-parses only the affected file, diffs old vs. new dependency lists, patches the reverse-dependency map, and recalculates importance — no full rescan.
  - Periodic integrity sweep auto-heals stale, missing, or newly discovered files.
  - All mutations are serialized through an async mutex to prevent concurrent corruption.
  - Per-event-type enable/disable and `autoRebuildTree` master switch.

- **📝 File Summaries**
  - Store human- or AI-generated summaries on any file.
  - Summaries persist across server restarts and are returned alongside importance data.

- **📚 Multiple Project Support**
  - Create and manage separate file trees for different projects or subdirectories.
  - Switch between trees at any time; each tree has its own JSON file on disk.

- **💾 Persistent Storage**
  - All data saved to JSON files automatically after every mutation.
  - Load existing trees without rescanning.

## Installation

1. Clone this repository
2. Build and register:

   **Linux / macOS / WSL:**
   ```bash
   ./build.sh
   ```

   **Windows:**
   ```bat
   build.bat
   ```

   Both scripts will:
   - Install npm dependencies
   - Compile TypeScript to `dist/`
   - Generate `mcp.json` for Cursor AI
   - Register the server with Claude Code (`~/.claude.json`)

### Claude Code

The build script registers FileScopeMCP automatically. To register (or re-register) without rebuilding:

```bash
./install-mcp-claude.sh
```

The server is registered globally — no `--base-dir` is needed. When you start a session, tell Claude to run `set_project_path` pointing at your project. This builds the initial file tree, starts the file watcher, and starts the integrity sweep:

```
set_project_path(path: "/path/to/your/project")
```

After that you can optionally call `create_file_tree` to create additional named trees for sub-directories.

### Cursor AI (Linux/WSL — Cursor running on Windows)

Build inside WSL, then copy `mcp.json` to your project's `.cursor/` directory:

```json
{
  "mcpServers": {
    "FileScopeMCP": {
      "command": "wsl",
      "args": ["-d", "Ubuntu-24.04", "/home/yourname/FileScopeMCP/run.sh", "--base-dir=${projectRoot}"],
      "transport": "stdio",
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

### Cursor AI (Windows native)

```json
{
  "mcpServers": {
    "FileScopeMCP": {
      "command": "node",
      "args": ["C:\\FileScopeMCP\\dist\\mcp-server.js", "--base-dir=${projectRoot}"],
      "transport": "stdio",
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

### Cursor AI (macOS / Linux native)

```json
{
  "mcpServers": {
    "FileScopeMCP": {
      "command": "node",
      "args": ["/path/to/FileScopeMCP/dist/mcp-server.js", "--base-dir=${projectRoot}"],
      "transport": "stdio"
    }
  }
}
```

## How It Works

### Dependency Detection

The tool scans source code for import statements and other language-specific patterns:
- Python: `import` and `from ... import` statements
- JavaScript/TypeScript: `import` statements, `require()` calls, and dynamic `import()` expressions
- C/C++/Header: `#include` directives
- Rust: `use` and `mod` statements
- Lua: `require` statements
- Zig: `@import` directives
- PHP: `require`, `require_once`, `include`, `include_once`, and `use` statements
- C#: `using` directives
- Java: `import` statements

### Importance Calculation

Files are assigned importance scores (0–10) based on a weighted formula that considers:
- Number of files that import this file (dependents) — up to +3
- Number of files this file imports (dependencies) — up to +2
- Number of package dependencies imported — up to +1
- File type and extension — TypeScript/JavaScript get higher base scores; PHP +2; JSON config files (package.json, tsconfig.json) +3
- Location in the project structure — files in `src/` or `app/` are weighted higher
- File naming — `index`, `main`, `server`, `app`, `config`, `types`, etc. receive additional points

The formula is evaluated from scratch on every calculation, so calling `recalculate_importance` is always idempotent. Manual overrides set via `set_file_importance` will be overwritten when importance is recalculated.

### Autonomous Updates

When a file event fires, the update pipeline is:

1. **Debounce** — events are coalesced per `filePath:eventType` key (default 2 s) to avoid thrashing on rapid saves.
2. **Acquire mutex** — all tree mutations are serialized through `AsyncMutex` so the watcher and the integrity sweep can never corrupt the tree simultaneously.
3. **Incremental update** — `updateFileNodeOnChange` re-parses the file, diffs old vs. new dependency lists, patches `dependents[]` on affected nodes, and calls `recalculateImportanceForAffected`.
4. **Persist** — `saveFileTree` writes the updated JSON to disk.

The integrity sweep runs every 30 seconds inside the same mutex and respects the `autoRebuildTree` flag, so users who disable auto-rebuild are fully opted out of both paths.

### Path Normalization

The system handles various path formats to ensure consistent file identification:
- Windows and Unix path formats
- Absolute and relative paths
- URL-encoded paths
- Cross-platform compatibility

### File Storage

All file tree data is stored in JSON files with the following structure:
- Configuration metadata (filename, base directory, last updated timestamp)
- Complete file tree with dependencies, dependents, importance scores, and summaries

**Persistent exclusions:** When you call `exclude_and_remove`, the pattern is written to `FileScopeMCP-excludes.json` in the project root. This file is loaded automatically on every server start, so exclusions survive restarts without needing to be re-applied.

## Technical Details

- **TypeScript/Node.js** — built with TypeScript for type safety and modern JavaScript features
- **Model Context Protocol** — implements the MCP specification for integration with Claude Code, Cursor, and other MCP clients
- **chokidar** — cross-platform filesystem watcher for real-time change detection
- **esbuild** — fast TypeScript compilation to ESM
- **JSON Storage** — simple JSON files for persistence; all writes happen after mutations complete
- **AsyncMutex** — serializes concurrent tree mutations from the watcher and integrity sweep
- **Path Normalization** — cross-platform path handling to support Windows and Unix

## Available Tools

The MCP server exposes the following tools:

### Project Setup

- **set_project_path**: Point the server at a project directory and initialize or reload its file tree
- **create_file_tree**: Create a new file tree configuration for a specific directory
- **select_file_tree**: Select an existing file tree to work with
- **list_saved_trees**: List all saved file trees
- **delete_file_tree**: Delete a file tree configuration

### File Analysis

- **list_files**: List all files in the project with their importance rankings
- **get_file_importance**: Get detailed information about a specific file, including dependencies and dependents
- **find_important_files**: Find the most important files in the project based on configurable criteria
- **set_file_importance**: Manually override the importance score for a specific file
- **recalculate_importance**: Recalculate importance values for all files based on dependencies
- **read_file_content**: Read the content of a specific file

### File Summaries

- **get_file_summary**: Get the stored summary of a specific file
- **set_file_summary**: Set or update the summary of a specific file

### File Watching

- **toggle_file_watching**: Toggle file watching on/off
- **get_file_watching_status**: Get the current status of file watching
- **update_file_watching_config**: Update file watching configuration (per-event-type toggles, `autoRebuildTree`, `ignoreDotFiles`, etc.)

### Utilities

- **exclude_and_remove**: Exclude a file or glob pattern from the tree and remove matching nodes
- **debug_list_all_files**: List every file path currently tracked in the active tree (useful for debugging)

## Usage Examples

The easiest way to get started is to enable this MCP in your AI client and let the AI figure it out. As soon as the MCP starts, it builds an initial JSON tree. Ask your AI to read important files and use `set_file_summary` to store summaries on them.

### Analyzing a Project

1. Point the server at your project (builds the tree, starts file watching and the integrity sweep):
   ```
   set_project_path(path: "/path/to/project")
   ```

2. Find the most important files:
   ```
   find_important_files(limit: 5, minImportance: 5)
   ```

3. Get detailed information about a specific file:
   ```
   get_file_importance(filepath: "/path/to/project/src/main.ts")
   ```

### Working with Summaries

1. Read a file's content to understand it:
   ```
   read_file_content(filepath: "/path/to/project/src/main.ts")
   ```

2. Add a summary to the file:
   ```
   set_file_summary(filepath: "/path/to/project/src/main.ts", summary: "Main entry point that initializes the application, sets up routing, and starts the server.")
   ```

3. Retrieve the summary later:
   ```
   get_file_summary(filepath: "/path/to/project/src/main.ts")
   ```

### Configuring File Watching

1. Check the current file watching status:
   ```
   get_file_watching_status()
   ```

2. Update file watching configuration:
   ```
   update_file_watching_config(config: {
     autoRebuildTree: true,
     watchForNewFiles: true,
     watchForDeleted: true,
     watchForChanged: true
   })
   ```

3. Disable watching entirely:
   ```
   toggle_file_watching()
   ```

### Testing

```bash
npm test
npm run coverage
```

## License

This project is licensed under the GNU General Public License v3 (GPL-3.0). See the [LICENSE](LICENSE) file for the full license text.
