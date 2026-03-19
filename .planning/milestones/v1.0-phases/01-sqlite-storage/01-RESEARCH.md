# Phase 1: SQLite Storage - Research

**Researched:** 2026-03-02
**Domain:** SQLite persistence layer — drizzle-orm, better-sqlite3, ESM integration, JSON migration
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Migration experience**
- Auto-migrate on first boot when server detects existing JSON tree file — zero user action required
- Rename original JSON file as backup (e.g., `FileScopeMCP-tree.json.bak`) — not deleted, clearly marked as superseded
- All-or-nothing migration wrapped in a SQLite transaction — if anything fails, rollback and keep using JSON
- Migration feedback via existing `log()` pattern to stderr — consistent with codebase style, silent to MCP clients

**Schema design**
- Flat files table: one row per file with path as primary key. Parent-child relationship reconstructed via path prefix queries — no children column needed
- Dependency relationships table: source_path, target_path, dependency_type (local_import, package_import) — lean schema, add columns later if Phase 3 needs them
- Per-field staleness as nullable INTEGER timestamp columns directly on the files table: summary_stale_since, concepts_stale_since, change_impact_stale_since — NULL means not stale
- LLM jobs table designed fully upfront: job_id, file_path, job_type, priority_tier, status, created_at, etc. — avoids schema migrations when Phase 5 arrives

**ORM vs raw SQL**
- Use Drizzle ORM for type-safe queries, schema-as-code, and migration generation — already mentioned in roadmap plans
- Repository pattern: a `db.ts` module that exports typed functions (getFile, setFile, getDependencies, etc.) — rest of codebase never sees SQL or Drizzle directly
- Accept native addon complexity for better-sqlite3 — use createRequire pattern for ESM integration as planned
- Schema versioning from day one: a schema_version table with a single integer — each future phase checks and upgrades as needed

**Database location**
- SQLite file lives in the monitored project's root directory as `.filescope.db` — dot-prefix hides it on Unix, consistent with per-project pattern
- Single-writer assumed: one server instance per project. Use WAL mode for read performance but don't design for multi-process writes
- Document recommended .gitignore entry in README — don't auto-modify the user's .gitignore

