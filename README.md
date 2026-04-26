# FileScopeMCP

**Your AI already knows how to code. Now it knows your codebase.**

[![Build Status](https://github.com/admica/FileScopeMCP/actions/workflows/build.yml/badge.svg)](https://github.com/admica/FileScopeMCP/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.x-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-red.svg)](LICENSE)
[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/admica/FileScopeMCP)](https://archestra.ai/mcp-catalog/admica__filescopemcp)

FileScopeMCP watches your code, ranks every file by importance, maps all dependencies, and keeps AI-generated summaries fresh in the background. When your LLM asks "what does this file do?" — it gets a real answer without reading the source.

Works with **Claude Code**, **Hermes Agent**, **Codex**, **OpenClaw**, **Cursor AI**, or as a standalone daemon. Supports TypeScript, JavaScript, Python, C, C++, Rust, Go, Ruby, Lua, Zig, PHP, C#, and Java.

## Key Features

**Importance ranking** — every file scored 0-10 based on how many things depend on it, what it exports, and where it lives. Your LLM sees the critical files first.

**Dependency mapping** — bidirectional import tracking across all supported languages. AST-level extraction (tree-sitter) for TS/JS, Python, C, C++, Rust, Go, and Ruby; regex-based for Lua, Zig, PHP, C#, and Java. Finds circular dependencies too.

**Symbol intelligence** — extracts functions, classes, interfaces, types, enums, consts, modules, and structs from source via tree-sitter. `find_symbol` resolves names to file + line range. `find_callers` and `find_callees` map the call graph for TS/JS so your AI can answer "who calls this function?" before refactoring.

**Always fresh** — file watcher + semantic change detection means metadata updates automatically. AST-level diffing for TS/JS, LLM-powered analysis for everything else. Only re-processes what actually changed.

**LLM broker** — a background process coordinates all AI work through llama.cpp's llama-server (or any OpenAI-compatible HTTP API). Priority queue ensures interactive queries beat background processing. Runs on a single GPU.

**Nexus dashboard** — a web UI at `localhost:1234` that lets you visually explore your codebase across all your repos. Interactive dependency graphs, file detail panels, live broker activity, and per-repo health monitoring.

## Prerequisites

- **Node.js >= 22** and npm ([download](https://nodejs.org/))
- **Build tools** for native modules (`better-sqlite3`, `tree-sitter`):
  - Linux: `sudo apt install build-essential python3`
  - macOS: `xcode-select --install`
  - Windows: Visual Studio Build Tools with C++ workload

## Quick Start

```bash
git clone https://github.com/admica/FileScopeMCP.git
cd FileScopeMCP
./build.sh          # installs deps, compiles, registers with Claude Code
```

`./build.sh` registers FileScopeMCP globally via `claude mcp add --scope user` (idempotent; re-run with `npm run register-mcp`). If the `claude` CLI is missing, the build still succeeds — see [docs/mcp-clients.md](docs/mcp-clients.md) for other MCP clients.

Open a Claude Code session in any project and FileScopeMCP auto-initializes. The MCP tools appear automatically — your AI can call them directly during conversation:

```
find_important_files(limit: 5)
status()
```

### Agent Runtimes (Hermes, Codex, OpenClaw)

Agent runtimes discover FileScopeMCP via the repo's `AGENTS.md`, which includes MCP registration config, broker/LLM setup, and a pointer to the portable skill file at `skills/filescope-mcp/SKILL.md`.

**Hermes** — add to `~/.hermes/config.yaml`:
```yaml
mcp_servers:
  filescope:
    command: "node"
    args: ["/path/to/FileScopeMCP/dist/mcp-server.js"]
    timeout: 120
```

**Already have a local LLM running?** Point the broker at it — edit `~/.filescope/broker.json` and set `baseURL` to your LLM's endpoint. See `AGENTS.md` for details.

### LLM Summaries (Optional)

Run `./setup-llm.sh` for a platform-specific guide to setting up llama.cpp's `llama-server` — see [docs/llm-setup.md](docs/llm-setup.md) for details. Without it, everything else still works (file tracking, dependencies, symbols, call graphs — just no LLM-generated summaries). If your agent runtime already has a local LLM, configure the broker to reuse it instead.

Add to your project's `.gitignore`:
```
.filescope/
.filescope-daemon.log
```

## MCP Tools

| Tool | What it does |
|------|-------------|
| `status` | Broker connection, queue depth, LLM progress, watcher state |
| `find_important_files` | Top files by importance score with dependency counts |
| `get_file_summary` | Everything about a file: summary, concepts, change impact, exports, deps, staleness |
| `list_files` | Full file tree (no args) or flat top-N by importance (with `maxItems`) |
| `find_symbol` | Resolve a symbol name to file + line range; supports prefix match via trailing `*` |
| `find_callers` | Find all symbols that call a named symbol (TS/JS call graph) |
| `find_callees` | Find all symbols that a named symbol calls (TS/JS call graph) |
| `search` | Search file metadata across symbols, summaries, purpose, and paths |
| `list_changed_since` | Files changed since a timestamp or git SHA |
| `get_communities` | Louvain-clustered file groups by import coupling |
| `detect_cycles` | Find circular dependency chains |
| `get_cycles_for_file` | Cycles involving a specific file |
| `scan_all` | Queue files for LLM summarization via the broker |
| `set_base_directory` | Point at a different project |
| `set_file_summary` | Manually set or override a file's LLM summary |
| `set_file_importance` | Manually set a file's importance score (0-10) |
| `exclude_and_remove` | Drop files/patterns from tracking (destructive) |

## Nexus Dashboard

```bash
npm run build:nexus  # one-time build (API + UI)
npm run nexus        # starts at http://localhost:1234
```

A read-only web dashboard that connects to every FileScopeMCP repo on your machine:

- **Project view** — file tree with importance heat colors and staleness indicators, click any file for full metadata
- **Dependency graph** — interactive Cytoscape.js visualization, filter by directory, click nodes to inspect
- **System view** — live broker status, per-repo token usage, streaming activity log
- **Settings** — manage which repos appear, remove or restore from blacklist

Auto-discovers repos by scanning for `.filescope/data.db` directories. No configuration needed.

## How It Works

```
Your code changes
    → file watcher picks it up
    → AST diff classifies the change (exports? types? body only?)
    → symbols extracted (functions, classes, types, etc.)
    → call-site edges resolved (TS/JS: who calls what)
    → importance scores recalculated
    → staleness cascades to dependents (only if exports/types changed)
    → LLM broker regenerates summaries, concepts, change impact
    → your AI's next query gets fresh answers
```

Everything lives in `.filescope/data.db` (SQLite, WAL mode) per project. The broker coordinates LLM work across all your repos via a Unix socket at `~/.filescope/broker.sock`.

## Documentation

| Doc | What's in it |
|-----|-------------|
| [AGENTS.md](AGENTS.md) | Cross-agent context file — MCP registration, broker config, architecture (read by Hermes, Codex, OpenClaw) |
| [FileScopeMCP Skill](skills/filescope-mcp/SKILL.md) | Portable skill file — tool reference, workflows, tips for agents using FileScopeMCP |
| [LLM Setup](docs/llm-setup.md) | llama.cpp / llama-server installation — local, WSL2+Windows, or remote |
| [Configuration](docs/configuration.md) | Per-project config, broker config, ignore patterns |
| [MCP Clients](docs/mcp-clients.md) | Setup for Claude Code, Cursor AI, daemon mode |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |
| [Internals](docs/internals.md) | Dependency detection, importance formula, symbol extraction, call-site edges, storage |

## License

Copyright (c) 2026 admica. All rights reserved. See [LICENSE](LICENSE).
