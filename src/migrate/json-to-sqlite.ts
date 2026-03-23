// src/migrate/json-to-sqlite.ts
// One-time JSON-to-SQLite migration runner for FileScopeMCP.
// Called from server init when an existing JSON tree file is detected.
// Per Plan 01-02 and RESEARCH.md Pattern 4.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { log } from '../logger.js';
import { getSqlite } from '../db/db.js';
import { upsertFile, setDependencies } from '../db/repository.js';
import type { FileTreeStorage, FileNode } from '../types.js';

// Load Database type for the sqlite parameter type annotation
const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Recursively flattens the nested FileNode tree into a flat array.
 * Walks node.children recursively. Does NOT add dependents entries.
 */
function collectNodes(node: FileNode, out: FileNode[]): void {
  out.push(node);
  for (const child of node.children ?? []) {
    collectNodes(child, out);
  }
}

/**
 * Checks whether migration has already been run by querying the files table.
 * Returns true if files table exists AND has at least one row.
 * Returns false if the table doesn't exist yet (migration needed).
 */
function checkAlreadyMigrated(sqlite: InstanceType<typeof Database>): boolean {
  try {
    const row = sqlite.prepare('SELECT COUNT(*) as n FROM files').get() as { n: number };
    return row.n > 0;
  } catch {
    // files table doesn't exist yet — migration needed
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Migrates all data from a JSON tree file into SQLite.
 * - Reads the JSON file synchronously.
 * - Flattens the nested FileNode tree.
 * - Wraps all inserts in a transaction (all-or-nothing).
 * - Renames the JSON file to .bak only after successful transaction.
 * - On transaction failure: catches, logs, re-throws. JSON is NOT renamed.
 *
 * @param jsonPath - Absolute path to the JSON tree file.
 * @param dbPath   - Absolute path to the .filescope.db file (must already be opened).
 */
export function migrateJsonToSQLite(jsonPath: string, dbPath: string): void {
  log(`Migration: reading JSON tree from ${jsonPath}`);

  const raw = fs.readFileSync(jsonPath, 'utf-8');
  const storage: FileTreeStorage = JSON.parse(raw);

  const allNodes: FileNode[] = [];
  collectNodes(storage.fileTree, allNodes);

  log(`Migration: migrating ${allNodes.length} files from JSON to SQLite`);

  // Use the already-open DB connection (coordinator opened it before calling migration)
  const sqlite = getSqlite();

  // All-or-nothing: if anything fails, better-sqlite3 automatically rolls back
  // the transaction and the JSON file remains untouched.
  // Use raw better-sqlite3 .transaction() for synchronous, exception-safe atomicity.
  const runMigration = sqlite.transaction(() => {
    for (const node of allNodes) {
      // Insert file row — CRITICAL: do NOT insert dependents (Pitfall 3)
      upsertFile(node);

      // Insert dependency rows (local + package)
      // dependents are DERIVED at query time — never inserted directly
      setDependencies(
        node.path,
        node.dependencies ?? [],
        node.packageDependencies ?? []
      );
    }
  });

  try {
    runMigration();
  } catch (err) {
    // Transaction failed — log and re-throw. Caller decides to fall back to JSON.
    log(`Migration: transaction failed for ${jsonPath}: ${err}`);
    throw err;
  }

  // Rename JSON to backup — only after successful transaction
  const backupPath = `${jsonPath}.bak`;
  fs.renameSync(jsonPath, backupPath);
  log(`Migration: complete. JSON backed up to ${backupPath}`);
}

/**
 * Entry point called from server initialization.
 * Detects whether migration is needed and runs it if so.
 *
 * Receives an already-open DB handle from the coordinator — no internal DB open/close.
 * The coordinator owns the DB lifecycle (single owner pattern).
 *
 * Skip conditions:
 *   - SQLite files table already has rows (DB already migrated or initialized).
 *   - No `FileScopeMCP-tree*.json` files found (fresh install).
 *
 * On migration failure: logs error, does NOT re-throw — server falls back
 * to JSON gracefully (per locked decision in RESEARCH.md).
 *
 * @param projectRoot - Absolute path to the project root directory.
 * @param sqlite      - Already-open better-sqlite3 connection (coordinator owns lifecycle).
 */
export function runMigrationIfNeeded(projectRoot: string, sqlite: InstanceType<typeof Database>): void {
  // If DB already has file data, skip (migration already done or fresh SQLite start)
  if (checkAlreadyMigrated(sqlite)) {
    return;
  }

  // Scan for JSON tree files matching the existing naming convention
  let entries: string[];
  try {
    entries = fs.readdirSync(projectRoot);
  } catch (err) {
    log(`Migration: could not read project root ${projectRoot}: ${err}`);
    return;
  }

  const jsonFiles = entries.filter(
    (f) => f.startsWith('FileScopeMCP-tree') && f.endsWith('.json')
  );

  if (jsonFiles.length === 0) {
    // Fresh install — no migration needed
    return;
  }

  const dbPath = path.join(projectRoot, '.filescope', 'data.db');

  for (const jsonFile of jsonFiles) {
    const jsonPath = path.join(projectRoot, jsonFile);
    try {
      log(`Migration: found ${jsonFile}, migrating to SQLite...`);
      migrateJsonToSQLite(jsonPath, dbPath);
      log(`Migration: ${jsonFile} migrated successfully`);
    } catch (err) {
      // Do NOT re-throw — server falls back to JSON for this tree
      log(`Migration: failed for ${jsonFile}: ${err}. Continuing with JSON.`);
    }
  }
}
