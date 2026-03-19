# Phase 6: Verification & Tech Debt Cleanup - Research

**Researched:** 2026-03-18
**Domain:** Internal verification, TypeScript refactoring, logger extension
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Verification depth:**
- Run existing tests, capture results as evidence. Add targeted integration tests only where gaps exist.
- VERIFICATION.md references test file:line and test name per requirement — no output snapshots (references stay stable, output goes stale).
- If a requirement has no existing test coverage, write a minimal focused integration test to fill the gap. One test per gap.
- Auto-mark requirements complete: if tests pass, mark the requirement as verified in VERIFICATION.md and update REQUIREMENTS.md traceability. No manual sign-off ceremony.

**Console.error scope:**
- Fix all four files with console.error bypass, not just the two listed in success criteria: storage-utils.ts, global-state.ts, file-watcher.ts, config-utils.ts.
- Convert to proper log levels: errors to logger.error(), lifecycle events to logger.info(), debug noise (path resolution, config dumps) to logger.debug().
- Extend the logger module with error(), warn(), info(), debug() methods. debug() suppressed in daemon mode, error() always shown. Minimal addition (~20 lines).

**DB lifecycle:**
- Coordinator owns the DB lifecycle — opens DB once during init, runs migration if needed, then proceeds.
- Migration becomes a function that receives an open DB handle rather than opening its own connection. Single owner, single lifecycle.
- Migration detects "already migrated" state and skips. Check if SQLite already has data; if yes, no-op. Safe for restarts and re-runs.

### Claude's Discretion
- Exact log level assignment per console.error call (which are debug vs info vs error)
- Test structure for gap-filling integration tests
- VERIFICATION.md formatting and section layout

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STOR-01 | System stores all file metadata in SQLite instead of JSON, with non-breaking migration for existing users | Phase 1 implemented: coordinator.test.ts test "init() opens DB and sets isInitialized() to true" + db.test.ts suite. VERIFICATION.md will cite these. |
| STOR-02 | Existing JSON trees are automatically migrated to SQLite on first startup after upgrade | Phase 1 implemented: json-to-sqlite.test.ts "triggers migration when JSON file exists and no DB present" + coordinator.test.ts "init() runs migration for existing JSON tree". |
| STOR-03 | SQLite schema supports per-file staleness flags, dependency relationships as join table, and structured metadata fields | Phase 1 implemented: db.test.ts WAL mode + pragma checks; repository.test.ts schema validation. |
| STOR-04 | All existing MCP tools continue to work identically after storage migration (backward compatibility) | Phase 1 implemented: mcp-server.test.ts staleness injection tests. |
| STOR-05 | Coordinator logic is extracted into standalone module that can run without MCP transport | Phase 2 implemented: coordinator.test.ts "Daemon mode: init() runs standalone without initServer() or MCP transport". |
| STOR-06 | System can run as standalone daemon via `--daemon` flag | Phase 2 implemented: coordinator.test.ts PID guard tests + daemon mode test. |
| STOR-07 | Pending LLM jobs persist in SQLite and survive process restarts | Phase 1/5 implemented: repository.ts llm_jobs table; pipeline.test.ts restart tests. |
| COMPAT-01 | All 20+ existing MCP tool names, parameter schemas, and response shapes remain identical | Phase 1 implemented: mcp-server.test.ts; STOR-04 is the test vehicle. |
| COMPAT-03 | System functions correctly with no LLM configured | Phase 2/5 implemented: coordinator.test.ts "works with no LLM configured (COMPAT-03)". |
</phase_requirements>

## Summary

Phase 6 is a housekeeping phase with three distinct workstreams: (1) formal verification of 9 partial requirements via VERIFICATION.md documents, (2) DB lifecycle fix (double-open sequence), and (3) console.error cleanup across four source files with logger extension.

All 164 tests currently pass. The requirements are implemented — this phase proves it and fixes the known tech debt. Work is bounded and well-understood: no new algorithms, no new dependencies, no new external APIs.

The DB double-open is the highest-risk change: `runMigrationIfNeeded` in `json-to-sqlite.ts` calls `openDatabase` internally (line 123), then coordinator.ts calls `openDatabase` again (line 209) immediately after. The fix requires refactoring the migration to accept a DB handle rather than opening its own. The migration tests in `json-to-sqlite.test.ts` open the DB themselves in `beforeEach`, so they remain valid after the refactor — they will simply continue passing the open handle to the refactored API.

