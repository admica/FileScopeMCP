# Architecture Research

**Domain:** Tree-sitter AST extraction, confidence-labeled edges, community detection, MCP token budgeting — integrated into existing FileScopeMCP per-repo daemon
**Researched:** 2026-04-08
**Confidence:** HIGH (built from direct source reading + verified external research)

---

## Standard Architecture

### System Overview (v1.4 additions labeled NEW or MODIFIED)

```
 chokidar watcher
       |
       v
 coordinator.ts  ─── handleFileEvent()
       |                    |
       |           [ast-extractor/]          NEW module directory
       |           LanguageConfig registry
       |           extractEdges(filePath, content)
       |                    |
       |           Returns: Edge[] with type, weight, confidence
       |
       v
 file-utils.ts
 updateFileNodeOnChange() / addFileNode()    MODIFIED: calls extractEdges()
       |
       v
 db/repository.ts  ─── setEdges()           MODIFIED: replaces setDependencies()
       |
       v
 db/schema.ts  ─── file_dependencies        MODIFIED: +4 columns
               ─── file_communities          NEW table
       |
       v
 [graph/community.ts]                        NEW module
       |     graphology directed graph built from DB edges
       |     graphology-communities-louvain clustering
       |     persistCommunities() → file_communities table
       |
       v
 mcp-server.ts  ─── get_community tool      NEW tool
                    budget-capped responses  MODIFIED tools
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|---------------|--------|
| `src/ast-extractor/` | LanguageConfig registry, per-language AST edge extraction, confidence assignment | NEW |
| `src/ast-extractor/languages/ts-js.ts` | TS/JS edges via existing tree-sitter parsers (import, re-export) | NEW |
| `src/ast-extractor/languages/python.ts` | Python import edges via tree-sitter-python grammar | NEW |
| `src/ast-extractor/languages/rust.ts` | Rust use/mod edges via tree-sitter-rust grammar | NEW |
| `src/ast-extractor/languages/go.ts` | Go import edges via tree-sitter-go grammar (replaces regex for Go) | NEW |
| `src/ast-extractor/languages/regex-fallback.ts` | All remaining languages via existing IMPORT_PATTERNS regex | EXTRACTED |
| `src/graph/community.ts` | Build graphology graph from DB edges, run Louvain, persist assignments | NEW |
| `src/db/schema.ts` | Add `edge_type`, `weight`, `confidence`, `confidence_source` to file_dependencies; add `file_communities` table | MODIFIED |
| `src/db/repository.ts` | Add `setEdges()`, `getAllEdges()`, `getCommunityForFile()`, `getCommunityMembers()`, `batchSetCommunities()` | MODIFIED |
| `src/file-utils.ts` | `analyzeNewFile()` delegates to `extractEdges()` instead of inline regex/AST chains | MODIFIED |
| `src/coordinator.ts` | Pass 2 calls `extractEdges()`; `recomputeCommunities()` after batch and on edge change | MODIFIED |
| `src/mcp-server.ts` | Add `get_community` tool; add `budgetCap()` to all text responses | MODIFIED |
| `src/change-detector/ast-parser.ts` | No change — owns export snapshots and semantic diff, orthogonal concern | UNCHANGED |

---

## Recommended Project Structure

```
src/
├── ast-extractor/          # NEW: AST edge extraction pipeline
│   ├── index.ts            # extractEdges(filePath, content, root): Edge[] — public API
│   ├── types.ts            # EdgeType enum, Edge interface, LanguageConfig interface
│   ├── registry.ts         # LanguageConfig array, getConfig(ext) dispatch
│   └── languages/          # One file per language group
│       ├── ts-js.ts        # .ts .tsx .js .jsx — reuses existing tree-sitter parsers
│       ├── python.ts       # .py — tree-sitter-python (new npm dep)
│       ├── rust.ts         # .rs — tree-sitter-rust (new npm dep)
│       ├── go.ts           # .go — tree-sitter-go (new npm dep, replaces regex)
│       └── regex-fallback.ts  # .c .cpp .lua .zig .php .cs .java .rb — IMPORT_PATTERNS
├── graph/                  # NEW: graph analytics
│   └── community.ts        # buildGraph(), runLouvain(), persistCommunities()
├── cascade/                # unchanged
├── change-detector/        # unchanged
├── broker/                 # unchanged
├── db/
│   ├── schema.ts           # MODIFIED: new columns + file_communities table
│   └── repository.ts       # MODIFIED: new edge CRUD, community CRUD
├── coordinator.ts          # MODIFIED: calls extractEdges(), triggers community recompute
├── file-utils.ts           # MODIFIED: analyzeNewFile() delegates to extractEdges()
└── mcp-server.ts           # MODIFIED: get_community tool, budgetCap helper
```

### Structure Rationale

- **`ast-extractor/` isolated from `change-detector/`:** The extractor produces edges only. It does not touch staleness, LLM jobs, or ChangeDetector concerns. `change-detector/ast-parser.ts` owns export snapshots and semantic diff — those stay where they are.
- **`languages/` one file per group:** Adding a new grammar is a single-file addition plus one entry in `registry.ts`. No cross-cutting edits to coordinator or file-utils.
- **`regex-fallback.ts` keeps existing IMPORT_PATTERNS verbatim:** If a new grammar causes issues, route the extension back to regex-fallback. Rollback is one registry change.
- **`graph/community.ts` separate from `db/`:** Community detection is computational (graphology algorithms), not persistence. It reads from and writes to the DB through `repository.ts` — it never touches SQLite directly.

---

## Architectural Patterns

### Pattern 1: LanguageConfig Registry

**What:** A registry maps file extensions to a `LanguageConfig` object with a single method `extractEdges(filePath, content, projectRoot): Promise<Edge[]>`. The public `extractEdges` in `ast-extractor/index.ts` looks up the config by extension and delegates.

**When to use:** Any new language or grammar — add one entry to the registry and one implementation file. No changes elsewhere.

**Trade-offs:** Slight indirection vs. the existing inline `if (ext === '.ts') ... else if (ext === '.go') ...` chains. Worth it: those chains are duplicated in at least three places (`coordinator.ts` Pass 2, `analyzeNewFile()`, `updateFileNodeOnChange()`).

**Example:**
```typescript
// src/ast-extractor/types.ts
export type EdgeType = 'imports' | 'calls' | 'contains' | 'inherits';
export type ConfidenceSource = 'EXTRACTED' | 'INFERRED';

