# Stack Research

**Domain:** Autonomous file intelligence / MCP codebase metadata system — v1.3 Nexus observability additions
**Researched:** 2026-03-24
**Confidence:** HIGH

## Context

This is a targeted v1.3 addition to an existing TypeScript 5.8 / Node.js 22 / ESM / esbuild stack.
The core stack is validated and NOT re-researched here. This document covers only the
**new capability domains** for the v1.3 Nexus milestone:

1. SQLite for a second global database (nexus.db) — separate from per-repo data.db
2. Write batching for high-volume event ingestion (500ms / 50 events)
3. In-memory ring buffer (capped at 1000 events)
4. Human-readable log file with rename-rotation (not truncation)
5. Third esbuild entry point for the nexus binary
6. Stats migration: broker's stats.json → Nexus SQLite
7. Query/response protocol for stats (the one exception to fire-and-forget)

**Retained stack (do not change):** TypeScript 5.8, Node.js 22, ESM, esbuild,
`@modelcontextprotocol/sdk`, `chokidar`, `zod`, `vitest`, `better-sqlite3`,
`drizzle-orm`, `tree-sitter@0.25.x`, `tree-sitter-typescript@0.23.x`,
`tree-sitter-javascript@0.25.x`, Vercel AI SDK, `ignore`.

**Established patterns (use as-is, do not re-invent):**
- Unix domain socket server: `node:net` — already working in broker
- NDJSON framing: `node:readline` — already working in broker/server.ts and broker/client.ts
- PID guard: `process.kill(pid, 0)` + `fs.rmSync({ force: true })` — already working in broker/main.ts
- Detached daemon spawn: `spawn(process.execPath, [bin], { detached: true, stdio: 'ignore' }).unref()` — already working in broker/client.ts
- Reconnect timer: `setInterval` + `.unref()` — already working in broker/client.ts
- `better-sqlite3` via `createRequire`: already working in db/db.ts
- WAL mode pragmas: `journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000` — already in db/db.ts

---

## Recommended Stack — New Additions Only

### No New Runtime Dependencies Required

All new capability domains are satisfied by Node.js 22 built-ins and existing dependencies.
Zero new npm packages needed for this milestone.

| Capability | Implementation | Why It Suffices |
|------------|---------------|-----------------|
| Nexus SQLite database | `better-sqlite3` (existing dep) via `createRequire` — raw statements, no Drizzle | Schema is fixed (2 tables, known columns). Drizzle ORM overhead not justified for a simple append-only log. Raw `better-sqlite3` is what the broker already uses for stats. |
| Write batching | `setTimeout(flush, 500)` + counter, cleared on flush | Standard Node.js pattern. No queue library needed — it's a plain array accumulator drained by a timer or count threshold. Exactly what NEXUS-PLAN.md describes. |
| In-memory ring buffer | Fixed-size `Array` with `head` index and `count` — O(1) insert, O(n) drain | Max 1000 events. At ~200 bytes/event that's 200KB max RAM. No circular buffer library needed — 20 lines of TypeScript. |
| Rename-based log rotation | `fs.renameSync` + `fs.appendFileSync` | nexus.log → nexus.log.1 → nexus.log.2. Three renames + one create on rotation. Pure `node:fs`. The existing `logger.ts` uses destructive truncation — Nexus needs rename-rotation to preserve recent history across rotations, so it gets its own log writer (not shared with `logger.ts`). |
| Third esbuild entry point | `esbuild` (existing dev dep) — add `src/nexus/main.ts` to build command | Already supports multiple entry points via `--outdir=dist`. Same pattern as adding broker. |
| Stats query/response | `node:net` socket write + `readline` response — same NDJSON channel | The `query:stats` / `stats_response` exchange reuses the existing socket + readline pattern. No new protocol or library needed. The nexus client uses the same timeout/resolve pattern as `requestStatus()` in broker/client.ts. |
| Stats migration | `fs.readFileSync` + `JSON.parse` on stats.json → `better-sqlite3` INSERT | One-time on first Nexus startup. JSON parsing + SQL insert. No migration library. |
| Fixed-width log formatting | `String.padEnd()` / `String.padStart()` + manual truncation with `...` | Column alignment as shown in NEXUS-PLAN.md. Built-in string methods. |

