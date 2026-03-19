# Phase 5: LLM Processing Pipeline - Verification

**Verified:** 2026-03-19
**Test command:** `npx vitest run src/llm/pipeline.test.ts`
**Result:** All tests pass (7 tests across 1 test file)

---

## LLM-01: Background LLM automatically generates/updates file summaries when a file or its dependencies change

**Status:** VERIFIED
**Evidence:**
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should process a summary job and write result`
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should mark job as failed with file_deleted when file does not exist`
- Code inspection: `src/coordinator.ts` `handleFileEvent` calls `markSelfStale`/`cascadeStale` which queue summary jobs; pipeline dequeues and processes them
**Behavior confirmed:** The LLM pipeline dequeues `summary` job types, calls the LLM, and writes the result back to the files table; file-deleted jobs are marked failed rather than retried.

---

## LLM-02: Background LLM auto-extracts structured concepts per file as structured JSON

**Status:** VERIFIED
**Evidence:**
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should process a summary job and write result` (same dequeue infrastructure used for concepts jobs)
- Code inspection: `src/llm/pipeline.ts` lines 169-195 — concepts branch uses `ConceptsSchema` with `generateText` + `Output.object()` to extract structured JSON
- Code inspection: `src/llm/types.ts` `ConceptsSchema` defines `functions`, `classes`, `interfaces`, `exports`, `purpose` fields
**Behavior confirmed:** The `concepts` job branch processes files through a structured extraction prompt using `ConceptsSchema`, returning JSON with the defined concept fields.

---

## LLM-03: Background LLM auto-assesses change impact per file (what breaks, risk level, affected areas)

**Status:** VERIFIED (Phase 5 component; Phase 7 VERIFICATION covers full E2E chain)
**Evidence:**
- Code inspection: `src/llm/pipeline.ts` lines 196-220 — `change_impact` branch uses `ChangeImpactSchema` (riskLevel, affectedAreas, breakingChanges, summary)
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale with changeContext > passes directPayload to change_impact job for the root changed file`
**Behavior confirmed:** The `change_impact` job branch processes files using `ChangeImpactSchema`, producing structured risk assessment output; changeContext payloads are passed through from cascade to the job.

---

## LLM-04: LLM provider is configurable via config — supports any OpenAI-compatible endpoint and Anthropic API

**Status:** VERIFIED (code inspection)
**Evidence:**
- Code inspection: `src/llm/adapter.ts` lines 22-41 — `createLLMModel` switch handles `'anthropic'` (via `createAnthropic`) and `'openai-compatible'` (via `createOpenAICompatible`) with TypeScript exhaustiveness guard
- Code inspection: `src/llm/types.ts` `LLMConfig` `provider: 'anthropic' | 'openai-compatible'`
**Behavior confirmed:** The adapter factory switches on `config.provider` and constructs the appropriate AI SDK model instance — Anthropic or any OpenAI-compatible endpoint.

---

## LLM-05: User can configure LLM provider via base URL + model name + API key in config file

**Status:** VERIFIED (code inspection)
**Evidence:**
- Code inspection: `src/llm/types.ts` `LLMConfig` interface — `baseURL`, `model`, `apiKey` fields all present
- Code inspection: `src/llm/adapter.ts` lines 29-36 — openai-compatible branch passes `config.baseURL` and `config.apiKey` to `createOpenAICompatible`
- Code inspection: `src/config-utils.ts` line 25 — `LLMConfigSchema` in `ConfigSchema` validates and persists all LLM config fields
**Behavior confirmed:** LLM configuration (baseURL, model, apiKey) is declared in `LLMConfig`, validated by `LLMConfigSchema`, persisted to the config file, and consumed by the adapter on every model creation.

---

## LLM-06: Background LLM can be toggled on/off via config or MCP tool call

**Status:** VERIFIED
**Evidence:**
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should stop dequeue loop when stop() is called`
- Code inspection: `src/mcp-server.ts` lines 649-682 — `toggle_llm` MCP tool calls `coordinator.toggleLlm(enabled)` and persists the setting to the config file
**Behavior confirmed:** Calling `stop()` on the pipeline terminates further dequeue iterations; the `toggle_llm` MCP tool coordinates shutdown/restart of the pipeline and persists the enabled state across restarts.

---

## LLM-07: LLM calls have token budget limits and rate limiting to prevent runaway costs

**Status:** VERIFIED
**Evidence:**
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should back off and not call LLM when budget guard is exhausted`
- Code inspection: `src/llm/rate-limiter.ts` `TokenBudgetGuard` — sliding-window per-minute counter + lifetime budget cap with `isExhausted()` circuit breaker
**Behavior confirmed:** When the `TokenBudgetGuard` signals exhaustion, the pipeline backs off without calling the LLM, preventing runaway API costs from automated background processing.

---

## LLM-08: When LLM is off, semantic metadata fields return null with appropriate staleness indicators

**Status:** VERIFIED (code inspection)
**Evidence:**
- Code inspection: `src/mcp-server.ts` lines 333-334 — `concepts: llmData?.concepts ? JSON.parse(llmData.concepts) : null`
- Code inspection: `src/mcp-server.ts` lines 403-404 — `changeImpact: llmData?.change_impact ? JSON.parse(llmData.change_impact) : null`
- Code inspection: `src/mcp-server.ts` staleness injection pattern — `conceptsStale` and `changeImpactStale` included when non-null (CASC-03 pattern)
**Behavior confirmed:** MCP tools unconditionally return `null` for `concepts` and `changeImpact` when the DB columns are null (i.e., LLM has never run or pipeline is off); no conditional "LLM enabled" branch exists — null fields self-document the absent state.

---

## COMPAT-02: Existing exclude patterns are honored by the LLM pipeline (no LLM calls on excluded files)

**Status:** VERIFIED
**Evidence:**
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should mark excluded file job as done without calling LLM`
- Code inspection: `src/llm/pipeline.ts` lines 123-130 — `isExcluded(job.file_path, projectRoot)` check marks job done without invoking LLM
**Behavior confirmed:** When a dequeued job's file path matches the project's exclude patterns, the pipeline marks the job as done immediately without making any LLM call, honoring existing user-configured exclusions.