export interface Edge {
  targetPath: string;          // resolved absolute path or package name
  edgeType: EdgeType;
  weight: number;              // reference count (default 1, higher for repeated calls)
  confidence: number;          // 0.0–1.0
  confidenceSource: ConfidenceSource;
  isPackage: boolean;          // true = package_import, false = local_import
}

export interface LanguageConfig {
  extensions: string[];
  extractEdges(
    filePath: string,
    content: string,
    projectRoot: string
  ): Promise<Edge[]>;
}

// src/ast-extractor/registry.ts
const configs: LanguageConfig[] = [
  tsJsConfig, pythonConfig, goConfig, rustConfig, regexFallbackConfig
];

export function getLanguageConfig(ext: string): LanguageConfig | null {
  return configs.find(c => c.extensions.includes(ext)) ?? null;
}
```

**Confidence assignment by source:**
- Tree-sitter extracted imports: `confidence = 1.0`, `confidenceSource = 'EXTRACTED'`
- Regex-based imports (c, cpp, lua, zig, php, cs, java, rb): `confidence = 0.75`, `confidenceSource = 'INFERRED'`
- Future call-graph edges inferred from type info: `confidence = 0.5–0.8`, `confidenceSource = 'INFERRED'`

### Pattern 2: Edge Schema Extension with Confidence Columns

**What:** Extend the existing `file_dependencies` table with four new nullable columns: `edge_type TEXT DEFAULT 'imports'`, `weight INTEGER DEFAULT 1`, `confidence REAL DEFAULT 1.0`, `confidence_source TEXT DEFAULT 'EXTRACTED'`. All existing rows get defaults on `ALTER TABLE`. New rows from tree-sitter get populated values.

**When to use:** Any time a dependency edge is written. `setEdges()` in repository.ts replaces `setDependencies()` and writes these columns. `setDependencies()` becomes a thin backward-compat wrapper calling `setEdges()`.

**Why not a new table:** The existing `file_dependencies` table has correct indexes on `source_path` and `target_path`. A second table would require joins everywhere. Four nullable columns with defaults are an O(1) `ALTER TABLE` — zero data copy, zero downtime.

**Migration (inside existing schema_version gate):**
```sql
ALTER TABLE file_dependencies ADD COLUMN edge_type TEXT DEFAULT 'imports';
ALTER TABLE file_dependencies ADD COLUMN weight INTEGER DEFAULT 1;
ALTER TABLE file_dependencies ADD COLUMN confidence REAL DEFAULT 1.0;
ALTER TABLE file_dependencies ADD COLUMN confidence_source TEXT DEFAULT 'EXTRACTED';