---

## Implementation Patterns

### nexus.db — Raw better-sqlite3 (No Drizzle)

The Nexus database uses `better-sqlite3` directly — same `createRequire` pattern as `db/db.ts`,
but without Drizzle. The schema is fixed, simple, and append-only. Raw prepared statements are
preferable here because:

1. No schema evolution needed — the Nexus DB schema is defined once in `store.ts` as `CREATE TABLE IF NOT EXISTS` DDL strings.
2. Drizzle's type inference is valuable when schema changes frequently — not this use case.
3. The broker already demonstrated that raw `better-sqlite3` is sufficient for simpler storage needs (`broker/stats.ts`).

```typescript
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

const db = new Database(nexusDbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

// Schema — run once on startup
db.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    repo_path    TEXT PRIMARY KEY,
    repo_name    TEXT NOT NULL,
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL,
    total_files  INTEGER,
    total_tokens INTEGER DEFAULT 0,
    last_progress TEXT
  );
  CREATE TABLE IF NOT EXISTS activity (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   INTEGER NOT NULL,
    event_type  TEXT NOT NULL,
    repo_path   TEXT NOT NULL,
    file_path   TEXT,
    job_type    TEXT,
    tokens      INTEGER,
    duration_ms INTEGER,
    error_code  TEXT,
    detail      TEXT,
    FOREIGN KEY (repo_path) REFERENCES repos(repo_path)
  );
  CREATE INDEX IF NOT EXISTS idx_activity_repo ON activity(repo_path, timestamp);
  CREATE INDEX IF NOT EXISTS idx_activity_type ON activity(event_type, timestamp);
  CREATE INDEX IF NOT EXISTS idx_activity_time ON activity(timestamp);
`);

// Prepared statements — prepare once, reuse
const insertActivity = db.prepare(`
  INSERT INTO activity (timestamp, event_type, repo_path, file_path, job_type,
                        tokens, duration_ms, error_code, detail)
  VALUES (@timestamp, @event_type, @repo_path, @file_path, @job_type,
          @tokens, @duration_ms, @error_code, @detail)
`);

// Batch insert — use a transaction for the flush batch
const insertBatch = db.transaction((rows: ActivityRow[]) => {
  for (const row of rows) insertActivity.run(row);
});
```

WAL mode is critical here because MCP instances write events while the status tool reads
stats. WAL allows concurrent readers and one writer without blocking.

### Write Batching

```typescript
class ActivityBatch {
  private pending: ActivityRow[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 500;
  private readonly FLUSH_COUNT = 50;

  add(row: ActivityRow): void {
    this.pending.push(row);
    if (this.pending.length >= this.FLUSH_COUNT) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.FLUSH_INTERVAL_MS);
      this.timer.unref(); // Don't prevent process exit
    }
  }

  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    insertBatch(batch); // better-sqlite3 transaction — synchronous, fast
  }
}
```

`better-sqlite3` transactions are synchronous and fast — batching 50 rows in a single
transaction is significantly faster than 50 individual inserts. The `.unref()` on the timer
prevents it from blocking Node.js process exit during graceful shutdown.

### In-Memory Ring Buffer

```typescript
class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.head % this.capacity] = item;
    this.head++;
    if (this.count < this.capacity) this.count++;
  }

  toArray(): T[] {
    const start = this.count < this.capacity ? 0 : this.head % this.capacity;
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      result.push(this.buffer[(start + i) % this.capacity] as T);
    }
    return result;
  }

  get size(): number { return this.count; }
}
```

At 1000 events x ~200 bytes each, peak memory is ~200KB. No library needed.

### Rename-Based Log Rotation

The existing `logger.ts` uses destructive truncation (overwrites the file at 10MB). The
Nexus log uses rename-rotation because humans tail it and recent history should survive
across rotations.

```typescript
const LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const LOG_KEEP = 3; // nexus.log, nexus.log.1, nexus.log.2

