# FileScopeMCP — Detailed Deep Dive

**Status:** brainstorming working doc, not a spec. Captures the full state of analysis as of 2026-04-30.
**Authoring context:** synthesized from a capability audit, a self-dogfooding session against this very codebase, and freshness-pipeline investigation. Kept honest — flags where the marketing pitch diverges from observed reality.

> **Update 2026-05-09:** the §3.2 / §5 search weakness has been addressed. Commit `f52a4d6` (`fix(search): tokenize multi-word queries so they actually return results`) reworked `searchFiles()` to tokenize the query, run a per-token `LIKE` against the rank-weighted SQL, and aggregate matches per path with `total_rank DESC, hit_count DESC, importance DESC` ranking (`src/db/repository.ts:926`). Multi-word concept queries like "python call site extraction" should now hit. Other items in §1.3 (`extractSignature` not surfaced, `breakingChanges` not exposed, `inheritsFrom` dropped, `buildAstExtractor` dead code) and the §4 Python call-graph plan remain accurate as not-yet-shipped.

---

## 0. The question we're trying to answer

> What should we build next to make FileScopeMCP genuinely useful for LLM coding agents — beyond what they can already do with grep + Read?

### First principles (every other section traces back to these)

These four are non-negotiable. Any feature that violates one is wrong, no matter how clever it is.

**1. The product is for LLM coding agents.** Not for humans browsing dashboards, not for build tools consuming an API. The Nexus dashboard is a side benefit; the agent is the customer. Every feature decision asks: *"what does this let the agent do that it couldn't before?"* If the answer is "save a few hundred tokens on a Read it'll do anyway," that's convenience, not capability — defer it.

**2. Beat grep, or don't ship.** Modern coding agents have huge context windows and can Read freely. The data that genuinely beats grep is the data you *can't* derive from one file: cross-file edges, call graphs, importance ranking, semantic clustering — anything that requires understanding the whole codebase at once. Single-file data (signatures, types, body) is greppable; agents will Read it. Prioritize the cross-file/whole-codebase data.

**3. Stale data is worse than no data.** This is the entire value proposition over plain grep — the data is *both* structured *and* fresh. If we tell an agent "X calls Y" and that's no longer true, the agent acts on a lie. As files change, every relationship within and between them changes — the DB must reflect reality, always. **Any new writer must wire into the change-detection + cascade pipeline before it ships.** No exceptions, no "we'll fix it in a follow-up." This is the single most important constraint on this codebase. See §2 for the full freshness pipeline and the checklist every new writer must pass.

**4. Agent UX is measured in tool-calls and recall, not features shipped.** A tool that exists but returns 0 results for queries agents actually ask (see `search` in §3.2) is *worse* than no tool — it produces a false negative the agent trusts. Success is whether the agent answers its question correctly with fewer round-trips, not the size of the tool surface. Tool descriptions are part of the contract — they tell the agent when to call. Wrong descriptions are bugs.

### How these principles rank features

A feature is worth building when it's high on principles 1+2 *and* compliant with principle 3. Principle 4 is an ongoing maintenance job — every tool must be honest and discoverable, or the rest doesn't matter.

| If a feature... | Then... |
|---|---|
| ...gives agents data they can't derive from one file (P2) | High value, build it |
| ...just shortens single-file Reads (violates P1) | Defer — convenience, not capability |
| ...writes derived data without an invalidation path (violates P3) | **Block** — won't merge until freshness is wired |
| ...exists but returns wrong/empty for real agent queries (violates P4) | Fix urgency = high; honest empty is OK, false empty is a bug |

---

## 1. Capability audit — what's missing today

A full audit of `src/mcp-server.ts`, `src/db/schema.ts`, `src/db/repository.ts`, `src/language-config.ts`, `src/change-detector/ast-parser.ts`, and `src/change-detector/types.ts` produced this gap list.

### 1.1 Top 5 high-impact gaps (initial ranking, pre-dogfooding)

