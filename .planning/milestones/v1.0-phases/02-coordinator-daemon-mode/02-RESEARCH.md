# Phase 2: Coordinator + Daemon Mode - Research

**Researched:** 2026-03-02
**Domain:** TypeScript class extraction, Node.js process lifecycle, daemon patterns
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Coordinator API boundary
- ServerCoordinator is a **class instance** encapsulating all state (fileTree, watcher, mutex, debounce timers) as instance properties
- MCP tools access coordinator via **closure capture**: `registerTools(server, coordinator)` — no global state needed
- Coordinator **owns the SQLite database lifecycle** (openDatabase in init, closeDatabase in shutdown) — single owner for the full lifecycle
- **Drop the in-memory FileNode tree entirely** — all tools query SQLite via repository functions. `list_files` reconstructs from DB on demand. SQLite is the single source of truth

#### Daemon lifecycle
- **PID file guard**: Write `.filescope.pid` in project root on start; check on boot — stale PID overwrites, live process refuses to start. Prevents DB corruption from concurrent writes
- **Graceful shutdown with timeout**: On SIGTERM/SIGINT — stop watcher, wait for in-flight mutations to drain (mutex), close DB, remove PID file, exit 0. Force exit after 5 seconds
- **One project per process**: `node dist/index.js --daemon --base-dir=/path` watches one project. Run multiple terminals for multiple projects
- **`--base-dir` is required with `--daemon`**: Daemon without `--base-dir` is an error. No ambiguity about which project to watch

#### Daemon output & monitoring
- **File-only logging**: Log to `.filescope-daemon.log` in project root. Daemon runs headless — no terminal to read stderr. Log rotation by size (truncate at 10MB)
- **Summary log level**: Log startup, shutdown, integrity sweep results, and errors. Individual file events only at debug level. Keeps logs readable for 24/7 operation
- **Brief startup banner to stdout**: Print one line on start: "FileScopeMCP daemon started — watching /path/to/project (PID 12345)". Then go silent
- **No heartbeat**: Only log on events. If nothing happens, log stays quiet

#### Entry point structure
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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STOR-05 | Coordinator logic is extracted from mcp-server.ts into a standalone module that can run without MCP transport | Class extraction patterns, coordinator API design, module boundary analysis of existing mcp-server.ts |
| STOR-06 | System can run as a standalone daemon via `--daemon` flag, watching and maintaining metadata 24/7 without an MCP client connected | Node.js daemon lifecycle, PID file implementation, signal handling, headless file logging |
| COMPAT-03 | System functions correctly with no LLM configured — file tree, dependencies, importance, and watching all work as before | Coordinator correctly delegates to existing repository/watcher/file-utils without LLM dependency |
</phase_requirements>

## Summary

Phase 2 is a **pure refactoring + feature-addition phase**: no new algorithmic logic is introduced. The work is to extract module-level state and functions from `mcp-server.ts` into a `ServerCoordinator` class (`src/coordinator.ts`), then wire a `--daemon` flag path through the single entry point that starts the coordinator without MCP transport. The SQLite layer (Phase 1) is already the source of truth, so the in-memory `FileNode` tree can be fully dropped — tools that needed it now query the repository directly.

The existing code is well-understood: `mcp-server.ts` is 1169 lines with a clear separation between orchestration functions (lines 50–606) and tool registrations (lines 686–1153). The extraction boundary is unambiguous — everything before the tool registrations moves to `coordinator.ts`. The `AsyncMutex`, debounce timers, `integritySweepInterval`, `fileTree`, `currentConfig`, `fileWatcher` module-level variables, and the functions `initializeProject`, `initializeServer`, `initializeFileWatcher`, `handleFileEvent`, `startIntegritySweep`, `buildFileTree`, and `reconstructTreeFromDb` are the coordinator's body.

The daemon mode implementation is a well-understood Node.js pattern: PID file guard + SIGTERM/SIGINT handlers + graceful shutdown with a forced exit timeout. The file-only logging requirement is a minor extension to `logger.ts` (add a size-checked `appendFileSync` path). COMPAT-03 is satisfied automatically — the coordinator relies only on `repository.ts`, `file-watcher.ts`, `file-utils.ts`, and `logger.ts`, none of which have LLM dependencies.

