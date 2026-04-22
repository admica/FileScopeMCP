// src/db/repository.ts
// Typed CRUD functions for the FileScopeMCP SQLite persistence layer.
// Hides SQL/Drizzle from callers — all interactions go through these functions.
// Per RESEARCH.md Pattern 3.
import { eq, like, asc, or } from 'drizzle-orm';
import { getDb, getSqlite } from './db.js';
import { files, file_dependencies } from './schema.js';
import type { FileNode, PackageDependency } from '../types.js';
import type { ExportSnapshot } from '../change-detector/types.js';
import type { EdgeResult } from '../language-config.js';
import type { CommunityResult } from '../community-detection.js';

// ─── Community dirty flag ──────────────────────────────────────────────────────
// Module-level mutable flag: true = community cache is stale, Louvain must rerun.
// Starts true so the first query always runs Louvain (D-10, D-12).
let _communitiesDirty = true;

export function isCommunitiesDirty(): boolean {
  return _communitiesDirty;
}

export function markCommunitiesDirty(): void {
  _communitiesDirty = true;
}

export function clearCommunitiesDirty(): void {
  _communitiesDirty = false;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

type FileRow = typeof files.$inferSelect;
type DepRow = typeof file_dependencies.$inferSelect;

/**
 * Convert a DB files row to a FileNode.
 * By default does NOT populate dependencies/dependents/packageDependencies
 * (expensive join queries). Pass `withDeps: true` to populate them.
 */
function rowToFileNode(row: FileRow, withDeps = false): FileNode {
  const node: FileNode = {
    path: row.path,
    name: row.name,
    isDirectory: Boolean(row.is_directory),
    importance: row.importance ?? 0,
    summary: row.summary ?? undefined,
    mtime: row.mtime ?? undefined,
  };

  if (withDeps) {
    node.dependencies = getDependencies(row.path);
    node.dependents = getDependents(row.path);
    node.packageDependencies = getPackageDependencies(row.path);
  }

  return node;
}

/**
 * Convert a FileNode to a DB files row insert object.
 */
function fileNodeToRow(node: FileNode): typeof files.$inferInsert {
  return {
    path: node.path,
    name: node.name,
    is_directory: node.isDirectory,
    importance: node.importance ?? 0,
    summary: node.summary ?? null,
    mtime: node.mtime ?? null,
    // Staleness fields — not on FileNode yet, default null
    summary_stale_since: null,
    concepts_stale_since: null,
    change_impact_stale_since: null,
  };
}

/**
 * Fetch package dependencies for a given file path.
 * Used internally by rowToFileNode (withDeps=true).
 */
function getPackageDependencies(filePath: string): PackageDependency[] {
  const db = getDb();
  const rows = db
    .select()
    .from(file_dependencies)
    .where(
      eq(file_dependencies.source_path, filePath)
    )
    .all()
    .filter((r: DepRow) => r.dependency_type === 'package_import');

  return rows.map((r: DepRow) => {
    const pkg = {
      name: r.package_name ?? '',
      version: r.package_version ?? undefined,
      path: r.target_path,
      scope: undefined as string | undefined,
      isDevDependency: r.is_dev_dependency ?? undefined,
    };
    // Reconstruct scope from name if scoped package (e.g., @types/node)
    if (pkg.name.startsWith('@') && pkg.name.includes('/')) {
      pkg.scope = pkg.name.split('/')[0];
    }
    return pkg as unknown as PackageDependency;
  });
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieves a single file by path, including its dependencies, dependents,
 * and package dependencies (for backward compatibility with existing code).
 * Returns null if not found.
 */
export function getFile(filePath: string): FileNode | null {
  const db = getDb();
  const row = db.select().from(files).where(eq(files.path, filePath)).get();
  if (!row) return null;
  return rowToFileNode(row, true); // withDeps=true for full FileNode compat
}

/**
 * Inserts or updates a file row.
 * Uses onConflictDoUpdate on the primary key (path) — no duplicate rows.
 */
export function upsertFile(node: FileNode): void {
  const db = getDb();
  const row = fileNodeToRow(node);
  db.insert(files)
    .values(row)
    .onConflictDoUpdate({
      target: files.path,
      set: {
        name: row.name,
        is_directory: row.is_directory,
        importance: row.importance,
        summary: row.summary,
        mtime: row.mtime,
        // Staleness columns are owned exclusively by CascadeEngine.
        // Do NOT overwrite them on conflict — they are set by markStale().
        // Fresh INSERT still uses fileNodeToRow values (null for new files).
      },
    })
    .run();
}

/**
 * Deletes a file by path. Also removes all dependency rows where this file
 * is source or target (cascade cleanup).
 */
export function deleteFile(filePath: string): void {
  const db = getDb();
  // Clean up dependencies referencing this file
  db.delete(file_dependencies)
    .where(
      or(
        eq(file_dependencies.source_path, filePath),
        eq(file_dependencies.target_path, filePath)
      )
    )
    .run();
  // Delete the file row
  db.delete(files).where(eq(files.path, filePath)).run();
}

/**
 * Returns immediate children of a directory (one level deep only).
 * Uses LIKE prefix query + post-filter for the immediate-child constraint.
 * Per RESEARCH.md Pattern 3.
 */
export function getChildren(dirPath: string): FileNode[] {
  const db = getDb();
  const prefix = dirPath.endsWith('/') ? dirPath : `${dirPath}/`;
  const rows = db
    .select()
    .from(files)
    .where(like(files.path, `${prefix}%`))
    .orderBy(asc(files.path))
    .all();

  return rows
    .filter((r: FileRow) => {
      const remainder = r.path.slice(prefix.length);
      // Immediate child: no further '/' in the remainder
      return remainder.length > 0 && !remainder.includes('/');
    })
    .map((r: FileRow) => rowToFileNode(r, false)); // skip deps for performance
}

/**
 * Returns local import dependency target paths for the given file.
 */
export function getDependencies(filePath: string): string[] {
  const db = getDb();
  return db
    .select()
    .from(file_dependencies)
    .where(eq(file_dependencies.source_path, filePath))
    .all()
    .filter((r: DepRow) => r.dependency_type === 'local_import')
    .map((r: DepRow) => r.target_path);
}

/**
 * Returns local import dependencies for the given file with edge metadata.
 * Each result includes target_path, edge_type, and confidence from the DB columns.
 * Only returns local_import rows (package_import rows excluded).
 * Use this instead of getDependencies() when the caller needs edge type/confidence.
 */
export function getDependenciesWithEdgeMetadata(filePath: string): Array<{
  target_path: string;
  edge_type: string;
  confidence: number;
}> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT target_path, edge_type, confidence FROM file_dependencies WHERE source_path = ? AND dependency_type = 'local_import'"
    )
    .all(filePath) as Array<{ target_path: string; edge_type: string; confidence: number }>;
}

