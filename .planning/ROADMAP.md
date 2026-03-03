# Roadmap: FileScopeMCP — Autonomous Metadata Milestone

## Overview

This milestone transforms FileScopeMCP from a static-metadata system into an autonomous one. The existing system already handles file tree building, dependency parsing, importance scoring, and real-time watching. The work here adds the four layers that sit on top: a SQLite storage backend, a standalone coordinator extracted from the monolithic MCP server, a semantic change detection layer, a cascade engine that propagates staleness through the dependency graph, and a background LLM pipeline that regenerates summaries and structured metadata without human intervention. The dependency chain between phases is strict — each layer is a hard prerequisite for the next.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: SQLite Storage** - Replace JSON flat-file storage with SQLite; migrate existing users transparently
- [ ] **Phase 2: Coordinator + Daemon Mode** - Extract coordinator from mcp-server.ts; enable standalone daemon operation
- [ ] **Phase 3: Semantic Change Detection** - AST-level diff for TS/JS; LLM fallback for unsupported languages
- [ ] **Phase 4: Cascade Engine + Staleness** - Propagate staleness through dependency graph; enqueue LLM jobs with priority tiers
- [ ] **Phase 5: LLM Processing Pipeline** - Multi-provider LLM adapter; auto-generate summaries, concepts, and change impact

## Phase Details

### Phase 1: SQLite Storage
**Goal**: The system stores all file metadata in SQLite with a schema that supports per-field staleness, dependency relationships, and structured metadata — while existing users experience zero disruption
**Depends on**: Nothing (first phase)
**Requirements**: STOR-01, STOR-02, STOR-03, STOR-04, STOR-07, COMPAT-01
**Success Criteria** (what must be TRUE):
  1. Starting the server against an existing JSON tree automatically migrates all data to SQLite on first boot, with the original JSON backed up but not deleted
  2. Every MCP tool that existed before the migration returns identical responses after — same tool names, same parameter schemas, same response shapes
  3. The SQLite schema has columns for summary_stale_since, concepts_stale_since, and change_impact_stale_since per file, and a dependency relationships join table with path indexes
  4. A pending LLM jobs table exists in SQLite and is written before Phase 5 needs it; jobs written before a process restart are readable after restart
  5. A fresh install with no prior JSON cache starts cleanly against SQLite with no errors
**Plans:** 3/3 plans executed

Plans:
- [x] 01-01-PLAN.md — SQLite schema, drizzle-orm setup, better-sqlite3 ESM integration, repository module
- [x] 01-02-PLAN.md — Migration runner: detect existing JSON tree, transform to SQLite, back up JSON
- [x] 01-03-PLAN.md — Replace all read/write paths with SQLite equivalents; verify MCP tool backward compatibility

### Phase 2: Coordinator + Daemon Mode
**Goal**: The coordinator logic is extracted into a standalone module that owns lifecycle, watcher init, and event routing — and the system can run 24/7 without an MCP client connected via a --daemon flag
**Depends on**: Phase 1
**Requirements**: STOR-05, STOR-06, COMPAT-03
**Success Criteria** (what must be TRUE):
  1. Running `node dist/index.js --daemon` starts the file watcher, loads the SQLite tree, and runs indefinitely without any MCP client connected
  2. `mcp-server.ts` is reduced to a thin tool-surface layer that delegates all orchestration to `src/coordinator.ts`
  3. The system running in MCP mode behaves identically to before the extraction — all tools work, watcher starts and stops correctly, file tree is maintained
  4. The file tree, dependency graph, importance scoring, and watching all function correctly with no LLM configured (structural metadata only)
**Plans:** 2 plans

Plans:
- [ ] 02-01-PLAN.md — Extract ServerCoordinator class from mcp-server.ts; rewire all tools to use coordinator via closure capture; drop in-memory FileNode tree
- [ ] 02-02-PLAN.md — Wire --daemon entry point with PID file guard, graceful shutdown, and file-only logging

### Phase 3: Semantic Change Detection
**Goal**: When a file changes, the system classifies what semantically changed — exports, types, body, or comments — using AST-level diffing for TS/JS files and LLM-powered diff for unsupported languages
**Depends on**: Phase 2
**Requirements**: CHNG-01, CHNG-02, CHNG-03, CHNG-04, CHNG-05
**Success Criteria** (what must be TRUE):
  1. Editing a TS/JS file's internal function body (no export changes) produces a SemanticChangeSummary with changeType "body-only"; no dependent files are marked stale
  2. Editing a TS/JS file to add, remove, or rename an export produces a SemanticChangeSummary with changeType "exports-changed"; direct dependents are flagged for cascade in Phase 4
  3. Editing a file in an unsupported language (e.g., Go, Rust) produces a SemanticChangeSummary via LLM diff fallback with a best-effort change classification
  4. The TS/JS dependency import parser uses AST extraction instead of regex, eliminating false-positive dependency edges from string literals and comments
  5. The SemanticChangeSummary type is a stable TypeScript interface that CascadeEngine (Phase 4) can consume without changes to its contract
