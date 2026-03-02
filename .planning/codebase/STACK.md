# Technology Stack

**Analysis Date:** 2026-03-02

## Languages

**Primary:**
- TypeScript 5.8.3 - All source code in `src/` directory
- JavaScript - Build output and test execution

**Secondary:**
- Bash - Build and installation scripts (`build.sh`, `install-mcp-claude.sh`)
- Batch - Windows build support (`build.bat`)
- JSON - Configuration and data files

## Runtime

**Environment:**
- Node.js 22 (specified in CI/CD via `.github/workflows/build.yml`)
- ESM (ECMAScript modules) - `"type": "module"` in `package.json`
- Target: ES2020 (configured in `tsconfig.json`)

**Package Manager:**
- npm
- Lockfile: Missing (not committed per `.gitignore`)

## Frameworks

**Core:**
- @modelcontextprotocol/sdk 1.12.0 - MCP server implementation
  - Main integration point: `src/mcp-server.ts`
  - Provides: McpServer, Transport, JSONRPCMessage, stdio utilities

**File Watching:**
- chokidar 3.6.0 - Cross-platform file system watcher
  - Usage: `src/file-watcher.ts` - Monitors file changes for tree updates
  - Handles: add, change, unlink events with debouncing

**Validation & Schema:**
- zod 3.25.28 - Runtime type validation
  - Usage: `src/mcp-server.ts`, `src/config-utils.ts` - Validates tool parameters and config

**Build & Dev:**
- esbuild 0.27.3 - Fast TypeScript bundler
  - Output format: ESM
  - Target: ES2020
  - Builds to: `dist/` directory
  - Command: `npm run build`

**Testing:**
- vitest 3.1.4 - Unit test runner
  - Config: `vitest.config.ts`
  - Environment: Node.js
  - Coverage provider: V8
  - Command: `npm test` (run), `npm run coverage` (with coverage)

**Type Checking:**
- TypeScript 5.8.3 - Strict type checking
  - Config: `tsconfig.json`
  - Compiler options: strict mode enabled, ES2020 target, ESNext module
  - Command: `npm run typecheck`

## Key Dependencies

**Critical:**
- @modelcontextprotocol/sdk 1.12.0 - Defines server architecture, tool system, transport protocol
  - Provides stdio transport for MCP communication
  - Implements JSONRPC message serialization/deserialization

**Infrastructure:**
- chokidar 3.6.0 - File system monitoring
  - Enables real-time tree updates on file changes
  - Implements debouncing (2 seconds) for event coalescence

**Utilities:**
- zod 3.25.28 - Schema validation for tool parameters and configs
- Node.js built-ins: `fs`, `fs/promises`, `path` - File I/O and path handling

## Configuration

**Environment:**
- No `.env` file required - application reads from config.json
- Config location: `config.json` at project root
- Base directory: Configurable per project (defaults in `config.json`)

**Build:**
- Build command in `package.json`: esbuild with specific TypeScript files
- Entry point: `src/mcp-server.ts` compiled to `dist/mcp-server.js`
- TypeScript config: `tsconfig.json` with strict mode and ES2020 target

**Build Scripts:**
- `build.sh` - Linux/macOS build and MCP setup
- `build.bat` - Windows build and MCP setup
- Both scripts: Compile, test, and install MCP server to Claude/etc

## Platform Requirements

**Development:**
- Node.js 22+
- TypeScript 5.8.3
- npm or compatible package manager
- Cross-platform (supports Windows, macOS, Linux via WSL)

**Production:**
- Node.js 22+
- File system access to target project directory
- Integration via MCP stdio protocol
- Deployment: Runs as stdio server for Claude/MCP clients
- Tested on: Windows (CI/CD), macOS, Linux, WSL

---

*Stack analysis: 2026-03-02*
