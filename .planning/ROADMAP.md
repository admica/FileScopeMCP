# Roadmap: FileScopeMCP

## Milestones

- ✅ **v1.0 Autonomous File Metadata** — Phases 1-9 (shipped 2026-03-19)
- ✅ **v1.1 Hardening** — Phases 10-15 (shipped 2026-03-20)
- ✅ **v1.2 LLM Broker** — Phases 16-19 (shipped 2026-03-23)
- ✅ **v1.3 Nexus** — Phases 20-24 (shipped 2026-04-03)
- ✅ **v1.4 Deep Graph Intelligence** — Phases 25-28 (shipped 2026-04-09)
- ✅ **v1.5 Production-Grade MCP Intelligence Layer** — Phases 29-32 (shipped 2026-04-23)
- ✅ **v1.6 Symbol-Level Intelligence** — Phases 33-35 (shipped 2026-04-23)
- 📋 **v1.7** — TBD (run `/gsd-new-milestone` to scope)

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

### 📋 v1.7 (Planned)

Next milestone to be scoped. Run `/gsd-new-milestone` to define goals, requirements, and phases.

Top candidates from v1.6 scope audit (priority order, see memory `project_v1_7_candidates.md`):

1. Multi-language symbol extraction (Python/Go/Ruby) — pending v1.6 adoption signal
2. Symbol-level dependency edges — call-site resolution (`who calls foo`)
3. Deletion tombstones on `list_changed_since` — enable `deleted_files` tracking

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