/**
 * Returns source paths of files that depend on the given target (inverse query).
 * Per RESEARCH.md anti-pattern: dependents are NEVER stored as separate rows —
 * they are derived by querying file_dependencies WHERE target_path = ?.
 */
export function getDependents(filePath: string): string[] {
  const db = getDb();
  return db
    .select({ source: file_dependencies.source_path })
    .from(file_dependencies)
    .where(eq(file_dependencies.target_path, filePath))
    .all()
    .map((r: { source: string }) => r.source);
}

/**
 * Returns all local_import dependency edges in one batch query.
 * Used by cycle detection to build the full dependency graph without N+1 queries.
 * Package imports are excluded — they are not actionable for cycle detection.
 */
export function getAllLocalImportEdges(): Array<{ source_path: string; target_path: string }> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT source_path, target_path FROM file_dependencies WHERE dependency_type = 'local_import'"
    )
    .all() as Array<{ source_path: string; target_path: string }>;
}

/**
 * Returns all local_import edges with their weight column.
 * Used by community detection to build the weighted Louvain graph.
 */
export function getAllLocalImportEdgesWithWeights(): Array<{
  source_path: string;
  target_path: string;
  weight: number;
}> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT source_path, target_path, weight FROM file_dependencies WHERE dependency_type = 'local_import'"
    )
    .all() as Array<{ source_path: string; target_path: string; weight: number }>;
}

/**
 * Replaces all dependency rows for the given source file.
 * Deletes existing source_path rows first, then inserts fresh.
 * Stores local deps as 'local_import' and package deps as 'package_import'
 * with PackageDependency metadata in the extra columns.
 */
