# Phase 8: Integration Fixes - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix 4 integration bugs and tech debt identified in the v1.0 re-audit: toggle_llm first-call sequencing, MCP exposure of concepts/change_impact, budget exhaustion circuit breaker, LLM diff dedup, and remaining tech debt items. No new capabilities — making existing systems work correctly together.

</domain>

<decisions>
## Implementation Decisions

### Toggle_llm Default Config (Local-First)
- When `toggle_llm(true)` is called with no prior LLM config, synthesize config BEFORE calling `coordinator.toggleLlm()`
- Default provider: `openai-compatible` (Ollama) — local-first, free, no API key needed
- Default model: `qwen3-coder:14b-instruct` (code-specialized, fits 16GB VRAM)
- Default baseURL: `http://localhost:11434/v1` (standard Ollama endpoint)
- If Ollama isn't running, jobs stay queued and retry — graceful degradation
- Users who want Anthropic cloud configure it explicitly in their config file

### MCP Exposure of Concepts/Change_Impact
- Extend existing `get_file_summary` tool to include `concepts` and `changeImpact` fields in the response
- No new dedicated tools — one call returns all LLM-generated metadata
- Response shape adds two fields: `concepts` (JSON array/object or null) and `changeImpact` (JSON object or null)
- Also add these fields to `get_file_importance` for consistency (it already returns summary)
- Backward compatible: existing response fields unchanged, new fields are additive

### Budget Exhaustion Visibility
- Add new `get_llm_status` MCP tool returning: `{ enabled, running, budgetExhausted, lifetimeTokensUsed, tokenBudget, maxTokensPerMinute }`
- Reads from existing coordinator/pipeline state — no new infrastructure
- Especially useful for diagnosing connection failures with local LLMs (not just budget issues)

### Circuit Breaker Placement
- Check `isExhausted()` at insertion time (before `insertLlmJobIfNotPending`) not just at dequeue time
- Expose `isExhausted()` through the coordinator (which holds the pipeline reference)
- Cascade engine and change detector check via coordinator before inserting jobs
- Prevents filling the queue with jobs that will never run

### Claude's Discretion
- Exact error message wording for toggle_llm failures
- get_llm_status response field naming
- Implementation approach for threading isExhausted through to cascade engine (function parameter, module-level accessor, etc.)

</decisions>

<specifics>
## Specific Ideas

- User strongly prefers local LLMs for all background metadata work — these tasks (summaries, concepts, change impact) are small and well-suited to local 7B-14B models
- Qwen3-Coder-14B-Instruct chosen specifically as best code model for 16GB VRAM budget
- GPT-OSS-20B (MoE variant) mentioned as a secondary preference — model fallback logic deferred to future work

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createLLMModel` (src/llm/adapter.ts): Already supports `openai-compatible` provider with Ollama defaults
- `LLMConfigSchema` (src/llm/types.ts): Has Zod schema with safe defaults — can be leveraged for config synthesis
- `TokenBudgetGuard.isExhausted()` (src/llm/rate-limiter.ts): Circuit breaker exists, just needs to be exposed
- `insertLlmJobIfNotPending` (src/db/repository.ts): Dedup function exists, just needs to replace `insertLlmJob` calls
- `getStaleness` (src/db/repository.ts): Pattern for reading file metadata columns — extend for concepts/change_impact

### Established Patterns
- MCP tool handlers in `registerTools()` (src/mcp-server.ts) follow closure-capture pattern with coordinator
- Coordinator is the bridge between MCP surface and internal subsystems
- LLM results stored as JSON text columns in files table (concepts, change_impact columns exist in schema)

### Integration Points
- `mcp-server.ts:637-660`: toggle_llm handler — sequencing fix goes here
- `mcp-server.ts:370-394`: get_file_summary handler — extend response here
- `mcp-server.ts:295-334`: get_file_importance handler — add concepts/changeImpact here
- `coordinator.ts:133-144`: toggleLlm method — config must exist before this runs
- `cascade/cascade-engine.ts`: cascadeStale calls insertLlmJobIfNotPending — add isExhausted guard
- `change-detector/llm-diff-fallback.ts`: queueLlmDiffJob — switch from insertLlmJob to insertLlmJobIfNotPending

</code_context>

<deferred>
## Deferred Ideas

- Model fallback chain: try primary model, if unavailable try secondary (GPT-OSS-20B) — future phase
- Ollama connection health check / auto-detection on toggle_llm — future enhancement
- Model recommendation based on available VRAM — out of scope

</deferred>

---

*Phase: 08-integration-fixes*
*Context gathered: 2026-03-18*