**Plans**: TBD

Plans:
- [ ] 03-01: tree-sitter integration — validate build pipeline (esbuild external flag, native addon copy); implement AST parser for TS/JS producing SemanticChangeSummary
- [ ] 03-02: LLM diff fallback for unsupported languages; replace regex import parsing with AST-based extraction for TS/JS; wire ChangeDetector into coordinator's file-change handler

### Phase 4: Cascade Engine + Staleness
**Goal**: When a file's API surface changes, staleness propagates through the dependency graph to all affected files — with per-field granularity, circular dependency protection, and priority-ordered job queuing
**Depends on**: Phase 3
**Requirements**: CASC-01, CASC-02, CASC-03, CASC-04, CASC-05
**Success Criteria** (what must be TRUE):
  1. After an export change in file A (which B and C import), querying B and C via MCP shows their summary_stale_since, concepts_stale_since, and change_impact_stale_since timestamps updated; querying A shows its own staleness updated
  2. MCP query responses include staleness timestamps alongside metadata values — an LLM can read both the metadata and how fresh it is in a single response
  3. A project with circular dependencies (A imports B imports A) processes a cascade without hanging or stack-overflowing; a visited set terminates the walk
  4. LLM jobs written to the SQLite queue have priority tiers: tier 1 for interactive query promotion, tier 2 for file-change cascades, tier 3 for background sweeps
  5. A body-only change in any file produces zero new stale marks on dependents and zero new LLM job queue entries
**Plans**: TBD

Plans:
- [ ] 04-01: CascadeEngine implementation — dependency graph walk, visited set, depth cap, per-field SQLite staleness writes; wire to ChangeDetector output
- [ ] 04-02: Priority-tiered job queue (p-queue); LLM job record schema in SQLite; MCP response staleness timestamp injection

### Phase 5: LLM Processing Pipeline
**Goal**: A background LLM pipeline autonomously regenerates file summaries, structured concept lists, and change impact assessments when files go stale — with configurable providers, rate limiting, and a clean on/off toggle
**Depends on**: Phase 4
**Requirements**: LLM-01, LLM-02, LLM-03, LLM-04, LLM-05, LLM-06, LLM-07, LLM-08, COMPAT-02
**Success Criteria** (what must be TRUE):
  1. After a file changes and its metadata goes stale, the background LLM automatically updates the file's summary, concept list, and change impact in SQLite without any user or MCP client action
  2. Setting `llm.enabled: false` in config (or calling the MCP toggle tool) stops all LLM calls; semantic metadata fields return null with staleness indicators rather than stale data; structural metadata (tree, dependencies, importance) continues working identically
  3. Changing the LLM provider in config from Anthropic to Ollama (or any OpenAI-compatible endpoint) requires no code changes — only base URL, model name, and API key in the config file
  4. LLM calls respect a configurable token budget cap and per-minute rate limit; when the budget is exhausted the system writes error state to SQLite and stops queuing new jobs until the next window
  5. Files matching existing exclude patterns are never passed to the LLM pipeline — the same patterns that suppress watching and tree inclusion suppress LLM calls
  6. Concurrent file changes do not produce duplicate or conflicting LLM writes — generation counters and a per-file pending-job map ensure only the latest result is committed
**Plans**: TBD

Plans:
- [ ] 05-01: LLMAdapter — multi-provider interface (Vercel AI SDK); Anthropic, OpenAI-compatible, and Ollama provider wiring; config schema for provider selection
- [ ] 05-02: LLMPipeline — dequeue jobs, run prompts (summary, concepts, change impact), write results to SQLite, clear staleness flags; generation counter + pending-job map for race safety
- [ ] 05-03: Rate limiting, token budget cap, circuit breaker, on/off toggle (config + MCP tool); exclude pattern enforcement in pipeline; end-to-end integration test

## Progress

**Execution Order:**
Phases execute in strict dependency order: 1 -> 2 -> 3 -> 4 -> 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. SQLite Storage | 3/3 | Complete | 2026-03-02 |
| 2. Coordinator + Daemon Mode | 0/2 | Not started | - |
| 3. Semantic Change Detection | 0/2 | Not started | - |
| 4. Cascade Engine + Staleness | 0/2 | Not started | - |
| 5. LLM Processing Pipeline | 0/3 | Not started | - |
