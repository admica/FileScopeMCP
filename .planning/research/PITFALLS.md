# Pitfalls Research

**Domain:** Multi-language symbol extraction + call-site dependency edges — adding Python/Go/Ruby symbols and TS/JS `symbol_dependencies` to an existing tree-sitter/SQLite code-intelligence system
**Researched:** 2026-04-24
**Confidence:** HIGH (all critical items verified against project source, schema, retrospective, and official grammar/npm sources)

---

## Critical Pitfalls

### Pitfall 1: Python async_function_definition Is a Separate AST Node Type

**What goes wrong:**
A query or visitor that handles only `function_definition` nodes to extract Python symbols silently drops every `async def` function in the codebase. The tree-sitter-python grammar emits `async_function_definition` as a distinct node type — not as a `function_definition` with an async modifier. The two node types are siblings in the grammar, not parent-child.

**Why it happens:**
The TS/JS extractor in `ast-parser.ts` handles `async` as a modifier on a regular `function_declaration`, so developers writing the Python extractor by analogy assume the same pattern applies. Python's grammar is structurally different here.

**How to avoid:**
In `visitNode` for Python, handle both `function_definition` and `async_function_definition` with identical symbol-extraction logic. A grep-source test should assert that the Python extractor produces a symbol for `async def` bodies, the same way the v1.6 length-probe test guards the single-pass invariant.

**Warning signs:**
- `npm run inspect-symbols path/to/async_file.py` returns zero symbols for a file full of `async def` functions.
- `find_symbol` returns no Python functions whose implementations use `async def`.
- Tests pass on synchronous Python fixtures but fail on any real async codebase.

**Phase to address:** Phase adding Python symbol extraction.

---

### Pitfall 2: Python Decorator Node Is a Parent of the Function — startLine Must Come From the Decorator

**What goes wrong:**
In the tree-sitter-python grammar, a decorated function is represented as a `decorated_definition` parent node that wraps both the `decorator` node(s) and the `function_definition` child. If `startLine` is taken from the `function_definition` node's start position, it points to the `def` keyword — not to the `@decorator` line. This makes the symbol's line range inconsistent with what editors and agents see (the decorator is the visual start of the declaration).

The v1.6 TS/JS extractor already solved this for TypeScript decorators: `sym.startLine` is set to the `export_statement` or decorator wrapper's start row, not the inner function node's start row (confirmed by the test `'decorator-wrapped class captures decorator startLine'` in `ast-parser.symbols.test.ts` line 47).

**Why it happens:**
Python and TypeScript handle decorators differently in their grammars. TypeScript decorators are children of the export/class node; Python decorators are siblings within a `decorated_definition` wrapper. Copying the TypeScript visitor pattern to Python without checking the tree shape produces the wrong line.

**How to avoid:**
When the current node is `decorated_definition`, extract `startLine` from the `decorated_definition` node itself (outermost parent), and extract the symbol name from the inner `function_definition` or `class_definition` child. Write a fixture test with a decorated function that asserts `startLine` is the `@decorator` line, not the `def` line.

**Warning signs:**
- `get_file_summary.exports[]` shows `startLine` pointing to the `def` keyword when the function has a decorator.
- Agents navigate to a line inside the function body instead of to the decorator.

**Phase to address:** Phase adding Python symbol extraction.

---

### Pitfall 3: Python Nested Classes and Inner Functions Must Be Excluded From Top-Level Symbols

**What goes wrong:**
A naive full-tree `visitNode` traversal that does not limit depth emits symbols for every `function_definition` node in the file, including methods inside classes and inner functions defined within other functions. This produces a polluted `symbols` table: a `class Foo` containing a method `bar` would generate both a `class` symbol for `Foo` and a spurious `function` symbol for `bar`. The `find_symbol` MCP tool would then return `bar` as a top-level function, which misleads agents.

The v1.6 TS/JS extractor avoids this by visiting only top-level statement nodes (children of the root program node), not recursing into function bodies or class bodies.

**Why it happens:**
Python's tree-sitter grammar nests method definitions inside class bodies, which are nested inside the top-level `module` node. A depth-unlimited recursive visitor hits them all.

**How to avoid:**
Only visit direct children of the root `module` node, and for `class_definition` children (and `decorated_definition` wrapping a class), record the class symbol but do NOT recurse into the class body. Mirror exactly the scope-limiting logic in the TS/JS extractor. Write tests with a file containing both a top-level function and a method inside a class, asserting that only the top-level function and the class appear, not the method.

**Warning signs:**
- `find_symbol(name='__init__')` returns results when queried on a repo that has no standalone `__init__` function (all `__init__` occurrences are class constructors).
- Symbol count per Python file is unexpectedly high (e.g., 30 symbols in a file with 3 top-level classes).

**Phase to address:** Phase adding Python symbol extraction.

---

### Pitfall 4: Go Regex Misses Method Declarations and Emits Wrong Symbol for Generic Receivers

**What goes wrong:**
The existing `resolveGoImports` regex in `file-utils.ts` handles import resolution correctly but extracts no symbols. Extending it for symbol extraction with a pattern like `^func\s+(\w+)\s*\(` matches standalone functions but silently drops method declarations (`func (r *Receiver) Method()`), which make up the majority of named declarations in idiomatic Go. Additionally, Go generics (since Go 1.18) use `func (r *Receiver[T]) Method()` syntax — the generic type parameter in the receiver breaks a naive receiver-skipping regex that expects `(word)` as the receiver pattern.

The v1.4 decision D-06 (confirmed in STATE.md): Go stays on regex because there is no stable tree-sitter-go npm grammar. The npm package `tree-sitter-go` is at `0.25.0` (zerover — no v1.0 stability guarantee), so the D-06 rationale remains valid as of 2026-04-24.

