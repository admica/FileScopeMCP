# Roadmap: FileScopeMCP

## Milestones

- ✅ **v1.0 Autonomous File Metadata** — Phases 1-9 (shipped 2026-03-19)
- ✅ **v1.1 Hardening** — Phases 10-15 (shipped 2026-03-20)
- ✅ **v1.2 LLM Broker** — Phases 16-19 (shipped 2026-03-23)
- ✅ **v1.3 Nexus** — Phases 20-24 (shipped 2026-04-03)
- ✅ **v1.4 Deep Graph Intelligence** — Phases 25-28 (shipped 2026-04-09)
- 🚧 **v1.5 Production-Grade MCP Intelligence Layer** — Phases 29-32 (in progress)

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

### 🚧 v1.5 Production-Grade MCP Intelligence Layer (In Progress)

**Milestone Goal:** Make FileScopeMCP bulletproof and zero-config for LLM agents — comprehensive testing, MCP spec compliance, and hardened lifecycle management.

- [x] **Phase 29: Broker Lifecycle Hardening** - Eliminate crash cleanup gaps and spawn timing races in the broker (completed 2026-04-17)
- [x] **Phase 30: MCP Spec Compliance** - Migrate tool registration to current SDK API and fix false capability declarations (completed 2026-04-17)
- [ ] **Phase 31: Test Infrastructure** - Close the protocol-layer test gap with transport, lifecycle, and subsystem tests
- [ ] **Phase 32: Zero-Config Auto-Registration** - Replace broken install script with `.mcp.json` and CLI-based registration

## Phase Details

### Phase 29: Broker Lifecycle Hardening
**Goal**: The broker cleans up its socket and PID file on any exit path and starts reliably under load
**Depends on**: Phase 28 (previous milestone complete)
**Requirements**: BRKR-01, BRKR-02, BRKR-03, BRKR-04, BRKR-05
**Success Criteria** (what must be TRUE):
  1. Broker liveness check passes only when BOTH the PID is alive AND the socket file exists — a stale PID from a recycled OS process does not prevent respawn
  2. Sending SIGKILL to the broker leaves no orphaned socket or PID file behind
  3. Broker accepts new connections only after draining all in-progress jobs on graceful SIGTERM shutdown
  4. MCP server startup succeeds reliably on a loaded machine — broker socket existence is polled rather than a fixed sleep
  5. Attempting to start a second concurrent broker instance produces a clear error message rather than silent failure
**Plans:** 2/2 plans complete
Plans:
- [x] 29-01-PLAN.md — Config schema extension + main.ts liveness fix, crash handlers, shutdown wiring
- [x] 29-02-PLAN.md — Server drain timeout + client spawn poll loop

### Phase 30: MCP Spec Compliance
**Goal**: All MCP tools are registered via the current SDK API with correct annotations and truthful capability declarations
**Depends on**: Phase 28 (previous milestone complete — independent of Phase 29)
**Requirements**: SPEC-01, SPEC-02, SPEC-03, SPEC-04
**Success Criteria** (what must be TRUE):
  1. All 13+ tools are registered via `registerTool()` with `z.object()` input schemas — no `server.tool()` calls remain
  2. The `tools: { listChanged: true }` capability is removed or backed by an actual `sendToolListChanged()` call — MCP clients that cache tool lists get correct behavior
  3. Read-only tools carry `readOnlyHint: true` and the destructive tool carries `destructiveHint: true` per the MCP 2025-11-25 spec
  4. Tool error responses return structured `{ ok: false, error: "CODE", message: "..." }` objects that LLM agents can parse programmatically
**Plans:** 2/2 plans complete
Plans:
- [x] 30-01-PLAN.md — Migrate all 13 tools to registerTool() with annotations, enriched descriptions, and structured error/success responses
- [x] 30-02-PLAN.md — Update test file assertions from server.tool( to server.registerTool( pattern

### Phase 31: Test Infrastructure
**Goal**: Protocol-layer and subsystem test gaps are closed; CI catches regressions before they reach agents
**Depends on**: Phase 29 and Phase 30
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06, TEST-07, TEST-08, TEST-09
**Success Criteria** (what must be TRUE):
  1. MCP tool calls dispatched through `InMemoryTransport` pass for all 13 tools — protocol-layer coverage exists where none did before
  2. Broker lifecycle tests cover spawn, connect, SIGTERM cleanup, and crash recovery against the actual hardened binary
  3. File watcher debounce, ignore patterns, and event dispatch are verified via mocked chokidar — no real filesystem waits in tests
  4. `npm run coverage` produces a V8 coverage report with per-subsystem gap identification
  5. A CI smoke test asserts the first byte emitted by `dist/mcp-server.js` is `{` — stdout pollution is caught at CI time
**Plans:** 3 plans
Plans:
- [ ] 31-01-PLAN.md — Export registerTools, scope V8 coverage config, MCP transport tests for all 13 tools
- [ ] 31-02-PLAN.md — Broker lifecycle integration tests and stdout pollution smoke test
- [ ] 31-03-PLAN.md — File watcher unit tests, config loading tests, cascade/change-detector gap audit

### Phase 32: Zero-Config Auto-Registration
**Goal**: Cloning the repo and running `npm run build` is sufficient for Claude Code to discover FileScopeMCP with no manual JSON editing
**Depends on**: Phase 29, Phase 30, Phase 31
**Requirements**: ZERO-01, ZERO-02, ZERO-03
**Success Criteria** (what must be TRUE):
  1. `.mcp.json` committed at project root causes Claude Code to auto-discover the server on clone without any additional setup steps
  2. Running `npm run register-mcp` completes successfully using `claude mcp add` CLI and `claude mcp list` confirms registration — no writes to `~/.claude.json`
  3. Setup documentation reflects the new registration flow and a developer following it from scratch reaches a working installation without manual JSON editing
**Plans**: TBD

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
| 29. Broker Lifecycle Hardening | v1.5 | 2/2 | Complete    | 2026-04-17 |
| 30. MCP Spec Compliance | v1.5 | 2/2 | Complete    | 2026-04-17 |
| 31. Test Infrastructure | v1.5 | 0/3 | Not started | - |
| 32. Zero-Config Auto-Registration | v1.5 | 0/TBD | Not started | - |
