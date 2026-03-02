# External Integrations

**Analysis Date:** 2026-03-02

## APIs & External Services

**Model Context Protocol (MCP):**
- Claude AI (Claude Code via MCP) - Primary integration target
  - SDK: @modelcontextprotocol/sdk
  - Protocol: stdio-based JSONRPC
  - Configuration files: `mcp.json.linux`, `mcp.json.mac`, `mcp.json.win.txt`, `mcp.json.claude-code`

**No Direct Third-Party APIs:**
- Application does not integrate with external HTTP APIs
- No cloud services (AWS, GCP, Azure) detected
- No authentication services (OAuth, JWT providers) integrated

## Data Storage

**Databases:**
- Not applicable - application uses local file system only

**File Storage:**
- Local filesystem only
- Storage location: Configurable via `config.json` property `baseDirectory`
- File tree persistence: JSON files (e.g., `FileScopeMCP-tree.json`)
- Excluded patterns: Defined in `config.json` (default: `node_modules`, `.git`, `dist`, etc.)

**Caching:**
- In-memory file tree cache via `loadedTrees` map in `src/storage-utils.ts`
- No external caching service (Redis, Memcached, etc.)

## Authentication & Identity

**Auth Provider:**
- Custom/None - No explicit authentication layer
- MCP server communicates via stdio with Claude (implicit trust via local execution)
- Access control: Inherited from MCP client permissions
- Implementation: Stdio transport in `@modelcontextprotocol/sdk`

## Monitoring & Observability

**Error Tracking:**
- Not integrated - No external error tracking service

**Logs:**
- File-based logging via `src/logger.ts`
- Log output: Console (stderr) and optional file (`mcp-debug.log`)
- File logging: Controlled via `enableFileLogging()` function
- Log location: Configurable, defaults to `./mcp-debug.log` in current working directory
- Log lines include ISO 8601 timestamps for all messages

**Debugging:**
- File logging disabled by default (controlled in `src/mcp-server.ts` line 33)
- Can be enabled via `enableFileLogging(true, 'custom-path.log')`

## CI/CD & Deployment

**Hosting:**
- Not a hosted service - Runs locally as stdio server
- Execution context: Claude Code (MCP client) via stdio
- Integration method: Direct process invocation from MCP config

**CI Pipeline:**
- GitHub Actions (`.github/workflows/build.yml`)
- Trigger: Push to main branch, pull requests to main
- Runner: Windows (windows-latest)
- Build steps:
  1. Checkout code
  2. Setup Node.js 22
  3. Execute `build.bat` (install dependencies, compile, test)
  4. Verify build output in `dist/` directory
- Build tool: esbuild (configured in `package.json` build script)

**Build Process:**
- Compilation: esbuild transpiles TypeScript to ES2020 JavaScript
- Output format: ESM (native JavaScript modules)
- Output directory: `dist/`
- Test execution: Vitest (part of build.bat/build.sh)
- TypeScript type checking: Via tsc with --noEmit flag

## Environment Configuration

**Required env vars:**
- None - application uses `config.json` for configuration
- Environment variables can be used in MCP startup (e.g., `--base-dir=${projectRoot}`)

**Secrets location:**
- `.env*` files explicitly excluded via `config.json` `excludePatterns`
- No secrets required for application operation
- MCP config files may reference environment paths (e.g., `mcp.json.linux`)

**Configuration files:**
- `config.json` - Main application configuration
  - `baseDirectory`: Target project root for file tree scanning
  - `excludePatterns`: Glob patterns for excluded files/directories
  - `fileWatching`: Configuration for file system monitoring
  - `version`: Application version

## Webhooks & Callbacks

**Incoming:**
- None - Stateless stdio server, responds to MCP tool calls only
- Tool definitions: Via `server.tool()` in `src/mcp-server.ts`
- Request/response model: JSONRPC over stdio

**Outgoing:**
- None - No outbound network calls
- File watcher callbacks: Internal event handlers for file system changes
- Callback mechanism: `FileEventCallback` type in `src/file-watcher.ts`
- Events: `add`, `change`, `unlink` (chokidar native events)

## MCP Tools Exposed

**Tools implemented in `src/mcp-server.ts`:**
- `initialize_project` - Initialize file tree for a project directory
- `list_saved_trees` - List all previously saved file trees
- `add_exclusion_pattern` - Add glob patterns to exclude
- `remove_file` - Mark file for removal from tree
- `set_file_importance` - Update importance score (0-10)
- `get_file_node` - Retrieve metadata for specific file
- `get_file_tree` - Retrieve entire loaded file tree
- `read_file_content` - Read and return file contents
- `calculate_dependencies` - Analyze package dependencies for files
- `integrity_check` - Validate tree consistency and freshness

---

*Integration audit: 2026-03-02*