### Claude's Discretion
- Exact Drizzle schema column types and index design
- better-sqlite3 + esbuild integration details (external flag, native addon copy)
- LLM jobs table exact column set (beyond the core fields)
- WAL mode and pragma configuration
- In-memory cache strategy (whether to keep the loadedTrees Map pattern or rely on SQLite's page cache)
- Error message wording during migration failures

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| STOR-01 | System stores all file metadata in SQLite instead of JSON, with non-breaking migration for existing users | Repository pattern via `db.ts`; better-sqlite3 + drizzle-orm stack covers all CRUD operations |
| STOR-02 | Existing JSON trees are automatically migrated to SQLite on first startup after upgrade | Migration runner pattern: detect JSON, wrap inserts in a transaction, rename to `.bak` on success |
| STOR-03 | SQLite schema supports per-file staleness flags, dependency relationships as a join table, and structured metadata fields | Drizzle integer columns with nullable timestamps for staleness; separate `file_dependencies` table with indexed paths |
| STOR-04 | All existing MCP tools continue to work identically after storage migration (backward compatibility) | Repository pattern hides SQL; callers still receive `FileNode`-shaped objects reconstructed from DB rows |
| STOR-07 | Pending LLM jobs persist in SQLite and survive process restarts — work resumes on startup | `llm_jobs` table designed fully in this phase; status enum column tracks pending/in_progress/done/failed |
| COMPAT-01 | All 20+ existing MCP tool names, parameter schemas, and response shapes remain identical | No MCP layer changes — only `storage-utils.ts` and `file-utils.ts` internals change; tool responses built identically |
</phase_requirements>

---

## Summary

Phase 1 replaces a JSON flat-file persistence layer with SQLite using drizzle-orm 0.45.x and better-sqlite3 12.6.x. The project is an ESM TypeScript codebase built with esbuild, running on Node.js 22. Because better-sqlite3 is a native CJS addon, it cannot be imported directly in an ESM context — the `createRequire` pattern from Node's built-in `node:module` package is the verified, standard workaround. esbuild must exclude better-sqlite3 with `--external:better-sqlite3`, and the native `.node` binary ships alongside `dist/` at runtime.

The implementation splits into three self-contained work units: (1) schema definition, drizzle-orm setup, and the DB module; (2) migration runner that detects an existing JSON tree and transactionally moves it to SQLite, renaming the JSON as backup; (3) replacement of every read/write path in `storage-utils.ts` and `file-utils.ts` with the new repository functions, verifying that all MCP tool response shapes remain identical. The `FileNode` tree structure (nested children) is stored flat — one row per file, parent-child reconstructed via path prefix — with separate tables for dependencies and LLM jobs.

WAL mode and key pragmas must be set on the connection object before drizzle wraps it, because drizzle's migration runner does not reliably apply PRAGMAs. Drizzle migrations are generated via `drizzle-kit generate` during development and applied programmatically at startup via `migrate()` from `drizzle-orm/better-sqlite3/migrator`. Since better-sqlite3 is synchronous, `migrate()` does not need `await`.

**Primary recommendation:** Use better-sqlite3 12.6.x via `createRequire`, wrap with drizzle-orm 0.45.x, set WAL + foreign-key pragmas directly on the connection, and apply migrations synchronously at startup with `migrate()`. All storage goes through a `db.ts` repository module — callers never see SQL.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 12.6.2 | Synchronous SQLite driver for Node.js | Fastest SQLite option; synchronous API simplifies server startup ordering; confirmed Node.js 22 support |
| drizzle-orm | 0.45.1 | Type-safe query builder + schema-as-code | Minimal abstraction, TypeScript-native, generates migration SQL, ships a SQLite migrator |
| drizzle-kit | 0.31.9 | CLI for migration generation and schema diffing | Paired tool for drizzle-orm; `drizzle-kit generate` produces SQL migration files |
| @types/better-sqlite3 | latest | TypeScript types for better-sqlite3 | Required for typed `Database` instance |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:module (built-in) | Node 22 | `createRequire` for loading CJS modules from ESM | Always needed to import better-sqlite3 in ESM context |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| better-sqlite3 | @libsql/client | libsql is async and ESM-friendly but adds remote-DB surface; better-sqlite3 is faster, synchronous, simpler for local-only use |
| better-sqlite3 | node:sqlite (Node 22 built-in) | Built-in is still experimental as of Node 22.5+ and requires `--experimental-sqlite` flag; not production-ready |
| drizzle-kit generate + migrate | drizzle-kit push | `push` is dev-only shortcut; `generate` + programmatic `migrate()` is the production pattern |

**Installation:**
```bash
npm install better-sqlite3 drizzle-orm
npm install --save-dev drizzle-kit @types/better-sqlite3
```

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── db/
│   ├── schema.ts        # Drizzle table definitions (files, file_dependencies, llm_jobs, schema_version)
│   ├── db.ts            # Connection init, WAL pragmas, migrate() call, exports typed db instance
│   └── repository.ts    # Typed functions: getFile, setFile, upsertFile, getDependencies, etc.
├── migrate/
│   └── json-to-sqlite.ts  # One-time JSON migration runner
└── [existing files unchanged]

drizzle/                 # Generated migration SQL files (committed to git)
├── 0000_initial_schema.sql
└── meta/
    └── _journal.json
drizzle.config.ts        # Drizzle kit config (dialect: 'sqlite', schema path, migrations out path)
```

### Pattern 1: createRequire for better-sqlite3 in ESM

**What:** Load the CJS native addon via Node's `createRequire` inside an ESM module.
**When to use:** Any ESM `.ts` file that needs `better-sqlite3`.
**Example:**
```typescript
// src/db/db.ts
// Source: https://nodejs.org/api/module.html#modulecreaterequirefilename
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');

import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';
import path from 'node:path';

export function openDatabase(dbPath: string) {
  const sqlite = new Database(dbPath);

  // Set pragmas directly on the connection — NOT via migration files
  // WAL pragma must come before any writes to avoid checkpoint starvation
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });

  // Synchronous: better-sqlite3 migrate() does not need await
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });

  return db;
}
```

### Pattern 2: Drizzle Schema Definition

**What:** Define all tables in `schema.ts` using drizzle-orm's sqlite-core column types.
**When to use:** Schema-as-code; drizzle-kit generates migration SQL from this file.
**Example:**
```typescript
// src/db/schema.ts
// Source: https://orm.drizzle.team/docs/column-types/sqlite
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// One row per file — flat, no nested children
export const files = sqliteTable('files', {
  path:                  text('path').primaryKey().notNull(),
  name:                  text('name').notNull(),
  is_directory:          integer('is_directory', { mode: 'boolean' }).notNull().default(false),
  importance:            integer('importance').default(0),
  summary:               text('summary'),
  mtime:                 integer('mtime'),          // ms since epoch, nullable = unknown
  summary_stale_since:   integer('summary_stale_since'),        // NULL = not stale
  concepts_stale_since:  integer('concepts_stale_since'),       // NULL = not stale
  change_impact_stale_since: integer('change_impact_stale_since'), // NULL = not stale
}, (t) => [
  index('files_is_directory_idx').on(t.is_directory),
]);

