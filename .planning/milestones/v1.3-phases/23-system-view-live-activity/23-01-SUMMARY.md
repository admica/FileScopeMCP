---
phase: 23-system-view-live-activity
plan: 01
subsystem: api
tags: [nexus, sse, log-tailing, broker, fastify, d3, ring-buffer]

# Dependency graph
requires:
  - phase: 22-dependency-graph
    provides: Fastify server foundation with repo routes and createServer signature
  - phase: 16-shared-llm-queue
    provides: broker/stats.ts readStats(), broker/config.ts FILESCOPE_DIR/SOCK_PATH/CONFIG_PATH, broker/types.ts StatusResponse
provides:
  - src/nexus/log-tailer.ts — 500-line ring buffer, fs.watch log tailing, SSE client management
  - GET /api/system/broker — broker socket query with 2s timeout and offline fallback
  - GET /api/system/tokens — per-repo token totals with session delta from startup snapshot
  - GET /api/stream/activity — SSE endpoint that flushes ring buffer history then streams live lines
affects:
  - 23-02 (UI plan): System.svelte consumes all three endpoints; fetchBrokerStatus/fetchTokenStats/EventSource wrappers in api.ts

# Tech tracking
tech-stack:
  added: [d3@7.9.0, @types/d3@7.4.3]
  patterns:
    - Log tailing with fs.watch and byte-offset tracking for append-only reads
    - SSE via reply.hijack() in Fastify with raw response headers
    - Broker socket query: fresh net.createConnection per request, readline NDJSON, 2s timeout
    - Startup snapshot for session delta: snapshot readStats().repoTokens at server boot, compute diff on each request

key-files:
  created:
    - src/nexus/log-tailer.ts
  modified:
    - src/nexus/server.ts
    - src/nexus/main.ts
    - package.json

key-decisions:
  - "Log tailer uses per-file byte offset tracking (not readline streaming) so rotation (file shrink) is detectable and handled by resetting offset to 0"
  - "SSE route uses reply.hijack() to prevent Fastify from serializing a response body — raw write to reply.raw"
  - "queryBrokerStatus creates a fresh net.createConnection per API call rather than reusing a persistent socket — simpler, no connection lifecycle management in server.ts"
  - "brokerModelName read from broker.json once at server creation time, not per-request — avoids repeated disk reads"

patterns-established:
  - "SSE pattern: setHeader Content-Type text/event-stream, flushHeaders, flush ring buffer, addSseClient, reply.hijack()"
  - "Broker socket query pattern: net.createConnection with setTimeout(2000).unref(), readline for NDJSON, resolve on status_response type"

requirements-completed: [NEXUS-25, NEXUS-26, NEXUS-27, NEXUS-28, NEXUS-29, NEXUS-30]

# Metrics
duration: 15min
completed: 2026-04-02
---

# Phase 23 Plan 01: System View + Live Activity — Backend Summary

**Broker socket query endpoint, per-repo token stats with session delta, and SSE log-streaming with 500-line ring buffer — all three backend data sources for the System tab**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-02T15:19:31Z
- **Completed:** 2026-04-02T15:34:00Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created `src/nexus/log-tailer.ts` — tails `broker.log` and `mcp-server.log` via `fs.watch()`, maintains a 500-entry ring buffer, broadcasts parsed lines to SSE clients
- Added `GET /api/system/broker` — queries broker.sock with 2s timeout, returns structured status object with offline fallback (no crash when broker is down)
- Added `GET /api/system/tokens` — reads stats.json and computes per-repo session delta from startup snapshot
- Added `GET /api/stream/activity` — SSE endpoint using `reply.hijack()`, flushes ring buffer history to new clients, streams live log lines
- Wired `main.ts` to init log tailer on startup, capture token snapshot for session delta, stop log tailer on shutdown

## Task Commits

Each task was committed atomically:

1. **Task 1: Create log-tailer.ts and install d3 dependency** - `96b0ab1` (feat)
2. **Task 2: Add broker status, token stats, and SSE routes to server.ts + wire main.ts** - `6b8d904` (feat)

## Files Created/Modified
- `src/nexus/log-tailer.ts` — Log tailing module: 500-line ring buffer, fs.watch with byte-offset tracking, log rotation detection, SSE broadcast
- `src/nexus/server.ts` — Three new API routes: `/api/system/broker`, `/api/system/tokens`, `/api/stream/activity`; `queryBrokerStatus()` socket helper
- `src/nexus/main.ts` — Startup token snapshot capture, initLogTailer/stopLogTailer lifecycle wiring, updated createServer call signature
- `package.json` — d3 and @types/d3 dependencies added, build:nexus-api updated to include log-tailer.ts

## Decisions Made
- Used `reply.hijack()` in Fastify for SSE — prevents Fastify from interfering with the raw response after headers are flushed
- Fresh socket connection per broker status request (not persistent) — simpler lifecycle, 2s timeout covers all failure modes
- Byte-offset tracking in log tailer — enables log rotation detection (size < offset) and avoids re-reading entire file on each watch event
- brokerModelName read once at server creation, not per-request — config rarely changes, no point reading disk on every broker status poll

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Worktree branch was behind main (did not have nexus source from phases 20-22). Resolved by merging main into the worktree branch before starting implementation.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three backend endpoints are live and ready for consumption by the Phase 23 Plan 02 UI (System.svelte rewrite)
- `api.ts` in the UI layer needs `fetchBrokerStatus()`, `fetchTokenStats()`, and an EventSource wrapper for `/api/stream/activity`
- D3 dependency installed and available for the token usage bar chart
