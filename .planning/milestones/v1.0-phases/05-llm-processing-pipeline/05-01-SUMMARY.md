---
phase: 05-llm-processing-pipeline
plan: 01
subsystem: llm
tags: [ai-sdk, anthropic, openai-compatible, zod, rate-limiting, sqlite, drizzle]

# Dependency graph
requires:
  - phase: 04-cascade-engine-staleness
    provides: staleness columns, markStale, getStaleness, llm_jobs table, insertLlmJobIfNotPending
  - phase: 01-sqlite-storage
    provides: better-sqlite3 DB layer, Drizzle schema, repository pattern, migration system
provides:
  - src/llm/types.ts — LLMConfig interface, LLMConfigSchema, ConceptsSchema, ChangeImpactSchema, inferred types
  - src/llm/adapter.ts — createLLMModel() factory returning LanguageModel for anthropic and openai-compatible providers
  - src/llm/rate-limiter.ts — TokenBudgetGuard with sliding-window RPM and lifetime token budget
  - src/llm/prompts.ts — buildSummaryPrompt, buildConceptsPrompt, buildChangeImpactPrompt templates
  - Config.llm optional field validated by Zod LLMConfigSchema
  - files.concepts and files.change_impact TEXT columns (JSON blobs)
  - llm_runtime_state table for token budget persistence
  - dequeueNextJob, markJobInProgress/Done/Failed, writeLlmResult, clearStaleness, recoverOrphanedJobs, loadLlmRuntimeState, saveLlmRuntimeState in repository.ts
affects: [05-02, 05-03] # LLMPipeline and toggle MCP tool plans

# Tech tracking
tech-stack:
  added:
    - ai@^6 (Vercel AI SDK — generateText, Output.object())
    - "@ai-sdk/anthropic@^3 — Anthropic Claude provider"
    - "@ai-sdk/openai-compatible — OpenAI-compat endpoints (Ollama, vLLM, OpenRouter)"
  patterns:
    - Provider factory pattern (createLLMModel returns LanguageModel regardless of provider)
    - TokenBudgetGuard hand-rolled sliding-window rate limiter (30 lines, SQLite-integrated)
    - Config extension via Zod optional schema (LLMConfigSchema added to ConfigSchema)
    - Repository pattern extended with raw better-sqlite3 prepared statements for job management

key-files:
  created:
    - src/llm/types.ts
    - src/llm/adapter.ts
    - src/llm/rate-limiter.ts
    - src/llm/prompts.ts
    - drizzle/0002_add_llm_columns.sql
  modified:
    - src/types.ts — added llm?: LLMConfig to Config interface
    - src/config-utils.ts — added LLMConfigSchema to ConfigSchema
    - src/db/schema.ts — added concepts/change_impact columns to files table, added llm_runtime_state table
    - src/db/repository.ts — added 9 new job management and runtime state functions
    - drizzle/meta/_journal.json — registered migration 0002

key-decisions:
  - "LanguageModel (not LanguageModelV2) is the correct type export from ai@6 — LanguageModelV2 is re-exported from @ai-sdk/provider but not directly exported from the ai package main entrypoint"
  - "Migration SQL uses -->statement-breakpoint inline (not block comments) — Drizzle migrator treats comment lines preceding breakpoints as empty SQL statements causing RangeError"
  - "tokenBudget=0 means unlimited (not zero-budget) in TokenBudgetGuard — avoids footgun of blocking all calls by default"

patterns-established:
  - "Pattern: LLM adapter factory — createLLMModel(config) returns LanguageModel; callers never reference provider-specific objects"
  - "Pattern: TokenBudgetGuard — canConsume(estimated) → recordActual(actual) call pair around every LLM call"
  - "Pattern: clearStaleness() called after successful writeLlmResult() — ensures staleness cleared atomically with result write"

requirements-completed: [LLM-04, LLM-05, LLM-07]

# Metrics
duration: 15min
completed: 2026-03-18
---

# Phase 5 Plan 01: LLM Infrastructure Summary

