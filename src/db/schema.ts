// src/db/schema.ts
// Drizzle ORM table definitions for FileScopeMCP SQLite storage
// Source: https://orm.drizzle.team/docs/column-types/sqlite
import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

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
}, (t) => [
  index('dep_source_idx').on(t.source_path),
  index('dep_target_idx').on(t.target_path),
]);

// Pre-built for Phase 5 — avoids schema migration when LLM pipeline arrives
// status enum: pending → in_progress → done | failed
export const llm_jobs = sqliteTable('llm_jobs', {
  job_id:        integer('job_id').primaryKey({ autoIncrement: true }),
  file_path:     text('file_path').notNull(),
  job_type:      text('job_type', {
    enum: ['summary', 'concepts', 'change_impact']
  }).notNull(),
  priority_tier: integer('priority_tier').notNull().default(2), // 1=interactive, 2=cascade, 3=background
  status:        text('status', {
    enum: ['pending', 'in_progress', 'done', 'failed']
  }).notNull().default('pending'),
  created_at:    integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  started_at:    integer('started_at', { mode: 'timestamp_ms' }),
  completed_at:  integer('completed_at', { mode: 'timestamp_ms' }),
  error_message: text('error_message'),
  retry_count:   integer('retry_count').notNull().default(0),
}, (t) => [
  index('jobs_status_priority_idx').on(t.status, t.priority_tier),
  index('jobs_file_path_idx').on(t.file_path),
]);

// Schema versioning — single integer row
// Future phases check this and apply upgrade logic as needed
export const schema_version = sqliteTable('schema_version', {
  version: integer('version').primaryKey().notNull(),
});