function rotateIfNeeded(logPath: string): void {
  try {
    const stat = fs.statSync(logPath);
    if (stat.size < LOG_MAX_BYTES) return;
  } catch {
    return; // File doesn't exist yet — nothing to rotate
  }

  // Rotate: .2 is deleted, .1 → .2, .log → .1
  for (let i = LOG_KEEP - 1; i >= 1; i--) {
    const older = `${logPath}.${i}`;
    const newer = i === 1 ? logPath : `${logPath}.${i - 1}`;
    try { fs.renameSync(newer, older); } catch { /* skip if missing */ }
  }
  // logPath is now gone — next appendFileSync recreates it
}

function appendLog(logPath: string, line: string): void {
  rotateIfNeeded(logPath); // Checked per write-batch, not per line
  fs.appendFileSync(logPath, line + '\n', 'utf8');
}
```

Rotation is checked once per write batch (same cadence as the activity flush — 500ms or
50 events), not on every log line. This keeps the hot path free of stat syscalls.

### Fixed-Width Log Formatting

```typescript
function formatLogLine(event: NexusEvent): string {
  const time = new Date(event.timestamp).toLocaleTimeString('en-GB', { hour12: false });
  const type = event.type.padEnd(16);
  const repo = truncatePad(event.repoName, 20);
  const detail = formatEventDetail(event); // event-specific trailing fields
  return `[${time}] ${type} ${repo} ${detail}`;
}