**Primary recommendation:** Tackle in three sequential plans — Plan 1: logger extension + console.error fix, Plan 2: DB lifecycle fix + migration refactor, Plan 3: VERIFICATION.md creation and REQUIREMENTS.md update.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | (existing) | Test runner, all 164 tests | Established in all phases |
| better-sqlite3 | (existing) | SQLite driver | Phase 1 decision |
| TypeScript | (existing) | Language | Project-wide |

No new libraries needed. This phase works entirely within the existing codebase.

**Installation:** None required.

## Architecture Patterns

### Verification Document Structure

A VERIFICATION.md is a living audit record, not a test report. It cites test file paths and test names so future Claude sessions can navigate to evidence quickly. Format:

```markdown
# Phase N: <Name> - Verification

**Verified:** YYYY-MM-DD
**Verifier:** Phase 6 automated verification

## Requirements

### REQ-ID: <title>
**Status:** VERIFIED
**Evidence:** `src/path/to/test.ts` — `<describe block> > <test name>`
**Behavior confirmed:** <one sentence of what the test proves>
```

Requirements can reference multiple tests. Each test line should use file-relative path from project root, colon-separated line number if helpful.

### Logger Extension Pattern

Current `logger.ts` has only `log(message, ...args)`. The extension adds level-aware methods with minimal changes:

```typescript
// Source: src/logger.ts — extend existing module

export function error(message: string, ...args: any[]): void {
  // error() always written — both daemon and interactive modes
  _logEntry('[ERROR]', message, args, /*forceToDisk*/ true, /*forceConsole*/ !daemonMode);
}

export function warn(message: string, ...args: any[]): void {
  _logEntry('[WARN]', message, args, /*forceToDisk*/ logToFile, /*forceConsole*/ !daemonMode);
}

export function info(message: string, ...args: any[]): void {
  _logEntry('[INFO]', message, args, /*forceToDisk*/ logToFile, /*forceConsole*/ !daemonMode);
}

export function debug(message: string, ...args: any[]): void {
  // debug() suppressed in daemon mode — pure noise in production logs
  if (daemonMode) return;
  _logEntry('[DEBUG]', message, args, /*forceToDisk*/ logToFile, /*forceConsole*/ true);
}
```

The simplest implementation refactors `log()` to call a shared `_logEntry` helper rather than duplicating the timestamp/format/write logic. The four new methods each call `_logEntry` with different level labels and suppression rules.

**Key rule from CONTEXT.md:**
- `debug()` suppressed in daemon mode
- `error()` always shown (never suppressed)
- `warn()` and `info()` follow same rules as current `log()` (suppressed in daemon mode)

### DB Lifecycle Refactor Pattern

**Current (broken) sequence in coordinator.ts:**
```typescript
// Line 201-209 — coordinator.ts init()
try {
  runMigrationIfNeeded(projectRoot);  // May call openDatabase() internally
} catch (err) { ... }

const dbPath = path.join(projectRoot, '.filescope.db');
openDatabase(dbPath);  // Opens DB a second time (or first if no migration)
```

**Target sequence:**
```typescript
// coordinator.ts init() — single owner pattern
const dbPath = path.join(projectRoot, '.filescope.db');
openDatabase(dbPath);  // Always opens exactly once

// Migration receives already-open DB handle
const { db, sqlite } = getDbHandles();  // or just getSqlite()
runMigrationIfNeeded(projectRoot, sqlite);  // No internal openDatabase()
```

**New signature for `runMigrationIfNeeded`:**
```typescript
// json-to-sqlite.ts
export function runMigrationIfNeeded(
  projectRoot: string,
  sqlite: InstanceType<typeof Database>
): void {
  // Check if SQLite already has data (tables and rows exist) — skip if so
  const hasData = checkAlreadyMigrated(sqlite);
  if (hasData) return;

  // Same scan/migration logic, but use provided sqlite handle
  // No openDatabase() call
}
```

**Migration "already migrated" detection:**
```typescript
function checkAlreadyMigrated(sqlite: InstanceType<typeof Database>): boolean {
  // If the files table exists AND has rows, migration already ran
  try {
    const row = sqlite.prepare('SELECT COUNT(*) as n FROM files').get() as { n: number };
    return row.n > 0;
  } catch {
    return false;  // Table doesn't exist yet — migration needed
  }
}
```

