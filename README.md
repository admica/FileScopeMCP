# FileScopeMCP (Model Context Protocol) Server

**Understand your codebase — ranked, related, summarized, and kept up to date automatically.**

<!-- Add Badges Here (e.g., License, Version, Build Status) -->
[![Build Status](https://github.com/admica/FileScopeMCP/actions/workflows/build.yml/badge.svg)](https://github.com/admica/FileScopeMCP/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.x-green)](https://nodejs.org/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/admica/FileScopeMCP)](https://archestra.ai/mcp-catalog/admica__filescopemcp)

A TypeScript-based MCP server and standalone daemon that ranks files by importance, tracks bidirectional dependencies, autonomously maintains AI-generated summaries, concepts, and change impact assessments — and keeps all of that metadata fresh in the background as your codebase changes.

## Overview

FileScopeMCP is a fully autonomous file intelligence platform. Once pointed at a project it:

1. Scans the codebase and builds a dependency graph with 0–10 importance scores for every file.
2. Watches the filesystem. When files change, it incrementally updates dependency lists and importance scores, then detects semantic changes via tree-sitter AST diffing (TS/JS) or LLM-powered diff analysis (all other languages), and propagates staleness through the dependency graph via the cascade engine.
3. A background LLM pipeline auto-generates summaries, key concepts, and change impact assessments for stale files — keeping structured metadata current without any manual work.

All of this information is exposed to your AI assistant through the Model Context Protocol so it always has accurate, up-to-date context about your codebase structure.

## Features

- **File Importance Ranking**
  - Rank every file on a 0–10 scale based on its role in the dependency graph.
  - Weighted formula considers incoming dependents, outgoing dependencies, file type, location, and name significance.
  - Instantly surface the most critical files in any project.

- **Dependency Tracking**
  - Bidirectional dependency relationships: which files import a given file (dependents) and which files it imports (dependencies).
  - Distinguishes local file dependencies from package dependencies.
  - Multi-language support: Python, JavaScript, TypeScript, C/C++, Rust, Lua, Zig, PHP, C#, Java.

- **Autonomous Background Updates**
  - Filesystem watcher detects `add`, `change`, and `unlink` events in real time.
  - Incremental updates: re-parses only the affected file, diffs old vs. new dependency lists, patches the reverse-dependency map, and recalculates importance — no full rescan.
  - Periodic integrity sweep auto-heals stale, missing, or newly discovered files.
  - All mutations are serialized through an async mutex to prevent concurrent corruption.
  - Per-event-type enable/disable and `autoRebuildTree` master switch.
  - Semantic change detection classifies what changed before triggering cascade — avoids unnecessary LLM calls.

- **File Summaries**
  - Background LLM auto-generates summaries for files after they change.
  - Manual override via `set_file_summary` — your summary is preserved until the file changes again.
  - Summaries persist across server restarts in SQLite.

- **SQLite Storage**
  - All data stored in `.filescope.db` in the project root using SQLite with WAL mode.
  - Type-safe schema via drizzle-orm: `files`, `file_dependencies`, `llm_jobs`, `schema_version`, `llm_runtime_state` tables.
  - Transparent auto-migration: existing JSON tree files are automatically imported on first run — no manual migration step.

- **Semantic Change Detection**
  - tree-sitter AST diffing for TypeScript and JavaScript files — fast, accurate, and token-free.
  - Classifies changes as: `body-only` (function internals only), `exports-changed` (public API changed), `types-changed` (type signatures changed), or `unknown`.
  - LLM-powered diff fallback for all other languages (Python, Rust, C/C++, etc.).
  - Change classification drives the cascade engine — body-only changes skip dependent propagation entirely.

- **Cascade Engine**
  - BFS staleness propagation through the dependency graph when exports or types change.
  - Per-field granularity: marks `summary`, `concepts`, and `change_impact` fields stale independently.
  - Circular dependency protection via visited set — no infinite loops.
  - Depth cap of 10 levels prevents runaway propagation on deeply nested graphs.

- **Background LLM Pipeline**
  - Auto-generates summaries, concepts (functions, classes, interfaces, exports, purpose), and change impact (risk level, affected areas, breaking changes) for stale files.
  - Priority-ordered job queue: interactive (tier 1) > cascade (tier 2) > background (tier 3).
  - Token budget limits and per-minute rate limiting prevent runaway API costs.
  - Recovers orphaned `in_progress` jobs on restart — no stuck jobs after crashes.
  - Toggle on/off at runtime via `toggle_llm` MCP tool or config file.

- **Multi-Provider LLM Support**
  - Anthropic (Claude) via `@ai-sdk/anthropic` — uses `ANTHROPIC_API_KEY` environment variable.
  - OpenAI-compatible via `@ai-sdk/openai-compatible` — works with Ollama, vLLM, and any OpenAI-compatible API.
  - Configurable model, baseURL, and apiKey per-project in `FileScopeMCP-config.json`.
  - Local-first default: Ollama on `localhost:11434` with `qwen3-coder:14b-instruct`.
  - Structured output with JSON repair fallback for local models that don't follow schemas perfectly.

- **Daemon Mode**
  - Runs as a standalone daemon (`--daemon --base-dir=<path>`) for 24/7 operation without an MCP client connected.
  - PID file guard (`/tmp/filescope-<hash>.pid`) prevents concurrent daemons on the same project.
  - Graceful shutdown on SIGTERM/SIGINT — flushes pending jobs before exit.
  - File-only logging to `.filescope-daemon.log` in the project root — no stdout pollution.

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

After that you can optionally enable the background LLM pipeline:

```
toggle_llm(enabled: true)
```

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

### Daemon Mode

To run FileScopeMCP as a standalone background process (no MCP client required):

```bash
node dist/mcp-server.js --daemon --base-dir=/path/to/project
```

The daemon watches the project, runs the integrity sweep, and keeps the LLM pipeline active 24/7. Logs are written to `.filescope-daemon.log` in the project root.

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
2. **Acquire mutex** — all tree mutations are serialized through `AsyncMutex` so the watcher and the integrity sweep can never corrupt the database simultaneously.
3. **Semantic change detection** — tree-sitter AST diffing for TS/JS files classifies the change (body-only, exports-changed, types-changed, unknown). LLM-powered diff analysis handles all other languages.
4. **Incremental update** — re-parses the file, diffs old vs. new dependency lists, patches `dependents[]` on affected nodes, and recalculates importance.
5. **Cascade engine** — if exports or types changed, BFS propagates staleness to all transitive dependents; if body-only, only the changed file is marked stale.
6. **LLM pipeline** — picks up stale files and regenerates summaries, concepts, and change impact assessments in priority order.

The integrity sweep runs every 30 seconds inside the same mutex and respects the `autoRebuildTree` flag.

### Path Normalization

The system handles various path formats to ensure consistent file identification:
- Windows and Unix path formats
- Absolute and relative paths
- URL-encoded paths
- Cross-platform compatibility

### Storage

All file tree data is stored in `.filescope.db` (SQLite, WAL mode) in the project root.

- **Schema** — drizzle-orm manages: `files` (metadata, staleness, concepts, change_impact), `file_dependencies` (bidirectional relationships), `llm_jobs` (background job queue), `schema_version` (migration versioning), `llm_runtime_state` (token budget persistence).
- **Auto-migration** — on first run, any legacy JSON tree files are automatically detected and imported into SQLite. The original JSON files are left in place but are no longer used.

**Persistent exclusions:** When you call `exclude_and_remove`, the pattern is written to `FileScopeMCP-excludes.json` in the project root. This file is loaded automatically on every server start, so exclusions survive restarts without needing to be re-applied.

## LLM Configuration

Configure the LLM pipeline in `FileScopeMCP-config.json` in the project root:

```json
{
  "llm": {
    "enabled": true,
    "provider": "openai-compatible",
    "model": "qwen3-coder:14b-instruct",
    "baseURL": "http://localhost:11434/v1",
    "maxTokensPerMinute": 40000,
    "tokenBudget": 1000000
  }
}
```

**Provider options:**
- `"openai-compatible"` — Ollama, vLLM, or any OpenAI-compatible API. Set `baseURL` to the API endpoint and optionally `apiKey`.
- `"anthropic"` — Claude models via Anthropic API. Uses `ANTHROPIC_API_KEY` environment variable (or override with `apiKey` field).

When `toggle_llm` is called with `enabled: true` and no existing config, defaults to Ollama with `qwen3-coder:14b-instruct` on `localhost:11434`.

## Technical Details

- **TypeScript 5.8 / Node.js 22** — ESM modules throughout
- **Model Context Protocol** — `@modelcontextprotocol/sdk` for MCP server interface
- **chokidar** — cross-platform filesystem watcher for real-time change detection
- **esbuild** — fast TypeScript compilation to ESM
- **better-sqlite3** — SQLite storage with WAL mode (loaded via `createRequire` for ESM compatibility)
- **drizzle-orm** — type-safe SQL schema and queries
- **tree-sitter** — AST parsing for semantic change detection (loaded via `createRequire`)
- **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`) — multi-provider LLM abstraction
- **zod** — runtime validation and structured output schemas
- **AsyncMutex** — serializes concurrent tree mutations from the watcher and integrity sweep

## Available Tools

The MCP server exposes 22 tools organized by category:

### Project Setup

- **set_project_path**: Point the server at a project directory and initialize or reload its file tree
- **create_file_tree**: Create a new file tree configuration for a specific directory
- **select_file_tree**: Select an existing file tree to work with
- **list_saved_trees**: List all saved file trees
- **delete_file_tree**: Delete a file tree configuration

### File Analysis

- **list_files**: List all files in the project with their importance rankings
- **get_file_importance**: Get detailed information about a specific file — includes importance, dependencies, dependents, summary, concepts, changeImpact, and staleness fields
- **find_important_files**: Find the most important files in the project — includes staleness fields
- **set_file_importance**: Manually override the importance score for a specific file
- **recalculate_importance**: Recalculate importance values for all files based on dependencies
- **read_file_content**: Read the content of a specific file

### File Summaries

- **get_file_summary**: Get the stored summary of a specific file — includes concepts, changeImpact, and staleness fields
- **set_file_summary**: Set or update the summary of a specific file

### LLM Pipeline

- **toggle_llm**: Enable or disable background LLM processing. When enabled with no prior config, defaults to Ollama (`openai-compatible`, `qwen3-coder:14b-instruct`, `localhost:11434`)
- **get_llm_status**: Get pipeline status — running state, budget exhaustion flag, lifetime tokens used, token budget, and max tokens per minute

### File Watching

- **toggle_file_watching**: Toggle file watching on/off
- **get_file_watching_status**: Get the current status of file watching
- **update_file_watching_config**: Update file watching configuration (per-event-type toggles, `autoRebuildTree`, `ignoreDotFiles`, etc.)

### Utilities

- **exclude_and_remove**: Exclude a file or glob pattern from the tree and remove matching nodes
- **debug_list_all_files**: List every file path currently tracked in the active tree (useful for debugging)

## Usage Examples

The easiest way to get started is to enable this MCP in your AI client and let the AI figure it out. As soon as the MCP starts, it builds an initial file tree. Ask your AI to read important files and use `set_file_summary` to store summaries on them.

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

### Using the LLM Pipeline

1. Enable background LLM processing (uses Ollama by default):
   ```
   toggle_llm(enabled: true)
   ```

2. Check LLM pipeline status:
   ```
   get_llm_status()
   ```

3. View auto-generated metadata for a file:
   ```
   get_file_importance(filepath: "/path/to/project/src/main.ts")
   # Returns: importance, dependencies, dependents, summary, concepts, changeImpact, staleness fields
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
