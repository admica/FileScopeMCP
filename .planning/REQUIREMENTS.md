# Requirements: FileScopeMCP v1.2

**Defined:** 2026-03-21
**Core Value:** LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## v1.2 Requirements

Requirements for the LLM Broker milestone. Each maps to roadmap phases.

### Broker Core

- [x] **BROKER-01**: Broker process listens on Unix domain socket at ~/.filescope/broker.sock
- [x] **BROKER-02**: Broker creates ~/.filescope/ directory on first run if it doesn't exist
- [x] **BROKER-03**: Broker reads LLM config (provider, model, baseURL) from ~/.filescope/broker.json
- [x] **BROKER-04**: Broker writes PID file at ~/.filescope/broker.pid and cleans up stale socket/PID on startup
- [x] **BROKER-05**: Broker maintains in-memory priority queue ordered by importance DESC, created_at ASC
- [x] **BROKER-06**: Broker deduplicates pending jobs per (repoPath, filePath, jobType) — latest submission replaces older
- [x] **BROKER-07**: Broker builds prompts from file content and calls Ollama with structured output fallback
- [x] **BROKER-08**: Broker processes one job at a time (serialized Ollama access)
- [x] **BROKER-09**: Broker enforces 120s timeout per job to protect against hung Ollama calls
- [x] **BROKER-10**: Broker performs graceful shutdown on SIGTERM/SIGINT — finish current job, close connections, remove socket and PID files
- [x] **BROKER-11**: Broker drops pending jobs for a connection when that connection closes
- [x] **BROKER-12**: Broker built as separate esbuild entry point (src/broker/main.ts -> dist/broker.js)

### Instance Client

- [x] **CLIENT-01**: Instance auto-discovers broker by connecting to ~/.filescope/broker.sock
- [x] **CLIENT-02**: Instance submits jobs to broker with file content, importance score, and job type
- [x] **CLIENT-03**: Instance receives async results from broker and writes to local .filescope.db via writeLlmResult/clearStaleness
- [x] **CLIENT-04**: Instance reconnects to broker on disconnect with fixed-interval retry (10s)
- [x] **CLIENT-05**: Instance scans local DB for stale files on connect/reconnect and resubmits all to broker

### Pipeline

- [x] **PIPE-01**: submitJob() replaces insertLlmJobIfNotPending() as the single entry point for all LLM job creation (cascade engine, diff fallback)

### Config Migration

- [x] **CONF-01**: LLM model/provider/baseURL config removed from instance config.json — broker owns model config
- [x] **CONF-02**: Instance config.json retains only a broker connection toggle (llm.enabled means "connect to broker")
- [x] **CONF-03**: toggle_llm MCP tool connects/disconnects from broker instead of starting/stopping local pipeline

### Cleanup

- [ ] **CLEAN-01**: llm_jobs and llm_runtime_state tables dropped from local .filescope.db on init
- [ ] **CLEAN-02**: TokenBudgetGuard module (rate-limiter.ts) deleted entirely
- [ ] **CLEAN-03**: pipeline.ts deleted — broker client replaces it
- [ ] **CLEAN-04**: Dead job CRUD functions removed from repository.ts (insertLlmJob, insertLlmJobIfNotPending, dequeueNextJob, markJobInProgress, markJobDone, markJobFailed, recoverOrphanedJobs, loadLlmRuntimeState, saveLlmRuntimeState)
- [ ] **CLEAN-05**: isExhausted parameter threading removed from cascade engine and coordinator

### Observability

- [ ] **OBS-01**: get_llm_status MCP tool reports broker connection status, queue depth, and per-repo token totals
- [ ] **OBS-02**: Broker responds to status requests with pending count, in-progress job, connected client count, and per-repo breakdown

## Future Requirements

Deferred to future milestones. Tracked but not in current roadmap.

### Scaling

- **SCALE-01**: Broker supports configurable maxConcurrent workers for multi-GPU setups
- **SCALE-02**: Priority aging prevents low-importance job starvation under sustained high load

### Resilience

- **RESIL-01**: Version handshake on connect — broker rejects incompatible client versions
- **RESIL-02**: Persistent token stats across broker restarts

### Config

- **CONF-04**: Broker hot-reload of config without restart

### Language Support (carried from v1.1)

- **LANG-03**: Barrel re-export parsing for TypeScript/JavaScript
- **LANG-04**: Python relative imports and importlib
- **LANG-05**: Rust mod declarations

## Out of Scope

| Feature | Reason |
|---------|--------|
| Shared database for job queue | Broker is a process, not a database — in-memory queue is simpler and faster |
| Direct Ollama fallback mode | One code path: broker or no LLM. Eliminates dual-mode testing burden |
| Leader election | Adds failover complexity for no real benefit — just run the broker |
| TCP/HTTP protocol | Unix socket is local-only, faster, no port conflicts |
| "accepted" acknowledgment message | Fire-and-forget submit — socket delivery is reliable, reconnect handles crashes |
| "cancel" message on shutdown | Broker detects connection close and drops pending jobs automatically |
| Lazy file content | Separate concern, deferred to future milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BROKER-01 | Phase 16 | Complete |
| BROKER-02 | Phase 16 | Complete |
| BROKER-03 | Phase 16 | Complete |
| BROKER-04 | Phase 16 | Complete |
| BROKER-05 | Phase 16 | Complete |
| BROKER-06 | Phase 16 | Complete |
| BROKER-07 | Phase 16 | Complete |
| BROKER-08 | Phase 16 | Complete |
| BROKER-09 | Phase 16 | Complete |
| BROKER-10 | Phase 16 | Complete |
| BROKER-11 | Phase 16 | Complete |
| BROKER-12 | Phase 16 | Complete |
| CLIENT-01 | Phase 17 | Complete |
| CLIENT-02 | Phase 17 | Complete |
| CLIENT-03 | Phase 17 | Complete |
| CLIENT-04 | Phase 17 | Complete |
| CLIENT-05 | Phase 17 | Complete |
| PIPE-01 | Phase 17 | Complete |
| CONF-01 | Phase 17 | Complete |
| CONF-02 | Phase 17 | Complete |
| CONF-03 | Phase 17 | Complete |
| CLEAN-01 | Phase 18 | Pending |
| CLEAN-02 | Phase 18 | Pending |
| CLEAN-03 | Phase 18 | Pending |
| CLEAN-04 | Phase 18 | Pending |
| CLEAN-05 | Phase 18 | Pending |
| OBS-01 | Phase 19 | Pending |
| OBS-02 | Phase 19 | Pending |

**Coverage:**
- v1.2 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0

---
*Requirements defined: 2026-03-21*
*Last updated: 2026-03-21 after roadmap creation*
