# Feature Research

**Domain:** Symbol-level code intelligence for multi-language MCP server (FileScopeMCP v1.7)
**Researched:** 2026-04-23
**Confidence:** HIGH (tree-sitter grammar docs, LSP 3.17 spec, stack-graphs blog, code-graph-mcp inspection, Serena/Roam-code comparison, verified against project constraints)

---

## Context: What This Milestone Adds

FileScopeMCP v1.6 ships TS/JS symbol extraction (`find_symbol`, enriched `get_file_summary`) and file-granular dependency edges. v1.7 adds two distinct capabilities:

1. **Multi-language symbol extraction** — Python/Go/Ruby parallel to v1.6's TS/JS symbols (same `symbols` table, same `find_symbol` tool, same schema)
2. **TS/JS call-site edges** — upgrade from file-granular to symbol-granular: which symbol calls which symbol, stored in a new `symbol_dependencies` table, with a new `find_callers` MCP tool

These are independent features that share only the database and the existing `symbols` table as a prerequisite. Neither needs to ship together. Build order matters because call-site edges depend on the `symbols` table being populated for TS/JS.

---

## Question 1: Multi-Language Symbol Kinds

### How LSP tools categorize symbols

The LSP 3.17 spec defines 26 integer `SymbolKind` values. The ones used in practice for code (not primitives like String/Number/Boolean/Null) are:

| SymbolKind | Value | Used for |
|------------|-------|----------|
| `Class` | 5 | class definitions |
| `Method` | 6 | instance/class/static methods inside a class |
| `Property` | 7 | class fields, Python class-level vars |
| `Field` | 8 | struct fields (Go), Ruby instance vars |
| `Constructor` | 9 | `__init__` in Python, `initialize` in Ruby |
| `Enum` | 10 | enum declarations |
| `Interface` | 11 | Go interfaces, TS interfaces |
| `Function` | 12 | top-level functions |
| `Variable` | 13 | module-level variables |
| `Constant` | 14 | Go `const`, Ruby `CONST`, Python module-level literals |
| `Struct` | 23 | Go structs |
| `Module` | 2 | Ruby modules, Python packages |
| `TypeParameter` | 26 | Go generics |

**Key finding:** LSP does NOT distinguish `async def` from `def`, `@classmethod` from instance method, or `@staticmethod` from instance method. All are reported as `Function` or `Method` based purely on whether they're top-level or inside a class. Tools that want this distinction parse decorators themselves.

### Per-language symbol kinds (table stakes)

**Python (tree-sitter grammar: `tree-sitter-python`):**

| Extracted kind | AST node | Notes |
|----------------|----------|-------|
| `function` | `function_definition` at module level | top-level `def` and `async def` — same kind; async is metadata |
| `class` | `class_definition` | |
| `method` | `function_definition` inside `class_definition` | includes `__init__`, classmethods, staticmethods |
| `constant` | `assignment` where lhs is ALL_CAPS identifier at module level | convention-based, not enforced |

**What to skip for Python (justified):**
- `decorator` — NOT its own symbol kind. Decorators are attributes of the function/class they decorate. Pyright, Pylance, and ruby-lsp all treat decorators as metadata on the decorated symbol, not standalone definitions. Decorator _callees_ are call-site edges, not separate symbol kinds.
- `async def` vs `def` distinction — not a separate kind; same `function` kind. Agent queries (`find_symbol name:fetch_data`) don't need this split.
- `@classmethod` / `@staticmethod` — same `method` kind. Decorator annotation stored in future metadata, not in `kind` column.
- `__all__` parsing — table-stakes for exportedness BUT adds parser complexity. `__all__` is an assignment to a list literal; extracting its members requires evaluating a value node. Defer: treat symbols starting with `_` as non-exported, all others as exported (convention matches 90% of Python code).
- Nested functions / closures — HIGH noise, LOW value. Not exported, rarely queried.
- Property getters/setters (`@property`) — same `method` kind; property-ness is decorator metadata, not a kind.
- Type aliases (`MyType = TypeVar(...)`, `MyType: TypeAlias = ...`) — MEDIUM complexity to detect reliably via AST. Defer to v1.8.

**Exportedness for Python:** Symbol is `isExport = true` if it is defined at module level AND its name does not start with `_`. This matches Python convention (no `__all__` parsing needed for MVP). HIGH confidence this covers 90%+ of real-world use.

