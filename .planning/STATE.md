---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: LLM Broker
status: unknown
stopped_at: Completed 17-01-PLAN.md
last_updated: "2026-03-22T16:24:30.333Z"
last_activity: 2026-03-22
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 4
  completed_plans: 3
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-21)

**Core value:** LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.
**Current focus:** Phase 17 — instance-client-pipeline-wiring

## Current Position

Phase: 17 (instance-client-pipeline-wiring) — EXECUTING
Plan: 1 of 2

## Performance Metrics

**Velocity:**

- Total plans completed: 0 (v1.2)
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 16. Broker Core | — | — | — |

*Updated after each plan completion*
| Phase 16-shared-llm-queue P01 | 8 | 3 tasks | 3 files |
| Phase 16-shared-llm-queue P02 | 3 | 3 tasks | 4 files |
| Phase 17-instance-client-pipeline-wiring P01 | 2 | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Key v1.2 architectural decisions (logged in PROJECT.md Key Decisions table):

- **Standalone broker over leader election** — separate process, clean separation of concerns
- **In-memory queue over shared SQLite** — broker is a service; jobs are transient
- **Unix domain socket over TCP/HTTP** — local-only, no port conflicts, fast IPC
- **Broker builds prompts** — centralizes all LLM interaction; avoids Zod serialization
- **No dual-mode fallback** — broker is the only LLM path; direct Ollama mode removed
- [Phase 16-shared-llm-queue]: dedupKey exported as runtime function from types.ts so queue.ts can import without circular dependency
- [Phase 16-shared-llm-queue]: PriorityQueue.size returns dedupMap.size not heap.length — dedup map is authoritative active count
- [Phase 16-shared-llm-queue]: loadBrokerConfig is async-shaped but internally synchronous — startup sequencing is sequential before async work
- [Phase 16-shared-llm-queue]: dist/broker/main.js is the correct broker binary path — esbuild mirrors src/broker/ structure under dist/
- [Phase 16-shared-llm-queue]: Re-throw AbortError before structured output fallback prevents timeout confusion in broker worker (Pitfall 5)
- [Phase 17-01]: LLMConfig now has only enabled?: boolean — all model/provider/token fields removed from instance config
- [Phase 17-01]: resubmitStaleFiles uses raw SQL getSqlite().prepare() to match staleness query patterns in repository.ts
- [Phase 17-01]: broker/client.ts uses _intentionalDisconnect flag to prevent reconnect loop on graceful shutdown

### Pending Todos

None.

### Blockers/Concerns

- Old Phase 16 plan at `.planning/phases/16-shared-llm-queue/PLAN.md` is superseded — can be archived during Phase 16 planning
- Priority aging threshold (+1 per 5 min, cap 10) should be exposed in broker.json rather than hardcoded

## Session Continuity

Last activity: 2026-03-22
Stopped at: Completed 17-01-PLAN.md
Resume file: None