export const file_dependencies = sqliteTable('file_dependencies', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  source_path:     text('source_path').notNull(),
  target_path:     text('target_path').notNull(),
  dependency_type: text('dependency_type', {
    enum: ['local_import', 'package_import']
  }).notNull(),
}, (t) => [
  index('dep_source_idx').on(t.source_path),
  index('dep_target_idx').on(t.target_path),
]);

// Pre-built for Phase 5 — avoids schema migration when LLM pipeline arrives
export const llm_jobs = sqliteTable('llm_jobs', {
  job_id:       integer('job_id').primaryKey({ autoIncrement: true }),
  file_path:    text('file_path').notNull(),
  job_type:     text('job_type', {
    enum: ['summary', 'concepts', 'change_impact']
  }).notNull(),
  priority_tier: integer('priority_tier').notNull().default(2), // 1=interactive, 2=cascade, 3=background
  status:       text('status', {
    enum: ['pending', 'in_progress', 'done', 'failed']
  }).notNull().default('pending'),
  created_at:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  started_at:   integer('started_at', { mode: 'timestamp_ms' }),
  completed_at: integer('completed_at', { mode: 'timestamp_ms' }),
  error_message: text('error_message'),
  retry_count:  integer('retry_count').notNull().default(0),
}, (t) => [
  index('jobs_status_priority_idx').on(t.status, t.priority_tier),
  index('jobs_file_path_idx').on(t.file_path),
]);

export const schema_version = sqliteTable('schema_version', {
  version: integer('version').primaryKey().notNull(),
});
```

### Pattern 3: Repository Module

**What:** A thin typed wrapper that translates between `FileNode` objects and DB rows. All callers use this; no SQL leaks out.
**When to use:** Every place that currently calls `saveFileTree`, `loadFileTree`, `updateFileNode`, `getFileNode`.
**Example:**
```typescript
// src/db/repository.ts
import { eq, like, asc } from 'drizzle-orm';
import { db } from './db.js';
import { files, file_dependencies } from './schema.js';
import type { FileNode } from '../types.js';

export function getFile(filePath: string): FileNode | null {
  const row = db.select().from(files).where(eq(files.path, filePath)).get();
  if (!row) return null;
  return rowToFileNode(row);
}

export function upsertFile(node: FileNode): void {
  db.insert(files).values(fileNodeToRow(node))
    .onConflictDoUpdate({ target: files.path, set: fileNodeToRow(node) })
    .run();
}

// Reconstruct children by path prefix query — replaces nested tree traversal
export function getChildren(dirPath: string): FileNode[] {
  // Children are immediate descendants: path starts with dirPath + '/' and has no further '/'
  const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  const rows = db.select().from(files)
    .where(like(files.path, `${prefix}%`))
    .orderBy(asc(files.path))
    .all();
  // Filter to immediate children only (one level deep)
  return rows
    .filter(r => {
      const remainder = r.path.slice(prefix.length);
      return !remainder.includes('/');
    })
    .map(rowToFileNode);
}

export function getDependencies(filePath: string): string[] {
  return db.select({ target: file_dependencies.target_path })
    .from(file_dependencies)
    .where(eq(file_dependencies.source_path, filePath))
    .all()
    .map(r => r.target);
}

