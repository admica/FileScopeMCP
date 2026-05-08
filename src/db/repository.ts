// src/db/repository.ts
// Typed CRUD functions for the FileScopeMCP SQLite persistence layer.
// Hides SQL/Drizzle from callers — all interactions go through these functions.
// Per RESEARCH.md Pattern 3.
import { eq, like, asc, or } from 'drizzle-orm';
import { getDb, getSqlite } from './db.js';
import { files, file_dependencies } from './schema.js';
import { relativizePath, tryRelativizePath, absolutifyPath } from '../file-utils.js';
import type { FileNode, PackageDependency } from '../types.js';
import type { ExportSnapshot } from '../change-detector/types.js';
import type { EdgeResult } from '../language-config.js';
import type { CommunityResult } from '../community-detection.js';
import type { Symbol as SymbolRow, SymbolKind } from './symbol-types.js';
import type { ImportMeta } from '../change-detector/ast-parser.js';

// ─── Project root state ────────────────────────────────────────────────────────
// Set once per init by coordinator.ts (mirrors the getSqlite() handle pattern).
// Required for the abs↔rel path translation done at every SQL boundary in this
// module — the DB stores paths relative to projectRoot for host portability,
// while callers continue to deal in absolute paths.
//
// Named distinctly from global-state.setProjectRoot() (which resets exclude
// caches as a side effect) — that module owns its own root for unrelated
// concerns. This one is purely the abs↔rel translation chokepoint.
//
// Default '' (empty) is identity-passthrough: no translation, paths stored as
// given. This keeps test fixtures that use absolute paths working without
// any special setup. Production wiring in coordinator.init() must call
// setRepoProjectRoot() with the real root for portability to take effect.
let _projectRoot: string = '';

export function setRepoProjectRoot(root: string): void {
  _projectRoot = root;
}

/**
 * For tests and shutdown only. Resets to identity-passthrough mode.
 */
export function clearRepoProjectRoot(): void {
  _projectRoot = '';
}

/**
 * Internal: translate an inbound absolute path to its DB-stored relative form.
 * Empty root → identity passthrough (test mode). Throws if the path is not
 * under projectRoot — use `relInOrNull` when an out-of-root input is expected
 * and should be skipped silently (extracted cross-project edges).
 */
function relIn(absPath: string): string {
  if (_projectRoot === '') return absPath;
  return relativizePath(absPath, _projectRoot);
}

/**
 * Internal: same as relIn but returns null on out-of-root rather than throwing.
 * Use at write sites where extractor output may include cross-project refs.
 */
function relInOrNull(absPath: string): string | null {
  if (_projectRoot === '') return absPath;
  return tryRelativizePath(absPath, _projectRoot);
}

/**
 * Internal: translate an outbound DB-stored relative path back to absolute.
 * Empty root → identity passthrough.
 */
function absOut(relPath: string): string {
  if (_projectRoot === '') return relPath;
  return absolutifyPath(relPath, _projectRoot);
}

/**
 * Translate an absolute path to the DB-stored form. Returns the input
 * unchanged in test/passthrough mode (no project root bound).
 *
 * Exported for the small number of call sites that bypass repository.ts to
 * issue raw SQL with WHERE/UPDATE on path columns. They need to match the
 * stored form. Keep this surface tiny; prefer a repo function when one
 * already exists.
 */
export function toStoredPath(absPath: string): string {
  return relIn(absPath);
}

/**
 * Translate a DB-stored path back to absolute. Mirror of toStoredPath.
 */
export function fromStoredPath(storedPath: string): string {
  return absOut(storedPath);
}

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
 *
 * Path translation: row.path is the DB-stored relative form; the FileNode
 * exposed to callers carries the absolute form (MCP client contract).
 */
function rowToFileNode(row: FileRow, withDeps = false): FileNode {
  const absPath = absOut(row.path);
  const node: FileNode = {
    path: absPath,
    name: row.name,
    isDirectory: Boolean(row.is_directory),
    importance: row.importance ?? 0,
    summary: row.summary ?? undefined,
    mtime: row.mtime ?? undefined,
  };

  if (withDeps) {
    // Pass the absolute path through — these are public API functions that
    // accept absolute and re-relativize internally.
    node.dependencies = getDependencies(absPath);
    node.dependents = getDependents(absPath);
    node.packageDependencies = getPackageDependencies(absPath);
  }

  return node;
}

/**
 * Convert a FileNode to a DB files row insert object.
 * Caller-supplied absolute path is relativized against projectRoot for storage.
 */