**Primary recommendation:** Extract coordinator as a class first (no behavior changes), verify MCP mode is identical, then add daemon entry path and PID/logging.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.8.3 (in project) | Type-safe class extraction | Already in use; class syntax fully supported |
| Node.js built-ins (`fs`, `path`, `process`) | Node 22 (project target) | PID file, signal handling, log rotation | No external dep needed for daemon primitives |
| better-sqlite3 | ^12.6.2 (in project) | SQLite lifecycle (open/close) owned by coordinator | Already in use via db.ts |
| chokidar | ^3.6.0 (in project) | File watching — owned by coordinator via FileWatcher | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.1.4 (in project) | Unit tests for coordinator | Wave 0 test file for coordinator init/shutdown |
| esbuild | ^0.27.3 (in project) | Build — add `src/coordinator.ts` to build command | At build step |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom PID file (fs.writeFileSync) | `pidfile-graceful` npm package | Custom is 15 lines of code vs. a dependency — no need for a package here |
| Truncate-at-size log rotation | `winston` or `pino` rolling file transport | Overkill for this use case; the decision is locked to simple truncation |
| Class instance | Module singleton | Class instance required by locked decision; closure capture is cleaner for testing |

**Installation:** No new packages required. All needed libraries are already installed.

---

## Architecture Patterns

### Recommended Project Structure
```
src/
├── coordinator.ts        # NEW: ServerCoordinator class — all orchestration
├── mcp-server.ts         # SHRUNK: McpServer, tool registrations, StdioTransport, entry point
├── file-watcher.ts       # UNCHANGED: FileWatcher (already clean abstraction)
├── logger.ts             # EXTENDED: add enableDaemonFileLogging(path) for file-only mode
├── global-state.ts       # UNCHANGED: still needed for getProjectRoot/setProjectRoot
├── db/
│   ├── db.ts             # UNCHANGED: openDatabase/closeDatabase
│   └── repository.ts     # UNCHANGED: CRUD layer
└── ...
```

### Pattern 1: Class Extraction (State Encapsulation)

**What:** Move module-level `let` variables and the functions that operate on them into a class. The class constructor receives no arguments; `init(projectPath)` does the async work.

**When to use:** When module-level state needs to be owned by a single entity and shared across multiple consumers (MCP tools, daemon loop) without global state.

**Example:**
```typescript
// src/coordinator.ts
export class ServerCoordinator {
  private fileTree: FileNode | null = null;
  private currentConfig: FileTreeConfig | null = null;
  private fileWatcher: FileWatcher | null = null;
  private treeMutex = new AsyncMutex();
  private fileEventDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private integritySweepInterval: NodeJS.Timeout | null = null;
  private db: { db: DrizzleDb; sqlite: any } | null = null;

  async init(projectPath: string): Promise<ToolResponse> {
    // Extracted body of initializeProject()
  }

  async shutdown(): Promise<void> {
    // Stop watcher, drain mutex, close DB, remove PID file
  }

  async handleFileEvent(filePath: string, eventType: FileEventType): Promise<void> {
    // Extracted from handleFileEvent()
  }

  startIntegritySweep(): void {
    // Extracted from startIntegritySweep()
  }

  isInitialized(): boolean {
    return this.fileTree !== null || this.isDbOpen();
  }
}
```

### Pattern 2: Closure Capture for Tool Registration

**What:** Pass the coordinator instance into a `registerTools(server, coordinator)` function. Tool handlers close over `coordinator` — no global variable.

**When to use:** Required by locked decision. Also makes testing straightforward: inject a mock coordinator.

**Example:**
```typescript
// src/mcp-server.ts (after extraction)
import { ServerCoordinator } from './coordinator.js';

const coordinator = new ServerCoordinator();
registerTools(server, coordinator);

function registerTools(server: McpServer, coordinator: ServerCoordinator) {
  server.tool("set_project_path", ..., async (params) => {
    return await coordinator.init(params.path);
  });

  server.tool("list_files", ..., async () => {
    return coordinator.isInitialized()
      ? createMcpResponse(getAllFiles())
      : projectPathNotSetError;
  });
  // ...
}
```

