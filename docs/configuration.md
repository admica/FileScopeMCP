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

`excludePatterns` contains only your project-specific additions. ~90 built-in default patterns (node_modules, .git, dist, build, language artifacts, etc.) are always applied automatically.

The `llm` block only controls whether the broker connection is active. All LLM settings (model, endpoint, API key) live in the broker config.

## Broker Config (~/.filescope/broker.json)

Global LLM settings shared across all projects. If missing, the broker auto-copies `broker.default.json` from the install directory on first start.

Three templates ship with the project:

| Template | When to use |
|----------|-------------|
| `broker.default.json` | Ollama on localhost (default) |
| `broker.windows-host.json` | Ollama on Windows host from WSL2 (uses `wsl-host` placeholder, auto-resolved) |
| `broker.remote-lan.json` | Ollama on a LAN machine by IP |

Copy the matching template to `~/.filescope/broker.json` and edit as needed.

**Fields:**

| Field | Default | Description |
|-------|---------|-------------|
| `llm.provider` | `"openai-compatible"` | `"anthropic"` or `"openai-compatible"` |
| `llm.model` | `"FileScopeMCP-brain"` | Model identifier |
| `llm.baseURL` | — | API endpoint (required for `openai-compatible`) |
| `llm.apiKey` | — | API key (optional; uses env vars if omitted) |
| `llm.maxTokensPerCall` | `1024` | Maximum tokens per LLM call |
| `jobTimeoutMs` | `120000` | Job timeout in milliseconds |
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

## Custom LLM Model (Modelfile)

The `Modelfile` in the repo root defines the `FileScopeMCP-brain` Ollama model — system prompt, base model, and tuned parameters (`temperature: 0.1`, `num_ctx: 32768`). The system prompt teaches the model all three task types (summary, concepts, change_impact) and enforces output format rules.

To modify: edit `Modelfile`, then run `ollama create FileScopeMCP-brain -f Modelfile`. No broker restart needed.

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
    nexus.json           # Nexus dashboard repo registry
```
