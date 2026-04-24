# Project Research Summary

**Project:** FileScopeMCP v1.7 Multi-Lang Symbols + Call-Site Edges
**Domain:** Incremental extension of a tree-sitter/SQLite code-intelligence MCP server
**Researched:** 2026-04-23
**Confidence:** HIGH

---

## Executive Summary

FileScopeMCP v1.7 extends the symbol-level intelligence shipped in v1.6 in two independent directions: (1) multi-language symbol extraction for Python, Go, and Ruby using the existing tree-sitter and regex infrastructure, and (2) TS/JS call-site edges — upgrading file-granular dependency edges to symbol-granular so agents can answer "who calls foo." Research across all four domains is internally consistent and grounded in direct codebase inspection, live npm registry verification, and live grammar parse tests. The recommended approach is a three-phase sequence: schema migration and multi-language symbols first (Phase 36), TS/JS call-site edge extraction second (Phase 37), and MCP surface last (Phase 38). This ordering isolates risk at each boundary — multi-language symbols are additive and low-risk, call-site extraction introduces a new table and a second AST pass, and the MCP surface is pure I/O that can be validated against stable data.

The most significant risk is performance. v1.6 shipped at +13.75% self-scan wall time versus its Phase 33 baseline, already approaching the 15% soft threshold. v1.7 adds Python AST walks, Go and Ruby regex passes, and a call-expression traversal over every TS/JS file. Without a performance baseline captured before any v1.7 extraction code lands, the milestone has no comparison point. Research flags this as a roadmap-shaping constraint: bench-scan must be the first deliverable of Phase 36, and each subsequent phase must verify it stays below 20% above that new baseline.

Three cross-cutting architectural decisions require explicit resolution before implementation begins. First, D-06 (Go stays on regex) is reversed: `tree-sitter-go@0.25.0` is now stable on npm with a `peerDep: ^0.25.0` that matches the installed `tree-sitter@0.25.0` exactly — Go symbol extraction should use the grammar, not regex (edge extraction stays on regex). Second, ARCHITECTURE.md's proposed `symbol_dependencies` schema uses `(caller_symbol_id, callee_symbol_id)` integer FKs referencing `symbols.id`, but PITFALLS.md demonstrates that `symbols.id` is reset on every file re-scan via DELETE-then-INSERT, making these FKs silently dangling after any file edit. The resolution is to delete and re-insert `symbol_dependencies` rows atomically within the same transaction as `upsertSymbols`, using the fresh IDs. Third, Ruby symbol extraction should ship via `tree-sitter-ruby@0.23.1` (STACK.md confirms it loads cleanly against `tree-sitter@0.25.0`) rather than staying deferred — the grammar is validated and Ruby is listed as table stakes in FEATURES.md.

---

## Key Findings

### Recommended Stack