#### Gap 1 — No type signatures, params, or docstrings on symbols
The `symbols` table stores only `name`, `kind`, `start_line`, `end_line`, `is_export`. The TS/JS `extractSignature()` already builds a signature string but it lives in the `exports_snapshot` JSON blob and is never queried. No language extractor captures docstrings or leading JSDoc/`#`/`///` comments.

- **Why it matters:** "what does `processFile` take and return?" or "find functions whose signature mentions `Promise<Result>`" requires `find_symbol` then a `Read` per file.
- **Difficulty:** M — signature extraction half-built; promote it. Docstring extraction is a per-language node walk.
- **Where it slots in:** New columns on `symbols` (`signature TEXT`, `docstring TEXT`, `params_json TEXT`); fold into `find_symbol` response and `search` SQL ranking.
- **Status after dogfooding:** Demoted. See §3 — agents who can't find the file via search will Read it anyway and see the signature for free. Coupled to fixing search first.

#### Gap 2 — Call graph is TS/JS only
`extractTsJsFileParse` is the only writer to `symbol_dependencies`. `find_callers("foo")` on a Python project always returns `{items: [], total: 0}` — silently useless. Python/Go/Ruby AST parsers are loaded for symbols and walk the same trees; they just don't emit `CallSiteCandidate`s.

- **Why it matters:** "Who calls `db_session.commit`?" is the single most-asked navigation question. For multi-language repos (frontend+backend), it's the make-or-break tool.
- **Difficulty:** M per language.
- **Where it slots in:** Extend each `extract*Symbols` to emit `callSiteCandidates`; reuse the existing resolver.
- **Status after dogfooding:** Confirmed top priority. The call-graph IS the tool's killer feature; extending coverage to Python is a direct multiplier on agent value.

#### Gap 3 — No HTTP route / API surface extraction
Nothing identifies Express/Fastify/FastAPI/Flask/Gin/Rails route handlers, their HTTP method, path, or the symbol that handles them.

- **Why it matters:** "What handles `POST /users/:id`?" or "list all public HTTP routes" — currently impossible without grep + reading. #1 question in a backend-investigation workflow.
- **Difficulty:** M for the route table; L for cross-language frontend→backend linking.
- **Where it slots in:** New `routes` table; new tool `list_routes(filter?)`.

#### Gap 4 — `search` and `concepts` data are walled off from each other
`searchFiles` does `LIKE %query%` over five fields including `concepts.functions[]` etc., but it returns *files*, not *symbols*. The LLM-extracted `concepts.functions/classes/interfaces/exports/purpose` are never normalized into a queryable table.

- **Why it matters:** Agent asks "find anything related to 'rate limit'" — gets a file list with no idea which symbol/concept inside matched.
- **Difficulty:** S–M — either normalize `concepts.*` into a `concepts` table at LLM-write time, or extend `searchFiles` to return the matching field/value.
- **Status after dogfooding:** Promoted. See §3 — `search` is much more broken than I thought. The LIKE-based matching also fails on multi-word concept queries.

#### Gap 5 — No public-API delineation, no inheritance/implements graph
`is_export` is boolean per symbol — no notion of "package public API" (re-exported from `index.ts`) vs internal export. `inheritsFrom` pairs are extracted in `ast-parser.ts:309` and consumed only as edge `edgeType='inherits'` on file-level — the class→class relationship and `implements` clause are dropped entirely.

- **Why it matters:** "What's the contract this module promises?" / "list all subclasses of `BaseRepository`" / "does `FooImpl` implement `IFoo`?" — unanswerable.
- **Difficulty:** S for class→class extends/implements edges (data already in AST walk). M for full barrel-traversal public-API resolution.
- **Where it slots in:** New `symbol_relations` table (or extend `symbol_dependencies` with a non-fixed `edge_type`); new tool `list_public_api(packagePath)`.

### 1.2 Lower-impact gaps

