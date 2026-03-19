# Phase 2: Coordinator + Daemon Mode - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract coordinator logic from mcp-server.ts into a standalone ServerCoordinator class that owns lifecycle, watcher init, and event routing. Enable standalone daemon operation via `--daemon` flag so the system can run 24/7 without an MCP client connected. After extraction, mcp-server.ts is a thin tool-surface layer delegating all orchestration to coordinator.ts.

</domain>

<decisions>
## Implementation Decisions

### Coordinator API boundary
- ServerCoordinator is a **class instance** encapsulating all state (fileTree, watcher, mutex, debounce timers) as instance properties
- MCP tools access coordinator via **closure capture**: `registerTools(server, coordinator)` — no global state needed
- Coordinator **owns the SQLite database lifecycle** (openDatabase in init, closeDatabase in shutdown) — single owner for the full lifecycle
- **Drop the in-memory FileNode tree entirely** — all tools query SQLite via repository functions. `list_files` reconstructs from DB on demand. SQLite is the single source of truth

### Daemon lifecycle
- **PID file guard**: Write `.filescope.pid` in project root on start; check on boot — stale PID overwrites, live process refuses to start. Prevents DB corruption from concurrent writes
- **Graceful shutdown with timeout**: On SIGTERM/SIGINT — stop watcher, wait for in-flight mutations to drain (mutex), close DB, remove PID file, exit 0. Force exit after 5 seconds
- **One project per process**: `node dist/index.js --daemon --base-dir=/path` watches one project. Run multiple terminals for multiple projects
- **`--base-dir` is required with `--daemon`**: Daemon without `--base-dir` is an error. No ambiguity about which project to watch

### Daemon output & monitoring
- **File-only logging**: Log to `.filescope-daemon.log` in project root. Daemon runs headless — no terminal to read stderr. Log rotation by size (truncate at 10MB)
- **Summary log level**: Log startup, shutdown, integrity sweep results, and errors. Individual file events only at debug level. Keeps logs readable for 24/7 operation
- **Brief startup banner to stdout**: Print one line on start: "FileScopeMCP daemon started — watching /path/to/project (PID 12345)". Then go silent
- **No heartbeat**: Only log on events. If nothing happens, log stays quiet

### Entry point structure
- **Single entry file with `--daemon` flag**: `src/mcp-server.ts` checks `--daemon` flag. If daemon: create coordinator, run standalone. If not: create coordinator, wire MCP server + transport. One build target
- **mcp-server.ts becomes tool registrations only** (~300 lines): McpServer creation, tool registrations calling coordinator methods, transport setup. All orchestration, state, and lifecycle live in coordinator.ts
- **Single file coordinator**: `src/coordinator.ts` — one file with the ServerCoordinator class (~400-500 lines of extracted logic)
- **Same lifecycle in both modes**: Both MCP and daemon modes get PID file + graceful shutdown. Consistent behavior regardless of mode

### Claude's Discretion
- Exact method signatures on ServerCoordinator class
- How to handle the `reconstructTreeFromDb` function (move to coordinator or keep as utility)
- Internal mutex implementation details
- Log file rotation strategy specifics
- StdioTransport class placement (keep in mcp-server.ts or extract)

</decisions>

<specifics>
## Specific Ideas

- The extraction should be a clean separation: coordinator handles "what happens" (lifecycle, events, state), MCP handles "what's exposed" (tools, transport, protocol)
- `findNode()`, `getAllFileNodes()`, and `reconstructTreeFromDb()` are utility functions that may or may not belong on the coordinator — Claude can decide placement based on what produces the cleanest code
- The existing `AsyncMutex` class should move to the coordinator since it serializes coordinator-owned mutations

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `AsyncMutex` class (mcp-server.ts:50-59): Move directly to coordinator — serializes tree mutations
- `FileWatcher` class (src/file-watcher.ts): Already a clean abstraction, coordinator wraps it
- `db/db.ts` openDatabase/closeDatabase: Coordinator will own these calls
- `db/repository.ts`: Full CRUD layer already built — coordinator and tools both call these
- `logger.ts` log/enableFileLogging: Extend for daemon file-only mode

### Established Patterns
- Module-level state pattern (fileTree, currentConfig, etc.) — will be replaced by class instance properties
- Tool registration with Zod schemas — stays in mcp-server.ts
- Debounce timer map for file events — moves to coordinator
- Integrity sweep interval — moves to coordinator

### Integration Points
- `initializeProject()` (mcp-server.ts:89-150): Core init logic moves to coordinator.init()
- `handleFileEvent()` (mcp-server.ts:211-276): Event routing moves to coordinator
- `startIntegritySweep()` (mcp-server.ts:282-324): Periodic maintenance moves to coordinator
- `buildFileTree()` (mcp-server.ts:505-606): Tree building moves to coordinator
- Tool registrations (mcp-server.ts:686-1153): Stay in mcp-server.ts, call coordinator methods
- Entry point IIFE (mcp-server.ts:1156-1168): Replaced by --daemon flag branching logic

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-coordinator-daemon-mode*
*Context gathered: 2026-03-02*
