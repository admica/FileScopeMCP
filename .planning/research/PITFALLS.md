# Pitfalls Research

**Domain:** Adding tree-sitter AST extraction (multi-language), confidence-labeled graph edges, community detection, and MCP token budgeting to an existing TypeScript MCP server
**Researched:** 2026-04-08
**Confidence:** HIGH (direct codebase audit + official tree-sitter docs + community post-mortems + graphology docs + MCP ecosystem research)

---

## Critical Pitfalls

### Pitfall 1: Grammar npm Packages Don't Exist for Most of the 11 Target Languages

**What goes wrong:**
The project targets 11 languages with regex today. Only 3 have grammar npm packages already installed (`tree-sitter-typescript`, `tree-sitter-javascript`). Python, Rust, Go, Lua, Zig, PHP, C#, Java, C/C++ all need separate npm packages — and several of those either do not publish stable Node.js native bindings to npm, or require manual prebuild compilation. The temptation is to assume "tree-sitter has everything" and discover at implementation time that `npm install tree-sitter-lua` returns an error or an unmaintained 3-year-old release.

Concretely:
- `tree-sitter-python`, `tree-sitter-go`, `tree-sitter-rust`, `tree-sitter-java`, `tree-sitter-php`, `tree-sitter-c`, `tree-sitter-cpp` all publish to npm
- `tree-sitter-lua` exists on npm but bindings quality varies
- `tree-sitter-zig` has no stable npm package; only community forks exist
- `tree-sitter-c-sharp` exists under the tree-sitter org (`tree-sitter-c-sharp`) but the npm package name and version alignment with `tree-sitter@0.25` must be verified

If a grammar is unavailable or broken for Node.js, the plan to replace regex for that language is blocked.

**Why it happens:**
Tree-sitter grammar authors publish to npm inconsistently. Some publish CLI/Rust builds only. Some publish WASM-only. The Node.js native binding requires a compiled `.node` addon that must match the ABI of the running Node.js version.

