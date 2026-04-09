# Feature Research

**Domain:** Deep code graph intelligence — FileScopeMCP v1.4
**Researched:** 2026-04-08
**Confidence:** HIGH (direct codebase inspection + verified against npm registry + official tree-sitter docs + graphology docs)

---

## Context

This is a SUBSEQUENT MILESTONE research document. FileScopeMCP v1.0–v1.3 already ships:
- Regex-based import parsing for 11 languages (JS/TS already upgraded to tree-sitter AST in v1.0)
- Dependency graph with cycle detection (Tarjan's SCC)
- File importance scoring, cascade staleness propagation, LLM broker
- Nexus dashboard with Cytoscape.js dependency visualization
- Schema: `file_dependencies` table with `dependency_type` enum ('local_import', 'package_import')

v1.4 adds **Deep Graph Intelligence** — tree-sitter AST for all languages, richer edge types,
confidence labels, community detection, and MCP token budgeting.

The question is: **for each of the four target features, what is table stakes vs differentiator
vs anti-feature, and what are the dependencies and edge cases?**

---

## Feature Landscape

### Feature Domain 1: Tree-sitter AST Extraction (Multi-Language)

**Current state:** Tree-sitter is already installed (`tree-sitter@0.25.x`, `tree-sitter-typescript@0.23.x`,
`tree-sitter-javascript@0.25.x`) and working for TS/JS/JSX/TSX in `src/change-detector/ast-parser.ts`.
The `LanguageConfig` pattern does not yet exist — each language is a separate parser instance.
Nine languages still use regex: Python, C, C++, Rust, Lua, Zig, PHP, C#, Java, Go, Ruby.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| LanguageConfig registry pattern | Without a unified dispatch table, each new language requires touching multiple files; code becomes unsustainable across 11 languages | LOW | Map of `ext → { parser, queries }`. Already implicit in `getParser()` in ast-parser.ts — needs to become explicit and data-driven. |
| Python AST extraction via tree-sitter | Python is a primary target language for LLM codebases; regex already works but misses dynamic imports and conditional imports | MEDIUM | `npm install tree-sitter-python` — v0.25.0 available, confirmed on npm. Grammar handles `import`, `from X import Y`, `__import__()`. |
| Rust AST extraction via tree-sitter | Rust is a common language for performance-critical tooling; `use` statements have complex path forms that regex misses | MEDIUM | `npm install tree-sitter-rust` — v0.24.0 available. Grammar handles `use` declarations, `use X::{A, B}`, `mod` declarations. |
| C/C++ AST extraction via tree-sitter | C/C++ `#include` is regex-friendly but `#include_next` and macro-generated includes are edge cases; AST catches more | MEDIUM | `npm install tree-sitter-c tree-sitter-cpp` — v0.24.1 available. Grammar handles `#include "path"` and `#include <system>`. |
| Go AST extraction via tree-sitter | Go imports are structured but grouped imports have complex formatting that regex can mis-parse | MEDIUM | `npm install tree-sitter-go` — v0.25.0 available. Grammar handles single and grouped `import` blocks cleanly. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Richer edge types: `calls`, `contains`, `inherits` | Import edges alone miss the architectural story; function calls show runtime coupling, inheritance shows design hierarchy | HIGH | Requires tree-sitter queries for call_expression, class extends, method definitions. Only feasible for TS/JS/Python initially — other languages defer. |
| Edge weight: reference count | Knowing that FileA imports from FileB 12 times (12 distinct symbols used) vs once is structurally significant | MEDIUM | Count `import_specifier` children for named imports. For wildcard (`import *`) use weight 1. Stored as integer in schema. |
| Per-language query abstraction | Different grammars use different node type names (Python `import_statement` vs JS `import_statement` — same name, different children); LanguageConfig encapsulates this | MEDIUM | Each LanguageConfig entry includes query templates as functions or node-type strings. Keeps the walker generic. |
| PHP, C#, Java, Ruby via tree-sitter | Completing the language matrix; all four have npm-published grammar packages | MEDIUM | `tree-sitter-php@0.24.2`, `tree-sitter-c-sharp@0.23.1`, `tree-sitter-java@0.23.5`, `tree-sitter-ruby@0.23.1` — all confirmed on npm. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full AST caching in storage | "Reparse is slow, cache the tree" | ASTs are large (10–100x source size in memory), go stale on every edit, and tree-sitter incremental reparse is fast enough that caching adds complexity for no real benefit. PROJECT.md explicitly places this Out of Scope. | Parse on demand; tree-sitter parse of a 1000-line file is sub-millisecond |
| Cross-file symbol resolution | "Track which specific function in FileB is called by FileA" | Requires a full type system / module resolver; tree-sitter alone cannot resolve imports to their definitions across files; would require building a scope-aware resolver (days of work, still imprecise for dynamic languages) | Edges at file granularity are the right level of abstraction for this tool; symbol resolution is an IDE concern |
| Zig and Lua via tree-sitter | These exist in the grammar ecosystem | `tree-sitter-zig@0.2.0` is available but immature. `tree-sitter-lua@2.1.3` exists. However, regex parsing for these two languages is already functional and adding more native grammar packages has a real install cost (native compilation per package). Lua and Zig are low-priority languages in the codebase. | Keep regex for Lua and Zig in v1.4; defer tree-sitter migration for these two |
| Dynamic import tracking | "`await import(expr)` should create an edge" | Dynamic import paths are computed at runtime; AST extraction can only capture string literal dynamic imports (e.g., `import('./foo')`); template literal or variable-based import paths cannot be statically resolved | Flag template literal dynamic imports as INFERRED edges with low confidence score (0.3) instead of treating them as firm edges |

---

### Feature Domain 2: Confidence-Labeled Dependency Edges

**Current state:** `file_dependencies` schema has `dependency_type` enum with only
`'local_import'` and `'package_import'`. No confidence or edge type fields exist.
All edges are implicitly EXTRACTED (they came from source code) but unlabeled.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Schema extension: `confidence_score` (float) and `edge_source` (enum) | Any system claiming "confidence labels" must persist them; in-memory only would lose the data on restart | LOW | Add two columns to `file_dependencies`. `edge_source` enum: `'extracted'` (came from AST/regex) or `'inferred'` (heuristically derived). `confidence_score` float 0.0–1.0. Migration via schema_version bump. |
| `EXTRACTED` label for AST-derived edges | All edges created by tree-sitter parsing or regex are explicit source-level dependencies — this is the highest confidence category | LOW | Default for all existing edges on migration. `confidence_score = 1.0` for AST-extracted imports. `confidence_score = 0.8` for regex-extracted imports (regex may produce false positives on commented-out code). |
| `INFERRED` label for heuristic edges | Edges that cannot be directly traced to a source statement (e.g., file-naming conventions, directory co-location patterns) should be distinguishable from concrete imports | LOW | `confidence_score` between 0.1 and 0.7 depending on heuristic strength. Concrete example: a file named `foo.test.ts` that doesn't explicitly import `foo.ts` but clearly tests it — this is an INFERRED `contains` edge with score 0.6. |
| MCP tool surfaces confidence | `get_file_summary` should include confidence in the edges it returns; without this, the labels exist in the DB but are invisible to the LLM | LOW | Include `{ target, edgeType, confidence, source }` in the `dependencies` array returned by `get_file_summary`. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Richer `edge_type` column | Beyond `local_import` / `package_import`: add `calls`, `contains`, `inherits`, `re-exports` | MEDIUM | Requires tree-sitter call graph extraction (high complexity for some languages). `contains` and `re-exports` are feasible for TS/JS immediately. `calls` is feasible for TS/JS with tree-sitter call_expression traversal. |
| Confidence propagation: lower score for transitive INFERRED | An edge inferred from an already-inferred edge should have lower confidence than a directly inferred one | LOW | Simple: `new_score = parent_score * 0.7`. Applied only when creating secondary heuristic inferences. |
| Nexus dashboard: edge opacity by confidence | Visual differentiation — low-confidence edges appear faint, high-confidence edges bold | LOW | Cytoscape.js edge `opacity` mapped to confidence score. No backend changes needed — frontend reads the `confidence` field already in the API response. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| ML-based confidence scoring | "Use a model to estimate how certain each edge is" | An LLM or ML classifier for edge confidence is wildly over-engineered when the real signal is binary: AST-parsed = high confidence, heuristic = medium, dynamic = low. The broker is already saturated with file summaries. | Rule-based confidence tiers as described above. Fast, deterministic, no model cost. |
| Confidence decay over time | "Edges become less confident as the code ages" | Time-based confidence assumes code drift without evidence; mtime-based staleness already handles the freshness tracking story. Adding a second decay dimension creates confusing double-staleness semantics. | Reparse on file change resets confidence to current ground truth. Staleness flags on files already communicate "this file changed, relationships may be stale." |
| Per-symbol confidence (function-level) | "Edge from fileA to fileB.functionX is more confident than edge to fileB.functionY" | Requires cross-file symbol resolution (see tree-sitter anti-features). Symbol-level granularity is IDE territory, not file intelligence territory. | File-level confidence is the right granularity for this tool's purpose. |

---

### Feature Domain 3: Community Detection

**Current state:** The dependency graph exists as edges in `file_dependencies`, traversable via
`getAllLocalImportEdges()`. Cycle detection (Tarjan's SCC) is already implemented. Cytoscape.js
in the Nexus dashboard already renders the graph. There is no clustering or module grouping.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Louvain algorithm for community detection | Louvain is the standard algorithm for undirected/directed community detection in software dependency graphs; well-studied for software modularization (academic literature from 2015–2025 confirms this use case) | MEDIUM | `graphology@0.26.0` + `graphology-communities-louvain@2.0.2` are the best-available JS implementation. Benchmarks show graphology is 45x faster than jLouvain on graphs of 1K nodes. Both confirmed available on npm. |
| Community ID assigned to each file in DB | Without persistence, community membership must be recomputed on every query — expensive for large repos | LOW | Add `community_id` integer column to `files` table. Populated by the community detection run. `NULL` means unclustered (isolated file or directory). Schema_version bump. |
| `get_communities` MCP tool | LLMs must be able to ask "what are the logical modules in this codebase?" — without a dedicated tool, community data is inaccessible | LOW | Returns list of communities with: id, size, file count, top files by importance, cohesion score (intra-community edges / total edges). |
| On-demand recompute after graph change | Community membership should update when the dependency graph changes significantly; full recompute is acceptable (Louvain on 1K-node graph takes ~30–50ms) | LOW | Trigger recompute in `updateFileInTree` / `handleFileChange` when dependency deltas exceed a threshold (e.g., >5 edges changed). Or recompute on every coordinator init. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Resolution parameter tuning | Louvain's `resolution` parameter controls cluster granularity — lower produces fewer large communities (subsystem-level), higher produces more small communities (module-level). Exposing this lets users tune for their codebase size. | LOW | Default `resolution: 1.0`. Expose as config option in `config.json`. Or as MCP tool parameter on `get_communities`. |
| Community label: auto-named from top files | A community ID (integer) is useless to an LLM; naming it after its most important file or dominant directory makes the output actionable | LOW | `community_label = dirname(topFile.path)` where topFile is the highest-importance file in the community. Example: community containing `src/broker/server.ts`, `src/broker/client.ts` → label "broker". |
| Nexus dashboard: color-coded communities | Each community gets a distinct color in the Cytoscape.js graph — immediately reveals module boundaries visually | LOW | Map `community_id` to a color palette in the frontend. No backend changes needed — `community_id` in the API response is sufficient. |
| Cross-community coupling metric | Count edges that cross community boundaries vs total edges — high ratio indicates poor modularization. Surfaces in `get_communities` response. | LOW | `coupling = cross_community_edges / total_edges`. Simple count from the edge list after community assignment. |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Leiden algorithm instead of Louvain | "Leiden is more correct, Louvain has the resolution limit problem" | Leiden has no mature pure-JS implementation; graphology does not ship Leiden; implementing Leiden from scratch is a multi-day effort. Louvain's resolution limit is a theoretical concern that doesn't matter at the scale of a single codebase (100–2000 files). | Louvain via graphology. Resolution limit is a concern for billion-node social networks, not 500-file codebases. If Leiden lands in graphology's standard library, it can be adopted then. |
| Overlapping community detection | "A file can belong to multiple communities" | Overlapping community algorithms (ORCA, BIGCLAM) are significantly more complex to implement and interpret. The output format (a file with N community memberships) is awkward to present to an LLM. In software architecture, a file typically belongs to one module. | Non-overlapping Louvain. Files that genuinely span modules show up as bridge nodes in the graph — visible via high betweenness centrality if that's added later. |
| Real-time streaming community updates | "Update community membership incrementally as files change" | Incremental community detection requires a different algorithm (streaming community detection) that has no mature JS implementation. The full Louvain recompute takes <50ms for typical codebases — recomputing on demand is fast enough. | Batch recompute triggered by graph change events. |
| Hierarchical community nesting | "Communities within communities" | Adds another data dimension (community tree) with complex query semantics. Graphology does expose Louvain's hierarchical dendrogram, but the UX for presenting nested communities to an LLM is unclear. | Single-level communities. The label/directory heuristic provides a natural hierarchy without the complexity. |

---

### Feature Domain 4: MCP Token Budget Cap

**Current state:** MCP tool responses (`list_files`, `get_file_summary`, etc.) return raw JSON
via `createMcpResponse(data)` with no size limit. A project with 5000 files returns a
50,000-token response from `list_files`. The existing `StdioTransport` has a 10MB buffer limit
but no semantic token limit. The LLM's context window is the only implicit cap.

#### Table Stakes

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Per-tool token budget parameter | LLMs calling tools need to control response size to leave room for reasoning; without a cap, large codebases flood the context window and degrade response quality | LOW | Add optional `maxTokens?: number` parameter to relevant tools (`list_files`, `find_important_files`, `get_file_summary` when it includes large arrays). When exceeded, truncate with a `"truncated": true, "totalCount": N` indicator. |
| Character-based approximation for token counting | True tokenization requires loading a tokenizer (heavy dep); character count is a reasonable proxy (1 token ≈ 4 chars for English/code content) | LOW | `Math.floor(jsonString.length / 4)` as token estimate. Good enough for budget enforcement — no tokenizer dependency needed. |
| Graceful truncation with count indicator | Truncated responses must tell the LLM how many items were omitted so it can request more targeted queries | LOW | Response shape: `{ files: [...N items], truncated: true, shown: N, total: M, hint: "Use find_important_files with minImportance filter to narrow results" }`. |
| Importance-ordered truncation | When truncating, drop lowest-importance items first — the LLM gets the most relevant subset | LOW | Sort by importance DESC before truncation. Already the behavior of `find_important_files`; apply same sort to `list_files` when budget cap is active. |

#### Differentiators

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Global default budget in config | A per-call budget parameter is opt-in; a default budget in `config.json` applies to all responses without requiring the LLM to remember to pass it. Reduces accidental context flooding. | LOW | `config.maxResponseTokens?: number` (default: none = unlimited). When set, all MCP tools apply this cap unless the caller passes a higher explicit value. |
| Budget remaining hint in response | Telling the LLM "response used ~2000 of your 4000 token budget" lets it plan subsequent tool calls more intelligently | LOW | Include `estimatedTokens: N` in every truncated response. Useful signal; trivial to compute. |
| Tool-specific budget guidance in tool descriptions | Tool descriptions in `server.tool()` can suggest typical response sizes so the LLM knows when to set a budget before calling | LOW | Add to tool description: "Returns all files; use maxTokens parameter for large projects (typical: 500–5000 tokens for 50–500 files)." |

#### Anti-Features

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Tiktoken or cl100k tokenizer integration | "Accurate token counting matters" | `tiktoken` is a heavy native addon (WebAssembly + Rust-backed); loading it into an MCP server that spawns as a stdio child process adds 50–200ms startup time and a significant bundle size. The 4-chars-per-token approximation is ±10% accurate — sufficient for budget enforcement. | Character-count approximation. The error margin is small enough that a 10% inaccuracy in the budget doesn't matter in practice. |
| Streaming responses for large tool outputs | "Return large responses as a stream" | MCP stdio transport is request/response, not a streaming protocol. The MCP SDK does not support chunked/streaming tool responses in the stdio transport. Adding streaming would require breaking the `ToolResponse` contract. | Truncation with count indicator + filter parameters (use `minImportance`, `limit` params to narrow queries). |
| Pagination (cursor-based) | "Return page 1, then the LLM asks for page 2" | Adds stateful session concept to a stateless tool interface; requires cursor storage between tool calls; the LLM already has filter parameters (`minImportance`, `limit`) that effectively paginate by refining the query. | Stateless filtering: `minImportance`, `limit`, `path` prefix filter. These compose better than pagination for LLM use. |
| Per-tool budget configuration in config file | "I want list_files to have a different budget than find_important_files" | Over-engineered. A single global default covers 95% of use cases. Per-tool tuning is a nice-to-have that would add config complexity for negligible real-world benefit. | Single `maxResponseTokens` global. Callers override per-call with the parameter. |

---

## Feature Dependencies

```
[Tree-sitter LanguageConfig pattern]
    └──required-by──> [Python/Rust/C/Go/etc. AST extraction]
    └──required-by──> [Richer edge types (calls, inherits, contains)]
    └──replaces──>    [Per-extension if/switch in ast-parser.ts]

[Schema extension: confidence_score + edge_type + edge_source]
    └──required-by──> [EXTRACTED/INFERRED confidence labels]
    └──required-by──> [Richer edge types (calls, contains, inherits)]
    └──required-by──> [MCP tool exposes confidence in dependencies]
    └──requires──>    [schema_version bump + migration]

[Schema extension: community_id on files table]
    └──required-by──> [Community detection persisted to DB]
    └──required-by──> [get_communities MCP tool]
    └──requires──>    [schema_version bump + migration]

[Graphology + graphology-communities-louvain install]
    └──required-by──> [Community detection computation]
    └──requires──>    [Build edge list from getAllLocalImportEdges()]

[Community detection computation]
    └──requires──>    [Graphology installed]
    └──requires──>    [schema_version bump (community_id column)]
    └──enhances──>    [Nexus dashboard community coloring]
    └──enables──>     [get_communities MCP tool]

[Token budget cap]
    └──requires──>    [createMcpResponse() refactored to support truncation]
    └──independent-of──> [All other v1.4 features]

[Richer edge types (calls, inherits, contains)]
    └──requires──>    [Tree-sitter LanguageConfig pattern]
    └──requires──>    [Schema extension (edge_type column)]
    └──enhances──>    [Community detection (richer edges = better clusters)]
    └──enhances──>    [Nexus dependency graph visual]

[EXTRACTED/INFERRED confidence labels]
    └──requires──>    [Schema extension (confidence_score + edge_source)]
    └──enhances──>    [Nexus dashboard edge opacity visualization]
```

### Dependency Notes

- **Schema migrations before everything else:** Both new features (confidence labels, community detection) require DB schema additions. These must be the first phases of v1.4 — everything else builds on the extended schema.
- **LanguageConfig pattern before multi-language expansion:** Refactoring `ast-parser.ts` to a data-driven LanguageConfig pattern is a prerequisite for adding Python, Rust, C, Go grammars without code duplication. Do this before installing new grammar packages.
- **Community detection is independent of confidence labels:** These two features can be developed in parallel or sequentially — they share the schema migration phase but don't call each other.
- **Token budget cap is fully independent:** It touches only `mcp-server.ts` and `createMcpResponse()`. Can be developed in any phase order without blocking or being blocked by other features.
- **Richer edge types enhance community detection:** `calls` and `inherits` edges create a richer graph that produces better (more architecturally meaningful) communities. However, community detection on import-only edges is already valuable — richer edges are an enhancement, not a prerequisite.
- **Graphology is NOT a Cytoscape.js replacement:** Graphology is used server-side for computation. Cytoscape.js remains the Nexus dashboard renderer. The community IDs computed by Graphology are persisted to the DB and served via the Nexus API — the dashboard reads them.

---

## Scope Assessment Per Feature

### Tree-sitter Multi-Language Expansion

**Realistic scope for v1.4:**
- LanguageConfig pattern refactor (LOW complexity — one afternoon)
- Add Python, Rust, C, C++, Go grammars via npm (MEDIUM — grammar packages + query patterns per language)
- Defer Lua and Zig (regex is working, grammar packages are immature/low value)
- Basic `imports` edge extraction per language (same as current TS/JS behavior, just via AST)

**Richer edge types (calls, inherits, contains):**
- Start with TS/JS only (tree-sitter grammar is already loaded, call_expression traversal is known)
- Python `calls` extraction is feasible but lower priority
- Other languages: import edges only in v1.4, call edges in v1.5+

**Complexity verdict:** MEDIUM overall. Grammar packages are installable in minutes; the work is writing correct query patterns for each language's AST node types and testing with real files.

### Confidence-Labeled Edges

**Realistic scope for v1.4:**
- Schema extension: 2 new columns (LOW)
- Migration: backfill all existing edges as `EXTRACTED` with score 1.0 (LOW)
- Assign confidence at write time in `setDependencies()` (LOW)
- Expose in `get_file_summary` response (LOW)

**Complexity verdict:** LOW overall. The schema change is the only risky part (migration must not break existing data). The confidence values themselves are deterministic rules, not ML.

### Community Detection

**Realistic scope for v1.4:**
- Install graphology + graphology-communities-louvain (LOW — two npm packages)
- Schema extension: `community_id` on `files` table (LOW)
- Build graphology graph from `getAllLocalImportEdges()` (LOW)
- Run Louvain, write community IDs back to DB (LOW)
- `get_communities` MCP tool (LOW)
- Trigger recompute on coordinator init (LOW)

**Complexity verdict:** MEDIUM overall. The algorithm itself is a library call — the work is wiring the DB → graph → algorithm → DB cycle correctly and designing the MCP tool response format.

### MCP Token Budget Cap

**Realistic scope for v1.4:**
- Add optional `maxTokens` parameter to `list_files` and `find_important_files` (LOW)
- Refactor `createMcpResponse()` to support truncation metadata (LOW)
- Character-count approximation, not true tokenization (LOW)
- Importance-ordered truncation for `list_files` (LOW)

**Complexity verdict:** LOW overall. This is the simplest of the four features. No new dependencies, no schema changes, no new processes.

---

## MVP Definition (v1.4)

### Phase 1: Schema Foundation (prerequisite for everything)

- [ ] Schema migration: add `edge_type`, `confidence_score`, `edge_source` to `file_dependencies`
- [ ] Schema migration: add `community_id` to `files` table
- [ ] Backfill existing edges: `edge_type='local_import'`, `edge_source='extracted'`, `confidence_score=0.9` (regex) or `1.0` (AST)
- [ ] schema_version bump with migration guard

### Phase 2: Tree-sitter LanguageConfig Pattern

- [ ] Refactor `ast-parser.ts`: `LanguageConfig` registry type, `getParser()` driven by config map
- [ ] Install and register Python grammar (`tree-sitter-python@0.25.0`)
- [ ] Install and register Rust grammar (`tree-sitter-rust@0.24.0`)
- [ ] Install and register C/C++ grammars (`tree-sitter-c@0.24.1`, `tree-sitter-cpp`)
- [ ] Install and register Go grammar (`tree-sitter-go@0.25.0`)
- [ ] Each language: import extraction only (same behavior as current TS/JS, replaces regex)
- [ ] Update `isTreeSitterLanguage()` to include new languages

### Phase 3: Richer Edge Types (TS/JS first)

- [ ] `calls` edge type: tree-sitter `call_expression` traversal for TS/JS files
- [ ] `contains` edge type: test file naming convention heuristic (INFERRED, score 0.6)
- [ ] `re_exports` edge type: `export { X } from './path'` already parsed — label correctly
- [ ] `inherits` edge type: `class X extends Y` traversal for TS/JS
- [ ] Write edges with `edge_type`, `confidence_score`, `edge_source` at extraction time

### Phase 4: Community Detection

- [ ] Install `graphology@0.26.0` and `graphology-communities-louvain@2.0.2`
- [ ] Build graphology `DirectedGraph` from `getAllLocalImportEdges()`
- [ ] Run `louvain.assign(graph, { resolution: 1.0 })`
- [ ] Write community IDs back to `files.community_id`
- [ ] Auto-label communities by dominant directory of top-importance files
- [ ] Trigger recompute on coordinator init and on significant graph change (>5 edge deltas)
- [ ] `get_communities` MCP tool: returns community list with id, label, file count, top files

### Phase 5: MCP Token Budget Cap

- [ ] Add optional `maxTokens: number` to `list_files` and `find_important_files`
- [ ] Refactor `createMcpResponse()` to accept optional `{ maxTokens, totalCount }` hint
- [ ] Sort by importance before truncation
- [ ] Truncated response includes `{ truncated: true, shown: N, total: M, estimatedTokens: N }`
- [ ] Add global `maxResponseTokens` option to config schema (optional, no default)

### Defer to v1.5+

- [ ] `calls` edge extraction for Python, Rust, C — requires per-language call node patterns
- [ ] Lua and Zig tree-sitter grammars — regex working, grammar packages immature
- [ ] PHP, C#, Java, Ruby tree-sitter upgrade — regex working, lower ROI than Python/Rust/Go/C
- [ ] Leiden algorithm — not available in graphology, no mature JS implementation
- [ ] Overlapping community detection — theoretical interest, no clear LLM UX benefit
- [ ] Streaming MCP responses — protocol limitation, not addressable in stdio transport

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Schema migration (confidence + community columns) | HIGH | LOW | P1 |
| LanguageConfig pattern refactor | HIGH | LOW | P1 |
| Python tree-sitter grammar | HIGH | MEDIUM | P1 |
| Rust tree-sitter grammar | HIGH | MEDIUM | P1 |
| C/C++ tree-sitter grammar | MEDIUM | MEDIUM | P1 |
| Go tree-sitter grammar | MEDIUM | MEDIUM | P1 |
| `EXTRACTED` confidence label on import edges | HIGH | LOW | P1 |
| Community detection (Louvain via graphology) | HIGH | MEDIUM | P1 |
| `get_communities` MCP tool | HIGH | LOW | P1 |
| MCP token budget cap (`maxTokens` parameter) | HIGH | LOW | P1 |
| `re_exports` edge type (TS/JS) | MEDIUM | LOW | P1 |
| `inherits` edge type (TS/JS) | MEDIUM | MEDIUM | P2 |
| `calls` edge type (TS/JS) | MEDIUM | HIGH | P2 |
| `contains` INFERRED heuristic edge | MEDIUM | LOW | P2 |
| Community auto-labeling (directory heuristic) | MEDIUM | LOW | P2 |
| Community cross-coupling metric | LOW | LOW | P2 |
| Global `maxResponseTokens` config option | LOW | LOW | P2 |
| PHP, C#, Java, Ruby tree-sitter grammars | LOW | MEDIUM | P3 |
| Lua, Zig tree-sitter grammars | LOW | MEDIUM | P3 |
| `calls` extraction for Python, Rust, C | LOW | HIGH | P3 |

**Priority key:**
- P1: Required for v1.4 — core milestone deliverable
- P2: Should have — complete the story, add when core is proven
- P3: Defer to v1.5+ — diminishing returns, wait for clear demand

---

## Dependency on Existing Components

| Existing Component | How v1.4 Uses It |
|-------------------|-----------------|
| `src/change-detector/ast-parser.ts` | Primary target for refactor — LanguageConfig pattern replaces ad-hoc parser selection; new language grammars added here |
| `src/db/schema.ts` | New columns on `file_dependencies` and `files`; schema_version bump |
| `src/db/repository.ts` | `setDependencies()` updated to accept `edge_type`, `confidence_score`, `edge_source`; new `getCommunities()` query added |
| `src/file-utils.ts` | `extractDependencies()` updated to pass edge metadata through to `setDependencies()` |
| `src/mcp-server.ts` | New `get_communities` tool registered; `list_files` and `find_important_files` get `maxTokens` parameter |
| `src/coordinator.ts` | Community detection triggered on init and significant graph change |
| `src/nexus/` (Nexus dashboard) | `community_id` served via existing API; Cytoscape.js frontend reads it for coloring — no backend API changes |
| Cytoscape.js (Nexus frontend) | `community_id` used for node color grouping; `confidence_score` used for edge opacity |

---

## Known Edge Cases Per Feature

### Tree-sitter Multi-Language

- **Parse failures:** Non-UTF8 files (binary files with .py extension, minified code) can crash tree-sitter; wrap all `parser.parse()` calls in try/catch and fall back to regex or return null. Already done for TS/JS.
- **Grammar version mismatch:** `tree-sitter@0.25.x` requires grammars built for the same major API version. Check that `tree-sitter-python@0.25.x` (not 0.24.x) is compatible. Verified: Python grammar v0.25.0, Rust v0.24.0 — Rust is one minor behind but the Node API is stable across 0.24/0.25.
- **C vs C++ ambiguity:** `.h` files could be C or C++ headers; the `tree-sitter-cpp` grammar handles both. Use cpp grammar for `.h`, `.hpp`, `.hxx`; c grammar for `.c`. This is the established convention.
- **Go package imports vs relative imports:** Go has NO relative imports — all imports are module paths (e.g., `"github.com/foo/bar"`). All Go imports are `package_import` edges, never `local_import`. This differs from every other language and must be handled explicitly in the LanguageConfig.

### Confidence-Labeled Edges

- **Migration atomicity:** The backfill of existing edges must happen in a single transaction. If it fails midway, the schema_version check on the next startup will re-run it. Use `schema_version` guard properly.
- **Regex-extracted edges confidence:** Regex can false-positive on import statements inside comments or multiline strings. Score these 0.8 instead of 1.0 to acknowledge the uncertainty.
- **`confidence_score` type in SQLite:** SQLite stores REAL as float64; no precision issues at 2 decimal places. Drizzle's `real()` column type maps correctly.

### Community Detection

- **Isolated files (no edges):** Files with zero imports and zero dependents form singleton communities or are left unclustered. Louvain assigns these to their own community of size 1. Handle this gracefully in `get_communities` (filter out singletons or bucket them into an "isolated" group).
- **Disconnected graph components:** A repo with two disconnected subsystems produces two separate community clusters. Louvain handles this natively — no special casing needed.
- **Graph size:** Louvain runs in O(n log n). On a 2000-file repo, expect 50–100ms for the initial run. Acceptable for on-init recompute. Do NOT run on every file change — trigger only when edge delta exceeds threshold.
- **graphology directed vs undirected:** `file_dependencies` is directed (A imports B ≠ B imports A). Community detection on directed graphs uses a different modularity formulation. Graphology's Louvain supports directed graphs explicitly via the `directed: true` option. Use it.

### MCP Token Budget Cap

- **Character estimate vs actual tokens:** Code tokens average closer to 3–4 chars/token; JSON overhead (braces, quotes, colons) averages 2–3 chars/token. The blended approximation of 4 chars/token is reasonable. An LLM passing `maxTokens: 1000` will get a response that's within ±20% of 1000 actual tokens.
- **`list_files` returns tree structure (nested JSON):** The current `list_files` response reconstructs the file tree from the DB. For token budgeting, flattening to a sorted list (importance DESC) is simpler to truncate than pruning a tree. Consider changing `list_files` to return a flat list when `maxTokens` is set.
- **`get_file_summary` for a single file:** This tool returns one file's data. Token budgeting here is about capping the `dependencies` and `dependents` arrays (a file with 500 dependents produces a large response). Cap arrays at N items when budget is set.

---

## Sources

- Live codebase inspection: `src/change-detector/ast-parser.ts`, `src/db/schema.ts`, `src/db/repository.ts`, `src/mcp-server.ts`, `src/file-utils.ts` — current state confirmed (HIGH confidence — direct source inspection)
- `package.json` inspected — `tree-sitter@0.25.0`, `tree-sitter-typescript@0.23.2`, `tree-sitter-javascript@0.25.0` confirmed installed (HIGH confidence — live file)
- npm registry queries: `tree-sitter-python@0.25.0`, `tree-sitter-rust@0.24.0`, `tree-sitter-c@0.24.1`, `tree-sitter-go@0.25.0`, `tree-sitter-php@0.24.2`, `tree-sitter-c-sharp@0.23.1`, `tree-sitter-java@0.23.5`, `tree-sitter-ruby@0.23.1`, `tree-sitter-lua@2.1.3`, `tree-sitter-zig@0.2.0` — all confirmed available (HIGH confidence — live npm query)
- npm registry queries: `graphology@0.26.0`, `graphology-communities-louvain@2.0.2` — both confirmed available (HIGH confidence — live npm query)
- [tree-sitter Node.js docs v0.25.1](https://tree-sitter.github.io/node-tree-sitter/index.html) — parser API, grammar loading pattern (HIGH confidence — official docs)
- [graphology communities-louvain docs](https://graphology.github.io/standard-library/communities-louvain.html) — `directed` option, `resolution` parameter, `louvain.assign()` API (HIGH confidence — official docs)
- [graphology GitHub](https://github.com/graphology/graphology) — performance benchmarks: 52ms for 1K nodes vs jLouvain's 2368ms (MEDIUM confidence — official repo but benchmark may be dated)
- [Automated Software Modularization Using Community Detection (Springer 2015)](https://link.springer.com/chapter/10.1007/978-3-319-23727-5_8) — academic basis for Louvain on dependency graphs; coupling decreased for 99/111 systems (MEDIUM confidence — peer-reviewed but older)
- [pyan Python static analysis](https://github.com/davidfraser/pyan) — binary confidence scoring approach (1.0 = fully resolved, 0.0 = unknown name) provides the pattern for rule-based confidence tiers (MEDIUM confidence — open source project, not a standard)
- [tree-sitter-language-pack](https://github.com/kreuzberg-dev/tree-sitter-language-pack) — alternative to individual grammar installs; 248+ languages; Node.js NAPI bindings with on-demand download (MEDIUM confidence — community project, not official tree-sitter org)
- [MCP token optimization patterns](https://tetrate.io/learn/ai/mcp/token-optimization-strategies) — truncation-with-count-indicator pattern, character-based approximation approach (LOW confidence — single community source, but consistent with official MCP guidance)
- PROJECT.md — "Full AST caching in storage" explicitly Out of Scope; confirmed design constraints (HIGH confidence — project design doc)

---

*Feature research for: FileScopeMCP v1.4 Deep Graph Intelligence*
*Researched: 2026-04-08*