function fileNodeToRow(node: FileNode): typeof files.$inferInsert {
  return {
    path: relIn(node.path),
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
 * Public callers pass an absolute filePath; internal SQL uses relative form.
 */
function getPackageDependencies(filePath: string): PackageDependency[] {
  const db = getDb();
  const relSource = relIn(filePath);
  const rows = db
    .select()
    .from(file_dependencies)
    .where(
      eq(file_dependencies.source_path, relSource)
    )
    .all()
    .filter((r: DepRow) => r.dependency_type === 'package_import');

  return rows.map((r: DepRow) => {
    const pkg = {
      name: r.package_name ?? '',
      version: r.package_version ?? undefined,
      // Package targets stored relative when in-tree (e.g. node_modules/...);
      // absOut rehydrates uniformly. Out-of-tree package edges were rejected
      // at write time and will never appear in this result set.
      path: absOut(r.target_path),
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
  const row = db.select().from(files).where(eq(files.path, relIn(filePath))).get();
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
 * Deletes a file by path. Atomically removes (Phase 37 CSE-05 five-step cascade):
 *   1. Materializes symbol IDs BEFORE the symbols DELETE (ordering is load-bearing — D-21).
 *   2. Both-sides DELETE on symbol_dependencies: the file is gone entirely so
 *      both caller-side AND callee-side rows must be removed. Unlike setEdgesAndSymbols
 *      (caller-side only), deleteFile uses both-sides deletion because no eventual-
 *      consistency window applies — the file no longer exists.
 *   3. All file_dependencies rows where this file is source or target.
 *   4. All symbols rows for this path.
 *   5. The files row itself.
 * All steps run in a single better-sqlite3 transaction so a crash leaves the DB
 * in a consistent state (prior to Phase 35 these deletes ran non-atomically;
 * Phase 37 extends to cover symbol_dependencies — D-20).
 */
export function deleteFile(filePath: string): void {
  const sqlite = getSqlite();
  const db = getDb();
  const relPath = relIn(filePath);
  const tx = sqlite.transaction(() => {
    // Phase 37 CSE-05 — five-step cascade. Ordering is load-bearing:
    // Step 1 MUST materialize IDs BEFORE Step 4 deletes symbols (D-21).

    // Step 1: materialize symbol IDs before the symbols row is deleted.
    const symbolIds = (sqlite
      .prepare('SELECT id FROM symbols WHERE path = ?')
      .all(relPath) as Array<{ id: number }>)
      .map(r => r.id);

    // Step 2: both-sides DELETE on symbol_dependencies.
    // Unlike setEdgesAndSymbols (caller-side only), deleteFile
    // clears BOTH caller and callee rows because the file is
    // gone entirely — no eventual-consistency window applies.
    // Guard: empty IN () is a SQL syntax error; skip when no symbols.
    if (symbolIds.length > 0) {
      const placeholders = symbolIds.map(() => '?').join(', ');
      sqlite
        .prepare(
          `DELETE FROM symbol_dependencies
           WHERE caller_symbol_id IN (${placeholders})
              OR callee_symbol_id IN (${placeholders})`
        )
        .run(...symbolIds, ...symbolIds);
    }

    // Step 3: file_dependencies (source OR target side) — existing, unchanged.
    db.delete(file_dependencies)
      .where(
        or(
          eq(file_dependencies.source_path, relPath),
          eq(file_dependencies.target_path, relPath)
        )
      )
      .run();

    // Step 4: symbols — existing, unchanged.
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(relPath);

    // Step 5: files — existing, unchanged.
    db.delete(files).where(eq(files.path, relPath)).run();
  });
  tx();
}

/**
 * Returns immediate children of a directory (one level deep only).
 * Uses LIKE prefix query + post-filter for the immediate-child constraint.
 * Per RESEARCH.md Pattern 3.
 */
export function getChildren(dirPath: string): FileNode[] {
  const db = getDb();
  // Translate to relative form for SQL match, then build a prefix that selects
  // descendants. Special-case the root directory: relIn(projectRoot) === '',
  // so the prefix is just '%' and remainder == r.path (still relative).
  const relDir = relIn(dirPath);
  const prefix = relDir === '' ? '' : (relDir.endsWith('/') ? relDir : `${relDir}/`);
  const likePattern = prefix === '' ? '%' : `${prefix}%`;
  const rows = db
    .select()
    .from(files)
    .where(like(files.path, likePattern))
    .orderBy(asc(files.path))
    .all();

  return rows
    .filter((r: FileRow) => {
      const remainder = prefix === '' ? r.path : r.path.slice(prefix.length);
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
    .where(eq(file_dependencies.source_path, relIn(filePath)))
    .all()
    .filter((r: DepRow) => r.dependency_type === 'local_import')
    .map((r: DepRow) => absOut(r.target_path));
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
  const rows = sqlite
    .prepare(
      "SELECT target_path, edge_type, confidence FROM file_dependencies WHERE source_path = ? AND dependency_type = 'local_import'"
    )
    .all(relIn(filePath)) as Array<{ target_path: string; edge_type: string; confidence: number }>;
  return rows.map(r => ({ ...r, target_path: absOut(r.target_path) }));
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
    .where(eq(file_dependencies.target_path, relIn(filePath)))
    .all()
    .map((r: { source: string }) => absOut(r.source));
}

/**
 * Phase 34 SUM-02 + D-18. Returns dependents enriched with the imported-name
 * metadata populated by phase 33 (imported_names JSON column + import_line).
 * One entry per source_path; names deduped + alphabetically sorted; lines
 * ascending. Only `local_import` rows are considered (package_import excluded,
 * matching getDependenciesWithEdgeMetadata at :220).
 *
 * NULL imported_names → []; NULL import_line → excluded (D-14). Never returns null on wire.
 */
export function getDependentsWithImports(targetPath: string): Array<{
  path: string;
  importedNames: string[];
  importLines: number[];
}> {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(
      `SELECT source_path, imported_names, import_line
       FROM file_dependencies
       WHERE target_path = ? AND dependency_type = 'local_import'`
    )
    .all(relIn(targetPath)) as Array<{
      source_path: string;
      imported_names: string | null;
      import_line: number | null;
    }>;

  const bySource = new Map<string, { names: Set<string>; lines: number[] }>();
  for (const r of rows) {
    let bucket = bySource.get(r.source_path);
    if (!bucket) {
      bucket = { names: new Set(), lines: [] };
      bySource.set(r.source_path, bucket);
    }
    // D-14: NULL → []; malformed JSON → [] (matches getExportsSnapshot:488 semantics)
    if (r.imported_names !== null) {
      try {
        const arr = JSON.parse(r.imported_names) as unknown;
        if (Array.isArray(arr)) {
          for (const n of arr) {
            if (typeof n === 'string') bucket.names.add(n);
          }
        }
      } catch {
        /* corrupt JSON — treat as empty; do not throw */
      }
    }
    if (r.import_line !== null) bucket.lines.push(r.import_line);
  }

  return Array.from(bySource.entries())
    .map(([path, { names, lines }]) => ({
      path: absOut(path),
      importedNames: Array.from(names).sort(),          // alphabetical (stable diffs, CONTEXT Specifics §)
      importLines: lines.slice().sort((a, b) => a - b), // ascending per D-13
    }))
    .sort((a, b) => a.path.localeCompare(b.path));      // D-15
}

/**
 * Returns all local_import dependency edges in one batch query.
 * Used by cycle detection to build the full dependency graph without N+1 queries.
 * Package imports are excluded — they are not actionable for cycle detection.
 */
export function getAllLocalImportEdges(): Array<{ source_path: string; target_path: string }> {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(
      "SELECT source_path, target_path FROM file_dependencies WHERE dependency_type = 'local_import'"
    )
    .all() as Array<{ source_path: string; target_path: string }>;
  return rows.map(r => ({ source_path: absOut(r.source_path), target_path: absOut(r.target_path) }));
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
  const rows = sqlite
    .prepare(
      "SELECT source_path, target_path, weight FROM file_dependencies WHERE dependency_type = 'local_import'"
    )
    .all() as Array<{ source_path: string; target_path: string; weight: number }>;
  return rows.map(r => ({ ...r, source_path: absOut(r.source_path), target_path: absOut(r.target_path) }));
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
  const relSource = relIn(sourcePath);

  // Delete all existing dependency rows for this source
  db.delete(file_dependencies)
    .where(eq(file_dependencies.source_path, relSource))
    .run();

  // Insert local imports — drop edges to cross-project files (extractor output
  // can include resolved targets outside projectRoot, e.g. ../sibling-pkg).
  // Equivalent to today's purge-on-init behavior, just enforced at write time.
  for (const targetPath of localDeps) {
    const relTarget = relInOrNull(targetPath);
    if (relTarget === null) continue;
    db.insert(file_dependencies)
      .values({
        source_path: relSource,
        target_path: relTarget,
        dependency_type: 'local_import',
        package_name: null,
        package_version: null,
        is_dev_dependency: null,
      })
      .run();
  }

  // Insert package imports with metadata — same out-of-root drop policy.
  for (const pkg of packageDeps) {
    const relPkgTarget = relInOrNull(pkg.path);
    if (relPkgTarget === null) continue;
    db.insert(file_dependencies)
      .values({
        source_path: relSource,
        target_path: relPkgTarget,
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
 *
 * Phase 33 IMP-03 extension: when `importMeta` is provided, each edge's
 * `imported_names` (JSON string array) and `import_line` (INTEGER) columns are
 * populated by matching `edge.originalSpecifier` to `meta.specifier`. When
 * multiple metas share the same specifier (D-08 — two imports to the same
 * target), they are CONSUMED in order so each edge row keeps a distinct line.
 * Package edges carrying a matching specifier also get metadata; edges with no
 * matching meta get NULL values (preserves non-TS/JS NULL per D-10).
 */
export function setEdges(
  sourcePath: string,
  edges: EdgeResult[],
  importMeta?: ImportMeta[]
): void {
  const db = getDb();
  const relSource = relIn(sourcePath);

  // Delete all existing dependency rows for this source
  db.delete(file_dependencies)
    .where(eq(file_dependencies.source_path, relSource))
    .run();

  // Group metas by specifier — when two imports share the same specifier (D-08),
  // CONSUME them in order so each edge row gets its own import_line.
  const metaBySpec = new Map<string, ImportMeta[]>();
  if (importMeta) {
    for (const m of importMeta) {
      const list = metaBySpec.get(m.specifier) ?? [];
      list.push(m);
      metaBySpec.set(m.specifier, list);
    }
  }

  for (const edge of edges) {
    // Drop edges whose target lies outside projectRoot — they would store as
    // '..'-relative paths, breaking host portability. The metadata consume-
    // pointer must still advance for the discarded edge so subsequent edges
    // sharing a specifier get the correct line (D-08 invariant).
    const relTarget = relInOrNull(edge.target);

    let importedNamesJson: string | null = null;
    let importLineVal:    number | null = null;
    const spec = edge.originalSpecifier;
    if (spec) {
      const list = metaBySpec.get(spec);
      if (list && list.length > 0) {
        const meta = list.shift()!;   // consume in arrival order
        importedNamesJson = JSON.stringify(meta.importedNames);
        importLineVal     = meta.line;
      }
    }

    if (relTarget === null) continue;

    db.insert(file_dependencies).values({
      source_path:       relSource,
      target_path:       relTarget,
      dependency_type:   edge.isPackage ? 'package_import' : 'local_import',
      package_name:      edge.packageName ?? null,
      package_version:   edge.packageVersion ?? null,
      is_dev_dependency: null,
      edge_type:         edge.edgeType,
      confidence:        edge.confidence,
      confidence_source: edge.confidenceSource,
      weight:            edge.weight,
      imported_names:    importedNamesJson,
      import_line:       importLineVal,
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

/**
 * Like `getAllFiles`, but populates `dependencies`, `dependents`, and
 * `packageDependencies` on every returned FileNode by joining `file_dependencies`.
 *
 * Use this when the caller will pass the resulting tree to logic that depends
 * on edge counts — most importantly `calculateNodeImportance`, which adds up
 * to +6 from the dependents/dependencies/packageDeps caps. The default
 * `getAllFiles()` skips this work for performance; using it where dep counts
 * are required produces silently underweighted importance values because
 * every node looks like a leaf.
 *
 * Note: `dependents` here comes directly from `getDependents()` (same
 * `file_dependencies` table). Callers do NOT need to also run
 * `buildDependentMap` — that walks `node.dependencies` to derive the reverse
 * map from the same source of truth, so it would be redundant work.
 *
 * Cost: one SELECT per file across three small per-path lookups. For repos in
 * the hundreds of files this is ~ms; for very large repos consider batching.
 */
export function getAllFilesWithDeps(): FileNode[] {
  const db = getDb();
  return db
    .select()
    .from(files)
    .orderBy(asc(files.path))
    .all()
    .map((r: FileRow) => rowToFileNode(r, true));
}

// ─── Purge stale records ─────────────────────────────────────────────────────

/**
 * Deletes files, dependency edges, symbols, and symbol_dependencies whose
 * paths satisfy the provided predicate.
 *
 * Used to clean up records whose paths now match a newly-added exclude pattern
 * (e.g. when `.claude/worktrees/` is added to excludes but the DB still has
 * entries from earlier scans). Caller supplies the predicate so this module
 * stays independent of the file-utils glob machinery (avoiding an import cycle).
 *
 * Predicate contract: receives ABSOLUTE paths (matching how isExcluded() and
 * other glob-based predicates think). Internal SQL operates on the relative
 * stored form; absOut() rehydrates each row's path before predicate eval, and
 * the relative form is fed back into the DELETEs.
 */
export function purgeRecordsMatching(
  shouldPurge: (filePath: string) => boolean,
): { files: number; deps: number; symbols: number; symbolDeps: number } {
  const sqlite = getSqlite();
  const filePathRows = sqlite.prepare('SELECT path FROM files').all() as Array<{ path: string }>;
  const symbolPathRows = sqlite.prepare('SELECT DISTINCT path FROM symbols').all() as Array<{ path: string }>;

  // Predicate runs against absolute form; collected rel paths feed the DELETEs.
  const filesToDelete: string[] = filePathRows
    .filter(r => shouldPurge(absOut(r.path)))
    .map(r => r.path);
  const symbolPathsToDelete: string[] = symbolPathRows
    .filter(r => shouldPurge(absOut(r.path)))
    .map(r => r.path);

  if (filesToDelete.length === 0 && symbolPathsToDelete.length === 0) {
    return { files: 0, deps: 0, symbols: 0, symbolDeps: 0 };
  }

  const deleteFileStmt = sqlite.prepare('DELETE FROM files WHERE path = ?');
  const deleteDepStmt = sqlite.prepare(
    'DELETE FROM file_dependencies WHERE source_path = ? OR target_path = ?'
  );
  // symbol_dependencies references symbols by id — purge edges first, then symbols.
  const deleteSymDepStmt = sqlite.prepare(
    `DELETE FROM symbol_dependencies
     WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE path = ?)
        OR callee_symbol_id IN (SELECT id FROM symbols WHERE path = ?)`
  );
  const deleteSymStmt = sqlite.prepare('DELETE FROM symbols WHERE path = ?');

  let files = 0;
  let deps = 0;
  let symbols = 0;
  let symbolDeps = 0;
  const tx = sqlite.transaction((fPaths: string[], sPaths: string[]) => {
    for (const p of fPaths) {
      deps += deleteDepStmt.run(p, p).changes;
      files += deleteFileStmt.run(p).changes;
    }
    for (const p of sPaths) {
      symbolDeps += deleteSymDepStmt.run(p, p).changes;
      symbols += deleteSymStmt.run(p).changes;
    }
  });
  tx(filesToDelete, symbolPathsToDelete);

  markCommunitiesDirty();
  return { files, deps, symbols, symbolDeps };
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
    .get(relIn(filePath)) as { exports_snapshot: string | null } | undefined;

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
  const relPath = relIn(filePath);

  // Try update first; if no row exists, insert a minimal row with the snapshot.
  // The files table requires path and name to be NOT NULL.
  const updated = sqlite
    .prepare('UPDATE files SET exports_snapshot = ? WHERE path = ?')
    .run(json, relPath);

  if (updated.changes === 0) {
    // Row doesn't exist — insert with minimal required fields. Derive `name`
    // from the original absolute path (filePath), not relPath, to preserve
    // basename behavior when relPath is the root '' (empty).
    const name = filePath.split('/').pop() ?? filePath;
    sqlite
      .prepare(
        'INSERT INTO files (path, name, is_directory, exports_snapshot) VALUES (?, ?, 0, ?)'
      )
      .run(relPath, name, json);
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
    .get(relIn(filePath)) as {
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
 * Tokenize a search query into individual terms.
 *
 * Behavior:
 *   - "quoted phrases" become single tokens (preserved verbatim, lowercased)
 *   - whitespace-separated bare words become individual tokens
 *   - tokens shorter than 2 chars are dropped (function words rarely match meaningfully)
 *   - SQL LIKE wildcards (% and _) are stripped from each token so user input
 *     can't accidentally widen the search
 *   - duplicates are removed
 *
 * Returns the tokens in stable order; an empty array means "no useful tokens"
 * and the caller should short-circuit to empty results.
 */
function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];

  // Extract quoted phrases first; treat each as a single token.
  const phraseRegex = /"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = phraseRegex.exec(query)) !== null) {
    tokens.push(m[1].trim().toLowerCase());
  }
  // Strip the phrases from the remainder so they don't get re-tokenized as words.
  const remainder = query.replace(phraseRegex, ' ');

  for (const tok of remainder.split(/\s+/)) {
    const cleaned = tok.trim().toLowerCase();
    if (cleaned.length >= 2) tokens.push(cleaned);
  }

  // Strip SQL LIKE wildcards (% and _) so user input can't widen the search.
  const stripped = tokens
    .map(t => t.replace(/[%_]/g, '').trim())
    .filter(t => t.length > 0);

  // Dedupe (preserve first-seen order).
  return Array.from(new Set(stripped));
}

/**
 * Searches across all stored file metadata: symbols, purpose, summaries, and paths.
 *
 * The query is tokenized (whitespace-split, "quoted phrases" preserved, short
 * function words dropped). Each token is matched independently against the
 * indexed columns; per-row scores sum across tokens. A row that matches more
 * tokens — or matches them in higher-ranked columns — surfaces above one with
 * fewer/weaker hits. Tokens that don't hit anything contribute zero (graceful
 * AND-degradation: e.g., "how do I add a language" matches files where
 * "language" is a meaningful term, since `how`/`do`/`a` won't hit).
 *
 * Per-token column ranks (carried from SEARCH_SQL):
 *   symbol = 100, purpose / affectedAreas = 50, summary = 20, path = 10
 *
 * Sort: total_rank DESC, hit_count DESC, importance DESC.
 */
export function searchFiles(query: string, maxItems: number = 10): {
  results: Array<{ path: string; importance: number; purpose: string | null; matchRank: number }>;
  query: string;
  truncated?: boolean;
} {
  if (!query || !query.trim()) {
    return { results: [], query: query || '' };
  }

  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) {
    return { results: [], query: query.trim() };
  }

  const sqlite = getSqlite();
  const stmt = sqlite.prepare(SEARCH_SQL);

  // Per-path aggregate. With ~hundreds of files per repo and ≤10 tokens per
  // realistic query, this stays small — no need for a database-side aggregation.
  type Aggregate = {
    path: string;
    importance: number;
    purpose: string | null;
    totalRank: number;
    hitCount: number;
  };
  const aggregate = new Map<string, Aggregate>();

  // Per-token row cap: high enough that no realistic single-token query is
  // truncated below useful coverage, low enough to bound work on huge repos.
  const PER_TOKEN_LIMIT = 500;

  for (const tok of tokens) {
    const pattern = `%${tok}%`;
    const rows = stmt.all({ pattern, limit: PER_TOKEN_LIMIT }) as Array<{
      path: string;
      name: string;
      importance: number | null;
      purpose: string | null;
      match_rank: number;
    }>;
    for (const r of rows) {
      const existing = aggregate.get(r.path);
      if (existing) {
        existing.totalRank += r.match_rank;
        existing.hitCount += 1;
      } else {
        aggregate.set(r.path, {
          path: r.path,
          importance: r.importance ?? 0,
          purpose: r.purpose ?? null,
          totalRank: r.match_rank,
          hitCount: 1,
        });
      }
    }
  }

  const sorted = [...aggregate.values()].sort((a, b) =>
    (b.totalRank - a.totalRank)
    || (b.hitCount - a.hitCount)
    || (b.importance - a.importance)
  );

  const truncated = sorted.length > maxItems;
  const resultRows = truncated ? sorted.slice(0, maxItems) : sorted;

  return {
    results: resultRows.map(r => ({
      path: absOut(r.path),
      importance: r.importance,
      purpose: r.purpose,
      matchRank: r.totalRank,
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
      stmt.run(timestamp, timestamp, timestamp, relIn(p));
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
    .run(result, relIn(filePath));
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
    .run(relIn(filePath));
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
        stmt.run(c.communityId, relIn(filePath));
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

  // Group by community_id — keep paths in stored (relative) form throughout
  // the importance lookup against allFiles (which already returns absolute via
  // rowToFileNode). Absolutify members at the boundary before returning.
  const groups = new Map<number, string[]>();
  for (const row of rows) {
    if (!groups.has(row.community_id)) groups.set(row.community_id, []);
    groups.get(row.community_id)!.push(absOut(row.file_path));
  }

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
  ).get(relIn(filePath)) as { community_id: number } | undefined;
  if (!row) return null;

  // Fetch all members of that community — stored relative, return absolute.
  const memberRows = sqlite.prepare(
    'SELECT file_path FROM file_communities WHERE community_id = ?'
  ).all(row.community_id) as Array<{ file_path: string }>;
  const members = memberRows.map(r => absOut(r.file_path));

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

// ─── Symbol persistence (Phase 33 SYM-04) ───────────────────────────────

/**
 * Replace all symbol rows for the given path in a single transaction.
 * Matches setCommunities pattern: raw better-sqlite3 prepared statements.
 * Empty `syms` array is valid — it clears all symbols for that path.
 */
export function upsertSymbols(filePath: string, syms: SymbolRow[]): void {
  const sqlite = getSqlite();
  const relPath = relIn(filePath);
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(relPath);
    if (syms.length === 0) return;
    const stmt = sqlite.prepare(
      'INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const s of syms) {
      stmt.run(relPath, s.name, s.kind, s.startLine, s.endLine, s.isExport ? 1 : 0);
    }
  });
  tx();
}

interface SymbolDbRow {
  path: string;
  name: string;
  kind: string;
  start_line: number;
  end_line: number;
  is_export: number;
}

function rowToSymbol(r: SymbolDbRow): SymbolRow & { path: string } {
  return {
    path:      absOut(r.path),
    name:      r.name,
    kind:      r.kind as SymbolKind,
    startLine: r.start_line,
    endLine:   r.end_line,
    isExport:  r.is_export === 1,
  };
}

/**
 * Return all symbols matching `name`, optionally filtered by `kind`.
 * Case-sensitive exact match (prefix/wildcards are Phase 34's concern).
 */
export function getSymbolsByName(name: string, kind?: SymbolKind): Array<SymbolRow & { path: string }> {
  const sqlite = getSqlite();
  const rows = kind
    ? sqlite.prepare('SELECT path, name, kind, start_line, end_line, is_export FROM symbols WHERE name = ? AND kind = ?').all(name, kind) as SymbolDbRow[]
    : sqlite.prepare('SELECT path, name, kind, start_line, end_line, is_export FROM symbols WHERE name = ?').all(name) as SymbolDbRow[];
  return rows.map(rowToSymbol);
}

// ─── Phase 34 find_symbol support (FIND-01..04, D-17) ──────────────────

/**
 * Escape GLOB metacharacters (`*`, `?`, `[`) in a user-supplied string by wrapping
 * each in a bracket class. `]` alone doesn't need escaping outside a bracket class.
 * Used by buildNamePredicate to safeguard literal metachars inside a user search term.
 */
function escapeGlobMeta(s: string): string {
  return s.replace(/([*?\[])/g, '[$1]');
}

/**
 * Build the WHERE name predicate for findSymbols per D-01:
 *   - trailing `*` → prefix mode (GLOB, escape other metachars in the prefix body)
 *   - no trailing `*` → exact match (=, any interior `*` treated as literal)
 * Case-sensitivity comes from SQLite's GLOB (always case-sensitive per SQLite docs)
 * and from `=` (always exact). No PRAGMA needed.
 */
function buildNamePredicate(name: string): { namePredicate: string; nameParam: string } {
  if (name.endsWith('*')) {
    const prefix = escapeGlobMeta(name.slice(0, -1));
    return { namePredicate: 'name GLOB ?', nameParam: prefix + '*' };
  }
  return { namePredicate: 'name = ?', nameParam: name };
}

/**
 * Phase 34 FIND-01..04 + D-17. Returns matching symbols + pre-truncation count.
 * Two prepared statements against the same connection (COUNT + slice).
 *
 * Matching (D-01/D-03): trailing `*` triggers GLOB prefix match, otherwise `=` exact match.
 * Case-sensitive natively (SQLite GLOB is always case-sensitive; no PRAGMA session toggle).
 * Kind filter (D-06): if provided but unrecognized, SQL returns 0 rows — caller never errors.
 * exportedOnly (FIND-03): when true, WHERE adds `is_export = 1`; when false, omitted.
 * Ordering (D-05): is_export DESC, path ASC, start_line ASC.
 * Limit (D-04): applied in SQL; total is pre-LIMIT.
 */
export function findSymbols(opts: {
  name: string;
  kind?: SymbolKind;
  exportedOnly: boolean;
  limit: number;
}): { items: Array<SymbolRow & { path: string }>; total: number } {
  const sqlite = getSqlite();
  const { namePredicate, nameParam } = buildNamePredicate(opts.name);

  const whereParts: string[] = [namePredicate];
  const params: unknown[] = [nameParam];
  if (opts.kind) {
    whereParts.push('kind = ?');
    params.push(opts.kind);
  }
  if (opts.exportedOnly) {
    whereParts.push('is_export = 1');
  }
  const whereSQL = whereParts.join(' AND ');

  const total = (sqlite
    .prepare(`SELECT COUNT(*) AS n FROM symbols WHERE ${whereSQL}`)
    .get(...params) as { n: number }).n;

  const rows = sqlite
    .prepare(
      `SELECT path, name, kind, start_line, end_line, is_export
       FROM symbols
       WHERE ${whereSQL}
       ORDER BY is_export DESC, path ASC, start_line ASC
       LIMIT ?`
    )
    .all(...params, opts.limit) as SymbolDbRow[];

  return { items: rows.map(rowToSymbol), total };
}

/**
 * Find all symbols that call the named symbol (callers of a callee).
 *
 * Resolves target symbol IDs by name (+ optional filePath to disambiguate).
 * Excludes self-loops (caller_symbol_id == callee_symbol_id).
 * Returns {items, total, unresolvedCount}:
 *   - total: pre-LIMIT count (post-self-loop-filter)
 *   - unresolvedCount: edges where caller_symbol_id no longer exists in symbols table
 */
export function getCallers(
  name: string,
  filePath?: string,
  limit: number = 50
): { items: Array<{ path: string; name: string; kind: string; startLine: number; confidence: number }>; total: number; unresolvedCount: number } {
  const sqlite = getSqlite();

  // Step 1: resolve target (callee) symbol IDs
  const targetRows = filePath
    ? sqlite.prepare('SELECT id FROM symbols WHERE name = ? AND path = ?').all(name, relIn(filePath)) as Array<{ id: number }>
    : sqlite.prepare('SELECT id FROM symbols WHERE name = ?').all(name) as Array<{ id: number }>;

  if (targetRows.length === 0) return { items: [], total: 0, unresolvedCount: 0 };

  const ids = targetRows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(', ');

  // Step 2: COUNT pre-LIMIT, self-loop excluded
  const total = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM symbol_dependencies
     WHERE callee_symbol_id IN (${placeholders})
       AND caller_symbol_id != callee_symbol_id`
  ).get(...ids) as { n: number }).n;

  // Step 3: SELECT with LIMIT + JOIN for caller info
  const rows = sqlite.prepare(
    `SELECT s.path, s.name, s.kind, s.start_line, sd.confidence
     FROM symbol_dependencies sd
     INNER JOIN symbols s ON s.id = sd.caller_symbol_id
     WHERE sd.callee_symbol_id IN (${placeholders})
       AND sd.caller_symbol_id != sd.callee_symbol_id
     ORDER BY s.path ASC, s.start_line ASC
     LIMIT ?`
  ).all(...ids, limit) as Array<{ path: string; name: string; kind: string; start_line: number; confidence: number }>;

  // Step 4: unresolvedCount — caller edges referencing symbols no longer in the DB
  const unresolvedCount = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM symbol_dependencies
     WHERE callee_symbol_id IN (${placeholders})
       AND caller_symbol_id NOT IN (SELECT id FROM symbols)`
  ).get(...ids) as { n: number }).n;

  return {
    items: rows.map(r => ({ path: absOut(r.path), name: r.name, kind: r.kind, startLine: r.start_line, confidence: r.confidence })),
    total,
    unresolvedCount,
  };
}

/**
 * Find all symbols that the named symbol calls (callees of a caller).
 *
 * Resolves caller symbol IDs by name (+ optional filePath to disambiguate).
 * Excludes self-loops (caller_symbol_id == callee_symbol_id).
 * Returns {items, total, unresolvedCount}:
 *   - total: pre-LIMIT count (post-self-loop-filter)
 *   - unresolvedCount: edges where callee_symbol_id no longer exists in symbols table
 */
export function getCallees(
  name: string,
  filePath?: string,
  limit: number = 50
): { items: Array<{ path: string; name: string; kind: string; startLine: number; confidence: number }>; total: number; unresolvedCount: number } {
  const sqlite = getSqlite();

  // Step 1: resolve source (caller) symbol IDs
  const callerRows = filePath
    ? sqlite.prepare('SELECT id FROM symbols WHERE name = ? AND path = ?').all(name, relIn(filePath)) as Array<{ id: number }>
    : sqlite.prepare('SELECT id FROM symbols WHERE name = ?').all(name) as Array<{ id: number }>;

  if (callerRows.length === 0) return { items: [], total: 0, unresolvedCount: 0 };

  const ids = callerRows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(', ');

  // Step 2: COUNT pre-LIMIT, self-loop excluded
  const total = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM symbol_dependencies
     WHERE caller_symbol_id IN (${placeholders})
       AND caller_symbol_id != callee_symbol_id`
  ).get(...ids) as { n: number }).n;

  // Step 3: SELECT with LIMIT + JOIN for callee info
  const rows = sqlite.prepare(
    `SELECT s.path, s.name, s.kind, s.start_line, sd.confidence
     FROM symbol_dependencies sd
     INNER JOIN symbols s ON s.id = sd.callee_symbol_id
     WHERE sd.caller_symbol_id IN (${placeholders})
       AND sd.caller_symbol_id != sd.callee_symbol_id
     ORDER BY s.path ASC, s.start_line ASC
     LIMIT ?`
  ).all(...ids, limit) as Array<{ path: string; name: string; kind: string; start_line: number; confidence: number }>;

  // Step 4: unresolvedCount — callee edges referencing symbols no longer in the DB
  const unresolvedCount = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM symbol_dependencies
     WHERE caller_symbol_id IN (${placeholders})
       AND callee_symbol_id NOT IN (SELECT id FROM symbols)`
  ).get(...ids) as { n: number }).n;

  return {
    items: rows.map(r => ({ path: absOut(r.path), name: r.name, kind: r.kind, startLine: r.start_line, confidence: r.confidence })),
    total,
    unresolvedCount,
  };
}

/**
 * Return all symbols for the given file path.
 */
export function getSymbolsForFile(filePath: string): Array<SymbolRow & { path: string }> {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare('SELECT path, name, kind, start_line, end_line, is_export FROM symbols WHERE path = ? ORDER BY start_line')
    .all(relIn(filePath)) as SymbolDbRow[];
  return rows.map(rowToSymbol);
}

/**
 * Delete all symbol rows for a given file path.
 * Called on file unlink (Phase 35 WTC-02) and by upsertSymbols implicitly.
 */
export function deleteSymbolsForFile(filePath: string): void {
  const sqlite = getSqlite();
  sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(relIn(filePath));
}

// ─── kv_state generic key/value (Phase 33 D-11) ────────────────────────

/**
 * Returns the value for `key`, or null if not set.
 */
export function getKvState(key: string): string | null {
  const sqlite = getSqlite();
  const row = sqlite.prepare('SELECT value FROM kv_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Upsert a key/value pair.
 */
export function setKvState(key: string, value: string): void {
  const sqlite = getSqlite();
  sqlite.prepare(
    'INSERT INTO kv_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}

// ─── Atomic per-file edge + symbol write (Phase 33 D-15) ───────────────

/**
 * Writes edges, imported-name metadata, AND symbols for a single file in one transaction.
 * Used by the coordinator's per-file scan loop and by the FileWatcher update path.
 * If any INSERT throws, the whole transaction rolls back — the file is left in its prior state.
 */
export function setEdgesAndSymbols(
  sourcePath: string,
  edges: EdgeResult[],
  syms: SymbolRow[],
  importMeta?: ImportMeta[],
  callSiteEdges?: import('../change-detector/types.js').CallSiteEdge[]
): void {
  const sqlite = getSqlite();
  const relSource = relIn(sourcePath);
  const tx = sqlite.transaction(() => {
    // Inline the setEdges body so the whole write participates in the same transaction.
    // (Calling setEdges() from here would still work because better-sqlite3 nests transactions,
    // but inlining keeps the single-transaction guarantee explicit.)
    const db = getDb();
    db.delete(file_dependencies)
      .where(eq(file_dependencies.source_path, relSource))
      .run();

    const metaBySpec = new Map<string, ImportMeta[]>();
    if (importMeta) {
      for (const m of importMeta) {
        const list = metaBySpec.get(m.specifier) ?? [];
        list.push(m);
        metaBySpec.set(m.specifier, list);
      }
    }
    for (const edge of edges) {
      const relTarget = relInOrNull(edge.target);

      let importedNamesJson: string | null = null;
      let importLineVal:    number | null = null;
      const spec = edge.originalSpecifier;
      if (spec) {
        const list = metaBySpec.get(spec);
        if (list && list.length > 0) {
          const meta = list.shift()!;
          importedNamesJson = JSON.stringify(meta.importedNames);
          importLineVal     = meta.line;
        }
      }

      // Drop cross-project edges; the meta consume above still advances so
      // duplicate-specifier ordering (D-08) holds for surviving edges.
      if (relTarget === null) continue;

      db.insert(file_dependencies).values({
        source_path:       relSource,
        target_path:       relTarget,
        dependency_type:   edge.isPackage ? 'package_import' : 'local_import',
        package_name:      edge.packageName ?? null,
        package_version:   edge.packageVersion ?? null,
        is_dev_dependency: null,
        edge_type:         edge.edgeType,
        confidence:        edge.confidence,
        confidence_source: edge.confidenceSource,
        weight:            edge.weight,
        imported_names:    importedNamesJson,
        import_line:       importLineVal,
      }).run();
    }

    // Phase 37 CSE-04 — caller-side symbol_dependencies clear.
    // Must run BEFORE the symbols DELETE below so the subquery still resolves the
    // OLD symbol IDs (FLAG-02: after DELETE+INSERT, old IDs are gone and the
    // subquery would return the NEW IDs, missing the stale rows entirely).
    if (callSiteEdges !== undefined) {
      sqlite.prepare(
        `DELETE FROM symbol_dependencies
         WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE path = ?)`
      ).run(relSource);
    }

    // Symbols
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(relSource);
    if (syms.length > 0) {
      const stmt = sqlite.prepare(
        'INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const s of syms) {
        stmt.run(relSource, s.name, s.kind, s.startLine, s.endLine, s.isExport ? 1 : 0);
      }
    }

    // Phase 37 CSE-04 continued — insert fresh call-site edges using the new symbol IDs.
    if (callSiteEdges !== undefined && callSiteEdges.length > 0) {
      const callerLookup = sqlite.prepare(
        `SELECT id FROM symbols WHERE path = ? AND name = ? AND start_line = ? LIMIT 1`
      );
      const calleeLookup = sqlite.prepare(
        `SELECT id FROM symbols WHERE path = ? AND name = ? LIMIT 1`
      );
      const edgeInsert = sqlite.prepare(
        `INSERT INTO symbol_dependencies (caller_symbol_id, callee_symbol_id, call_line, confidence)
         VALUES (?, ?, ?, ?)`
      );

      for (const edge of callSiteEdges) {
        const callerRow = callerLookup.get(relSource, edge.callerName, edge.callerStartLine) as
          { id: number } | undefined;
        if (!callerRow) continue;  // symbol row missing (Pitfall A callerStartLine mismatch, or race) — silent discard

        // calleePath is absolute (extractor output); skip cross-project callees.
        const relCallee = relInOrNull(edge.calleePath);
        if (relCallee === null) continue;

        const calleeRow = calleeLookup.get(relCallee, edge.calleeName) as
          { id: number } | undefined;
        if (!calleeRow) continue;  // callee not in DB (renamed since index built, or cross-file out-of-date) — silent discard

        edgeInsert.run(callerRow.id, calleeRow.id, edge.callLine, edge.confidence);
      }
    }
  });
  tx();
  markCommunitiesDirty();
}

// ─── Phase 35 read helpers (CHG-02, CHG-03) ────────────────────────────────

/**
 * Phase 35 (CHG-02): Returns non-directory files whose mtime is strictly
 * greater than `mtimeMs`, sorted most-recent first. Rows with NULL mtime
 * are excluded (cannot compare). Raw sqlite read — no Drizzle.
 */
export function getFilesChangedSince(mtimeMs: number): Array<{ path: string; mtime: number }> {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare(
      'SELECT path, mtime FROM files WHERE is_directory = 0 AND mtime IS NOT NULL AND mtime > ? ORDER BY mtime DESC'
    )
    .all(mtimeMs) as Array<{ path: string; mtime: number }>;
  return rows.map(r => ({ ...r, path: absOut(r.path) }));
}

/**
 * Phase 35 (CHG-03): Returns rows from the `files` table whose path matches
 * one of the given paths. Empty input returns [] without querying. Paths
 * are processed in batches of 500 to stay well below SQLite's default
 * variable limit (32,766 in better-sqlite3 v12.6.2; 500 is safe under any
 * historical limit). Order of returned rows is DB-native — caller sorts.
 */
export function getFilesByPaths(paths: string[]): Array<{ path: string; mtime: number | null }> {
  if (paths.length === 0) return [];
  const sqlite = getSqlite();
  const results: Array<{ path: string; mtime: number | null }> = [];
  const CHUNK = 500;
  // Translate inbound absolute paths to relative for the IN clause.
  const relPaths = paths.map(p => relIn(p));
  for (let i = 0; i < relPaths.length; i += CHUNK) {
    const chunk = relPaths.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = sqlite
      .prepare(`SELECT path, mtime FROM files WHERE path IN (${placeholders})`)
      .all(...chunk) as Array<{ path: string; mtime: number | null }>;
    results.push(...rows.map(r => ({ ...r, path: absOut(r.path) })));
  }
  return results;
}
