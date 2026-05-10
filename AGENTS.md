# FileScopeMCP

You are in the FileScopeMCP repository — an MCP server that indexes codebases for autonomous AI agents (Hermes, OpenClaw, Claude Code, Codex, and any other MCP-capable runtime).

## What This Is

FileScopeMCP watches source code, ranks every file by importance (0-10), maps all import dependencies bidirectionally, extracts symbols (functions, classes, types) via tree-sitter, and maintains LLM-generated summaries. It exposes this intelligence as MCP tools so an agent can understand a codebase without reading every file.

Supports: TypeScript, JavaScript, Python, C, C++, Rust, Go, Ruby, Lua, Zig, PHP, C#, Java.

## If You Want to USE FileScopeMCP in Another Project

You don't need to be in this repo. Register it with your agent runtime, then point it at a project with `set_base_directory(path)` (or just launch the server from the project directory — it auto-initializes to its launch cwd).

### Stdio transport (all runtimes)

```
command: node
args: ["/path/to/FileScopeMCP/dist/mcp-server.js"]
```

### Hermes (`~/.hermes/config.yaml`)

```yaml
mcp_servers:
  filescope:
    command: "node"
    args: ["/path/to/FileScopeMCP/dist/mcp-server.js"]
    timeout: 120
    connect_timeout: 60
```

After editing, restart Hermes so it re-reads `mcp_servers`. Verify the server appears in Hermes's tool list and that `status()` returns `initialized: true`.

### Claude Code

Already registered if `./build.sh` was run. Verify with `claude mcp list`.

For an opinionated install that includes a project priming `CLAUDE.md` and pointers to optional hook templates: `npm run install-claude-code`. Layered — never modifies `.claude/settings.json`. See [ROADMAP.md](ROADMAP.md) Phase 1 for design notes and [docs/claude-code-hooks.md](docs/claude-code-hooks.md) for the hook snippets.

### Cursor / other MCP clients

See `docs/mcp-clients.md` for per-client config snippets.

## Connecting a Local LLM (Broker Setup)

FileScopeMCP runs a broker that queues LLM work (file summarization, change analysis). The broker talks to any OpenAI-compatible HTTP endpoint. Most agent runtimes already have a local LLM running — point the broker at the same endpoint and you avoid running two LLM servers.

The broker reads `~/.filescope/broker.json` (created automatically on first run from `broker.default.json`). Schema:

```json
{
  "llm": {
    "provider": "openai-compatible",
    "model": "llm-model",
    "baseURL": "http://localhost:8880/v1",
    "maxTokensPerCall": 1024
  },
  "jobTimeoutMs": 300000,
  "maxQueueSize": 1000
}
```