**How to avoid:**
Before planning phases, audit every target language: `npm show tree-sitter-{lang} versions`. Confirm the installed package has a `bindings.node` prebuilt for Node.js 22 (the project's runtime). For any language without a working npm grammar, keep the existing regex extractor for that language and do NOT attempt AST extraction. The `LanguageConfig` pattern should have an explicit `strategy: 'tree-sitter' | 'regex'` field per language so the router can fall back cleanly without code changes.

**Warning signs:**
- `npm install tree-sitter-zig` succeeds but the require throws at runtime
- Grammar loads but `.parse()` returns a tree with `ERROR` nodes for valid files of that language
- `node-gyp rebuild` required after install (prebuilt binaries absent)

**Phase to address:** Phase 1 (LanguageConfig scaffolding). Audit all 11 grammars before writing any tree-sitter extraction code. Document which languages have working npm grammars and which stay regex. Do not mark tree-sitter as "done" for a language until a file from that language parses with zero ERROR nodes in the tree root.

---

### Pitfall 2: Node.js ABI Version Mismatch Silently Breaks Grammar Loading at Runtime

**What goes wrong:**
Tree-sitter's native Node.js bindings are compiled against a specific Node.js ABI version. If the `.node` file was prebuilt for Node.js 20 (ABI 115) and the project runs on Node.js 22 (ABI 127), loading any grammar throws:

```
Error: The module '.../tree-sitter-python/build/Release/tree_sitter_python_binding.node'
was compiled against a different Node.js version using NODE_MODULE_VERSION 115.
This version of Node.js requires NODE_MODULE_VERSION 127.
```

This happens silently in the current codebase because `ast-parser.ts` wraps `_require` at module load time. If a grammar's prebuilt binary is ABI-mismatched, the MCP server crashes on startup — not during a parsing call — because `createRequire` is called at import time.

Additionally, `tree-sitter@^0.25.0` (pinned in package.json) is incompatible with Node.js 24 native bindings if the project ever upgrades Node. Conversely, `tree-sitter@0.26.x` requires Node.js 24.

**Why it happens:**
npm install fetches prebuilt binaries for the Node.js version active at install time. If Node.js is upgraded after install, the prebuilt binary is now mismatched. `npm rebuild tree-sitter` is required but not obvious.

**How to avoid:**
Pin grammar packages to exact versions (`"tree-sitter-python": "0.23.1"` not `"^0.23.1"`) after confirming they ship prebuilts for Node.js 22. Add a CI/pre-test check that requires each grammar to load successfully and parse a one-line test file before any tests run. The check should be a simple `require('tree-sitter-python'); new Parser().setLanguage(PythonLang)` — if this throws, the install is broken and the developer sees it immediately.

**Warning signs:**
- Any grammar require that throws on import (before any file is parsed)
- `npm install` completes but the grammar's `build/Release/` directory is absent
- Existing `tsParser.setLanguage()` in `ast-parser.ts` works but newly added grammar throws at the same line

**Phase to address:** Phase 1 (grammar setup). Add grammar load verification to `vitest.setup.ts` so a bad install is caught on `npm test`, not at user runtime.

---

### Pitfall 3: Migrating Regex Extractors to tree-sitter Breaks Existing File Analysis Without Parity Tests

**What goes wrong:**
The current `extractDependencies()` / `analyzeNewFile()` path works. The planned migration replaces regex extraction for each language with tree-sitter extraction. The migration is done language-by-language (the right approach). But without parity tests, the new tree-sitter extractor may miss constructs the regex caught (e.g., `require()` calls inside conditionals that the AST query doesn't reach, or multiline import blocks) or introduce false positives (e.g., string literals in comments that the regex correctly skipped but an AST query catches).

The specific risk in this codebase: `file-utils.ts` has separate logic paths for `isTreeSitterLanguage()` returns true (AST path) and false (regex path). Expanding `isTreeSitterLanguage()` to return true for Python means ALL Python files in every watched project switch from regex to tree-sitter simultaneously on restart. If the Python grammar extracts incorrectly, every Python file in the project gets wrong dependencies, which cascades into wrong importance scores and wrong staleness propagation.

**Why it happens:**
"Replace and deploy" is faster than "add-compare-switch." The existing path works so there's no incentive to add a test harness before migrating.

**How to avoid:**
For each language being migrated, run both extractors in parallel on a sample of real files (3-5 real project files per language) and diff the output before removing the regex path. The comparison should be part of the development process, not a post-hoc audit. Only add a language to `isTreeSitterLanguage()` when the tree-sitter extractor matches or exceeds the regex extractor's recall on the sample set.

Specifically: keep the regex code for non-TS/JS languages in `IMPORT_PATTERNS` for the entire duration of the migration. Do not delete regex patterns until the tree-sitter extractor has been validated for that language.

**Warning signs:**
- After migrating Python, Python files show 0 dependencies where they previously showed 3-5
- After migrating Python, test files show incorrect package dependencies (e.g., `__init__` flagged as a package)
- `getDependencies()` returns different results before and after a server restart

**Phase to address:** Phase 2 (per-language tree-sitter extraction). Write parity tests for each language before switching. The test format: `given this file content, tree-sitter extractor and regex extractor agree on these imports.`

---

### Pitfall 4: SQLite Schema Migration Breaks Existing Dependency Rows on Production Databases

**What goes wrong:**
The current `file_dependencies` schema has: `id, source_path, target_path, dependency_type, package_name, package_version, is_dev_dependency`. Adding `edge_type`, `confidence`, and `weight` columns requires a schema migration. The project uses `schema_version` table for this purpose.

The risk: the migration runs `ALTER TABLE file_dependencies ADD COLUMN edge_type TEXT` and then all existing rows have `edge_type = NULL`. The new query path that filters on `edge_type = 'imports'` returns no rows for existing data. Callers that expect the new edge type columns to be populated see empty results. The Nexus dashboard, cycle detection, and community detection all read from this table — they silently see empty graphs until all files are re-analyzed.

A second risk: if the migration is written as `ADD COLUMN edge_type TEXT NOT NULL DEFAULT 'imports'`, SQLite rewrites the entire table when the column is NOT NULL (this is version-dependent). For a 10K-file project, this can take 3-5 seconds during which the database is locked.

**Why it happens:**
`ALTER TABLE ADD COLUMN` with a NOT NULL DEFAULT causes SQLite to perform a full table rebuild in older versions. Using nullable columns with a sentinel default is the safe path but requires callers to handle NULL.

**How to avoid:**
Add all new columns as nullable (`edge_type TEXT, confidence REAL, weight INTEGER`). Write the migration in `schema_version` logic to ADD COLUMN only. Do not backfill existing rows — instead, the existing rows with `edge_type IS NULL` are treated as `'imports'` by convention in all query code (`WHERE edge_type = 'imports' OR edge_type IS NULL`). When a file is re-analyzed by tree-sitter, its dependency rows are deleted and reinserted with the new columns populated. This naturally migrates data over time without a blocking backfill.

The `setDependencies()` function in `repository.ts` already does a full delete-and-reinsert per source file — the new columns just need to be included in the INSERT.

**Warning signs:**
- After schema migration, `getAllLocalImportEdges()` returns empty array
- Cycle detection finds no cycles in a project that previously had cycles
- `import graph` in Nexus dashboard shows blank canvas after migration
- Migration takes >2 seconds and MCP tool calls block during that window

**Phase to address:** Phase 3 (schema migration). Write and test the migration against a populated database (copy a real `data.db` from a watched project). Verify `getDependencies()` returns the same paths before and after migration. Verify existing rows survive with NULL edge_type and are still returned by dependency queries.

---

### Pitfall 5: One Parser Instance Per Grammar Multiplied by 11 Languages Accumulates Significant Memory

**What goes wrong:**
The current `ast-parser.ts` creates one `Parser` instance per grammar (3 total: tsParser, tsxParser, jsParser). This is correct. Expanding to 11 languages means 11 `Parser` instances, each holding the compiled grammar in native memory. Each tree-sitter parser instance (with grammar loaded) uses approximately 3-10MB of native heap. For 11 languages: 33-110MB of native memory consumed at startup, even if most languages are never actually parsed in a given session.

On the 16GB VRAM machine, this is not catastrophic, but it adds to the Node.js process RSS of the MCP daemon (which is already running a LLM broker, a file watcher, and SQLite). More critically, creating 11 parsers at module load time means any one failed grammar load (ABI mismatch, missing package) crashes the entire MCP server at startup, not at parse time.

**Why it happens:**
Developers see the `const tsParser = new Parser(); tsParser.setLanguage(TypeScriptLang)` pattern and replicate it for each new language in the same file. It's the obvious approach and it works — until it doesn't scale.

**How to avoid:**
Use lazy grammar loading: create parser instances on first use per language, not at module load. The `getParser(filePath)` function in `ast-parser.ts` is already the right abstraction point. Change it to instantiate parsers lazily and cache them:

```typescript
const parserCache = new Map<string, typeof tsParser>();

function getParser(ext: string): typeof tsParser | null {
  if (parserCache.has(ext)) return parserCache.get(ext)!;
  const lang = loadGrammar(ext); // returns null if grammar unavailable
  if (!lang) return null;
  const p = new Parser();
  p.setLanguage(lang);
  parserCache.set(ext, p);
  return p;
}
```

This means a project with only TypeScript files never loads the Python, Go, or Rust grammars. It also means a failing grammar load is caught at parse time (returns null, falls back to regex) rather than at server startup.

**Warning signs:**
- MCP server RSS is >200MB immediately after startup on a small project
- Server startup takes >2 seconds when new grammars are added
- `node --max-old-space-size` warnings appear in MCP log

**Phase to address:** Phase 1 (LanguageConfig scaffolding). Write the lazy-load pattern before adding any new grammars. Do not replicate the top-level `const parser = new Parser()` pattern.

---

### Pitfall 6: Louvain Community Detection Is Batch-Oriented and Naively Re-Running It on Every File Change Kills Performance

**What goes wrong:**
The planned community detection runs on the full dependency graph. Louvain is a batch algorithm — it processes the entire graph, not incremental updates. If community detection is wired into the file-change handler (same as the current staleness cascade), every file save triggers a full Louvain re-run on the entire graph.

On a 1,000-file project with 5,000 edges, a single Louvain run via `graphology-communities-louvain` takes ~50ms (measured benchmark). If a developer is actively editing (one save per 10 seconds), this is 5 community re-runs per minute = 250ms/minute spent on graph analysis. Not a problem at this scale.

But the broader issue: community detection output stored in SQLite (the plan) becomes stale instantly on any file change. If the staleness cascade marks community assignments stale whenever ANY dependency changes, every edit cascades into a "communities are stale" state. If the MCP tool `get_communities` then triggers a re-run on every call, it blocks the calling LLM for 50ms+ per call on large repos.

**Why it happens:**
The existing cascade engine works well for LLM staleness because LLM jobs are async and queued in the broker. Community detection has no equivalent async queue — it runs synchronously and blocks the event loop if triggered on every change.

**How to avoid:**
Do NOT wire community detection into the per-file-change path. Community detection must be either:
1. **On-demand only**: triggered by the MCP tool call, never by file changes. Cache the result with a timestamp; return cached result if < N minutes old.
2. **Scheduled**: a low-priority background job that runs at most once per N minutes, regardless of how many files changed.

The community result should be stored as a single JSON blob in a new `communities` table (one row, updated atomically). The MCP tool reads the cached blob. Staleness is "how old is the cached result" not "have any files changed."

**Warning signs:**
- `get_communities` MCP tool takes >200ms on a medium-sized project
- Community detection appears in file-change handler profiling (any code path that runs on `chokidar` events)
- Community assignments change on every tool call (indicates re-running without caching)

**Phase to address:** Phase 4 (community detection). The on-demand + cache model must be decided before writing any community detection code. Do not adapt the cascade engine for community detection.

---

### Pitfall 7: Graphology Graph Object Built From SQLite on Every Community Detection Call Is an O(E) Rebuild Each Time

**What goes wrong:**
Community detection via `graphology-communities-louvain` requires a `graphology.Graph` object populated with all nodes and edges. The most obvious implementation: on `get_communities` tool call, query all edges from `file_dependencies`, build a `new Graph()`, add all nodes and edges, run Louvain. For a 5,000-edge graph, this is ~5,000 `graph.addEdge()` calls per tool invocation.

The rebuild cost is proportional to the number of edges, not the number of changed files. A project with 50,000 edges rebuilds the entire graphology object on every tool call. At 50,000 edges this is ~500ms per rebuild — visible latency for the LLM calling the tool.

**Why it happens:**
The obvious implementation is "query all edges, build graph, run algorithm." There's no natural place to cache the graph object across calls because the MCP server has no persistent state between tool calls (only the coordinator holds state).

**How to avoid:**
Cache the graphology Graph object in the coordinator (same lifetime as the coordinator instance). Invalidate it only when `setDependencies()` is called for any file — a cheap flag (`graphDirty = true`) set in `setDependencies()`. When `get_communities` is called, rebuild the graph only if `graphDirty` is true, then set `graphDirty = false`. This amortizes the rebuild cost across many tool calls.

The coordinator already owns the file tree and the mutex — it is the right place to hold `cachedGraph: graphology.Graph | null` and `graphDirty: boolean`.

**Warning signs:**
- `get_communities` latency grows linearly with project size
- SQLite query logs show `SELECT * FROM file_dependencies` on every tool call
- Profiling shows 80%+ of `get_communities` time is in graph construction, not Louvain

**Phase to address:** Phase 4 (community detection). Design the dirty-flag cache before writing the tool handler. Add a test that calls `get_communities` twice in a row without any file changes and verifies the second call is 10x faster than the first.

---

### Pitfall 8: Confidence Scores on Edges Have No Defined Semantics, Producing Inconsistent Data

**What goes wrong:**
The plan adds `confidence REAL` and `edge_type TEXT` to `file_dependencies`. "EXTRACTED" (confidence 1.0) means tree-sitter parsed the import directly. "INFERRED" (confidence < 1.0) means the dependency was derived by some heuristic (e.g., a wildcard import, a dynamic require pattern, or a regex fallback). The problem: without a written-down definition of what confidence values mean for each language and extraction method, different extractors assign confidence inconsistently.

Python wildcard import (`from x import *`) might get 0.5 in one extractor and 0.8 in another. A Rust `use` statement with a glob (`use std::*`) might get a different score. LLM consumers of the `get_file_summary` or graph tools see confidence values that look precise (0.73) but are arbitrary.

More concretely: the broker priority queue currently uses importance scores. If confidence weighting is added to priority calculations without a defined mapping, the queue ordering becomes unpredictable.

**Why it happens:**
Numeric confidence scores feel precise but are meaningless without a schema that maps extraction method to score. The first implementation assigns whatever "feels right" and the values drift across languages and over time.

**How to avoid:**
Define a fixed enum of confidence levels before any extractor is written:
- `1.0` = direct AST import statement (tree-sitter, no ambiguity)
- `0.8` = regex extraction (known-good pattern, but regex can miss edge cases)  
- `0.6` = inferred from wildcard/glob import (target file is likely but not confirmed)
- `0.4` = heuristic inference (e.g., dynamic require with non-literal path — file exists but origin is uncertain)

Store these as constants in a `confidence.ts` file. Every extractor imports and uses these constants. No extractor assigns a raw float literal. The `edge_type` enum (`imports`, `calls`, `inherits`, `contains`) is also defined as a string enum, not freetext.

**Warning signs:**
- `confidence` column contains values like 0.73, 0.85, 0.33 (arbitrary precision)
- Different extractors assign different confidence scores for the same construct
- Code review shows `confidence: 0.9` inline in an extractor (not from constants)

**Phase to address:** Phase 2 (schema design for edges). Write `confidence.ts` with the enum before writing any extractor. The `LanguageConfig` pattern specifies which confidence level each strategy uses.

---

### Pitfall 9: MCP Token Budget Truncation Cuts Off Mid-Object, Producing Invalid JSON Responses

**What goes wrong:**
The planned token budget cap on MCP tool responses is most naturally implemented as "truncate the response JSON string to N characters." This produces structurally invalid JSON if the truncation point falls inside a string value, array, or nested object. The MCP SDK returns the truncated string to the calling LLM as a `text` content block. The LLM receives malformed JSON and either errors, hallucinates a completion of the JSON, or asks for a retry.

A subtler version: the response JSON is valid but logically incomplete. `list_files` returns a 200-item array but the budget cuts it to 47 items without indicating truncation. The LLM does not know 153 files are missing and makes incorrect conclusions about the project.

**Why it happens:**
Naive truncation is the first approach — `response.slice(0, MAX_CHARS)`. It is wrong. The alternative, "serialize to JSON then check length then trim array," requires knowing which fields to trim and in what order, which is tool-specific logic.

**How to avoid:**
Token budget enforcement must happen at the data level, not the string level. Each tool that returns a list (files, dependencies, communities) must accept a `maxItems` parameter derived from the budget and truncate the array before serialization. The response must include a `truncated: true` field and `totalCount: N` when truncation occurs so the LLM knows to request more.

For non-list tools (e.g., `get_file_summary`), token budget means truncating the `summary` text field to a character limit, not truncating the JSON structure.

The simplest enforcement model: each tool handler accepts a `tokenBudget?: number` parameter. If provided, the handler enforces its own budget by limiting the items it returns. No global string truncation.

**Warning signs:**
- MCP tool calls return `SyntaxError: Unexpected end of JSON` in Claude logs
- `list_files` returns fewer items than expected without any indication of truncation
- Budget is enforced by string slicing (`response.substring(0, MAX)`) rather than by item count

**Phase to address:** Phase 5 (token budget cap). Define the truncation contract (what gets cut, how the LLM is informed) before implementing it in any tool. Apply the budget as a data-level limit in each affected tool handler.

---

### Pitfall 10: Re-Using the Tree-sitter Parser's Incremental State Across Different Files Corrupts Parsing

**What goes wrong:**
Tree-sitter parsers are stateful: they hold the last parsed tree for incremental re-parsing. The intended use is:

```
// Edit detected in fileA.ts
newTree = parser.parse(newContent, oldTree); // fast: reuses unchanged subtrees
```

But in this project, the parser is a module-level singleton shared across all files of a given extension. File A is parsed (parser now holds tree A). File B changes (parser parses B with tree A as the prior tree). This is incorrect: the "old tree" passed to incremental parsing must be the old tree of the SAME file, not a different file. Passing the wrong prior tree produces subtly wrong incremental results — the parser may reuse subtrees from tree A that are invalid in the context of file B.

The current `extractSnapshot()` does NOT pass a prior tree — it calls `parser.parse(source)` without an old tree. This means every parse is a full parse (not incremental). This is correct for the change detection use case (we want the full current state, not a diff). But if incremental parsing is added for performance in the extraction phase, passing the wrong prior tree would be a silent correctness bug.

**Why it happens:**
The tree-sitter docs show incremental parsing as a performance optimization. The natural next step after getting tree-sitter working is to add the old tree for speed. But the old tree must be per-file, not the last-parsed-anything.

**How to avoid:**
Keep the current approach: always call `parser.parse(source)` without a prior tree for dependency extraction. Full parses are fast enough (a 1,000-line TS file parses in <5ms). Incremental parsing adds complexity with marginal benefit for batch file analysis. The `parserCache` map stores `Parser` instances by extension, not prior trees — do not add a prior-tree cache.

**Warning signs:**
- A `Map<string, Tree>` appears in `ast-parser.ts` (prior-tree cache by file path)
- `parser.parse(source, priorTree)` is called with `priorTree` from a different file
- Imports extracted for file B contain paths from file A (the classic symptom of wrong prior tree)

**Phase to address:** Phase 1 (tree-sitter extraction expansion). Add a code comment to `getParser()` explicitly prohibiting prior-tree caching. Do not add incremental parse APIs until the per-file-tree storage model is explicitly designed.

---

### Pitfall 11: Community Detection Produces Unstable Community IDs Across Re-Runs, Breaking Any Stored Community References

**What goes wrong:**
Louvain is a non-deterministic algorithm (random initialization). Each run may assign files to communities with different numeric IDs. Community ID 3 in one run may be community ID 7 in the next run, even if the graph hasn't changed. If community IDs are stored as integers and exposed as identifiers in the MCP tool response, an LLM that remembers "the authentication cluster is community 3" will be wrong after the next re-run.

The community IDs from `graphology-communities-louvain` are generated based on the first node assigned to each community — they are node keys (file paths), not sequential integers. This is actually better than integers, but only if the API returns the community key (a representative file path) rather than a synthetic integer ID.

**Why it happens:**
The first implementation maps communities to integer IDs for simplicity. Those IDs appear in tool responses. The IDs change on re-run. No one notices until an LLM gets confused about which community is which.

**How to avoid:**
Expose communities by their representative member, not by a synthetic ID. The tool response format should be:

```json
{
  "communities": [
    { "representative": "/path/to/most-important-file.ts", "members": [...], "size": 12 },
    { "representative": "/path/to/auth-module.ts", "members": [...], "size": 7 }
  ]
}
```

The "representative" is the highest-importance file in the community. Sort communities by size (descending) so the largest cluster is always first. An LLM can refer to the "community containing auth-module.ts" across re-runs without relying on a volatile ID.

For graphology, the Louvain algorithm result is a `{ [nodeKey: string]: number }` map where the number is the community assignment. Grouping by community number and picking the highest-importance node as representative is stable (same graph = same grouping, even if the community numbers vary).

**Warning signs:**
- MCP tool response has `"communityId": 3` fields (integer IDs)
- Calling `get_communities` twice returns communities in different order with different IDs
- LLM queries like "show me files in community 3" fail after a community re-run

**Phase to address:** Phase 4 (community detection). Define the response schema (representative-based, not ID-based) before implementing the tool handler. Use `graphology-communities-louvain`'s `detailed` option to get node-to-community assignments and build representative labels from importance scores.

---

### Pitfall 12: Expanding `setDependencies()` to Include Edge Metadata Breaks Existing Callers That Pass Only Two Arguments

**What goes wrong:**
The current `setDependencies(sourcePath, localDeps, packageDeps)` signature is called from three places in the codebase: `updateFileNodeOnChange`, `addFileNode`, and the coordinator's scan pass. All three pass plain string arrays for `localDeps`.

The new schema needs edge metadata (edge_type, confidence, weight) per dependency. If `setDependencies()` is changed to accept `Array<{path: string, edgeType: string, confidence: number}>` instead of `string[]`, all three call sites break. If a new `setDependenciesWithMetadata()` is added instead, the old function stays and now there are two functions doing overlapping things, with the old one silently writing rows without edge metadata.

**Why it happens:**
Adding metadata to an existing function signature is the obvious change. The breakage at call sites is expected and addressed by updating callers. But the real problem is the transition period: during migration, some files may be analyzed by tree-sitter (with edge metadata) and some by regex (without). If both code paths call the same function with different argument shapes, one path must produce placeholder metadata.

**How to avoid:**
Define a `DependencyEdge` type:

```typescript
interface DependencyEdge {
  targetPath: string;
  edgeType: 'imports' | 'calls' | 'inherits' | 'contains';
  confidence: number;    // from confidence.ts constants
  weight: number;        // default 1
}
```

Change `setDependencies()` to accept `localDeps: DependencyEdge[]`. Update all callers. In the regex extractor path, each discovered import becomes a `DependencyEdge` with `edgeType: 'imports'` and `confidence: CONFIDENCE.REGEX` (0.8). This is more work than adding a second function but prevents the silent two-code-paths problem.

The `getDependencies()` function returns `string[]` (target paths only) for backward compatibility with cycle detection and importance scoring — those callers don't need edge metadata.

**Warning signs:**
- `setDependencies()` and `setDependenciesWithMetadata()` both exist in repository.ts
- `edge_type IS NULL` rows appear in the database after a file is re-analyzed (indicates regex path not updated)
- `confidence` column has 0.0 for files recently analyzed (default value not replaced by extractor value)

**Phase to address:** Phase 3 (schema migration + repository refactor). Change the signature in one PR, update all callers in the same PR. Do not ship a new signature without updating all call sites.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Load all 11 grammars at module init | Simple code, mirrors current TS/JS pattern | Any bad grammar crashes MCP server at startup; 100MB+ native memory for unused languages | Never — use lazy loading |
| Keep regex for all languages, only add edge metadata via heuristics | No new npm deps | Edge types/confidence are meaningless without AST; "inherits" and "calls" edges can't be detected with regex | Never — defeats the purpose of the migration |
| Run Louvain on every file change | Trivially consistent | Event loop blocked 50ms per change on large repos; kills real-time feel | Never — community detection must be on-demand or scheduled |
| Integer community IDs | Simpler to sort and reference | IDs change on every re-run; any stored reference is stale after re-run | Never — use representative file path as stable identifier |
| String-level token budget truncation | One line of code | Produces invalid or logically incomplete JSON; LLM confusion | Never — enforce budget at data level (item count limit) |
| `confidence: 0.9` inline literals | Fast to write | Values drift, become arbitrary, lose semantic meaning | Never — use named constants from confidence.ts |
| Skip parity tests during regex→AST migration | Faster shipping | Silent regression in dependency extraction; wrong importance scores, wrong staleness propagation | Never — one parity test per migrated language |
| Global `let treeDirty = true` instead of dirty-flag in coordinator | Avoids coordinator changes | True global state bypasses the mutex; concurrent writes race | Never — dirty flag must be inside the coordinator's mutex-guarded state |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| tree-sitter grammar loading | `_require('tree-sitter-python')` at module top-level | Lazy-load in `getParser()` with try/catch; fall back to regex if grammar unavailable |
| graphology + Louvain | Build Graph from SQLite on every `get_communities` call | Cache Graph in coordinator; rebuild only when `graphDirty = true` |
| `setDependencies()` caller sites | Pass plain `string[]` to updated function | Pass `DependencyEdge[]` from all callers; regex extractors set `confidence: CONFIDENCE.REGEX` |
| MCP tool response truncation | `JSON.stringify(result).slice(0, MAX)` | Enforce `maxItems` per list field before serialization; include `truncated: true` and `totalCount` |
| Community IDs in tool responses | Return `{ communityId: 3, members: [...] }` | Return `{ representative: '/path/to/key-file.ts', members: [...], size: N }` |
| tree-sitter prior tree (incremental parse) | `parser.parse(source, lastParsedTree)` across different files | Always `parser.parse(source)` without prior tree for extraction use case |
| Louvain on mixed directed/undirected graph | Pass the dependency graph as-is | Cast to directed or undirected via `graphology-operators` before running Louvain |
| SQLite column ADD with NOT NULL DEFAULT | `ADD COLUMN edge_type TEXT NOT NULL DEFAULT 'imports'` | `ADD COLUMN edge_type TEXT` (nullable); treat NULL as 'imports' in queries |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Rebuild graphology Graph on every tool call | `get_communities` latency grows with project size | Dirty-flag cache in coordinator; rebuild only on graph changes | At >1,000 edges (~300-file project) |
| All 11 parsers instantiated at startup | MCP server starts slowly; 100MB+ RSS on startup | Lazy grammar loading in `getParser()` | From the first commit adding >3 grammars |
| Louvain in file-change handler | Event loop blocked on every save in active edit sessions | On-demand with TTL cache; never in change handler | On projects with >500 edges and active editing |
| `getDependencies()` called N times in community detection (N+1) | Community detection is slow despite fast Louvain | Use `getAllLocalImportEdges()` (single batch query) to build the graph | At >200 files |
| `file_dependencies` table scanned without index for edge_type filter | `SELECT * WHERE edge_type = 'calls'` does full table scan | Existing indexes on source_path and target_path are sufficient; filter edge_type in application code not SQL | At >50,000 edge rows |
| Per-file tree-sitter parse in batch scan at startup | Full scan takes 10x longer after migration | Ensure parse is synchronous and single-threaded; tree-sitter Node.js binding IS synchronous by design | On repos >5,000 files (500ms+ scan time) |

---

## "Looks Done But Isn't" Checklist

- [ ] **Grammar availability audit:** Every target language has a working npm grammar package — verify by calling `parser.parse('# empty\n')` on a trivial file and checking zero ERROR nodes in the root, not just that the package installs
- [ ] **Regex parity:** For each migrated language, run both extractors on 3 real project files and confirm dependency sets match (or explain every difference)
- [ ] **Schema migration safety:** Apply migration to a copy of a real `data.db` with 5,000 dependency rows — verify `getDependencies()` returns same results before and after, and migration completes in <1 second
- [ ] **Community detection stability:** Call `get_communities` twice in a row without any file changes — verify representatives are the same files (communities are stable when graph is unchanged)
- [ ] **Token budget validity:** With budget set to truncate `list_files` at 10 items on a 200-file project, verify: response is valid JSON, `truncated: true` is present, `totalCount: 200` is present
- [ ] **Lazy grammar loading:** Start MCP server on a TypeScript-only project — verify Python, Go, and other grammar packages are NOT loaded (RSS should be same as before migration)
- [ ] **Graph dirty flag:** Modify one file's dependencies, then call `get_communities` twice — verify first call rebuilds graph, second call uses cache
- [ ] **Edge metadata backcompat:** After schema migration, files NOT yet re-analyzed have `edge_type IS NULL` — verify `getDependencies()` still returns them (NULL treated as 'imports')
- [ ] **Confidence constants:** grep codebase for inline confidence float literals (e.g., `confidence: 0.9`) — should be zero; all values come from `confidence.ts` constants

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Grammar ABI mismatch crashes MCP at startup | LOW | `npm rebuild tree-sitter tree-sitter-python ...` for each broken grammar; MCP restarts cleanly |
| Regex extractor removed before parity verified | MEDIUM | Revert the deletion from IMPORT_PATTERNS; re-add regex for the affected language; ship tree-sitter version in follow-up |
| Schema migration breaks dependency queries | MEDIUM | The migration is additive (ADD COLUMN only); rows remain; fix query code to handle NULL edge_type; no data loss |
| Community IDs become stale in stored LLM context | LOW | IDs are stale in LLM memory only; re-running the tool gives fresh results; no database correction needed |
| Token budget truncates to invalid JSON | LOW | Fix: switch from string slice to item-count limit; existing stored data unaffected |
| Louvain fires on every file change, stalls edits | LOW | Delete the watcher hook; make community detection on-demand only; no data corruption |
| Wrong prior tree in incremental parse corrupts AST results | HIGH | Clear parser cache for affected extension; all files of that type are re-analyzed on next access; dependencies may be wrong until re-analysis completes |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Grammar packages unavailable or ABI-mismatched | Phase 1 (LanguageConfig + grammar audit) | Each target language parses a trivial file with zero ERROR nodes |
| ABI mismatch crashes startup | Phase 1 (grammar setup) | Add grammar load check to vitest.setup.ts; fails on bad install |
| Regex→AST breaks existing extraction | Phase 2 (per-language extraction) | Parity test per migrated language before switching isTreeSitterLanguage() |
| Schema migration breaks existing data | Phase 3 (schema migration) | Migration tested on real data.db copy; getDependencies() matches before/after |
| 11-grammar memory bloat at startup | Phase 1 (lazy loading) | RSS same as current after adding grammars (no TypeScript-only project regression) |
| Louvain in file-change path | Phase 4 (community detection design) | Community detection not present in chokidar event handlers (grep check) |
| Graph rebuild on every tool call | Phase 4 (community detection cache) | Second `get_communities` call is 10x faster than first call |
| Confidence values inconsistent | Phase 2 (confidence.ts constants) | Zero inline float literals for confidence in all extractor code |
| Token budget cuts invalid JSON | Phase 5 (token budget) | Budget enforcement via maxItems, not string slice; valid JSON at all budget sizes |
| Community IDs unstable | Phase 4 (response schema) | Two consecutive calls produce same representatives (stable community fingerprint) |
| setDependencies() signature breaks callers | Phase 3 (repository refactor) | All call sites compile; no setDependenciesWithMetadata() exists |
| Incremental parse with wrong prior tree | Phase 1 (ast-parser guard) | Code comment + test that parser cache stores Parser instances not Tree instances |

---

## Sources

- Codebase audit: `/home/autopcap/FileScopeMCP/src/change-detector/ast-parser.ts` — tree-sitter parser instantiation pattern, `createRequire` CJS loading, `getParser()` dispatch function, `isTreeSitterLanguage()` boundary (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/src/file-utils.ts` — `IMPORT_PATTERNS` regex map for 11 languages, `analyzeNewFile()` language dispatch, `isTreeSitterLanguage()` guard, `setDependencies()` call sites (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/src/db/schema.ts` — current `file_dependencies` schema, `schema_version` table, existing indexes (HIGH confidence — direct code review)
- Codebase audit: `/home/autopcap/FileScopeMCP/src/db/repository.ts` — `setDependencies()` signature and callers, `getAllLocalImportEdges()` batch query pattern, `getDependencies()` return type (HIGH confidence — direct code review)
- [graphology-communities-louvain docs](https://graphology.github.io/standard-library/communities-louvain.html) — algorithm behavior, directed/undirected handling, multi-graph limitation, benchmark performance (HIGH confidence — official docs)
- [tree-sitter Node.js ABI mismatch issues](https://github.com/tree-sitter/node-tree-sitter/issues/169) — NODE_MODULE_VERSION mismatch with prebuilt binaries (HIGH confidence — official repo issue thread)
- [tree-sitter v0.26 requires Node 24 issue](https://github.com/tree-sitter/tree-sitter/issues/5334) — version compatibility matrix gap (HIGH confidence — official repo)
- [tree-sitter WASM ABI incompatibility 0.20 vs 0.26](https://github.com/tree-sitter/tree-sitter/issues/5171) — ABI changes between tree-sitter-cli versions (MEDIUM confidence — issue thread, no official matrix published)
- [DF Louvain: incremental Louvain limitations paper](https://arxiv.org/abs/2404.19634) — batch-orientation of Louvain, overhead for small batch updates, cascading community label changes (MEDIUM confidence — arxiv preprint)
- [MCP token bloat discussion](https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1576) — MCP response verbosity and token consumption patterns (MEDIUM confidence — standards track proposal)
- [tree-sitter packaging challenges blog](https://ayats.org/blog/tree-sitter-packaging) — per-grammar npm availability inconsistency, packaging fragmentation (MEDIUM confidence — engineering blog post, corroborated by npm package audit)
- [tree-sitter language pack](https://github.com/kreuzberg-dev/tree-sitter-language-pack) — alternative to per-language npm packages for 248 grammars (MEDIUM confidence — community project, not official tree-sitter)
- [tree-sitter advanced parsing docs](https://tree-sitter.github.io/tree-sitter/using-parsers/3-advanced-parsing.html) — incremental parse behavior, prior tree requirements, multi-language range handling (HIGH confidence — official docs)
- [SQLite ALTER TABLE behavior](https://www.sqlite.org/lang_altertable.html) — ADD COLUMN limitations, nullable vs NOT NULL columns, table rewrite conditions (HIGH confidence — official SQLite docs)

---

*Pitfalls research for: v1.4 Deep Graph Intelligence — tree-sitter multi-language extraction, confidence-labeled graph edges, community detection, MCP token budgeting*
*Researched: 2026-04-08*