- **`find_definition_at_line(file, line)`** — given a stack trace or click point, no inverse of `find_symbol`. Trivial: SQL on `symbols WHERE path=? AND start_line<=? AND end_line>=?`.
- **No env-var / config-key index** — agent can't ask "where is `DATABASE_URL` read?"
- **No test→source linkage** — `*.test.ts` files tracked, but nothing maps "tests for `processFile`" → that test file.
- **`list_changed_since` doesn't return changed *symbols*, only files.** Broker has the diff; `change_impact.breakingChanges[]` exists; no `list_changed_symbols_since(sha)`.
- **Stack-trace parser** — given `at Foo.bar (foo.ts:42:10)`, return the symbol. Easy with new `find_definition_at_line`.
- **Cross-language edges** — TS code calling Python via `child_process.spawn('python', …)` is invisible. L but high value for polyglot.
- **No DB-model / schema extraction** — Prisma/Drizzle/SQLAlchemy models are just files; agent can't ask "what tables exist?"
- **Regex-only languages have no symbols at all** — Lua, Zig, PHP, C#, Java only get import edges. C# and Java are major gaps.
- **`search` is `LIKE %q%`, no tokenization or fuzzy** — "rateLimiter" doesn't match "rate_limiter"; multi-word queries are AND'd literally and almost always miss.
- **`get_symbol_neighbors(symbolId)`** — return same-file siblings + same-community symbols.
- **No `who_imports_this_package('react')` tool** — ~10 lines on existing `file_dependencies`.
- **`find_symbol` has no `filePath` filter** — must paginate then filter client-side.

### 1.3 Surprises (data captured but never exposed)

- **`extractSignature()` is fully implemented in `ast-parser.ts:97`** but its output only persists in the `exports_snapshot` JSON blob used for change-detection diffs. Never surfaced through any tool. Single highest-leverage "data captured but not exposed" finding.
- **`concepts.purpose`** (LLM-extracted one-sentence file summary) is read by `search` for ranking but not included in the response field — the agent can't see *why* a result ranked.
- **`inheritsFrom` pairs (className + sourceSpecifier)** are extracted in every TS/JS pass at `ast-parser.ts:309`, but only the *file-level* edge survives in `file_dependencies` with `edge_type='inherits'`. Class→class inheritance thrown away.
- **`buildAstExtractor` is dead code** — `language-config.ts:1235` exists for "Phase 26 readiness" with a comment that the path is unreachable.
- **`change_impact.breakingChanges[]` is LLM-extracted on every change** but no tool exposes "files with breakingChanges in last N commits" — a one-query release-notes generator sitting unused.
- **`importMeta.importedNames[]` is in DB as `imported_names` JSON** but only `find_callers` reads it. Could power "show everywhere `useState` is imported" with one tool.
- **Symbol search is exact + prefix only** (`React*`) — no contains, no fuzzy, no camelCase↔snake_case.

---

## 2. The freshness invariant (full detail on Principle #3)

**Any new writer to the FileScopeMCP DB (edges, symbols, computed metadata) must integrate with the change-detection and cascade pipeline so data stays accurate as files change.** Stale derived data is a bug, not a tradeoff.

This is Principle #3 from §0, expanded. It is the single hardest constraint on this codebase, and the reason FileScopeMCP exists at all — without freshness, an agent might as well grep. The whole value proposition over plain grep is that data is *both* structured *and* fresh. Stale call edges or stale symbols give agents wrong answers — worse than not having the data, because the agent trusts it.

Concretely, when a `.py` file changes:
- Its symbols must be re-extracted and the old rows deleted
- Its outgoing call edges must be re-resolved and the old rows deleted
- Its file-level summary/concepts/change_impact must be marked stale and re-queued
- Files that depend on it must be marked stale (cascade) so their summaries refresh
- The agent's *next* call to `find_callers` / `get_file_summary` / `search` must reflect this new reality

If any one of these steps doesn't happen, agents get stale answers. Every writer must be audited against this list.

### 2.1 How TS/JS call-graph stays fresh today

File change → 2s debounce → re-extract → `setEdgesAndSymbols()` runs as one SQLite transaction:

1. Delete old `file_dependencies` for this file
2. Insert fresh `file_dependencies`
3. **Delete `symbol_dependencies` where caller is in this file** (must run before symbols delete — uses subquery on old symbol IDs)
4. Delete old `symbols`
5. Insert fresh `symbols`
6. Insert fresh `symbol_dependencies` (resolved to new symbol IDs)