export function setDependencies(
  sourcePath: string,
  localDeps: string[],
  packageDeps: PackageDependency[]
): void {
  const db = getDb();

  // Delete all existing dependency rows for this source
  db.delete(file_dependencies)
    .where(eq(file_dependencies.source_path, sourcePath))
    .run();

  // Insert local imports
  for (const targetPath of localDeps) {
    db.insert(file_dependencies)
      .values({
        source_path: sourcePath,
        target_path: targetPath,
        dependency_type: 'local_import',
        package_name: null,
        package_version: null,
        is_dev_dependency: null,
      })
      .run();
  }

  // Insert package imports with metadata
  for (const pkg of packageDeps) {
    db.insert(file_dependencies)
      .values({
        source_path: sourcePath,
        target_path: pkg.path,
        dependency_type: 'package_import',
        package_name: pkg.name || null,
        package_version: pkg.version || null,
        is_dev_dependency: pkg.isDevDependency ?? null,
      })
      .run();
  }
}

/**
 * Replaces all dependency rows for the given source file with enriched edge data.
 * Like setDependencies() but writes edge_type, confidence, confidence_source, and weight.
 * Callers migrated to extractEdges() should use this instead of setDependencies().
 */
export function setEdges(sourcePath: string, edges: EdgeResult[]): void {
  const db = getDb();

  // Delete all existing dependency rows for this source
  db.delete(file_dependencies)
    .where(eq(file_dependencies.source_path, sourcePath))
    .run();

  // Insert enriched edge rows
  for (const edge of edges) {
    db.insert(file_dependencies).values({
      source_path:       sourcePath,
      target_path:       edge.target,
      dependency_type:   edge.isPackage ? 'package_import' : 'local_import',
      package_name:      edge.packageName ?? null,
      package_version:   edge.packageVersion ?? null,
      is_dev_dependency: null,
      edge_type:         edge.edgeType,
      confidence:        edge.confidence,
      confidence_source: edge.confidenceSource,
      weight:            edge.weight,
    }).run();
  }
  markCommunitiesDirty();
}

/**
 * Returns all files as FileNode objects (without deps for performance).
 * Callers can request deps separately via getDependencies/getDependents.
 */
export function getAllFiles(): FileNode[] {
  const db = getDb();
  return db
    .select()
    .from(files)
    .orderBy(asc(files.path))
    .all()
    .map((r: FileRow) => rowToFileNode(r, false));
}

// ─── Purge stale records ─────────────────────────────────────────────────────

/**
 * Deletes all file and dependency records whose paths are NOT under the given
 * project root. Called during init() to clean up ghost records left from a
 * previous project root (e.g. different machine or moved directory).
 */
export function purgeRecordsOutsideRoot(projectRoot: string): { files: number; deps: number } {
  const sqlite = getSqlite();
  const pattern = projectRoot + '%';
  const depResult = sqlite.prepare(
    'DELETE FROM file_dependencies WHERE source_path NOT LIKE ? OR target_path NOT LIKE ?'
  ).run(pattern, pattern);
  const fileResult = sqlite.prepare(
    'DELETE FROM files WHERE path NOT LIKE ?'
  ).run(pattern);
  return { files: fileResult.changes, deps: depResult.changes };
}

/**
 * Deletes files and dependency edges whose paths satisfy the provided predicate.
 * Used to clean up records whose paths now match an exclude pattern (e.g. when
 * .claude/worktrees/ is added to excludes but the DB still has entries from
 * earlier scans). Caller supplies the predicate so this module stays independent
 * of the file-utils glob machinery (avoiding an import cycle).
 */
export function purgeRecordsMatching(
  shouldPurge: (filePath: string) => boolean,
): { files: number; deps: number } {
  const sqlite = getSqlite();
  const allPaths = sqlite.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
  const toDelete = allPaths.map(r => r.path).filter(shouldPurge);

  if (toDelete.length === 0) return { files: 0, deps: 0 };

  const deleteFileStmt = sqlite.prepare('DELETE FROM files WHERE path = ?');
  const deleteDepStmt = sqlite.prepare(
    'DELETE FROM file_dependencies WHERE source_path = ? OR target_path = ?'
  );

  let files = 0;
  let deps = 0;
  const tx = sqlite.transaction((paths: string[]) => {
    for (const p of paths) {
      deps += deleteDepStmt.run(p, p).changes;
      files += deleteFileStmt.run(p).changes;
    }
  });
  tx(toDelete);

  markCommunitiesDirty();
  return { files, deps };
}

// ─── Exports snapshot ─────────────────────────────────────────────────────────

/**
 * Retrieves the stored ExportSnapshot for a file, or null if none stored.
 * Uses a raw SQL query to read the exports_snapshot column directly, avoiding
 * the need to go through FileNode deserialization.
 */