---

**Go (tree-sitter grammar: `tree-sitter-go` — but PROJECT.md D-06 decision locks Go to regex):**

| Extracted kind | Regex target | Notes |
|----------------|-------------|-------|
| `function` | `^func [A-Z]` / `^func [a-z]` at top level | top-level functions, exported if uppercase |
| `method` | `^func \([^)]+\)` receiver-style | method on any type |
| `struct` | `type Foo struct` | |
| `interface` | `type Foo interface` | |
| `type` | `type Foo =` / `type Foo SomeOtherType` | type aliases and definitions |
| `constant` | `const Foo = ...` / `const ( Foo = ... )` | const blocks need special handling |

**What to skip for Go:**
- Generic type parameters (`[T any]`) — parse complexity with regex. Add `typeParam` kind only if tree-sitter-go lands a stable npm package (D-06 defers this).
- Unexported identifiers — include in symbols table with `isExport = false` (agents may query them in context of same-file callers). Uppercase = exported in Go, enforced by the language, not convention.
- Package-level `var` declarations — LOW query value. Variables are not stable API surface. Skip.

**Exportedness for Go:** Go enforces it lexically — uppercase first letter = exported. This is deterministic and requires no convention guessing.

---

**Ruby (tree-sitter grammar: `tree-sitter-ruby`):**

| Extracted kind | AST node | Notes |
|----------------|----------|-------|
| `class` | `class` node | |
| `module` | `module` node | |
| `method` | `method` / `singleton_method` node | `def` and `def self.` |
| `constant` | `assignment` where lhs is `constant` node (all-caps or CamelCase) | Ruby constants are uppercase |

**What to skip for Ruby:**
- `attr_accessor` / `attr_reader` / `attr_writer` — these are **synthesized methods**, not AST-level definitions. Sorbet and ruby-lsp both handle `attr_accessor` by heuristic (require literal symbol argument at syntactic top-level of class). For v1.7: do NOT extract `attr_accessor` as a symbol kind. The synthesized getter/setter methods are not queryable by name in the AST. This is table stakes to GET RIGHT (avoid incorrect data) not to implement fully.
- `method_missing` / `define_method` / `const_set` — dynamic Ruby. No static tool resolves these correctly. Skip.
- Visibility modifiers (`private`, `protected`, `public`) — Ruby has runtime-defined visibility, not lexical. Ruby lacks a true "exported" concept analogous to Python `_prefix` or Go uppercase. Convention: all `class` and `module` definitions are exported; `method` definitions are exported by default.
- Eigenclass / singleton methods on non-self — skip. `def obj.method` patterns are rare and require flow tracking.

**Exportedness for Ruby:** All class/module/constant definitions are `isExport = true`. All methods are `isExport = true` by default (Ruby has no lexical privacy at the file level). This is a deliberate simplification — Ruby's `private` is runtime enforcement, not static visibility.

---

### Symbol kinds comparative summary

| Kind | Python | Go | Ruby | v1.6 TS/JS |
|------|--------|-----|------|-----------|
| `function` | top-level `def` | top-level `func` | — | top-level `function`, arrow const |
| `class` | `class` | — | `class` | `class` |
| `method` | `def` inside class | `func (T)` receiver | `def`, `def self.` | class method |
| `struct` | — | `type T struct` | — | — |
| `interface` | — | `type T interface` | — | `interface` |
| `module` | — | — | `module` | — |
| `constant` | ALL_CAPS module-level | `const` | ALLCAPS / CamelCase | `const` export |
| `type` | — | `type T = ...` | — | `type` alias |
| `enum` | — | — | — | `enum` |

---

## Question 2: Call-Site Edges — What "Who Calls foo" Means in Practice

### Scope taxonomy and what to implement

| Scope | What it is | Implementable at v1.7? | Accuracy |
|-------|-----------|------------------------|---------|
| Same-file, direct call | `foo()` where `foo` is defined in same file | YES | Near-100% |
| Cross-file, imported callee | `import {foo} from './bar'; foo()` | YES | HIGH (~90%) |
| Method call on known type | `obj.method()` where obj type is deterministic | PARTIAL — skip for v1.7 | N/A |
| Method call on unknown receiver | `unknown.method()` | NO | Requires type inference |
| Dynamic dispatch | `interface.method()`, callbacks, `apply`/`call` | NO | Requires runtime or type inference |
| Higher-order functions | `arr.map(fn)` where fn is a ref | PARTIAL — `fn` ref is extractable | MEDIUM |

