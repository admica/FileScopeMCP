# FileScopeMCP (Model Context Protocol) Server

**Understand your codebase — ranked, related, summarized, and kept up to date automatically.**

<!-- Add Badges Here (e.g., License, Version, Build Status) -->
[![Build Status](https://github.com/admica/FileScopeMCP/actions/workflows/build.yml/badge.svg)](https://github.com/admica/FileScopeMCP/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.x-green)](https://nodejs.org/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/admica/FileScopeMCP)](https://archestra.ai/mcp-catalog/admica__filescopemcp)

A TypeScript-based MCP server and standalone daemon that ranks files by importance, tracks bidirectional dependencies, detects circular dependency chains, autonomously maintains AI-generated summaries, concepts, and change impact assessments — and keeps all of that metadata fresh in the background as your codebase changes.

## Overview

FileScopeMCP is a fully autonomous file intelligence platform. Once pointed at a project it:

1. Scans the codebase via a streaming async directory walker and builds a dependency graph with 0–10 importance scores for every file.
2. Watches the filesystem. When files change, it incrementally updates dependency lists and importance scores, then detects semantic changes via tree-sitter AST diffing (TS/JS) or LLM-powered diff analysis (all other languages), and propagates staleness through the dependency graph via the cascade engine.
3. A standalone LLM broker process communicates with Ollama (or any OpenAI-compatible endpoint) over a Unix domain socket, auto-generating summaries, key concepts, and change impact assessments for stale files — keeping structured metadata current without any manual work.
4. On-demand mtime-based freshness checks detect files that changed while the server was down, so metadata is never silently stale.

All of this information is exposed to your AI assistant through the Model Context Protocol so it always has accurate, up-to-date context about your codebase structure.

## Features

- **File Importance Ranking**
  - Rank every file on a 0–10 scale based on its role in the dependency graph.
  - Weighted formula considers incoming dependents, outgoing dependencies, file type, location, and name significance.
  - Instantly surface the most critical files in any project.

- **Dependency Tracking**
  - Bidirectional dependency relationships: which files import a given file (dependents) and which files it imports (dependencies).
  - Distinguishes local file dependencies from package dependencies.
  - Multi-language support: Python, JavaScript, TypeScript, C/C++, Rust, Lua, Zig, PHP, C#, Java, Go, Ruby.

- **Circular Dependency Detection**
  - Detects all strongly connected components (circular dependency groups) using iterative Tarjan's SCC algorithm.
  - Project-wide scan via `detect_cycles` or per-file query via `get_cycles_for_file`.
  - Identifies exactly which files participate in each cycle, helping untangle tight coupling.

- **Autonomous Background Updates**
  - Filesystem watcher detects `add`, `change`, and `unlink` events in real time.
  - Incremental updates: re-parses only the affected file, diffs old vs. new dependency lists, patches the reverse-dependency map, and recalculates importance — no full rescan.
  - Startup integrity sweep detects files added, deleted, or modified while the server was offline and heals the database before accepting requests.
  - Per-file mtime-based lazy validation on read — see [Freshness Validation](#freshness-validation).
  - All mutations are serialized through an async mutex to prevent concurrent corruption.
  - Semantic change detection classifies what changed before triggering cascade — avoids unnecessary LLM calls.

- **File Summaries**
  - Background LLM broker auto-generates summaries for files after they change.
  - Manual override via `set_file_summary` — your summary is preserved until the file changes again.
  - Summaries persist across server restarts in SQLite.

- **SQLite Storage**
  - All data stored in `.filescope/data.db` (SQLite, WAL mode) inside the per-repo directory.
  - Type-safe schema via drizzle-orm: `files`, `file_dependencies`, `schema_version` tables.
  - Transparent auto-migration: existing JSON tree files are automatically imported on first run — no manual migration step.

- **Semantic Change Detection**
  - tree-sitter AST diffing for TypeScript and JavaScript files — fast, accurate, and token-free.
  - Classifies changes as: `body-only` (function internals only), `exports-changed` (public API changed), `types-changed` (type signatures changed), or `unknown`.
  - LLM-powered diff fallback for all other languages (Python, Rust, C/C++, Go, Ruby, etc.).
  - Change classification drives the cascade engine — body-only changes skip dependent propagation entirely.

- **Cascade Engine**
  - BFS staleness propagation through the dependency graph when exports or types change.
  - Per-field granularity: marks `summary`, `concepts`, and `change_impact` fields stale independently.
  - Circular dependency protection via visited set — no infinite loops.
  - Depth cap of 10 levels prevents runaway propagation on deeply nested graphs.

- **LLM Broker**
  - Standalone broker process owns all Ollama (or OpenAI-compatible) communication — auto-spawned when the first MCP instance connects.
  - Communicates over a Unix domain socket at `~/.filescope/broker.sock` using NDJSON protocol.
  - In-memory priority queue: interactive (tier 1) > cascade (tier 2) > background (tier 3).
  - Per-repo token usage stats persisted to `~/.filescope/stats.json`.
  - LLM enabled by default (`llm.enabled: true`) — broker is auto-spawned on first connect.

- **Custom Exclusion Patterns**
  - `.filescopeignore` file in the project root — uses gitignore syntax (via the `ignore` package) to exclude files from scanning and watching.
  - `exclude_and_remove` MCP tool — adds glob patterns at runtime; patterns are persisted to `.filescope/config.json` so they survive restarts.
  - ~90 built-in default exclusion patterns covering all major languages and toolchains (version control, Node/JS/TS, Python, Rust, Go, C/C++, Java/Kotlin/Gradle, C#/.NET, Zig, build outputs, logs/temp, OS files, IDE/editor, environment/secrets, caches). You only need to add project-specific patterns.

- **Daemon Mode**
  - Runs as a standalone daemon (`--daemon --base-dir=<path>`) for 24/7 operation without an MCP client connected.
  - PID file guard (`.filescope/instance.pid`) prevents concurrent daemons on the same project.
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

### Setting Up Local LLM (Optional)

FileScopeMCP includes an automated setup script for Ollama:

```bash
./setup-llm.sh
```

This script will:
- Install Ollama if not present (supports Linux, macOS, WSL)
- Detect GPU hardware (NVIDIA, AMD, Metal) and configure acceleration
- Pull the default model (`qwen2.5-coder:14b`)
- Verify the installation

To check status or use a different model:
```bash
./setup-llm.sh --status           # Check Ollama and model status
./setup-llm.sh --model codellama  # Pull a different model
```

### Claude Code

The build script registers FileScopeMCP automatically. To register (or re-register) without rebuilding:

```bash
./install-mcp-claude.sh
```

The server is registered globally and auto-initializes to the current working directory on startup. No configuration file or manual initialization is needed. When you start a Claude Code session in your project directory, FileScopeMCP automatically scans the codebase, starts the file watcher, and runs the startup integrity sweep.

Use `set_base_directory` if you want to analyze a different directory or subdirectory:

```
set_base_directory(path: "/path/to/your/project")
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

The daemon watches the project, runs the startup integrity sweep, and connects to the LLM broker. Logs are written to `.filescope-daemon.log` in the project root.

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

**3. Start a Claude Code session — FileScopeMCP auto-initializes to your project:**

The server scans your project, builds the initial file tree, starts the file watcher, and runs the startup integrity sweep automatically. No manual initialization needed.

**4. Confirm files are tracked:**
```
find_important_files(limit: 5)
```
You should see a list of your most important files with importance scores.

**5. Check LLM and broker status:**
```
status()
```
Shows broker connection state, LLM processing progress (summarized X/Y, concepts X/Y), file watching status, and project info. LLM is enabled by default — the broker auto-spawns on first connect.

**6. Add the per-repo directory to your `.gitignore`:**
```gitignore
# FileScopeMCP
.filescope/
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
- Go: `import` statements with `go.mod` module resolution
- Ruby: `require` and `require_relative` statements with `.rb` extension probing

### Importance Calculation

Files are assigned importance scores (0–10) based on a weighted formula that considers:
- Number of files that import this file (dependents) — up to +3
- Number of files this file imports (dependencies) — up to +2
- Number of package dependencies imported — up to +1
- File type and extension — TypeScript/JavaScript get higher base scores; PHP +2; JSON config files (package.json, tsconfig.json) +3
- Location in the project structure — files in `src/` or `app/` are weighted higher
- File naming — `index`, `main`, `server`, `app`, `config`, `types`, etc. receive additional points

### Autonomous Updates

When a file event fires, the update pipeline is:

1. **Debounce** — events are coalesced per `filePath:eventType` key (default 2 s) to avoid thrashing on rapid saves.
2. **Acquire mutex** — all tree mutations are serialized through `AsyncMutex` so the watcher and the startup sweep can never corrupt the database simultaneously.
3. **Semantic change detection** — tree-sitter AST diffing for TS/JS files classifies the change (body-only, exports-changed, types-changed, unknown). LLM-powered diff analysis handles all other languages.
4. **Incremental update** — re-parses the file, diffs old vs. new dependency lists, patches `dependents[]` on affected nodes, and recalculates importance.
5. **Cascade engine** — if exports or types changed, BFS propagates staleness to all transitive dependents; if body-only, only the changed file is marked stale.
6. **LLM broker** — picks up stale files and regenerates summaries, concepts, and change impact assessments in priority order.

### Freshness Validation

FileScopeMCP uses two complementary strategies to keep metadata current:

- **Startup sweep** — runs once when the server initializes. Compares every tracked file against the filesystem to detect adds, deletes, and modifications that occurred while the server was offline. Heals the database before accepting any MCP requests.
- **Per-file mtime check** — when you query a file through MCP tools (`get_file_summary`), the system compares the file's current mtime against the last recorded value. If the file changed, it's immediately flagged stale and queued for LLM re-analysis. This catches changes missed by the watcher without the overhead of periodic full-tree scans.

### Cycle Detection

Circular dependencies are detected using an iterative implementation of Tarjan's strongly connected components algorithm:

1. Loads all local import edges from SQLite in a single batch query.
2. Runs Tarjan's SCC on the directed dependency graph.
3. Filters out trivial SCCs (single files with no self-loop) to return only actual cycles.
4. Each cycle group lists the participating files, making it easy to identify and break circular imports.

### Path Normalization

The system handles various path formats to ensure consistent file identification:
- Windows and Unix path formats
- Absolute and relative paths
- URL-encoded paths
- Cross-platform compatibility

### Storage

All file tree data is stored in `.filescope/data.db` (SQLite, WAL mode) inside the per-repo directory.

- **Schema** — drizzle-orm manages: `files` (metadata, staleness, concepts, change_impact), `file_dependencies` (bidirectional relationships), `schema_version` (migration versioning).
- **Auto-migration** — on first run, any legacy JSON tree files are automatically detected and imported into SQLite. The original JSON files are left in place but are no longer used.

**Persistent exclusions:** When you call `exclude_and_remove`, the pattern is saved to the `excludePatterns` array in `.filescope/config.json`. Patterns take effect immediately and persist across server restarts.

## Configuration

FileScopeMCP uses `.filescope/config.json` inside your project directory for all instance settings. This file is **optional** — sensible defaults are used when it doesn't exist, and it's created automatically when you change settings via MCP tools.

### config.json example

```json
{
  "baseDirectory": "/path/to/your/project",
  "excludePatterns": [
    "docs/generated/**",
    "*.csv",
    "tmp/"
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
    "enabled": true
  },
  "version": "1.0.0"
}
```

Note: `excludePatterns` here contains only **project-specific additions**. The ~90 built-in default patterns (covering node_modules, .git, dist, build, language-specific artifacts, and more) are always applied automatically — you do not need to list them here.

The `llm` block only controls whether the broker connection is active. Model selection, provider, API endpoint, and all other LLM settings are configured in `~/.filescope/broker.json` — not here.

### .filescopeignore

Create a `.filescopeignore` file in your project root to exclude files from scanning and watching. Uses gitignore syntax:

```gitignore
# Ignore generated documentation
docs/api/

# Ignore large data files
*.csv
*.parquet

# Ignore specific directories
tmp/
vendor/
```

This file is loaded once at startup and applied alongside the `excludePatterns` from `.filescope/config.json`. Changes to `.filescopeignore` require a server restart to take effect. Both systems work together — use `.filescope/config.json` for programmatic patterns (set via MCP tools) and `.filescopeignore` for patterns you want to commit to your repo.

### Broker Configuration

LLM model and provider settings are configured globally in `~/.filescope/broker.json`. This file is shared across all projects and controls how the standalone broker process communicates with the LLM endpoint.

**Auto-creation:** If `~/.filescope/broker.json` is missing, the broker automatically copies `broker.default.json` from the FileScopeMCP install directory on first start.

**Three templates are shipped with the project:**

- `broker.default.json` — Ollama on localhost, `qwen2.5-coder:7b`
- `broker.windows-host.json` — Ollama on the Windows host from WSL2, `qwen2.5-coder:14b`, uses `wsl-host` placeholder
- `broker.remote-lan.json` — Ollama on a LAN machine by IP, `qwen2.5-coder:14b`

Copy whichever template matches your setup to `~/.filescope/broker.json` and adjust as needed.

**wsl-host auto-resolution:** If `baseURL` contains the string `wsl-host`, the broker automatically replaces it with the Windows host IP at startup by running `ip route show default` (WSL2 only). This lets you use `broker.windows-host.json` without manually updating the IP.

**Broker config fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `llm.provider` | `"openai-compatible"` | Provider adapter (`"anthropic"` or `"openai-compatible"`) |
| `llm.model` | `"qwen2.5-coder:14b"` | Model identifier |
| `llm.baseURL` | — | API endpoint (required for `openai-compatible`) |
| `llm.apiKey` | — | API key (optional; uses env vars if omitted) |
| `llm.maxTokensPerCall` | `1024` | Maximum tokens per LLM call |
| `jobTimeoutMs` | `120000` | Timeout per job in milliseconds |
| `maxQueueSize` | `1000` | Maximum number of pending jobs |

## Directory Structure

FileScopeMCP uses two directory locations:

```
Per-repo (inside your project):
  .filescope/
    config.json          # Project config (optional -- sensible defaults used)
    data.db              # SQLite database (all metadata)
    instance.pid         # PID lock file

Global (shared across all projects):
  ~/.filescope/
    broker.json          # LLM broker config
    broker.sock          # Unix domain socket (broker IPC)
    broker.pid           # Broker PID file
    broker.log           # Broker log output
    stats.json           # Per-repo token usage stats
```

## Technical Details

- **TypeScript 5.8 / Node.js 22** — ESM modules throughout
- **Model Context Protocol** — `@modelcontextprotocol/sdk` for MCP server interface
- **chokidar** — cross-platform filesystem watcher for real-time change detection
- **esbuild** — fast TypeScript compilation to ESM
- **better-sqlite3** — SQLite storage with WAL mode (loaded via `createRequire` for ESM compatibility)
- **drizzle-orm** — type-safe SQL schema and queries
- **tree-sitter** — AST parsing for semantic change detection (loaded via `createRequire`)
- **zod** — runtime validation and structured output schemas
- **AsyncMutex** — serializes concurrent tree mutations from the watcher and startup sweep

## Available Tools

The MCP server exposes 11 tools (consolidated from 22 in v1.1):

### Project Setup

- **set_base_directory** — Override the base directory to analyze a subdirectory or different project path

### File Analysis

- **list_files** — List all files in the project with their importance rankings
- **find_important_files** — Find the most important files in the project
- **get_file_summary** — Get full file intel: summary, importance, dependencies, concepts, change impact, and staleness
- **set_file_summary** — Set the summary of a specific file
- **set_file_importance** — Manually set the importance ranking of a specific file

### LLM Processing

- **scan_all** — Queue all files for LLM summarization. Intensive — use when you need full codebase intelligence. Takes optional `min_importance` threshold (default 1, skips zero-importance files).
- **status** — System health: broker connection, queue depth, LLM processing progress, file watching, and project info. Shows summarized/concepts progress (e.g., "45/120"), pending counts, broker connection state, and per-repo token usage.

### Dependency Analysis

- **detect_cycles** — Detect all circular dependency groups in the project's file graph
- **get_cycles_for_file** — Get cycle groups containing a specific file

### Utilities

- **exclude_and_remove** — Exclude and remove a file or pattern from the file tree. Patterns are saved to `.filescope/config.json` and persist across restarts.

## Usage Examples

The easiest way to get started is to enable this MCP in your AI client and let the AI figure it out. As soon as the MCP starts, it builds an initial file tree. Ask your AI to read important files and use `set_file_summary` to store summaries on them.

### Analyzing a Project

Start a Claude Code session in your project directory. FileScopeMCP auto-initializes to the current working directory on startup.

1. Find the most important files:
   ```
   find_important_files(limit: 5, minImportance: 5)
   ```

2. Get detailed information about a specific file:
   ```
   get_file_summary(filepath: "/path/to/project/src/main.ts")
   ```

### Working with Summaries

1. Add a summary to a file:
   ```
   set_file_summary(filepath: "/path/to/project/src/main.ts", summary: "Main entry point that initializes the application, sets up routing, and starts the server.")
   ```

2. Retrieve the summary later:
   ```
   get_file_summary(filepath: "/path/to/project/src/main.ts")
   ```

### Using the LLM Broker

LLM processing is enabled by default. The broker auto-spawns when the first MCP instance connects.

1. Check broker and LLM status:
   ```
   status()
   ```
   Returns:
   ```json
   {
     "project": {
       "root": "/path/to/project",
       "totalFiles": 120,
       "lastUpdated": "2026-03-24T12:00:00.000Z"
     },
     "llm": {
       "summarized": "45/120",
       "conceptsExtracted": "32/120",
       "pendingSummary": 15,
       "pendingConcepts": 23
     },
     "broker": {
       "mode": "broker",
       "brokerConnected": true,
       "pendingCount": 38,
       "connectedClients": 1
     },
     "fileWatching": {
       "enabled": true,
       "isActive": true
     }
   }
   ```

2. Queue all files for LLM processing (intensive — use when you need full codebase intelligence):
   ```
   scan_all(min_importance: 3)
   ```

3. View auto-generated metadata for a file:
   ```
   get_file_summary(filepath: "/path/to/project/src/main.ts")
   ```

**Sample response** (after LLM broker has processed the file):
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
  }
}
```

When staleness fields appear (e.g., `summaryStale`, `conceptsStale`), the metadata is outdated and the broker will regenerate it. Absent staleness fields mean the metadata is current.

### Finding Circular Dependencies

1. Detect all cycles in the project:
   ```
   detect_cycles()
   ```
   Returns groups of files that form circular import chains.

2. Check if a specific file is part of a cycle:
   ```
   get_cycles_for_file(filepath: "/path/to/project/src/moduleA.ts")
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
| `~/.filescope/broker.log` | Broker process (always on) | Global directory |

**MCP mode:** File logging is disabled by default. To enable it, edit `src/mcp-server.ts` and change `enableFileLogging(false, ...)` to `true`, then rebuild. MCP log messages also go to stderr, which Claude Code captures in its own logs.

**Daemon mode:** File logging is always on. Logs auto-rotate at 10 MB (file is truncated and restarted). View logs in real time:
```bash
tail -f /path/to/project/.filescope-daemon.log
```

**Broker:** The broker process logs to `~/.filescope/broker.log`. Check here for LLM connection errors, timeout failures, and queue activity.

### Checking Status via MCP Tools

From your AI assistant, you can query the system state at any time:

```
# Broker connection, LLM progress, file watching, and project info — all in one call
status()

# Check if a specific file has stale metadata
get_file_summary(filepath: "/path/to/file.ts")
# Staleness fields (summaryStale, conceptsStale, changeImpactStale) appear when metadata is outdated

# Are there any circular dependency chains?
detect_cycles()
```

### Inspecting the Database Directly

The SQLite database is a standard file you can query with any SQLite client:

```bash
sqlite3 /path/to/project/.filescope/data.db

# How many files are tracked?
SELECT COUNT(*) FROM files WHERE is_directory = 0;

# Which files have LLM-generated summaries?
SELECT path, LENGTH(summary) as summary_len FROM files WHERE summary IS NOT NULL AND is_directory = 0;

# Which files have stale metadata?
SELECT path, summary_stale, concepts_stale, change_impact_stale FROM files WHERE summary_stale IS NOT NULL OR concepts_stale IS NOT NULL OR change_impact_stale IS NOT NULL;
```

### Daemon Process Management

```bash
# Check if a daemon is running for a project
cat /path/to/project/.filescope/instance.pid

# Check if that PID is alive
kill -0 $(cat /path/to/project/.filescope/instance.pid) 2>/dev/null && echo "Running" || echo "Not running"

# Graceful shutdown
kill $(cat /path/to/project/.filescope/instance.pid)

# Start daemon
node /path/to/FileScopeMCP/dist/mcp-server.js --daemon --base-dir=/path/to/project
```

## Troubleshooting

### Project not initializing correctly

The server auto-initializes to the current working directory on startup. If you need to analyze a different directory, call `set_base_directory(path: "/your/project")`. If running with Cursor AI or daemon mode, pass `--base-dir=/your/project` as a startup argument.

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

### LLM broker not generating metadata
1. Check `status()` — is `broker.brokerConnected` true?
2. Check `~/.filescope/broker.log` for connection errors or LLM timeout failures.
3. If using Ollama, confirm it's running: `curl http://localhost:11434/v1/models`
4. Check `~/.filescope/broker.json` — ensure `baseURL` points to your LLM endpoint and `model` is correct.
5. Run `./setup-llm.sh --status` to verify Ollama and model installation.

### "FileScopeMCP daemon already running" error
A PID file exists for this project. Either another daemon is running, or a previous one crashed without cleanup:
```bash
# Check if the PID is actually alive
cat /path/to/project/.filescope/instance.pid
kill -0 <PID> 2>/dev/null && echo "Still running" || echo "Stale PID file"

# If stale, remove it
rm /path/to/project/.filescope/instance.pid
```

### Database seems corrupted or out of date
The SQLite database uses WAL mode for crash safety, but if something goes wrong:
```bash
# Delete the database — it will be rebuilt on next startup
rm /path/to/project/.filescope/data.db
rm -f /path/to/project/.filescope/data.db-wal
rm -f /path/to/project/.filescope/data.db-shm
```
On the next startup, the system rescans the project and rebuilds the database from scratch.

## Generated Files Reference

### Per-repo files (inside `.filescope/` in your project)

| File | Purpose | Gitignore? |
|------|---------|------------|
| `.filescope/config.json` | Server configuration (exclude patterns, file watching, LLM on/off) | Optional |
| `.filescope/data.db` | SQLite database (all metadata) | Yes |
| `.filescope/data.db-wal` | SQLite write-ahead log | Yes |
| `.filescope/data.db-shm` | SQLite shared memory file | Yes |
| `.filescope/instance.pid` | Daemon PID lock file | Yes |
| `.filescope-daemon.log` | Daemon log output | Yes |
| `mcp-debug.log` | MCP server debug log (when enabled) | Yes |

Add `.filescope/` to your `.gitignore` to exclude all runtime artifacts at once.

### Global files (in `~/.filescope/`, shared across all projects)

| File | Purpose |
|------|---------|
| `~/.filescope/broker.json` | LLM broker configuration |
| `~/.filescope/broker.sock` | Unix domain socket (broker IPC) |
| `~/.filescope/broker.pid` | Broker PID file |
| `~/.filescope/broker.log` | Broker log output |
| `~/.filescope/stats.json` | Per-repo token usage statistics |

## License

This project is licensed under the GNU General Public License v3 (GPL-3.0). See the [LICENSE](LICENSE) file for the full license text.