export function getDependents(filePath: string): string[] {
  return db.select({ source: file_dependencies.source_path })
    .from(file_dependencies)
    .where(eq(file_dependencies.target_path, filePath))
    .all()
    .map(r => r.source);
}
```

### Pattern 4: JSON Migration Runner

**What:** One-time runner that detects an existing JSON tree, reads it, transactionally inserts all data, then renames the JSON file.
**When to use:** Called from server init when `.filescope.db` does not exist but a JSON tree file does.
**Example:**
```typescript
// src/migrate/json-to-sqlite.ts
import * as fs from 'node:fs';
import { log } from '../logger.js';
import { db } from '../db/db.js';
import { files, file_dependencies } from '../db/schema.js';
import type { FileTreeStorage, FileNode } from '../types.js';

export function migrateJsonToSQLite(jsonPath: string): void {
  log(`Migration: reading JSON tree from ${jsonPath}`);
  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const storage: FileTreeStorage = JSON.parse(raw);

  const allNodes: FileNode[] = [];
  collectNodes(storage.fileTree, allNodes);

  // All-or-nothing: if anything fails, SQLite transaction rolls back
  // and the JSON file is untouched — server falls back to JSON
  const runMigration = db.transaction(() => {
    for (const node of allNodes) {
      db.insert(files).values({
        path: node.path,
        name: node.name,
        is_directory: node.isDirectory,
        importance: node.importance ?? 0,
        summary: node.summary ?? null,
        mtime: node.mtime ?? null,
      }).run();

      for (const dep of node.dependencies ?? []) {
        db.insert(file_dependencies).values({
          source_path: node.path,
          target_path: dep,
          dependency_type: 'local_import',
        }).run();
      }
      for (const pkg of node.packageDependencies ?? []) {
        db.insert(file_dependencies).values({
          source_path: node.path,
          target_path: pkg.path,
          dependency_type: 'package_import',
        }).run();
      }
    }
  });

  runMigration(); // Throws on failure; caller catches and keeps using JSON

  // Rename JSON to backup — only after successful transaction
  const backupPath = `${jsonPath}.bak`;
  fs.renameSync(jsonPath, backupPath);
  log(`Migration: complete. JSON backed up to ${backupPath}`);
}

