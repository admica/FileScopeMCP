# Roadmap: FileScopeMCP

## Milestones

- ✅ **v1.0 Autonomous File Metadata** — Phases 1-9 (shipped 2026-03-19)
- ✅ **v1.1 Hardening** — Phases 10-15 (shipped 2026-03-20)
- ✅ **v1.2 LLM Broker** — Phases 16-19 (shipped 2026-03-23)
- ✅ **v1.3 Nexus** — Phases 20-24 (shipped 2026-04-03)
- ✅ **v1.4 Deep Graph Intelligence** — Phases 25-28 (shipped 2026-04-09)
- ✅ **v1.5 Production-Grade MCP Intelligence Layer** — Phases 29-32 (shipped 2026-04-23)
- ✅ **v1.6 Symbol-Level Intelligence** — Phases 33-35 (shipped 2026-04-23)
- 📋 **v1.7 Multi-Lang Symbols + Call-Site Edges** — Phases 36-39 (in planning)

## Phases

<details>
<summary>✅ v1.0 Autonomous File Metadata (Phases 1-9) — SHIPPED 2026-03-19</summary>

- [x] Phase 1: SQLite Storage (3/3 plans) — completed 2026-03-02
- [x] Phase 2: Coordinator + Daemon Mode (2/2 plans) — completed 2026-03-03
- [x] Phase 3: Semantic Change Detection (2/2 plans) — completed 2026-03-18
- [x] Phase 4: Cascade Engine + Staleness (2/2 plans) — completed 2026-03-18
- [x] Phase 5: LLM Processing Pipeline (3/3 plans) — completed 2026-03-18
- [x] Phase 6: Verification & Tech Debt Cleanup (2/2 plans) — completed 2026-03-18
- [x] Phase 7: Fix change_impact Pipeline (1/1 plan) — completed 2026-03-18
- [x] Phase 8: Integration Fixes (2/2 plans) — completed 2026-03-19
- [x] Phase 9: Verification Documentation (2/2 plans) — completed 2026-03-19

See: `.planning/milestones/v1.0-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.1 Hardening (Phases 10-15) — SHIPPED 2026-03-20</summary>

- [x] Phase 10: Code Quality and Bug Fixes — completed 2026-03-19
- [x] Phase 11: .filescopeignore Support — completed 2026-03-19
- [x] Phase 12: Go and Ruby Language Support — completed 2026-03-19
- [x] Phase 13: Streaming Directory Scan — completed 2026-03-20
- [x] Phase 14: mtime-Based Lazy Validation — completed 2026-03-20
- [x] Phase 15: Cycle Detection — completed 2026-03-20

See: `.planning/milestones/v1.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.2 LLM Broker (Phases 16-19) — SHIPPED 2026-03-23</summary>

- [x] Phase 16: Broker Core (2/2 plans) — completed 2026-03-22
- [x] Phase 17: Instance Client + Pipeline Wiring (2/2 plans) — completed 2026-03-22
- [x] Phase 18: Cleanup (2/2 plans) — completed 2026-03-22
- [x] Phase 19: Observability (2/2 plans) — completed 2026-03-23

See: `.planning/milestones/v1.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.3 Nexus (Phases 20-24) — SHIPPED 2026-04-03</summary>

- [x] Phase 20: Server Skeleton + Repo Discovery (3/3 plans) — completed 2026-04-01
- [x] Phase 21: File Tree + Detail Panel (2/2 plans) — completed 2026-04-02
- [x] Phase 22: Dependency Graph (2/2 plans) — completed 2026-04-02
- [x] Phase 23: System View + Live Activity (2/2 plans) — completed 2026-04-02
- [x] Phase 24: Polish (3/3 plans) — completed 2026-04-03

See: `.planning/milestones/v1.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.4 Deep Graph Intelligence (Phases 25-28) — SHIPPED 2026-04-09</summary>

- [x] Phase 25: Schema Foundation + LanguageConfig Scaffolding (2/2 plans) — completed 2026-04-09
- [x] Phase 26: Multi-Language Tree-sitter Extraction (2/2 plans) — completed 2026-04-09
- [x] Phase 27: Community Detection (2/2 plans) — completed 2026-04-09
- [x] Phase 28: MCP Polish (2/2 plans) — completed 2026-04-09