The existing skip condition in `runMigrationIfNeeded` (skip if `.filescope.db` exists) is replaced by checking DB contents, because the coordinator now always opens the DB first.

### Console.error Classification Guide

Based on reading the four files, here is the triage for each call site:

**storage-utils.ts:**
| Line | Current call | Recommended level | Reason |
|------|-------------|-------------------|--------|
| 39 | `Resolving relative path...` | `logger.debug()` | Path resolution noise |
| 45 | `Failed to normalize path:` | `logger.error()` | Real error with stack |
| 69-98 | `Creating file tree config...` + debug dumps | `logger.debug()` | Verbose lifecycle noise |
| 110 | `Saving file tree to SQLite...` | `logger.info()` | Lifecycle event |
| 123 | `Successfully saved N nodes` | `logger.info()` | Lifecycle confirmation |
| 125-126 | `Error saving file tree:` + stack | `logger.error()` | Real error |
| 138 | `Loading file tree from SQLite` | `logger.debug()` | Internal detail |
| 178 | `Failed to load file tree:` | `logger.error()` | Real error |
| 195 | `Error listing file trees:` | `logger.error()` | Real error |
| 302 | `clearTreeCache: no-op` | `logger.debug()` | Debug detail |

**global-state.ts:**
| Line | Current call | Recommended level | Reason |
|------|-------------|-------------------|--------|
| 12 | `Global project root set to:` | `logger.info()` | Lifecycle event |
| 23 | `Global config updated:` | `logger.debug()` | Config dump is debug noise |
| 44 | `Custom excludes loaded:` | `logger.info()` | Noteworthy configuration |
| 48 | `Error loading custom excludes:` | `logger.error()` | Real error |
| 68-69 | `Added/Pattern already exists in FileScopeMCP-excludes.json` | `logger.info()` / `logger.debug()` | Info for first, debug for duplicate |
| 73 | `Error updating FileScopeMCP-excludes.json:` | `logger.error()` | Real error |

**file-watcher.ts:**
| Line | Current call | Recommended level | Reason |
|------|-------------|-------------------|--------|
| 39 | `FileWatcher: Initialized with base directory:` | `logger.info()` | Lifecycle event |
| 47 | `FileWatcher: Already running` | `logger.warn()` | Unexpected but non-fatal |
| 65 | `FileWatcher: Starting on` | `logger.info()` | Lifecycle event |
| 85-90 | `FileWatcher: Error:` + restart | `logger.error()` | Real error |
| 97 | `FileWatcher: Initial scan complete. Ready.` | `logger.info()` | Lifecycle event |
| 101 | `FileWatcher: Started successfully` | `logger.info()` | Lifecycle |
| 103-104 | `FileWatcher: Error starting:` | `logger.error()` | Real error |
| 111 | `FileWatcher: Not running` | `logger.debug()` | Stop called when not running |
| 116 | `FileWatcher: Stopping...` | `logger.info()` | Lifecycle |
| 125 | `FileWatcher: Stopped successfully` | `logger.info()` | Lifecycle |
| 127-128 | `FileWatcher: Error stopping:` | `logger.error()` | Real error |
| 143 | `FileWatcher: Restarting in N ms` | `logger.warn()` | Recovery event |
| 159 | `FileWatcher: Added event callback` | `logger.debug()` | Internal detail |
| 170-171 | `FileWatcher: Removed event callback` | `logger.debug()` | Internal detail |
| 192 | `FileWatcher: Ignoring N patterns` | `logger.debug()` | Verbose config noise |
| 204 | `FileWatcher: Event: ...` | `logger.debug()` | High-frequency event |
| 208 | `FileWatcher: Ignored patterns:` | `logger.debug()` | Verbose repetition |
| 216 | `FileWatcher: Should ignore?` | `logger.debug()` | Verbose per-event |
| 219 | `FileWatcher: Ignoring event for` | `logger.debug()` | High frequency |
| 224 | `FileWatcher: Notifying N callbacks` | `logger.debug()` | High frequency |
| 230 | `FileWatcher: Error in callback:` | `logger.error()` | Real error |