function truncatePad(s: string, width: number): string {
  if (s.length > width) return s.slice(0, width - 3) + '...';
  return s.padEnd(width);
}
```

### Third esbuild Entry Point

Add `src/nexus/main.ts` to the existing build command in `package.json`:

```
"build": "esbuild ... src/nexus/main.ts --format=esm --target=es2020 --outdir=dist --platform=node"
```

Output: `dist/nexus/main.js`. Binary path resolved from `import.meta.url` in
`dist/nexus/client.js`, identical to how broker resolves `dist/broker/main.js`.

The esbuild build script is a flat list of source files. Adding the nexus entry point
follows the identical pattern established for the broker. The nexus source modules
(`server.ts`, `client.ts`, `types.ts`, `store.ts`) are co-located with `main.ts` in
`src/nexus/` and bundled into `dist/nexus/` by esbuild.

### Stats Migration Pattern

On first Nexus startup, if `nexus.db` has no token data but `~/.filescope/stats.json` exists:

```typescript
function migrateStatsJson(db: Database, statsPath: string): void {
  const hasData = (db.prepare('SELECT COUNT(*) as n FROM repos WHERE total_tokens > 0').get() as { n: number }).n > 0;
  if (hasData) return; // Already migrated

  try {
    const stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8')) as { repoTokens: Record<string, number> };
    const upsert = db.prepare(`
      INSERT INTO repos (repo_path, repo_name, first_seen, last_seen, total_tokens)
      VALUES (@repo_path, @repo_name, @now, @now, @tokens)
      ON CONFLICT(repo_path) DO UPDATE SET total_tokens = @tokens
    `);
    const migrate = db.transaction(() => {
      for (const [repoPath, tokens] of Object.entries(stats.repoTokens)) {
        upsert.run({ repo_path: repoPath, repo_name: path.basename(repoPath), now: Date.now(), tokens });
      }
    });
    migrate();
  } catch { /* stats.json missing or malformed — skip */ }
}
```

This runs once and is a no-op on all subsequent startups.

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `drizzle-orm` for nexus.db | Schema is fixed and append-only. Drizzle adds ORM abstraction value only when schema evolves or queries are complex. Two tables with known columns don't justify it. The broker's stats use already proved raw `better-sqlite3` is sufficient. | Raw `better-sqlite3` prepared statements |
| `winston`, `pino`, or any logging library | The Nexus log is a domain-specific format (fixed-width columns, human-readable event lines for `tail -f`). Generic logging libraries don't format this way without configuration that equals writing the formatter yourself. `pino` adds a `node_modules` dep for `JSON.stringify` performance that doesn't matter at this throughput. | `fs.appendFileSync` + custom `formatLogLine` |
| `rotating-file-stream` or `logrotate` npm packages | Both handle file rotation — exactly three `fs.renameSync` calls. Adding a dependency for six lines of code is over-engineering. | `fs.renameSync` + size check per batch |
| Any event bus or pub/sub library (`EventEmitter2`, `rxjs`) | The Nexus receives events over a Unix socket and routes them to three destinations (in-memory state, batch queue, log file). This is a straightforward switch dispatch — no reactive streams or event bus abstraction needed. | Direct function calls inside the socket `line` handler |
| `better-queue` or `p-queue` | The activity batch is a plain array drained by a timer. It has no priority ordering, no concurrency, and no retry logic. A queue library for this is like using React for a static HTML page. | Plain `T[]` array + `setTimeout` |
| SQLite WAL2 mode or external WAL configuration | WAL mode is already established in this codebase (`db/db.ts`). WAL2 is a SQLite extension not available in `better-sqlite3`. Standard WAL is sufficient for the Nexus's write pattern (one writer daemon, occasional reads). | `PRAGMA journal_mode = WAL` (already proven) |
| Separate process for log writing | The Nexus daemon IS the log writer. No need for a syslog daemon, log aggregator, or separate writer process. | `fs.appendFileSync` in the main Nexus process |
| TCP HTTP server for stats queries | The `query:stats` / `stats_response` exchange rides the existing Unix socket channel — no new server needed. The MCP status tool already has a socket connection to the Nexus. | Reuse existing `node:net` socket |

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Raw `better-sqlite3` for nexus.db | Drizzle ORM | Nexus schema is fixed, no migrations needed, two tables. Drizzle is justified in the per-repo data.db (complex schema, frequent evolution). Not justified here. |
| `setTimeout` + array for write batching | A proper queue library | Batching 50 rows on a 500ms timer is 8 lines of TypeScript. Libraries add indirection for no gain at this scale. |
| `fs.renameSync` for log rotation | `rotating-file-stream` npm package | 285-byte package that does exactly what three `renameSync` calls do. The broker already set the precedent: don't add npm deps for built-in capabilities. |
| Reuse existing nexus socket for stats query | New HTTP port for stats | Adding a TCP server just for the stats tool query creates a port management problem. The existing socket is already connected — use it. |
| Custom ring buffer (TypeScript array) | `denque` or similar circular buffer npm package | At 1000 items, a JS array with index arithmetic has no meaningful perf difference from a C-backed circular buffer. The use case (capped recent-event list) is O(n) at drain time anyway. |
| Write rotation check per batch | Per-line stat check | Checking file size on every `appendFileSync` call (~2-4 syscalls) would be a hot path overhead. Checking once per 500ms batch is negligible. |

---

## Integration with Existing Stack

### better-sqlite3 — Same createRequire Pattern

The nexus store module (`src/nexus/store.ts`) opens nexus.db using the identical
`createRequire(import.meta.url)` pattern from `src/db/db.ts`. No new native module
loading mechanism needed. The same WAL pragmas apply.

### node:net + readline — Same IPC Pattern as Broker

The Nexus server and client use `node:net` and `node:readline` in the same way as the
broker. The nexus `client.ts` is structurally a simplified `broker/client.ts`:
- Module-level socket state
- `spawnNexusIfNeeded()` — same detached spawn pattern
- `emit(event)` — fire-and-forget `socket.write(JSON.stringify(event) + '\n')`
- 10s reconnect timer, unref'd
- `queryStats(timeoutMs)` — identical to `requestStatus()` in broker/client.ts

The only difference: the nexus client sends events and only receives responses to
`query:stats` messages. It never receives work assignments.

### esbuild — Add One Entry Point

The existing build script is a flat list of `.ts` source files passed to esbuild.
Add `src/nexus/main.ts` to that list. Same flags: `--format=esm --target=es2020
--platform=node --outdir=dist`. Output structure: `dist/nexus/main.js` (plus
esbuild inlining all imported nexus modules into the bundle).

### logger.ts — NOT Shared

The Nexus does NOT import from `src/logger.ts`. The nexus daemon needs two separate
log streams:
1. **Internal daemon log** (stderr/file): operational messages ("Nexus started", "Client connected") — same format as broker. Implemented by calling `log()` from `logger.ts`.
2. **Human-readable activity log** (`~/.filescope/nexus.log`): the `tail -f` interface with fixed-width event columns. This is Nexus-specific and implemented in `src/nexus/store.ts`.

The `enableDaemonFileLogging()` call in nexus main.ts routes `log()` to
`~/.filescope/nexus-daemon.log` (internal ops). The human activity log is a separate
file written by the store module directly.

### Coordinator and Broker Client — Integration Points

The nexus client (`src/nexus/client.ts`) is imported by:
- `src/coordinator.ts` — calls `nexusConnect()` / `nexusDisconnect()` / `emit()`
- `src/broker/client.ts` — calls `emit()` for job events

The nexus client must NOT import from broker modules. The coordinator is the only
module that calls both `brokerConnect()` and `nexusConnect()`. This matches the
existing separation in the codebase.

---

## Installation

No new packages to install. All capabilities are covered by:
- Node.js 22 built-ins: `node:net`, `node:readline`, `node:fs`, `node:module`
- Existing dependencies: `better-sqlite3`, `esbuild`

The milestone is a zero-dependency-addition feature.

---

## Version Compatibility

| Component | Version | Notes |
|-----------|---------|-------|
| `better-sqlite3` raw (no Drizzle) | 12.6.2 | Same `createRequire` loading pattern as db/db.ts. WAL mode confirmed working. `db.transaction()` for batch inserts is synchronous and performant. |
| `node:fs` rename-rotation | Node.js 22.21.1 | `fs.renameSync`, `fs.appendFileSync`, `fs.statSync` — stable since Node.js v0.1. No async fs needed — rotate check is in the write-batch flush, not the hot path. |
| `node:net` Unix socket (nexus) | Node.js 22.21.1 | Same as broker. Socket path `~/.filescope/nexus.sock` is ~30 chars — well under 107-byte Linux limit. |
| esbuild multiple entry points | 0.27.3 | Confirmed working with broker. Nexus is the third entry point — identical configuration. |
| TypeScript 5.8 | 5.8.3 | Ring buffer, batch accumulator, and log formatter are plain TypeScript — no new language features needed. |

---

## Sources

- Live codebase inspection: `src/broker/server.ts`, `src/broker/client.ts`, `src/broker/main.ts`, `src/broker/stats.ts`, `src/db/db.ts`, `src/logger.ts` — Integration patterns confirmed working in production (HIGH confidence — direct source inspection)
- `NEXUS-PLAN.md` — Architecture design document with precise schema, event types, batching parameters, and rotation thresholds (HIGH confidence — project design doc)
- [Node.js v22 `node:fs` documentation](https://nodejs.org/api/fs.html) — `appendFileSync`, `renameSync`, `statSync` — synchronous file operations, confirmed stable (HIGH confidence — official docs)
- [better-sqlite3 transactions](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#transactionfunction---function) — `db.transaction()` wraps multiple inserts in a single atomic commit; significantly faster than individual inserts (HIGH confidence — official better-sqlite3 docs)
- Node.js 22.21.1 installed — `node --version` confirmed on host machine (HIGH confidence — direct execution)
- `package.json` inspected — confirmed `better-sqlite3@12.6.2`, `esbuild@0.27.3`, `typescript@5.8.3` (HIGH confidence — live file)

---

*Stack research for: FileScopeMCP v1.3 Nexus — new capability additions only*
*Researched: 2026-03-24*
