// src/db/db.ts
// Database connection module for FileScopeMCP SQLite storage.
// Uses createRequire to load better-sqlite3 (CJS) from ESM context.
// Source: https://nodejs.org/api/module.html#modulecreaterequirefilename
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

// Load CJS better-sqlite3 via createRequire — required in ESM context
const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

// Resolve migrations folder relative to this module file at load time.
// IMPORTANT: Must be resolved here (not at migrate() call time) to be immune
// to process.chdir() calls from set_project_path in mcp-server.ts (Pitfall 4).
const MIGRATIONS_DIR = path.resolve(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../drizzle'
);

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// Module-level state — supports set_project_path switching (Open Question 2)
let _db: DrizzleDb | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;

/**
 * Opens the SQLite database at the given path, sets WAL pragmas, and runs
 * pending migrations synchronously. Replaces any existing open connection.
 *
 * Pragmas are set on the raw sqlite connection BEFORE drizzle() wraps it
 * to ensure WAL mode applies reliably (avoids Pitfall 1 / drizzle-team#4968).
 */
export function openDatabase(dbPath: string): { db: DrizzleDb; sqlite: InstanceType<typeof Database> } {
  // Close any existing connection first (supports re-initialization)
  if (_sqlite) {
    try { _sqlite.close(); } catch { /* ignore close errors */ }
    _sqlite = null;
    _db = null;
  }

  const sqlite = new Database(dbPath);

  // Set pragmas directly on the connection — NOT via migration files.
  // WAL must come before any writes to avoid checkpoint starvation.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  const db = drizzle(sqlite, { schema });

  // Synchronous: better-sqlite3 migrate() does not need await
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  _sqlite = sqlite;
  _db = db;

  return { db, sqlite };
}

/**
 * Returns the current database instance.
 * Throws if openDatabase() has not been called or database is closed.
 */
export function getDb(): DrizzleDb {
  if (!_db) {
    throw new Error('Database not initialized. Call openDatabase() first.');
  }
  return _db;
}

/**
 * Returns the raw better-sqlite3 connection (for pragma queries in tests).
 * Throws if database is not open.
 */
export function getSqlite(): InstanceType<typeof Database> {
  if (!_sqlite) {
    throw new Error('Database not initialized. Call openDatabase() first.');
  }
  return _sqlite;
}

/**
 * Closes the underlying SQLite connection and clears the module-level reference.
 * After this call, getDb() will throw until openDatabase() is called again.
 */
export function closeDatabase(): void {
  if (_sqlite) {
    _sqlite.close();
    _sqlite = null;
    _db = null;
  }
}