CREATE TABLE IF NOT EXISTS file_communities (
  file_path      TEXT PRIMARY KEY NOT NULL,
  community_id   INTEGER NOT NULL,
  recomputed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS communities_id_idx ON file_communities(community_id);

UPDATE schema_version SET version = <N+1>;
```

SQLite `ALTER TABLE ADD COLUMN` is O(1) regardless of row count — documented behavior since SQLite 3.1.3. Nullable columns or columns with defaults pass the constraint check unconditionally.

### Pattern 3: Community Recompute with graphology + Louvain

**What:** After dependency edges are written to SQLite, build an in-memory graphology directed graph, run `graphology-communities-louvain`, and batch-write community assignments to `file_communities`. No persistent graph object — rebuild from DB each time.

**When triggered:**
1. End of `buildFileTree()` Pass 2 (full scan at startup or forced rescan)
2. After `updateFileNodeOnChange()` when `depsChanged` is true (existing flag in file-utils.ts)

**Why no persistent graph:** The graph object would need to be kept in sync with every edge write. A cold rebuild from DB is simpler and fast enough: graphology benchmark shows 10K nodes / 9.7K edges in 53ms.

```typescript
// src/graph/community.ts
import { DirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';
import { getAllEdges, batchSetCommunities } from '../db/repository.js';

export function recomputeCommunities(): void {
  const graph = new DirectedGraph();
  const edges = getAllEdges('local_import'); // package edges excluded — not useful for clustering
  for (const e of edges) {
    if (!graph.hasNode(e.source_path)) graph.addNode(e.source_path);
    if (!graph.hasNode(e.target_path)) graph.addNode(e.target_path);
    // addEdge can be called multiple times for weighted multi-edges;
    // for initial version, skip duplicate edges
    if (!graph.hasEdge(e.source_path, e.target_path)) {
      graph.addEdge(e.source_path, e.target_path);
    }
  }
  if (graph.order === 0) return;
  const communities: Record<string, number> = louvain(graph);
  batchSetCommunities(communities, Date.now());
}
```

**Louvain stability note:** Community IDs are not stable across runs (algorithm is randomized). Never expose raw community IDs to MCP callers. Always query by file path; return community members by file path.

### Pattern 4: Token Budget Cap

**What:** A `budgetCap(text, maxTokens)` helper estimates token count as `Math.ceil(text.length / 4)` and truncates at a sentence or line boundary with an annotation if exceeded. Applied in every MCP tool that produces unbounded text.

**When to use:** Every tool that formats freeform text responses: `get_file_summary`, `list_files`, `find_important_files`, `detect_cycles`, `get_community`.

**Trade-offs:** chars/4 approximation is accurate to ±15% for English/code — sufficient for a soft cap. Exact tiktoken counting would require a native dependency for a marginal improvement.

```typescript
// In mcp-server.ts
function budgetCap(text: string, maxTokens = 4000): string {
  const estimated = Math.ceil(text.length / 4);
  if (estimated <= maxTokens) return text;
  const charLimit = maxTokens * 4;
  const truncated = text.slice(0, charLimit);
  // Try to break at newline
  const lastNewline = truncated.lastIndexOf('\n');
  const clean = lastNewline > charLimit * 0.9 ? truncated.slice(0, lastNewline) : truncated;
  const omitted = estimated - maxTokens;
  return clean + `\n[truncated — ~${omitted} tokens omitted]`;
}
```

---

## Data Flow

### File Change → AST Parse → Edge Extraction → Community Update

```
chokidar 'change' event (filePath)
    |
    v  [2s debounce — existing]
coordinator.handleFileEvent('change', filePath)
    |
    v
ChangeDetector.classify(filePath)          [existing — semantic diff, UNCHANGED]
    |
    v
updateFileNodeOnChange(filePath, tree, root)  [in file-utils.ts — MODIFIED]
    |
    +-- reads file content
    |
    +-- extractEdges(filePath, content, root)   [NEW: ast-extractor/index.ts]
    |       |
    |       +-- getLanguageConfig(ext)
    |       +-- config.extractEdges(...)
    |             .ts/.tsx/.js/.jsx:
    |               existing tsParser/jsParser (already loaded in process)
    |               visit import_statement → Edge{type:'imports', confidence:1.0}
    |             .py:
    |               tree-sitter-python parser (new, createRequire pattern)
    |               import_statement / import_from_statement → Edge
    |             .rs:
    |               tree-sitter-rust parser (new, createRequire pattern)
    |               use_declaration / mod_item → Edge
    |             .go:
    |               tree-sitter-go parser (new, createRequire pattern)
    |               import_declaration → Edge (replaces existing Go regex)
    |             .c/.cpp/.lua/.zig/.php/.cs/.java/.rb:
    |               existing IMPORT_PATTERNS regex (unchanged logic)
    |               confidence = 0.75, source = 'INFERRED'
    |
    +-- diffOldEdgesVsNew(oldEdges, newEdges)   [existing depsChanged logic]
    |
    +-- setEdges(filePath, newEdges)            [NEW: replaces setDependencies()]
    |     DELETE WHERE source_path = ?
    |     INSERT rows with edge_type, weight, confidence, confidence_source
    |
    +-- if (depsChanged):
          recomputeCommunities()               [NEW: graph/community.ts]
              reads all local edges from DB
              builds graphology DirectedGraph
              runs louvain()
              batchSetCommunities() → file_communities
```

### Initial Full Scan (Pass 2 in buildFileTree)

```
coordinator.buildFileTree()
    |
    v  Pass 1: stream metadata into SQLite [UNCHANGED]
    |
    v  Pass 2: extract edges [MODIFIED]
    |   for each filePath:
    |     content = readFile(filePath)
    |     edges = extractEdges(filePath, content, baseDir)
    |     setEdges(filePath, edges)
    |
    v  Pass 2b: importance [UNCHANGED]
    |
    v  Pass 2c: community detection [NEW]
         recomputeCommunities()
```

### MCP Query → Community Response

```
Claude Code → get_community({ file_path })
    |
    v  mcp-server.ts tool handler
    |
    v  getCommunityForFile(filePath) → community_id
    |
    v  getCommunityMembers(community_id) → FileNode[]
    |  sorted by importance DESC
    |
    v  format: path, importance, summary_snippet (first 80 chars)
    |
    v  budgetCap(responseText, 4000)
    |
    v  MCP text response
```

---

## Integration Points

### Existing Modules: What Changes and What Does Not

| Module | Change | Scope |
|--------|--------|-------|
| `src/file-utils.ts` | `analyzeNewFile()` calls `extractEdges()` instead of inline regex/AST branches | Consolidation — eliminates 3 duplicated extraction chains |
| `src/coordinator.ts` | Pass 2 loop calls `extractEdges()` and `setEdges()`; adds `recomputeCommunities()` at end of Pass 2 and inside `handleFileEvent` on `depsChanged` | Core pipeline wiring |
| `src/db/schema.ts` | Add 4 columns to `file_dependencies`; add `file_communities` table with index | Schema evolution |
| `src/db/repository.ts` | Add `setEdges()`, `getAllEdges()`, `getCommunityForFile()`, `getCommunityMembers()`, `batchSetCommunities()`; keep `setDependencies()` as thin backward-compat wrapper | New API surface |
| `src/mcp-server.ts` | Add `get_community` tool handler; wrap all text responses in `budgetCap()` | New feature |
| `src/change-detector/ast-parser.ts` | No change — orthogonal concern (export snapshots + semantic diff) | UNCHANGED |
| `src/cascade/cascade-engine.ts` | No change | UNCHANGED |
| `src/broker/` | No change | UNCHANGED |
| `src/nexus/` | No change | UNCHANGED |

### New External Dependencies

| Package | Purpose | Install | Confidence |
|---------|---------|---------|-----------|
| `tree-sitter-python` | Python AST grammar for Node.js | `npm install tree-sitter-python` | HIGH — official tree-sitter org repo, v0.25.x on npm |
| `tree-sitter-rust` | Rust AST grammar for Node.js | `npm install tree-sitter-rust` | HIGH — official tree-sitter org repo, v0.25.x on npm |
| `tree-sitter-go` | Go AST grammar for Node.js | `npm install tree-sitter-go` | HIGH — 200+ dependents on npm, official org |
| `graphology` | Typed directed graph data structure | `npm install graphology` | HIGH — widely used, official docs |
| `graphology-communities-louvain` | Louvain clustering | `npm install graphology-communities-louvain` | HIGH — official graphology standard library |

All new grammars follow the same `createRequire` / CJS native addon pattern established in `src/change-detector/ast-parser.ts`. No new native binding patterns needed.

### Internal Boundaries

| Boundary | Communication | Constraint |
|----------|---------------|-----------|
| `coordinator.ts` → `ast-extractor/` | Direct function call: `extractEdges(path, content, root)` | No IPC; same process; synchronous except for file reads |
| `coordinator.ts` → `graph/community.ts` | Direct function call: `recomputeCommunities()` | Synchronous; graphology 10K-node run ~53ms per benchmark |
| `graph/community.ts` → `db/repository.ts` | `getAllEdges()` + `batchSetCommunities()` | community.ts has no direct SQLite access |
| `ast-extractor/` ↔ `change-detector/` | None | These are independent — extractor produces edges; change-detector produces semantic diffs. No shared state. |
| `mcp-server.ts` → `db/repository.ts` | Existing pattern; adds `getCommunityForFile()` + `getCommunityMembers()` | No new patterns |
| `ast-extractor/languages/ts-js.ts` → `change-detector/ast-parser.ts` | Reuses same parser instances (tsParser, tsxParser, jsParser) | Import the parser instances; do NOT duplicate parser construction |

**Critical:** `ast-extractor/languages/ts-js.ts` must reuse the parser instances already created in `change-detector/ast-parser.ts`, not construct new ones. Two `new Parser()` instances for the same grammar would double memory and startup cost. Export the parser instances from ast-parser.ts and import them in ts-js.ts.

---

## Schema Migration Plan

### Approach: Incremental ALTER TABLE inside existing schema_version gate

The project already has `schema_version` table and `runMigrationIfNeeded()` in `src/migrate/json-to-sqlite.ts`. The migration runner checks the version integer and applies steps sequentially. Add v1.4 schema changes there — do not invent a new migration mechanism.

```sql
-- v1.4 migration (executed once, inside schema_version version check)

-- Step 1: Extend file_dependencies with edge metadata columns
-- O(1) regardless of row count — SQLite ALTER TABLE ADD COLUMN guarantee
ALTER TABLE file_dependencies ADD COLUMN edge_type TEXT DEFAULT 'imports';
ALTER TABLE file_dependencies ADD COLUMN weight INTEGER DEFAULT 1;
ALTER TABLE file_dependencies ADD COLUMN confidence REAL DEFAULT 1.0;
ALTER TABLE file_dependencies ADD COLUMN confidence_source TEXT DEFAULT 'EXTRACTED';

-- Step 2: Community assignments table
CREATE TABLE IF NOT EXISTS file_communities (
  file_path      TEXT PRIMARY KEY NOT NULL,
  community_id   INTEGER NOT NULL,
  recomputed_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS communities_id_idx ON file_communities(community_id);

-- Step 3: Bump version
UPDATE schema_version SET version = <N+1>;
```

**Drizzle note:** The project uses a hand-rolled migration runner, not drizzle-kit migrations. Add the new table definition to `src/db/schema.ts` for Drizzle ORM type safety, but add the actual migration SQL directly to `runMigrationIfNeeded()`.

**Backward compat:** All existing callers of `getDependencies()`, `getDependents()`, `getAllLocalImportEdges()` continue to work unchanged — those functions filter on `dependency_type` which is not affected by the new columns.

---

## Build Order (Phase Dependency Graph)

Phases must be executed in this sequence:

```
Phase A: Schema migration
         file_dependencies +4 cols, file_communities table
         (required first — code writing new columns fails on old schema)
    |
    v
Phase B: ast-extractor/ module — new module, no existing code changed
         B1: types.ts + interfaces (no deps)
         B2: languages/regex-fallback.ts (ports IMPORT_PATTERNS, no new npm deps)
         B3: languages/ts-js.ts (reuses existing parser instances from ast-parser.ts)
         B4: languages/python.ts, rust.ts, go.ts (new grammar npm installs)
         B5: registry.ts + index.ts (wires dispatch)
    |
    v
Phase C: db/repository.ts — new edge CRUD + community CRUD
         setEdges(), getAllEdges(), batchSetCommunities()
         getCommunityForFile(), getCommunityMembers()
         (depends on schema from A; used by D and E)
    |
    v
Phase D: file-utils.ts + coordinator.ts — wire extractEdges() into pipeline
         analyzeNewFile() replaced
         coordinator Pass 2 replaced
         (depends on B for extractEdges API, C for setEdges)
    |
    v
Phase E: graph/community.ts — Louvain implementation
         (depends on C for getAllEdges/batchSetCommunities)
         (triggered from coordinator in D)
    |
    v
Phase F: mcp-server.ts — get_community tool + budgetCap on all tools
         (depends on C for getCommunity* queries)
         (budgetCap helper is standalone, can be done in any phase)
```

**Rationale for this ordering:**
- Schema first: writing edge_type to a schema that lacks the column throws at runtime.
- ast-extractor before coordinator: coordinator.ts imports `extractEdges`; module must exist.
- regex-fallback before new grammars: confirms LanguageConfig interface works before adding native deps.
- ts-js before python/rust/go: lower risk (no new npm deps), validates the pattern.
- repository.ts before community.ts: community.ts reads via repository functions, not raw SQL.
- MCP tool last: community must be populated before the tool returns meaningful results.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Adding a Fourth Extraction Code Path In-Place

**What people do:** Add tree-sitter grammar extraction as another branch inside the existing `if (isTreeSitterLanguage(ext)) { ... } else if (ext === '.go') { ... } else if (IMPORT_PATTERNS[ext]) { ... }` chain in coordinator.ts and file-utils.ts.

**Why it's wrong:** That chain is duplicated in at least three places. Every new grammar means three edits. The duplication is what makes the current code hard to extend.

**Do this instead:** Introduce the `LanguageConfig` registry. All three call sites become `extractEdges(filePath, content, projectRoot)` — one line, one place to change.

### Anti-Pattern 2: Caching ASTs Between File Events

**What people do:** Cache the parsed tree-sitter tree object in a `Map<string, Tree>` between file change events to avoid re-parsing.

**Why it's wrong:** The project explicitly ruled out AST caching ("ASTs too large and go stale immediately"). In-memory caching also conflicts with chokidar's debounce model — the cached tree would be stale by the time the debounce fires. Tree-sitter re-parse of a 500-line file takes ~1ms. No cache needed.

**Do this instead:** Parse on demand. If incremental re-parse performance becomes measurable, revisit then.

### Anti-Pattern 3: Running Louvain in the Broker

**What people do:** Route community recompute as a job through the LLM broker since it's a background computation.

**Why it's wrong:** Community detection is not an LLM task — it is a pure graph algorithm that completes in <200ms. Routing it through the broker adds Unix socket IPC round-trip latency and couples a non-LLM concern to the LLM pipeline unnecessarily.

**Do this instead:** Call `recomputeCommunities()` directly in the coordinator after dependency updates, synchronously inside `treeMutex.run()`. Fast enough.

### Anti-Pattern 4: Storing Community Assignments in the files Table

**What people do:** Add `community_id INTEGER` as a column on the `files` table.

**Why it's wrong:** Communities are recomputed as a full batch — individual UPDATE per file would be N separate statements plus the full batch replace semantics are awkward on an existing primary-key table.

**Do this instead:** Use the dedicated `file_communities` table. `batchSetCommunities()` does `DELETE FROM file_communities` + bulk INSERT in one transaction. Clean semantics, clean separation.

### Anti-Pattern 5: Exposing Raw Community IDs to MCP Callers

**What people do:** Return `{ communityId: 42, files: [...] }` from `get_community`.

**Why it's wrong:** Louvain community IDs are arbitrary integers that change with every recompute (algorithm is randomized, seeded by graph traversal order). IDs are not stable. Callers cannot bookmark them.

**Do this instead:** Accept `file_path` as the input; look up that file's community; return all community members as file paths with their metadata. Never expose the raw integer ID.

### Anti-Pattern 6: Constructing Duplicate Parser Instances for ts-js.ts

**What people do:** In `ast-extractor/languages/ts-js.ts`, construct new `Parser()` instances for TypeScript and JavaScript grammars independently of `change-detector/ast-parser.ts`.

**Why it's wrong:** The project already constructs `tsParser`, `tsxParser`, `jsParser` in ast-parser.ts at module load time. Constructing duplicates doubles memory for tree-sitter's internal state and adds startup overhead for grammar loading.

**Do this instead:** Export the parser instances from `ast-parser.ts` and import them in `ts-js.ts`. The extractor uses the same parser objects for its own AST walks.

---

## Scaling Considerations

| Scale | Concern | Approach |
|-------|---------|---------|
| <500 files | All patterns as described | No changes needed |
| 500–5K files | Community recompute per edge-change event | Fine — graphology 10K nodes in ~53ms |
| 5K–50K files | Recompute frequency on large active repos | Batch: only trigger at end of chokidar debounce window, not per individual file event |
| 50K+ files | Out of scope per PROJECT.md | graphology-communities-louvain handles 10M+ edges; not a near-term concern |

---

## Sources

- Direct source reading: `src/change-detector/ast-parser.ts`, `src/db/schema.ts`, `src/db/repository.ts`, `src/coordinator.ts`, `src/file-utils.ts`, `src/cycle-detection.ts`, `src/types.ts`, `package.json` — HIGH confidence
- [graphology-communities-louvain official docs](https://graphology.github.io/standard-library/communities-louvain.html) — HIGH confidence
- [graphology GitHub repository](https://github.com/graphology/graphology) — HIGH confidence
- [tree-sitter-go npm](https://www.npmjs.com/package/tree-sitter-go) — HIGH confidence (official org, 200+ dependents)
- [tree-sitter-rust npm](https://www.npmjs.com/package/tree-sitter-rust) — HIGH confidence (official org)
- [node-tree-sitter GitHub](https://github.com/tree-sitter/node-tree-sitter) — HIGH confidence (official)
- [SQLite ALTER TABLE documentation](https://www.sqlite.org/lang_altertable.html) — HIGH confidence (O(1) column add confirmed)
- [Codebase-Memory arxiv preprint](https://arxiv.org/html/2603.27277) — MEDIUM confidence (demonstrates tree-sitter + confidence-scored edges + Louvain community pattern in an MCP context)

---

*Architecture research for: FileScopeMCP v1.4 Deep Graph Intelligence*
*Researched: 2026-04-08*
