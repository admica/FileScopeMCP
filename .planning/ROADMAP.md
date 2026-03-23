# Roadmap: FileScopeMCP

## Milestones

- ✅ **v1.0 Autonomous File Metadata** — Phases 1-9 (shipped 2026-03-19)
- ✅ **v1.1 Hardening** — Phases 10-15 (shipped 2026-03-20)
- 🚧 **v1.2 LLM Broker** — Phases 16-19 (in progress)

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

### v1.2 LLM Broker (In Progress)

**Milestone Goal:** Standalone broker process that coordinates LLM access across multiple FileScopeMCP instances through importance-based priority ordering, replacing per-instance direct Ollama calls.

- [x] **Phase 16: Broker Core** — Standalone broker process: Unix socket server, in-memory priority queue, sequential Ollama worker, PID guard, graceful shutdown, and esbuild entry point (completed 2026-03-22)
- [x] **Phase 17: Instance Client + Pipeline Wiring** — broker-client.ts with submitJob() as unified LLM entry point, config migration, reconnection, startup resubmission, and coordinator lifecycle wiring (completed 2026-03-22)
- [x] **Phase 18: Cleanup** — Drop legacy llm_jobs/llm_runtime_state tables, delete pipeline.ts and rate-limiter.ts, remove dead job CRUD from repository.ts, and strip isExhausted threading (completed 2026-03-22)
- [ ] **Phase 19: Observability** — Update get_llm_status to report broker connection state, queue depth, in-progress job, and per-repo token totals from ~/.filescope/stats.json

## Phase Details

### Phase 16: Broker Core
**Goal**: A standalone broker binary exists that instances can connect to — it accepts job submissions over a Unix domain socket, prioritizes them by importance, and processes them one at a time through Ollama
**Depends on**: Phase 15
**Requirements**: BROKER-01, BROKER-02, BROKER-03, BROKER-04, BROKER-05, BROKER-06, BROKER-07, BROKER-08, BROKER-09, BROKER-10, BROKER-11, BROKER-12
**Success Criteria** (what must be TRUE):
  1. Running `node dist/broker.js` starts a process that creates ~/.filescope/broker.sock and ~/.filescope/broker.pid; a second invocation detects the running broker and exits without clobbering the socket
  2. A client connecting and submitting two jobs for the same (repoPath, filePath, jobType) results in only one job being processed — the second submission replaces the first if still pending
  3. A job that takes longer than 120 seconds is aborted and the submitting client receives an error response; the broker continues processing the next job immediately
  4. When the broker receives SIGTERM or SIGINT it finishes the in-progress job (or aborts after timeout), closes all client connections, removes broker.sock and broker.pid, and exits cleanly
  5. When a client connection closes, all pending jobs submitted by that connection are dropped from the queue
**Plans:** 2/2 plans complete
Plans:
- [x] 16-01-PLAN.md — Foundation: broker types, config loader, and priority queue
- [x] 16-02-PLAN.md — Worker, server, main entry point, and esbuild wiring

### Phase 17: Instance Client + Pipeline Wiring
**Goal**: Instances communicate with the broker through a single submitJob() function that transparently routes to the broker when available, and all LLM callers use this new entry point; config no longer requires model details in instance config.json
**Depends on**: Phase 16
**Requirements**: CLIENT-01, CLIENT-02, CLIENT-03, CLIENT-04, CLIENT-05, PIPE-01, CONF-01, CONF-02, CONF-03
**Success Criteria** (what must be TRUE):
  1. cascade-engine.ts and llm-diff-fallback.ts call submitJob() with no direct reference to insertLlmJobIfNotPending() or the LLM pipeline — a single code change in broker-client.ts controls LLM routing for all callers
  2. When the broker is running, an instance connects on startup and all LLM jobs flow through the socket; when the broker is not running, the instance logs a connection failure and operates without LLM processing (no crash, no retry loop blocking startup)
  3. After a broker disconnect, the instance automatically reconnects every 10 seconds; jobs accumulated in the local stale-file list are resubmitted to the broker on each successful reconnect
  4. Instance config.json with only `llm.enabled: true` (no model or provider fields) produces a working instance that processes LLM jobs through the broker
  5. toggle_llm MCP tool connects to or disconnects from the broker at runtime — calling it twice toggles the instance back to its original state
**Plans:** 2/2 plans complete
Plans:
- [x] 17-01-PLAN.md — Broker client module and config simplification
- [x] 17-02-PLAN.md — Wire callers, coordinator lifecycle, toggle_llm, esbuild

### Phase 18: Cleanup
**Goal**: All legacy local job queue infrastructure is gone — no llm_jobs or llm_runtime_state tables, no pipeline.ts polling loop, no TokenBudgetGuard gating, no dead job CRUD functions, no isExhausted parameter threading
**Depends on**: Phase 17
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05
**Success Criteria** (what must be TRUE):
  1. A fresh FileScopeMCP instance startup on an existing .filescope.db that contains llm_jobs or llm_runtime_state tables produces a DB without those tables — the migration runs automatically on init
  2. Importing coordinator.ts, cascade-engine.ts, or repository.ts in a TypeScript build produces no references to insertLlmJob, insertLlmJobIfNotPending, dequeueNextJob, markJobInProgress, markJobDone, markJobFailed, recoverOrphanedJobs, loadLlmRuntimeState, saveLlmRuntimeState, or isExhausted
  3. The files src/llm/pipeline.ts and src/llm/rate-limiter.ts do not exist in the repository; all existing tests pass with no import errors
**Plans:** 2/2 plans complete
Plans:
- [x] 18-01-PLAN.md — DB migration, schema cleanup, dead module deletion, repository surgery, test fixes
- [x] 18-02-PLAN.md — isExhausted parameter removal, comment cleanup, final verification

### Phase 19: Observability
**Goal**: Operators can query the broker's current state and token usage history through the existing get_llm_status MCP tool, which now reports broker-mode details including connection status, queue depth, active job, and lifetime per-repo token totals
**Depends on**: Phase 18
**Requirements**: OBS-01, OBS-02
**Success Criteria** (what must be TRUE):
  1. Calling get_llm_status while connected to a broker returns a response containing: mode "broker", brokerConnected true, the number of pending jobs in the broker queue, the currently processing job's file path (or null), and per-repo lifetime token counts read from ~/.filescope/stats.json
  2. Calling get_llm_status while the broker is not running returns mode "broker", brokerConnected false, and the last-known per-repo token totals (stale but present); the tool does not error or hang
**Plans:** 1/2 plans executed
Plans:
- [ ] 19-01-PLAN.md — Broker-side stats persistence and StatusResponse enrichment
- [ ] 19-02-PLAN.md — Client requestStatus(), coordinator getBrokerStatus(), MCP tool update

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
| 19. Observability | 1/2 | In Progress|  | - |
