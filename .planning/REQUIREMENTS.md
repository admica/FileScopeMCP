# Requirements: FileScopeMCP v1.7 — Multi-Lang Symbols + Call-Site Edges

**Defined:** 2026-04-24
**Core Value:** LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

**Milestone focus:** Extend symbol-level intelligence to Python/Go/Ruby, and upgrade TS/JS dependency edges from file-granular to call-site-granular so agents can answer "who calls foo".

## v1.7 Requirements

### Performance Baseline (PERF)

- [ ] **PERF-03**: `v1.7-baseline.json` bench-scan snapshot is captured before any v1.7 extraction code lands. Acts as comparison point for all subsequent phases; each phase must verify self-scan stays below 20% above this baseline. Single-pass invariant enforced via grep-source test.

### Multi-Language Symbol Extraction (MLS)

- [ ] **MLS-01**: Python symbol extraction via `tree-sitter-python`: `function_definition` + `async_function_definition` (both node types), `class_definition`, `decorated_definition` with decorator-aware `startLine`. Top-level only. `isExport` via `_` prefix convention. Extends `SymbolKind` as needed.
- [ ] **MLS-02**: Go symbol extraction via `tree-sitter-go@0.25.0` (reverses v1.4 D-06): `function_declaration`, `method_declaration`, `type_declaration` (struct / interface / alias), `const_declaration`. `isExport` via uppercase-first-char. Multi-line `const (…)` blocks emit one symbol per `const_spec`. Adds `'struct'` to `SymbolKind`.
- [ ] **MLS-03**: Ruby symbol extraction via `tree-sitter-ruby@0.23.1`: `method`, `singleton_method`, `class`, `module`, and top-level `constant` assignments. No `attr_accessor` / `attr_reader` / `attr_writer` synthesis. All classes/modules/methods/constants treated as exported. Adds `'module'` to `SymbolKind`.
- [ ] **MLS-04**: `extractLangFileParse()` exported from `language-config.ts` and wired into coordinator pass-2 dispatch (TS/JS | Python+Go+Ruby | other). `find_symbol` returns the new-language symbols with no tool changes.
- [ ] **MLS-05**: `src/migrate/bulk-multilang-symbol-extract.ts` backfills existing repos via per-language `kv_state` gate keys (new keys, no reuse of v1.6 `symbols_bulk_extracted`).

### Call-Site Edge Schema + Extraction (CSE)

- [ ] **CSE-01**: New `symbol_dependencies` table: `id` autoincrement, `caller_symbol_id` (FK → symbols.id), `callee_symbol_id` (FK → symbols.id), `call_line`, `confidence`. Dual indexes on both FK columns.
- [ ] **CSE-02**: TS/JS `call_expression` AST pass extends `extractRicherEdges()` and returns `callSiteEdges: CallSiteEdge[]`. Walks already-parsed AST — no second `parser.parse()`.
- [ ] **CSE-03**: Resolution algorithm: same-file calls via in-memory `localSymbolIndex` (confidence 1.0); imported calls via `importedSymbolIndex` from batch DB query on `imported_names` (confidence 0.8); unresolvable calls silently discarded. TS/JS only — other-lang call-site edges deferred to v1.8.
- [ ] **CSE-04**: `setEdgesAndSymbols()` in `repository.ts` accepts optional `callSiteEdges?` and clears+re-inserts `symbol_dependencies` rows in the SAME `sqlite.transaction()` as `upsertSymbols()`. Resolves FLAG-02 (symbol.id instability across re-scan).
- [ ] **CSE-05**: `deleteFile()` extended to five-step transaction: materialize symbol IDs → DELETE symbol_dependencies (source OR target) → DELETE file_dependencies → DELETE symbols → DELETE files. Regression test in `watcher-symbol-lifecycle.test.ts` asserts `symbol_dependencies` empty after `unlink`.
- [ ] **CSE-06**: `src/migrate/bulk-call-site-extract.ts` backfills existing repos flag-gated on `call_site_edges_bulk_extracted`; the gate checks `multilang_symbols_bulk_extracted` is set first (enforces phase ordering at boot).

### MCP Surface (MCP)

- [x] **MCP-01**: `find_callers(name, filePath?, maxItems?)` registered via `registerTool()` with `ToolAnnotations`. Response `{ok: true, items: [{path, name, kind, startLine, confidence}], total, truncated?, unresolvedCount}`. `maxItems` clamp `[1, 500]` default 50. Self-loops filtered at query time. Repository helper `getCallers()` JOINs symbol_dependencies + symbols + files.
- [x] **MCP-02**: `find_callees(name, filePath?, maxItems?)` — same table, reversed query, same envelope, repository helper `getCallees()`.
- [x] **MCP-03**: Tool descriptions document Ruby limitations (`attr_accessor` not indexed; reopened-class multi-result behavior).
- [x] **MCP-04**: MCP transport integration tests via `InMemoryTransport` cover `find_callers` + `find_callees`, asserting envelope shape and `maxItems` clamping (consistent with v1.5 coverage pattern).