Step 3 is gated on `callSiteEdges !== undefined`. Today Python returns no `callSiteEdges`, so this cleanup doesn't run. **The moment Python emits `callSiteEdges`, the cleanup activates for free** — *but only if the upstream dispatch reaches `setEdgesAndSymbols` in the first place.* See §2.2 for the upstream gap.

### 2.2 The upstream dispatch gap (discovered + fixed in this session)

The pipeline above only fires for TS/JS today. The dispatch in `analyzeNewFile` (file-utils.ts) routed non-TS/JS file-change events through `extractEdges` (edges only) → `setEdges` (writes `file_dependencies` only, never the `symbols` table). `extractLangFileParse` — the Python/Go/Ruby symbol entrypoint — was only reachable from the one-shot bulk migration (`bulk-multilang-symbol-extract.ts`) gated by per-language `kv_state` flags.

The empirical signature of the gap: bulk extract on first project init populated symbols correctly, but every subsequent file edit/add for `.py` / `.go` / `.rb` left the `symbols` table frozen at the first-boot snapshot. `find_symbol("newPyFunction")` would return 0 for any function added after the gate was set. Verified empirically against `/tmp/freshness-probe/sample.py`: appending `def gamma()` → `find_symbol("gamma")` returned 0 results 4s after the watcher fired.

**Fix (in this session):** routed non-TS/JS through `extractLangFileParse` in `analyzeNewFile` (file-utils.ts:920-933), setting `useAtomicWrite=true` so the existing `setEdgesAndSymbols` call site refreshes symbols. The §2.1 cleanup-for-free property now genuinely holds end-to-end. `callSiteEdges` is left `undefined` for non-TS/JS until per-language AST emission lands.

### 2.3 Known limit (true for TS/JS too)

When file A renames `foo()` → `bar()`, file B's edges to `foo` become orphans counted in `unresolvedCount`. They clean up only when B is independently re-scanned. The cascade engine touches file-level summary staleness, not symbol-edge staleness. This is a separate problem worth flagging but not a blocker for any of the gaps above.

### 2.4 Checklist for any new feature

Before merging any feature that writes new derived data:

1. What triggers re-extraction when a file changes (file-watcher → coordinator hook)?
2. What deletes stale rows for the changed file before the new write (idempotent re-extraction)?
3. What cascades staleness to dependents when this file's contract changes (cascade engine)?
4. What happens when the file is deleted or excluded (cleanup path)?

Don't land a writer without the matching invalidation path.

---

## 3. Dogfooding session — what actually beats grep+Read

Methodology: used FileScopeMCP's own MCP tools to research the Python call-graph implementation task as if I were a fresh agent. Compared the experience to grep+Read.

### 3.1 Genuinely useful — clean wins over grep

**`find_symbol`** — Four lookups in one round-trip, exact line ranges, zero false positives.
- Example: `find_symbol("extractTsJsFileParse")` → `language-config.ts:666-808`.
- With grep: 10+ hits across imports, tests, and the def — disambiguation work.

**`get_file_summary` `dependents` with `importedNames` + `importLines`** — the real killer feature.
- Told me 17 files import `language-config.ts`, *and which symbols each one imports, and on what line*.
- Surfaced `language-config.call-sites.test.ts` and `language-config.python-symbols.test.ts` — the exact test templates I need.
- Deriving from grep: 17+ separate file reads.

**`find_callers` / `find_callees`** — caught what I'd have missed.
- `find_callers("extractTsJsFileParse")` returned two migration scripts (`bulk-call-site-extract.ts`, `bulk-symbol-extract.ts`) — call paths I'd need to update when adding Python edges. I would not have grepped for those.
- Single call saved a real bug.

**`detect_cycles`** — surfaced an architectural concern.
- Returned `repository.ts ↔ file-utils.ts ↔ language-config.ts` cycle. All three files in scope for the next feature. Worth knowing before refactoring.

