# FileScopeMCP

You are in the FileScopeMCP repository — an MCP server that indexes codebases for AI agents.

## What This Is

FileScopeMCP watches source code, ranks every file by importance (0-10), maps all import dependencies bidirectionally, extracts symbols (functions, classes, types) via tree-sitter, and maintains LLM-generated summaries. It exposes this intelligence as MCP tools so you can understand a codebase without reading every file.

Supports: TypeScript, JavaScript, Python, C, C++, Rust, Go, Ruby, Lua, Zig, PHP, C#, Java.

## If You Want to USE FileScopeMCP in Another Project

You don't need to be in this repo. Register it with your agent runtime:

**Stdio transport (all runtimes):**
```
command: node
args: ["/path/to/FileScopeMCP/dist/mcp-server.js"]
```

The server auto-initializes to whatever directory it is launched from. Override with `set_base_directory(path)`.

**Hermes** (`~/.hermes/config.yaml`):
```yaml
mcp_servers:
  filescope:
    command: "node"
    args: ["/path/to/FileScopeMCP/dist/mcp-server.js"]
    timeout: 120
```

**Claude Code:** Already registered if `./build.sh` was run. Verify: `claude mcp list`.

**Cursor / other MCP clients:** See `docs/mcp-clients.md` for per-client config snippets.

### Connecting Your Local LLM (Broker Setup)

FileScopeMCP uses a broker to queue LLM work (file summarization, change analysis). The broker talks to any OpenAI-compatible HTTP endpoint. If you already have a local LLM running (llama-server, Ollama, vLLM, LM Studio, etc.), point the broker at it.

Edit `~/.filescope/broker.json` (created automatically on first run from `broker.default.json`):

```json
{
  "llm": {
    "provider": "openai-compatible",
    "model": "your-model-name-or-alias",
    "baseURL": "http://localhost:8880/v1",
    "maxTokensPerCall": 1024
  },
  "jobTimeoutMs": 300000,
  "maxQueueSize": 1000
}
```

Set `baseURL` to wherever your LLM is listening. Set `model` to the model name your server expects (check your server's `/v1/models` endpoint). The broker handles queuing and prioritization — it will not flood your LLM with hundreds of requests at once.

If the broker config file does not exist yet, copy the template:
```bash
mkdir -p ~/.filescope
cp broker.default.json ~/.filescope/broker.json
```

Then edit `baseURL` and `model` to match your setup. Verify with `status()` — it reports broker connection state.

For tool usage patterns and workflows, install the FileScopeMCP skill from `skills/filescope-mcp/SKILL.md`.

## If You Are Working ON This Codebase

### Architecture

```
src/
  mcp-server.ts     — MCP protocol handler, tool registration, stdio transport
  coordinator.ts    — orchestrates scanning, watching, and broker lifecycle
  scanner.ts        — tree-sitter AST parsing, dependency extraction, symbol extraction
  watcher.ts        — file system watcher, semantic change detection
  broker/           — LLM job queue (priority queue, OpenAI-compatible HTTP client)
  nexus/            — web dashboard (localhost:1234), cross-repo aggregation
  db.ts             — SQLite via better-sqlite3, schema migrations
```

The broker and nexus modules must NOT cross-import.

### Build and Run

```bash
./build.sh          # npm install + tsc + register with Claude Code
./run.sh            # launch manually (build.sh generates this)
```

### LLM Backend

FileScopeMCP uses a local LLM via llama.cpp's llama-server for background summarization. The broker connects to it over HTTP (OpenAI-compatible `/v1/chat/completions`). Default: port 8880, model alias `FileScopeMCP-brain`.

On WSL2: llama-server runs on Windows (native GPU access), broker bridges via `broker.windows-host.json` which auto-resolves the Windows host IP.

Setup: `./setup-llm.sh` (prints platform-specific instructions). Status: `./setup-llm.sh --status`.

### Key Conventions

- TypeScript strict mode, ES modules
- All tools return structured JSON with consistent error codes (`NOT_INITIALIZED`, `NOT_FOUND`, `BROKER_DISCONNECTED`)
- Tool descriptions are the contract — they are what agents read to decide when to call a tool. Write them precisely.
- Tests: `npm test`
- Database: SQLite in `.filescope/` within the target project directory