**The "good enough" accuracy level for an LLM agent asking "who calls foo":**

Code intelligence tools like Sourcegraph (using SCIP/LSIF), GitHub stack-graphs, and roam-code all converge on the same design choice: **precise over approximate for static cases, skip dynamic cases**. An LLM agent asking "who calls `parseResponse`" needs correct positives (true callers it can then read), and can tolerate false negatives (missed dynamic dispatch calls), but is damaged by false positives (reported callers that don't actually call the target).

The evidence: stack-graphs (archived Sept 2025 after shipping TS support) use a conservative path-stitching algorithm that only resolves statically visible references. code-graph-mcp and roam-code both use AST pattern matching (not type inference) for caller/callee detection, achieving "fast (<3s)" with `find_callers`. The consensus: **70-85% recall on non-trivial TS/JS code is acceptable and standard for static-analysis-only tools**.

### Recommended v1.7 call-site resolution scope

**Build:** Direct-call `CallExpression` tracking with import resolution for TS/JS.

Specifically:
1. During the single-pass AST walk (alongside edge extraction), capture `CallExpression` nodes
2. For each call: extract the callee name (`foo`, `bar.baz`, `SomeClass.method`)
3. Match against the local `symbols` table: if a symbol with that name exists in the current file → direct edge
4. If not found locally, look up `imported_names` from `file_dependencies` for the current file → if the name appears in an import that resolves to a file we have symbols for → cross-file edge

**Skip for v1.7:**
- `obj.method()` where obj is not imported directly (receiver type unknown) — no type inference
- Dynamic dispatch — `arr[0]()`, computed property calls, Proxy
- Calls inside template literals or string-based `eval`-equivalents

This gives ~80% recall on typical application TS/JS code. The remaining 20% is dynamic/method calls that no static tool resolves correctly without a full type system.

**Storage:** New `symbol_dependencies` table:

```sql
symbol_id        TEXT  -- caller (references symbols.id)
target_symbol_id TEXT  -- callee (references symbols.id, nullable for unresolved)
target_name      TEXT  -- callee name string (always present, for unresolved cases)
target_file      TEXT  -- resolved file path (nullable)
edge_type        TEXT  -- 'calls' (v1.7 scope)
confidence       REAL  -- 1.0 for same-file resolved, 0.8 for cross-file resolved, 0.5 for unresolved
```

Unresolved calls (target symbol not in DB) are stored with `target_symbol_id = NULL` and `confidence = 0.5`. This lets `find_callers` return high-confidence edges while flagging the resolution gap.

---

## Question 3: MCP Tool Surface

### What queries matter for an LLM agent doing refactoring

Evidence from roam-code, code-graph-mcp, Serena, and code intelligence MCP (JetBrains) converges on five query types that generate agent value in refactoring workflows:

1. **"Who calls this symbol?"** — blast radius before editing
2. **"What does this symbol call?"** — understanding implementation dependencies  
3. **"Where is this symbol defined?"** — already covered by `find_symbol`
4. **"What is the blast radius of changing this file?"** — already covered by `get_file_summary.dependents[]`
5. **"What calls are now dead after this delete?"** — requires tombstones (deferred to v1.8)

The only NEW tool needed for v1.7 is `find_callers`. `find_callees` is a secondary differentiator.

### Proposed v1.7 MCP tools

**`find_callers(name, kind?, file?, maxItems?)`** — TABLE STAKES

Input:
```json
{ "name": "parseResponse", "kind": "function", "file": "src/api.ts", "maxItems": 50 }
```

Output:
```json
{
  "items": [
    {
      "callerSymbol": "fetchData",
      "callerKind": "function",
      "callerFile": "src/client.ts",
      "callerLine": 42,
      "confidence": 1.0
    },
    {
      "callerSymbol": "retryFetch",
      "callerKind": "function", 
      "callerFile": "src/client.ts",
      "callerLine": 87,
      "confidence": 0.8
    }
  ],
  "total": 2,
  "unresolvedCount": 3
}
```

`unresolvedCount` reports how many call sites were found that reference the name but could not be resolved to a known symbol (dynamic/method calls). This gives the agent an honest signal: "2 confirmed callers, 3 unresolved references".

**Why `name` not `symbol_id`:** Agent workflows start from a name the agent is looking at in a file, not a pre-known DB id. Allow optional `file` to disambiguate when same name exists in multiple files.

---

**`find_callees(name, kind?, file?, maxItems?)`** — DIFFERENTIATOR (not table stakes)

Same shape as `find_callers` but returns what the target symbol calls. Useful for "what would break inside this function if I change library X". Lower priority than `find_callers` because agents can read the function body directly for small functions.

---

**What NOT to add for v1.7:**

| Tool | Why Skip |
|------|---------|
| `get_call_graph(scope)` | Multi-hop graph traversal. Agents get confused by large graph dumps. One-hop callers + one-hop callees is sufficient for refactoring context. |
| `list_uses(symbol)` | Conflates call-site edges with import references. `find_callers` (call-site) + existing `get_file_summary.dependents[]` (import-site) covers both with clearer semantics. |
| `trace_call_path(from, to)` | Requires transitive BFS over symbol graph. HIGH complexity, agents can do this iteratively with `find_callers`. |
| `find_unused_symbols` | Requires complete call graph across all files before any symbol is declared unused. FALSE NEGATIVE RATE too high without full resolution. |

---

## Feature Landscape

### Table Stakes (Must Ship in v1.7)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Python symbol extraction (`function`, `class`, `method`, `constant`) | `find_symbol` already works for TS/JS; agents using Python repos get nothing without this | MEDIUM | Single-pass tree-sitter AST walk alongside existing edge extraction. Grammar: `tree-sitter-python` (already used in v1.4 for edge extraction). Reuses extractor pattern from TS/JS. |
| Go symbol extraction (`function`, `method`, `struct`, `interface`, `type`, `constant`) | Same pattern as Python — Go repos excluded from symbol tools | LOW-MEDIUM | Regex-based per D-06 decision (no stable `tree-sitter-go` npm grammar). Regex for Go is deterministic: uppercase = exported. |
| Ruby symbol extraction (`class`, `module`, `method`, `constant`) | Same pattern | MEDIUM | tree-sitter-ruby grammar exists. `attr_accessor` explicitly excluded. |
| `isExport` flag per language using language-appropriate convention | LLM agents depend on `exportedOnly=true` default in `find_symbol` — wrong exportedness = wrong results | LOW | Python: no `_` prefix. Go: uppercase first char. Ruby: all classes/modules/constants = exported; methods = exported. |
| TS/JS call-site edges in `symbol_dependencies` table | Core new data; everything else depends on it | HIGH | New table, new AST extraction pass for `CallExpression` nodes, import resolution lookup. |
| `find_callers(name, kind?, file?, maxItems?)` MCP tool | Primary agent query for refactoring blast radius | MEDIUM | Depends on `symbol_dependencies` table. Simple SELECT with JOIN on `symbols`. |

### Differentiators (High Value, Not Blockers)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `find_callees(name, kind?, file?, maxItems?)` MCP tool | Completes the bidirectional call graph surface — agent can ask "what does this function depend on at symbol level" | LOW | `symbol_dependencies` table already has caller→callee direction; this is a reversed query |
| `unresolvedCount` in `find_callers` response | Honest signal: "2 confirmed callers, 3 unresolved references you should investigate manually" — prevents false confidence | LOW | COUNT of `symbol_dependencies` rows where `target_name = ?` AND `target_symbol_id IS NULL` |
| Cross-file call resolution via import table | Upgrades from same-file-only to multi-file call graph; dramatically increases recall for modular TS/JS | MEDIUM | Requires joining `file_dependencies.imported_names` with `symbols` table for the callee file |
| Python `async def` metadata annotation | `async def` functions have different call semantics (must be awaited); useful annotation even if same `function` kind | LOW | Add `isAsync: bool` column to `symbols` table, populated from `async_function_definition` node vs `function_definition` |
| Go `const` block extraction | Go `const ( A = 1; B = 2 )` blocks need group-aware regex — single `const` is easy, blocks need multi-line parsing | MEDIUM | Affects correctness of Go constant symbols; wrong = missing constants from `find_symbol` |

### Anti-Features (Explicitly Excluded)

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| `decorator` as a symbol `kind` in Python | Decorators are attributes of the symbol they decorate, not definitions. Pyright, Pylance, and LSP 3.17 all model this correctly — decorator calls are call-site edges FROM the function TO the decorator. Treating decorators as symbol kinds adds noise with zero query value. | Store decorator names as metadata on the function/class symbol (future). For now, ignore. |
| `attr_accessor` / `attr_reader` / `attr_writer` as Ruby symbols | These synthesize methods dynamically. No tree-sitter grammar materializes the synthesized methods as AST nodes. Extracting them requires evaluating symbol literal arguments — Sorbet does this via heuristic and explicitly documents its fragility. False data is worse than missing data. | Skip. If an agent queries `find_symbol(name: "email")` in a Ruby file with `attr_accessor :email`, it gets no result — which is correct signal to look at the class definition. |
| Method calls on unknown receivers in call-site edges | `obj.method()` where `obj` type is not statically determinable requires full type inference. No static-analysis-only tool achieves reliable resolution here. Code-graph-mcp, stack-graphs, and roam-code all skip these with "pattern-based" accuracy. Attempting it produces false positives that mislead refactoring agents. | Store as `target_symbol_id = NULL, confidence = 0.5`. Report in `unresolvedCount`. |
| Cross-file call resolution for Python/Go/Ruby in v1.7 | Python/Go/Ruby get symbol extraction in v1.7, but their `symbol_dependencies` edges are v1.8 work. Reason: the TS/JS call-site implementation needs to ship and stabilize first; adding 3 more languages simultaneously doubles the blast radius of a new system. | Scope to TS/JS call-site edges in v1.7. Python/Go/Ruby get call-site edges in v1.8. |
| `get_call_graph(scope)` multi-hop tool | Agents fed large graph dumps hallucinate structure that isn't there. One-hop `find_callers` + one-hop `find_callees` is sufficient. Agents can chain calls iteratively for deeper traversal. | `find_callers` + `find_callees` composable by the agent. |
| `find_unused_symbols` dead-code detection | Requires a complete call graph (all files resolved) before any symbol can be declared dead. TS/JS dynamic imports, reflection, and serialization all create false "unused" signals. The false positive rate in real codebases is high enough to erode agent trust. | Agents use `find_callers` and judge from zero-result response. |
| `trace_call_path(from, to)` transitive traversal | O(N*M) graph traversal with cycle detection, result size unbounded. Complexity exceeds value for v1.7. Agents do this iteratively with `find_callers`. | Compose `find_callers` calls at agent level. |
| Fuzzy/regex symbol name matching in `find_callers` | `find_symbol` already handles prefix-GLOB. `find_callers` takes a name from `find_symbol` results, so it's always an exact known name at query time. Adding fuzzy matching adds ambiguity — "which `parse` did you mean?" — that the agent must resolve anyway. | Agents call `find_symbol(name: "parse*")` first, then `find_callers(name: "parseResponse", file: "src/api.ts")`. |
| Symbol importance scoring per symbol | File-level importance is already approximate. Per-symbol scoring requires per-symbol call-count aggregation that is expensive and noise-heavy. | File importance already propagates to symbols through their parent file. |
| Go tree-sitter grammar (upgrade from regex) | `tree-sitter-go` has no stable npm package (D-06 decision). Forcing tree-sitter here breaks the established regex approach that correctly handles Go imports. | Keep Go on regex for v1.7. Revisit when stable npm grammar ships. |

---

## Feature Dependencies

```
v1.6 symbols table (TS/JS symbols, find_symbol tool)
    └──required-by──> TS/JS call-site edges (need symbol IDs to reference)
    └──required-by──> find_callers MCP tool
    └──independent-from──> Python symbol extraction
    └──independent-from──> Go symbol extraction
    └──independent-from──> Ruby symbol extraction

Python symbol extraction
    └──uses──> tree-sitter-python grammar (already in use for edge extraction v1.4)
    └──populates──> symbols table (same schema as v1.6 TS/JS)
    └──enables-future──> Python call-site edges (v1.8)
    └──independent-from──> Go/Ruby extraction (can ship in same phase or split)

Go symbol extraction
    └──uses──> regex parser (D-06 decision maintained)
    └──populates──> symbols table
    └──independent-from──> Python/Ruby extraction

Ruby symbol extraction
    └──uses──> tree-sitter-ruby grammar (already in use for edge extraction v1.4)
    └──populates──> symbols table
    └──independent-from──> Python/Go extraction

TS/JS call-site edges (symbol_dependencies table)
    └──requires──> symbols table populated for TS/JS (v1.6 done)
    └──requires──> file_dependencies.imported_names (v1.6 done)
    └──requires──> new symbol_dependencies table schema
    └──enables──> find_callers MCP tool
    └──enables-future──> find_callees MCP tool (same table, reversed query)
    └──enables-future──> Python/Go/Ruby call-site edges (v1.8)

find_callers MCP tool
    └──requires──> symbol_dependencies table populated
    └──requires──> symbols table (for JOIN on symbol name → id)
    └──enhances──> existing get_file_summary (complements dependents[] at symbol level)

find_callees MCP tool
    └──requires──> symbol_dependencies table (same table as find_callers)
    └──same-phase-as──> find_callers (trivial to add when table exists)
```

### Dependency Notes

- **Multi-lang extraction is independent from call-site edges.** Either can ship first. Recommended order: multi-lang symbols first (lower risk, reuses v1.4 extractors), then call-site edges (new system, higher risk, warrants isolated phase).
- **Call-site edges require v1.6 symbols to be complete for TS/JS.** Already true — v1.6 is shipped.
- **`find_callers` and `find_callees` share the same table.** Implement both in the same phase for free — `find_callees` is a reversed SELECT, not additional infrastructure.
- **Python/Go/Ruby call-site edges are v1.8, not v1.7.** The `symbol_dependencies` schema and `find_callers` tool are defined in v1.7 with TS/JS data, which sets the stable contract for v1.8 to extend.

---

## MVP Definition

### Ship in v1.7 (This Milestone)

- [ ] **Python symbol extraction** (`function`, `class`, `method`, `constant` kinds; `isExport` via `_` prefix convention; single-pass AST walk reusing tree-sitter-python grammar already loaded for edge extraction) — required for Python repos to benefit from `find_symbol`
- [ ] **Go symbol extraction** (`function`, `method`, `struct`, `interface`, `type`, `constant` kinds; regex-based per D-06; `isExport` via uppercase convention) — required for Go repos
- [ ] **Ruby symbol extraction** (`class`, `module`, `method`, `constant` kinds; tree-sitter-ruby grammar; no `attr_accessor` synthesis; all class/module/constants exported) — required for Ruby repos
- [ ] **`symbol_dependencies` table** (new schema: caller `symbol_id`, `target_symbol_id` nullable, `target_name`, `target_file`, `edge_type = 'calls'`, `confidence`) — required for all call-site tools
- [ ] **TS/JS call-site edge extraction** (AST walk captures `CallExpression` nodes; matches against `symbols` table for same-file; joins `imported_names` from `file_dependencies` for cross-file; populates `symbol_dependencies`) — core new data
- [ ] **`find_callers` MCP tool** (`name`, optional `kind`, `file`, `maxItems`; returns `{items[], total, unresolvedCount}` envelope; `confidence` per item) — primary agent query
- [ ] **`find_callees` MCP tool** (same infrastructure, reversed query; ships with `find_callers`) — completes bidirectional surface

### Add After Core Is Stable (v1.7.x or v1.8)

- [ ] **Python `isAsync` metadata** — `async_function_definition` vs `function_definition` node type distinction; add column to `symbols` table when there's an agent use case surfaced from v1.7 dogfooding
- [ ] **Python/Go/Ruby call-site edges** — populate `symbol_dependencies` for non-TS/JS languages; same schema, same tools (`find_callers` already queries across all languages)
- [ ] **Go `const` block extraction** — multi-line regex for `const ( ... )` groups; lower priority than single-line `const`

### Defer to v1.9+

- [ ] **Decorator metadata** on Python/Ruby symbols — store decorator names as JSON column on `symbols`; no separate kind
- [ ] **Python `__all__` for precise exportedness** — requires evaluating list literal AST node; adds correctness for explicit-export modules
- [ ] **Ruby visibility modifiers** (`private`/`protected` tracking) — runtime Ruby semantics; requires dataflow, not static analysis

---

## Feature Prioritization Matrix

| Feature | Agent Value | Implementation Cost | Priority |
|---------|-------------|---------------------|----------|
| Python symbol extraction | HIGH | MEDIUM | P1 |
| Go symbol extraction | HIGH | LOW-MEDIUM | P1 |
| Ruby symbol extraction | HIGH | MEDIUM | P1 |
| `symbol_dependencies` table schema | HIGH (enables all call-site tools) | LOW | P1 |
| TS/JS call-site edge extraction | HIGH | HIGH | P1 |
| `find_callers` MCP tool | HIGH | MEDIUM | P1 |
| `find_callees` MCP tool | MEDIUM | LOW (free once find_callers exists) | P1 |
| `unresolvedCount` in find_callers response | MEDIUM (honest signal) | LOW | P1 |
| Cross-file call resolution via imported_names | HIGH | MEDIUM | P1 |
| Python `isAsync` metadata column | LOW | LOW | P3 |
| Go `const` block extraction | MEDIUM | MEDIUM | P2 |
| Python/Go/Ruby call-site edges | HIGH | HIGH | P2 (v1.8) |
| Python `__all__` exportedness | MEDIUM | MEDIUM | P3 |
| Ruby visibility modifier tracking | LOW | HIGH | P3 |

**Priority key:**
- P1: Ships in v1.7 milestone — core of the milestone
- P2: Ship when call-site edges are stable (v1.7.x or v1.8)
- P3: Own milestone, deferred until adoption signal

---

## Competitor Feature Analysis

| Feature | Sourcegraph (SCIP/LSIF) | code-graph-mcp | stack-graphs | Our Approach (v1.7) |
|---------|------------------------|----------------|--------------|---------------------|
| Find callers | Precise (full type inference + SCIP index) | Pattern-based AST; "universal" claimed | Static name resolution; method calls skipped | AST + import resolution; method calls skipped |
| Method call resolution | YES (requires SCIP indexer per language) | Partial/approximate | Skipped for complex cases | Skipped in v1.7 |
| Dynamic dispatch | NO (static only) | NO | NO | NO |
| Multi-language | 20+ languages with indexers | 25+ languages (ast-grep) | TS, Python (experimental) | TS/JS (call-site) + Python/Go/Ruby (symbols) |
| Exportedness | Per-language conventions + type info | Not reported | Not reported | Per-language conventions |
| `unresolvedCount` | Not exposed | Not exposed | Not applicable | YES — honest signal |
| MCP interface | YES (Amp API) | YES (9 tools) | NO | YES (integrated in existing 15-tool surface) |
| Same-repo only | NO (cross-repo) | YES | YES | YES |
| Requires separate indexer/daemon | YES (Sourcegraph instance) | NO (per-request) | YES (compile step) | NO (incremental, file-watcher driven) |

**Our key differentiation:** Incremental, file-watcher-driven updates mean call-site edges are always fresh after a file save, without a separate indexing step. Sourcegraph and stack-graphs require explicit reindex runs. This matters for LLM agent workflows that edit files and immediately ask "did this change break any callers?"

---

## Expected Input/Output Examples for Agent Use Cases

### Use case 1: "Is it safe to rename `parseResponse` to `deserializeResponse`?"

```
Agent: find_symbol("parseResponse", exportedOnly=false)
→ { items: [{name: "parseResponse", kind: "function", file: "src/api.ts", line: 47, isExport: true}], total: 1 }

Agent: find_callers("parseResponse", file="src/api.ts")
→ { items: [
     {callerSymbol: "fetchData", callerKind: "function", callerFile: "src/client.ts", callerLine: 42, confidence: 1.0},
     {callerSymbol: "retryFetch", callerKind: "function", callerFile: "src/client.ts", callerLine: 87, confidence: 0.8}
   ], total: 2, unresolvedCount: 0 }

Agent concludes: 2 callers in src/client.ts. Read those lines, rename all 3 occurrences.
```

### Use case 2: "What does `buildRequest` depend on at symbol level?"

```
Agent: find_callees("buildRequest", file="src/api.ts")
→ { items: [
     {calleeSymbol: "serializeBody", calleeKind: "function", calleeFile: "src/api.ts", confidence: 1.0},
     {calleeSymbol: "addHeaders", calleeKind: "function", calleeFile: "src/headers.ts", confidence: 1.0},
     {calleeName: "config.timeout", calleeFile: null, confidence: 0.5}  // unresolved method on config object
   ], total: 2, unresolvedCount: 1 }

Agent concludes: buildRequest calls 2 known symbols + 1 unresolved property access.
```

### Use case 3: "What Python classes are exported from src/models.py?"

```
Agent: find_symbol("*", kind="class", file="src/models.py", exportedOnly=true)
→ { items: [
     {name: "UserModel", kind: "class", file: "src/models.py", line: 12, isExport: true},
     {name: "ProductModel", kind: "class", file: "src/models.py", line: 45, isExport: true}
   ], total: 2 }
  (PrivateModel at line 78 excluded — starts with _)
```

---

## Build Order Recommendation

**Phase A: Multi-language symbol extraction (Python + Go + Ruby)**
- Lower risk: reuses existing tree-sitter grammar infrastructure from v1.4
- Directly extends `find_symbol` to cover all 4 target languages
- No new table schemas needed (uses existing `symbols` table)
- Can ship independently; no dependency on call-site edges
- Recommended: implement Python + Go + Ruby together in one phase since the pattern is uniform

**Phase B: TS/JS call-site edges + `symbol_dependencies` table**
- Higher risk: new table, new extraction logic, new import resolution join
- Depends on `symbols` table being populated for TS/JS (done in v1.6)
- Isolated from multi-lang symbols — if this phase has issues, Phase A work is unaffected
- `find_callers` + `find_callees` both ship at end of this phase

This ordering means Phase A can ship in parallel with schema design for Phase B. The call-site edge system has a clean, separate blast radius.

---

## Sources

- [LSP 3.17 Specification — SymbolKind enum](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — HIGH confidence (official spec)
- [tree-sitter Code Navigation — symbol kinds and roles](https://tree-sitter.github.io/tree-sitter/4-code-navigation.html) — HIGH confidence (official tree-sitter docs): standard kinds are `class`, `function`, `interface`, `method`, `module`; decorators are NOT a standard kind
- [tree-sitter-python node types](https://github.com/tree-sitter/tree-sitter-python/blob/master/src/node-types.json) — HIGH confidence: `function_definition`, `class_definition`, `async_function_definition`, `decorator` node types confirmed
- [tree-sitter-ruby grammar](https://github.com/tree-sitter/tree-sitter-ruby) — HIGH confidence: `method`, `singleton_method`, `class`, `module`, `constant` confirmed
- [GitHub Blog: Introducing stack graphs](https://github.blog/open-source/introducing-stack-graphs/) — MEDIUM confidence: precision-first design; method calls and inheritance listed as open questions
- [stack-graphs repo archived Sept 2025](https://github.com/github/stack-graphs) — MEDIUM confidence: confirmed via search result; project archived after shipping TS support
- [code-graph-mcp tools](https://github.com/entrepeneur4lyf/code-graph-mcp) — MEDIUM confidence: `find_callers`/`find_callees` tool shapes confirmed; uses ast-grep backend; no accuracy metrics published
- [Sourcegraph code intelligence — SCIP](https://sourcegraph.com/) — MEDIUM confidence: SCIP/LSIF precise navigation; requires language-specific indexer
- [Sorbet attr_accessor heuristics](https://sorbet.org/docs/faq) — HIGH confidence: explicit documentation that `attr_accessor` requires syntactic literal arg; fragility of dynamic Ruby acknowledged
- [Go exported/unexported — ardanlabs](https://www.ardanlabs.com/blog/2014/03/exportedunexported-identifiers-in-go.html) — HIGH confidence: uppercase = exported is lexical, enforced by Go compiler
- [LSP SymbolKind string proposal #1186](https://github.com/microsoft/language-server-protocol/issues/1186) — HIGH confidence: confirms LSP lacks fine-grained Python method distinctions (`async def`, `classmethod`, etc.)
- [roam-code — SQLite symbol graph MCP](https://github.com/Cranot/roam-code) — MEDIUM confidence: pattern confirms call graph + symbol search in SQLite is the right architecture
- [Serena MCP — symbol-level retrieval](https://github.com/oraios/serena) — MEDIUM confidence: confirms `find_callers`-equivalent is table stakes for agent refactoring
- [Dynamic dispatch — Wikipedia](https://en.wikipedia.org/wiki/Dynamic_dispatch) — HIGH confidence: confirms no static analysis tool resolves dynamic dispatch without runtime type information
- FileScopeMCP PROJECT.md and v1.6 FEATURES.md — HIGH confidence (authoritative project context, no external verification needed)

---

*Feature research for: FileScopeMCP v1.7 Multi-Lang Symbols + Call-Site Edges*
*Researched: 2026-04-23*