Set `baseURL` to wherever the LLM is listening, and `model` to whatever alias the server expects (check `/v1/models` if you're not sure). The broker handles queuing and prioritization — interactive tool calls beat background summarization, and it will not flood the LLM with hundreds of concurrent requests.

If `~/.filescope/broker.json` does not exist yet, copy a template:

```bash
mkdir -p ~/.filescope
cp broker.default.json ~/.filescope/broker.json
```

Then edit `baseURL` and `model` to match the runtime's LLM. Verify with `status()` — it reports broker connection state.

### Default: Linux-native (Hermes on Ubuntu)

This is the deployment FileScopeMCP is primarily designed for: agent runtime and llama-server on the same Ubuntu host, broker talking to `localhost`.

Typical Hermes setup already has llama-server bound to `127.0.0.1:8880` with model alias `llm-model` (Hermes uses it as `fallback_model` in `config.yaml`). The default broker template (`broker.default.json`) is configured for exactly this — copy it as-is:

```bash
cp broker.default.json ~/.filescope/broker.json
```

No edits needed if the runtime's llama-server is on `localhost:8880` with alias `llm-model`. To stand up a fresh llama-server, run `./setup-llm.sh` for a platform-aware install guide.

### Alternative: Remote LLM on the LAN

If the LLM runs on a separate machine reachable over the LAN (dedicated GPU box, etc.), use `broker.remote-lan.json` and edit the IP:

```bash
cp broker.remote-lan.json ~/.filescope/broker.json
# then edit baseURL to "http://<lan-ip>:8880/v1"
```

### Alternative: WSL2 with llama-server on the Windows host

Legacy setup for users running FileScopeMCP inside WSL2 with a GPU-equipped Windows host. WSL2 does not give native GPU access to llama.cpp, so llama-server runs on Windows and the broker bridges across the WSL2 boundary.

```bash
cp broker.windows-host.json ~/.filescope/broker.json
```

`broker.windows-host.json` uses the literal placeholder `wsl-host` in `baseURL`. At broker startup, `src/broker/config.ts` runs `ip route show default | awk '{print $3}'` and rewrites the placeholder to the actual Windows host gateway IP in memory — no manual editing needed in 99% of cases. See `docs/llm-setup.md` for the full Windows-side setup (firewall rule, llama-server install, model selection).

This path is *not* the default. If running on a native Linux host (including Hermes on Ubuntu), use `broker.default.json` instead.

## Skill File for Tool Usage

For tool-call patterns and workflows, install the FileScopeMCP skill from `skills/filescope-mcp/SKILL.md`. It documents every MCP tool with examples and lists common workflows ("what calls this function?", "where should I add this feature?", "what changed since last session?").

Hermes auto-discovers skills under `~/.hermes/skills/<category>/<name>/SKILL.md`. Symlink or copy:

```bash
ln -s /home/user/dev/FileScopeMCP/skills/filescope-mcp ~/.hermes/skills/filescope-mcp/filescope-mcp
```

(Adjust the destination to match the host's Hermes skills layout.)

## If You Are Working ON This Codebase

### Architecture

```
src/
  mcp-server.ts        — MCP protocol handler, tool registration, stdio transport
  coordinator.ts       — central orchestrator: init, scanning, file events, change classification, cascade, broker lifecycle
  language-config.ts   — per-language extractor dispatch: AST (tree-sitter) for TS/JS, Python, C, C++, Rust; regex for Go, Ruby, Lua, Zig, PHP, C#, Java
  file-watcher.ts      — chokidar wrapper with debounced events and crash auto-restart
  change-detector/     — semantic change classification (AST diff for TS/JS via tree-sitter, LLM-powered diff for everything else)
  cascade/             — BFS staleness propagation across the dependency graph (depth-limited, payload-bounded)
  broker/              — LLM job queue (priority heap with dedup, Unix socket IPC, multi-provider HTTP via the `ai` SDK)
  nexus/               — Fastify web dashboard (localhost:1234), cross-repo aggregation, log SSE
  db/                  — Drizzle ORM over better-sqlite3 (WAL mode); schema, repository, and migrations
```

The `broker/` module must NOT import from `nexus/`. (Nexus reads broker config, stats, and types to surface LLM activity in the dashboard — the dependency is one-directional.)

### Build and Run

```bash
./build.sh          # npm install + tsc + register with Claude Code
./run.sh            # launch manually (build.sh generates this)
```

`./build.sh` flags relevant to agent installs:
- `--agent` — skip Claude Code registration (agent runtimes register their own way via `mcp_servers`)
- `--skip-register` — skip just the registration step
- `--prefix=/path` — install into a non-cwd location
- `--check-only` — verify prerequisites without installing
- `--no-wsl` — suppress the "project is on /mnt/ — use WSL native FS for speed" warning
- `--legacy-npm` — pass `--legacy-peer-deps` to npm install for older registries

### LLM Backend

FileScopeMCP uses a local LLM via llama.cpp's llama-server (or any OpenAI-compatible endpoint) for background summarization. The broker connects over HTTP to `/v1/chat/completions`. Default: port 8880, model alias `llm-model`.

Setup: `./setup-llm.sh` (prints platform-specific instructions including the WSL2+Windows alternative). Status: `./setup-llm.sh --status`.

### Path Storage (host-portable layout)

The SQLite DB stores **paths relative to `projectRoot`**, but the public API
(MCP tools, repository.ts exports) deals in **absolute** paths. Translation
happens at a single chokepoint inside `repository.ts`. This makes a
`.filescope/` directory survive being rsync'd or moved between hosts —
expensive LLM-generated content (summary, concepts, change_impact) is
preserved across path changes that would otherwise trigger a wipe-and-rescan.

**Invariant**: `coordinator.init(projectRoot)` calls
`setRepoProjectRoot(projectRoot)` once. From that point, repository.ts
relativizes inputs and absolutifies outputs at every SQL site. Outside
repository.ts, all code dealing with paths uses absolute form.

**Bypass escape hatch**: two call sites issue raw SQL against path
columns instead of going through repository.ts and import
`toStoredPath` from `db/repository.js` to translate at the boundary:
`cascade/cascade-engine.ts` `markSelfStale` and `mcp-server.ts`
`get_file_summary` LLM-data lookup. Keep this surface tiny.

`nexus/repo-store.ts` does not need a translation helper because the
DB stores paths in the same relative form the dashboard already
queries with — its raw SQL is intentional and benign.

**Format guard**: `coordinator.init()` writes / verifies
`kv_state['paths_format'] = 'relative_v1'` on first connection. If a
future format bump renders an old DB incompatible, the guard throws with
a clear recovery hint rather than corrupting silently. To recover from
a flagged-mismatch error, delete `.filescope/` and reinit.

### Key Conventions

- TypeScript strict mode, ES modules
- All tools return structured JSON with consistent error codes (`NOT_INITIALIZED`, `NOT_FOUND`, `BROKER_DISCONNECTED`)
- Tool descriptions are the contract — they are what agents read to decide when to call a tool. Write them precisely.
- Tests: `npm test`
- Database: SQLite in `.filescope/` within the target project directory; paths stored relative to `projectRoot` (see Path Storage)