**config-utils.ts:**
| Line | Current call | Recommended level | Reason |
|------|-------------|-------------------|--------|
| 46-48 | `LOADING CONFIG from...` + cwd | `logger.debug()` | Internal startup noise |
| 51 | `Resolved full path:` | `logger.debug()` | Debug detail |
| 53-54 | `Config file exists:` | `logger.debug()` | Debug detail |
| 57-59 | `Using default config` + dump | `logger.info()` / `logger.debug()` | Info for "using default", debug for dump |
| 63 | `Read N bytes from config file` | `logger.debug()` | Debug detail |
| 67 | `Parsed config successfully` | `logger.debug()` | Internal step |
| 71-77 | Exclude patterns reporting | `logger.debug()` | Config dump noise |
| 81-84 | `Config validation successful` + fields | `logger.info()` / `logger.debug()` | Info for success, debug for fields |
| 88-91 | `ERROR parsing config JSON:` | `logger.error()` | Real error |
| 94-97 | `ERROR loading config:` | `logger.error()` | Real error |
| 105 | `Error saving config:` | `logger.error()` | Real error |

### Anti-Patterns to Avoid

- **Do not use `log()` inside the new level methods.** The new `error/warn/info/debug` methods must call the shared helper directly, not call `log()`, to avoid double prefixing.
- **Do not import logger into storage-utils/global-state/file-watcher/config-utils using the old `log` name.** Replace all `console.error(...)` with the appropriate `logger.X(...)` — do not mix patterns.
- **Do not add "already migrated" check based on `.filescope.db` file existence in the refactored migration.** After the refactor, the coordinator always opens the DB first, so the file always exists when `runMigrationIfNeeded` is called. The check must be based on DB contents (table row count), not file presence.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test evidence collection | Custom test reporter | vitest run + stdout capture | Already 164 passing tests; just run them |
| Log level framework | Full logging library (winston, pino) | Extend existing logger.ts | CONTEXT.md says ~20 lines; overkill would harm daemon mode simplicity |
| "Already migrated" detection | Complex schema diffing | Single `SELECT COUNT(*) FROM files` | All that's needed; migration is a one-time pass |

## Common Pitfalls

### Pitfall 1: Circular import when importing logger into files that logger uses
**What goes wrong:** If `logger.ts` imports anything from `storage-utils.ts` or `global-state.ts`, adding `import { log } from './logger.js'` to those files creates a circular dependency.
**Why it happens:** logger.ts currently has no imports from those files — this is safe. But verify before adding imports.
**How to avoid:** Check that logger.ts does NOT import from the files being patched. Currently it only imports `fs` and `path` from node — confirmed safe.
**Warning signs:** TypeScript circular dependency error at compile time.

### Pitfall 2: Existing tests call `runMigrationIfNeeded(projectRoot)` with one argument
**What goes wrong:** After refactoring `runMigrationIfNeeded` to accept a DB handle, existing tests in `json-to-sqlite.test.ts` that call the old one-argument signature will fail to compile.
**Why it happens:** The migration tests in `json-to-sqlite.test.ts` open the DB themselves in `beforeEach` (line 85: `openDatabase(dbPath)`) — they just need to also pass `getSqlite()` in the call.
**How to avoid:** Update `runMigrationIfNeeded` calls in test file when changing the signature. Only 3 call sites exist: coordinator.ts, and 2 in json-to-sqlite.test.ts (`runMigrationIfNeeded` is called in the `runMigrationIfNeeded` describe block at lines 283 and 287).
**Warning signs:** TypeScript compile error `Expected 1 arguments, but got 2`.

### Pitfall 3: Double-open still possible during `set_project_path` switching
**What goes wrong:** The coordinator `init()` starts with `closeDatabase()` (line 169) then later calls `openDatabase()`. If the new refactor puts `openDatabase` before `runMigrationIfNeeded`, the close → open → migrate sequence must be intact across project switches.
**Why it happens:** The existing `closeDatabase()` at line 169 already handles this. The refactor must keep that call in place.
**How to avoid:** Keep `closeDatabase()` at the top of `init()` (line 169). The new sequence is: closeDatabase → openDatabase → runMigrationIfNeeded(sqlite handle).
**Warning signs:** DB-is-already-open error or "database not initialized" error during project switching test.