The retained stack requires no changes. Two new production dependencies are added: `tree-sitter-go@0.25.0` and `tree-sitter-ruby@0.23.1`. Both were live-tested against the installed `tree-sitter@0.25.0` and confirmed compatible. Call-site edge extraction for TS/JS requires no new packages — it extends the existing `extractRicherEdges()` function in `ast-parser.ts` using parsers already loaded. The `symbol_dependencies` table is defined in `schema.ts` using existing `drizzle-orm/sqlite-core` imports with manual `CREATE TABLE IF NOT EXISTS` migration (matching the project's established migration pattern). No ts-morph, no TypeScript language service, no additional dependencies.

**New dependencies:**
- `tree-sitter-go@0.25.0`: Go symbol extraction (function, method, struct, interface, type, const) — peerDep ^0.25.0 matches exactly; D-06 reversed.
- `tree-sitter-ruby@0.23.1`: Ruby symbol extraction (class, module, method) — peerDep ^0.21.1 covers 0.25.0; live-tested.

**New kinds added to SymbolKind:**
- `'module'` — Ruby modules (distinct from class, analogous to TS namespace)
- `'struct'` — Go structs (distinct from class)

**Explicitly avoided:**
- ts-morph: 235ms startup overhead, breaks per-file incremental model, ~13MB dep. Name-based resolution at INFERRED 0.8 confidence is sufficient for v1.7 agent queries.
- Recursive CTEs: transitive call graphs are Out of Scope per PROJECT.md. Simple JOIN on `symbol_dependencies` is all that's needed.

### Expected Features

**Table stakes (must ship in v1.7):**
- Python symbol extraction — `function_definition` + `async_function_definition`, `class_definition`, `decorated_definition` (decorator-aware startLine). `isExport` via `_` prefix convention.
- Go symbol extraction — `function_declaration`, `method_declaration`, `type_declaration` (struct/interface/alias), `const_declaration` via tree-sitter-go@0.25.0. `isExport` via uppercase-first-char.
- Ruby symbol extraction — `method`, `singleton_method`, `class`, `module` via tree-sitter-ruby@0.23.1. No `attr_accessor` synthesis. All classes/modules exported by default.
- `symbol_dependencies` table — schema with dual indexes on `caller_symbol_id` and `callee_symbol_id`.
- TS/JS call-site edge extraction — `call_expression` walk in existing `extractRicherEdges()`; same-file and imported-call resolution; confidence 1.0 for resolved, silent discard for unresolvable.
- `find_callers` MCP tool — `{items, total, truncated?}` envelope with `maxItems`, self-loop filtered at query time.
- `find_callees` MCP tool — same table, reversed query; ships with `find_callers` at negligible cost.
- Per-language `kv_state` bulk-extract gates — separate keys for Python, Go, Ruby, and call-site edges; NOT a reuse of `symbols_bulk_extracted`.

**Differentiators (high value, not blockers):**
- `unresolvedCount` in `find_callers` response — honest signal for agents ("2 confirmed callers, 3 unresolved")
- Cross-file call resolution via `imported_names` from `file_dependencies` (already populated in v1.6)
- Go `const` block extraction (multi-line `const (...)`) — affects correctness of Go constant symbols

**Deferred to v1.8+:**
- Python/Go/Ruby call-site edges — `symbol_dependencies` schema and `find_callers` tool are defined in v1.7 with TS/JS data; v1.8 extends with other languages
- Python `isAsync` metadata column
- Python `__all__` for precise exportedness
- Ruby visibility modifier tracking (`private`/`protected`)

**Explicit anti-features (do not implement):**
- `attr_accessor` / `attr_reader` / `attr_writer` as Ruby symbols — synthesized at runtime, not in AST
- Method calls on unknown receivers in call-site edges — requires type inference
- `get_call_graph(scope)` multi-hop tool — agents hallucinate on large graph dumps; one-hop compose is sufficient
- `decorator` as a symbol kind in Python — decorators are metadata on the decorated symbol, not definitions

### Architecture Approach

v1.7 extends the existing v1.6 extraction pipeline with a three-way dispatch in `coordinator.ts` (TS/JS | Python+Go+Ruby | other), a new `extractLangFileParse()` function in `language-config.ts` that mirrors `extractTsJsFileParse()`, and a call-expression second pass over the already-parsed AST in `extractRicherEdges()`. All extraction remains single-pass per file (no second `parser.parse()` call). The `symbol_dependencies` table is managed exclusively through `repository.ts` following Pattern 3 (Repository as DB Boundary). The `deleteFile()` transaction is extended from three-DELETE to five-step (materialize symbol IDs first, then four DELETEs) to prevent dangling call-site edges on file rename/unlink.

**Modified components:**
1. `src/db/schema.ts` — adds `symbol_dependencies` table definition
2. `src/language-config.ts` — adds `extractLangFileParse()`, extends Python/Go/Ruby extractors to return `Symbol[]`
3. `src/change-detector/ast-parser.ts` — extends `extractRicherEdges()` return type with `callSiteEdges[]`
4. `src/coordinator.ts` — extends pass-2 dispatch to three-way if/else
5. `src/db/repository.ts` — extends `deleteFile()` cascade; adds `setCallSiteEdges()`, `getCallers()`, `getCallees()`
6. `src/mcp-server.ts` — registers `get_callers` and `get_callees` tools

**New components:**
1. `drizzle/XXXX_symbol_dependencies.sql` — migration file
2. `src/migrate/bulk-multilang-symbol-extract.ts` — flag-gated backfill for Python/Go/Ruby symbols
3. `src/migrate/bulk-call-site-extract.ts` — flag-gated backfill for TS/JS call-site edges (runs after multilang gate)

### Critical Pitfalls

1. **`symbols.id` FK instability in `symbol_dependencies`** (Pitfall 7 — CRITICAL) — `upsertSymbols` uses DELETE-then-INSERT, so autoincrement IDs reset on every file re-scan. Any `symbol_dependencies` rows referencing old IDs become silently dangling. Resolution: `setCallSiteEdges()` must participate in the same transaction as `upsertSymbols`, deleting and re-inserting `symbol_dependencies` for the file atomically. Do NOT use natural key (`caller_path, caller_name`) as FK substitute — the chosen approach is integer IDs with atomic same-transaction replacement.

2. **Performance regression** (Pitfall 13 — ROADMAP-SHAPING) — v1.6 baseline is +13.75% over v1.5 (2085ms self-scan). v1.7 adds three language extractors plus a call-expression pass. Bench-scan baseline (`v1.7-baseline.json`) must be captured as the first deliverable of Phase 36, before any extraction code lands. Each phase must verify self-scan stays below 20% above this new baseline. If the threshold is approached, call-site resolution must be made lazy or background before shipping.

3. **Python `async_function_definition` is a separate AST node type** (Pitfall 1) — Naive visitors that handle only `function_definition` silently drop all `async def` functions. Handle both node types with identical logic in the Python extractor visitor.

4. **Go regex misses method declarations and generic receivers** (Pitfall 4) — Now resolved: use `tree-sitter-go@0.25.0` for symbol extraction (D-06 reversed). The grammar handles `method_declaration` and generic receivers correctly. Regex stays only for edge extraction (`resolveGoImports`).

5. **`symbol_dependencies` cascade incomplete on file unlink** (Pitfall 18) — The v1.6 `deleteFile()` three-DELETE transaction does not include `symbol_dependencies`. Must be extended to a five-step operation (materialize symbol IDs first, then DELETE from `symbol_dependencies` using those IDs, then the existing three DELETEs). Regression test in `watcher-symbol-lifecycle.test.ts` must assert `symbol_dependencies` is empty after unlink.

6. **`/gsd-verify-work` skipped for the fifth consecutive milestone** (Pitfall 19 — PROCESS) — VERIFICATION.md has been generated retroactively across v1.3, v1.4, v1.5, and v1.6. For v1.7, VERIFICATION.md is a phase exit gate, not an optional artifact. Phase closure requires a VERIFICATION.md citing test file + describe block + test name for each REQUIREMENTS.md entry.

---

## Implications for Roadmap

### Cross-Cutting Flags (Pre-Phase — Resolve Before Planning)

These are contradictions and reversals identified across research files that must be resolved in REQUIREMENTS.md, not deferred to implementation:

**FLAG-01 — D-06 Reversed (STACK vs. PROJECT.md):**
`tree-sitter-go@0.25.0` is now stable with the correct peerDep. STACK.md explicitly reverses D-06 and recommends the grammar for Go symbol extraction. FEATURES.md still shows the D-06 regex path (written before STACK.md was completed). ARCHITECTURE.md and PROJECT.md still reference D-06 as active. The roadmap must treat D-06 as reversed: `tree-sitter-go@0.25.0` for symbol extraction, regex stays only for `extractGoEdges()`. No ARCHITECTURE.md or PITFALLS.md items for Go regex symbol extraction are relevant.

**FLAG-02 — CRITICAL: `symbol_dependencies` FK Design Contradiction:**
ARCHITECTURE.md and STACK.md both propose `(caller_symbol_id, callee_symbol_id)` integer FK design referencing `symbols.id`. PITFALLS.md (Pitfall 7) demonstrates this is silently broken because `symbols.id` is reset on every file re-scan. These sources cannot both be correct. Resolution: use the integer FK design (ARCHITECTURE.md and STACK.md) BUT delete and re-insert `symbol_dependencies` rows atomically within the same transaction as `upsertSymbols()`. The `setEdgesAndSymbols()` function must be extended to also clear and re-populate `symbol_dependencies` for the file, using the fresh IDs, in a single `sqlite.transaction()` closure. This is the ARCHITECTURE.md Pattern 2 (Atomic Per-File Write) applied to the new table. Do not use natural key as FK.

**FLAG-03 — Ruby Approach (ARCHITECTURE.md conservative vs. STACK.md/FEATURES.md):**
ARCHITECTURE.md (written before STACK.md completed) recommends Ruby stay at `symbols: []` as a conservative default, citing uncertainty about `tree-sitter-ruby` npm availability. STACK.md subsequently confirmed `tree-sitter-ruby@0.23.1` loads cleanly against `tree-sitter@0.25.0` via live test. FEATURES.md lists Ruby as table stakes. Resolution: Ruby ships via `tree-sitter-ruby@0.23.1` AST extraction in v1.7. ARCHITECTURE.md's Anti-Pattern 4 (regex Ruby extraction) and its "Ruby deferred" recommendation are superseded by STACK.md's live validation.

---

### Phase 36: Schema Migration + Multi-Language Symbols

**Rationale:** All call-site edge work depends on `symbol_dependencies` table existing (schema migration must be first) and on symbol IDs being present in the DB for all languages (multi-lang extraction must precede call-site backfill). These two concerns belong together because the migration is trivial and symbols for new languages are additive to the existing `symbols` table — `find_symbol` immediately benefits. Phase can ship and be validated independently with zero call-site risk.

**First deliverable (before any extraction code):** Run bench-scan and save `v1.7-baseline.json`. This is the performance comparison point for all subsequent phases.

**Delivers:**
- `v1.7-baseline.json` performance snapshot
- `symbol_dependencies` table migration (schema only; no data)
- `extractLangFileParse()` exported from `language-config.ts`
- Python symbol extraction: `function_definition` + `async_function_definition` (both), `class_definition`, `decorated_definition` with decorator-aware `startLine`; top-level only; `isExport` via `_` prefix
- Go symbol extraction: `function_declaration`, `method_declaration`, `type_declaration` (struct/interface/alias), `const_declaration` via `tree-sitter-go@0.25.0`; `isExport` via uppercase
- Ruby symbol extraction: `method`, `singleton_method`, `class`, `module` via `tree-sitter-ruby@0.23.1`; no `attr_accessor`; all classes/modules exported
- Three-way coordinator dispatch (TS/JS | Python+Go+Ruby | other)
- Per-language `kv_state` bulk-extract gates (three new keys, not reusing v1.6 key)
- Bulk backfill module `src/migrate/bulk-multilang-symbol-extract.ts`
- `SymbolKind` extended with `'module'` and `'struct'`
- `npm install tree-sitter-go tree-sitter-ruby`

**Avoids:**
- Pitfall 1 (Python async): handle both `function_definition` and `async_function_definition`
- Pitfall 2 (Python decorator startLine): use `decorated_definition` parent for startLine, inner node for name
- Pitfall 3 (Python nested methods): visit only direct children of root `module` node
- Pitfall 13 (performance baseline missing): baseline captured first, before code lands
- Pitfall 14 (double parse): single-pass invariant enforced; grep-source test added
- Pitfall 17 (kv_state gate reuse): separate per-language keys
- Pitfall 5 (Ruby metaprogramming): no `attr_accessor` synthesis; document limitation in tool description
- Pitfall 6 (Ruby reopened classes): accept multi-result behavior; document in tool description

**Research flag:** No additional research needed. STACK.md has live-verified grammar compatibility; ARCHITECTURE.md has direct codebase inspection for all integration points.

---

### Phase 37: TS/JS Call-Site Edge Extraction

**Rationale:** Isolated to a single data system (new `symbol_dependencies` table) with known dependencies (TS/JS symbols from v1.6, multi-lang symbols from Phase 36). Call-site extraction introduces the highest technical risk of the milestone: a second AST pass, a DB lookup per file during extraction, and a new invalidation dimension (callee-side deletion). Keeping this isolated from Phase 36 means the multi-language symbol work is unaffected if this phase has issues. MCP surface is kept out of this phase so the data contract can be validated before it's exposed to agents.

**Delivers:**
- Extended `extractRicherEdges()` returning `callSiteEdges: CallSiteEdge[]` — second pass over already-parsed AST (no second `parser.parse()`)
- Call-site resolution algorithm: same-file (localSymbolIndex lookup), imported (importedSymbolIndex from batch DB query on `imported_names`), silent discard for unresolvable
- Ambiguity handling: barrel files discarded silently; same-name-multiple-imports resolved by import specifier; self-loops stored but will be filtered at query time
- Extended `setEdgesAndSymbols()` accepting optional `callSiteEdges?`, clearing and re-inserting `symbol_dependencies` in the same `sqlite.transaction()` — this resolves FLAG-02
- Extended `deleteFile()` to five-step cascade: materialize symbol IDs → DELETE symbol_dependencies (source AND target) → DELETE file_dependencies → DELETE symbols → DELETE files
- `setCallSiteEdges()` and `getCallers()` / `getCallees()` repository functions in `repository.ts`
- `src/migrate/bulk-call-site-extract.ts` — flag-gated; checks `multilang_symbols_bulk_extracted` gate before running; re-parses all TS/JS files and populates `symbol_dependencies`
- Performance verification: self-scan must remain below 20% above `v1.7-baseline.json`

**Avoids:**
- FLAG-02: FK design contradiction resolved by atomic transaction-scoped ID replacement
- Pitfall 7 (symbols.id instability): `symbol_dependencies` cleared and re-inserted in same transaction as symbol upsert
- Pitfall 8 (incremental invalidation scope): deletes both `caller_path` and `callee_path` sides on file change
- Pitfall 9 (dangling resolution pollution): reject-silently approach; only insert HIGH-confidence resolved edges
- Pitfall 10 (same-name over-matching): resolution uses import specifier + symbol name, not name alone
- Pitfall 11 (barrel files): no re-export chain following; discard silently when target is a barrel
- Pitfall 13 (performance regression): second pass is over existing in-memory AST tree (no second `parser.parse()`); importedSymbolIndex built once per file (batch query), not per call expression
- Pitfall 18 (symbol_dependencies not in unlink cascade): five-step cascade implemented; regression test in `watcher-symbol-lifecycle.test.ts`

**Research flag:** No additional research needed. ARCHITECTURE.md has detailed pseudocode for the resolution algorithm and transaction patterns. PITFALLS.md has explicit invalidation scope guidance.

---

### Phase 38: MCP Surface

**Rationale:** Pure I/O surface — no new data extraction, no new schema. Kept last so the data contract from Phase 37 is stable and validated before locking the tool API shape. The `find_callers` / `find_callees` response shapes are the external contract for agents and should not be changed after shipping.

**Delivers:**
- `get_callers` tool registration in `src/mcp-server.ts`: `name` (required), `filePath` (optional disambiguator), `maxItems` (default 50); response `{items, total, truncated?}` with self-loop filter (`WHERE caller_path != callee_path OR caller_name != callee_name`); `confidence` per item; `unresolvedCount` field
- `get_callees` tool registration: same shape, reversed query; ships with `get_callers`
- Repository query `getCallers(name, filePath?, limit)` and `getCallees()` — JOIN on `symbol_dependencies` + `symbols` + `files`; callee index on `callee_symbol_id` required
- Tool descriptions updated to document Ruby metaprogramming limitation (`attr_accessor` not indexed) and Ruby reopened-class multi-result behavior
- MCP transport integration tests for both tools via InMemoryTransport (consistent with v1.5 coverage pattern)
- Contract test asserting `{items, total, truncated?}` envelope and `maxItems` clamping behavior

**Avoids:**
- Pitfall 12 (self-loop in find_callers results): WHERE filter applied at query time, not at storage time
- Pitfall 16 (find_callers response bloat): `{items, total, truncated?}` envelope with `maxItems` default 50; items are minimal shape `{path, name, kind, startLine, confidence}` not full symbol objects
- Pitfall 5 and 6 (Ruby limitations undocumented): tool description explicitly states limitations

**Research flag:** No additional research needed. Tool shapes are fully specified in FEATURES.md and ARCHITECTURE.md. MCP registration pattern is established from v1.5/v1.6.

---

### Phase 39: Audit and Deferred Item Closure

**Rationale:** PITFALLS.md (Pitfall 20) identifies 7 historical quick-task artifacts deferred at v1.6 close that have not been resolved. Deferred items older than 2 milestones must be formally closed or accepted as won't-fix with a documented reason. A dedicated audit phase prevents STATE.md from accumulating unbounded debt.

**Delivers:**
- Formal closure of the 7 historical deferred quick-task items (delete incomplete dirs or write minimal SUMMARY files)
- STATE.md Deferred Items table at v1.7 close has no more entries than at v1.6 close
- Milestone close artifacts: RETROSPECTIVE.md, updated PROJECT.md, archived research

---

### Phase Ordering Rationale

- Schema migration must precede all extraction because `symbol_dependencies` table must exist before call-site data can be written.
- Multi-language symbols (Phase 36) must precede call-site backfill (Phase 37) because cross-file call resolution from TS/JS into Python/Go/Ruby files requires their symbols to be in the DB. The Phase 37 flag gate enforces this ordering at boot.
- MCP surface (Phase 38) is last so the data contract from Phase 37 can be validated in isolation before the tool API is locked.
- Audit/closure (Phase 39) is last so it captures the full milestone's deferred items.
- Performance baseline is the first deliverable within Phase 36, not a separate phase, because it is a one-command operation that produces a file.

### Milestone-Level Process Requirements

These are not phase tasks — they are required across every phase in v1.7:

- **`/gsd-verify-work` is a phase exit gate.** VERIFICATION.md citing test file + describe block + test name for each REQUIREMENTS.md entry must exist before phase closure. No retroactive generation at milestone close.
- **Performance monitoring.** Each phase must verify self-scan wall time against `v1.7-baseline.json`. Threshold: must not exceed 20% above baseline. If approaching threshold, stop and profile before shipping further extraction code.
- **Single-pass invariant.** Grep-source test must confirm no language extractor calls `parser.parse()` more than once per invocation. This test ships in Phase 36 and remains in the suite for all subsequent phases.

### Research Flags

Phases needing deeper research during planning:
- **None.** All four research files are grounded in direct codebase inspection and live grammar verification. The implementation has sufficient detail in ARCHITECTURE.md to write REQUIREMENTS.md without additional research cycles.

Phases with standard patterns (skip research-phase):
- **Phase 36:** Multi-language symbol extraction follows the v1.6 TS/JS extractor pattern exactly. ARCHITECTURE.md has direct codebase pseudocode.
- **Phase 37:** Call-site resolution algorithm is specified in detail in ARCHITECTURE.md and STACK.md. Pitfall mitigations are fully enumerated in PITFALLS.md.
- **Phase 38:** MCP tool registration follows the v1.5 registerTool() pattern. Tool shapes are specified in FEATURES.md.
- **Phase 39:** Audit and closure is a process task, not a technical one.

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All claims live-verified: `npm view tree-sitter-go` + `npm view tree-sitter-ruby` confirmed versions and peerDeps; parse tests run in `/tmp` environments; ts-morph startup benchmarked at 235ms |
| Features | HIGH | Grounded in LSP 3.17 spec, official tree-sitter grammar docs, and competitor analysis (code-graph-mcp, roam-code, Sourcegraph). Export conventions for Python/Go/Ruby are well-established and deterministic. |
| Architecture | HIGH | All claims based on direct inspection of project source (`schema.ts`, `repository.ts`, `language-config.ts`, `ast-parser.ts`, `coordinator.ts`, `mcp-server.ts`). Pseudocode matches actual code patterns. |
| Pitfalls | HIGH | Critical pitfalls verified against actual source code (e.g., `upsertSymbols` DELETE-then-INSERT confirmed in `repository.ts`). Performance numbers are measured, not estimated. |

**Overall confidence:** HIGH

### Gaps to Address

- **`symbol_dependencies` confidence field value for cross-file edges:** STACK.md proposes 0.8 for cross-file resolved edges; FEATURES.md proposes 1.0 for "same-file resolved" and 0.8 for "cross-file resolved." These are consistent. The REQUIREMENTS.md should lock these values explicitly so tests can assert them.
- **Go `var_declaration` decision:** STACK.md excludes `var_declaration` as "low query value." FEATURES.md also excludes it. Consistent. Not a gap.
- **Ruby `constant` extraction:** FEATURES.md mentions extracting Ruby constants (`assignment` where lhs is `constant` node). STACK.md does not include `constant` extraction for Ruby. ARCHITECTURE.md does not address it. Low complexity to add (one node type), but REQUIREMENTS.md should explicitly scope it in or out to avoid ambiguity during implementation.
- **`find_callers` tool name:** FEATURES.md uses `find_callers` / `find_callees`. ARCHITECTURE.md uses `get_callers` / `get_callees`. REQUIREMENTS.md must pick one naming convention. Recommendation: use `find_callers` / `find_callees` for consistency with the existing `find_symbol` naming pattern.

---

## Sources

### Primary (HIGH confidence)

**STACK.md (live-verified):**
- `npm view tree-sitter-go` — version 0.25.0, peerDep `^0.25.0` (2026-04-23)
- `npm view tree-sitter-ruby` — version 0.23.1, peerDep `^0.21.1` (2026-04-23)
- Live parse test: `tree-sitter-ruby@0.23.1` + `tree-sitter@0.25.0` — confirmed load + parse without errors
- Live parse test: `tree-sitter-go@0.25.0` — confirmed `function_declaration`, `method_declaration`, `type_declaration`, `const_declaration`
- Live ts-morph startup benchmark: 235ms import in `/tmp/test-tsmorph`
- Codebase: `src/change-detector/ast-parser.ts`, `src/language-config.ts`, `src/db/schema.ts`, `src/db/repository.ts`

**ARCHITECTURE.md (direct codebase inspection):**
- `src/language-config.ts` — registry, `extractTsJsFileParse()`, `extractEdges()`, extractor functions
- `src/change-detector/ast-parser.ts` — `extractRicherEdges()`, `RicherEdgeData`, `ImportMeta`
- `src/db/schema.ts` — `symbols`, `file_dependencies`, `kv_state` table definitions
- `src/db/repository.ts` — `deleteFile()`, `setEdgesAndSymbols()`, `upsertSymbols()`, `findSymbols()`
- `src/coordinator.ts` lines 740–788 — pass-2 dispatch pattern
- `src/migrate/bulk-symbol-extract.ts` — flag-gated bulk extract pattern

**PITFALLS.md (source-verified):**
- `schema.ts` line 56: `integer('id').primaryKey({ autoIncrement: true })` — confirms autoincrement behavior
- `repository.ts` line 933: `upsertSymbols` DELETE-then-INSERT pattern confirmed
- `ast-parser.symbols.test.ts` line 47: decorator startLine test confirming v1.6 precedent

### Secondary (MEDIUM confidence)

**FEATURES.md:**
- LSP 3.17 Specification — SymbolKind enum (official spec, HIGH)
- tree-sitter Code Navigation docs — standard kinds confirmed (HIGH)
- code-graph-mcp, roam-code, Serena tool shape analysis (MEDIUM — GitHub inspection)
- GitHub stack-graphs blog + archived repo (MEDIUM — confirmed archived Sept 2025)
- Sorbet `attr_accessor` heuristics documentation (HIGH — official Sorbet docs)

---

## Cross-Cutting Theme Summary

For quick reference by the roadmapper:

| Theme | Finding | Phase Impact |
|-------|---------|--------------|
| D-06 reversed | `tree-sitter-go@0.25.0` now stable; use for symbol extraction; regex stays for edges | Phase 36: install `tree-sitter-go`, write Go symbol extractor via AST, not regex |
| Ruby ships in v1.7 | `tree-sitter-ruby@0.23.1` live-tested; FEATURES.md lists Ruby as table stakes | Phase 36: Ruby included; ARCHITECTURE.md conservative recommendation superseded |
| FK design contradiction RESOLVED | Use integer IDs but clear+re-insert `symbol_dependencies` atomically with `upsertSymbols` | Phase 37: `setEdgesAndSymbols` extended; single transaction for symbols + call-site edges |
| Performance is roadmap-shaping | v1.6 at +13.75%; 15% soft threshold; 20% hard stop | Phase 36 starts with bench-scan; each phase verifies regression; Phase 37 uses in-memory AST (no second parse) |
| `/gsd-verify-work` is a gate | 4 consecutive milestones skipped; VERIFICATION.md must exist before phase close | Every phase: VERIFICATION.md is exit criterion, not optional artifact |
| Phase split: ARCHITECTURE.md wins | FEATURES.md recommends A+B two-phase; ARCHITECTURE.md recommends 36/37/38 three-phase | Adopt ARCHITECTURE.md's three-phase split; isolates MCP surface risk separately |

---

*Research completed: 2026-04-23*
*Ready for roadmap: yes*