### Pattern 3: PID File Guard

**What:** On startup, write `process.pid` to `.filescope.pid`. On boot, check if the PID file exists and whether that PID is alive (via `process.kill(pid, 0)`). Stale PID (process not running) → overwrite. Live PID → refuse and exit.

**When to use:** Whenever a process writes to a resource (SQLite DB) that cannot safely handle concurrent writers.

**Example:**
```typescript
// src/coordinator.ts
private async acquirePidFile(projectRoot: string): Promise<void> {
  const pidPath = path.join(projectRoot, '.filescope.pid');
  try {
    const existing = await fs.readFile(pidPath, 'utf-8');
    const existingPid = parseInt(existing.trim(), 10);
    if (!isNaN(existingPid)) {
      try {
        process.kill(existingPid, 0); // throws if process not running
        throw new Error(
          `FileScopeMCP daemon already running (PID ${existingPid}). ` +
          `Stop it first or delete ${pidPath}.`
        );
      } catch (e: any) {
        if (e.code !== 'ESRCH') throw e; // re-throw if not "no such process"
        // ESRCH = stale PID, fall through to overwrite
        log(`Stale PID file found (PID ${existingPid} not running). Overwriting.`);
      }
    }
  } catch (e: any) {
    if (e.code !== 'ENOENT') throw e; // re-throw unless file simply doesn't exist
  }
  await fs.writeFile(pidPath, String(process.pid), 'utf-8');
}

private async releasePidFile(projectRoot: string): Promise<void> {
  const pidPath = path.join(projectRoot, '.filescope.pid');
  try { await fs.unlink(pidPath); } catch { /* already gone */ }
}
```

### Pattern 4: Graceful Shutdown with Force-Exit Timeout

**What:** Register SIGTERM and SIGINT handlers. Call `coordinator.shutdown()` which: (1) stops watcher, (2) waits for treeMutex to drain (in-flight operations complete), (3) closes DB, (4) removes PID file. Force exit after 5 seconds if shutdown hangs.

**Example:**
```typescript
// In entry point (mcp-server.ts)
async function gracefulShutdown(coordinator: ServerCoordinator, signal: string) {
  log(`Received ${signal}. Shutting down...`);
  const forceExit = setTimeout(() => {
    log('Force exit: shutdown timed out after 5s');
    process.exit(1);
  }, 5000);
  forceExit.unref(); // Don't keep the event loop alive for this timer

  try {
    await coordinator.shutdown();
    log('Shutdown complete.');
    process.exit(0);
  } catch (err) {
    log(`Shutdown error: ${err}`);
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown(coordinator, 'SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown(coordinator, 'SIGINT'));
```

### Pattern 5: Daemon Entry Branch

**What:** In `mcp-server.ts`, detect `--daemon` flag before the main IIFE. If daemon: init coordinator, register signals, print banner, keep alive. If not: wire MCP server and transport as today.

**Example:**
```typescript
// src/mcp-server.ts (entry point bottom)
(async () => {
  const isDaemon = process.argv.includes('--daemon');
  const baseDirArg = process.argv.find(a => a.startsWith('--base-dir='));

  if (isDaemon) {
    if (!baseDirArg) {
      process.stderr.write('Error: --daemon requires --base-dir=<path>\n');
      process.exit(1);
    }
    const projectPath = baseDirArg.split('=')[1];
    const coordinator = new ServerCoordinator();
    await coordinator.init(projectPath);
    // Banner (stdout, then silent)
    process.stdout.write(`FileScopeMCP daemon started — watching ${projectPath} (PID ${process.pid})\n`);
    // Signals
    process.on('SIGTERM', () => gracefulShutdown(coordinator, 'SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown(coordinator, 'SIGINT'));
    // Keep alive — chokidar's persistent:true keeps the event loop going
    // No explicit setInterval needed
  } else {
    const coordinator = new ServerCoordinator();
    await coordinator.initServer(); // equivalent to initializeServer()
    registerTools(server, coordinator);
    process.on('SIGTERM', () => gracefulShutdown(coordinator, 'SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown(coordinator, 'SIGINT'));
    const transport = new StdioTransport();
    await server.connect(transport);
  }
})();
```