### Pitfall 4: Migration test `runMigrationIfNeeded` tests no longer test the "skip if DB exists" path
**What goes wrong:** The existing test "does nothing when .filescope.db already exists" (json-to-sqlite.test.ts line 268) tests the file-existence skip. After refactoring to a content-check, this behavior changes.
**Why it happens:** The old skip condition was `if (fs.existsSync(dbPath)) return`. The new condition is "skip if table has rows".
**How to avoid:** Update the test to reflect the new behavior: it should now test "skip if DB has data" (open DB, insert a row, call `runMigrationIfNeeded`, verify no migration runs).
**Warning signs:** Test still passes vacuously — check that the test actually exercises the skip path.

### Pitfall 5: `console.error` inside logger.ts's `log()` function
**What goes wrong:** `logger.ts` line 44 uses `console.error(formattedMessage)` intentionally — this is how the existing `log()` function outputs to stderr in non-daemon mode. This must NOT be replaced with `logger.error()` (infinite loop) or removed.
**Why it happens:** The logger uses `console.error` as the terminal output mechanism — this is correct. Only the four application files should have their `console.error` calls replaced.
**How to avoid:** The new level methods should use `console.error` internally (same pattern as `log()`), just with level prefix.

## Code Examples

### Logger Extension (verified against existing logger.ts pattern)

```typescript
// Source: src/logger.ts — extension of existing module

// Shared internal formatter (refactor of existing log() body)
function _write(prefix: string, message: string, args: any[], toConsole: boolean, toDisk: boolean): void {
  const timestamp = new Date().toISOString();
  let formatted = `[${timestamp}] ${prefix} ${message}`;
  if (args && args.length > 0) {
    args.forEach(arg => {
      formatted += ' ' + (typeof arg === 'object' ? JSON.stringify(arg) : arg);
    });
  }
  if (toConsole) {
    console.error(formatted);
  }
  if (toDisk && logToFile) {
    try {
      if (fs.existsSync(logFilePath)) {
        const stat = fs.statSync(logFilePath);
        if (stat.size > LOG_MAX_SIZE) {
          fs.writeFileSync(logFilePath, '', 'utf8');
        }
      }
      fs.appendFileSync(logFilePath, formatted + '\n', 'utf8');
    } catch { /* never crash on log failure */ }
  }
}

export function log(message: string, ...args: any[]): void {
  _write('', message, args, !daemonMode, logToFile);
}

export function error(message: string, ...args: any[]): void {
  _write('[ERROR]', message, args, true, true);  // error: always to console AND disk
}

export function warn(message: string, ...args: any[]): void {
  _write('[WARN]', message, args, !daemonMode, logToFile);
}

export function info(message: string, ...args: any[]): void {
  _write('[INFO]', message, args, !daemonMode, logToFile);
}

export function debug(message: string, ...args: any[]): void {
  if (daemonMode) return;  // debug suppressed in daemon mode
  _write('[DEBUG]', message, args, true, logToFile);
}
```

### Refactored `runMigrationIfNeeded` signature

```typescript
// Source: src/migrate/json-to-sqlite.ts

// New signature — receives already-open DB handle from coordinator
export function runMigrationIfNeeded(
  projectRoot: string,
  sqlite: InstanceType<typeof Database>
): void {
  // If DB already has file data, no migration needed (idempotent)
  try {
    const row = sqlite.prepare('SELECT COUNT(*) as n FROM files').get() as { n: number };
    if (row.n > 0) {
      return;
    }
  } catch {
    // files table doesn't exist yet — proceed with migration scan
  }

  // Scan for JSON tree files...
  // (rest of existing logic — no openDatabase() call)
}
```

### Coordinator init() sequence (after refactor)

```typescript
// Source: src/coordinator.ts init()

// 1. Close existing DB (handles project switching)
closeDatabase();

// 2. Set state
setProjectRoot(projectRoot);
process.chdir(projectRoot);
this._projectRoot = projectRoot;
this.changeDetector = new ChangeDetector(projectRoot);

// 3. Acquire PID file (before DB open, same as current)
await this.acquirePidFile(projectRoot);

// ... config setup ...

// 4. Open DB once — coordinator owns the lifecycle
const dbPath = path.join(projectRoot, '.filescope.db');
openDatabase(dbPath);
log(`Opened SQLite database at: ${dbPath}`);

// 5. Run migration against already-open DB handle (no second openDatabase)
try {
  runMigrationIfNeeded(projectRoot, getSqlite());
} catch (err) {
  log(`Migration failed (non-fatal): ${err}`);
}
```

### VERIFICATION.md format

