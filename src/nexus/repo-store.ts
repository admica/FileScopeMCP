// src/nexus/repo-store.ts
// Per-repo read-only better-sqlite3 connection management for Nexus.
// Exports: RepoState, openRepo, getRepos, getDb, closeAll, recheckOffline, getRepoStats

import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

// Load CJS better-sqlite3 via createRequire — required in ESM context
const _require = createRequire(import.meta.url);
const Database = _require('better-sqlite3') as typeof import('better-sqlite3');

// ─── Types ────────────────────────────────────────────────────────────────────

export type RepoState = {
  name: string;
  path: string;
  db: InstanceType<typeof Database> | null;
  online: boolean;
};

// ─── Module state ─────────────────────────────────────────────────────────────

const repos = new Map<string, RepoState>();

// ─── Functions ────────────────────────────────────────────────────────────────

/**
 * Open a read-only DB connection for a repo.
 * If data.db is missing, stores offline state (db: null, online: false).
 */
export function openRepo(name: string, repoPath: string): RepoState {
  const dbPath = path.join(repoPath, '.filescope', 'data.db');

  if (!fs.existsSync(dbPath)) {
    const state: RepoState = { name, path: repoPath, db: null, online: false };
    repos.set(name, state);
    return state;
  }

  const db = new Database(dbPath, { readonly: true });
  // Set 32MB cache. Do NOT set journal_mode — read-only connections cannot change it.
  db.pragma('cache_size = -32000');

  const state: RepoState = { name, path: repoPath, db, online: true };
  repos.set(name, state);
  return state;
}

/**
 * Return all repo states.
 */
export function getRepos(): RepoState[] {
  return Array.from(repos.values());
}

/**
 * Look up a repo's DB by name.
 * Returns null if repo not found or is offline.
 */
export function getDb(repoName: string): InstanceType<typeof Database> | null {
  const state = repos.get(repoName);
  return state?.db ?? null;
}

/**
 * Close all open DB connections and clear module state.
 */
export function closeAll(): void {
  for (const state of repos.values()) {
    if (state.db) {
      try {
        state.db.close();
      } catch {
        // ignore close errors
      }
      state.db = null;
      state.online = false;
    }
  }
}

/**
 * Recheck all offline repos — reconnect any whose data.db has become available.
 */
export function recheckOffline(): void {
  for (const state of repos.values()) {
    if (state.online) continue;

    const dbPath = path.join(state.path, '.filescope', 'data.db');
    if (!fs.existsSync(dbPath)) continue;

    try {
      const db = new Database(dbPath, { readonly: true });
      db.pragma('cache_size = -32000');
      state.db = db;
      state.online = true;
      console.log(`Nexus: repo ${state.name} came online`);
    } catch (err) {
      // Still offline — ignore
    }
  }
}

/**
 * Query aggregate stats from a repo's database.
 */
export function getRepoStats(db: InstanceType<typeof Database>): object {
  const row = db.prepare(`
    SELECT
      COUNT(*) FILTER (WHERE is_directory = 0) AS total_files,
      COUNT(*) FILTER (WHERE is_directory = 0 AND summary IS NOT NULL) AS with_summary,
      COUNT(*) FILTER (WHERE is_directory = 0 AND concepts IS NOT NULL) AS with_concepts,
      COUNT(*) FILTER (WHERE is_directory = 0 AND summary_stale_since IS NOT NULL) AS stale_count
    FROM files
  `).get() as { total_files: number; with_summary: number; with_concepts: number; stale_count: number };

  const depsRow = db.prepare(`
    SELECT COUNT(*) AS total_deps FROM file_dependencies WHERE dependency_type = 'local_import'
  `).get() as { total_deps: number };

  return {
    totalFiles: row.total_files,
    withSummary: row.with_summary,
    withConcepts: row.with_concepts,
    staleCount: row.stale_count,
    totalDeps: depsRow.total_deps,
  };
}