### Pattern 6: File-Only Logging for Daemon Mode

**What:** Extend `logger.ts` with an `enableDaemonFileLogging(logPath)` function that sets file-only mode (no `console.error`). Add size check before append: if file > 10MB, truncate to empty before writing.

**Example:**
```typescript
// src/logger.ts (extension)
let daemonMode = false;
const LOG_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export function enableDaemonFileLogging(logPath: string): void {
  logToFile = true;
  daemonMode = true;
  logFilePath = logPath;
}

export function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (!daemonMode) {
    console.error(line.trimEnd());
  }
  if (logToFile) {
    try {
      const stat = fs.statSync(logFilePath);
      if (stat.size > LOG_MAX_SIZE) {
        fs.writeFileSync(logFilePath, ''); // truncate
      }
    } catch { /* file doesn't exist yet — fine */ }
    fs.appendFileSync(logFilePath, line, 'utf-8');
  }
}
```

### Pattern 7: Drop In-Memory FileNode Tree

**What:** Remove the `fileTree: FileNode | null` instance property once all callers that read from it are redirected to repository functions. The `list_files` tool returns `getAllFiles()` (flat array or reconstructed tree). The `isProjectPathSet()` guard checks whether the DB is open and has rows rather than `fileTree !== null`.

**Implication:** `findNode()` and `getAllFileNodes()` (tree traversal utilities) become dead code and can be deleted. `reconstructTreeFromDb()` is needed only if `list_files` must return a nested tree — if the locked decision allows returning a flat array from `getAllFiles()`, it can also be deleted. If the tool contract requires a nested tree shape, move `reconstructTreeFromDb` to coordinator as a private method.

**Note on `isInitialized()` guard:** Replace the `fileTree !== null` check with a check that the DB is open and has at least one file row:
```typescript
isInitialized(): boolean {
  try { return getAllFiles().length > 0; } catch { return false; }
}
```
Or simply track a `_initialized: boolean` flag on the coordinator set after `init()` succeeds.

### Anti-Patterns to Avoid

- **Keeping module-level `let` variables alongside the class:** The goal is zero module-level mutable state in `mcp-server.ts`. If any `let` remains in mcp-server.ts pointing at coordinator state, the extraction is incomplete.
- **Two-phase extraction (class + move to separate file in separate PRs):** Do the full extraction in one go — partial extraction leaves inconsistent import graphs that TypeScript will flag as circular.
- **Calling `process.chdir()` in the coordinator:** This call appears in `initializeProject()` (line 104). It must stay or be evaluated carefully — it changes the CWD for the whole process and was originally needed because some path resolution was CWD-relative. With SQLite-only storage, verify whether `process.chdir()` is still needed (likely not, since `MIGRATIONS_DIR` is resolved at module load time and repository functions use absolute paths).
- **Forgetting to add `coordinator.ts` to the esbuild build command:** The current build command lists every source file explicitly (`src/mcp-server.ts src/storage-utils.ts ...`). Adding a new file requires updating `package.json` scripts.
- **Signal handlers registered in MCP mode that block stdin:** In MCP mode, SIGINT might come from the MCP host. Ensure the shutdown path doesn't interfere with the stdio transport teardown sequence.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Checking if a PID is alive | Custom `/proc` parsing | `process.kill(pid, 0)` | Cross-platform, raises ESRCH if no process, EPERM if no permission (still alive) |
| Async serialization of mutations | Custom promise queue | The existing `AsyncMutex` class (mcp-server.ts:50-59) | Already implemented and battle-tested in Phase 1 |
| File watching | Custom `fs.watch` wrapper | `chokidar` (already in FileWatcher) | chokidar handles macOS FSEvents, Linux inotify, Windows IOCP, debouncing, recursion |
| Log rotation | Custom rolling file with timestamps | Simple truncate-at-size per locked decision | 15 lines of code, no moving parts |

