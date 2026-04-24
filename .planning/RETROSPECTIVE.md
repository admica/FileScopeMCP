# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — Autonomous File Metadata

**Shipped:** 2026-03-19
**Phases:** 9 | **Plans:** 19

### What Was Built
- SQLite storage backend with transparent JSON migration
- Standalone coordinator + daemon mode for 24/7 operation
- AST-level semantic change detection (tree-sitter) with LLM diff fallback
- Cascade engine: BFS staleness propagation with per-field granularity
- Multi-provider background LLM pipeline (summaries, concepts, change impact)
- 180 tests, 28/28 requirements verified with test evidence

### What Worked
- Strict phase dependency chain (1-5 core, 6-9 gap closure) kept integration clean
- Early SQLite migration (Phase 1) unlocked all downstream features
- Milestone audit after Phase 7 caught 4 integration bugs and 18 verification gaps before shipping
- Code inspection as verification evidence for structural requirements (LLM-04, LLM-05, LLM-08) — pragmatic when tests would just re-assert source structure
- better-sqlite3 and tree-sitter via createRequire — consistent native addon strategy for ESM

### What Was Inefficient
- Phases 6-9 were all gap closure — audit revealed verification documentation wasn't being created during implementation phases
- Integration issues (toggle_llm sequencing, concepts/change_impact not exposed via MCP) could have been caught with integration tests during Phase 5
- SUMMARY.md format varied across phases — early phases lacked one_liner field, making automated extraction impossible

### Patterns Established
- VERIFICATION.md per phase citing test file + describe block + test name
- Traceability table in REQUIREMENTS.md mapping requirements to completion phases
- Phase-level audit before milestone completion catches integration gaps
- CJS-from-ESM via createRequire for native Node addons (better-sqlite3, tree-sitter)
- Raw better-sqlite3 prepared statements for performance-critical paths (staleness, cascade)

### Key Lessons
1. Create VERIFICATION.md during implementation phases, not as a separate phase after
2. Integration tests for cross-phase wiring should run as part of each phase's verification
3. MCP tool exposure should be checked whenever new data columns are written to the DB
4. Milestone audit is essential — without it, 4 integration bugs and verification gaps would have shipped

### Cost Observations
- Model mix: sonnet for execution agents, opus for orchestration
- Phase 1-5 core work: ~5 sessions across 2 days (Mar 2-3)
- Phase 6-9 gap closure: ~4 sessions across 2 days (Mar 18-19)
- Notable: Gap closure phases (6-9) were fast (~5 min/plan) because they were documentation and small fixes

---

## Milestone: v1.1 — Hardening

**Shipped:** 2026-03-20
**Phases:** 6 | **Plans:** 11

### What Was Built
- BFS transitive importance propagation with cycle safety
- .filescopeignore with full gitignore semantics
- Go and Ruby language support
- Streaming async directory scan with two-pass SQLite integration
- mtime-based lazy validation replacing polling integrity sweep
- Cycle detection via iterative Tarjan's SCC

### What Worked
- Small focused phases (1-2 plans each) shipped in 2 days
- Each phase was independent — minimal cross-phase dependencies
- Code quality phase (10) at the start cleaned up technical debt before adding features

### What Was Inefficient
- No retrospective entry was created — lesson learned retroactively

### Patterns Established
- Language support follows a consistent pattern: parser function + test file + integration into dependency resolver

### Key Lessons
1. Hardening milestones (code quality + language support + performance) are fast because phases are independent

---

## Milestone: v1.2 — LLM Broker

**Shipped:** 2026-03-23
**Phases:** 4 | **Plans:** 8

### What Was Built
- Standalone broker process with Unix socket IPC and in-memory priority queue
- Instance-side broker client with auto-spawn and reconnection
- Full legacy cleanup (dropped llm_jobs tables, deleted pipeline.ts, rate-limiter.ts)
- Per-repo token stats and broker status reporting via MCP tool

### What Worked
- 4-phase architecture (core → client → cleanup → observability) was a clean dependency chain
- Cleanup phase (18) as a dedicated step ensured no dead code lingered
- Broker prompt centralization simplified the instance dramatically

