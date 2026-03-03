// src/db/repository.ts
// Typed CRUD functions for the FileScopeMCP SQLite persistence layer.
// Hides SQL/Drizzle from callers — all interactions go through these functions.
// Per RESEARCH.md Pattern 3.
import { eq, like, asc, or } from 'drizzle-orm';
import { getDb } from './db.js';
import { files, file_dependencies } from './schema.js';
import type { FileNode, PackageDependency } from '../types.js';

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
        summary_stale_since: row.summary_stale_since,
        concepts_stale_since: row.concepts_stale_since,
        change_impact_stale_since: row.change_impact_stale_since,
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
