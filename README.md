# FileScopeMCP

**Your AI already knows how to code. Now it knows your codebase.**

[![Build Status](https://github.com/admica/FileScopeMCP/actions/workflows/build.yml/badge.svg)](https://github.com/admica/FileScopeMCP/actions)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.x-green)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-red.svg)](LICENSE)
[![Trust Score](https://archestra.ai/mcp-catalog/api/badge/quality/admica/FileScopeMCP)](https://archestra.ai/mcp-catalog/admica__filescopemcp)

FileScopeMCP watches your code, ranks every file by importance, maps all dependencies, and keeps AI-generated summaries fresh in the background. When your LLM asks "what does this file do?" — it gets a real answer without reading the source.

Works with **Claude Code**, **Cursor AI**, or as a standalone daemon. Supports 12 languages out of the box.

## Key Features

**Importance ranking** — every file scored 0-10 based on how many things depend on it, what it exports, and where it lives. Your LLM sees the critical files first.

**Dependency mapping** — bidirectional import tracking across Python, JS/TS, C/C++, Rust, Go, Ruby, Lua, Zig, PHP, C#, Java. Finds circular dependencies too.

**Always fresh** — file watcher + semantic change detection means metadata updates automatically. AST-level diffing for TS/JS, LLM-powered analysis for everything else. Only re-processes what actually changed.

**LLM broker** — a background process coordinates all AI work through llama.cpp's llama-server (or any OpenAI-compatible HTTP API). Priority queue ensures interactive queries beat background processing. Runs on a single GPU.

**Nexus dashboard** — a web UI at `localhost:1234` that lets you visually explore your codebase across all your repos. Interactive dependency graphs, file detail panels, live broker activity, and per-repo health monitoring.

## Quick Start

```bash
git clone https://github.com/admica/FileScopeMCP.git
cd FileScopeMCP
./build.sh          # installs deps, compiles, registers with Claude Code
```

`./build.sh` registers FileScopeMCP globally via `claude mcp add --scope user` (idempotent; re-run with `npm run register-mcp`). If the `claude` CLI is missing, the build still succeeds — see [docs/mcp-clients.md](docs/mcp-clients.md) for manual setup.

That's it. Open a Claude Code session in any project and FileScopeMCP auto-initializes. Try:

```
find_important_files(limit: 5)
status()
```

**Want AI summaries?** Run `./setup-llm.sh` for a platform-specific guide to setting up llama.cpp's `llama-server` — see [docs/llm-setup.md](docs/llm-setup.md) for details. Without it, everything else still works.

Add to your project's `.gitignore`:
```
.filescope/
.filescope-daemon.log
```

## MCP Tools

| Tool | What it does |
|------|-------------|
| `find_important_files` | Top files by importance score |
| `get_file_summary` | Everything about a file: summary, concepts, change impact, deps, staleness |
| `list_files` | Full file tree with importance |
| `detect_cycles` | Find circular dependency chains |
| `status` | Broker connection, queue depth, LLM progress, watcher state |
| `scan_all` | Queue entire codebase for LLM processing |
| `set_base_directory` | Point at a different project |
| `set_file_summary` / `set_file_importance` | Manual overrides |
| `exclude_and_remove` | Drop files/patterns from tracking |
| `get_cycles_for_file` | Cycles involving a specific file |

## Nexus Dashboard

```bash
npm run nexus       # opens at http://localhost:1234
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
    → importance scores recalculated
    → staleness cascades to dependents (only if exports/types changed)
    → LLM broker regenerates summaries, concepts, change impact
    → your AI's next query gets fresh answers
```

Everything lives in `.filescope/data.db` (SQLite, WAL mode) per project. The broker coordinates LLM work across all your repos via a Unix socket at `~/.filescope/broker.sock`.

## Documentation

| Doc | What's in it |
|-----|-------------|
| [LLM Setup](docs/llm-setup.md) | llama.cpp / llama-server installation — local, WSL2+Windows, or remote |
| [Configuration](docs/configuration.md) | Per-project config, broker config, ignore patterns |
| [MCP Clients](docs/mcp-clients.md) | Setup for Claude Code, Cursor AI, daemon mode |
| [Troubleshooting](docs/troubleshooting.md) | Common issues and fixes |
| [Internals](docs/internals.md) | Dependency detection, importance formula, cascade engine, storage |

## License

Copyright (c) 2026 admica. All rights reserved. See [LICENSE](LICENSE).