### What Was Inefficient
- No retrospective entry was created at milestone completion

### Patterns Established
- NDJSON over Unix domain socket for local IPC
- PID-guarded singleton processes with stale cleanup on startup
- Stats.json for persistent cross-session token accounting

### Key Lessons
1. Dedicated cleanup phase after major architectural changes (broker replacing local LLM pipeline) is worth the overhead
2. Auto-spawn pattern (first client spawns broker) eliminates "start the broker first" friction

---

## Milestone: v1.3 — Nexus

**Shipped:** 2026-04-03
**Phases:** 5 | **Plans:** 12

### What Was Built
- Fastify JSON API server with 2-level auto-discovery of FileScopeMCP repos
- Svelte 5 SPA with Vite + Tailwind dark mode, hash-based routing
- Two-panel code explorer: lazy file tree, file/directory detail panels
- Cytoscape.js interactive dependency graph with fcose layout and directory filtering
- System view: broker status, D3 token bar chart, SSE activity feed
- Visual polish: importance heat bars, staleness icons, navbar status dots, responsive layout
- Settings page with repo remove/blacklist/restore management

### What Worked
- 3-day build from scratch to polished dashboard — tight scope kept velocity high
- Read-only design eliminated write complexity (no auth, no transactions, no conflicts)
- Building on existing data (data.db, broker.sock, stats.json) meant zero new data infrastructure
- Phase-per-view structure (file tree → graph → system → polish) gave clear daily milestones
- Svelte 5 runes + snippets enabled clean reactive patterns without boilerplate

### What Was Inefficient
- No VERIFICATION.md for any phase — integration checker was used as substitute
- Stack decision changed mid-planning (htmx → Svelte 5) — initial planning docs referenced htmx
- STATE.md accumulated per-phase decisions that belonged in SUMMARY.md — became a wall of text

