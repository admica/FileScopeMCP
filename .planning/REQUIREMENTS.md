# Requirements: FileScopeMCP

**Defined:** 2026-03-02
**Core Value:** LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## v1 Requirements

Requirements for the autonomous metadata milestone. Each maps to roadmap phases.

### Storage & Infrastructure

- [x] **STOR-01**: System stores all file metadata in SQLite instead of JSON, with non-breaking migration for existing users
- [x] **STOR-02**: Existing JSON trees are automatically migrated to SQLite on first startup after upgrade
- [x] **STOR-03**: SQLite schema supports per-file staleness flags, dependency relationships as a join table, and structured metadata fields
- [x] **STOR-04**: All existing MCP tools continue to work identically after storage migration (backward compatibility)
- [x] **STOR-05**: Coordinator logic is extracted from mcp-server.ts into a standalone module that can run without MCP transport
- [x] **STOR-06**: System can run as a standalone daemon via `--daemon` flag, watching and maintaining metadata 24/7 without an MCP client connected
- [x] **STOR-07**: Pending LLM jobs persist in SQLite and survive process restarts — work resumes on startup

### Change Detection

- [ ] **CHNG-01**: System performs AST-level diff on changed TS/JS files to distinguish export/type signature changes from body-only changes
- [ ] **CHNG-02**: AST diff produces a typed SemanticChangeSummary that classifies what changed (exports, types, body, comments)
- [ ] **CHNG-03**: For unsupported languages, system falls back to LLM-powered diff to summarize what semantically changed
- [ ] **CHNG-04**: Body-only changes (internal logic, comments) only re-evaluate the changed file's own metadata, not dependents
- [ ] **CHNG-05**: Export/type changes trigger cascade to direct dependents, marking their metadata stale

### Cascade & Staleness

- [ ] **CASC-01**: When a file's API surface changes, all direct dependents in the dependency graph have their metadata marked stale
- [ ] **CASC-02**: Staleness is tracked per semantic field: summary, concepts, and change_impact each have independent staleSince timestamps
- [ ] **CASC-03**: MCP query responses include staleness timestamps alongside metadata so LLMs can decide whether to trust the data
- [ ] **CASC-04**: Cascade propagation detects and handles circular dependencies without infinite loops
- [ ] **CASC-05**: Cascade jobs are queued with priority ordering: interactive queries (tier 1) > file-change cascades (tier 2) > background sweeps (tier 3)

### LLM Pipeline

- [ ] **LLM-01**: Background LLM automatically generates/updates file summaries when a file or its dependencies change
- [ ] **LLM-02**: Background LLM auto-extracts structured concepts per file (functions, classes, interfaces, exports) as structured JSON
- [ ] **LLM-03**: Background LLM auto-assesses change impact per file (what breaks if this file changes, risk level, affected areas)
- [ ] **LLM-04**: LLM provider is configurable via config — supports any OpenAI-compatible endpoint (Ollama, vLLM, OpenRouter), Anthropic API, and others
- [ ] **LLM-05**: User can configure LLM provider via base URL + model name + API key in config file
- [ ] **LLM-06**: Background LLM can be toggled on/off via config or MCP tool call — system works fully without it (structural metadata only)
- [ ] **LLM-07**: LLM calls have token budget limits and rate limiting to prevent runaway costs
- [ ] **LLM-08**: When LLM is off, semantic metadata fields return null with appropriate staleness indicators

### Compatibility & Degradation

- [x] **COMPAT-01**: All 20+ existing MCP tool names, parameter schemas, and response shapes remain identical
- [ ] **COMPAT-02**: Existing exclude patterns are honored by the LLM pipeline (no LLM calls on excluded files)
- [x] **COMPAT-03**: System functions correctly with no LLM configured — file tree, dependencies, importance, and watching all work as before

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Extended Language Support

- **LANG-01**: Python AST support in semantic change detection (extend beyond TS/JS)
- **LANG-02**: LLM diff fallback covers Rust, Go, C/C++ with language-aware prompting