export function getExportsSnapshot(filePath: string): ExportSnapshot | null {
  // Use raw sqlite for direct column access — avoids rowToFileNode complexity
  const sqlite = getSqlite();
  const row = sqlite
    .prepare('SELECT exports_snapshot FROM files WHERE path = ?')
    .get(filePath) as { exports_snapshot: string | null } | undefined;

  if (!row || row.exports_snapshot === null || row.exports_snapshot === undefined) {
    return null;
  }

  try {
    return JSON.parse(row.exports_snapshot) as ExportSnapshot;
  } catch {
    return null;
  }
}

/**
 * Stores an ExportSnapshot for a file. Uses an UPSERT to create the row if
 * it doesn't exist yet (first-parse case), or update exports_snapshot if it does.
 *
 * Note: Only the exports_snapshot column is affected — other columns are
 * unchanged if the row already exists.
 */
export function setExportsSnapshot(filePath: string, snapshot: ExportSnapshot): void {
  const sqlite = getSqlite();
  const json = JSON.stringify(snapshot);

  // Try update first; if no row exists, insert a minimal row with the snapshot.
  // The files table requires path and name to be NOT NULL.
  const updated = sqlite
    .prepare('UPDATE files SET exports_snapshot = ? WHERE path = ?')
    .run(json, filePath);

  if (updated.changes === 0) {
    // Row doesn't exist — insert with minimal required fields
    const name = filePath.split('/').pop() ?? filePath;
    sqlite
      .prepare(
        'INSERT INTO files (path, name, is_directory, exports_snapshot) VALUES (?, ?, 0, ?)'
      )
      .run(filePath, name, json);
  }
}

// ─── Staleness ────────────────────────────────────────────────────────────────

/**
 * Reads the three staleness columns for the given file path.
 * Returns an object with camelCase field names and null for fresh/missing values.
 * If the file does not exist in the DB, all fields are null.
 * Used by MCP tool handlers to inject staleness timestamps into query responses.
 */
export function getStaleness(filePath: string): {
  summaryStale: number | null;
  conceptsStale: number | null;
  changeImpactStale: number | null;
} {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare(
      'SELECT summary_stale_since, concepts_stale_since, change_impact_stale_since FROM files WHERE path = ?'
    )
    .get(filePath) as {
      summary_stale_since: number | null;
      concepts_stale_since: number | null;
      change_impact_stale_since: number | null;
    } | undefined;

  if (!row) {
    return { summaryStale: null, conceptsStale: null, changeImpactStale: null };
  }

  return {
    summaryStale: row.summary_stale_since ?? null,
    conceptsStale: row.concepts_stale_since ?? null,
    changeImpactStale: row.change_impact_stale_since ?? null,
  };
}

/**
 * Returns aggregate LLM processing progress across all non-directory files.
 */
