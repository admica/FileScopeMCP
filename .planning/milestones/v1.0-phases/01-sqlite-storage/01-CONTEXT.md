# Phase 1: SQLite Storage - Context

**Gathered:** 2026-03-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace JSON flat-file storage with SQLite. Migrate existing users transparently on first boot. The SQLite schema supports per-field staleness tracking, dependency relationships, structured metadata, and a pending LLM jobs table for Phase 5. All existing MCP tools return identical responses after migration.

</domain>

<decisions>
## Implementation Decisions

### Migration experience
- Auto-migrate on first boot when server detects existing JSON tree file — zero user action required
- Rename original JSON file as backup (e.g., `FileScopeMCP-tree.json.bak`) — not deleted, clearly marked as superseded
- All-or-nothing migration wrapped in a SQLite transaction — if anything fails, rollback and keep using JSON
- Migration feedback via existing `log()` pattern to stderr — consistent with codebase style, silent to MCP clients

### Schema design
- Flat files table: one row per file with path as primary key. Parent-child relationship reconstructed via path prefix queries — no children column needed
- Dependency relationships table: source_path, target_path, dependency_type (local_import, package_import) — lean schema, add columns later if Phase 3 needs them
- Per-field staleness as nullable INTEGER timestamp columns directly on the files table: summary_stale_since, concepts_stale_since, change_impact_stale_since — NULL means not stale
- LLM jobs table designed fully upfront: job_id, file_path, job_type, priority_tier, status, created_at, etc. — avoids schema migrations when Phase 5 arrives

### ORM vs raw SQL
- Use Drizzle ORM for type-safe queries, schema-as-code, and migration generation — already mentioned in roadmap plans
- Repository pattern: a `db.ts` module that exports typed functions (getFile, setFile, getDependencies, etc.) — rest of codebase never sees SQL or Drizzle directly
- Accept native addon complexity for better-sqlite3 — use createRequire pattern for ESM integration as planned
- Schema versioning from day one: a schema_version table with a single integer — each future phase checks and upgrades as needed

### Database location
- SQLite file lives in the monitored project's root directory as `.filescope.db` — dot-prefix hides it on Unix, consistent with per-project pattern
- Single-writer assumed: one server instance per project. Use WAL mode for read performance but don't design for multi-process writes
- Document recommended .gitignore entry in README — don't auto-modify the user's .gitignore

### Claude's Discretion
- Exact Drizzle schema column types and index design
- better-sqlite3 + esbuild integration details (external flag, native addon copy)
- LLM jobs table exact column set (beyond the core fields)
- WAL mode and pragma configuration
- In-memory cache strategy (whether to keep the loadedTrees Map pattern or rely on SQLite's page cache)
- Error message wording during migration failures

</decisions>

<specifics>
## Specific Ideas

- The existing `storage-utils.ts` has `saveFileTree()`, `loadFileTree()`, `updateFileNode()`, `getFileNode()`, and a `loadedTrees` Map cache — these are the primary functions to replace with SQLite equivalents
- The existing `FileNode` class has nested children arrays, dependencies/dependents as string arrays, PackageDependency objects, importance (0-10), summary, and mtime — all need relational representation
- Success criteria explicitly requires: "Starting the server against an existing JSON tree automatically migrates all data to SQLite on first boot, with the original JSON backed up but not deleted"
- Success criteria requires: "Every MCP tool that existed before the migration returns identical responses after — same tool names, same parameter schemas, same response shapes"

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `storage-utils.ts`: Current JSON persistence layer — functions to replace: `saveFileTree()`, `loadFileTree()`, `updateFileNode()`, `getFileNode()`, `clearTreeCache()`
- `types.ts`: `FileNode`, `FileTreeConfig`, `FileTreeStorage`, `PackageDependency` classes — define the data model to migrate
- `global-state.ts`: `getProjectRoot()` — used to locate where the DB file goes
- `config-utils.ts`: Zod schemas for config validation — pattern to follow for DB config
- `logger.ts`: `log()` function — use for migration feedback

### Established Patterns
- ESM with `.js` extensions in imports — new modules must follow
- `AsyncMutex` for serialized tree mutations — may need equivalent for DB write coordination
- In-memory cache (`loadedTrees` Map) sits in front of disk I/O — decide whether to keep this pattern or let SQLite handle caching
- `console.error()` for diagnostic output, `log()` for timestamped debug logging
- Zod for parameter validation at tool boundaries

### Integration Points
- `mcp-server.ts` lines 73-320: Orchestration layer calls `saveFileTree()` and `loadFileTree()` — primary consumer of new storage layer
- `mcp-server.ts` tool handlers: Each tool that reads/writes file data needs to use new DB functions instead of tree traversal
- `file-utils.ts`: `buildDependentMap()`, `addFileNode()`, `removeFileNode()`, `updateFileNodeOnChange()` — these modify the tree and will need to write to DB
- `file-watcher.ts`: Triggers file change events that lead to tree mutations — downstream of storage changes
- `build.sh` / `package.json`: Build scripts need to handle better-sqlite3 native addon

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-sqlite-storage*
*Context gathered: 2026-03-02*