**Why it happens:**
Go function syntax has two forms: `func Name(...)` and `func (receiver) Name(...)`. A single-group pattern for the first form does not match the second. Generic receiver syntax (`[T]`) further complicates the pattern because the bracket metacharacter conflicts with character-class syntax in many regex flavors.

**How to avoid:**
Write two separate regex patterns: one for `func\s+([A-Za-z_]\w*)\s*[(\[]` (standalone function, first capture group is name) and one for `func\s+\([^)]+\)\s+([A-Za-z_]\w*)\s*[(\[]` (method, capture group 2 is name). For generics, the receiver pattern `\([^)]+\)` must be replaced with a balanced bracket alternative or a permissive `\(.*?\)` with non-greedy matching, because `func (r *T[K, V]) Method()` has a `[K, V]` inside the parentheses that a `[^)]+` pattern will mishandle if the receiver contains no closing paren before the bracket. Test against Go generics fixtures explicitly.

**Warning signs:**
- `find_symbol(name='Handler', kind='function')` on a Go file where `Handler` is defined as `func (h *Server) Handler()` returns no results.
- Symbol count for a Go file is 0 when the file contains only methods (common in interface-heavy Go code).
- A fixture with `func (s Service[K]) Get()` causes the regex to either match nothing or capture `K` as the function name.

**Phase to address:** Phase adding Go symbol extraction.

---

### Pitfall 5: Ruby Metaprogramming-Generated Methods Are Invisible to Static AST Extraction — Set the Expectation Early

**What goes wrong:**
Ruby's `attr_accessor :name, :age` generates getter and setter methods at runtime that do not appear as `def` nodes in the AST. `define_method("#{field}_label")` generates method names from string interpolation — completely opaque to static analysis. Any Ruby symbol extractor will miss these. If this limitation is not documented in the MCP tool description and `find_symbol` results, agents will wrongly conclude that a class has no `name` method when it actually does via `attr_reader`.

**Why it happens:**
Ruby metaprogramming is a design feature, not a gap in the grammar. Tree-sitter parses the source syntax faithfully; methods that do not have a `def` in the source will never appear in the AST. This is fundamentally different from Python or TypeScript, where all declarations are syntactically explicit.

**How to avoid:**
Scope Ruby symbol extraction to `def`-declared methods only, and document this scope clearly. The `find_symbol` tool description should note: "Ruby symbols reflect only `def`-declared methods; attr_* and define_method-generated methods are not indexed." This prevents agents from trusting a false "no symbol found" for Ruby files. Do NOT attempt to resolve `attr_accessor` arguments — the false-positive rate from Rails magic (e.g., `has_many`, `belongs_to`, `scope`) would make the results unreliable.

**Warning signs:**
- An agent reports "no `name` method found" in a Ruby model that has `attr_accessor :name`.
- Ruby symbol count per class is 0 in files that exclusively use `attr_*` macros.

**Phase to address:** Phase adding Ruby symbol extraction, and the MCP surface phase.

---

### Pitfall 6: Ruby Reopened Classes — Same Class Name Emitted Multiple Times From Different Files

**What goes wrong:**
Ruby allows a class to be reopened: `class Foo` can appear in `foo.rb`, `foo_extensions.rb`, and a dozen Rails concern files, each adding methods to the same class. A naive symbol extractor emits a `class` symbol named `Foo` from each file. The `find_symbol(name='Foo', kind='class')` tool then returns 12 results — one per file — which is correct but surprising. Worse, if an agent assumes the first result is the canonical definition, it may navigate to an extension file instead of the primary definition.

**Why it happens:**
Ruby's open class model is a language feature. There is no syntactic way to distinguish an original `class Foo` from a reopening of it.

**How to avoid:**
Accept the behavior as correct — all results are accurate (the class IS defined in all those files). Document in the tool description that Ruby `class` symbols may appear in multiple files due to class reopening. Add a `kind` ordering suggestion in `find_symbol` results: no suppression logic is needed, but agents should be advised to look at all results, not just the first. Do NOT attempt heuristics like "smallest file is the primary" — they are unreliable.

**Warning signs:**
- `find_symbol(name='ApplicationRecord', kind='class')` on a Rails repo returns 40+ results.
- Agent navigates to a concern file instead of the model file.

**Phase to address:** Phase adding Ruby symbol extraction, and the MCP surface phase.

---

### Pitfall 7: call-site Resolution Without a Symbol ID Breaks on File Re-scan

**What goes wrong:**
The v1.6 `symbols` table uses SQLite autoincrement `id` as the primary key (see `schema.ts` line 56: `integer('id').primaryKey({ autoIncrement: true })`). If a `symbol_dependencies` table references `symbols.id` as a foreign key for call-site edges, every file re-scan (which runs `DELETE FROM symbols WHERE path = ?` then re-inserts all symbols) allocates new autoincrement IDs. All `symbol_dependencies` rows that reference the old IDs now point to deleted rows — dangling references that silently produce empty `find_callers` results.

**Why it happens:**
The v1.6 `upsertSymbols` function uses the DELETE-then-INSERT pattern (confirmed in `repository.ts` line 933). This is correct for idempotency but invalidates any foreign key references to the old rows. Autoincrement IDs are not stable across re-scans.

