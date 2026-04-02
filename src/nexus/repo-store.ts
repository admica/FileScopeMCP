// src/nexus/repo-store.ts
// Per-repo read-only better-sqlite3 connection management for Nexus.
// Exports: RepoState, openRepo, getRepos, getDb, closeAll, recheckOffline, getRepoStats,
//          getTreeEntries, getFileDetail, getDirDetail

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

// ─── Tree / Detail Query Types ────────────────────────────────────────────────

export type TreeEntryRow = {
  name: string;
  path: string;
  isDir: boolean;
  importance: number;
  hasSummary: boolean;
  isStale: boolean;
};

// ─── Graph Query Types ───────────────────────────────────────────────────────

export type GraphNode = {
  path: string;
  name: string;
  importance: number;
  directory: string;   // top-level directory (e.g. "src", "tests"); "" for root-level files
  hasSummary: boolean;
  isStale: boolean;
};

export type GraphEdge = {
  source: string;
  target: string;
};

export type GraphData = { nodes: GraphNode[]; edges: GraphEdge[] };

// ─── Tree / Detail Query Functions ───────────────────────────────────────────

/**
 * Return direct children of a directory (or root-level entries when parentPath is '').
 * Results sorted: directories first, then alphabetically by name.
 */
export function getTreeEntries(
  db: InstanceType<typeof Database>,
  parentPath: string
): { entries: TreeEntryRow[] } {
  let rows: Array<{
    path: string;
    name: string;
    is_directory: number;
    importance: number | null;
    has_summary: number;
    is_stale: number;
  }>;

  if (parentPath === '') {
    rows = db.prepare(`
      SELECT path, name, is_directory, importance,
             (summary IS NOT NULL) AS has_summary,
             (summary_stale_since IS NOT NULL OR concepts_stale_since IS NOT NULL
              OR change_impact_stale_since IS NOT NULL) AS is_stale
      FROM files
      WHERE path NOT LIKE '%/%'
      ORDER BY is_directory DESC, name ASC
    `).all() as typeof rows;
  } else {
    rows = db.prepare(`
      SELECT path, name, is_directory, importance,
             (summary IS NOT NULL) AS has_summary,
             (summary_stale_since IS NOT NULL OR concepts_stale_since IS NOT NULL
              OR change_impact_stale_since IS NOT NULL) AS is_stale
      FROM files
      WHERE path LIKE ? AND path NOT LIKE ?
      ORDER BY is_directory DESC, name ASC
    `).all(`${parentPath}/%`, `${parentPath}/%/%`) as typeof rows;
  }

  const entries: TreeEntryRow[] = rows.map((r) => ({
    path: r.path,
    name: r.name,
    isDir: Boolean(r.is_directory),
    importance: r.importance ?? 0,
    hasSummary: Boolean(r.has_summary),
    isStale: Boolean(r.is_stale),
  }));

  return { entries };
}

/**
 * Return full file metadata for a single file, including parsed JSON blobs and dependency info.
 * Returns null if the file is not found or is a directory.
 */
export function getFileDetail(
  db: InstanceType<typeof Database>,
  filePath: string
): object | null {
  const row = db.prepare(`
    SELECT path, name, importance, summary, mtime,
           summary_stale_since, concepts_stale_since, change_impact_stale_since,
           exports_snapshot, concepts, change_impact
    FROM files WHERE path = ? AND is_directory = 0
  `).get(filePath) as {
    path: string;
    name: string;
    importance: number | null;
    summary: string | null;
    mtime: number | null;
    summary_stale_since: number | null;
    concepts_stale_since: number | null;
    change_impact_stale_since: number | null;
    exports_snapshot: string | null;
    concepts: string | null;
    change_impact: string | null;
  } | undefined;

  if (!row) return null;

  const safeParse = (json: string | null): object | null => {
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
  };

  const dependencies = db.prepare(`
    SELECT target_path AS path, dependency_type AS type
    FROM file_dependencies WHERE source_path = ? AND dependency_type = 'local_import'
  `).all(filePath) as { path: string; type: string }[];

  const dependents = db.prepare(`
    SELECT source_path AS path
    FROM file_dependencies WHERE target_path = ? AND dependency_type = 'local_import'
  `).all(filePath) as { path: string }[];

  const packageDeps = db.prepare(`
    SELECT package_name AS name, package_version AS version, is_dev_dependency AS isDev
    FROM file_dependencies WHERE source_path = ? AND dependency_type = 'package_import'
  `).all(filePath) as { name: string; version: string; isDev: number }[];

  return {
    path: row.path,
    name: row.name,
    importance: row.importance ?? 0,
    summary: row.summary,
    concepts: safeParse(row.concepts),
    changeImpact: safeParse(row.change_impact),
    exportsSnapshot: safeParse(row.exports_snapshot),
    staleness: {
      summary: row.summary_stale_since,
      concepts: row.concepts_stale_since,
      changeImpact: row.change_impact_stale_since,
    },
    dependencies,
    dependents,
    packageDeps: packageDeps.map((p) => ({ ...p, isDev: Boolean(p.isDev) })),
  };
}

