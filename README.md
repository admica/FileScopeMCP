# FileScopeMCP

**Understand your codebase — ranked, related, summarized, and kept up to date automatically.**

[![Build Status](https://github.com/admica/FileScopeMCP/actions/workflows/build.yml/badge.svg)](https://github.com/admica/FileScopeMCP/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.x-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-red.svg)](LICENSE)

[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/admica/FileScopeMCP)](https://archestra.ai/mcp-catalog/admica__filescopemcp)

FileScopeMCP is a TypeScript MCP server and standalone daemon that ranks every file in your codebase by importance, tracks bidirectional dependencies across 12 languages, detects circular dependency chains, and auto-generates AI summaries, concepts, and change impact assessments — keeping all metadata fresh in the background as your code changes.

## What It Does

- **File importance ranking** — 0–10 score per file using a weighted formula: incoming dependents (+3), outgoing dependencies (+2), package dependencies (+1), file type, location, and name significance. Surface your most critical files instantly.
- **Dependency tracking** — bidirectional relationships (who imports a file, what it imports). Covers 12 languages: Python, JavaScript, TypeScript, C/C++, Rust, Lua, Zig, PHP, C#, Java, Go, Ruby.
- **Circular dependency detection** — iterative Tarjan's SCC algorithm finds all cycles in the dependency graph. Query project-wide or per-file.
- **Autonomous background updates** — filesystem watcher (chokidar) handles add/change/delete events. Incremental updates only touch the affected file. Startup integrity sweep heals the database after offline periods. Per-file mtime validation catches changes missed by the watcher.
- **Semantic change detection** — tree-sitter AST diffing for TypeScript/JavaScript classifies changes as `body-only`, `exports-changed`, `types-changed`, or `unknown`. LLM-powered diff analysis handles all other languages. Body-only changes skip cascade propagation entirely.
- **Cascade engine** — BFS staleness propagation through the dependency graph when exports or types change. Per-field granularity: `summary`, `concepts`, and `change_impact` are tracked independently. Depth cap of 10 prevents runaway propagation.
- **LLM broker** — standalone process auto-spawned on first MCP connect. Communicates with Ollama (or any OpenAI-compatible endpoint) over a Unix domain socket (`~/.filescope/broker.sock`). In-memory priority queue: interactive (tier 1) > cascade (tier 2) > background (tier 3). LLM enabled by default.
- **SQLite storage** — all metadata in `.filescope/data.db` (WAL mode). Type-safe schema via drizzle-orm. Auto-migrates legacy JSON tree files on first run.
- **Custom exclusion patterns** — `.filescopeignore` file (gitignore syntax) plus ~90 built-in patterns covering all major languages and toolchains.

## Quick Start

### Prerequisites

- **Node.js 22+** — download from [nodejs.org](https://nodejs.org/)
- **Native build tools** (usually optional) — `better-sqlite3` and `tree-sitter` ship prebuilt binaries for most platforms. If prebuilds aren't available, `npm install` falls back to compiling from source:
  - Linux: `sudo apt install build-essential python3`
  - macOS: `xcode-select --install`
  - Windows: Visual Studio Build Tools with C++ workload

### Install

**Linux / macOS / WSL:**

```bash
git clone https://github.com/admica/FileScopeMCP.git
cd FileScopeMCP
./build.sh
```

**Windows:**

```bat
git clone https://github.com/admica/FileScopeMCP.git
cd FileScopeMCP
build.bat
```

Both scripts install npm dependencies, compile TypeScript to `dist/`, generate `mcp.json` for Cursor AI, and register the server with Claude Code (`~/.claude.json`).

### LLM Setup (Optional)

FileScopeMCP uses a custom Ollama model (`FileScopeMCP-brain`) for generating summaries, concepts, and change impact assessments. Without it, file tracking and dependency analysis still work fully.

See **[docs/ollama-setup.md](docs/ollama-setup.md)** for step-by-step guides:

- Same machine (Linux/macOS) — run `./setup-llm.sh`
- WSL2 + Windows GPU — Ollama on Windows, FileScopeMCP in WSL
- Remote / LAN server — Ollama on a different machine

### Verify

```bash
# Build output exists
ls dist/mcp-server.js

# Registered with Claude Code
claude mcp list

# Start a Claude Code session — FileScopeMCP auto-initializes to your project directory
# Then from the AI assistant:
find_important_files(limit: 5)
status()
```

### Gitignore

Add these to your project's `.gitignore`:

```gitignore
.filescope/
.filescope-daemon.log
mcp-debug.log
```

## MCP Client Configuration

### Claude Code

Registered automatically by `build.sh`. To re-register without rebuilding:

```bash
./install-mcp-claude.sh
```

The server auto-initializes to the current working directory when a Claude Code session starts. Use `set_base_directory` to analyze a different directory:

```
set_base_directory(path: "/path/to/your/project")
```

### Cursor AI (WSL — Cursor running on Windows)

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

Run FileScopeMCP as a standalone background process (no MCP client required):

```bash
node dist/mcp-server.js --daemon --base-dir=/path/to/project
```

Logs go to `.filescope-daemon.log` in the project root. A PID file at `.filescope/instance.pid` prevents concurrent daemons on the same project.

## Available Tools

FileScopeMCP exposes 11 tools (consolidated from 22 in v1.1).

### Project Setup

| Tool | Description |
|------|-------------|
| `set_base_directory` | Override the base directory to analyze a subdirectory or different project path. Takes `path` (absolute path). |

### File Analysis

| Tool | Description |
|------|-------------|
| `list_files` | List all tracked files with their importance rankings. No parameters. |
| `find_important_files` | Find the most important files. Optional: `limit` (default 10), `minImportance` (0–10). Returns staleness indicators per file. |
| `get_file_summary` | Full file intel: summary, importance, dependencies, dependents, package dependencies, concepts, change impact, and staleness fields. Takes `filepath`. |
| `set_file_summary` | Manually set a file's summary. Takes `filepath` and `summary`. Preserved until the file changes again. |
| `set_file_importance` | Manually set a file's importance score. Takes `filepath` and `importance` (0–10). |

### LLM Processing

| Tool | Description |
|------|-------------|
| `scan_all` | Queue all files for LLM summarization. Intensive — use when you need full codebase intelligence. Optional: `min_importance` (default 1, skips zero-importance files). |
| `status` | System health: broker connection, queue depth, LLM progress (summarized X/Y, concepts X/Y, pending counts), file watching state, and project info. |

### Dependency Analysis

| Tool | Description |
|------|-------------|
| `detect_cycles` | Detect all circular dependency groups in the project's file graph. Returns cycle groups with participant file lists. |
| `get_cycles_for_file` | Get cycle groups containing a specific file. Takes `filepath`. |

### Utilities

| Tool | Description |
|------|-------------|
| `exclude_and_remove` | Exclude a file or glob pattern from the file tree and remove it from the database. Takes `filepath`. Patterns are persisted to `.filescope/config.json`. |

## Configuration

### .filescope/config.json

Per-project configuration. Optional — sensible defaults apply when absent. Created automatically when you change settings via MCP tools.

```json
{
  "baseDirectory": "/path/to/your/project",
  "excludePatterns": [
    "docs/generated/**",
    "*.csv"
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

`excludePatterns` contains only project-specific additions. The ~90 built-in default patterns (node_modules, .git, dist, build, language artifacts, etc.) are always applied automatically.

The `llm` block only controls whether the broker connection is active. All LLM settings (model, endpoint, API key) live in `~/.filescope/broker.json`.

### .filescopeignore

Place a `.filescopeignore` file in your project root to exclude files using gitignore syntax:

```gitignore
docs/api/
*.csv
*.parquet
tmp/
vendor/
```

Loaded once at startup. Use `.filescope/config.json` for programmatic patterns set via MCP tools; use `.filescopeignore` for patterns you want to commit to the repo.

### Broker Configuration (~/.filescope/broker.json)

Global LLM settings shared across all projects. If missing, the broker auto-copies `broker.default.json` from the install directory on first start.

Three templates ship with the project:

| Template | When to use |
|----------|-------------|
| `broker.default.json` | Ollama on localhost (default) |
| `broker.windows-host.json` | Ollama on Windows host from WSL2 (uses `wsl-host` placeholder, auto-resolved) |
| `broker.remote-lan.json` | Ollama on a LAN machine by IP |

Copy the matching template to `~/.filescope/broker.json` and edit as needed.

**Config fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `llm.provider` | `"openai-compatible"` | `"anthropic"` or `"openai-compatible"` |
| `llm.model` | `"FileScopeMCP-brain"` | Model identifier |
| `llm.baseURL` | — | API endpoint (required for `openai-compatible`) |
| `llm.apiKey` | — | API key (optional; uses env vars if omitted) |
| `llm.maxTokensPerCall` | `1024` | Maximum tokens per LLM call |
| `jobTimeoutMs` | `120000` | Job timeout in milliseconds |
| `maxQueueSize` | `1000` | Maximum pending jobs |

### Custom LLM Model (Modelfile)

The `Modelfile` in the repo root defines the `FileScopeMCP-brain` Ollama model — system prompt, base model (`gemma4:e4b`), and tuned parameters (`temperature: 0.1`, `num_ctx: 32768`). The system prompt teaches the model all three task types (summary, concepts, change_impact) and enforces output format rules.

To modify: edit `Modelfile`, then run `ollama create FileScopeMCP-brain -f Modelfile`. No broker restart needed.

## How It Works

### Dependency Detection

Import patterns detected per language:

- **Python** — `import` and `from ... import` statements
- **JavaScript / TypeScript** — `import` statements, `require()` calls, dynamic `import()` expressions
- **C / C++** — `#include` directives
- **Rust** — `use` and `mod` statements
- **Lua** — `require` statements
- **Zig** — `@import` directives
- **PHP** — `require`, `require_once`, `include`, `include_once`, `use`
- **C#** — `using` directives
- **Java** — `import` statements
- **Go** — `import` statements with `go.mod` module resolution
- **Ruby** — `require` and `require_relative` with `.rb` extension probing

### Importance Calculation

Scores (0–10) from a weighted formula:

| Factor | Max contribution |
|--------|-----------------|
| Incoming dependents (files that import this file) | +3 |
| Outgoing dependencies (files this file imports) | +2 |
| Package dependencies imported | +1 |
| File type (TS/JS base score; PHP +2; config files like package.json +3) | varies |
| Location (`src/`, `app/` weighted higher) | varies |
| Naming (`index`, `main`, `server`, `app`, `config`, `types`, etc.) | varies |

### Autonomous Update Pipeline

When a file event fires:

1. **Debounce** — events coalesced per `filePath:eventType` key (default 2 s)
2. **Mutex** — all mutations serialized through `AsyncMutex`
3. **Semantic change detection** — tree-sitter AST diff (TS/JS) or LLM-powered diff (all other languages) classifies the change
4. **Incremental update** — re-parses the changed file, diffs dependency lists, patches reverse-dependency map, recalculates importance
5. **Cascade engine** — BFS propagates staleness to transitive dependents if exports/types changed; body-only changes affect only the changed file
6. **LLM broker** — picks up stale files and regenerates summaries, concepts, and change impact in priority order

### Freshness Validation

Two complementary strategies:

- **Startup sweep** — runs once at initialization. Compares every tracked file against the filesystem to detect adds, deletes, and modifications that occurred while the server was offline.
- **Per-file mtime check** — when you call `get_file_summary`, the system compares current mtime against the last recorded value. If changed, the file is immediately flagged stale and queued for re-analysis.

### Cycle Detection

1. Loads all local import edges from SQLite in a single batch query
2. Runs iterative Tarjan's SCC algorithm on the directed dependency graph
3. Filters out trivial SCCs (single files with no self-loop)
4. Returns cycle groups listing all participating files

### Storage

All data in `.filescope/data.db` (SQLite, WAL mode):

- `files` — metadata, staleness flags, summary, concepts, change_impact
- `file_dependencies` — bidirectional relationships
- `schema_version` — migration versioning

Auto-migration: on first run, any legacy JSON tree files are imported into SQLite automatically.

## Directory Structure

```
Per-repo (inside your project):
  .filescope/
    config.json          # Project config (optional)
    data.db              # SQLite database
    data.db-wal          # SQLite write-ahead log
    data.db-shm          # SQLite shared memory
    instance.pid         # Daemon PID lock file
  .filescope-daemon.log  # Daemon log output (project root)

Global (shared across all projects):
  ~/.filescope/
    broker.json          # LLM broker config
    broker.sock          # Unix domain socket (broker IPC)
    broker.pid           # Broker PID file
    broker.log           # Broker log output
    stats.json           # Per-repo token usage stats
```

## Troubleshooting

### Project not initializing

FileScopeMCP auto-initializes to the current working directory when Claude Code starts. For a different directory, call `set_base_directory(path: "/your/project")`. For Cursor AI or daemon mode, pass `--base-dir=/your/project` as a startup argument.

### MCP server not appearing in Claude Code

1. Run `claude mcp list` to check registration
2. If missing, run `./install-mcp-claude.sh`
3. Check `~/.claude.json` — it should have a `FileScopeMCP` entry under `mcpServers`
4. Restart Claude Code after registration

### npm install fails on native modules

`better-sqlite3` and `tree-sitter` include native addons. If prebuilt binaries aren't available:

- Linux: `sudo apt install build-essential python3`
- macOS: `xcode-select --install`
- Windows: Install Visual Studio Build Tools with C++ workload

### LLM broker not generating metadata

1. Call `status()` — check `broker.brokerConnected`
2. Check `~/.filescope/broker.log` for connection errors
3. If using Ollama: `curl http://localhost:11434/v1/models`
4. Check `~/.filescope/broker.json` — `baseURL` and `model` must be correct
5. Run `./setup-llm.sh --status` to verify Ollama and model installation

For WSL + Windows issues, see [docs/ollama-setup.md](docs/ollama-setup.md).

### Stale PID file ("daemon already running" error)

```bash
cat /path/to/project/.filescope/instance.pid
kill -0 <PID> 2>/dev/null && echo "Running" || echo "Stale"

# If stale:
rm /path/to/project/.filescope/instance.pid
```

### Database corruption

```bash
rm /path/to/project/.filescope/data.db
rm -f /path/to/project/.filescope/data.db-wal
rm -f /path/to/project/.filescope/data.db-shm
```

The database is rebuilt from scratch on next startup.

### Log file locations

| File | When active | Location |
|------|-------------|----------|
| `~/.filescope/broker.log` | Always (broker process) | Global directory |
| `.filescope-daemon.log` | Daemon mode | Project root |
| `.filescope/mcp-server.log` | MCP server mode | Global directory (`~/.filescope/`) |

## License

Copyright (c) 2026 admica. All rights reserved. See the [LICENSE](LICENSE) file for details.
