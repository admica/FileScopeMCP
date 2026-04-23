// src/db/schema.ts
// Drizzle ORM table definitions for FileScopeMCP SQLite storage
// Source: https://orm.drizzle.team/docs/column-types/sqlite
import { sqliteTable, text, integer, index, real } from 'drizzle-orm/sqlite-core';

// One row per file — flat, no nested children
// Parent-child relationships reconstructed via path prefix queries
export const files = sqliteTable('files', {
  path:                       text('path').primaryKey().notNull(),
  name:                       text('name').notNull(),
  is_directory:               integer('is_directory', { mode: 'boolean' }).notNull().default(false),
  importance:                 integer('importance').default(0),
  summary:                    text('summary'),
  mtime:                      integer('mtime'),                    // ms since epoch, nullable = unknown
  summary_stale_since:        integer('summary_stale_since'),      // NULL = not stale
  concepts_stale_since:       integer('concepts_stale_since'),     // NULL = not stale
  change_impact_stale_since:  integer('change_impact_stale_since'), // NULL = not stale
  exports_snapshot:           text('exports_snapshot'),             // JSON blob: ExportSnapshot | null
  concepts:                   text('concepts'),                     // JSON blob: ConceptsResult | null
  change_impact:              text('change_impact'),                // JSON blob: ChangeImpactResult | null
}, (t) => [
  index('files_is_directory_idx').on(t.is_directory),
]);

// Dependency relationships — one direction stored (source_path → target_path)
// Dependents derived by querying WHERE target_path = ?
// Includes PackageDependency metadata columns to avoid future schema migration
export const file_dependencies = sqliteTable('file_dependencies', {
  id:              integer('id').primaryKey({ autoIncrement: true }),
  source_path:     text('source_path').notNull(),
  target_path:     text('target_path').notNull(),
  dependency_type: text('dependency_type', {
    enum: ['local_import', 'package_import']
  }).notNull(),
  // PackageDependency fields — only populated for package_import rows
  package_name:       text('package_name'),
  package_version:    text('package_version'),
  is_dev_dependency:  integer('is_dev_dependency', { mode: 'boolean' }),
  // Edge metadata — added in migration 0004
  edge_type:          text('edge_type').notNull().default('imports'),
  confidence:         real('confidence').notNull().default(0.8),
  confidence_source:  text('confidence_source').notNull().default('inferred'),
  weight:             integer('weight').notNull().default(1),
  // Phase 33 IMP-03 — additive columns for imported-name metadata (nullable per D-10)
  imported_names:  text('imported_names'),      // JSON string array: ["useState","useEffect"] | ["*"] | ["default"]
  import_line:     integer('import_line'),      // 1-indexed source line of the import_statement
}, (t) => [
  index('dep_source_idx').on(t.source_path),
  index('dep_target_idx').on(t.target_path),
]);

// Phase 33 SYM-03 — top-level TS/JS symbols for find_symbol navigation.
// No FK to files(path): migration ordering independent, purge explicit via deleteSymbolsForFile().
export const symbols = sqliteTable('symbols', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  path:       text('path').notNull(),
  name:       text('name').notNull(),
  kind:       text('kind').notNull(),       // 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const'
  start_line: integer('start_line').notNull(),
  end_line:   integer('end_line').notNull(),
  is_export:  integer('is_export', { mode: 'boolean' }).notNull().default(false),
}, (t) => [
  index('symbols_name_idx').on(t.name),
  index('symbols_path_idx').on(t.path),
]);

// Community membership — populated by community detection algorithm
// community_id groups files that are tightly coupled
export const file_communities = sqliteTable('file_communities', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  community_id: integer('community_id').notNull(),
  file_path:    text('file_path').notNull(),
}, (t) => [
  index('communities_community_id_idx').on(t.community_id),
]);

// Phase 33 — generic key/value state for one-shot gates (e.g. `symbols_bulk_extracted`).
// `schema_version` is unused at runtime; a proper KV table is the right home for string flags.
export const kv_state = sqliteTable('kv_state', {
  key:   text('key').primaryKey().notNull(),
  value: text('value').notNull(),
});

// Schema versioning — single integer row
// Future phases check this and apply upgrade logic as needed
export const schema_version = sqliteTable('schema_version', {
  version: integer('version').primaryKey().notNull(),
});