**Key insight:** All "infrastructure" needed for this phase already exists in the codebase. This is an extraction and wiring task, not a build task.

---

## Common Pitfalls

### Pitfall 1: `process.chdir()` Breaking Path Resolution After Extraction
**What goes wrong:** `initializeProject()` calls `process.chdir(projectRoot)` (line 104). If this call is preserved in coordinator, the process CWD changes on every `set_project_path` call. After extraction, other path resolutions in the same process might rely on CWD.
**Why it happens:** The original code used CWD-relative paths in some storage utilities. Phase 1 moved to absolute paths, so the `chdir` may now be vestigial.
**How to avoid:** Audit all `process.cwd()` calls in the codebase after extraction. If none remain (all paths are absolute from `projectRoot`), remove `process.chdir()`. If it must stay, document why explicitly.
**Warning signs:** Tests that change `process.cwd()` failing intermittently; `path.join(process.cwd(), ...)` appearing in non-test code after extraction.

### Pitfall 2: MutEx Chain Not Draining on Shutdown
**What goes wrong:** Shutdown calls `fileWatcher.stop()` then immediately `closeDatabase()`. But there may be debounce timers that fire _after_ watcher.stop() and attempt to acquire the mutex and write to the (now closed) DB.
**Why it happens:** `fileWatcher.stop()` is async (close returns a promise), but debounce timers are `setTimeout` callbacks — they are already scheduled and will fire even after the watcher stops.
**How to avoid:** In `shutdown()`: (1) clear all `fileEventDebounceTimers` entries before stopping the watcher — cancel pending debounce timers with `clearTimeout`. (2) Then stop the watcher. (3) Then wait for the mutex queue to drain (the queue is just `this._queue`, which resolves when all running tasks complete). (4) Then close the DB.
**Warning signs:** `"Database not initialized"` errors in logs during shutdown.

```typescript
async shutdown(): Promise<void> {
  // 1. Clear pending debounce timers (prevent new mutex acquisitions)
  for (const timer of this.fileEventDebounceTimers.values()) clearTimeout(timer);
  this.fileEventDebounceTimers.clear();

  // 2. Stop integrity sweep
  if (this.integritySweepInterval) clearInterval(this.integritySweepInterval);

  // 3. Stop watcher
  if (this.fileWatcher) this.fileWatcher.stop();

  // 4. Drain mutex (wait for any in-flight mutation to complete)
  await this.treeMutex.run(async () => {}); // enqueue a no-op; when it runs, queue is empty

  // 5. Close DB
  closeDatabase();

  // 6. Release PID file
  if (this._projectRoot) await this.releasePidFile(this._projectRoot);
}
```

### Pitfall 3: `isProjectPathSet()` Guard Fails After Dropping `fileTree`
**What goes wrong:** `isProjectPathSet()` returns `fileTree !== null`. After dropping the in-memory tree, it always returns `false` and every tool call returns the "project path not set" error.
**Why it happens:** The guard is tied to the old state field.
**How to avoid:** Replace with `coordinator.isInitialized()` that checks a `_initialized: boolean` flag set to `true` after `init()` completes successfully.
**Warning signs:** All tool calls returning `"Project path not set"` immediately after extraction even though `set_project_path` was called.

### Pitfall 4: esbuild Build Command Not Updated
**What goes wrong:** `src/coordinator.ts` is not bundled — running `node dist/mcp-server.js` fails with `Cannot find module './coordinator.js'`.
**Why it happens:** The `build` script in `package.json` lists each file explicitly.
**How to avoid:** Add `src/coordinator.ts` to the esbuild entry points list in `package.json` `scripts.build`.
**Warning signs:** Build succeeds but runtime import fails.

