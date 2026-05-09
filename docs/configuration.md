# Configuration

## Per-Project Config (.filescope/config.json)

Optional — sensible defaults apply when absent. Created automatically when you change settings via MCP tools.

```json
{
  "baseDirectory": "/path/to/your/project",
  "excludePatterns": [
    "docs/generated/**",
    "*.csv"
  ],
  "fileWatching": {
    "enabled": true,
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

`excludePatterns` contains only your project-specific additions. ~145 built-in default patterns (node_modules, .git, dist, build, language artifacts, agent / planning tool dirs like `.claude/`, `.planning/`, `.opencode/`, `.codex/`, etc.) are always applied automatically. New defaults are auto-merged into existing per-project configs on load.

The `llm` block only controls whether the broker connection is active. All LLM settings (model, endpoint, API key) live in the broker config.

## Broker Config (~/.filescope/broker.json)

Global LLM settings shared across all projects. If missing, the broker auto-copies `broker.default.json` from the install directory on first start.

Three templates ship with the project:

| Template | When to use |
|----------|-------------|
| `broker.default.json` | llama-server on localhost:8880 (default) |
| `broker.windows-host.json` | llama-server on Windows host from WSL2 (uses `wsl-host` placeholder, auto-resolved) |
| `broker.remote-lan.json` | llama-server on a LAN machine (edit `baseURL`) |

Copy the matching template to `~/.filescope/broker.json` and edit as needed.

**Fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `llm.provider` | `"openai-compatible"` | `"anthropic"` or `"openai-compatible"` |
| `llm.model` | `"llm-model"` | Model identifier (must match `--alias` on llama-server) |
| `llm.baseURL` | — | API endpoint (required for `openai-compatible`) |
| `llm.apiKey` | — | API key (optional; uses env vars if omitted) |
| `llm.maxTokensPerCall` | `1024` | Maximum tokens per LLM call |
| `jobTimeoutMs` | `120000` (schema) / `300000` (template) | Job timeout in ms. Zod schema default is 120 s; the shipped `broker.default.json` overrides to 300 s, so a fresh install runs at 5 min |
| `maxQueueSize` | `1000` | Maximum pending jobs |

## Custom Ignore Patterns (.filescopeignore)

Place a `.filescopeignore` file in your project root to exclude files using gitignore syntax:

```gitignore
docs/api/
*.csv
*.parquet
tmp/
vendor/
```

Loaded once at startup. Use `.filescope/config.json` for programmatic patterns set via MCP tools; use `.filescopeignore` for patterns you want to commit to the repo.

## System Prompt

The broker's system prompt lives in `src/llm/prompts.ts` (constant `SYSTEM_PROMPT`). Edit there and rebuild the broker to change it.

## Directory Structure

```
Per-repo (inside your project):
  .filescope/
    config.json          # Project config (optional)
    data.db              # SQLite database
    data.db-wal          # SQLite write-ahead log
    data.db-shm          # SQLite shared memory
    instance.pid         # Daemon PID lock file
  .filescope-daemon.log  # Daemon log output, daemon mode only (project root)

Global (shared across all projects):
  ~/.filescope/
    broker.json          # LLM broker config
    broker.sock          # Unix domain socket (broker IPC)
    broker.pid           # Broker PID file
    broker.log           # Broker log output
    mcp-server.log       # MCP server log (always; stderr is suppressed in MCP mode)
    stats.json           # Per-repo token usage stats
    nexus.json           # Nexus dashboard repo registry (multi-repo aggregation)
    watchers.log         # scripts/watchers.mjs supervisor log (only when filescope-watchers.service is installed)
    watcher-logs/        # one log per repo child spawned by the supervisor
```
