# Phase 16: Broker Core - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Standalone broker binary that listens on a Unix domain socket, accepts LLM job submissions from FileScopeMCP instances, maintains an in-memory priority queue ordered by file importance, and processes jobs one at a time through Ollama. Includes PID guard, graceful shutdown, stale socket cleanup, job dedup, timeout enforcement, and esbuild entry point. Instance-side client, config migration, and cleanup are separate phases (17-19).

</domain>

<decisions>
## Implementation Decisions

### Broker startup UX
- Auto-started by first MCP instance as a detached background process (Phase 17 spawns, Phase 16 must handle gracefully)
- `broker.default.json` ships in repo root — broker copies it to `~/.filescope/broker.json` on first run if missing (broker resolves default via `__dirname` relative path)
- Verbose startup logging: PID, socket path, model name, config path, Ollama connectivity result, Node version, timestamp
- Ollama connectivity check on startup: warn if unreachable, continue anyway (self-healing — jobs fail individually until Ollama is up, no ordering dependency)
- PID guard on duplicate start: log "Broker already running (PID XXXX)", exit 0 (non-error for auto-start race conditions)
- Stop mechanism: SIGTERM only — standard Unix, no special flags or MCP tools

### broker.json config
- Auto-created from `broker.default.json` in repo if `~/.filescope/broker.json` doesn't exist
- Three top-level fields: `llm`, `jobTimeoutMs`, `maxQueueSize`
- `llm`: `provider`, `model`, `baseURL`, `maxTokensPerCall` (same shape as existing LLMConfig minus instance-specific fields)
- Defaults: `openai-compatible`, `qwen2.5-coder:14b`, `http://localhost:11434/v1`, 1024 tokens per call
- `jobTimeoutMs`: 120000 (120 seconds)
- `maxQueueSize`: 1000
- Priority aging deferred to future milestone (SCALE-02)
- Invalid/malformed config: fail-fast with clear error message pointing to config file path, exit 1

### Error & edge case behavior
- Job failures (Ollama timeout, parse error): return error to client, move to next job. No broker-side retries — natural retry via cascade engine resubmission handles this
- Queue full (maxQueueSize reached): reject new submission with error. File stays stale, gets resubmitted when queue has space
- Stale socket/PID on startup: detect via PID file — if PID doesn't exist or isn't running, remove stale socket and PID, start fresh (BROKER-04)
- Ollama unreachable during job processing: return error result to client, continue processing next job

### Logging behavior
- Log destination: `~/.filescope/broker.log` (append)
- Per-job lifecycle events: job received, processing started, completed (with token count), failed (with error)
- Client connect/disconnect events logged
- ISO timestamps on all entries: `[2026-03-22T03:15:42.123Z] job received summary for src/foo.ts`
- No log rotation — user manages externally
- Manual start with TTY: also logs to stdout (broker can detect)

### Claude's Discretion
- Priority queue data structure (heap, sorted array, etc.)
- Broker internal source file organization within `src/broker/`
- Wire format message shapes (derivable from NDJSON protocol + requirements)
- Zod schema for broker.json validation (consistent with existing config-utils.ts pattern)
- Retry delay semantics if retry is ever added
- Whether Ollama startup check validates model existence or just server reachability

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Requirements
- `.planning/REQUIREMENTS.md` — All 12 BROKER-* requirements for Phase 16 (BROKER-01 through BROKER-12)
- `.planning/ROADMAP.md` — Phase 16 success criteria (5 observable behaviors that must be TRUE)
- `.planning/PROJECT.md` — Key decisions table with v1.2 architectural rationale

### Existing LLM code (broker reuses these)
- `src/llm/adapter.ts` — Provider factory for Vercel AI SDK (createLLMModel). Broker imports this directly
- `src/llm/prompts.ts` — Prompt builders for summary, concepts, change_impact. Broker imports these directly
- `src/llm/types.ts` — LLMConfig interface, ConceptsSchema, ChangeImpactSchema Zod schemas
- `src/llm/pipeline.ts` — Current pipeline implementation (broker replaces this, but useful reference for job processing logic, structured output fallback, file reading)

### Build & config patterns
- `package.json` — Current esbuild command (broker needs a separate entry point added)
- `broker.default.json` — Default broker config shipped in repo

### Superseded (do NOT implement)
- `.planning/phases/16-shared-llm-queue/PLAN.md` — Old shared SQLite queue design. Completely replaced by broker architecture. Archive or delete during planning.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/llm/adapter.ts`: `createLLMModel()` — broker imports directly to get a LanguageModel for Ollama calls
- `src/llm/prompts.ts`: `buildSummaryPrompt()`, `buildConceptsPrompt()`, `buildChangeImpactPrompt()` — broker uses these to build prompts from client-submitted file content
- `src/llm/types.ts`: `ConceptsSchema`, `ChangeImpactSchema` — Zod schemas for structured output, `LLMConfig` interface shape
- `src/llm/pipeline.ts`: `runJob()` method — reference implementation for job dispatch, structured output with Ollama JSON repair fallback
- `src/config-utils.ts`: Zod-based config validation pattern — broker.json validation should follow same approach

### Established Patterns
- esbuild with explicit entry points (no glob) — broker adds `src/broker/main.ts` to the build command
- Vercel AI SDK (`generateText`, `Output.object`) for LLM calls with structured output fallback
- `better-sqlite3` via `createRequire` for native ESM addon loading (not needed in broker — no SQLite)
- Zod schemas for config validation
- `.unref()` on timers to prevent blocking event loop shutdown

### Integration Points
- `~/.filescope/` directory: broker.sock, broker.pid, broker.log, broker.json all live here
- `broker.default.json` at repo root: shipped default config
- `package.json` build script: needs `src/broker/main.ts` added as esbuild entry point
- Node.js `net` module: Unix domain socket server
- Node.js `readline` module: NDJSON line parsing on socket streams

</code_context>

<specifics>
## Specific Ideas

- Broker resolves `broker.default.json` relative to its own `__dirname` (i.e., `../broker.default.json` from `dist/broker.js`) — this ties the broker to running from the repo's dist/ folder, which is fine for v1.2 (no separate distribution story)
- The 120s job timeout from `jobTimeoutMs` is per-attempt — if retries are ever added, each attempt gets its own timeout
- The existing `pipeline.ts` `runJob()` method has the exact Ollama interaction pattern the broker needs: generateText call, structured output with Zod schema, fallback to plain text + JSON.parse for Ollama JSON repair

</specifics>

<deferred>
## Deferred Ideas

- Priority aging (SCALE-02) — boost importance of old pending jobs to prevent starvation. Config fields deferred to future milestone.
- Log rotation — no built-in rotation for v1.2, user manages with external tools
- `--check`/`--status` CLI flag — probe whether broker is running without starting. Useful for scripting but not essential.
- Systemd/launchd service file — proper process management for production deployments
- Broker health endpoint — could expose stats over a separate mechanism for monitoring dashboards

</deferred>

---

*Phase: 16-shared-llm-queue*
*Context gathered: 2026-03-22*