```markdown
# Phase 1: SQLite Storage - Verification

**Verified:** 2026-03-18
**Test command:** `npx vitest run src/db/db.test.ts src/db/repository.test.ts src/migrate/json-to-sqlite.test.ts src/coordinator.test.ts src/mcp-server.test.ts`
**Result:** All tests pass

## STOR-01: SQLite stores all file metadata, non-breaking migration

**Status:** VERIFIED
**Evidence:**
- `src/db/db.test.ts` — `openDatabase > opens DB, applies WAL mode pragmas`
- `src/db/repository.test.ts` — `upsertFile > inserts and retrieves all FileNode fields`
- `src/coordinator.test.ts` — `ServerCoordinator > init() opens DB and sets isInitialized() to true`
**Behavior confirmed:** `openDatabase()` creates a valid SQLite file with correct pragmas; `upsertFile()` round-trips all FileNode fields; coordinator init stores scanned files.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSON file storage | SQLite via better-sqlite3 + Drizzle | Phase 1 (2026-03-02) | Atomicity, concurrent access, schema migration |
| console.error for all logging | logger.log() for coordinator traffic | Phases 1-5 | Application code uses logger; utility files bypassed it |
| Migration opens its own DB | Migration receives handle from coordinator | Phase 6 (this phase) | Single DB lifecycle owner |

**Deprecated/outdated:**
- `console.error` in application code: replaced by `logger.*` level methods in this phase
- One-arg `runMigrationIfNeeded(projectRoot)`: becomes two-arg after DB lifecycle fix

## Open Questions

1. **Do any files besides the four named in CONTEXT.md have console.error calls?**
   - What we know: CONTEXT.md names storage-utils.ts, global-state.ts, file-watcher.ts, config-utils.ts
   - What's unclear: Other files (file-utils.ts, cascade-engine.ts, etc.) may also have console.error calls
   - Recommendation: Grep for `console.error` across all src/ files before starting. Fix any found beyond the four named.

2. **Does `mcp-server.ts` have any remaining console.error calls after Phase 1-2 rewiring?**
   - What we know: Phase 1 summary says mcp-server.ts was heavily modified; the coordinator extracted from it
   - What's unclear: Whether all mcp-server.ts logging was already converted to `log()`
   - Recommendation: Include mcp-server.ts in the console.error grep pass.

## Validation Architecture

> workflow.nyquist_validation is not set in .planning/config.json (field absent) — skipping this section.

## Sources

### Primary (HIGH confidence)
- `src/logger.ts` — read directly: existing module structure, `daemonMode` flag, `logToFile` flag, `LOG_MAX_SIZE` constant
- `src/coordinator.ts:169-209` — read directly: exact double-open sequence confirmed
- `src/migrate/json-to-sqlite.ts:96-136` — read directly: `runMigrationIfNeeded` opens DB internally at line 123
- `src/storage-utils.ts` — read directly: `getChildren` dead import at line 10 confirmed; all console.error locations mapped
- `src/global-state.ts` — read directly: all console.error locations mapped
- `src/file-watcher.ts` — read directly: all console.error locations mapped
- `src/config-utils.ts` — read directly: all console.error locations mapped
- `src/migrate/json-to-sqlite.test.ts` — read directly: existing test coverage for migration
- `src/coordinator.test.ts` — read directly: STOR-05, STOR-06, COMPAT-03 test coverage confirmed
- vitest output (164 tests pass) — confirmed via `npx vitest run`

### Secondary (MEDIUM confidence)
- `.planning/phases/01-sqlite-storage/01-03-SUMMARY.md` — requirements-completed: [STOR-04, COMPAT-01] confirmed
- `.planning/phases/02-coordinator-daemon-mode/02-02-SUMMARY.md` — requirements-completed: [STOR-06] confirmed
- `.planning/REQUIREMENTS.md` — full requirements list and current traceability table

## Metadata

**Confidence breakdown:**
- Tech debt identification: HIGH — read source directly, all issues confirmed
- Verification test coverage mapping: HIGH — read all relevant test files directly
- Logger extension pattern: HIGH — matches existing logger.ts structure exactly
- DB lifecycle refactor: HIGH — sequence confirmed in coordinator.ts and json-to-sqlite.ts
- Console.error level assignments: MEDIUM — Claude's discretion per CONTEXT.md; assignments are reasonable but not formally specified

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable domain, no external dependencies)
