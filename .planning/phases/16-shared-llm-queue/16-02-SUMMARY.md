---
phase: 16-shared-llm-queue
plan: 02
subsystem: infra
tags: [broker, unix-socket, llm, ollama, ndjson, esbuild, abortcontroller, pid-guard]

# Dependency graph
requires:
  - phase: 16-01
    provides: "types.ts (QueueJob, JobResult, message types), config.ts (BrokerConfig, loadBrokerConfig, path constants), queue.ts (PriorityQueue)"
provides:
  - "BrokerWorker class — serial job processor with 120s timeout via AbortController"
  - "BrokerServer class — Unix socket server with NDJSON parsing, connection tracking, job routing"
  - "broker entry point (src/broker/main.ts) — PID guard, logging setup, Ollama check, signal handlers"
  - "dist/broker/main.js — runnable esbuild binary for the broker process"
affects: [phase-17-client, phase-18-cleanup, phase-19-observability]

# Tech tracking
tech-stack:
  added: []  # No new npm deps — all Node.js built-ins or existing deps
  patterns:
    - "AbortController + generateText abortSignal for per-job LLM timeout enforcement"
    - "Re-throw AbortError before structured output fallback to prevent confusion (Pitfall 5)"
    - "Fire-and-forget socket.write() for NDJSON responses (no await drain)"
    - "readline.createInterface() for NDJSON line parsing on Unix socket streams"
    - "Shutdown sequence: stop worker -> await current job -> destroy sockets -> close server -> rmSync files -> exit"
    - "PID guard via process.kill(pid, 0) with ESRCH detection"
    - "TTY-aware logging: enableFileLogging (isTTY) vs enableDaemonFileLogging (daemon)"

key-files:
  created:
    - src/broker/worker.ts
    - src/broker/server.ts
    - src/broker/main.ts
  modified:
    - package.json

key-decisions:
  - "dist/broker/main.js is the correct broker binary path — esbuild mirrors src/broker/ structure under dist/"
  - "parse_error code thrown via Object.assign on error so name stays 'parse_error' for callers, but thrown without entering fallback path"
  - "change_impact missing payload throws immediately (not a timeout), using Object.assign to set error name"

patterns-established:
  - "Pattern: Serial worker loop using scheduleNext() recursion with .unref() (mirrors pipeline.ts)"
  - "Pattern: nudge() shortcut to wake idle worker on new job submission"
  - "Pattern: job.connection.destroyed check before writing result back to client (Pitfall 3)"

requirements-completed: [BROKER-01, BROKER-04, BROKER-07, BROKER-08, BROKER-09, BROKER-10, BROKER-11, BROKER-12]

# Metrics
duration: 3min
completed: 2026-03-22
---

# Phase 16 Plan 02: Worker, Server, and Entry Point Summary

**Serial broker worker, Unix socket server with NDJSON routing, and PID-guarded entry point that produce a runnable dist/broker/main.js via esbuild**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-22T14:04:54Z
- **Completed:** 2026-03-22T14:08:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments
- BrokerWorker processes jobs one at a time via existing adapter.ts + prompts.ts, enforcing 120s timeout via AbortController with AbortError re-throw before fallback (BROKER-07, BROKER-08, BROKER-09)
- BrokerServer accepts Unix socket connections, parses NDJSON with readline, tracks connections, drops pending jobs on disconnect, checks maxQueueSize (BROKER-01, BROKER-11)
- main.ts implements PID guard with stale detection, verbose startup logging, Ollama connectivity check, and SIGTERM/SIGINT graceful shutdown (BROKER-04, BROKER-10)
- package.json updated with all broker source files in esbuild command; build produces dist/broker/main.js alongside existing MCP server bundle (BROKER-12)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create serial job worker with LLM dispatch and timeout** - `9f8597f` (feat)
2. **Task 2: Create Unix socket server with NDJSON parsing and connection tracking** - `97e46da` (feat)
3. **Task 3: Create main entry point with PID guard, logging, shutdown, and esbuild wiring** - `60a95d9` (feat)

## Files Created/Modified
- `src/broker/worker.ts` — BrokerWorker: dequeue loop, runJobWithTimeout (AbortController), runJob (all 3 job types), callbacks
- `src/broker/server.ts` — BrokerServer: net.createServer, readline NDJSON parser, connection Set, submit/status routing, shutdown sequence
- `src/broker/main.ts` — Entry point: TTY logging, PID guard, Ollama check, server.start(), SIGTERM/SIGINT handlers
- `package.json` — Added 6 broker source files to esbuild build command

## Decisions Made
- esbuild produces `dist/broker/main.js` (not `dist/broker.js`) — the outdir mirrors the source directory structure; this is documented in acceptance criteria and plan notes
- `change_impact` missing payload error uses `Object.assign(new Error(...), { name: 'parse_error' })` to set a distinguishable name without polluting the AbortError re-throw path
- Worker polls every 1 second when queue is empty (vs 5 seconds in pipeline.ts) for faster job pickup in the broker context

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The broker binary at dist/broker/main.js is ready to run. Phase 17 will wire the client side.

## Next Phase Readiness
- Phase 16 complete: full broker binary runnable via `node dist/broker/main.js`
- Phase 17 (client + wiring): ready — BrokerServer and BrokerWorker expose all needed interfaces
- Phase 18 (cleanup): ready — pipeline.ts and rate-limiter.ts can be deleted once client side is wired
- Phase 19 (observability): ready — StatusResponse already implemented in BrokerServer.handleStatus()

---
*Phase: 16-shared-llm-queue*
*Completed: 2026-03-22*