### Queue Optimization

- **QUEUE-01**: Tier-3 background jobs promote to tier-2 after configurable max-wait time (anti-starvation)
- **QUEUE-02**: Observability MCP tool returning job queue depth, token usage, staleness ratio

### Migration

- **MIGR-01**: Preserve existing manual summaries through JSON→SQLite migration without LLM overwrite

## Out of Scope

| Feature | Reason |
|---------|--------|
| Vector embedding search | Requires entire additional subsystem (embedding model + vector store). Structured metadata serves LLM needs better. |
| Git integration (blame, history, branches) | Different problem domain. File-system-level change detection is sufficient for v1. |
| Multi-project in single instance | State management complexity multiplies. One instance per project is correct. |
| UI / dashboard | Headless only. Data served via MCP. Users can build visualizations on top. |
| Code generation / refactoring tools | FileScopeMCP is a knowledge system, not an agent. Write operations belong in the LLM client. |
| Real-time push notifications to MCP clients | MCP is query-based, not push-based. Staleness flags in responses serve the same purpose. |
| Full AST caching in storage | ASTs are too large (2-10MB per file) and go stale immediately. Cache only SemanticChangeSummary. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| STOR-01 | Phase 1 → Phase 6 | Complete (06) |
| STOR-02 | Phase 1 → Phase 6 | Complete (06) |
| STOR-03 | Phase 1 → Phase 6 | Complete (06) |
| STOR-04 | Phase 1 → Phase 6 | Complete (06) |
| STOR-05 | Phase 2 → Phase 6 | Complete (06) |
| STOR-06 | Phase 2 → Phase 6 | Complete (06) |
| STOR-07 | Phase 1 → Phase 6 | Complete (06) |
| CHNG-01 | Phase 3 → Phase 9 | Pending (verification) |
| CHNG-02 | Phase 3 → Phase 9 | Pending (verification) |
| CHNG-03 | Phase 3 → Phase 7 → Phase 8, 9 | Pending (integration fix + verification) |
| CHNG-04 | Phase 3 → Phase 9 | Pending (verification) |
| CHNG-05 | Phase 3 → Phase 9 | Pending (verification) |
| CASC-01 | Phase 4 → Phase 9 | Pending (verification) |
| CASC-02 | Phase 4 → Phase 9 | Pending (verification) |
| CASC-03 | Phase 4 → Phase 9 | Pending (verification) |
| CASC-04 | Phase 4 → Phase 9 | Pending (verification) |
| CASC-05 | Phase 4 → Phase 9 | Pending (verification) |
| LLM-01 | Phase 5 → Phase 9 | Pending (verification) |
| LLM-02 | Phase 5 → Phase 8, 9 | Pending (integration fix + verification) |
| LLM-03 | Phase 5 → Phase 7 → Phase 8, 9 | Pending (integration fix + verification) |
| LLM-04 | Phase 5 → Phase 9 | Pending (verification) |
| LLM-05 | Phase 5 → Phase 9 | Pending (verification) |
| LLM-06 | Phase 5 → Phase 8, 9 | Pending (integration fix + verification) |
| LLM-07 | Phase 5 → Phase 8, 9 | Pending (integration fix + verification) |
| LLM-08 | Phase 5 → Phase 9 | Pending (verification) |
| COMPAT-01 | Phase 1 → Phase 6 | Complete (06) |
| COMPAT-02 | Phase 5 → Phase 9 | Pending (verification) |
| COMPAT-03 | Phase 2 → Phase 6 | Complete (06) |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Satisfied (verified): 10
- Pending (verification/fix): 18
- Unmapped: 0

---
*Requirements defined: 2026-03-02*
*Last updated: 2026-03-18 — 18 requirements reset to Pending per v1.0 re-audit; Phase 8 (integration fixes) and Phase 9 (verification) added as gap closure*
