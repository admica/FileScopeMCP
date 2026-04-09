# Project Research Summary

**Project:** FileScopeMCP v1.4 Deep Graph Intelligence
**Domain:** Tree-sitter multi-language AST extraction, confidence-labeled dependency edges, Louvain community detection, MCP token budgeting
**Researched:** 2026-04-08
**Confidence:** HIGH

## Executive Summary

FileScopeMCP v1.4 is a surgical capability addition to an existing, validated TypeScript 5.8 / Node.js 22 MCP server. The milestone replaces regex-based import parsing for Python, Rust, C, C++, Go with official tree-sitter grammar packages, introduces richer dependency edge types (imports, calls, inherits, contains) with confidence scores, adds Louvain community detection via the graphology ecosystem, and caps MCP tool responses with a token budget. Experts building this type of system use a LanguageConfig registry pattern — one config entry per language, one file per grammar — to keep multi-language extraction maintainable, and they treat community detection as an on-demand batch computation rather than a real-time reactive one.

The recommended approach is schema-first: add the four new `file_dependencies` columns and the `file_communities` table before touching any extraction code, because code that writes `edge_type` will fail at runtime against an old schema. The AST extractor should be factored into a standalone `src/ast-extractor/` module with a clean `extractEdges(filePath, content, root): Edge[]` interface, replacing the three duplicated extraction code paths currently spread across `coordinator.ts`, `file-utils.ts`, and `analyzeNewFile()`. Graphology's Louvain implementation runs in ~50ms on 1K-node graphs and is the clear winner in the JS ecosystem — the integration pattern is straightforward once the graph is built from the existing `getAllLocalImportEdges()` query.

The dominant risk is not algorithmic complexity but operational correctness: grammar ABI mismatches crash the MCP server at startup rather than at parse time, schema migrations must not emit `NOT NULL DEFAULT` constraints (which trigger a full SQLite table rebuild), community IDs from Louvain are non-deterministic across runs and must never be exposed as stable identifiers, and token budget truncation must happen at the data level (item count) rather than at the string level (character slice). All of these are known, preventable pitfalls with clear mitigation patterns documented in PITFALLS.md.

---

## Key Findings

### Recommended Stack

The existing stack (TypeScript 5.8, Node.js 22, ESM, esbuild, `better-sqlite3`, `tree-sitter@^0.25.0`) is retained without change. v1.4 adds 13 new npm packages: 10 tree-sitter grammar packages for the languages currently handled by regex, plus `graphology@^0.26.0`, `graphology-types@^0.24.8`, and `graphology-communities-louvain@^2.0.2` for community detection. No new packages are needed for confidence labels or token budgeting — both are implemented as schema additions and utility functions respectively.

