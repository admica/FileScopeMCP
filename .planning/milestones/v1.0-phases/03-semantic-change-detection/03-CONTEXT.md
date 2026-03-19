# Phase 3: Semantic Change Detection - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

When a file changes, classify what semantically changed — exports, types, body, or comments — using AST-level diffing for TS/JS files and LLM-powered diff fallback for unsupported languages. Replace regex-based import parsing with AST extraction for TS/JS. Produce a stable SemanticChangeSummary type that Phase 4's CascadeEngine consumes.

</domain>

<decisions>
## Implementation Decisions

### AST parser scope
- Focus on API surface vs internals distinction — the parser extracts exported symbols and their type signatures, not internal function structure
- Four classification buckets: exports changed, types changed, body only, comments only
- tree-sitter is the AST tool (tree-sitter-typescript, tree-sitter-javascript) — gives concrete syntax trees without requiring the full TypeScript compiler
- No need to analyze internal function bodies deeply — Phase 4 only cares about "does this change affect dependents?"

### LLM fallback behavior
- For unsupported languages (Go, Rust, Python, etc.), queue an async LLM job with the file diff (not full file content)
- When no LLM is configured: classify changes as "unknown" — Phase 4 treats conservatively (marks all direct dependents stale). Safe default, no false negatives
- Cost control: truncate diffs over ~4K tokens; for very large files, fall back to "unknown" rather than burning tokens
- LLM fallback is async/queued using the pending LLM jobs table from Phase 1. Until the job completes, the change is classified as "unknown"

### Change classification output (SemanticChangeSummary)
- Stable TypeScript interface with 6 fields:
  - `filePath: string` — the changed file
  - `changeType: "exports-changed" | "types-changed" | "body-only" | "comments-only" | "mixed" | "unknown"` — what kind of change
  - `affectsDependents: boolean` — derived from changeType (true for exports/types/mixed/unknown, false for body/comments)
  - `changedExports?: string[]` — names of exports that changed (TS/JS AST only, optional)
  - `confidence: "ast" | "llm" | "heuristic"` — how the classification was determined
  - `timestamp: number` — when the change was detected
- `"mixed"` covers edits that change both exports and body in one save
- `"unknown"` is the safe conservative default

### Regex replacement strategy
- Replace TS/JS import parsing regex (file-utils.ts lines 50-53) with tree-sitter AST extraction — eliminates false positives from string literals, comments, and template literals (CHNG-04)
- Keep existing regex parsers for all other languages (Python, Rust, Go, Lua, etc.) — they work adequately for import/dependency extraction
- Dispatch based on file extension: TS/JS -> tree-sitter, everything else -> regex
- No scope creep into other language AST parsers — deferred to v2 (LANG-01, LANG-02)

### Previous version storage for diffing
- Store extracted exports snapshot in SQLite (JSON column on the files table) after each successful parse
- On next file change, compare new parse result against stored snapshot to produce the semantic diff
- No git dependency — works in non-git directories
- Avoids needing to cache full ASTs in memory

### Claude's Discretion
- tree-sitter native addon build pipeline details (external flags, .node file copying)
- Exact tree-sitter query patterns for extracting exports and type signatures
- LLM prompt design for unsupported language diff classification
- Error handling when tree-sitter parsing fails (fall back to "unknown")
- Performance: no AST caching needed — tree-sitter parses typical files in ~1-5ms

</decisions>

<specifics>
## Specific Ideas

- The `affectsDependents` boolean is the critical field — it's the single bit Phase 4's CascadeEngine needs to decide whether to cascade
- `changedExports` enables future targeted cascade (only mark dependents that import those specific exports), but Phase 4 can start with the simpler boolean
- Confidence field lets downstream consumers know whether to trust the classification or treat it as best-effort

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/file-utils.ts` lines 50-63: Regex import patterns for 10+ languages — TS/JS patterns will be replaced, others kept
- `src/file-utils.ts:buildDependentMap()` (line 624): Builds reverse dependency map from parsed imports — will use AST-extracted imports for TS/JS
- `src/db/repository.ts`: CRUD layer for SQLite — will need new column for exports snapshot storage
- `src/db/schema.ts`: Drizzle ORM schema — will need schema addition for exports snapshot

### Established Patterns
- File change flow: chokidar event -> debounce -> mutex lock -> updateFileNodeOnChange() -> save. Change detection inserts between "mutex lock" and "update" steps
- Coordinator pattern: `src/coordinator.ts:handleFileEvent()` (line 344) is the integration point
- Async mutex for serialized mutations — change detection runs within this lock
- ESM imports with `.js` extension throughout codebase

### Integration Points
- `src/coordinator.ts:handleFileEvent()` — wire ChangeDetector into the file change flow
- `src/file-utils.ts` import parsing — replace TS/JS regex with AST extraction
- `src/db/schema.ts` — add exports_snapshot column
- `package.json` build script — add tree-sitter as external for esbuild

</code_context>

<deferred>
## Deferred Ideas

- Python AST support in semantic change detection — v2 (LANG-01)
- Rust/Go/C++ language-aware LLM prompting — v2 (LANG-02)
- Targeted cascade using changedExports list — Phase 4 enhancement (start with boolean)

</deferred>

---

*Phase: 03-semantic-change-detection*
*Context gathered: 2026-03-17*
