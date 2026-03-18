// src/db/repository.ts
// Typed CRUD functions for the FileScopeMCP SQLite persistence layer.
// Hides SQL/Drizzle from callers — all interactions go through these functions.
// Per RESEARCH.md Pattern 3.
import { eq, like, asc, or } from 'drizzle-orm';
import { getDb, getSqlite } from './db.js';
import { files, file_dependencies, llm_jobs } from './schema.js';
import type { FileNode, PackageDependency } from '../types.js';
import type { ExportSnapshot } from '../change-detector/types.js';

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
 * Inserts a pending LLM job only if no pending job with the same (file_path, job_type)
 * already exists. Prevents duplicate job rows when cascades overlap.
 * Uses getSqlite() for the existence check (raw SELECT) then delegates to insertLlmJob.
 *
 * Optional `payload` parameter passes context to the LLM job (e.g., git diff content
 * for change_impact jobs). Existing callers without payload continue to work unchanged.
 */
export function insertLlmJobIfNotPending(
  filePath: string,
  jobType: 'summary' | 'concepts' | 'change_impact',
  priorityTier: number,
  payload?: string
): void {
  const sqlite = getSqlite();
  const existing = sqlite
    .prepare(
      "SELECT 1 FROM llm_jobs WHERE file_path = ? AND job_type = ? AND status = 'pending' LIMIT 1"
    )
    .get(filePath, jobType);
  if (existing) return;
  insertLlmJob({ file_path: filePath, job_type: jobType, priority_tier: priorityTier, payload });
}

// ─── LLM jobs ─────────────────────────────────────────────────────────────────

/**
 * Inserts a new pending LLM job into the llm_jobs table.
 * Used by the change detection system to queue async LLM classification jobs
 * for unsupported languages (CHNG-03).
 */
export function insertLlmJob(params: {
  file_path: string;
  job_type: 'summary' | 'concepts' | 'change_impact';
  priority_tier: number;
  payload?: string;
}): void {
  const db = getDb();
  db.insert(llm_jobs)
    .values({
      file_path: params.file_path,
      job_type: params.job_type,
      priority_tier: params.priority_tier,
      status: 'pending',
      created_at: new Date(Date.now()),
      payload: params.payload ?? null,
    })
    .run();
}

// ─── LLM pipeline job management ──────────────────────────────────────────────

/**
 * Dequeues the next pending LLM job ordered by priority_tier ASC, created_at ASC.
 * Returns null if the queue is empty.
 * Uses a raw prepared statement for minimal latency on the hot dequeue path.
 */
export function dequeueNextJob(): {
  job_id: number;
  file_path: string;
  job_type: string;
  priority_tier: number;
  payload: string | null;
} | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare(
      "SELECT job_id, file_path, job_type, priority_tier, payload FROM llm_jobs WHERE status = 'pending' ORDER BY priority_tier ASC, created_at ASC LIMIT 1"
    )
    .get() as {
      job_id: number;
      file_path: string;
      job_type: string;
      priority_tier: number;
      payload: string | null;
    } | undefined;

  return row ?? null;
}

/**
 * Marks a job as in_progress, recording the start timestamp.
 */
export function markJobInProgress(jobId: number): void {
  const sqlite = getSqlite();
  sqlite
    .prepare(
      "UPDATE llm_jobs SET status = 'in_progress', started_at = ? WHERE job_id = ?"
    )
    .run(Date.now(), jobId);
}

/**
 * Marks a job as done, recording the completion timestamp.
 */
export function markJobDone(jobId: number): void {
  const sqlite = getSqlite();
  sqlite
    .prepare(
      "UPDATE llm_jobs SET status = 'done', completed_at = ? WHERE job_id = ?"
    )
    .run(Date.now(), jobId);
}

/**
 * Marks a job as failed, recording the completion timestamp and error message.
 */
export function markJobFailed(jobId: number, errorMessage: string): void {
  const sqlite = getSqlite();
  sqlite
    .prepare(
      "UPDATE llm_jobs SET status = 'failed', completed_at = ?, error_message = ? WHERE job_id = ?"
    )
    .run(Date.now(), errorMessage, jobId);
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

/**
 * Recovers orphaned in_progress jobs left by a previous crashed process.
 * Sets status back to 'pending' and clears started_at.
 * Returns the number of jobs recovered.
 * Per RESEARCH.md Pitfall 3.
 */
export function recoverOrphanedJobs(): number {
  const sqlite = getSqlite();
  const result = sqlite
    .prepare(
      "UPDATE llm_jobs SET status = 'pending', started_at = NULL WHERE status = 'in_progress'"
    )
    .run();
  return result.changes;
}

// ─── LLM runtime state persistence ────────────────────────────────────────────

/**
 * Loads a value from the llm_runtime_state key-value table.
 * Returns null if the key does not exist.
 * Used to persist token budget state across process restarts (RESEARCH.md Pitfall 4).
 */
export function loadLlmRuntimeState(key: string): string | null {
  const sqlite = getSqlite();
  const row = sqlite
    .prepare('SELECT value FROM llm_runtime_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Saves a value to the llm_runtime_state key-value table.
 * Uses INSERT OR REPLACE for upsert semantics.
 */
export function saveLlmRuntimeState(key: string, value: string): void {
  const sqlite = getSqlite();
  sqlite
    .prepare('INSERT OR REPLACE INTO llm_runtime_state (key, value) VALUES (?, ?)')
    .run(key, value);
}