**Vercel AI SDK adapter layer with Anthropic/OpenAI-compatible provider factory, hand-rolled token budget guard, prompt templates, schema migration for concepts/change_impact columns, and repository job management functions.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-03-18T05:20:00Z
- **Completed:** 2026-03-18T05:35:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created `src/llm/` module with types, adapter, rate-limiter, and prompts — all contracts Plan 02's LLMPipeline needs
- Extended Config interface and Zod schema with optional `llm` section; validates at startup without breaking existing configs
- Added `concepts` and `change_impact` TEXT columns to files table with Drizzle migration; added `llm_runtime_state` key-value table
- Added 9 new repository functions for job dequeue, status management, result writing, staleness clearing, orphan recovery, and runtime state persistence

## Task Commits

Each task was committed atomically:

1. **Task 1: LLM types, config extension, and adapter factory** - `3d31bc3` (feat)
2. **Task 2: Rate limiter, prompts, schema extension, and repository job management** - `31e1f2f` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified
- `src/llm/types.ts` — LLMConfig interface, LLMConfigSchema, ConceptsSchema, ChangeImpactSchema, ConceptsResult, ChangeImpactResult
- `src/llm/adapter.ts` — createLLMModel() for anthropic and openai-compatible providers
- `src/llm/rate-limiter.ts` — TokenBudgetGuard with sliding-window RPM + lifetime budget circuit breaker
- `src/llm/prompts.ts` — buildSummaryPrompt, buildConceptsPrompt, buildChangeImpactPrompt
- `src/types.ts` — added `llm?: LLMConfig` to Config interface
- `src/config-utils.ts` — added `llm: LLMConfigSchema` to ConfigSchema
- `src/db/schema.ts` — added concepts/change_impact columns to files table, added llm_runtime_state table
- `src/db/repository.ts` — dequeueNextJob, markJobInProgress/Done/Failed, writeLlmResult, clearStaleness, recoverOrphanedJobs, loadLlmRuntimeState, saveLlmRuntimeState
- `drizzle/0002_add_llm_columns.sql` — ALTER TABLE + CREATE TABLE migration
- `drizzle/meta/_journal.json` — registered migration 0002

## Decisions Made
- `LanguageModel` (not `LanguageModelV2`) is the correct type from `ai@6` — `LanguageModelV2` is re-exported from `@ai-sdk/provider` but not from the `ai` package's top-level entrypoint. Plan docs referenced `LanguageModelV2`; auto-corrected to `LanguageModel` (Rule 1 - Type Error).
- Migration SQL breakpoints must be inline (`-->statement-breakpoint`) not in comment lines — Drizzle's migrator parses block-comment lines before `-->` as empty SQL statements, causing `RangeError: The supplied SQL string contains no statements`.
- `tokenBudget=0` in TokenBudgetGuard means unlimited — avoids footgun where default construction would block all calls.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used LanguageModel instead of LanguageModelV2 in adapter.ts**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** Plan specified `import type { LanguageModelV2 } from 'ai'` but ai@6 does not export `LanguageModelV2` from its top-level entrypoint; it exports `LanguageModel` (which is `LanguageModelV3 | LanguageModelV2`)
- **Fix:** Changed type import and return type to `LanguageModel` — functionally equivalent and correct per SDK
- **Files modified:** src/llm/adapter.ts
- **Verification:** `npx tsc --noEmit` passes with zero errors
- **Committed in:** 3d31bc3 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed migration SQL format to avoid Drizzle RangeError**
- **Found during:** Task 2 verification (`npm test`)
- **Issue:** Migration file had comment lines above `-->statement-breakpoint` markers; Drizzle migrator parsed the comment content as separate SQL statements causing `RangeError: The supplied SQL string contains no statements`
- **Fix:** Removed block comments; placed `-->statement-breakpoint` inline at end of each statement per existing migration file format
- **Files modified:** drizzle/0002_add_llm_columns.sql
- **Verification:** All 157 tests pass
- **Committed in:** 31e1f2f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
- None beyond the two auto-fixed bugs above.

## Next Phase Readiness
- All LLM infrastructure contracts in place for Plan 02's LLMPipeline dequeue loop
- createLLMModel(), TokenBudgetGuard, prompt builders, dequeueNextJob, writeLlmResult, clearStaleness all ready to consume
- No runtime LLM calls in this plan — all testing deferred to Plan 02/03 per plan spec

---
*Phase: 05-llm-processing-pipeline*
*Completed: 2026-03-18*