function collectNodes(node: FileNode, out: FileNode[]): void {
  out.push(node);
  for (const child of node.children ?? []) {
    collectNodes(child, out);
  }
}
```

### Pattern 5: esbuild external flag for native addon

**What:** Exclude better-sqlite3 from the esbuild bundle; it remains a runtime dependency in `node_modules`.
**When to use:** Always — better-sqlite3 ships a `.node` binary that esbuild cannot bundle.
**Example:**
```bash
# In package.json build script — add --external:better-sqlite3
esbuild src/mcp-server.ts ... --external:better-sqlite3 --outdir=dist
```
The `node_modules/better-sqlite3` directory must be present at runtime (i.e., the deployment ships `node_modules/` alongside `dist/`). This is the existing behavior since `node_modules` is already present for `chokidar` and `zod`.

### Anti-Patterns to Avoid

- **Applying WAL mode via a Drizzle migration file:** PRAGMA in SQL migration files is not reliably applied by the migrator. Set pragmas directly on the `Database` instance before `drizzle()` wraps it (verified via GitHub issue drizzle-team/drizzle-orm#4968).
- **Using `import Database from 'better-sqlite3'` directly in ESM:** Fails at runtime because better-sqlite3 is a CJS module. Always use `createRequire`.
- **Rebuilding the nested FileNode tree in memory before every tool call:** Defeats the purpose of the DB. Reconstruct FileNode-shaped responses per-query from DB rows instead.
- **Committing `drizzle/meta/` snapshot files without the migration SQL:** Always commit both `*.sql` and `meta/_journal.json` — drizzle-kit uses the journal to track applied state.
- **Running `drizzle-kit push` in production code paths:** `push` drops/recreates and does not track history. Use `generate` + programmatic `migrate()`.
- **Forgetting to handle the `dependents` array during migration:** `dependents` in FileNode is the inverse of `dependencies`. The DB models this as querying `file_dependencies WHERE target_path = ?`. Do not insert dependents as separate rows (they would duplicate dependency data). Reconstruct `dependents` at query time.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema migrations and versioning | Custom migration runner | drizzle-kit generate + drizzle migrate() | Handles schema diffing, migration ordering, idempotent re-runs, and journal tracking |
| Type-safe query builder | Raw SQL string interpolation | drizzle-orm select/insert/update/delete | Compile-time type checking; prevents SQL injection; handles escaping |
| Transaction wrapping | Manual BEGIN/COMMIT/ROLLBACK strings | better-sqlite3 `.transaction()` | Synchronous, exception-safe, proper rollback on throw |
| Child enumeration from flat table | Recursive in-memory traversal | `LIKE 'prefix/%'` query with post-filter | One round-trip; no in-memory tree needed |

**Key insight:** better-sqlite3's synchronous API means transactions and queries are simpler than async alternatives — no need for `await`, no race conditions between queries.

---

## Common Pitfalls

### Pitfall 1: WAL PRAGMA not applying through Drizzle migration files
**What goes wrong:** `journal_mode` stays as `delete` even after a migration runs `PRAGMA journal_mode = WAL`.
**Why it happens:** Drizzle's migration runner may open a new connection or the PRAGMA is scoped to the connection and not persisted by default in all environments.
**How to avoid:** Set `sqlite.pragma('journal_mode = WAL')` directly on the `Database` instance before calling `drizzle()`.
**Warning signs:** DB file shows no `-wal` or `-shm` companion files after first write.

### Pitfall 2: better-sqlite3 binary mismatch after Node.js upgrade
**What goes wrong:** `Error: better-sqlite3 was compiled against a different Node.js version` at startup.
**Why it happens:** The prebuilt `.node` binary was compiled for a different Node ABI. Happens after `node` upgrade without `npm rebuild`.
**How to avoid:** Run `npm rebuild better-sqlite3` after any Node.js version change. Document this in onboarding notes.
**Warning signs:** Server crashes immediately on startup with `NODE_MODULE_VERSION` mismatch error.

### Pitfall 3: `dependents` array double-insertion
**What goes wrong:** During JSON migration, both `dependencies` (outgoing) and `dependents` (incoming) arrays are inserted into `file_dependencies`, creating duplicate rows with reversed source/target.
**Why it happens:** The existing `FileNode` stores both directions. The DB models only one direction (`source_path → target_path`). The other direction is derived by query.
**How to avoid:** During migration, only insert from `node.dependencies` and `node.packageDependencies`. Never insert `node.dependents` as rows.
**Warning signs:** `getDependents()` returns twice as many results as expected.

### Pitfall 4: `migrate()` path resolving to the wrong directory
**What goes wrong:** `migrate()` finds no migration files and either silently skips or throws "No migrations found".
**Why it happens:** The `migrationsFolder` path is relative to process.cwd() which changes when `process.chdir()` is called (mcp-server.ts calls `process.chdir(projectRoot)` on every `set_project_path` call).
**How to avoid:** Use `path.resolve(__dirname, '../../drizzle')` or resolve the migrations path at module load time (before any `chdir`), not at `migrate()` call time.
**Warning signs:** Migration runs fine in development but schema is missing in production after `set_project_path`.

### Pitfall 5: In-memory `loadedTrees` Map cache conflicts with SQLite writes
**What goes wrong:** A write to SQLite is followed immediately by a read that returns stale in-memory cache.
**Why it happens:** If the `loadedTrees` Map cache is preserved during the SQLite transition, it can return old data after writes go to the DB.
**How to avoid:** Remove the `loadedTrees` Map entirely when replacing `loadFileTree`/`saveFileTree`. SQLite is the source of truth; rely on its page cache for read performance.
**Warning signs:** `getFile()` returns a node that was just deleted or returns old field values after an update.

### Pitfall 6: ESM import of better-sqlite3 without createRequire
**What goes wrong:** `TypeError [ERR_REQUIRE_ESM]` or `SyntaxError: Cannot use import statement in a module` at startup.
**Why it happens:** better-sqlite3 ships CJS; direct `import Database from 'better-sqlite3'` fails in a pure ESM project.
**How to avoid:** Always use `createRequire(import.meta.url)` pattern (see Code Examples).
**Warning signs:** Server fails to start with module format error on the better-sqlite3 line.

---

## Code Examples

Verified patterns from official sources:

### createRequire — loading CJS better-sqlite3 from ESM
```typescript
// Source: https://nodejs.org/api/module.html#modulecreaterequirefilename
// Verified: Node.js 22 official docs; drizzle-orm README pattern
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof import('better-sqlite3');

