# Phase 25: Schema Foundation + LanguageConfig Scaffolding - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Add rich edge metadata columns (edge_type, confidence, confidence_source, weight) to the file_dependencies table, create the file_communities table, define confidence constants, and build a LanguageConfig registry that dispatches TS/JS to tree-sitter AST extraction and all other languages to regex fallback. Broken grammars fall back to regex, never crash.

This phase is schema + scaffolding only. No new language extractors (Phase 26), no community detection logic (Phase 27), no MCP tool changes (Phase 28).

</domain>

<decisions>
## Implementation Decisions

### Schema Migration
- **D-01:** New drizzle migration file `drizzle/0004_add_edge_metadata.sql` adds edge_type, confidence, confidence_source, and weight columns to file_dependencies. Existing rows get `edge_type = 'imports'`, `confidence = 0.8`, `confidence_source = 'inferred'`, `weight = 1` as defaults.
- **D-02:** `file_communities` table created in the same migration: community_id (integer), file_path (text, FK to files.path), with index on community_id. No data populated yet.
- **D-03:** Update `src/db/schema.ts` in parallel so drizzle-orm types stay in sync with the migration.

### Confidence Constants
- **D-04:** New `src/confidence.ts` module exports named constants: `EXTRACTED = 1.0`, `INFERRED = 0.8`, and their string labels `'extracted'`, `'inferred'`. No extractor uses raw float literals.

### LanguageConfig Registry
- **D-05:** New `src/language-config.ts` module with a `Map<string, LanguageConfig>` keyed by file extension. Each entry holds: grammar loader (nullable), extractor function, and fallback flag.
- **D-06:** TS/JS extensions (.ts, .tsx, .js, .jsx) get tree-sitter AST entries that delegate to existing `ast-parser.ts` extraction plus new edge metadata.
- **D-07:** All other currently-supported extensions (Py, C/C++, Rust, Lua, Zig, PHP, C#, Java, Go, Ruby) get regex fallback entries sourced from the existing `IMPORT_PATTERNS` map and language-specific resolvers.
- **D-08:** Broken grammar loading (e.g., ABI mismatch) catches the error and falls back to regex — never crashes the server. Log the failure once, not per-file.

### Integration Seam
- **D-09:** New `extractEdges(filePath: string, content: string, projectRoot: string): Promise<EdgeResult[]>` function in `language-config.ts` replaces the dispatch logic in `analyzeNewFile()` (file-utils.ts:846).
- **D-10:** `EdgeResult` type: `{ target: string, edgeType: string, confidence: number, confidenceSource: string, weight: number, isPackage: boolean, packageName?: string, packageVersion?: string }`.
- **D-11:** `analyzeNewFile()` calls `extractEdges()` and maps results to the existing return shape (`dependencies[]` + `packageDependencies[]`) for backward compatibility. The full EdgeResult data flows to a new `setEdges()` repository function that writes the enriched columns.
- **D-12:** Existing `setDependencies()` in repository.ts gains a sibling `setEdges()` that writes edge_type, confidence, confidence_source, weight. `setDependencies()` remains for backward compatibility during transition.

### Claude's Discretion
- Internal naming of helper functions and intermediate types
- Whether to use a class or plain object for LanguageConfig entries
- Test file organization (co-located vs separate test file)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema & Database
- `src/db/schema.ts` -- Current drizzle table definitions (file_dependencies needs new columns)
- `src/db/db.ts` -- Database connection and migration runner
- `src/db/repository.ts` -- CRUD functions including setDependencies() that writes edges
- `drizzle/` -- Migration folder (0000-0003 exist, next is 0004)

### Existing Extraction
- `src/file-utils.ts` lines 82-97 -- IMPORT_PATTERNS regex map for non-TS/JS languages
- `src/file-utils.ts` lines 846-960 -- analyzeNewFile() dispatch chain (the integration seam)
- `src/file-utils.ts` lines 126-178 -- resolveGoImports() (Go-specific resolver)
- `src/file-utils.ts` lines 198-256 -- resolveRubyImports() (Ruby-specific resolver)
- `src/change-detector/ast-parser.ts` -- Existing tree-sitter TS/JS extraction (getParser, extractSnapshot, isTreeSitterLanguage)

### Requirements
- `.planning/REQUIREMENTS.md` -- EDGE-01, EDGE-02, AST-01, AST-06 map to this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ast-parser.ts` getParser() + extractSnapshot(): Already handles TS/JS tree-sitter parsing. LanguageConfig entries for TS/JS should delegate to this.
- `IMPORT_PATTERNS` map in file-utils.ts:82: Regex patterns for 12 extensions. Registry entries for unsupported languages source from this.
- `resolveGoImports()` and `resolveRubyImports()`: Language-specific resolvers. Registry entries for Go/Ruby wrap these.
- `resolveImportPath()` in file-utils.ts:260: Generic TS/JS import path resolver, reusable.

### Established Patterns
- Drizzle migration files in `drizzle/` with sequential numbering (0000, 0001, etc.)
- `createRequire` pattern for loading CJS native addons from ESM (ast-parser.ts, db.ts)
- Module-level parser instantiation (one parser per grammar, created at import time)
- Error fallback pattern: try operation, catch and log, return safe fallback

### Integration Points
- `analyzeNewFile()` in file-utils.ts:846 is the single dispatch point for all dependency extraction
- `setDependencies()` in repository.ts:220 is the single write point for all edges
- `coordinator.ts:832` calls setDependencies after file analysis
- `scanDirectory()` bulk extraction during initial scan also calls the same pattern

</code_context>

<specifics>
## Specific Ideas

- The user (an agentic coder consuming this MCP server) prioritizes: accurate confidence labels so they can trust high-confidence edges, and a clean registry so adding languages in Phase 26 is just adding entries.
- Confidence scores exist for a reason: when I query get_file_summary, I want to know if an edge was reliably extracted from AST (1.0) or guessed from regex (0.8). This directly affects how much I trust dependency information when planning changes.
- The LanguageConfig pattern should make Phase 26 a "just add grammar + entry" operation with zero structural changes.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 25-schema-foundation-languageconfig-scaffolding*
*Context gathered: 2026-04-09*
