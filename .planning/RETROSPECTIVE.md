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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 9 | 19 | Established audit-before-ship pattern |

### Cumulative Quality

| Milestone | Tests | Requirements | Verified |
|-----------|-------|-------------|----------|
| v1.0 | 180 | 28 | 28/28 (100%) |

### Top Lessons (Verified Across Milestones)

1. Milestone audit before shipping catches integration issues that phase-level testing misses
2. Verification documentation should be part of implementation, not a separate phase