**How to avoid:**
Do NOT use `symbols.id` as a foreign key in `symbol_dependencies`. Instead, key call-site edges by the composite natural key `(caller_path, caller_name, caller_kind, callee_path, callee_name, callee_kind)` — these survive re-scan because the name/path combination is stable. Alternatively, if an integer FK is needed for performance, regenerate `symbol_dependencies` rows as part of the same `upsertSymbols` transaction so there are never stale FKs. The `setEdgesAndSymbols` pattern from v1.6 (which atomically replaces both edges and symbols for a file) provides the right template: extend it to also replace `symbol_dependencies` for the file.

**Warning signs:**
- `find_callers('foo')` returns empty results after any file edit even when callers exist.
- `symbol_dependencies` table grows unboundedly (old rows not cleaned up on re-scan).
- A `PRAGMA foreign_keys = ON` check reveals FK violations after any scan cycle.

**Phase to address:** Schema design phase for `symbol_dependencies`.

---

### Pitfall 8: Incremental call-site Invalidation — Wrong Scope of What to Delete

**What goes wrong:**
When file `a.ts` changes, the call-site edges that must be invalidated are:

1. All outgoing edges FROM `a.ts` (the caller side — these must be re-extracted because `a.ts`'s call sites changed).
2. All incoming edges TO symbols IN `a.ts` (the callee side — if a symbol in `a.ts` was renamed or deleted, any caller in another file now has a dangling edge).

Developers typically only clear case 1 (edges where `caller_path = a.ts`) because that's the "file we just rescanned." Case 2 requires either a cascade delete keyed on callee path, or a cross-file re-resolution pass. Getting this wrong means stale "callers of `foo`" results that never evict after `foo` is renamed.

**Why it happens:**
The v1.6 watcher unlink cascade (`file_dependencies` + `symbols` + `files`) handles the DELETE case. For a change (not unlink), the pattern is re-extract-and-replace. The `symbol_dependencies` table adds a new dimension: a file can be a callee (not a source file) for edges stored in other files' rows. This asymmetry is easy to miss.

**How to avoid:**
When file `a.ts` changes, delete `symbol_dependencies` WHERE `caller_path = 'a.ts'` AND also WHERE `callee_path = 'a.ts'`. Re-extract call-site edges for `a.ts` (new caller rows). Callee-side edges from other files that target symbols in `a.ts` will remain; they are potentially stale if symbols in `a.ts` changed names, but this is an acceptable eventual-consistency tradeoff — document it explicitly. A full cross-file re-resolution on every change is too expensive. The correct mental model: caller-side is authoritative and updated on every scan; callee-side is an index that may lag by one edit cycle.

**Warning signs:**
- `find_callers('oldName')` still returns results after a function in the callee file was renamed to `newName` and the callee file was re-scanned.
- `symbol_dependencies` row count monotonically increases during an edit session (rows not cleaned on re-scan).

**Phase to address:** Watcher integration phase for symbol_dependencies.

---

### Pitfall 9: Dangling Resolution in call-site Edges — Do Not Reject, Do Not Pollute

**What goes wrong:**
Many call sites in real codebases cannot be statically resolved: the callee is a variable (`obj.method()`), a dynamic import (`import(path)`), or simply refers to a name that exists in multiple files with the same name. Two failure modes:

- **Reject silently:** Drop unresolvable call sites entirely. The call graph is incomplete but clean. Agents asking "who calls foo" get a subset answer.
- **Store dangling:** Insert a `symbol_dependencies` row with a `callee_path` of `NULL` or a placeholder. The table fills with noise, and agents cannot distinguish real edges from unresolved guesses.

**Why it happens:**
Call-site resolution without a full type system (TypeScript compiler API, not just tree-sitter) is inherently approximate. The temptation is to "try harder" and insert partial matches, but partial matches create ambiguity.

**How to avoid:**
Use the reject-silently approach: only insert `symbol_dependencies` rows when the callee can be resolved to a specific file+symbol pair with HIGH confidence. The resolution confidence hierarchy:
1. Same-file reference to a symbol defined in the same file (no import needed) — HIGH confidence, always insert.
2. Imported symbol where the import statement gives a specific specifier AND the symbol name appears in the target file's `symbols` table — HIGH confidence, insert.
3. Everything else — discard silently.

Log resolution failures at DEBUG level only (not INFO or WARN) to avoid log spam. Document the "best-effort, import-grounded" model in the MCP tool description for `find_callers`.

**Warning signs:**
- `symbol_dependencies` table has more rows than the number of import statements in the codebase.
- `find_callers('Error')` returns hundreds of results (the built-in `Error` class matched across all files).

**Phase to address:** call-site resolution design phase.

---

### Pitfall 10: Over-Matching on Same-Name Symbols — Ambiguity Without Signal

**What goes wrong:**
Multiple symbols across the codebase share the same name. A `find_callers('format')` query on a codebase with `format` defined in `utils/date.ts`, `utils/number.ts`, and `utils/string.ts` would, with naive name-only matching, return callers of all three as if they called the same function. This is silently wrong. Agents receive a union of unrelated call graphs.

**Why it happens:**
Without type information (the TypeScript compiler's type checker), the only signal available is the import path. If the caller file imports `format` from `'./utils/date'`, it is calling `date.format`, not `number.format`. The import specifier disambiguates — but only if `imported_names` metadata is available on the `file_dependencies` row (which v1.6 provides for TS/JS files via `imported_names` column).

**How to avoid:**
Call-site resolution MUST use both the symbol name AND the import specifier to match. The resolution algorithm:
1. Find all `file_dependencies` rows WHERE `source_path = callerFile` AND `imported_names` JSON contains the target symbol name.
2. Resolve the `target_path` of those rows.
3. Look up the symbol in `symbols` WHERE `path = resolvedTarget` AND `name = symbolName`.
4. If found — insert the `symbol_dependencies` edge. If not found — discard.

This ensures `format` from `utils/date` is never confused with `format` from `utils/string`. The `imported_names` column added in v1.6 is the key enabler; the call-site resolution phase must treat it as required input, not optional metadata.

**Warning signs:**
- `find_callers('render')` returns callers from every React file in a project because the resolution matched on name alone without checking which `render` was imported.
- A test that creates two files with the same exported function name and verifies `find_callers` does not cross-contaminate fails.

**Phase to address:** call-site resolution design phase, and resolution algorithm implementation.

---

### Pitfall 11: Barrel Files Break call-site Resolution — Know When to Give Up

**What goes wrong:**
Barrel files (`index.ts` that re-exports everything from subdirectories) create a many-to-one mapping problem: a caller does `import { foo } from './components'`, and `components/index.ts` re-exports `foo` from `components/Button.tsx`. The `imported_names` on the `file_dependencies` row points to the barrel (`components/index.ts`) as the target, but the actual callee symbol `foo` is defined in `Button.tsx`. Following the re-export chain requires recursive resolution — expensive and fragile.

**Why it happens:**
v1.6 explicitly deferred transitive re-export resolution (`export * from './foo'` is out of scope per PROJECT.md). The `file_dependencies` rows for barrel-re-exported symbols have `target_path = index.ts`, not the leaf definition file.

**How to avoid:**
Do NOT attempt transitive barrel resolution in v1.7. Accept that call-site edges from callers that import via barrel files will fail to resolve (silent discard, per Pitfall 9). Document: "call-site resolution traces direct imports only; barrel/re-export chains are not followed." This is honest and matches the existing v1.6 re-export scoping decision. A future milestone can add one-hop re-export following if adoption data justifies the complexity.

**Warning signs:**
- Resolution loop that follows `re_exports` edges in `file_dependencies` runs for more than 3 hops before giving up.
- `symbol_dependencies` contains edges where `callee_path` is an `index.ts` file (a barrel, not a definition file).

**Phase to address:** call-site resolution design phase.

---

### Pitfall 12: call-site Cycle Detection — Not Required, But Self-Loops Must Be Excluded

**What goes wrong:**
A symbol that calls itself (recursion) creates a self-loop: `caller_path == callee_path` AND `caller_name == callee_name`. If `find_callers('factorial')` includes `factorial` itself as a caller, agents may get confused or enter infinite expansion loops. Transitive call-graph cycles (A calls B calls A) are common in real codebases and do NOT need active cycle detection — `find_callers` is a one-hop query, not transitive, so cycles in the call graph don't cause infinite loops in the tool itself.

**Why it happens:**
Recursive functions legitimately call themselves. The self-loop is a correct edge to store, but returning it in `find_callers` results conflates "who else calls this" with "this calls itself." These are different questions.

**How to avoid:**
Exclude self-loops from `find_callers` results by filtering WHERE `caller_path != callee_path OR caller_name != callee_name`. Store self-loop edges in `symbol_dependencies` (they are true call-site edges) but filter them at query time. Do NOT implement graph cycle detection for `symbol_dependencies` — it is not needed because no tool performs transitive traversal over the call graph.

**Warning signs:**
- `find_callers('factorial')` returns `factorial` itself as the first result.
- Agents misinterpret the self-loop as "factorial is called by some other function named factorial in the same file."

**Phase to address:** MCP surface phase for `find_callers`.

---

### Pitfall 13: Performance Regression — v1.7 Adds 3 Scan Paths on Top of v1.6's +13.75% Self-Scan Hit

**What goes wrong:**
v1.6 shipped at +13.75% self-scan wall time (2085ms vs 1833ms baseline). v1.7 adds Python AST symbol extraction, Go regex symbol extraction, Ruby regex symbol extraction, AND TS/JS call-site resolution (a second pass through `imported_names` after edge extraction). Each new extraction path adds per-file cost. Without a performance baseline captured at the start of the first v1.7 phase, there is no way to know when the 15% soft threshold (from the self-scan) is crossed.

**Why it happens:**
v1.6 established the benchmark pattern (PERF-01 captured `baseline.json` at Phase 33 start), but the v1.7 team may start from the v1.6 `bench-end.json` rather than re-baselining. The v1.6 end result IS the v1.7 start baseline. If this is not explicitly captured before any v1.7 extraction code lands, PERF-02 for v1.7 has no clean comparison point.

**How to avoid:**
Run the bench-scan CLI at the start of the first v1.7 phase (before any extraction code is added) and save as `v1.7-baseline.json`. Apply the same single-pass mandiate: all new language extractors must share a single `parser.parse()` call per file. Verify the mandate with a grep-source test (the same pattern used in v1.6 to guard single-pass). For call-site resolution: resolution runs AFTER the AST walk (during the `imported_names` lookup phase, not a second parse). Budget expectation: Python AST add ~5-10% per Python file; Go/Ruby regex add ~1-3% per file; TS/JS call-site adds ~2-5% per file. If self-scan crosses 20% above v1.6 baseline, stop and profile before shipping.

**Warning signs:**
- Self-scan wall time exceeds 2500ms (vs v1.6 end of 2085ms — a 20% increase).
- Medium-repo scan exceeds 400ms (vs v1.6 end of 364ms).
- The bench-scan script was not run before v1.7 Phase 1 extraction code landed.

**Phase to address:** First v1.7 phase (baseline capture), and every extraction phase thereafter.

---

### Pitfall 14: Single-Pass Invariant Broken for New Language Extractors

**What goes wrong:**
v1.6 established a hard invariant: all extraction (edges + symbols + importMeta) must share a SINGLE `parser.parse()` call per file. The `extractTsJsFileParse` function exists specifically to enforce this. A developer adding Python symbol extraction may call `pythonParser.parse(content)` once in `extractPythonEdges` and again separately in a hypothetical `extractPythonSymbols` function — two parses per file, doubling AST walk cost for Python files.

**Why it happens:**
The registry model in `language-config.ts` has each language's `extract` function handle both edges and symbols (for TS/JS). New developers may not realize that Python needs the same unified approach and instead add a separate symbols extraction call path.

**How to avoid:**
Extend the registry's `LanguageConfig` interface to include an optional `extractWithSymbols` function (or extend `extract` to return both edges and symbols). The coordinator and file-watcher must call `extractWithSymbols` when available instead of calling `extractEdges` + a separate symbol call. Add a grep-source test that asserts no language extractor calls `parser.parse` more than once per invocation. This is the same invariant guard pattern established in v1.6.

**Warning signs:**
- A language extractor file contains two calls to `parser.parse(content)`.
- Profiling shows Python files taking 2x the expected parse time.
- The bench-scan result shows Python-heavy repos taking disproportionately longer than expected.

**Phase to address:** First v1.7 extraction phase (Python). Enforce for all subsequent languages.

---

### Pitfall 15: symbols Table Has No UNIQUE Constraint — Same Name+Kind+Line Can Be Inserted Twice

**What goes wrong:**
The `symbols` table schema (confirmed in `schema.ts` lines 54-65) has no UNIQUE constraint on `(path, name, kind, start_line)`. The `upsertSymbols` function uses DELETE-then-INSERT, which prevents duplicates WITHIN a single call. But if two code paths call `upsertSymbols` for the same file in a race (e.g., watcher fires during a bulk-extract), the DELETE is not atomic with the INSERT from the other path, and duplicate rows can appear. A duplicate `foo` function symbol in `symbols` for the same file causes `find_symbol` to return the same symbol twice.

**Why it happens:**
v1.6 relied on the watcher mutex and the `kv_state` gate to prevent concurrent access. v1.7 adds more extraction paths (three new languages, plus call-site). The concurrency surface grows.

**How to avoid:**
The watcher mutex already serializes file changes. The `kv_state` bulk-extract gate runs once at startup before the watcher is active. These guards are sufficient IF no new concurrent path is introduced. The recommendation: add a database-level UNIQUE constraint on `(path, name, kind, start_line)` in a new migration. This converts silent duplicates into a constraint violation that surfaces early in testing. Use `INSERT OR IGNORE` instead of bare INSERT to make the upsert idempotent at the database layer.

**Warning signs:**
- `SELECT COUNT(*), path, name, kind, start_line FROM symbols GROUP BY path, name, kind, start_line HAVING COUNT(*) > 1` returns rows.
- `find_symbol` returns the same symbol twice with identical line numbers.

**Phase to address:** Schema migration phase at the start of v1.7.

---

### Pitfall 16: MCP Response Bloat — find_callers Returning Full Symbol Objects for N Callers

**What goes wrong:**
If `find_callers` returns the same response shape as `find_symbol` (full symbol objects including `startLine`, `endLine`, `kind`, `isExport`, `path`), and a popular function like `useState` has 200 callers in a medium-sized React project, the response is 200 × ~80 bytes = 16KB of JSON before truncation. The v1.6 `find_symbol` envelope `{items, total, truncated?}` with a `maxItems` clamp prevents this for symbol lookup, but the same discipline must be applied to `find_callers`.

**Why it happens:**
New MCP tools tend to return "everything we know" without thinking about token budget. v1.6's audit explicitly cut three tools for this reason.

**How to avoid:**
`find_callers` must apply the same `{items, total, truncated?}` envelope with a `maxItems` param (default 50, max 200). Each item should be minimal: `{path, name, kind, startLine}` — not the full callee symbol shape. The `endLine` is unnecessary for navigation. Test by asserting the response shape in a contract test before shipping.

**Warning signs:**
- `find_callers` returns a flat array without a `total` field.
- A single `find_callers` call on a popular utility function returns more than 50 items without truncation metadata.
- No `maxItems` parameter in the tool's Zod schema.

**Phase to address:** MCP surface phase for `find_callers`.

---

### Pitfall 17: kv_state Bulk-Extract Gate Pattern Must Be Replicated for Each New Language

**What goes wrong:**
v1.6 gated migration-time bulk symbol extraction behind `kv_state('symbols_bulk_extracted')`. If v1.7 adds Python/Go/Ruby symbols without gating the backfill behind a separate key (e.g., `symbols_py_bulk_extracted`), one of two bad things happens:

1. The v1.6 gate (`symbols_bulk_extracted`) is already set on existing repos, so the bulk extract runs zero times for new languages — existing files never get Python/Go/Ruby symbols until they are edited.
2. The v1.6 gate is repurposed to re-trigger for ALL languages, causing TS/JS symbols to be re-extracted unnecessarily from scratch on every existing repo's next startup.

**Why it happens:**
The kv_state key is a one-shot gate. Reusing the same key for a new extraction scope silently corrupts the gate semantics.

**How to avoid:**
Introduce a separate kv_state key per language backfill: `symbols_py_bulk_extracted`, `symbols_go_bulk_extracted`, `symbols_rb_bulk_extracted`. The bulk-extract migration reads each gate independently and runs only the missing languages. This is the same pattern used in v1.6 — just applied once per language. Add a migration test that verifies the per-language gates trigger exactly once.

**Warning signs:**
- Python files on an existing repo show zero symbols immediately after upgrading to v1.7, despite having `def` functions.
- The `kv_state` table has `symbols_bulk_extracted = done` from v1.6 but no Python/Go/Ruby equivalent keys.
- A fresh repo (no prior symbols) gets Python/Go/Ruby symbols immediately (watcher fires), but an existing repo does not.

**Phase to address:** Bulk-extract migration phase for new languages.

---

### Pitfall 18: File Rename Is Unlink + Add — symbol_dependencies Must Be Cascade-Deleted on Unlink

**What goes wrong:**
The v1.6 watcher unlink handler deletes `file_dependencies` + `symbols` + `files` in a single `sqlite.transaction()`. When `symbol_dependencies` is added, the rename-as-unlink event will delete `symbols` rows for the old path but leave `symbol_dependencies` rows that reference those deleted symbols (by path key, since we use natural keys not FK IDs per Pitfall 7). These dangling `symbol_dependencies` rows survive the rename and corrupt the call graph.

**Why it happens:**
The three-DELETE cascade was designed in v1.6 before `symbol_dependencies` existed. Adding a fourth table requires explicitly adding it to the cascade.

**How to avoid:**
Extend `deleteFile()` (the unlink handler) to also execute `DELETE FROM symbol_dependencies WHERE caller_path = ? OR callee_path = ?` inside the same `sqlite.transaction()`. This is a four-DELETE cascade. Write a regression test in `watcher-symbol-lifecycle.test.ts` (the existing paranoid `SELECT COUNT(*)` test) that also asserts `symbol_dependencies` is empty after unlink. Mirror the v1.6 WTC-03 pattern.

**Warning signs:**
- After renaming a file, `symbol_dependencies` still has rows referencing the old path.
- `find_callers` returns callers that no longer exist (because the caller file was renamed and the old path is now a dangling reference).
- The watcher lifecycle test does not include a `SELECT COUNT(*) FROM symbol_dependencies WHERE caller_path = ?` assertion.

**Phase to address:** Watcher lifecycle hardening phase.

---

### Pitfall 19: /gsd-verify-work Skipped Again — Process Gap From v1.6 Repeats

**What goes wrong:**
v1.6 shipped Phases 33 and 35 without `/gsd-verify-work`. VERIFICATION.md was generated retroactively from audit artifacts and test files. This means the original intent encoded in REQUIREMENTS.md was not verified during execution — only reconciled at milestone close. The RETROSPECTIVE.md notes this as a recurring pattern across v1.3, v1.4, v1.5, and v1.6 (four milestones in a row). The risk: requirements drift silently. A requirement says "X" but the implementation does "X minus an edge case" — the retroactive audit catches it, but only after the phase closes.

**Why it happens:**
Fast-moving phases (v1.6 was 3 phases in 1 day) create pressure to skip verification steps that feel like overhead. The `/gsd-verify-work` step is perceived as documentation work, not quality control.

**How to avoid:**
For v1.7: treat VERIFICATION.md as a phase exit gate, not an optional artifact. The orchestrator should not approve phase closure without a VERIFICATION.md that cites test file + describe block + test name for each REQUIREMENTS.md entry. If a phase is too fast for formal verification, the minimum acceptable substitute is a `npm test -- --reporter=verbose` output that references the specific requirement IDs. The pattern from v1.6 Phase 34 (14/14 truths, 91 tests) is the model.

**Warning signs:**
- A phase SUMMARY.md has `requirements-completed:` entries with no corresponding VERIFICATION.md.
- REQUIREMENTS.md traceability table still shows "Pending" after a phase marked as complete.
- The milestone close generates VERIFICATION.md from audit rather than from phase artifacts.

**Phase to address:** Every phase in v1.7 — process discipline, not a technical gate.

---

### Pitfall 20: Deferred Tech-Debt Items Accumulate — Close At v1.7 Milestone Boundary, Not During Phases

**What goes wrong:**
The 7 historical quick-task artifacts deferred at v1.6 close (and v1.5 close before that) have not been resolved. If v1.7 phases also generate deferred items, the STATE.md "Deferred Items" table becomes a graveyard of unresolved stubs. This creates cognitive debt: at each milestone close, the audit must re-examine these items and confirm they are still intentionally deferred.

**Why it happens:**
Deferred items are correctly deferred during phases (do not interrupt execution to resolve historical artifacts). But they are never scheduled for closure — they just drift forward.

**How to avoid:**
Reserve one phase slot at the end of v1.7 for audit/closure. Specifically: the 7 historical quick-task items should be formally closed (either delete the incomplete dirs or write minimal SUMMARY files) at v1.7 milestone close, not deferred again. Establish the rule: deferred items older than 2 milestones must be either closed or formally accepted as won't-fix with a documented reason.

**Warning signs:**
- STATE.md Deferred Items table has more than 10 entries at milestone close.
- The same 7 items appear in the Deferred Items table at v1.7 close that appeared at v1.6 close.
- No phase in v1.7 is allocated to audit/closure work.

**Phase to address:** Final audit/closure phase in v1.7 milestone plan.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Re-using `symbols_bulk_extracted` kv_state key for new languages | One gate to manage | v1.6 repos never backfill new languages; existing gate blocks all re-extraction | Never — one gate per language per extraction kind |
| Using `symbols.id` as FK in `symbol_dependencies` | Simpler query joins | Every file re-scan breaks all call-site edges silently | Never — use natural path+name composite key |
| Calling `parser.parse()` twice per file (edges + symbols separately) | Simpler code structure | 2x AST parse cost per file; v1.7 performance regression guaranteed | Never — single-pass invariant must hold for every language |
| Extracting nested methods as top-level symbols (Python) | Less code | `find_symbol` polluted with every class method; agents receive misleading results | Never — top-level only |
| Attempting to resolve `attr_accessor` in Ruby | Looks more complete | False positives from Rails macros, DSL methods; high noise-to-signal ratio | Never — document the limitation instead |
| Skipping `symbol_dependencies` cascade in the unlink handler | Less code to change | Dangling call-site edges survive file rename; stale call graph forever | Never — extend the four-DELETE cascade |
| Omitting `maxItems` envelope on `find_callers` | Simpler response shape | Token budget violation on popular functions; same problem v1.6 audit fixed | Never — apply the same envelope pattern |
| Skipping `/gsd-verify-work` on fast phases | Faster phase close | Retroactive VERIFICATION.md at milestone close hides requirement drift; recurring across 4 milestones | Never for v1.7 — the pattern has repeated too many times |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `tree-sitter-python` `async_function_definition` | Visit only `function_definition` — misses all async def | Visit both `function_definition` and `async_function_definition` |
| `tree-sitter-python` decorator line numbers | Take `startLine` from inner `function_definition` node | Take `startLine` from `decorated_definition` parent node |
| Go regex method extraction | Pattern `^func\s+(\w+)` misses `func (r T) Method()` | Two patterns: one for bare functions, one for methods with receiver |
| Go regex with generics | `\([^)]+\)` receiver pattern breaks on `func (r T[K, V]) M()` | Use non-greedy `\(.*?\)` or allow `[` inside receiver pattern |
| `symbol_dependencies` invalidation on file change | Delete only `caller_path = changedFile` | Delete `caller_path = changedFile` OR `callee_path = changedFile` |
| call-site resolution with barrel files | Follow `re_exports` edges to find the leaf definition | Do not follow re-export chains; discard silently when target is a barrel |
| `find_callers` response shape | Return full symbol objects for all callers | Apply `{items, total, truncated?}` envelope with `maxItems` clamp |
| `kv_state` bulk-extract gate for new languages | Reuse `symbols_bulk_extracted` key from v1.6 | New key per language: `symbols_py_bulk_extracted`, etc. |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Two `parser.parse()` calls per file (edges + symbols separate) | Python files take 2x longer than expected; v1.7 scan crosses 20% regression | Enforce single-pass invariant; grep-source test for double parse | From first Python file scanned |
| call-site resolution doing a `findSymbols` lookup for every call expression in every file | Resolution phase takes longer than the AST walk itself; scan times double | Only resolve call sites where the callee name appears in `imported_names` of an existing `file_dependencies` row — no speculative lookups | Repos with 100+ files; >1000 call expressions |
| No bench-scan baseline before first v1.7 extraction lands | PERF-02 comparison has no clean starting point; regression unknown until milestone close | Run bench-scan and save `v1.7-baseline.json` as the FIRST step of Phase 36 | At Phase 36 start if skipped |
| Building the symbol name→path index in memory on every scan | RAM usage grows proportionally to codebase; re-scan from cold start re-builds index from scratch | Use the `symbols` table as the index (it IS the index); do not maintain a parallel in-memory map | Repos with >50K symbols |
| `symbol_dependencies` table missing index on `callee_path` | `find_callers` does a full table scan instead of an index seek; query time grows linearly with table size | Add `INDEX ON symbol_dependencies(callee_path)` in the migration; also index `(callee_path, callee_name)` | Tables with >10K call-site edges |

---

## "Looks Done But Isn't" Checklist

- [ ] **Python async def coverage:** `npm run inspect-symbols path/to/async.py` shows symbols for `async def` functions — not just `def` functions.
- [ ] **Python decorator line numbers:** `get_file_summary.exports[]` on a file with a decorated function shows `startLine` at the `@decorator` line, not the `def` line.
- [ ] **Python scope limiting:** A Python file with a class containing 3 methods shows 1 class symbol, not 4 (class + 3 methods).
- [ ] **Go method extraction:** A Go file containing only method declarations (no bare functions) shows at least one symbol in `find_symbol`.
- [ ] **Go generics receiver:** A Go file with `func (s Service[K, V]) Get() K {}` shows `Get` as a symbol — not a parse error and not a capture of `K`.
- [ ] **Ruby limitation documented:** `find_symbol` tool description mentions that `attr_accessor`-generated methods are not indexed.
- [ ] **call-site self-loop exclusion:** `find_callers('recursiveFunction')` does not return the function itself as a caller.
- [ ] **symbol_dependencies cascade:** After a file unlink, `SELECT COUNT(*) FROM symbol_dependencies WHERE caller_path = ?` returns 0.
- [ ] **kv_state per-language gates:** `kv_state` table has separate rows for Python, Go, and Ruby bulk-extract gates — not a shared key.
- [ ] **find_callers envelope:** `find_callers` response has `{items, total, truncated?}` shape with `maxItems` param — not a flat array.
- [ ] **v1.7 bench baseline:** `v1.7-baseline.json` file exists and was created BEFORE any v1.7 extraction code landed.
- [ ] **VERIFICATION.md per phase:** Every v1.7 phase has a VERIFICATION.md citing test files and REQUIREMENTS.md REQ IDs before phase closure.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| `async_function_definition` missed in production | LOW | Add node type to visitor, re-run bulk extract for Python files, gated by `kv_state` key reset |
| Decorator startLine wrong in symbols table | LOW | Fix extractor, reset `symbols_py_bulk_extracted` key, bulk re-extract |
| Nested methods in symbols table | MEDIUM | Fix extractor, DELETE FROM symbols WHERE path LIKE '%.py', reset gate, bulk re-extract |
| symbol_dependencies dangling after file rename | MEDIUM | One-time `DELETE FROM symbol_dependencies WHERE caller_path NOT IN (SELECT path FROM files) OR callee_path NOT IN (SELECT path FROM files)`; fix cascade |
| kv_state gate reuse blocked Python/Ruby backfill | LOW | Add new per-language keys, drop and re-insert gated bulk-extract |
| Performance regression past 20% threshold | MEDIUM | Profile per-language extraction times; move the most expensive language to lazy/background extraction mode |
| VERIFICATION.md missing at phase close | LOW | Generate retroactively from test output + requirements table (same as v1.6 compensating control) — but this repeats the pattern; prevent in v1.7 |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Python async_function_definition missed | Phase: Python symbol extraction | `npm run inspect-symbols` on async fixture returns symbols |
| Python decorator startLine wrong | Phase: Python symbol extraction | Contract test asserts `startLine = @decorator` line |
| Python nested methods emitted as top-level | Phase: Python symbol extraction | Fixture with class + methods asserts only 1 class symbol |
| Go method extraction regex fails | Phase: Go symbol extraction | Fixture with method-only Go file asserts ≥1 symbol |
| Go generic receiver breaks regex | Phase: Go symbol extraction | Fixture with generic receiver asserts correct name capture |
| Ruby metaprogramming silently missing | Phase: Ruby symbol extraction + MCP surface | Tool description review; acceptance test documents the gap |
| Ruby reopened class returns multiple results | Phase: Ruby symbol extraction + MCP surface | `find_symbol` test asserts correct multi-result behavior |
| symbol_dependencies uses unstable symbol.id as FK | Phase: Schema design | Schema review: no FK on symbols.id; natural key used |
| Incremental invalidation wrong scope (callee side missed) | Phase: Watcher lifecycle for symbol_dependencies | Test: rename callee file, verify no stale call-site edges |
| Dangling call-site resolution polluting graph | Phase: call-site resolution implementation | Test: unresolvable call sites not in symbol_dependencies |
| Barrel file resolution loop | Phase: call-site resolution implementation | Test: barrel file import does not create symbol_dependencies row |
| call-site cycle detection not needed / self-loops excluded | Phase: call-site resolution + MCP surface | Test: recursive function not in its own `find_callers` results |
| Performance regression past threshold | Phase 1 of v1.7 (baseline) + every extraction phase | bench-scan result below 20% vs v1.7-baseline.json |
| Single-pass invariant broken by new language | Phase: each language extraction | grep-source test: no language extractor has two parser.parse() calls |
| symbols table UNIQUE constraint missing | Phase: Schema migration | Migration test verifies constraint; duplicate insert fails with UNIQUE error |
| find_callers response bloat | Phase: MCP surface for find_callers | Contract test asserts {items, total, truncated?} envelope and maxItems behavior |
| kv_state gate reused across languages | Phase: bulk-extract migration for new languages | kv_state table has 3 separate language-specific keys |
| symbol_dependencies not in unlink cascade | Phase: Watcher lifecycle | watcher-symbol-lifecycle.test.ts asserts `symbol_dependencies` empty after unlink |
| /gsd-verify-work skipped again | Every phase | VERIFICATION.md exists before phase close; orchestrator enforces |
| Deferred items accumulate across milestones | Final v1.7 audit phase | STATE.md Deferred Items table at v1.7 close has ≤7 items (same or fewer than v1.6 close) |

---

## Sources

- Project source: `src/db/schema.ts`, `src/db/repository.ts`, `src/language-config.ts`, `src/db/symbol-types.ts`, `src/change-detector/ast-parser.symbols.test.ts`, `src/db/repository.symbols.test.ts` — direct code audit (HIGH confidence)
- `.planning/PROJECT.md`, `.planning/MILESTONES.md`, `.planning/RETROSPECTIVE.md`, `.planning/STATE.md` — project history and decisions (HIGH confidence)
- `.planning/milestones/v1.6-research-archive/PITFALLS.md` — prior pitfall research for MCP/broker/testing concerns (HIGH confidence)
- [tree-sitter-python GitHub issues — async_function_definition node type](https://github.com/tree-sitter/tree-sitter-python/issues/28) — async/await grammar pitfall (MEDIUM confidence)
- [tree-sitter-python npm package](https://www.npmjs.com/package/tree-sitter-python) — version 0.25.0 (HIGH confidence)
- [tree-sitter-go npm package](https://www.npmjs.com/package/tree-sitter-go) — version 0.25.0, zerover (HIGH confidence)
- [tree-sitter-ruby npm package](https://www.npmjs.com/package/tree-sitter-ruby) — version 0.23.1 (HIGH confidence)
- [WASM bindings type export bug in tree-sitter 0.25.1](https://github.com/tree-sitter/tree-sitter/issues/4187) — native Node bindings recommended over WASM (MEDIUM confidence)
- [Ruby metaprogramming static analysis limitations — Cloudbees](https://www.cloudbees.com/blog/metaprogramming-in-ruby) — attr_accessor and define_method are invisible to AST parsers (HIGH confidence)
- [Barrel files and circular dependencies — laniewski.me](https://laniewski.me/blog/pitfalls-of-barrel-files-in-javascript-modules/) — re-export chain resolution complexity (MEDIUM confidence)
- [Incremental dependency graph invalidation — Tweag](https://www.tweag.io/blog/2025-09-18-managing-dependency-graph/) — invalidation scope theory (MEDIUM confidence)
- [Inside Turbopack: incremental computation — Next.js blog](https://nextjs.org/blog/turbopack-incremental-computation) — dirty-flag propagation and demand-driven recomputation (MEDIUM confidence)

---
*Pitfalls research for: v1.7 Multi-Lang Symbols + Call-Site Edges*
*Researched: 2026-04-24*
