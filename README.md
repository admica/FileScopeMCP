# FileScopeMCP (Model Context Protocol) Server

**Understand your codebase — ranked, related, summarized, and kept up to date automatically.**

<!-- Add Badges Here (e.g., License, Version, Build Status) -->
[![Build Status](https://github.com/admica/FileScopeMCP/actions/workflows/build.yml/badge.svg)](https://github.com/admica/FileScopeMCP/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.x-green)](https://nodejs.org/)
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
  - Configurable model, baseURL, and apiKey per-project in `config.json`.
  - Local-first default: Ollama on `localhost:11434` with `qwen2.5-coder:14b`.
  - Structured output with JSON repair fallback for local models that don't follow schemas perfectly.

- **Daemon Mode**
  - Runs as a standalone daemon (`--daemon --base-dir=<path>`) for 24/7 operation without an MCP client connected.
  - PID file guard (`.filescope.pid` in the project root) prevents concurrent daemons on the same project.
  - Graceful shutdown on SIGTERM/SIGINT — flushes pending jobs before exit.
  - File-only logging to `.filescope-daemon.log` in the project root — no stdout pollution.

## Prerequisites

- **Node.js 22+** — required. Earlier versions may work but are untested. Download from [nodejs.org](https://nodejs.org/).
- **npm** — comes with Node.js.
- **Native build tools** (usually optional) — `better-sqlite3` and `tree-sitter` ship prebuilt binaries for most platforms. If prebuilds aren't available for your OS/arch, `npm install` will fall back to compiling from source, which requires:
  - **Linux:** `python3`, `make`, `gcc` (e.g., `sudo apt install build-essential python3`)
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Windows:** Visual Studio Build Tools with C++ workload

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

## Quick Start Checklist

After installation, walk through these steps to verify everything is working:

**1. Verify the build succeeded:**
```bash
ls dist/mcp-server.js   # Should exist after build
```

**2. Verify Claude Code registration:**
```bash
claude mcp list          # Should show FileScopeMCP in the list
```

**3. Start a Claude Code session and initialize:**
```
set_project_path(path: "/path/to/your/project")
```
You should see: `Project path set to /path/to/your/project. File tree built and saved to SQLite.`

**4. Confirm files are tracked:**
```
find_important_files(limit: 5)
```
You should see a list of your most important files with importance scores.

**5. (Optional) Enable the LLM pipeline:**
```
toggle_llm(enabled: true)
```
Requires Ollama running locally (default) or a configured LLM provider — see [Configuration](#configuration).

**6. (Optional) Check LLM status:**
```
get_llm_status()
```
Should show `running: true` and token counters.

**7. Add generated files to your `.gitignore`:**
```gitignore
# FileScopeMCP
.filescope.db
.filescope.db-wal
.filescope.db-shm
.filescope.pid
.filescope-daemon.log
mcp-debug.log
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

## Configuration

FileScopeMCP uses `config.json` in the project root for all settings. This file is **optional** — sensible defaults are used when it doesn't exist, and it's created automatically when you change settings via MCP tools.

### Full config.json example

```json
{
  "baseDirectory": "/path/to/your/project",
  "excludePatterns": [
    "**/node_modules",
    "**/.git",
    "**/dist",
    "**/build",
    "**/coverage"
  ],
  "fileWatching": {
    "enabled": true,
    "ignoreDotFiles": true,
    "autoRebuildTree": true,
    "maxWatchedDirectories": 1000,
    "watchForNewFiles": true,
    "watchForDeleted": true,
    "watchForChanged": true
  },
  "llm": {
    "enabled": true,
    "provider": "openai-compatible",
    "model": "qwen2.5-coder:14b",
    "baseURL": "http://localhost:11434/v1",
    "maxTokensPerMinute": 40000,
    "tokenBudget": 1000000
  },
  "version": "1.0.0"
}
```

### LLM provider options

| Provider | `provider` value | Auth | Use case |
|----------|-----------------|------|----------|
| Ollama | `"openai-compatible"` | None needed | Local inference, free |
| vLLM | `"openai-compatible"` | Optional `apiKey` | Self-hosted GPU server |
| OpenAI-compatible API | `"openai-compatible"` | `apiKey` or env var | Any compatible endpoint |
| Anthropic (Claude) | `"anthropic"` | `ANTHROPIC_API_KEY` env var or `apiKey` field | Cloud API |

**Default behavior:** When `toggle_llm(enabled: true)` is called with no existing LLM config, the system auto-creates a config targeting Ollama at `localhost:11434` with `qwen2.5-coder:14b`.

### LLM config fields

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Whether the LLM pipeline runs |
| `provider` | `"anthropic"` | Provider adapter to use |
| `model` | `"claude-3-haiku-20240307"` | Model identifier |
| `baseURL` | — | API endpoint (required for `openai-compatible`) |
| `apiKey` | — | API key override (otherwise uses env vars) |
| `maxTokensPerCall` | `1024` | Maximum tokens per LLM call |
| `maxTokensPerMinute` | `40000` | Sliding-window rate limit |
| `tokenBudget` | unlimited | Lifetime token cap; pipeline stops when reached |

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

The MCP server exposes 20 tools organized by category:

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

- **toggle_llm**: Enable or disable background LLM processing. When enabled with no prior config, defaults to Ollama (`openai-compatible`, `qwen2.5-coder:14b`, `localhost:11434`)
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
   Returns:
   ```json
   {
     "enabled": true,
     "running": true,
     "budgetExhausted": false,
     "lifetimeTokensUsed": 42350,
     "tokenBudget": 1000000,
     "maxTokensPerMinute": 40000
   }
   ```

3. View auto-generated metadata for a file:
   ```
   get_file_importance(filepath: "/path/to/project/src/main.ts")
   ```

**Sample response** (after LLM pipeline has processed the file):
```json
{
  "path": "/path/to/project/src/main.ts",
  "importance": 8,
  "dependencies": ["./config.ts", "./router.ts", "./db.ts"],
  "dependents": ["./test/main.test.ts"],
  "packageDependencies": ["express", "dotenv"],
  "summary": "Main entry point that initializes Express server, loads configuration, sets up routes, and starts listening on the configured port.",
  "concepts": {
    "functions": ["startServer", "gracefulShutdown"],
    "classes": [],
    "interfaces": ["ServerOptions"],
    "exports": ["startServer", "app"],
    "purpose": "Application entry point that wires together configuration, routing, and server lifecycle"
  },
  "changeImpact": {
    "riskLevel": "high",
    "affectedAreas": ["server startup", "route registration", "error handling"],
    "breakingChanges": [],
    "summary": "Central orchestration file — changes here affect all downstream request handling"
  },
  "summaryStale": null,
  "conceptsStale": null,
  "changeImpactStale": null
}
```

When staleness fields are `null`, the metadata is current. A non-null value (epoch timestamp) means the file or a dependency changed and the LLM pipeline will regenerate that field.

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

## Monitoring & Debugging

### Log Files

| File | When | Location |
|------|------|----------|
| `mcp-debug.log` | MCP server mode (disabled by default) | Working directory |
| `.filescope-daemon.log` | Daemon mode (always on) | Project root |

**MCP mode:** File logging is disabled by default. To enable it, edit `src/mcp-server.ts` line 43 and change `enableFileLogging(false, ...)` to `true`, then rebuild. MCP log messages also go to stderr, which Claude Code captures in its own logs.

**Daemon mode:** File logging is always on. Logs auto-rotate at 10 MB (file is truncated and restarted). View logs in real time:
```bash
tail -f /path/to/project/.filescope-daemon.log
```

### Checking Status via MCP Tools

From your AI assistant, you can query the system state at any time:

```
# Is the file watcher running? What events is it tracking?
get_file_watching_status()

# Is the LLM pipeline running? How many tokens have been used?
get_llm_status()
# Returns: { running, budgetExhausted, lifetimeTokensUsed, tokenBudget, maxTokensPerMinute }

# How many files are tracked?
debug_list_all_files()

# Check if a specific file has stale metadata
get_file_importance(filepath: "/path/to/file.ts")
# Staleness fields: summaryStale, conceptsStale, changeImpactStale (epoch timestamps, null = not stale)
```

### Inspecting the Database Directly

The SQLite database is a standard file you can query with any SQLite client:

```bash
sqlite3 /path/to/project/.filescope.db

# How many files are tracked?
SELECT COUNT(*) FROM files WHERE is_directory = 0;

# Which files have LLM-generated summaries?
SELECT path, LENGTH(summary) as summary_len FROM files WHERE summary IS NOT NULL AND is_directory = 0;

# What LLM jobs are pending?
SELECT * FROM llm_jobs WHERE status = 'pending' ORDER BY priority, created_at;

# Check lifetime token usage
SELECT * FROM llm_runtime_state;

# Which files have stale metadata?
SELECT path, summary_stale, concepts_stale, change_impact_stale FROM files WHERE summary_stale IS NOT NULL OR concepts_stale IS NOT NULL OR change_impact_stale IS NOT NULL;
```

### Daemon Process Management

```bash
# Check if a daemon is running for a project
cat /path/to/project/.filescope.pid

# Check if that PID is alive
kill -0 $(cat /path/to/project/.filescope.pid) 2>/dev/null && echo "Running" || echo "Not running"

# Graceful shutdown
kill $(cat /path/to/project/.filescope.pid)

# Start daemon
node /path/to/FileScopeMCP/dist/mcp-server.js --daemon --base-dir=/path/to/project
```

## Troubleshooting

### "Project path not set" error
Every tool except `set_project_path` requires initialization first. Call `set_project_path(path: "/your/project")` or ensure you're using `--base-dir` when starting the server.

### MCP server not appearing in Claude Code
1. Run `claude mcp list` to check registration.
2. If missing, run `./install-mcp-claude.sh` to register.
3. Check `~/.claude.json` — it should have a `FileScopeMCP` entry under `mcpServers`.
4. Restart Claude Code after registration.

### `npm install` fails on native modules
`better-sqlite3` and `tree-sitter` include native addons. If prebuilt binaries aren't available:
- **Linux:** `sudo apt install build-essential python3`
- **macOS:** `xcode-select --install`
- **Windows:** Install Visual Studio Build Tools with C++ workload

### LLM pipeline not generating metadata
1. Check `get_llm_status()` — is `running` true?
2. If `budgetExhausted` is true, the lifetime token budget has been reached. Increase `tokenBudget` in `config.json` or set to `0` for unlimited.
3. If using Ollama, confirm it's running: `curl http://localhost:11434/v1/models`
4. Check for errors in the log file (daemon mode) or stderr (MCP mode).

### "FileScopeMCP daemon already running" error
A PID file exists for this project. Either another daemon is running, or a previous one crashed without cleanup:
```bash
# Check if the PID is actually alive
cat /path/to/project/.filescope.pid
kill -0 <PID> 2>/dev/null && echo "Still running" || echo "Stale PID file"

# If stale, remove it
rm /path/to/project/.filescope.pid
```

### Database seems corrupted or out of date
The SQLite database uses WAL mode for crash safety, but if something goes wrong:
```bash
# Delete the database — it will be rebuilt on next startup
rm /path/to/project/.filescope.db
rm -f /path/to/project/.filescope.db-wal
rm -f /path/to/project/.filescope.db-shm
```
On the next `set_project_path` call, the system rescans the project and rebuilds the database from scratch. If legacy JSON tree files exist, they'll be auto-imported.

### High token usage / runaway LLM costs
1. Check `get_llm_status()` for `lifetimeTokensUsed`.
2. Set a `tokenBudget` in `config.json` to cap total usage.
3. Reduce `maxTokensPerMinute` to slow the pipeline down.
4. The cascade engine's depth cap (10 levels) and body-only-change optimization already prevent most unnecessary calls.

## Generated Files Reference

Files created by FileScopeMCP in your project directory:

| File | Purpose | Gitignore? |
|------|---------|------------|
| `.filescope.db` | SQLite database (all metadata, jobs, state) | Yes |
| `.filescope.db-wal` | SQLite write-ahead log | Yes |
| `.filescope.db-shm` | SQLite shared memory file | Yes |
| `.filescope.pid` | Daemon PID lock file | Yes |
| `.filescope-daemon.log` | Daemon log output | Yes |
| `mcp-debug.log` | MCP server debug log (when enabled) | Yes |
| `config.json` | Server configuration (exclude patterns, file watching, LLM settings) | Optional |
| `FileScopeMCP-excludes.json` | Persistent exclude patterns (created by `exclude_and_remove`) | Optional |

## License

This project is licensed under the GNU General Public License v3 (GPL-3.0). See the [LICENSE](LICENSE) file for the full license text.