All new grammars use the same `createRequire(import.meta.url)` CJS loading pattern already established for `better-sqlite3` and the existing tree-sitter grammars. Community detection packages use the same pattern (`graphology-communities-louvain` is a CJS module). PHP grammar exports `{ php, php_only }` (same shape as TypeScript's `{ typescript, tsx }`) and must be verified at integration time.

**Core new dependencies:**
- `tree-sitter-python@^0.25.0`: Python import extraction — official tree-sitter org, full version alignment
- `tree-sitter-rust@^0.24.0`: Rust `use`/`mod` extraction — works with tree-sitter 0.25 (peer dep is a lower bound, not exact)
- `tree-sitter-go@^0.25.0`: Go import extraction — replaces the two-pass regex logic; Go has NO relative imports, all are package-level
- `tree-sitter-c@^0.24.1` + `tree-sitter-cpp@^0.23.4`: C/C++ extraction — separate packages required (cpp is a superset grammar, not a replacement for the C grammar on C++ files)
- `graphology@^0.26.0`: In-memory directed graph — required peer dep for Louvain; transient computation artifact, never persisted
- `graphology-communities-louvain@^2.0.2`: Louvain clustering — 52ms on 1K nodes vs 2,368ms for jLouvain (45x faster); directed graph support confirmed
- **NOT adding:** `tree-sitter-zig` (immature community package), `tree-sitter-language-pack` (248-grammar bundle, offline install problems), any Louvain alternative

**Deferred grammars (regex retained):** Lua, Zig, PHP, C#, Java, Ruby — these are P3 priorities. The LanguageConfig pattern ensures adding them later is a single-file addition with no changes to coordinator or file-utils.

See `.planning/research/STACK.md` for full version compatibility matrix and alternatives considered.

### Expected Features

**Must have (table stakes for v1.4):**
- LanguageConfig registry pattern — prerequisite for adding any grammar without duplicating code across three files
- Python, Rust, C/C++, Go tree-sitter AST extraction — replaces regex for high-priority languages
- Schema migration: `edge_type`, `confidence`, `weight`, `confidence_source` columns on `file_dependencies`
- Schema migration: `file_communities` table with index on `community_id`
- `EXTRACTED` (score 1.0) and `INFERRED` (score 0.75-0.8) confidence labels on all edges
- Louvain community detection via graphology, persisted to `file_communities`
- `get_communities` MCP tool returning representative-file-based community descriptions
- `maxTokens` parameter on `list_files` and `find_important_files` with graceful truncation

**Should have (P2 differentiators):**
- `re_exports` and `inherits` edge types for TS/JS (feasible within the AST extractor, medium complexity)
- `calls` edge type for TS/JS via `call_expression` traversal (high complexity — TS/JS only in v1.4)
- `contains` INFERRED edge type via test file naming heuristic (score 0.6)
- Community auto-labeling by dominant directory of top-importance files
- Global `maxResponseTokens` in config schema
- Nexus dashboard: community color-coding and edge opacity by confidence (frontend-only, reads existing API fields)

**Defer to v1.5+:**
- PHP, C#, Java, Ruby tree-sitter grammars (regex working, lower ROI)
- Lua, Zig tree-sitter grammars (grammar packages immature)
- `calls` extraction for Python, Rust, C
- Leiden algorithm (no mature JS implementation in graphology)
- Overlapping community detection
- Streaming MCP responses (stdio transport is request/response only — protocol limitation)

See `.planning/research/FEATURES.md` for the full prioritization matrix and feature dependency graph.

### Architecture Approach

The milestone introduces two new module directories alongside the existing source tree: `src/ast-extractor/` (LanguageConfig registry, per-language extractors, types) and `src/graph/` (graphology graph construction, Louvain execution, community persistence). These modules have no shared state with each other. The extractor communicates with the rest of the system via a single `extractEdges(filePath, content, root): Promise<Edge[]>` function. Community detection communicates via repository functions — `graph/community.ts` never touches SQLite directly.

The TS/JS extractor in `ast-extractor/languages/ts-js.ts` must reuse the parser instances already exported from `change-detector/ast-parser.ts` rather than constructing new ones, avoiding doubled memory and startup cost. Grammar loading across all new languages must be lazy — instantiated on first parse, not at module load — to prevent unused grammar memory accumulation and to ensure a broken grammar falls back to regex rather than crashing the server at startup.

**Major new components:**
1. `src/ast-extractor/` — LanguageConfig registry with per-language extraction files; public API is `extractEdges(filePath, content, root)`
2. `src/graph/community.ts` — builds graphology DirectedGraph from DB edges, runs Louvain, writes to `file_communities` via repository
3. `src/db/schema.ts` (modified) — four new columns on `file_dependencies`, new `file_communities` table
4. `src/db/repository.ts` (modified) — `setEdges()` replaces `setDependencies()` signature; new community CRUD functions
5. `src/mcp-server.ts` (modified) — `get_communities` tool, `budgetCap()` helper on all unbounded text responses

**Unchanged:** `change-detector/ast-parser.ts`, `cascade/`, `broker/`, `nexus/` (Nexus dashboard reads `community_id` from the existing API — no backend API changes needed)

See `.planning/research/ARCHITECTURE.md` for the full system diagram, data flow sequences, build order, and anti-patterns to avoid.

### Critical Pitfalls

1. **Grammar ABI mismatch crashes MCP server at startup** — Tree-sitter grammars compiled against Node.js 20 ABI (115) throw at `createRequire` time when running Node.js 22 (ABI 127). Use lazy grammar loading so a broken grammar falls back to regex instead of crashing the entire server. Add grammar load verification to `vitest.setup.ts`. Audit all target grammar packages before writing any extractor code.

2. **Schema migration: NOT NULL DEFAULT causes full SQLite table rebuild** — `ADD COLUMN edge_type TEXT NOT NULL DEFAULT 'imports'` triggers SQLite to copy the entire `file_dependencies` table (seconds of lock time on large repos). Add columns as nullable only: `ADD COLUMN edge_type TEXT`. Treat `NULL` as `'imports'` in all queries. Existing rows migrate naturally when files are re-analyzed via setEdges's delete+reinsert pattern.

3. **Louvain community IDs are non-deterministic — never expose them as stable identifiers** — Louvain community numbers change with every re-run (randomized initialization). Never return `communityId: 3` from the MCP tool. Return `representative: '/path/to/key-file.ts'` as the community identifier — the highest-importance file in each cluster, which is stable when the graph is stable.

4. **Token budget truncation at string level produces invalid or incomplete JSON** — `response.slice(0, MAX_CHARS)` cuts mid-object. Enforce budget as `maxItems` on list fields before serialization. Every truncated response must include `truncated: true` and `totalCount: N` so the LLM knows results are incomplete and can refine the query.

5. **Regex-to-AST migration without parity tests causes silent dependency regression** — When a language switches from regex to tree-sitter in `isTreeSitterLanguage()`, all files of that type re-analyze simultaneously on restart. Wrong AST queries cascade into wrong importance scores and wrong staleness. Run both extractors on 3-5 real files per language and diff the results before switching.

6. **Confidence score values as inline literals drift and become meaningless** — Define a `confidence.ts` constants file with named levels before writing any extractor. Every extractor imports constants, never assigns raw float literals. Prevents confidence values from drifting across languages and losing their semantic meaning.

7. **Graphology graph rebuilt from SQLite on every `get_communities` call causes O(E) latency at scale** — Cache the graphology Graph object in the coordinator behind a dirty flag (`graphDirty: boolean`). Rebuild only when `setEdges()` has been called since the last build. Second call to `get_communities` should be 10x faster than the first.

See `.planning/research/PITFALLS.md` for 12 critical pitfalls with full prevention patterns, warning signs, phase assignments, and the "Looks Done But Isn't" checklist.

---

## Implications for Roadmap

Research establishes a clear phase ordering driven by hard dependencies: schema before code, LanguageConfig before grammars, repository before community detection, community detection before MCP tool. Token budget is fully independent and can slot into any phase but fits naturally as a final polish phase with the full feature set present for integration testing.

### Phase 1: Schema Foundation + LanguageConfig Scaffolding

**Rationale:** All downstream phases write to the new schema columns — code that writes `edge_type` fails at runtime against the old schema, making this the hard prerequisite for everything else. LanguageConfig scaffolding (types, registry, regex-fallback port) can be built and tested with zero new npm dependencies, validating the interface before any grammar risk is introduced. These two concerns share the same phase because both are prerequisites for Phase 2 and neither has external dependencies.

**Delivers:** Working schema migration (verified on a copy of real `data.db`), complete `src/ast-extractor/` module structure with `types.ts`, `registry.ts`, `languages/regex-fallback.ts` (ports `IMPORT_PATTERNS` verbatim), and `languages/ts-js.ts` (reuses existing parser instances) operational. `confidence.ts` constants file. Lazy grammar loader pattern with try/catch fallback. Grammar availability audit for all 11 target languages documented.

**Addresses features:** LanguageConfig pattern (P1 table stakes), schema extension for confidence + community columns, `confidence.ts` constants

**Avoids pitfalls:** Grammar ABI crashes at startup (lazy loading pattern established before any grammar is added), schema NOT NULL default trap, confidence inline literals (constants file defined before any extractor), incremental parse prior-tree corruption (prohibiting code comment in `getParser()`)

**Research flag:** Standard patterns — no deeper research needed. SQLite ALTER TABLE behavior is official-doc confirmed. LanguageConfig pattern is derived directly from existing codebase. Regex-fallback is a straight port of `IMPORT_PATTERNS`.

### Phase 2: Multi-Language Tree-sitter Extraction

**Rationale:** With LanguageConfig in place, adding each grammar is a single file plus one registry entry. Languages are added in priority order: Python (highest LLM codebase relevance), Rust, C/C++, Go. Each language is validated with parity tests before switching `isTreeSitterLanguage()`. Richer edge types (re_exports, inherits) for TS/JS are included here since the infrastructure is ready and they require no new npm deps.

**Delivers:** AST extraction for Python, Rust, C, C++, Go replacing regex. `re_exports` and `inherits` edge types for TS/JS. All edges written with correct `edge_type`, `confidence`, `confidence_source` via the updated `setEdges()` in repository (replaces `setDependencies()` signature — all call sites updated in the same PR).

**Addresses features:** Python/Rust/C/C++/Go grammars (P1), re_exports/inherits edge types (P1-P2), confidence labeling on all extracted edges

**Avoids pitfalls:** Regex parity tests before switching each language, `setDependencies()` signature updated to `DependencyEdge[]` with all call sites in same PR (prevents two-code-paths problem), Go import type handling (all Go imports are package-level, no relative imports)

**Research flag:** One targeted validation — verify PHP grammar export shape (`{ php, php_only }` or direct object) at start of implementation. Medium confidence on this detail. All other grammars are confirmed as direct-object exports.

### Phase 3: Community Detection

**Rationale:** Community detection reads from the dependency graph populated in Phase 2. Richer edge types from Phase 2 produce better cluster quality, though import-only communities are functional. The critical design decisions — on-demand vs reactive, dirty-flag cache, representative-based IDs — must be locked in before writing any code to prevent the performance and stability pitfalls that arise from reactive community recompute.

**Delivers:** `graphology` + `graphology-communities-louvain` installed. `src/graph/community.ts` with `recomputeCommunities()` using dirty-flag cache in coordinator. `file_communities` table populated on coordinator init and on edge-delta threshold (>5 changes). `get_communities` MCP tool with representative-based response format (no raw integer IDs). Community auto-labeling by dominant directory of top-importance files.

**Addresses features:** Community detection (P1), `get_communities` MCP tool (P1), community auto-labeling (P2), cross-community coupling metric (P2)

**Avoids pitfalls:** On-demand plus dirty-flag cache (not per-file-change Louvain — prevents event loop stall), non-deterministic Louvain IDs (representative file path as stable identifier), N+1 query trap (batch `getAllEdges()` to build graph, not per-file queries)

**Research flag:** Verify via installed graphology docs that `type: 'directed'` in `new Graph()` produces correct directed modularity in Louvain. Confirmed in research but worth a quick check against the specific installed version.

### Phase 4: MCP Polish (Token Budget + `calls` Edge Type)

**Rationale:** Token budget is fully independent of all other phases — it touches only `mcp-server.ts` and `createMcpResponse()`. Bundling it with `calls` edge extraction (TS/JS only) and `contains` heuristic keeps the final phase coherent as a polish and completeness sprint. `calls` extraction is the most complex edge type but has no downstream dependencies and can be cut to v1.5 if it exceeds scope.

**Delivers:** `maxTokens` parameter on `list_files` and `find_important_files` with importance-ordered truncation and `{ truncated: true, shown: N, total: M }` metadata. `budgetCap()` helper on all unbounded MCP text responses. Optional `maxResponseTokens` in config schema. `calls` edge type via `call_expression` traversal for TS/JS. `contains` INFERRED edge for test file naming heuristic (score 0.6).

**Addresses features:** MCP token budget cap (P1), `calls` edge type for TS/JS (P2), `contains` heuristic (P2), global config token cap (P2)

**Avoids pitfalls:** Token budget via item count limit not string slice (prevents invalid/incomplete JSON), valid JSON + `truncated: true` + `totalCount` in all truncated responses, character-count approximation (4 chars/token) — no tokenizer dependency

**Research flag:** `calls` edge type is rated HIGH complexity in FEATURES.md. If implementation reveals it needs more scope than this phase allows, defer to v1.5 rather than delaying the token budget work, which is straightforward and high-value.

### Phase Ordering Rationale

- Schema before extraction code: writing `edge_type` to a schema without that column throws at runtime
- LanguageConfig + regex-fallback before new grammars: validates the interface with zero npm risk before adding native dependencies
- Each grammar validated with parity tests before `isTreeSitterLanguage()` is expanded: prevents silent extraction regression cascading into wrong importance scores
- Community detection after multi-language extraction: richer edge types produce better clusters; import-only communities are functional but complete the story
- `get_communities` MCP tool last in Phase 3: community data must be reliably populated before the tool returns meaningful results
- Token budget in Phase 4: no dependencies, benefits from full feature set being present for integration testing
- `calls` extraction in Phase 4 with an explicit scope guard: highest complexity work goes last where it can be deferred without blocking the milestone

### Research Flags

Phases with well-documented patterns (no additional research needed):
- **Phase 1:** SQLite ALTER TABLE behavior is official-doc confirmed. LanguageConfig is derived from live codebase. Zero new npm deps.
- **Phase 4 (token budget):** Pattern fully specified in ARCHITECTURE.md. No external dependencies. Character-count approximation is the established approach.

Phases needing targeted validation before implementation:
- **Phase 2, PHP grammar export shape:** Run `console.log(Object.keys(_require('tree-sitter-php')))` before writing the PHP extractor to verify `{ php, php_only }` vs direct object. Medium confidence on this detail. (Note: PHP is P3 — only relevant if PHP is pulled into v1.4 scope.)
- **Phase 3, Louvain directed graph modularity:** Verify `type: 'directed'` in `new Graph()` produces correct behavior with the specific installed version of `graphology-communities-louvain@2.0.2`.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All 13 new package versions verified via live npm registry queries. Grammar peer dep compatibility confirmed. graphology benchmark figures from official docs. One medium-confidence item: PHP grammar export shape — verify at integration. |
| Features | HIGH | Based on direct codebase inspection of all modified files plus npm registry confirmation of all new packages. Feature dependencies mapped explicitly. Go's "no relative imports" behavior is a verified language characteristic documented in the Go specification. |
| Architecture | HIGH | Module structure derived from direct source reading of `ast-parser.ts`, `file-utils.ts`, `coordinator.ts`, `repository.ts`, `schema.ts`. SQLite O(1) ALTER TABLE behavior confirmed via official docs. Community detection data flow verified against graphology API docs. |
| Pitfalls | HIGH | 12 pitfalls sourced from direct codebase audit, official tree-sitter ABI issue threads, official SQLite docs, graphology docs, and arxiv preprints. Each has specific warning signs, phase assignments, and recovery strategies. |

**Overall confidence:** HIGH

### Gaps to Address

- **PHP grammar export shape (MEDIUM confidence):** `tree-sitter-php` may export `{ php, php_only }` similar to `tree-sitter-typescript`'s `{ typescript, tsx }`. Verify at the start of Phase 2 implementation before writing the PHP extractor. PHP is currently P3 (deferred), so this only matters if PHP scope is pulled into v1.4.

- **Louvain determinism with seeding:** `graphology-communities-louvain@2.0.2` supports a `rngFunction` option for seeded random initialization. If community stability across re-runs (same graph = same community assignments) is a requirement, verify whether seeding produces stable output in practice. Research assumes non-determinism; the representative-based ID design handles this regardless.

- **`calls` edge traversal scope for TS/JS:** FEATURES.md rates `calls` edge extraction HIGH complexity. It is scoped to Phase 4 with an explicit guard: if it exceeds available scope, defer to v1.5 and ship the token budget work independently. This is the only feature in the milestone with a concrete deferral trigger.

- **Nexus dashboard community coloring:** FEATURES.md notes this is a frontend-only change (map `community_id` to Cytoscape.js node color palette, map `confidence` to edge opacity). No backend API changes are needed — `community_id` is already in the API response once Phase 3 completes. No specific dashboard implementation research was conducted; treat as standard Cytoscape.js attribute mapping during Phase 3 implementation.

---

## Sources

### Primary (HIGH confidence)

- Live npm registry queries (2026-04-08) — all 13 new package versions and peer dep ranges confirmed
- [tree-sitter GitHub organization](https://github.com/tree-sitter) — official grammar repos for python, go, c, cpp, java, php, c-sharp, ruby
- [node-tree-sitter docs v0.25.0](https://tree-sitter.github.io/node-tree-sitter/) — `createRequire` loading pattern, incremental parse semantics
- [tree-sitter advanced parsing docs](https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html) — prior tree behavior, multi-language ranges
- [graphology-communities-louvain official docs](https://graphology.github.io/standard-library/communities-louvain.html) — directed graph support, `resolution` parameter, `louvain.assign()` API, performance benchmarks
- [SQLite ALTER TABLE documentation](https://www.sqlite.org/lang_altertable.html) — O(1) ADD COLUMN behavior, NOT NULL constraint table-rebuild conditions
- [tree-sitter Node.js ABI mismatch issues](https://github.com/tree-sitter/node-tree-sitter/issues/169) — NODE_MODULE_VERSION mismatch behavior with prebuilt binaries
- Direct codebase inspection: `src/change-detector/ast-parser.ts`, `src/db/schema.ts`, `src/db/repository.ts`, `src/coordinator.ts`, `src/file-utils.ts`, `src/mcp-server.ts`, `package.json` — current state confirmed

### Secondary (MEDIUM confidence)

- [graphology GitHub repository](https://github.com/graphology/graphology) — performance benchmarks (52ms for 1K nodes vs jLouvain 2,368ms)
- [Codebase-Memory arxiv preprint](https://arxiv.org/html/2603.27277) — tree-sitter + confidence-scored edges + Louvain in MCP context
- [DF Louvain: incremental Louvain limitations](https://arxiv.org/abs/2404.19634) — batch-orientation of Louvain algorithm, overhead for incremental updates
- [tree-sitter packaging challenges blog](https://ayats.org/blog/tree-sitter-packaging) — per-grammar npm availability inconsistency
- [Automated Software Modularization Using Community Detection (Springer 2015)](https://link.springer.com/chapter/10.1007/978-3-319-23727-5_8) — academic basis for Louvain on dependency graphs
- [pyan Python static analysis](https://github.com/davidfraser/pyan) — binary confidence scoring approach as pattern for rule-based confidence tiers

### Tertiary (LOW confidence)

- [MCP token bloat discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1576) — response verbosity and token consumption patterns (single community source)
- [MCP token optimization patterns](https://tetrate.io/learn/ai/mcp/token-optimization-strategies) — truncation-with-count-indicator pattern (single community source, consistent with official MCP guidance)

---

*Research completed: 2026-04-08*
*Ready for roadmap: yes*