### Pitfall 5: PID File Left Behind on Crash
**What goes wrong:** If the daemon crashes (unhandled exception, OOM kill, SIGKILL), the PID file is not cleaned up. Next start sees the stale PID, tries `process.kill(pid, 0)`, gets ESRCH, and overwrites — this is the desired behavior. But if the PID is reused by another process, the check incorrectly thinks the daemon is running.
**Why it happens:** OS PID reuse. Rare in practice for long-running daemons.
**How to avoid:** The locked decision already handles this: stale PID (process not running per ESRCH) → overwrite. This is correct behavior. Document that SIGKILL will leave a stale PID file and next start will clean it up automatically.
**Warning signs:** Spurious "daemon already running" errors when no daemon is actually running (very rare PID reuse scenario).

### Pitfall 6: `reconstructTreeFromDb` Needed by `list_files` Tool
**What goes wrong:** The `list_files` tool currently returns `fileTree` (the nested `FileNode` tree). After dropping the in-memory tree, there is nothing to return. If callers of `list_files` expect a nested tree shape, the tool must call `reconstructTreeFromDb` before returning.
**Why it happens:** The existing tool API returns the full nested tree. The repository only has `getAllFiles()` (flat list).
**How to avoid:** Decide the return shape: flat array (simpler, no in-memory tree needed) or nested tree (requires keeping `reconstructTreeFromDb` as a utility). The locked decision says "SQLite is the single source of truth" and tools "query SQLite via repository functions" — flat list is acceptable. But the MCP tool contract (COMPAT-01, already satisfied) must not change. Check what `list_files` currently returns — it returns the nested `FileNode` tree. If the tool contract is `fileTree` shape, keep `reconstructTreeFromDb` as a utility function (not on coordinator). If it can change to a flat array, simplify.
**Warning signs:** LLM clients that call `list_files` getting back a flat array when they expect a nested structure (breaking COMPAT-01 retroactively).

---

## Code Examples

Verified patterns from codebase inspection:

### Current Module-Level State (to become instance properties)
```typescript
// src/mcp-server.ts lines 50-82 — these all move to coordinator as instance props
class AsyncMutex { ... }                              // → coordinator private class or import
let fileTree: FileNode | null = null;                 // → private fileTree: FileNode | null = null
let currentConfig: FileTreeConfig | null = null;      // → private currentConfig: ...
let fileWatcher: FileWatcher | null = null;           // → private fileWatcher: ...
const treeMutex = new AsyncMutex();                   // → private treeMutex = new AsyncMutex()
const fileEventDebounceTimers: Map<...> = new Map();  // → private fileEventDebounceTimers = new Map()
let integritySweepInterval: NodeJS.Timeout | null;   // → private integritySweepInterval: ...
```

### Functions to Move to Coordinator (verbatim, as methods)
```typescript
// Lines 89-150: initializeProject → coordinator.init()
// Lines 153-176: initializeServer → coordinator.initServer()
// Lines 181-204: initializeFileWatcher → coordinator.initFileWatcher() [private]
// Lines 211-276: handleFileEvent → coordinator.handleFileEvent() [private]
// Lines 282-324: startIntegritySweep → coordinator.startIntegritySweep() [private]
// Lines 504-606: buildFileTree → coordinator.buildFileTree() [private]
// Lines 612-651: reconstructTreeFromDb → coordinator.reconstructTreeFromDb() [private] or utility
```

### Functions That Stay in mcp-server.ts
```typescript
// Lines 329-401: StdioTransport — stays (per Claude's discretion, keep in mcp-server.ts)
// Lines 404-436: createMcpResponse — stays (pure helper, used by tool registrations)
// Lines 439-502: findNode, getAllFileNodes — DELETE after tree removal
// Lines 664-683: server creation, isProjectPathSet guard → replace guard with coordinator.isInitialized()
// Lines 686-1153: All server.tool() registrations — stay, rewritten to call coordinator methods
// Lines 1155-1168: Entry IIFE — stays, extended with --daemon branch
```

### Process.kill(pid, 0) for Liveness Check
```typescript
// Node.js built-in — signals: 0 does not send a signal, just checks process existence
// Throws ESRCH if process not found, EPERM if no permission (process exists)
try {
  process.kill(existingPid, 0);
  // process is alive
} catch (e: any) {
  if (e.code === 'ESRCH') {
    // process not running — stale PID
  } else {
    throw e; // EPERM or other — process exists
  }
}
```