### 3.2 Fell flat — worse than grep

**`search` is broken for the queries an agent actually asks.**

| Query | Result |
|---|---|
| `python call site extraction` | **0 results** |
| `call graph edge resolution` | **0 results** |
| `cascade staleness` | **0 results** (the cascade module exists and the words are in the codebase) |
| `call site` | 2 results |
| `tree-sitter` | 5 good results |
| `symbol_dependencies` | 5 good results |

Pattern: **single tokens hit, multi-word concept queries fail.** Confirmed by reading the description — it does `LIKE %q%`. Multi-word queries only match if those exact words appear contiguously in some field, which they almost never do.

This is the **most-needed fix in the whole tool surface**. The semantic-search promise in the docs doesn't match reality. Agents asking concept questions will get nothing back and conclude FileScopeMCP "doesn't know about that" — even when the relevant file's summary obviously discusses the concept.

**`get_communities` is too coarse.**
- Asked for the language-config.ts community → got a 61-file blob containing basically all source files (broker, nexus, db, change-detector, tests, all one community).
- Louvain clustering on a small project produces useless granularity. Learned nothing.

**`find_important_files` undervalues task-relevant files.**
- `language-config.ts` ranked importance 5 (with 17 dependents).
- `coordinator.ts` and `language-config.ts` — arguably the two most important files for this feature — are nowhere in the top 10.
- Importance formula probably overweights breadth or fan-in over centrality.

### 3.3 Recalibration

After dogfooding, the picture changes:

