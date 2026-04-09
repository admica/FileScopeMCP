# Phase 26: Multi-Language Tree-sitter Extraction - Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace regex-based dependency extraction with tree-sitter AST extraction for Python, Rust, C/C++, and Go. Enhance TS/JS extraction with richer edge types (re_exports, inherits) and edge weights (reference count). Ensure all edges carry non-null confidence labels and scores.

This phase adds new language grammars and extractors to the LanguageConfig registry built in Phase 25. No community detection (Phase 27), no MCP tool changes (Phase 28).

</domain>

<decisions>
## Implementation Decisions

### Grammar Packages
- **D-01:** Install official tree-sitter grammar packages: `tree-sitter-python`, `tree-sitter-c`, `tree-sitter-rust`, `tree-sitter-go`. These are the canonical npm packages maintained by the tree-sitter org, matching the installed `tree-sitter@0.25.x`.
- **D-02:** Each grammar is loaded via `createRequire` (same CJS-from-ESM pattern used in `ast-parser.ts` for tree-sitter-typescript and tree-sitter-javascript).
- **D-03:** Grammar load failures fall back to regex via the existing `buildAstExtractor()` pattern from Phase 25 — never crash, log once.

### Extractor Architecture
- **D-04:** Per-language extractor functions (not a shared generic walker). Each language has distinct AST node types for imports — Python (`import_statement`, `import_from_statement`), Rust (`use_declaration`, `mod_item`, `extern_crate_declaration`), C/C++ (`preproc_include`), Go (`import_declaration` with import spec list). Per-language is clearer and matches the existing pattern where TS/JS, Go, and Ruby each have dedicated extractors.
- **D-05:** Each new extractor follows the same signature: `(filePath, content, projectRoot) => Promise<EdgeResult[]>`. They are registered in the LanguageConfig registry with `grammarLoader` set and `usesRegexFallback: false`.
- **D-06:** Existing Go and Ruby extractors remain regex-based for now (they already work well via specialized resolvers). Only Python, Rust, C/C++ get new AST extractors. Go uses `resolveGoImports()` which handles go.mod module paths — rewriting that as AST would require reimplementing the module resolver.

### TS/JS Richer Edge Types
- **D-07:** Extend the existing `extractTsJsEdges()` in `language-config.ts` to produce `re_exports` and `inherits` edge types in addition to `imports`.
- **D-08:** Re-exports: detected via `export_statement` nodes that have a `source` field (already partially identified in `ast-parser.ts` `visitForImports`). These get `edgeType: 're_exports'` instead of `'imports'`.
- **D-09:** Inherits: detected via `class_declaration` nodes with `class_heritage` / `extends_clause` children. The extended class's module source becomes an edge with `edgeType: 'inherits'`. Only cross-file inheritance is tracked (same-file extends is not a dependency edge).
- **D-10:** The `extractSnapshot()` function in `ast-parser.ts` needs to return richer data — either new fields on `ExportSnapshot` or a separate extraction function called from `extractTsJsEdges()` that walks for re-exports and extends clauses.

### Edge Weight Counting
- **D-11:** Post-extraction aggregation. Each extractor emits one EdgeResult per import statement (including duplicates when a file imports another multiple times). After extraction, `extractEdges()` aggregates by target path — summing weights for duplicate targets. This keeps extractor logic simple.
- **D-12:** The aggregation happens in the public `extractEdges()` function in `language-config.ts`, not inside individual extractors. A `Map<target, EdgeResult>` accumulator merges duplicates, incrementing `weight` for each additional reference to the same target.

### Parity Testing
- **D-13:** Each new language extractor (Python, Rust, C/C++, Go) must pass a parity test: given the same input file, the AST extractor produces the same set of resolved dependency paths as the previous regex extractor. Parity tests run both extractors and compare outputs.
- **D-14:** Parity tests are vitest tests in the test suite. They use fixture files with known import patterns for each language.

### Claude's Discretion
- Internal AST walker implementation details (cursor vs recursive node traversal)
- Parser instance management (one per grammar, matching existing ast-parser.ts pattern)
- Test fixture file contents and naming
- Whether to create a shared helper for common post-extraction steps (path normalization, package detection)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 25 Foundation (direct prerequisite)
- `.planning/phases/25-schema-foundation-languageconfig-scaffolding/25-CONTEXT.md` -- All schema + registry decisions this phase builds on
- `src/language-config.ts` -- LanguageConfig registry, extractEdges(), buildAstExtractor(), EdgeResult type
- `src/confidence.ts` -- EXTRACTED/INFERRED constants and ConfidenceSource type

### Existing AST Infrastructure
- `src/change-detector/ast-parser.ts` -- Tree-sitter TS/JS parser setup (createRequire pattern, grammar loading, extractSnapshot, visitForImports)

### Existing Regex Patterns
- `src/file-utils.ts` lines 82-99 -- IMPORT_PATTERNS regex map (the patterns being replaced for Python, Rust, C/C++, Go)
- `src/file-utils.ts` lines 126-178 -- resolveGoImports() (kept as-is, not replaced)
- `src/file-utils.ts` lines 198-256 -- resolveRubyImports() (kept as-is, not replaced)

### Database Layer
- `src/db/repository.ts` lines 267+ -- setEdges() function that writes enriched edge columns
- `src/db/schema.ts` -- file_dependencies table with edge_type, confidence, confidence_source, weight columns

### Requirements
- `.planning/REQUIREMENTS.md` -- AST-02 through AST-08, EDGE-03 map to this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildAstExtractor()` in language-config.ts:378 — Composes grammar-based extraction with regex fallback. Phase 26 plugs real AST logic into this.
- `extractSnapshot()` in ast-parser.ts:120 — Existing TS/JS AST walker. Pattern to follow for new language extractors.
- `createRequire` pattern in ast-parser.ts:13 — CJS-from-ESM loading pattern for tree-sitter grammars.
- `resolveImportPath()`, `normalizePath()`, `extractPackageVersion()` in file-utils.ts — Reusable path resolution and package detection utilities.

### Established Patterns
- One Parser instance per grammar (ast-parser.ts:31-38). New languages follow the same pattern.
- Grammar loaded at module level via `_require('tree-sitter-xxx')` (ast-parser.ts:21-27).
- Error fallback: try grammar, catch → regex fallback, set `grammarFailed = true` (buildAstExtractor pattern).
- Lazy registry population via `ensureRegexExtractors()` to avoid circular imports.

### Integration Points
- `extractEdges()` in language-config.ts:461 — Single dispatch point. New languages register here.
- `registry.set(ext, {...})` calls in language-config.ts:400-443 — Where new grammar entries are added.
- `setEdges()` in repository.ts:267 — Writes enriched edges. No changes needed — already handles all EdgeResult fields.

</code_context>

<specifics>
## Specific Ideas

- The LanguageConfig pattern from Phase 25 was designed to make this phase a "just add grammar + entry" operation. Follow that design intent.
- Parity testing against existing regex extractors is a key success criterion — AST extraction must produce the same resolved paths before switching over.
- Edge weight (reference count) matters for downstream community detection (Phase 27) — more references between files = stronger edge for clustering.
- Keep Go and Ruby on their specialized resolvers. The Go module resolution logic is complex (go.mod, multi-package repos) and works well. Rewriting it as AST gains nothing.

</specifics>

<deferred>
## Deferred Ideas

None -- discussion stayed within phase scope.

</deferred>

---

*Phase: 26-multi-language-tree-sitter-extraction*
*Context gathered: 2026-04-09*
