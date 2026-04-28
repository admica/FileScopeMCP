# Troubleshooting

## Project not initializing

FileScopeMCP auto-initializes to the current working directory when Claude Code starts. For a different directory, call `set_base_directory(path: "/your/project")`. For Cursor AI or daemon mode, pass `--base-dir=/your/project` as a startup argument.

## MCP server not appearing in Claude Code

1. Run `claude mcp list` to check registration
2. If missing, run `npm run register-mcp`
3. Check `~/.claude.json` — it should have a `FileScopeMCP` entry under `mcpServers`
4. Restart Claude Code after registration
5. If working inside the FileScopeMCP repo itself, the committed `.mcp.json` (repo scope) can coexist with the user-scope entry created by `build.sh`. The repo-scope entry uses a relative path (`dist/mcp-server.js`) and only resolves when Claude Code's CWD is the repo root; if the subprocess is spawned elsewhere the server fails silently. Use `claude mcp list` to see what is active, and `claude mcp remove --scope user FileScopeMCP` (or `--scope project`) to disambiguate if both are registered.

## npm install fails on native modules

`better-sqlite3` and `tree-sitter` include native addons. If prebuilt binaries aren't available:

- Linux: `sudo apt install build-essential python3`
- macOS: `xcode-select --install`
- Windows: Install Visual Studio Build Tools with C++ workload

## LLM broker not generating metadata

1. Call `status()` — check `broker.brokerConnected`
2. Check `~/.filescope/broker.log` for connection errors
3. If llama-server is running locally: `curl http://localhost:8880/v1/models`
4. Check `~/.filescope/broker.json` — `baseURL` and `model` must be correct
5. Run `./setup-llm.sh --status` to verify llama-server reachability

For the WSL2 + Windows alternative setup, see the troubleshooting section in [llm-setup.md](llm-setup.md#wsl--windows-troubleshooting).

## Stale PID file ("daemon already running" error)

```bash
cat /path/to/project/.filescope/instance.pid
kill -0 <PID> 2>/dev/null && echo "Running" || echo "Stale"

# If stale:
rm /path/to/project/.filescope/instance.pid
```

## Database corruption

```bash
rm /path/to/project/.filescope/data.db
rm -f /path/to/project/.filescope/data.db-wal
rm -f /path/to/project/.filescope/data.db-shm
```

The database is rebuilt from scratch on next startup.

## Log file locations

| File | When active | Location |
|------|-------------|----------|
| `~/.filescope/broker.log` | Always (broker process) | Global directory |
| `.filescope-daemon.log` | Daemon mode | Project root |
| `.filescope/mcp-server.log` | MCP server mode | Global directory (`~/.filescope/`) |