/**
 * Return aggregate stats and top files for a directory (all descendants, not just direct children).
 */
export function getDirDetail(
  db: InstanceType<typeof Database>,
  dirPath: string
): object {
  const agg = db.prepare(`
    SELECT
      COUNT(*) AS total_files,
      AVG(importance) AS avg_importance,
      COUNT(*) FILTER (WHERE summary IS NOT NULL) AS with_summary,
      COUNT(*) FILTER (WHERE summary_stale_since IS NOT NULL
                       OR concepts_stale_since IS NOT NULL
                       OR change_impact_stale_since IS NOT NULL) AS stale_count
    FROM files
    WHERE is_directory = 0 AND path LIKE ?
  `).get(`${dirPath}/%`) as {
    total_files: number;
    avg_importance: number | null;
    with_summary: number;
    stale_count: number;
  };

  const topFiles = db.prepare(`
    SELECT path, name, importance
    FROM files
    WHERE is_directory = 0 AND path LIKE ?
    ORDER BY importance DESC
    LIMIT 10
  `).all(`${dirPath}/%`) as { path: string; name: string; importance: number | null }[];

  const totalFiles = agg.total_files ?? 0;
  const withSummary = agg.with_summary ?? 0;
  const staleCount = agg.stale_count ?? 0;
  const avgImportanceRaw = agg.avg_importance ?? 0;

  return {
    path: dirPath,
    name: dirPath.split('/').pop() ?? dirPath,
    totalFiles,
    avgImportance: Math.round(avgImportanceRaw * 10) / 10,
    pctWithSummary: totalFiles > 0 ? Math.round((withSummary / totalFiles) * 100) : 0,
    pctStale: totalFiles > 0 ? Math.round((staleCount / totalFiles) * 100) : 0,
    topFiles: topFiles.map((f) => ({ path: f.path, name: f.name, importance: f.importance ?? 0 })),
  };
}

// ─── Graph Query Functions ──────────────────────────────────────────────────

/**
 * Return all local_import edges and their endpoint file metadata for the dependency graph.
 * Optional dirFilter limits to edges where at least one endpoint is under that subtree.
 */
export function getGraphData(
  db: InstanceType<typeof Database>,
  dirFilter?: string
): GraphData {
  // Edges: all local_import dependencies (optionally filtered by subtree)
  let edgeQuery = `
    SELECT source_path AS source, target_path AS target
    FROM file_dependencies
    WHERE dependency_type = 'local_import'
  `;
  const edgeParams: string[] = [];
  if (dirFilter) {
    edgeQuery += ` AND (source_path LIKE ? OR target_path LIKE ?)`;
    edgeParams.push(`${dirFilter}/%`, `${dirFilter}/%`);
  }
  const edges = db.prepare(edgeQuery).all(...edgeParams) as GraphEdge[];

  // Collect unique file paths referenced by edges
  const pathSet = new Set<string>();
  for (const e of edges) { pathSet.add(e.source); pathSet.add(e.target); }
  if (pathSet.size === 0) return { nodes: [], edges: [] };

  // Nodes: fetch metadata for all referenced files
  // Note: SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999.
  // The 500-node performance cap (D-12) keeps this well under limit.
  const paths = Array.from(pathSet);
  const placeholders = paths.map(() => '?').join(',');
  const fileRows = db.prepare(`
    SELECT path, name, importance,
           (summary IS NOT NULL) AS has_summary,
           (summary_stale_since IS NOT NULL OR concepts_stale_since IS NOT NULL
            OR change_impact_stale_since IS NOT NULL) AS is_stale
    FROM files WHERE path IN (${placeholders}) AND is_directory = 0
  `).all(...paths) as Array<{
    path: string; name: string; importance: number | null;
    has_summary: number; is_stale: number;
  }>;

  const nodes: GraphNode[] = fileRows.map(r => ({
    path: r.path,
    name: r.name,
    importance: r.importance ?? 0,
    directory: r.path.includes('/') ? r.path.split('/')[0] : '',
    hasSummary: Boolean(r.has_summary),
    isStale: Boolean(r.is_stale),
  }));

  return { nodes, edges };
}
