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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Days | Key Change |
|-----------|--------|-------|------|------------|
| v1.0 | 9 | 19 | 17 | Established audit-before-ship pattern |
| v1.1 | 6 | 11 | 2 | Independent phases, no cross-phase deps |
| v1.2 | 4 | 8 | 4 | Dedicated cleanup phase after architecture change |
| v1.3 | 5 | 12 | 3 | Integration checker as verification substitute |
| v1.4 | 4 | 8 | 1 | Registry pattern enables single-day multi-language milestone |

### Cumulative Quality

| Milestone | Tests | Requirements | Verified |
|-----------|-------|-------------|----------|
| v1.0 | 180 | 28 | 28/28 (100%) |
| v1.1 | 220+ | 7 | via audit |
| v1.2 | 250+ | 12 | via audit |
| v1.3 | 250+ | 35 | 35/35 via integration checker |
| v1.4 | 260+ | 18 | 17/18 + 1 accepted deviation (AST-05) |

### Top Lessons (Verified Across Milestones)

1. Milestone audit before shipping catches integration issues that phase-level testing misses
2. Verification documentation should be part of implementation, not a separate phase
3. Read-only dashboards over existing data are high-value/low-effort (v1.3)
4. Dedicated cleanup phases after major architecture changes prevent dead code accumulation (v1.2)
5. Fast milestones (2-3 days) are achievable when scope is tight and phases are independent (v1.1, v1.3)