See: `.planning/milestones/v1.4-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.5 Production-Grade MCP Intelligence Layer (Phases 29-32) — SHIPPED 2026-04-23</summary>

- [x] Phase 29: Broker Lifecycle Hardening (2/2 plans) — completed 2026-04-17
- [x] Phase 30: MCP Spec Compliance (2/2 plans) — completed 2026-04-17
- [x] Phase 31: Test Infrastructure (3/3 plans) — completed 2026-04-18
- [x] Phase 32: Zero-Config Auto-Registration (4/4 plans) — completed 2026-04-22

See: `.planning/milestones/v1.5-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.6 Symbol-Level Intelligence (Phases 33-35) — SHIPPED 2026-04-23</summary>

- [x] Phase 33: Symbol Extraction Foundation (5/5 plans) — completed 2026-04-23
- [x] Phase 34: Symbol-Aware MCP Surface (2/2 plans) — completed 2026-04-23
- [x] Phase 35: Changed-Since Tool + Watcher Integration (3/3 plans) — completed 2026-04-23

See: `.planning/milestones/v1.6-ROADMAP.md` for full phase details.

</details>

### 📋 v1.7 Multi-Lang Symbols + Call-Site Edges (In Planning)

**Milestone Goal:** Extend symbol-level intelligence to Python/Go/Ruby and upgrade TS/JS dependency edges from file-granular to call-site-granular so agents can answer "who calls foo".

**Milestone-Level Rules (apply to every phase in v1.7):**
- VERIFICATION.md is a phase exit gate. Each phase ships a VERIFICATION.md citing test file + describe block + test name for each REQUIREMENTS.md entry it satisfies. No retroactive generation at milestone close.
- Each phase verifies self-scan wall time stays below 20% above `v1.7-baseline.json`. If approaching threshold, stop and profile before adding more extraction code.
- Single-pass invariant: no language extractor calls `parser.parse()` more than once per invocation. Grep-source test enforces this across all phases.

**Phase Summary:**

- [x] **Phase 36: Schema Migration + Multi-Language Symbols** (3/3 plans) — completed 2026-04-24
- [x] **Phase 37: TS/JS Call-Site Edge Extraction** (2/2 plans) — completed 2026-04-24
- [x] **Phase 38: MCP Surface** - Register `find_callers` + `find_callees` tools, InMemoryTransport integration tests, lock the data contract (completed 2026-04-24)
- [ ] **Phase 39: Deferred-Item Closure** - Formal closure of 7 historical quick-task artifacts; STATE.md Deferred Items table reaches zero entries

## Phase Details

### Phase 36: Schema Migration + Multi-Language Symbols
**Goal**: Establish the v1.7 performance baseline, migrate the `symbol_dependencies` schema, and extend symbol extraction to Python, Go, and Ruby so `find_symbol` returns symbols for all three languages.
**Depends on**: Phase 35 (v1.6 complete)
**Requirements**: PERF-03, MLS-01, MLS-02, MLS-03, MLS-04, MLS-05, CSE-01
**Success Criteria** (what must be TRUE):
  1. `v1.7-baseline.json` bench-scan snapshot exists and was captured before any extraction code landed in this phase
  2. Scanning a Python file populates the `symbols` table with top-level `function` (both `def` and `async def` emit `kind='function'` — no separate `async function` kind in v1.7; `isAsync` metadata deferred to v1.8 per MLS-META-01) and `class` symbols; `find_symbol` returns them
  3. Scanning a Go file populates the `symbols` table with `function`, `method`, `struct`, `interface`, `type` (alias), and `const` symbols via `tree-sitter-go@0.25.0`; multi-line `const (...)` blocks emit one symbol per `const_spec`; `find_symbol` returns them
  4. Scanning a Ruby file populates the `symbols` table with `method`, `singleton_method`, `class`, `module`, and top-level `constant` (via `assignment` where lhs is `constant`) symbols via `tree-sitter-ruby@0.23.1`; `find_symbol` returns them
  5. The `symbol_dependencies` table exists in the schema (empty — no data yet); existing repos backfill Python/Go/Ruby symbols via per-language `kv_state` gates (`symbols_py_bulk_extracted`, `symbols_go_bulk_extracted`, `symbols_rb_bulk_extracted`) on next boot
**Plans:** 3 plans