const sqlite = new Database('/path/to/.filescope.db');
```

### WAL and pragma setup
```typescript
// Source: https://github.com/drizzle-team/drizzle-orm/issues/4968
// Set BEFORE drizzle() wraps the connection
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('synchronous = NORMAL');  // Faster than FULL; safe with WAL
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');   // 5s wait on locked DB; prevents SQLITE_BUSY errors
```

### Programmatic migrate() — synchronous with better-sqlite3
```typescript
// Source: https://orm.drizzle.team/docs/migrations
// better-sqlite3 is synchronous — no await needed
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import path from 'node:path';

// Resolve path at module load time — before any process.chdir() calls
const MIGRATIONS_DIR = path.resolve(new URL('.', import.meta.url).pathname, '../../drizzle');

migrate(db, { migrationsFolder: MIGRATIONS_DIR });
```

### Drizzle transaction (better-sqlite3 style)
```typescript
// Source: https://orm.drizzle.team/docs/transactions
// better-sqlite3 transactions are synchronous functions, not async
const runInsert = db.transaction((nodes: FileNode[]) => {
  for (const node of nodes) {
    db.insert(files).values({ path: node.path, name: node.name, ... }).run();
  }
});

runInsert(allNodes); // Throws on error; automatically rolls back
```

### Drizzle upsert (insert-or-update)
```typescript
// Source: https://orm.drizzle.team/docs/insert#on-conflict
db.insert(files)
  .values({ path: '/src/foo.ts', name: 'foo.ts', is_directory: false })
  .onConflictDoUpdate({
    target: files.path,
    set: { name: 'foo.ts', mtime: Date.now() }
  })
  .run();
```

### esbuild --external flag for native addon
```bash
# Source: https://esbuild.github.io/api/#external
# package.json build script
esbuild src/mcp-server.ts src/db/db.ts src/db/schema.ts src/db/repository.ts \
  --format=esm --target=es2020 --outdir=dist --platform=node \
  --external:better-sqlite3
```

### Migration detection in server init
```typescript
// Called from initializeServer() before any tool is registered
// Detects JSON tree, migrates, falls back gracefully on failure
import * as fs from 'node:fs';
import * as path from 'node:path';
import { log } from './logger.js';
import { migrateJsonToSQLite } from './migrate/json-to-sqlite.js';