### Deferred-Item Closure (DEBT)

- [x] **DEBT-01**: Formal closure of the 7 historical deferred quick-task items listed in STATE.md — each gets a minimal SUMMARY.md written (if commit landed) or is marked wontfix with a documented reason. STATE.md Deferred Items table at v1.7 close: zero entries.

## Milestone-Level Rules (not counted requirements; apply across every phase)

- **Performance:** Each phase verifies self-scan wall time stays below 20% above `v1.7-baseline.json`. If approaching threshold, stop and profile before shipping further extraction code.
- **VERIFICATION gate:** Each phase ships with a `VERIFICATION.md` citing test file + describe block + test name for each requirement it satisfies. No retroactive generation at milestone close. `/gsd-verify-work` is a phase exit gate. (Addresses 4-milestone skip pattern.)
- **Single-pass invariant:** No language extractor calls `parser.parse()` more than once per invocation. Grep-source test enforces.

## v1.8+ Requirements (Deferred)

### Multi-Language Call-Site Edges
- **CSE-LANG-01**: Python call-site edge extraction
- **CSE-LANG-02**: Go call-site edge extraction
- **CSE-LANG-03**: Ruby call-site edge extraction

### Symbol Metadata Enrichment
- **MLS-META-01**: Python `isAsync` metadata column on symbols
- **MLS-META-02**: Python `__all__` for precise exportedness
- **MLS-META-03**: Ruby visibility modifiers (`private`/`protected`) — runtime-only, needs control-flow tracking

### Performance
- **PERF-06**: Claw back v1.6 +13.75% self-scan regression (only if stacked v1.7 cost forces it)

### Rough Edges
- **CHG-06**: Deletion tombstones on `list_changed_since` — retention-bounded tombstone table

## Out of Scope

| Feature | Reason |
|---------|--------|
| `attr_accessor` / `attr_reader` / `attr_writer` as Ruby symbols | Synthesized at runtime, not in AST. Storing would be false data. |
| Method calls on unknown receivers in call-site edges | Requires full type inference / type system — explicitly Out of Scope per PROJECT.md. |
| Dynamic dispatch resolution (interface/class method on unknown receiver) | Same as above. |
| `get_call_graph(scope)` multi-hop tool | Agents hallucinate on large graph dumps; one-hop compose via `find_callers` + `find_callees` is sufficient. |
| `decorator` as a Python symbol kind | LSP 3.17 and all major tools treat decorators as metadata, not standalone definitions. |
| Re-export transitive call-site resolution (barrel files) | Parser complexity not justified; discard silently when target is a barrel. |
| Recursive CTEs for transitive call graphs | Transitive call graphs Out of Scope per PROJECT.md. Simple JOIN suffices. |
| Go `var_declaration` symbols | Low query value per STACK.md + FEATURES.md. |
| Python nested-class / nested-method symbols | Top-level only — visit direct children of root `module` node. |
| ts-morph / TypeScript Language Service for call-site resolution | 235ms startup overhead, ~13MB dep, breaks per-file incremental model. Name-based resolution at 0.8 confidence is sufficient. |
| Tool renaming (`get_*` prefix) | `find_callers` / `find_callees` chosen for consistency with existing `find_symbol`. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PERF-03 | Phase 36 | Pending |
| MLS-01 | Phase 36 | Pending |
| MLS-02 | Phase 36 | Pending |
| MLS-03 | Phase 36 | Pending |
| MLS-04 | Phase 36 | Pending |
| MLS-05 | Phase 36 | Pending |
| CSE-01 | Phase 36 | Pending |
| CSE-02 | Phase 37 | Pending |
| CSE-03 | Phase 37 | Pending |
| CSE-04 | Phase 37 | Pending |
| CSE-05 | Phase 37 | Pending |
| CSE-06 | Phase 37 | Pending |
| MCP-01 | Phase 38 | Complete |
| MCP-02 | Phase 38 | Complete |
| MCP-03 | Phase 38 | Complete |
| MCP-04 | Phase 38 | Complete |
| DEBT-01 | Phase 39 | Complete |

**Coverage:**
- v1.7 requirements: 17 total
- Mapped to phases: 17 ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-24*
*Last updated: 2026-04-24 — traceability table filled after ROADMAP.md created for v1.7*