Plans:
- [ ] 36-01-PLAN.md — Perf baseline (`v1.7-baseline.json` via edited `scripts/bench-scan.mjs` OUT_PATH — Pitfall A) + `symbol_dependencies` Drizzle schema + SQL migration 0006 + `migration-0006.test.ts` + `SymbolKind` += `'module'` / `'struct'` + `npm install tree-sitter-go@0.25.0 tree-sitter-ruby@0.23.1`
- [ ] 36-02-PLAN.md — Inline Python/Go/Ruby symbol extractors in `src/language-config.ts` (colocated with existing edge extractors) + `goParser`/`rubyParser` singletons + `extractLangFileParse()` export + three-way coordinator pass-2 dispatch + `find_symbol` description update (Ruby `attr_accessor` / reopened-class bullets, `module`/`struct` kind list)
- [ ] 36-03-PLAN.md — `src/migrate/bulk-multilang-symbol-extract.ts` (three independent sub-passes, gates `symbols_py_bulk_extracted` / `symbols_go_bulk_extracted` / `symbols_rb_bulk_extracted` — Pitfall 17 guard) + coordinator startup wiring + permanent `src/change-detector/single-pass-invariant.test.ts` (grep-source + brace-walk, regex `/parser\.parse\(/g`) + `36-VERIFICATION.md` phase exit gate

**Cross-cutting notes:**
- PERF-03 baseline must be the very first action of 36-01, before any new code lands.
- D-06 is reversed: `tree-sitter-go@0.25.0` is used for Go symbol extraction; `resolveGoImports` regex stays for edge extraction only.
- Python: handle both `function_definition` and `async_function_definition` (separate AST node types). Take `startLine` from `decorated_definition` parent, not inner `function_definition`. Visit only direct children of root `module` node — no nested methods.
- Go: `isExport` via uppercase-first-char. `const (...)` multi-line blocks emit one symbol per `const_spec`. Adds `'struct'` to `SymbolKind`.
- Ruby: no `attr_accessor` synthesis. Adds `'module'` to `SymbolKind`. All classes/modules/methods treated as exported. Document `attr_accessor` limitation and reopened-class multi-result behavior in `find_symbol` description.
- Per-language `kv_state` keys: `symbols_py_bulk_extracted`, `symbols_go_bulk_extracted`, `symbols_rb_bulk_extracted` — do NOT reuse `symbols_bulk_extracted` from v1.6.

### Phase 37: TS/JS Call-Site Edge Extraction
**Goal**: Populate `symbol_dependencies` for all TS/JS files by extending `extractRicherEdges()` with a call-expression resolution pass, wiring the results into the atomic per-file transaction, and extending `deleteFile()` to a five-step cascade.
**Depends on**: Phase 36 (schema exists, Python/Go/Ruby symbols in DB for cross-file resolution)
**Requirements**: CSE-02, CSE-03, CSE-04, CSE-05, CSE-06
**Success Criteria** (what must be TRUE):
  1. After scanning a TS/JS file, `symbol_dependencies` contains rows for resolvable same-file and cross-file call sites (confidence 1.0); unresolvable calls are silently discarded
  2. After a file is unlinked, `SELECT COUNT(*) FROM symbol_dependencies WHERE caller_symbol_id IN (SELECT id FROM symbols WHERE path = ?)` returns 0 (five-step cascade verified)
  3. After editing a TS/JS file and re-scanning it, `symbol_dependencies` rows for that file reflect the current state — no stale edges from the prior scan
  4. Self-scan wall time remains below 20% above `v1.7-baseline.json`; call-site resolution uses a single batch DB query per file (not one query per call expression)
**Plans:** 2 plans

Plans:
- [x] 37-01-PLAN.md — `CallSiteCandidate` + `CallSiteEdge` interfaces in `src/change-detector/types.ts`; extend `extractRicherEdges()` with `callerStack` push/pop and `callSiteCandidates` emission (no new `parser.parse()`); extend `extractTsJsFileParse()` with `localSymbolIndex` + `importedSymbolIndex` resolution (conf 1.0 local / 0.8 imported / silent discard; Pitfall 10 ambiguity defense; Pitfall 11 barrel discard; single batch DB query chunked at 500); extend `setEdgesAndSymbols()` with optional `callSiteEdges?` — caller-side DELETE + per-edge INSERT inside existing `sqlite.transaction()` (FLAG-02 resolution); colocated test files `ast-parser.call-sites.test.ts`, `language-config.call-sites.test.ts`, `repository.call-sites.test.ts`
- [x] 37-02-PLAN.md — Extend `deleteFile()` to five-step cascade (materialize symbol IDs → both-sides DELETE `symbol_dependencies` → DELETE `file_dependencies` → DELETE `symbols` → DELETE `files` — ordering load-bearing, D-21); new `src/file-watcher.watcher-symbol-lifecycle.test.ts` regression (unlink cascade + callee-side cross-file cleanup + change caller-side clear); `src/migrate/bulk-call-site-extract.ts` gated on `call_site_edges_bulk_extracted`, three-key precondition check (`symbols_py_bulk_extracted` AND `symbols_go_bulk_extracted` AND `symbols_rb_bulk_extracted` — no unified gate exists in Phase 36); coordinator startup wiring after `runMultilangSymbolsBulkExtractionIfNeeded`; `37-VERIFICATION.md` phase exit gate citing test + describe + test-name per CSE-02..06 + perf budget line