| Feature | Pre-dogfood priority | Post-dogfood priority | Why moved |
|---|---|---|---|
| Python call graph (#2) | High | **Confirmed top** | Call graph IS the killer feature; Python is silently broken |
| Search overhaul (~#4 + lower-impact "search tokenization") | Medium | **Promoted to high** | Failed on every multi-word concept query |
| Signatures+docstrings (#1) | High | **Demoted** | Convenience, not capability — agents Read the file anyway |
| HTTP routes (#3) | High | Hold | Real value, but cross-cutting, save for after foundation work |
| Inheritance/public API (#5) | High | Hold | Real value, smaller blast radius, post-search-fix |

**Working hypothesis:** the next two features should be Python call graph, then search overhaul. Reassess after both.

---

## 4. Python call-graph — full plan

### 4.1 Scope

**In:**
1. Walk Python tree-sitter `call` nodes inside top-level functions and class methods.
2. Build `CallSiteCandidate[]` with `{callerName, callerStartLine, calleeName, calleeSpecifier, callLine}`.
3. Resolution pass mirroring TS/JS: local-symbol index first (conf 1.0), imported-symbol index second (conf 0.7 — Python is more dynamic), unresolved discarded.
4. Plumb `callSiteEdges` through `extractLangFileParse` for `.py`. `setEdgesAndSymbols` cleanup activates automatically.
5. Tests mirroring `language-config.call-sites.test.ts`.
6. Manual freshness verification on a real test repo — edit, rename, delete a Python file and confirm the DB matches reality each time.

**Out (deliberately):**
- Cross-file orphan cleanup when a callee renames (existing TS/JS limit; separate work).
- Go/Ruby (same shape, prove Python first).
- `from pkg import *` resolution (silent discard, like TS/JS does for unresolvable).

### 4.2 Plug-in points

From the freshness audit (line numbers verified against the live DB on 2026-04-30):

1. **`extractLangFileParse()` at `language-config.ts:1114-1140`** — returns `{edges, symbols}` for non-TS/JS today. Add `callSiteEdges?: CallSiteEdge[]` for Python. *Now reachable from the file-change pipeline as of the §2.2 fix — symbols and (future) call edges will refresh on every edit.*
2. **Python AST parsing currently lives in `language-config.ts` itself** (not in `change-detector/ast-parser.ts`, which is TS/JS-only). New helper `extractPythonCallSites(tree, source) → CallSiteCandidate[]`. Existing `extractPythonSymbols` at `language-config.ts:261-319` is the natural co-host — share the single `parser.parse()` call (D-31 single-pass invariant) by exporting a combined walker.
3. **Resolution mirror `extractTsJsFileParse` at `language-config.ts:666-808` logic** — but Python-aware. Lines 780 and 791-803 are the exact local (1.0) / imported (0.8) resolution arms. Distinguish `from x import y` (y is in localImported by name) vs `import x` (uses `x.y` in calls — see §4.3 #3 for confidence treatment).

### 4.3 Open scoping decisions (need user input before coding)

1. **Class method granularity:** treat `class Foo: def bar(self):` as one symbol (`Foo`) with `bar` calls attributed to `Foo`, or extract `bar` as its own symbol with `path + parentClass + name`? TS/JS extracts methods as separate symbols. Recommend: match TS/JS.
2. **Decorator handling:** `@app.route('/x')` is syntactically a call expression — should it count as a call edge? Recommend: skip all decorator expressions (including stdlib ones like `@dataclass`, `@cached_property`, `@staticmethod`). The rationale is *not* "they're framework noise" — `@dataclass` isn't framework noise — it's that decorator expressions don't match the agent's mental model of "X calls Y" (they're closer to type/behavior annotations than to call sites). State that explicitly in the implementation comment so future readers understand why stdlib decorators are also excluded.
3. **Confidence target:** Don't apply a single Python-wide value. Mirror the TS/JS split: **1.0 for local-call resolution** (within the same module's symbol index — Python's local resolution isn't any guessier than TS's), **0.7 for imported-call resolution** (vs TS's 0.8) because `obj.method()` against an imported binding is genuinely more dynamic without static types. Imported attribute calls (e.g. `module.func()` where `module` is `import x`) may warrant a separate, lower confidence — or skip them in v1 and only resolve `from x import y` style direct-name calls.

### 4.4 Risk register

- **Pitfall 7 (symbol ID reset):** symbols.id auto-incremented on every file re-scan. Phase 37 solves via FLAG-02 atomic transaction; Python will inherit that for free since it goes through `setEdgesAndSymbols`.
- **Module-semantics mismatch:** Python `from . import utils` resolves relative to package root, not file dir. `from ..sibling import func` needs nested-package handling. Existing Python edge resolver at `language-config.ts:138-175` does basic resolve — may miss nested cases. Audit during implementation.
- **`from pkg import *`:** defeats name resolution. Will silently discard candidates per existing TS/JS pattern. Expect higher `unresolvedCount` for Python files using star imports.
- **Cycle in scope:** the `repository.ts ↔ file-utils.ts ↔ language-config.ts` cycle is already there. Don't deepen it.

### 4.5 Verification (the freshness check)

After implementation, must observe:

1. Edit a Python file → new `symbol_dependencies` rows for that file written; old rows for that file deleted (no orphans for the *caller* file).
2. Rename a callee in file A → A's outgoing edges update. B's edges to old name become unresolved; `unresolvedCount` increments. (This is the known limit.)
3. Delete a Python file → its rows removed. Edges from other files become unresolved.
4. Bulk re-scan → all files reprocessed, no double-counting.

---

## 5. The `search` weakness — what's broken, what to fix

### 5.1 What's broken

`searchFiles()` in `repository.ts` does naive `LIKE %query%` over: symbol names, `concepts.purpose`, summaries, and paths. Ranks: symbol(100), purpose(50), summary(20), path(10).

Failure modes observed:
- Multi-word queries match only if the words are *contiguous* in some field. They almost never are.
- No tokenization — "rateLimiter" can't find "rate_limiter" or "rate-limiter".
- No stemming — "summarization" won't match "summarize".
- Returns paths only, no snippet of *what* matched, so the agent can't tell why a result is there.

### 5.2 What to fix

In rough order of leverage:

1. **Tokenize the query and AND the tokens** — instead of `LIKE %"call graph edge resolution"%`, do `LIKE %call% AND LIKE %graph% AND LIKE %edge% AND LIKE %resolution%`, then rank by how many tokens hit. Single-token queries unchanged.
2. **Add a snippet to the response** — return `{path, matchedField, matchedSnippet}` so the agent sees why it matched.
3. **Normalize identifier styles** — strip non-alphanumerics from both the query and the haystack so camelCase/snake_case/kebab-case unify.
4. **Optional but high-value:** SQLite FTS5 over symbol+purpose+summary corpus. Real ranking, fast. Adds a virtual table; rebuild on changes.

### 5.3 Why this is coupled to signatures (Gap 1)

If `search` works, signatures matter — they make ranking richer ("find functions returning `Promise<Result>`"). If `search` is broken, signatures don't help — the agent can't find the file in the first place. So fix search before signatures.

---

## 6. Other observed weaknesses worth tracking

### 6.1 Importance scoring

`language-config.ts` has 14 dependencies + 17 dependents and ranks 5. `coordinator.ts` is the central orchestrator and isn't in the top 10. `repository.ts` (36 dependents) ranks 7.

The formula appears to weight raw fan-in heavily. But fan-in alone misses *centrality* — coordinator.ts is imported by few files but transitively depends on most of the system and orchestrates nearly every operation.

Worth a separate audit of the importance formula. Note that **PageRank is the wrong fix** here: PageRank rewards *being depended on*, which would rank coordinator.ts even lower. The right signal for "central orchestrator that imports everything but is imported by little" is either **betweenness centrality** (how often a node sits on shortest paths between other nodes) or **reverse-PageRank** on the inverted edge direction (rewards nodes that *depend on* widely-cited targets). Both are tractable with `graphology` (already a dep). A practical formula could blend forward fan-in (ownership signal) with reverse-PageRank (orchestration signal), capped per file so neither dominates.

### 6.2 Communities

Louvain produced one 61-file blob covering all source. For a small-to-medium project, the algorithm doesn't have enough signal to find meaningful clusters. Options:
- Tune Louvain resolution parameter to produce more, smaller groups.
- Use directory structure as a prior.
- Switch to a different clustering algorithm for small graphs.
- Just skip communities for projects under N files.

### 6.3 Architectural cycles

`detect_cycles` found:
- `repository.ts ↔ file-utils.ts ↔ language-config.ts`
- `config-utils.ts ↔ global-state.ts ↔ types.ts`

Both are real. The first directly affects the Python feature scope — be careful not to deepen it. Worth a refactor pass eventually.

### 6.4 Half-implemented infrastructure

- `buildAstExtractor` at `language-config.ts:1235` — dead code marked "Phase 26 readiness," path unreachable.
- `change_impact.breakingChanges[]` — extracted on every change, exposed nowhere.
- `importMeta.importedNames[]` — in DB, only one tool reads it.

These are individually small but cumulatively suggest a pattern: data extraction outpaces tool exposure. Worth a periodic "what data do we have that no tool surfaces?" sweep.

---

## 7. Decisions made so far

| Decision | Rationale |
|---|---|
| Next feature: Python call graph | Killer feature is the call graph itself; Python silently broken; high agent-value |
| Freshness must be wired alongside any new writer | Stale derived data > no derived data, because agents trust it |
| Defer signatures/docstrings | Convenience, not capability; coupled to search fix |
| Defer HTTP routes, inheritance edges | Real value but cross-cutting; do foundation first |
| TS/JS cross-file orphan cleanup limit is acceptable for now | Existing limit; not a Python-specific blocker |
| Class methods extracted as separate symbols (matching TS/JS) | Tentative — pending user confirmation |
| Skip decorators in Python call extraction | Framework-shaped noise; better as future HTTP-routes feature |
| Python edge confidence: 0.7 (vs 0.8 TS/JS) | Tentative — pending user confirmation |

---

## 8. Open questions for further brainstorming

### 8.1 Strategic

1. **Should we fix `search` *before* Python edges?** Search is broken for multi-word queries; that's an across-the-board agent UX problem. Python is asymmetric coverage. Fixing search first improves the experience for every existing user; Python helps a subset.
2. **Is "make it useful for LLM agents" the right framing, or should the dashboard/Nexus be the primary product?** Nexus is a non-agent UI. If most users hit the dashboard, the priorities shift toward visualization quality.
3. **What's the test for "good enough"?** No metric currently distinguishes "agent finishes the task with FileScopeMCP" from "without". Could we instrument a benchmark?

### 8.2 Technical

1. **Class methods as symbols** — `Foo.bar` vs `Foo` only. Requires changing `extractPythonSymbols` too, not just adding call extraction.
2. **Search FTS5 vs in-process tokenize+rank** — FTS5 is faster and ranks better but adds a virtual table and migration. Tokenize+rank is simpler but less powerful. Worth prototyping both.
3. **Importance formula** — should it incorporate centrality (PageRank-style)? Or is fan-in good enough?
4. **Communities resolution** — tune Louvain or switch algorithm? Or skip for small projects?
5. **Concepts normalized table** — flatten `concepts.functions[]` etc. into rows so search can return matched concept items. Or extend search return shape with matched-field info.

### 8.3 Coverage

1. **Go and Ruby call graphs** — same approach as Python, after Python proves the pattern. C++/Rust separately because tree-sitter grammars handle calls differently per language.
2. **C# and Java** — currently regex-only, no symbols at all. Java + Kotlin together would unlock most Android/JVM agents. C# is a major Windows ecosystem gap.
3. **Cross-language edges** — `child_process.spawn('python', ['script.py'])` invisible. L work but high value for polyglot.

### 8.4 New tools to consider

- `find_definition_at_line(file, line)` — inverse of `find_symbol`; enables stack-trace resolution.
- `list_changed_symbols_since(sha)` — symbols changed across a git range.
- `who_imports_this_package('react')` — one query on `file_dependencies`.
- `list_routes(method?, path_glob?)` — once HTTP route extraction lands.
- `list_public_api(packagePath)` — barrel-traversal resolved exports.
- `get_symbol_neighbors(symbolId)` — same-file siblings + same-community symbols.

---

## 9. What "epic" looks like 6 months from now

If we execute on the above, an LLM agent on a fresh codebase would have:

1. **Always-fresh, multi-language call graph** — "who calls X?" works for TS/JS, Python, Go, Ruby (and probably C# + Java). *Always-fresh* meaning: agent edits a file, two seconds later the next `find_callers` reflects the edit. No reload, no manual scan. **The 2-second SLA is a gate, not a vibe — it has to be measurable.** Ship a freshness harness alongside this work: a test that writes a file, polls `find_callers` until the new edge appears, and asserts wall-clock latency under threshold (suggested: p95 ≤ 2s on the self-scan corpus). Without that harness, "always-fresh" is unverifiable and Principle 3 has no teeth.
2. **Working semantic search** — multi-word queries hit; results include the snippet that matched.
3. **First-class API surface** — `list_routes` for HTTP, `list_public_api` for module contracts, `list_subclasses` / `list_implementations` for inheritance.
4. **Stack-trace-friendly navigation** — paste a stack trace, get back symbols.
5. **Change-aware insights** — "what symbols changed between these two SHAs?", "what files have breaking changes?", from data already extracted but not surfaced.
6. **Honest tool descriptions** — every tool's docstring matches what it actually does. (Already shipped this audit pass.)

**The principle-test for "epic":** every item above is high on Principle 1 (agent capability), beats grep on Principle 2 (cross-file/whole-codebase data), and stays correct under Principle 3 (freshness wired in from day one). If any feature ships without all three, we're back to building a worse version of grep with extra steps.

The non-agent benefits: Nexus dashboard inherits all of the above for free, since it queries the same DB.

---

## 10. Immediate next steps

1. **Resolve §4.3 scoping questions** with user (class methods, decorators, confidence).
2. **Implement Python call graph** per §4.1–§4.5.
3. **Verify freshness invariants** per §4.5.
4. **After Python lands:** reassess priority of search overhaul (§5) vs Go/Ruby coverage.
5. **Start tracking the half-implemented patterns** (§6.4) — possibly a "captured but unused" issue list.

---

*End of deep-dive. This doc is meant to be read, argued with, and revised. If a section feels wrong, mark it; we'll come back.*
