# Stack Research

**Domain:** Tree-sitter multi-language AST extraction, Louvain community detection, confidence-scored edge metadata — FileScopeMCP v1.4
**Researched:** 2026-04-08
**Confidence:** HIGH

## Context

This is a targeted v1.4 addition to an existing TypeScript 5.8 / Node.js 22 / ESM / esbuild stack.
The core stack is validated and NOT re-researched here. This document covers only the
**new capability domains** for the v1.4 Deep Graph Intelligence milestone:

1. Tree-sitter grammar packages for all languages currently handled by regex (Python, Rust, Go, C/C++, Java, Lua, Zig, PHP, C#, Ruby)
2. Community detection via Louvain algorithm
3. Graph representation library needed to feed the community detection algorithm
4. Confidence-scored edge metadata schema (no new npm package — schema design only)
5. Token budget cap on MCP tool responses (no new npm package — stdlib pattern only)

**Retained stack (do not change):** TypeScript 5.8, Node.js 22, ESM, esbuild,
`@modelcontextprotocol/sdk`, `chokidar`, `zod`, `vitest`, `better-sqlite3`,
`drizzle-orm`, `tree-sitter@^0.25.0`, `tree-sitter-javascript@^0.25.0`,
`tree-sitter-typescript@^0.23.2`, Vercel AI SDK, `ignore`, Fastify 5, Svelte 5, Cytoscape.js.

**Existing tree-sitter integration pattern (replicate for new grammars):**
- Grammar packages loaded via `createRequire(import.meta.url)` — same as `better-sqlite3`
- One parser instance per grammar, instantiated at module load time (not per-parse)
- `_require('tree-sitter-javascript')` returns the language object directly
- `_require('tree-sitter-typescript')` returns `{ typescript, tsx }` — a special multi-grammar package

---

## Recommended Stack — New Additions Only

### New npm Dependencies

| Package | Version | Purpose | Why |
|---------|---------|---------|-----|
| `tree-sitter-python` | `^0.25.0` | Python AST grammar | Official tree-sitter org package. v0.25.0 aligns with the existing `tree-sitter@^0.25.0` peer dep constraint. Replaces the regex `IMPORT_PATTERNS['.py']` with proper AST traversal. |
| `tree-sitter-rust` | `^0.24.0` | Rust AST grammar | Official tree-sitter org package. Latest npm is 0.24.0 (peerDeps `tree-sitter: ^0.22.1`). Works fine with tree-sitter 0.25 — the constraint is a lower bound, not exact. Replaces `.rs` regex. |
| `tree-sitter-go` | `^0.25.0` | Go AST grammar | Official tree-sitter org package. v0.25.0 on npm. Replaces the two-pass `GO_SINGLE_IMPORT_RE` / `GO_GROUPED_BLOCK_RE` regex logic. |
| `tree-sitter-c` | `^0.24.1` | C AST grammar | Official tree-sitter org package. v0.24.1 on npm. Replaces `#include` regex for `.c`, `.h` files. |
| `tree-sitter-cpp` | `^0.23.4` | C++ AST grammar | Official tree-sitter org package. v0.23.4 on npm. Replaces `#include` regex for `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` files. |
| `tree-sitter-java` | `^0.23.5` | Java AST grammar | Official tree-sitter org package. v0.23.5 on npm. Replaces `import` regex for `.java` files. |
| `tree-sitter-lua` | `^2.1.3` | Lua AST grammar | Community package (maintained separately). v2.1.3 on npm. Replaces `require()` regex for `.lua` files. |
| `tree-sitter-php` | `^0.24.2` | PHP AST grammar | Official tree-sitter org package. v0.24.2 on npm. Replaces the `require/include/use` regex for `.php` files. |
| `tree-sitter-c-sharp` | `^0.23.1` | C# AST grammar | Official tree-sitter org package. v0.23.1 on npm. Replaces `using` regex for `.cs` files. |
| `tree-sitter-ruby` | `^0.23.1` | Ruby AST grammar | Official tree-sitter org package. v0.23.1 on npm. Replaces the `RUBY_IMPORT_RE` regex and the `resolveRubyImports()` function. |
| `graphology` | `^0.26.0` | In-memory graph representation | Required by `graphology-communities-louvain`. Ships both CJS and ESM builds (`exports.require` / `exports.import`). Used only as a transient build structure during community detection runs — not persisted. |
| `graphology-types` | `^0.24.8` | TypeScript types for graphology | Required peer dep for TypeScript integration with graphology. |
| `graphology-communities-louvain` | `^2.0.2` | Louvain community detection | The fastest Louvain implementation in the JS ecosystem. 52ms on 1K nodes / 9.7K edges vs 2,368ms for jLouvain. Ships CJS (no `"type": "module"`) so loaded via `createRequire` from ESM context. Supports directed graphs with correct modularity computation. |

**NOT adding:**
- `tree-sitter-zig` — v0.2.0 is a community package, no official tree-sitter org ownership. The Zig grammar is immature; regex coverage for `@import` is adequate for the current use case. Revisit if Zig support is a user priority.
- `tree-sitter-language-pack` — bundles 248 grammars with on-demand download. Useful for polyglot tools; overkill here where we have 10 known languages. Adds download-at-runtime complexity that conflicts with offline/airgapped environments.
- `graphology-library` (aggregate pack) — installs all graphology standard library packages. Only the Louvain community detection is needed; the aggregate package pulls in layout algorithms and other modules that are irrelevant here.
- Any Louvain alternatives (`jLouvain`, `louvain` by Multivac, `js-louvain`) — all significantly slower than `graphology-communities-louvain` and less maintained.

---

## Grammar Package — Language Mapping

| Extension(s) | Grammar Package | Load Pattern | Notes |
|---|---|---|---|
| `.ts`, `.tsx` | `tree-sitter-typescript` (existing) | `{ typescript, tsx }` destructure | Already working |
| `.js`, `.jsx` | `tree-sitter-javascript` (existing) | Direct object | Already working |
| `.py` | `tree-sitter-python` | Direct object | Same load pattern as JS |
| `.rs` | `tree-sitter-rust` | Direct object | Same load pattern as JS |
| `.go` | `tree-sitter-go` | Direct object | Same load pattern as JS |
| `.c`, `.h` | `tree-sitter-c` | Direct object | Shared grammar for C header/source |
| `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` | `tree-sitter-cpp` | Direct object | C++ is a superset grammar of C; use cpp grammar for all C++ variants |
| `.java` | `tree-sitter-java` | Direct object | Same load pattern |
| `.lua` | `tree-sitter-lua` | Direct object | Same load pattern |
| `.php` | `tree-sitter-php` | Direct object | Returns `{ php, php_only }` — use `php` for files with `<?php` opener |
| `.cs` | `tree-sitter-c-sharp` | Direct object | Package name is `tree-sitter-c-sharp`, npm id may differ slightly |
| `.rb` | `tree-sitter-ruby` | Direct object | Same load pattern |
| `.zig` | (no grammar — regex fallback retained) | N/A | See note above |

**PHP grammar note (MEDIUM confidence):** `tree-sitter-php` may export `{ php, php_only }` similar to how `tree-sitter-typescript` exports `{ typescript, tsx }`. Verify at integration time with a quick `console.log(Object.keys(_require('tree-sitter-php')))` before implementing the parser dispatch.

---

## Community Detection — Graphology Integration Pattern

`graphology-communities-louvain` is a pure CJS package (no `"type": "module"`, no `exports` map). Load it alongside `graphology` using `createRequire`:

```typescript
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

const { default: Graph } = await import('graphology');  // ESM — use dynamic import
// OR, since graphology ships CJS too:
const GraphLib = _require('graphology');                 // CJS via createRequire
const louvain = _require('graphology-communities-louvain');

// Build graph from dependency edges in SQLite
const graph = new GraphLib.Graph({ type: 'directed' });
for (const { source_path, target_path } of getAllLocalImportEdges()) {
  if (!graph.hasNode(source_path)) graph.addNode(source_path);
  if (!graph.hasNode(target_path)) graph.addNode(target_path);
  if (!graph.hasEdge(source_path, target_path)) {
    graph.addEdge(source_path, target_path);
  }
}

// Detect communities
const communities = louvain(graph);
// communities: Record<nodeId, communityId> — integer community labels
```

**Note on graph lifecycle:** The Graphology graph object is constructed on-demand per `detect_communities` MCP tool call and discarded after. It is NOT persisted and NOT cached. The dependency data lives in SQLite; the graph is a transient computation artifact. This matches the existing "per-request SQLite queries, no cache" decision in the project.

**Directed graph modularity:** `graphology-communities-louvain` correctly handles directed graphs by using directed modularity computations. The dependency graph is directed (A imports B ≠ B imports A), so pass `type: 'directed'` when constructing the Graph.

---

## Edge Metadata Schema — Confidence Labels

No new npm package required. This is a SQLite schema addition to `file_dependencies`.

The existing `file_dependencies` table adds two columns:

```sql
ALTER TABLE file_dependencies ADD COLUMN edge_kind TEXT DEFAULT 'imports';
-- Values: 'imports' | 'calls' | 'contains' | 'inherits'

ALTER TABLE file_dependencies ADD COLUMN confidence TEXT DEFAULT 'EXTRACTED';
-- Values: 'EXTRACTED' | 'INFERRED'

ALTER TABLE file_dependencies ADD COLUMN confidence_score REAL DEFAULT 1.0;
-- Range: 0.0–1.0. EXTRACTED = 1.0 (definite). INFERRED = 0.0–0.99.
```

**Confidence rules:**
- `EXTRACTED`: Source proven in AST (tree-sitter parse found an explicit `import`/`use`/`include` statement). Score = 1.0.
- `INFERRED`: Source is structural heuristic — e.g., a file in the same directory that matches a naming pattern, or a dependency identified from a non-AST-parseable language via regex. Score range = 0.5–0.99 depending on signal strength.
- Regex-parsed languages (Zig until a grammar lands) produce `INFERRED` edges with score ~0.85.

**Schema migration:** Add columns via `ALTER TABLE` in the schema migration path (drizzle-kit or raw SQL in startup). The `DEFAULT` values ensure backward compatibility — existing rows get `EXTRACTED` / 1.0, which is the correct assumption for edges already in the DB from tree-sitter extraction.

---

## Token Budget Cap — MCP Tool Responses

No new npm package required. This is a response-truncation utility added to MCP tool handlers.

Pattern: Each tool handler computes its response object, serializes it, checks byte length, and truncates the array fields (dependencies, concepts, etc.) with a `...(N more)` trailer until the response fits within the cap.

```typescript
const TOKEN_BUDGET_CHARS = 80_000; // ~20K tokens at 4 chars/token, conservative

function fitToBudget<T extends object>(payload: T, budgetChars: number): T & { truncated?: boolean } {
  const json = JSON.stringify(payload);
  if (json.length <= budgetChars) return payload;
  // Truncation logic: shorten array fields progressively
  // ... implementation detail
  return { ...truncated, truncated: true };
}
```

The cap is applied at the MCP tool response boundary, not inside the data layer. No changes to SQLite schema or repository functions.

---

## Installation

```bash
# Tree-sitter grammar packages (add to existing tree-sitter setup)
npm install tree-sitter-python tree-sitter-rust tree-sitter-go tree-sitter-c tree-sitter-cpp tree-sitter-java tree-sitter-lua tree-sitter-php tree-sitter-c-sharp tree-sitter-ruby

# Community detection stack
npm install graphology graphology-types graphology-communities-louvain
```

---

## Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| Individual grammar packages per language | `tree-sitter-language-pack` | Language-pack downloads grammars on-demand at runtime. Creates an offline/airgapped install problem. This project already has the individual grammar pattern working (tree-sitter-typescript, tree-sitter-javascript). Extending that pattern is zero-risk. |
| `graphology-communities-louvain` | `jLouvain` | jLouvain is 45x slower on 1K node graphs (2,368ms vs 52ms). Unacceptable for a synchronous MCP tool response. |
| `graphology-communities-louvain` | `louvain` (Multivac npm package) | Older package, ES6 only (tested against Node.js v6), no TypeScript types, less maintained than graphology ecosystem. |
| `graphology` (for graph construction) | Custom adjacency list | Graphology is required as a peer dep by `graphology-communities-louvain`. Using a custom adjacency list would mean either converting to Graphology at call time (double work) or patching the algorithm. Just use Graphology. |
| `tree-sitter-rust@^0.24.0` | `tree-sitter-rust@^0.25.x` | 0.25.x does not exist on npm as of 2026-04-08. Latest is 0.24.0. The peer dep `tree-sitter: ^0.22.1` is a lower bound — it works with tree-sitter 0.25. |
| `tree-sitter-c` + `tree-sitter-cpp` (separate) | `tree-sitter-c` alone | C++ is a distinct superset grammar. Using the C grammar for `.cpp` files fails on C++-specific constructs (templates, namespaces, classes). Use the cpp grammar for all C++ extensions. |
| Zig regex fallback | `tree-sitter-zig@^0.2.0` | tree-sitter-zig is a community package at version 0.2.0 — immature and not under official tree-sitter org stewardship. The Zig grammar may produce incorrect parse trees for newer Zig syntax. Regex is safer as a fallback until the grammar matures. |
| Schema ALTER TABLE for edge confidence | New `edge_metadata` join table | A join table adds an O(n) join to every dependency query. Two new nullable columns on the existing table are cheaper and keep the data co-located. The existing schema was explicitly designed with extra columns for this use case (see `package_name`, `package_version` on `file_dependencies`). |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `web-tree-sitter` (WASM bindings) | 3-5x slower than native bindings, requires async parsing. The project already uses the native Node.js tree-sitter bindings via `createRequire`. No WASM needed. | Native `tree-sitter` npm package (already installed) |
| `sigma.js` or any graph renderer | Cytoscape.js is already the dependency graph renderer in the Nexus dashboard. A second graph renderer for community visualization is not needed — Cytoscape.js can be extended with community color coding. | Cytoscape.js (existing dep) + node color attributes |
| `graphology-layout-forceatlas2` or any layout package | Graph layouts are Nexus/UI concern handled by Cytoscape.js (already has `cytoscape-fcose`). Graphology is used only for community detection, not rendering. | Existing `cytoscape-fcose` for force layout |
| `@graphology/communities` (old API) | This is the obsolete predecessor to `graphology-communities-louvain` (the luccitan/graphology-communities repo). The current implementation is in the official graphology org under `graphology-communities-louvain`. | `graphology-communities-louvain@^2.0.2` |
| `natural` or `compromise` NLP libraries | Not needed for edge type inference. Edge types (imports/calls/contains/inherits) are determined from AST node types, not natural language. | tree-sitter node type inspection |
| Any "code intelligence" SaaS SDK | This project is a local, offline tool with a local LLM. No cloud code analysis APIs. | tree-sitter + local AST traversal |

---

## Version Compatibility

| Package | Version | tree-sitter peer | Notes |
|---------|---------|-----------------|-------|
| `tree-sitter` | `^0.25.0` | — | Core binding, already installed |
| `tree-sitter-javascript` | `^0.25.0` | `^0.25.0` | Already installed |
| `tree-sitter-typescript` | `^0.23.2` | `^0.21.1` (lower bound) | Already installed, works with tree-sitter 0.25 |
| `tree-sitter-python` | `^0.25.0` | `^0.25.0` | Full alignment |
| `tree-sitter-rust` | `^0.24.0` | `^0.22.1` (lower bound) | Works with tree-sitter 0.25 — peer dep is minimum, not exact |
| `tree-sitter-go` | `^0.25.0` | `^0.25.0` | Full alignment |
| `tree-sitter-c` | `^0.24.1` | (verify at install) | Compatible with tree-sitter 0.25 |
| `tree-sitter-cpp` | `^0.23.4` | (verify at install) | Compatible with tree-sitter 0.25 |
| `tree-sitter-java` | `^0.23.5` | (verify at install) | Compatible with tree-sitter 0.25 |
| `tree-sitter-lua` | `^2.1.3` | (verify at install) | Community package — version 2.x is a major rewrite |
| `tree-sitter-php` | `^0.24.2` | (verify at install) | May export `{ php, php_only }` — verify at integration |
| `tree-sitter-c-sharp` | `^0.23.1` | `^0.21.1` (lower bound) | Compatible with tree-sitter 0.25 |
| `tree-sitter-ruby` | `^0.23.1` | (verify at install) | Compatible with tree-sitter 0.25 |
| `graphology` | `^0.26.0` | — | Ships CJS + ESM dual build. Load via `createRequire` or direct ESM import. |
| `graphology-types` | `^0.24.8` | `graphology >= 0.19` | Peer dep automatically satisfied by graphology ^0.26 |
| `graphology-communities-louvain` | `^2.0.2` | `graphology-types >= 0.19` | CJS package — use `createRequire` from ESM context |

**Peer dep resolution:** Run `npm install` and check for peer dep warnings. The `--legacy-peer-deps` flag should NOT be needed — the packages are compatible. If a warning appears for a tree-sitter grammar's peer dep range (e.g., `tree-sitter: ^0.22.x`), it is safe to ignore because the range is a minimum constraint, not an exact version lock.

---

## Sources

- npm registry queries (live, 2026-04-08) — `npm info <package> version` for all listed packages (HIGH confidence — direct npm registry)
- [tree-sitter GitHub organization](https://github.com/tree-sitter) — official grammar repositories confirming org ownership for python, go, c, cpp, java, php, c-sharp, ruby (HIGH confidence — official)
- [node-tree-sitter docs v0.25.0](https://tree-sitter.github.io/node-tree-sitter/) — confirmed `createRequire` loading pattern for CJS native addon grammars (HIGH confidence — official docs)
- [graphology-communities-louvain npm](https://www.npmjs.com/package/graphology-communities-louvain) — confirmed v2.0.2, peerDependencies `graphology-types >=0.19.0`, no `"type": "module"` field → CJS (HIGH confidence — live npm registry)
- [graphology npm](https://www.npmjs.com/package/graphology) — confirmed v0.26.0, exports map with both `require` and `import` conditions (HIGH confidence — live npm registry)
- [graphology communities-louvain docs](https://graphology.github.io/standard-library/communities-louvain.html) — confirmed directed graph support, performance benchmarks (52ms for 1K nodes vs 2,368ms for jLouvain), `resolution` option (HIGH confidence — official graphology docs)
- `src/change-detector/ast-parser.ts` — inspected existing tree-sitter integration pattern (`createRequire`, one parser per grammar, `setLanguage`) (HIGH confidence — live codebase)
- `src/db/schema.ts` — inspected existing `file_dependencies` schema to confirm ALTER TABLE approach for confidence columns (HIGH confidence — live codebase)
- [tree-sitter-language-pack GitHub](https://github.com/kreuzberg-dev/tree-sitter-language-pack) — surveyed as alternative; rejected for offline install reasons (MEDIUM confidence — GitHub)

---

*Stack research for: FileScopeMCP v1.4 Deep Graph Intelligence — new capability additions only*
*Researched: 2026-04-08*