**Cross-cutting notes:**
- The call-expression pass walks the already-parsed in-memory AST — no second `parser.parse()` call. This resolves Pitfall 14 for this phase.
- FLAG-02 resolution: `setEdgesAndSymbols()` extended to include `symbol_dependencies` DELETE+INSERT in the same `sqlite.transaction()` closure. IDs are always fresh when edges are written.
- Resolution uses import specifier + symbol name (not name alone) to prevent over-matching on same-name symbols across files (Pitfall 10).
- Barrel files are discarded silently — no re-export chain following (Pitfall 11).
- `symbols.id` FK instability is resolved by atomic transaction-scoped ID replacement (Pitfall 7). Do not use natural key as FK substitute.
- Bulk backfill (`CSE-06`) enforces phase ordering at boot: aborts if ANY of the three Phase 36 per-language gates (`symbols_py_bulk_extracted`, `symbols_go_bulk_extracted`, `symbols_rb_bulk_extracted`) is unset. No unified `multilang_symbols_bulk_extracted` key exists — Phase 37 must check all three individually (verified in 37-RESEARCH.md §Item 7).

### Phase 38: MCP Surface
**Goal**: Register `find_callers` and `find_callees` MCP tools via `registerTool()`, backed by repository helpers that JOIN `symbol_dependencies`, and ship InMemoryTransport integration tests that lock the response contract.
**Depends on**: Phase 37 (data in `symbol_dependencies` is stable and validated)
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04
**Success Criteria** (what must be TRUE):
  1. `find_callers(name, filePath?, maxItems?)` returns `{ok: true, items: [{path, name, kind, startLine, confidence}], total, truncated?, unresolvedCount}` with self-loops excluded from results
  2. `find_callees(name, filePath?, maxItems?)` returns the same envelope shape, reversed query
  3. `maxItems` is clamped to `[1, 500]` with a default of 50; responses exceeding the limit include `truncated: true`
  4. Tool descriptions document Ruby `attr_accessor` limitation and reopened-class multi-result behavior
  5. InMemoryTransport integration tests cover both tools, asserting envelope shape and `maxItems` clamping (consistent with v1.5 coverage pattern)
**Plans:** 2/2 plans complete

Plans:
- [x] 38-01-PLAN.md — Repository helpers getCallers() + getCallees() in repository.ts + find_callers/find_callees tool registration in mcp-server.ts + unit tests
- [x] 38-02-PLAN.md — InMemoryTransport integration tests for both tools + 38-VERIFICATION.md phase exit gate

**Cross-cutting notes:**
- Tool names use `find_` prefix for consistency with existing `find_symbol` (not `get_` prefix — FLAG resolved in REQUIREMENTS.md).
- Self-loops filtered at query time with `WHERE caller_symbol_id != callee_symbol_id` (store self-loops in `symbol_dependencies`, exclude from results).
- `unresolvedCount` field provides honest signal: agents see how many call sites could not be resolved at extraction time.
- Response shape `{path, name, kind, startLine, confidence}` per item — no `endLine`, no full symbol object (Pitfall 16 prevention).
**UI hint**: no

### Phase 39: Deferred-Item Closure
**Goal**: Formally close all 7 historical quick-task artifacts deferred from v1.0-v1.5, leaving the STATE.md Deferred Items table at zero entries at v1.7 milestone close.
**Depends on**: Phase 38 (all v1.7 technical work complete)
**Requirements**: DEBT-01
**Success Criteria** (what must be TRUE):
  1. Each of the 7 deferred quick-task items has either a written SUMMARY.md (if the commit landed) or a documented wontfix reason in STATE.md
  2. STATE.md Deferred Items table has zero entries after this phase closes
  3. No new deferred items were added from v1.7 phases without a documented reason
**Plans**: 1 plan

Plans:
- [ ] 39-01-PLAN.md — Write b7k SUMMARY.md, verify 6 existing SUMMARYs, clear STATE.md Deferred Items table