export function runMigrationIfNeeded(projectRoot: string): void {
  const dbPath = path.join(projectRoot, '.filescope.db');
  if (fs.existsSync(dbPath)) return; // DB already exists, skip

  // Look for any FileScopeMCP-tree*.json files
  const jsonFiles = fs.readdirSync(projectRoot)
    .filter(f => f.startsWith('FileScopeMCP-tree') && f.endsWith('.json'));

  if (jsonFiles.length === 0) return; // Fresh install, no migration needed

  for (const jsonFile of jsonFiles) {
    const jsonPath = path.join(projectRoot, jsonFile);
    try {
      log(`Migration: found ${jsonFile}, migrating to SQLite...`);
      migrateJsonToSQLite(jsonPath);
      log(`Migration: ${jsonFile} migrated successfully`);
    } catch (err) {
      log(`Migration: failed for ${jsonFile}: ${err}. Continuing with JSON.`);
      // Do NOT rethrow — server falls back to JSON for this tree
    }
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `drizzle-orm/better-sqlite3` direct import | `createRequire` + cast to `typeof import(...)` | Ongoing — better-sqlite3 is still CJS-only | Must use createRequire in ESM projects |
| `drizzle-kit push` for schema updates | `drizzle-kit generate` + `migrate()` at startup | drizzle 0.28+ recommendation | Production-safe; tracks migration history |
| Setting WAL via migration SQL file | Setting WAL directly on Database instance | Issue confirmed 2024-2025 | Pragma in migration files is unreliable |
| `better-sqlite3` v9.x | `better-sqlite3` v12.6.x | 2024-2025 | N-API based; prebuilds available for Node 20/22 |

**Deprecated/outdated:**
- `drizzle-orm-sqlite` (old separate package): Replaced by `drizzle-orm/sqlite-core` within the unified `drizzle-orm` package. Do not install `drizzle-orm-sqlite`.
- `BetterSQLite3Database` named import: The current API uses `drizzle()` return type inference rather than explicit named generic. Use `ReturnType<typeof drizzle>` or just infer the type.

---

## Open Questions

1. **`process.chdir()` interaction with `migrate()` path resolution**
   - What we know: `mcp-server.ts` calls `process.chdir(projectRoot)` on every `set_project_path` call. `migrate()` resolves `migrationsFolder` relative to cwd at call time.
   - What's unclear: Does `openDatabase()` get called before or after the first `chdir`? If called after, the relative path breaks.
   - Recommendation: Resolve the migrations folder path using `import.meta.url` at module load time (absolute path), not a relative string. This is immune to `chdir`.

2. **Single DB instance vs. per-project DB instance**
   - What we know: The server can be pointed at different projects via `set_project_path`. Each project has its own `.filescope.db`.
   - What's unclear: Does the server need to close and reopen the DB connection when `set_project_path` changes the project root? The current JSON layer just reads a different filename.
   - Recommendation: Make `openDatabase()` accept a path argument. In `initializeProject()`, close any existing DB connection and open a new one pointing to the new project's `.filescope.db`. Export a module-level `let db` that gets replaced on re-initialization.

3. **PackageDependency fields not stored in DB**
   - What we know: `PackageDependency` has `name`, `version`, `path`, `scope`, `isDevDependency`. The schema above stores only `target_path` and `dependency_type`.
   - What's unclear: Do any MCP tools currently return `packageDependencies` array fields that callers depend on? If yes, adding columns now is simpler than a later migration.
   - Recommendation: Audit `get_file_importance` response shape. If `packageDependencies` is in the response, add `package_name`, `package_version`, `is_dev_dependency` columns to `file_dependencies` now. Low cost upfront, avoids Phase 3 schema migration.

---

## Sources

### Primary (HIGH confidence)
- [orm.drizzle.team/docs/get-started-sqlite](https://orm.drizzle.team/docs/get-started-sqlite) — better-sqlite3 driver initialization, drizzle() setup
- [orm.drizzle.team/docs/column-types/sqlite](https://orm.drizzle.team/docs/column-types/sqlite) — integer/text/blob column types, primaryKey, index syntax
- [orm.drizzle.team/docs/migrations](https://orm.drizzle.team/docs/migrations) — programmatic migrate() usage, migrationsFolder parameter
- [orm.drizzle.team/docs/indexes-constraints](https://orm.drizzle.team/docs/indexes-constraints) — index() and uniqueIndex() API
- [nodejs.org/api/module.html](https://nodejs.org/api/module.html#modulecreaterequirefilename) — createRequire official docs
- npm: better-sqlite3@12.6.2, drizzle-orm@0.45.1, drizzle-kit@0.31.9 — confirmed current versions

### Secondary (MEDIUM confidence)
- [github.com/drizzle-team/drizzle-orm/issues/4968](https://github.com/drizzle-team/drizzle-orm/issues/4968) — WAL PRAGMA via migration files is unreliable; set on connection instead (multiple confirmations in thread)
- [esbuild.github.io/api/#external](https://esbuild.github.io/api/) — `--external:better-sqlite3` flag documentation
- [github.com/evanw/esbuild/issues/2674](https://github.com/evanw/esbuild/issues/2674) — native addon .node file handling with esbuild

### Tertiary (LOW confidence)
- [github.com/WiseLibs/better-sqlite3/pull/1293](https://github.com/WiseLibs/better-sqlite3/pull/1293) — ESM PR still open as of research date; CJS-only status confirmed but future state not guaranteed
- betterstack.com/community/guides/scaling-nodejs/drizzle-orm/ — setup walkthrough; useful but secondary to official docs

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions confirmed via `npm info`, official docs reviewed
- Architecture: HIGH — patterns verified against official drizzle-orm docs and Node.js docs
- Pitfalls: HIGH — WAL pragma issue verified via GitHub issue; esbuild external verified via official esbuild API docs; ESM/CJS pattern verified via Node.js docs
- Migration pattern: HIGH — `db.transaction()` pattern verified in drizzle docs; JSON rename pattern is stdlib

**Research date:** 2026-03-02
**Valid until:** 2026-04-01 (drizzle-orm releases frequently; re-verify if versions differ)
