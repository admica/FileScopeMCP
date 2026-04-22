# MCP Client Setup

## Claude Code

Registered automatically by `build.sh`. To re-register without rebuilding:

```bash
npm run register-mcp
```

The server auto-initializes to the current working directory when a Claude Code session starts. Use `set_base_directory` to analyze a different directory:

```
set_base_directory(path: "/path/to/your/project")
```

## Cursor AI

### WSL (Cursor on Windows, FileScopeMCP in WSL)

Build inside WSL, then add to your project's `.cursor/mcp.json`:

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

### Windows Native

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

### macOS / Linux Native

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

## Daemon Mode

Run FileScopeMCP as a standalone background process (no MCP client required):

```bash
node dist/mcp-server.js --daemon --base-dir=/path/to/project
```

Logs go to `.filescope-daemon.log` in the project root. A PID file at `.filescope/instance.pid` prevents concurrent daemons on the same project.