### chokidar `persistent: true` Keeps Daemon Alive
```typescript
// src/file-watcher.ts line 57
persistent: true,
// This is already set in FileWatcher.start(). When the daemon branches without
// MCP transport, the chokidar watcher's persistent:true reference keeps the
// Node.js event loop from exiting. No additional setInterval/keepalive needed.
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Module-level `let` variables | Class instance properties | This phase | Testable, no global state |
| In-memory FileNode tree as source of truth | SQLite as source of truth | Phase 1 (complete) → fully dropped Phase 2 | Enables daemon (no memory state to rebuild) |
| MCP-only operation | MCP + daemon mode | This phase | 24/7 background watching |

**Deprecated/outdated:**
- `fileTree: FileNode | null` module variable: replaced by coordinator instance property, then dropped
- `saveFileTree()` from `storage-utils.ts`: was the JSON save path, still used in `buildFileTree` for initial bulk upsert — verify whether it's still needed or replaced by direct repository calls
- `loadFileTree()` from `storage-utils.ts`: verify if still needed after coordinator takes over DB lifecycle
- `findNode()` and `getAllFileNodes()`: dead code after in-memory tree removal

---

## Open Questions

1. **Does `list_files` need to return a nested tree or can it return a flat array?**
   - What we know: The tool currently returns `fileTree` (nested). COMPAT-01 says "tool names, parameter schemas, and response shapes remain identical." COMPAT-01 was satisfied in Phase 1 — this is about Phase 2.
   - What's unclear: Was the nested tree shape part of the tested contract, or was it "best effort"? Changing to flat array would simplify the coordinator significantly (no `reconstructTreeFromDb` needed).
   - Recommendation: Keep `reconstructTreeFromDb` as a private coordinator method to preserve the nested shape. This is the safest path to not breaking existing clients. The function is 40 lines and already correct.

2. **Does `process.chdir()` need to stay in `coordinator.init()`?**
   - What we know: It was added to make CWD-relative paths work. Phase 1 moved all path handling to absolute paths using `projectRoot`. `MIGRATIONS_DIR` in db.ts is resolved at module load time (immune to chdir). Repository functions use absolute paths.
   - What's unclear: Are there any remaining CWD-relative path usages after Phase 1?
   - Recommendation: Audit with `grep -r 'process.cwd()' src/` before deciding. If no remaining usages, remove `process.chdir()` from coordinator.init() — it changes process-global state unnecessarily.

3. **Should `AsyncMutex` be a named export from coordinator.ts or stay as a private inner class?**
   - What we know: It's currently a module-private class in mcp-server.ts. Only the coordinator uses it.
   - Recommendation: Keep it as a module-private class inside coordinator.ts (not exported). No other module needs it. If tests want to test mutex behavior, they test it indirectly through coordinator methods.

---

## Sources

### Primary (HIGH confidence)
- Direct inspection of `/home/autopcap/FileScopeMCP/src/mcp-server.ts` (1169 lines) — full code read
- Direct inspection of `/home/autopcap/FileScopeMCP/src/file-watcher.ts` — chokidar `persistent: true` confirmed
- Direct inspection of `/home/autopcap/FileScopeMCP/src/db/db.ts` — database lifecycle API confirmed
- Direct inspection of `/home/autopcap/FileScopeMCP/src/logger.ts` — current logging API confirmed
- Direct inspection of `/home/autopcap/FileScopeMCP/package.json` — stack versions, build command confirmed
- Direct inspection of `/home/autopcap/FileScopeMCP/vitest.config.ts` — test framework confirmed
- Node.js docs: `process.kill(pid, 0)` liveness check — well-established Node.js API

### Secondary (MEDIUM confidence)
- Node.js daemon patterns: PID file guard + graceful shutdown with force-exit timeout is the standard pattern for Node.js daemons, verified by project decision alignment

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, no new deps needed
- Architecture: HIGH — extraction boundary is explicit from code line numbers, patterns are standard Node.js
- Pitfalls: HIGH — derived from direct code inspection and established Node.js daemon patterns

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (stable codebase, no fast-moving dependencies in scope)