export function getLlmProgress(): {
  totalFiles: number;
  withSummary: number;
  withConcepts: number;
  pendingSummary: number;
  pendingConcepts: number;
} {
  const sqlite = getSqlite();
  const row = sqlite.prepare(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN summary IS NOT NULL AND summary <> '' THEN 1 ELSE 0 END) as with_summary,
       SUM(CASE WHEN concepts IS NOT NULL AND concepts <> '' THEN 1 ELSE 0 END) as with_concepts,
       SUM(CASE WHEN summary_stale_since IS NOT NULL THEN 1 ELSE 0 END) as pending_summary,
       SUM(CASE WHEN concepts_stale_since IS NOT NULL THEN 1 ELSE 0 END) as pending_concepts
     FROM files WHERE is_directory = 0`
  ).get() as { total: number; with_summary: number; with_concepts: number; pending_summary: number; pending_concepts: number };
  return {
    totalFiles: row.total,
    withSummary: row.with_summary,
    withConcepts: row.with_concepts,
    pendingSummary: row.pending_summary,
    pendingConcepts: row.pending_concepts,
  };
}

// ─── Search ───────────────────────────────────────────────────────────────────

const SEARCH_SQL = `
SELECT path, name, importance,
  json_extract(concepts, '$.purpose') AS purpose,
  CASE
    WHEN concepts IS NOT NULL AND (
      EXISTS(SELECT 1 FROM json_each(json_extract(concepts, '$.functions')) WHERE value LIKE @pattern)
      OR EXISTS(SELECT 1 FROM json_each(json_extract(concepts, '$.classes')) WHERE value LIKE @pattern)
      OR EXISTS(SELECT 1 FROM json_each(json_extract(concepts, '$.interfaces')) WHERE value LIKE @pattern)
      OR EXISTS(SELECT 1 FROM json_each(json_extract(concepts, '$.exports')) WHERE value LIKE @pattern)
    ) THEN 100
    WHEN (concepts IS NOT NULL AND json_extract(concepts, '$.purpose') LIKE @pattern)
      OR (change_impact IS NOT NULL AND
        EXISTS(SELECT 1 FROM json_each(json_extract(change_impact, '$.affectedAreas')) WHERE value LIKE @pattern))
      THEN 50
    WHEN summary LIKE @pattern THEN 20
    WHEN path LIKE @pattern THEN 10
    ELSE 0
  END AS match_rank
FROM files
WHERE is_directory = 0
  AND (
    path LIKE @pattern
    OR (summary IS NOT NULL AND summary LIKE @pattern)
    OR (concepts IS NOT NULL AND (
      json_extract(concepts, '$.purpose') LIKE @pattern
      OR EXISTS(SELECT 1 FROM json_each(json_extract(concepts, '$.functions')) WHERE value LIKE @pattern)
      OR EXISTS(SELECT 1 FROM json_each(json_extract(concepts, '$.classes')) WHERE value LIKE @pattern)
      OR EXISTS(SELECT 1 FROM json_each(json_extract(concepts, '$.interfaces')) WHERE value LIKE @pattern)
      OR EXISTS(SELECT 1 FROM json_each(json_extract(concepts, '$.exports')) WHERE value LIKE @pattern)
    ))
    OR (change_impact IS NOT NULL AND
      EXISTS(SELECT 1 FROM json_each(json_extract(change_impact, '$.affectedAreas')) WHERE value LIKE @pattern))
  )
ORDER BY match_rank DESC, importance DESC
LIMIT @limit
`;

/**
 * Searches across all stored file metadata: symbols, purpose, summaries, and paths.
 * Returns results ranked by match quality (symbol > purpose > summary > path).
 */
export function searchFiles(query: string, maxItems: number = 10): {
  results: Array<{ path: string; importance: number; purpose: string | null; matchRank: number }>;
  query: string;
  truncated?: boolean;
} {
  if (!query || !query.trim()) {
    return { results: [], query: query || '' };
  }

  const sqlite = getSqlite();
  const pattern = `%${query.trim()}%`;
  const limit = maxItems + 1;

  const rows = sqlite.prepare(SEARCH_SQL).all({ pattern, limit }) as Array<{
    path: string;
    name: string;
    importance: number | null;
    purpose: string | null;
    match_rank: number;
  }>;

  const truncated = rows.length > maxItems;
  const resultRows = truncated ? rows.slice(0, maxItems) : rows;

  return {
    results: resultRows.map(r => ({
      path: r.path,
      importance: r.importance ?? 0,
      purpose: r.purpose ?? null,
      matchRank: r.match_rank,
    })),
    query: query.trim(),
    ...(truncated && { truncated: true }),
  };
}

/**
 * Marks all 3 staleness columns to `timestamp` for every file in `filePaths`.
 * Uses a raw prepared statement inside a transaction for atomicity and speed.
 * If a path doesn't exist in the DB, the UPDATE silently matches 0 rows (no throw).
 * Owned exclusively by CascadeEngine — callers outside the cascade subsystem
 * should not call this directly.
 */
export function markStale(filePaths: string[], timestamp: number): void {
  const sqlite = getSqlite();
  const stmt = sqlite.prepare(
    'UPDATE files SET summary_stale_since = ?, concepts_stale_since = ?, change_impact_stale_since = ? WHERE path = ?'
  );
  const tx = sqlite.transaction(() => {
    for (const p of filePaths) {
      stmt.run(timestamp, timestamp, timestamp, p);
    }
  });
  tx();
}

/**
 * Marks all non-directory files at or above minImportance as stale.
 * When remainingOnly is true, only marks files that have never been summarized.
 * Returns the number of files marked.
 */
export function markAllStale(timestamp: number, minImportance: number = 1, remainingOnly: boolean = false): number {
  const sqlite = getSqlite();
  const where = remainingOnly
    ? `WHERE is_directory = 0
       AND importance >= ?
       AND summary IS NULL
       AND summary_stale_since IS NULL`
    : `WHERE is_directory = 0
       AND importance >= ?
       AND (summary_stale_since IS NULL
         OR concepts_stale_since IS NULL
         OR change_impact_stale_since IS NULL)`;
  const result = sqlite.prepare(
    `UPDATE files
     SET summary_stale_since = ?,
         concepts_stale_since = ?,
         change_impact_stale_since = ?
     ${where}`
  ).run(timestamp, timestamp, timestamp, minImportance);
  return result.changes;
}


/**
 * Writes an LLM result to the appropriate column in the files table.
 * Maps jobType to column: 'summary' → summary, 'concepts' → concepts, 'change_impact' → change_impact.
 * Silently does nothing if the file path doesn't exist.
 */
export function writeLlmResult(filePath: string, jobType: string, result: string): void {
  const sqlite = getSqlite();
  let column: string;
  switch (jobType) {
    case 'summary':
      column = 'summary';
      break;
    case 'concepts':
      column = 'concepts';
      break;
    case 'change_impact':
      column = 'change_impact';
      break;
    default:
      throw new Error(`writeLlmResult: unknown jobType '${jobType}'`);
  }
  sqlite
    .prepare(`UPDATE files SET ${column} = ? WHERE path = ?`)
    .run(result, filePath);
}

/**
 * Clears the staleness timestamp for the given job type on the given file.
 * Maps jobType to the corresponding stale_since column.
 * Silently does nothing if the file path doesn't exist.
 */
export function clearStaleness(filePath: string, jobType: string): void {
  const sqlite = getSqlite();
  let column: string;
  switch (jobType) {
    case 'summary':
      column = 'summary_stale_since';
      break;
    case 'concepts':
      column = 'concepts_stale_since';
      break;
    case 'change_impact':
      column = 'change_impact_stale_since';
      break;
    default:
      throw new Error(`clearStaleness: unknown jobType '${jobType}'`);
  }
  sqlite
    .prepare(`UPDATE files SET ${column} = NULL WHERE path = ?`)
    .run(filePath);
}

// ─── Community persistence ─────────────────────────────────────────────────────

/**
 * Replaces all community assignments in file_communities.
 * Uses a transaction: DELETE all rows, INSERT all new assignments.
 * This is a full replace — Louvain recomputes everything (D-17).
 */
export function setCommunities(communities: CommunityResult[]): void {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM file_communities').run();
    const stmt = sqlite.prepare(
      'INSERT INTO file_communities (community_id, file_path) VALUES (?, ?)'
    );
    for (const c of communities) {
      for (const filePath of c.members) {
        stmt.run(c.communityId, filePath);
      }
    }
  });
  tx();
}

/**
 * Reads all community assignments from file_communities, groups them,
 * and returns CommunityResult[] with representatives derived from importance.
 * Representative = highest-importance member in each community.
 */
export function getCommunities(): CommunityResult[] {
  const sqlite = getSqlite();
  const rows = sqlite.prepare(
    'SELECT community_id, file_path FROM file_communities ORDER BY community_id'
  ).all() as Array<{ community_id: number; file_path: string }>;

  if (rows.length === 0) return [];

  // Group by community_id
  const groups = new Map<number, string[]>();
  for (const row of rows) {
    if (!groups.has(row.community_id)) groups.set(row.community_id, []);
    groups.get(row.community_id)!.push(row.file_path);
  }

  // Build CommunityResult[] — need importance scores for representative selection
  const allFiles = getAllFiles();
  const importances = new Map(allFiles.map(f => [f.path, f.importance ?? 0]));

  return Array.from(groups.entries()).map(([communityId, members]) => {
    const representative = members.reduce((best, path) => {
      return (importances.get(path) ?? 0) >= (importances.get(best) ?? 0) ? path : best;
    }, members[0]);
    return {
      communityId,
      representative,
      members: members.sort(),
      size: members.length,
    };
  });
}

/**
 * Returns the community containing filePath, or null if the file is not
 * in any community (isolated file with no local_import edges).
 */
export function getCommunityForFile(filePath: string): CommunityResult | null {
  const sqlite = getSqlite();
  const row = sqlite.prepare(
    'SELECT community_id FROM file_communities WHERE file_path = ?'
  ).get(filePath) as { community_id: number } | undefined;
  if (!row) return null;

  // Fetch all members of that community
  const memberRows = sqlite.prepare(
    'SELECT file_path FROM file_communities WHERE community_id = ?'
  ).all(row.community_id) as Array<{ file_path: string }>;
  const members = memberRows.map(r => r.file_path);

  // Determine representative
  const allFiles = getAllFiles();
  const importances = new Map(allFiles.map(f => [f.path, f.importance ?? 0]));
  const representative = members.reduce((best, path) => {
    return (importances.get(path) ?? 0) >= (importances.get(best) ?? 0) ? path : best;
  }, members[0]);

  return {
    communityId: row.community_id,
    representative,
    members: members.sort(),
    size: members.length,
  };
}