**Cross-cutting notes:**
- Items to close: `1-update-readme-md-and-root-roadmap-md-to-`, `260323-kgd-auto-init-mcp-to-cwd-rename-set-project-`, `260324-0yz-comprehensive-documentation-update-readm`, `260401-a19-fix-double-change-impact-and-structured-ou`, `260401-b7k-fix-cpp-dependency-parsing-and-importance`, `260414-otc-make-sure-the-install-setup-scripts-of-t`, `260416-b8w-fix-nexus-tree-view-repo-store-queries-a`.
- Rule for v1.8+: deferred items older than 2 milestones must be formally closed or accepted as wontfix with a documented reason. No unbounded deferral.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. SQLite Storage | v1.0 | 3/3 | Complete | 2026-03-02 |
| 2. Coordinator + Daemon Mode | v1.0 | 2/2 | Complete | 2026-03-03 |
| 3. Semantic Change Detection | v1.0 | 2/2 | Complete | 2026-03-18 |
| 4. Cascade Engine + Staleness | v1.0 | 2/2 | Complete | 2026-03-18 |
| 5. LLM Processing Pipeline | v1.0 | 3/3 | Complete | 2026-03-18 |
| 6. Verification & Tech Debt | v1.0 | 2/2 | Complete | 2026-03-18 |
| 7. Fix change_impact Pipeline | v1.0 | 1/1 | Complete | 2026-03-18 |
| 8. Integration Fixes | v1.0 | 2/2 | Complete | 2026-03-19 |
| 9. Verification Documentation | v1.0 | 2/2 | Complete | 2026-03-19 |
| 10. Code Quality and Bug Fixes | v1.1 | 2/2 | Complete | 2026-03-19 |
| 11. .filescopeignore Support | v1.1 | 2/2 | Complete | 2026-03-19 |
| 12. Go and Ruby Language Support | v1.1 | 2/2 | Complete | 2026-03-19 |
| 13. Streaming Directory Scan | v1.1 | 2/2 | Complete | 2026-03-20 |
| 14. mtime-Based Lazy Validation | v1.1 | 1/1 | Complete | 2026-03-20 |
| 15. Cycle Detection | v1.1 | 2/2 | Complete | 2026-03-20 |
| 16. Broker Core | v1.2 | 2/2 | Complete | 2026-03-22 |
| 17. Instance Client + Pipeline Wiring | v1.2 | 2/2 | Complete | 2026-03-22 |
| 18. Cleanup | v1.2 | 2/2 | Complete | 2026-03-22 |
| 19. Observability | v1.2 | 2/2 | Complete | 2026-03-23 |
| 20. Server Skeleton + Repo Discovery | v1.3 | 3/3 | Complete | 2026-04-01 |
| 21. File Tree + Detail Panel | v1.3 | 2/2 | Complete | 2026-04-02 |
| 22. Dependency Graph | v1.3 | 2/2 | Complete | 2026-04-02 |
| 23. System View + Live Activity | v1.3 | 2/2 | Complete | 2026-04-02 |
| 24. Polish | v1.3 | 3/3 | Complete | 2026-04-03 |
| 25. Schema Foundation + LanguageConfig Scaffolding | v1.4 | 2/2 | Complete | 2026-04-09 |
| 26. Multi-Language Tree-sitter Extraction | v1.4 | 2/2 | Complete | 2026-04-09 |
| 27. Community Detection | v1.4 | 2/2 | Complete | 2026-04-09 |
| 28. MCP Polish | v1.4 | 2/2 | Complete | 2026-04-09 |
| 29. Broker Lifecycle Hardening | v1.5 | 2/2 | Complete | 2026-04-17 |
| 30. MCP Spec Compliance | v1.5 | 2/2 | Complete | 2026-04-17 |
| 31. Test Infrastructure | v1.5 | 3/3 | Complete | 2026-04-18 |
| 32. Zero-Config Auto-Registration | v1.5 | 4/4 | Complete | 2026-04-22 |
| 33. Symbol Extraction Foundation | v1.6 | 5/5 | Complete | 2026-04-23 |
| 34. Symbol-Aware MCP Surface | v1.6 | 2/2 | Complete | 2026-04-23 |
| 35. Changed-Since Tool + Watcher Integration | v1.6 | 3/3 | Complete | 2026-04-23 |
| 36. Schema Migration + Multi-Language Symbols | v1.7 | 0/3 | Not started | - |
| 37. TS/JS Call-Site Edge Extraction | v1.7 | 2/2 | Complete | 2026-04-24 |
| 38. MCP Surface | v1.7 | 2/2 | Complete    | 2026-04-24 |
| 39. Deferred-Item Closure | v1.7 | 0/1 | Not started | - |
