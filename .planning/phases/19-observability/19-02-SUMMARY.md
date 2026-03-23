---
phase: 19-observability
plan: "02"
subsystem: observability
tags: [mcp-tool, broker-client, coordinator, status]
dependency_graph:
  requires: [19-01]
  provides: [get_llm_status-live-data, requestStatus-export]
  affects: [src/broker/client.ts, src/coordinator.ts, src/mcp-server.ts]
tech_stack:
  added: []
  patterns: [pending-request-map, correlation-id-dispatch, fallback-to-disk-stats]
key_files:
  created: []
  modified:
    - src/broker/client.ts
    - src/coordinator.ts
    - src/mcp-server.ts
decisions:
  - "requestStatus uses timer.unref() so in-flight status queries don't prevent process exit"
  - "getBrokerStatus falls back to readStats on both disconnected and timeout cases — reuses same disk fallback path"
  - "get_llm_status tool description updated to reflect broker-mode reality"
metrics:
  duration_seconds: 220
  completed_date: "2026-03-23"
  tasks_completed: 2
  files_modified: 3
---

# Phase 19 Plan 02: Observability Instance Wiring Summary

**One-liner:** requestStatus() added to broker client with correlation-id dispatch, getBrokerStatus() replaces three stubs in coordinator, get_llm_status MCP tool returns live {mode, brokerConnected, pendingCount, inProgressJob, connectedClients, repoTokens}.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add requestStatus() to broker client with disconnect cleanup | 20ac9fe | src/broker/client.ts |
| 2 | Update coordinator and get_llm_status MCP tool | efd76e9 | src/coordinator.ts, src/mcp-server.ts |

## What Was Built

### Task 1: requestStatus() in broker client
- Added `StatusMessage` and `StatusResponse` imports to `client.ts`
- Added `pendingStatusRequests: Map<string, (r: StatusResponse | null) => void>` module-level map
- Exported `requestStatus(timeoutMs = 2000)`: sends status message with correlation ID, resolves with response or null on timeout
- Timer uses `.unref()` to avoid blocking process exit
- Added `status_response` branch in `handleBrokerMessage` to dispatch by correlation ID
- Added cleanup in `sock.on('close')`: resolves all pending requests with null before clearing the map

### Task 2: coordinator.getBrokerStatus() and updated MCP tool
- Added `requestStatus` to broker client import in `coordinator.ts`
- Added `readStats` import from `broker/stats.ts`
- Replaced `getLlmLifetimeTokensUsed()`, `getLlmTokenBudget()`, `getLlmMaxTokensPerMinute()` stubs with single `async getBrokerStatus()` method
- Connected path: calls `requestStatus()`, returns live queue data from broker
- Disconnected path: calls `readStats()`, returns `brokerConnected: false` with last-known token totals
- Timeout/error during connected path: falls back to `readStats()` with `brokerConnected: true` but null queue data
- Updated `get_llm_status` tool: new description, delegates entirely to `coordinator.getBrokerStatus()`

## Decisions Made

- **requestStatus timer.unref()**: Matches pattern from broker's startReconnectTimer() — prevents in-flight status queries from blocking process exit
- **Shared fallback path**: Both disconnected and timeout cases call `readStats()`. Avoids duplicating the fallback — cleaner than two separate code paths
- **get_llm_status description**: Changed from "Get LLM pipeline status including budget and rate limit info" to "Get broker connection status, queue depth, and per-repo token usage" to reflect actual output shape

## Deviations from Plan

None — plan executed exactly as written.

## Test Results

- 232/233 tests pass
- 1 pre-existing failure: `coordinator.test.ts > init throws "already running" error when PID file contains a live PID`
  - Confirmed pre-existing by reverting changes and running test in isolation — same failure
  - Not caused by this plan's changes (PID guard logic not touched)

## Self-Check: PASSED

Files exist:
- src/broker/client.ts — FOUND (contains requestStatus export)
- src/coordinator.ts — FOUND (contains getBrokerStatus method)
- src/mcp-server.ts — FOUND (contains getBrokerStatus call)

Commits exist:
- 20ac9fe — FOUND
- efd76e9 — FOUND
