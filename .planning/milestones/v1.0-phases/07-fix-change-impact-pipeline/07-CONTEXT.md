# Phase 7: Fix change_impact Pipeline - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the LLM diff fallback (`queueLlmDiffJob`) into the production code path so non-TS/JS file changes produce diff payloads, cascade jobs carry non-null payloads, and the LLM pipeline can process change_impact assessments end-to-end. Replace `console.warn` in ast-parser.ts with `logger.warn`. This is gap closure work — no new capabilities, just connecting existing layers that were built in Phases 3 and 5.

</domain>

<decisions>
## Implementation Decisions

### Diff source for non-TS/JS files
- Use `git diff HEAD -- <file>` as the primary diff source for unsupported languages
- Zero schema changes needed — git is universally available in dev environments
- If git is unavailable or file is untracked (no diff output), fall back to reading the current file content and annotating it as "new/untracked file" for the LLM
- The diff (or content fallback) is passed directly to `queueLlmDiffJob`, which already handles truncation at 16KB and inserts into llm_jobs with the payload

### Cascade job payloads
- Extend `insertLlmJobIfNotPending` to accept an optional `payload` parameter
- For the **originally changed file**: `queueLlmDiffJob` handles this path (already exists, just needs wiring)
- For **cascade dependent files**: construct a payload containing the upstream file path, change type, and the dependent file's own content — the LLM needs both "what changed upstream" and "what does this file do" to assess cross-file impact
- `cascadeStale` in cascade-engine.ts needs to accept and propagate a change description to downstream jobs

### First-change bootstrapping
- `git diff` naturally handles most cases (file was committed before the change)
- For truly first-seen files (created but never committed), pass the full file content as the diff payload with a "new file" annotation
- No proactive content caching on first scan — that's premature optimization for a rare edge case
- The LLM generates a baseline impact assessment rather than a comparative one

### Logger cleanup
- Replace `console.warn` at ast-parser.ts:128 with `logger.warn` (or `log()` to match existing patterns)
- Straightforward find-and-replace, no behavioral changes

### Claude's Discretion
- Exact format of the "new/untracked file" annotation string passed to the LLM
- Whether to shell out to git via child_process.execSync or use a lightweight git library
- Exact payload construction format for cascade dependent jobs (plain text description vs structured JSON)
- Whether the git diff helper belongs in change-detector/ or a shared util

</decisions>

<specifics>
## Specific Ideas

- The `_classifyWithLlmFallback` method in change-detector.ts currently returns a hardcoded unknown summary without calling `queueLlmDiffJob` — this is the primary wiring gap
- `insertLlmJobIfNotPending` in cascade-engine.ts:39 queues change_impact jobs without payloads — pipeline.ts:200-203 then throws `no_payload`, silently failing the entire chain
- The fix is surgical: wire existing functions together, extend one function signature, add a git diff helper

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `queueLlmDiffJob` (src/change-detector/llm-diff-fallback.ts): Fully implemented — truncates diff, inserts llm_job with payload, returns conservative SemanticChangeSummary. Just needs to be called.
- `insertLlmJob` (src/db/repository.ts): Low-level job insert with payload support. Used by queueLlmDiffJob.
- `insertLlmJobIfNotPending` (src/db/repository.ts): Dedup-aware job insert — currently lacks payload parameter. Needs extension.
- `buildChangeImpactPrompt` (src/llm/prompts.ts): Prompt template that accepts (filePath, payload). Already handles the LLM side.

### Established Patterns
- `child_process` usage: Not currently used in the codebase — git diff would be the first shell-out. Keep it simple with execSync.
- Logging: All modules use `log()` from src/logger.ts. ast-parser.ts is the only file using `console.warn`.
- Error handling in change detection: Non-fatal — log and return conservative 'unknown' summary (affectsDependents=true).

### Integration Points
- `ChangeDetector._classifyWithLlmFallback` (change-detector.ts:84) -> needs to call `queueLlmDiffJob` with git diff output
- `cascadeStale` (cascade-engine.ts:37-39) -> `insertLlmJobIfNotPending` for change_impact needs payload
- `LLMPipeline.runJob` (pipeline.ts:199-224) -> already handles change_impact with payload, no changes needed
- Coordinator `handleFileEvent` (coordinator.ts:464-490) -> orchestrates the flow, may need to pass diff context to cascade

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 07-fix-change-impact-pipeline*
*Context gathered: 2026-03-18*