### Patterns Established
- Fastify factory pattern (createServer returns configured instance)
- Svelte 5 {#snippet} for recursive tree rendering
- $effect() with clear-then-redraw for D3 in Svelte 5
- SSE via reply.hijack() in Fastify with raw response headers
- Auto-discovery + blacklist as repo management model

### Key Lessons
1. Read-only dashboards over existing data are high-value/low-effort — no new daemon, no new protocol, just queries
2. Svelte 5 runes are a natural fit for reactive dashboards with rich state
3. Phase verification (VERIFICATION.md) should not be skipped even for fast milestones — the integration checker caught what phases missed
4. A 3-day milestone is achievable when scope is tight and data infrastructure already exists

### Cost Observations
- Model mix: sonnet for execution agents, opus for orchestration
- Sessions: ~8 across 3 days
- Notable: fastest milestone yet (3 days, 5 phases) despite being the most visible product

---

## Milestone: v1.4 — Deep Graph Intelligence

**Shipped:** 2026-04-09
**Phases:** 4 | **Plans:** 8

### What Was Built
- Schema migration adds edge_type, confidence, weight columns + file_communities table
- LanguageConfig registry with extractEdges() single entry point for all languages
- Tree-sitter AST extractors for Python, Rust, C/C++ replacing regex parsing
- TS/JS richer edge types (imports, re_exports, inherits) and edge weight aggregation
- Louvain community detection via graphology with dirty-flag cache
- get_communities MCP tool, enriched get_file_summary, maxItems token budget on list tools

### What Worked
- All 4 phases completed in a single day — tight linear dependency chain (schema→extractors→communities→polish)
- LanguageConfig registry pattern made Phase 26 plug-in trivial: add grammar + extractor, register in map
- setEdges() single writer with enriched columns ensured all paths write consistent edge metadata
- Dirty-flag cache for communities avoided premature optimization — Louvain only runs when edges change
- 19 parity tests (Phase 26) caught Python async bug and C/C++ path mismatch before they shipped

### What Was Inefficient
- No VERIFICATION.md for any phase — fourth milestone in a row where formal verification was skipped
- REQUIREMENTS.md traceability table never updated from Pending — all 18 requirements still unchecked despite being completed
- buildAstExtractor() scaffold created in Phase 25 was bypassed by Phase 26 — dead code shipped
- AST-05 (Go tree-sitter) claimed as completed in SUMMARY frontmatter but Go still uses regex — misleading

### Patterns Established
- LanguageConfig registry: Map<ext, { extract }> for O(1) dispatch per extension
- EdgeResult carries all metadata (confidence, edgeType, weight, isPackage) as a composable value
- Pure algorithm module pattern (community-detection.ts): data in, results out, no project imports
- Dirty-flag cache invalidation for expensive batch algorithms

### Key Lessons
1. Single-day milestones are achievable with a tight 4-phase linear chain and no cross-system integration
2. Registry patterns pay off immediately — Phase 26 added 4 languages by just plugging into the registry
3. VERIFICATION.md continues to be skipped — process needs to either be enforced or formally dropped
4. Requirement claims in SUMMARY frontmatter should be verified against actual implementation (AST-05 mismatch)

### Cost Observations
- Model mix: sonnet for execution agents, opus for orchestration
- Sessions: 1 session, single day
- Notable: fastest milestone ever (4 phases in <1 day) due to clean linear dependencies and no Nexus/UI work

---

## Milestone: v1.6 — Symbol-Level Intelligence

**Shipped:** 2026-04-23
**Phases:** 3 | **Plans:** 10

### What Was Built
- Symbol extraction during scan — TS/JS files populate a `symbols` SQLite table via a single-pass AST walk shared with edge extraction; migration-time bulk-extract gated by `kv_state` flag
- Import-name metadata on dependency edges — `imported_names` + `import_line` columns on `file_dependencies`, namespace imports record `*`
- Two new MCP tools: `find_symbol(name, kind?, exportedOnly=true, maxItems?)` (case-sensitive exact + trailing-`*` GLOB prefix, `{items, total, truncated?}` envelope) and `list_changed_since(since, maxItems?)` (dual ISO-8601 + git-SHA dispatch, DB intersection)
- `get_file_summary` enrichment — new `exports[]` field (sorted by startLine, isExport-filtered) and `dependents[]` upgraded from `string[]` to `[{path, importedNames, importLines}]`
- Watcher lifecycle for symbols — single-pass re-extract on change, transactional three-DELETE cascade on unlink, regression guard via `watcher-symbol-lifecycle.test.ts`
- `npm run inspect-symbols` CLI; 15th registered MCP tool (up from 13)
- 718 tests passing (+45 new on top of v1.5's 673); performance under 15% soft threshold

### What Worked
- Ruthless scope audit (2026-04-23) cut from 8 candidate features to 3 high-value tools — no bloat shipped
- Single-day build (2026-04-23, 40 commits) driven by a tight 3-phase linear chain (schema+parser → MCP surface → watcher+changed-since)
- Single-pass AST walk mandate for symbols + edges enforced early — PERF-02 passed comfortably (+13.75% self / +9.64% medium-repo vs Phase 33 baseline)
- Phase 34 restored VERIFICATION.md rigor (14/14 truths, 91 new passing tests) — first phase in v1.5+v1.6 to produce a formal verification artifact
- Bench-scan CLI (33-01) captured reproducible baseline + end metrics; `bench-end.json` vs `baseline.json` made PERF-02 a pure comparison
- Zod `z.coerce.boolean().default(true)` pattern for `find_symbol.exportedOnly` locked by grep-source test — regression guard against accidental default flip

### What Was Inefficient
- Phases 33 + 35 skipped `/gsd-verify-work` again — milestone close generated VERIFICATION.md retroactively from audit + test files
- REQUIREMENTS.md traceability table status column stayed "Pending" for all 30 REQ-IDs despite phases complete; checkboxes for 9 Phase-35 requirements never flipped during execution — both reconciled at milestone close
- Phase 35 plan SUMMARY files used body-level `**Requirements:**` line instead of frontmatter `requirements-completed:` (Phase 33 + 34 used frontmatter) — audit flagged the inconsistency
- SDK bug: `gsd-sdk query milestone.complete` passes empty args to `phasesArchive`, dropping the required version arg — workflow fell back to manual archival. Reported for v0.2.
- 7 historical quick-task dirs (from v1.0-v1.5) re-surfaced in `audit-open` at close — same deferred debt as v1.5 close; still unresolved

### Patterns Established
- `kv_state` table as a general-purpose one-shot migration gate (bulk-extract guarded by a single kv row)
- GLOB + bracket-escape as the case-sensitive prefix-match pattern for SQLite (no PRAGMA, no new indexes)
- Tool descriptions authored as `string[].join(' ')` so a length probe can regex-extract without JS eval
- Transactional three-DELETE cascade in `deleteFile()` — single `sqlite.transaction()` closure keeps `file_dependencies`, `symbols`, `files` coherent on unlink
- Single AST parse shared across multiple accumulators (edges + symbols + importMeta) — new invariant for all future language support

### Key Lessons
1. PERF baselines captured at Phase 1 pay off at Phase N — `baseline.json` + `bench-end.json` made PERF-02 trivially auditable
2. Scope audits that cut features before planning are cheaper than cutting during execution — the 2026-04-23 audit deleted 5 candidate tools from the wishlist
3. `/gsd-verify-work` continues to be skipped on fast-moving phases — retroactive VERIFICATION.md from audit + tests is an acceptable compensating control, but it hides the original intent rot
4. Ruthless cuts (TS/JS only, no deletion tombstones, no method-level symbols) shipped a focused milestone in one day; expanding later is cheap
5. Single-pass parser mandates need a grep-source test (like find_symbol's length probe) to prevent accidental double-parse regressions in future language support

### Cost Observations
- Model mix: opus-heavy orchestration, sonnet for execution agents
- Sessions: ~4 across 1 day (Apr 23)
- Notable: fastest milestone yet by day-count (1 day for 3 phases + 10 plans + 718-test run); 14K+ line diff driven largely by test files and fixtures

---

## Milestone: v1.7 — Multi-Lang Symbols + Call-Site Edges

**Shipped:** 2026-04-24
**Phases:** 4 | **Plans:** 8

### What Was Built
- Python/Go/Ruby symbol extractors via tree-sitter grammars (tree-sitter-go@0.25.0, tree-sitter-ruby@0.23.1); `find_symbol` returns symbols for all 5 supported languages
- TS/JS call-site edge extraction populating `symbol_dependencies` table — local calls at confidence 1.0, imported calls at 0.8, unresolvable silently discarded
- `find_callers` and `find_callees` MCP tools (tools 16-17) enabling agents to answer "who calls foo" via one-hop JOINs
- Five-step `deleteFile()` cascade cleaning both sides of `symbol_dependencies` atomically
- Bulk backfill pipeline: multi-lang symbols via three per-language kv_state gates → call-site edges with three-key precondition enforcement
- All 7 historical deferred quick-task items formally closed; STATE.md Deferred Items at zero
- 845+ tests passing; performance under 20% budget (actually improved −9.7% vs baseline)

### What Worked
- VERIFICATION.md as a mandatory phase exit gate for every phase (first milestone to enforce this consistently)
- Single-day build again (52 commits, 8,537 lines added) — tight 4-phase linear chain mirrors v1.6 velocity
- Three-key precondition gate on bulk call-site backfill enforced phase ordering at boot — no race conditions
- Post-audit fix (4acef8e) caught live scan callSiteEdges drop-bug — audit → fix → close cycle worked cleanly
- Per-language kv_state keys prevented false "already done" on partial backfill runs

### What Was Inefficient
- Audit run before the final fix (4acef8e) — audit reported `gaps_found` that were already being addressed in the same session
- Phase 36 ROADMAP.md showed "0/3 Not started" despite all 3 plans being complete — progress table not updated during execution
- `audit-open` tool false-positived on all 7 quick tasks despite them having SUMMARY.md files — naming convention mismatch in audit tool
- REQUIREMENTS.md traceability table started stale again (12 "Pending") — fixed in post-audit commit, same pattern as v1.6

### Patterns Established
- Per-language kv_state gates (`symbols_py_bulk_extracted`, etc.) for independent backfill sub-passes
- Three-key precondition checks on dependent migrations (call-site bulk requires all three symbol bulks)
- `CallSiteCandidate` → resolution → `CallSiteEdge` pipeline as the pattern for future language call-site support
- Confidence tiering: 1.0 same-file local, 0.8 imported cross-file, discard unresolvable — no intermediate guessing
- `callerStack` push/pop tracking nested function scope during AST walk

### Key Lessons
1. VERIFICATION.md as phase exit gate works — first milestone where every phase shipped one; no retroactive generation needed
2. Audit → fix → close cycle is healthy: run audit, fix gaps found, proceed to close — don't skip the audit even when confident
3. REQUIREMENTS.md traceability staleness is a recurring pattern (v1.5, v1.6, v1.7) — should be automated or checked by verification workflow
4. Post-audit integration fixes (live scan path, watcher path) validate that the audit catches real bugs, not just documentation gaps
5. D-06 reversal (Go from regex to tree-sitter) worked cleanly — grammar stability should be re-evaluated per-milestone, not treated as permanent decisions

### Cost Observations
- Model mix: opus for orchestration, sonnet for execution agents
- Sessions: ~3 across 1 day (Apr 24)
- Notable: second consecutive single-day milestone; 4 phases + 8 plans + 845 tests in ~5 hours

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Days | Key Change |
|-----------|--------|-------|------|------------|
| v1.0 | 9 | 19 | 17 | Established audit-before-ship pattern |
| v1.1 | 6 | 11 | 2 | Independent phases, no cross-phase deps |
| v1.2 | 4 | 8 | 4 | Dedicated cleanup phase after architecture change |
| v1.3 | 5 | 12 | 3 | Integration checker as verification substitute |
| v1.4 | 4 | 8 | 1 | Registry pattern enables single-day multi-language milestone |
| v1.5 | 4 | 11 | 6 | Protocol-layer tests + zero-config auto-registration |
| v1.6 | 3 | 10 | 1 | Ruthless scope audit → 3 high-value tools, single-day ship |
| v1.7 | 4 | 8 | 1 | VERIFICATION.md enforced as phase exit gate; call-site edges |

### Cumulative Quality

| Milestone | Tests | Requirements | Verified |
|-----------|-------|-------------|----------|
| v1.0 | 180 | 28 | 28/28 (100%) |
| v1.1 | 220+ | 7 | via audit |
| v1.2 | 250+ | 12 | via audit |
| v1.3 | 250+ | 35 | 35/35 via integration checker |
| v1.4 | 260+ | 18 | 17/18 + 1 accepted deviation (AST-05) |
| v1.5 | 673 | 21 | 20/21 (BRKR-04 partial, see audit) |
| v1.6 | 718 | 30 | 30/30 via audit + retroactive VERIFICATION.md |
| v1.7 | 845+ | 17 | 17/17 — VERIFICATION.md per phase (first fully gate-enforced milestone) |

### Top Lessons (Verified Across Milestones)

1. Milestone audit before shipping catches integration issues that phase-level testing misses
2. Verification documentation should be part of implementation, not a separate phase — skipping it keeps showing up as tech debt at milestone close (v1.3, v1.4, v1.5, v1.6)
3. Read-only dashboards over existing data are high-value/low-effort (v1.3)
4. Dedicated cleanup phases after major architecture changes prevent dead code accumulation (v1.2)
5. Fast milestones (1-3 days) are achievable when scope is tight and phases are independent or linear (v1.1, v1.3, v1.4, v1.6)
6. Ruthless scope audits that cut features before planning are cheaper than cutting during execution (v1.6 — 8 candidates → 3)
7. PERF baselines captured at Phase 1 of a milestone make end-of-milestone regression checks trivial (v1.6)
8. Single-pass invariants (one AST parse, shared accumulators) need grep-source tests to survive future language expansion (v1.6)
9. VERIFICATION.md as phase exit gate works when enforced — v1.7 is the first milestone where every phase shipped one without retroactive generation (v1.7)
10. Audit → fix → close cycle is healthy and catches real integration bugs, not just doc gaps (v1.7 — live scan callSiteEdges drop, watcher path missing)
