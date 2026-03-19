# Phase 5: LLM Processing Pipeline - Research

**Researched:** 2026-03-17
**Domain:** LLM provider abstraction, background job processing, rate limiting, TypeScript
**Confidence:** HIGH (stack verified via official docs; Ollama structured-output caveat verified via multiple sources)

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LLM-01 | Background LLM automatically generates/updates file summaries when a file or its dependencies change | LLMPipeline dequeue loop reads `llm_jobs` table (already populated by CascadeEngine); writes results to `files.summary`; clears `summary_stale_since` |
| LLM-02 | Background LLM auto-extracts structured concepts per file (functions, classes, interfaces, exports) as structured JSON | `generateText` + `Output.object()` with Zod schema; writes to `files.concepts` column (new column needed in schema) |
| LLM-03 | Background LLM auto-assesses change impact per file as structured JSON | `generateText` + `Output.object()` with Zod schema; writes to `files.change_impact` column (new column needed) |
| LLM-04 | LLM provider configurable — any OpenAI-compatible endpoint, Anthropic API, others | `@ai-sdk/anthropic` for Anthropic; `@ai-sdk/openai-compatible` for any OpenAI-compat/Ollama; adapter factory pattern in `LLMAdapter` |
| LLM-05 | User configures provider via base URL + model name + API key in config file | Extend `Config` type with `llm` section; Zod schema validates at startup; `LLMAdapter` consumes config |
| LLM-06 | Background LLM can be toggled on/off via config or MCP tool — system works fully without it | `llm.enabled` config flag; `LLMPipeline` checks flag before dequeue; toggle MCP tool writes config and hot-restarts pipeline |
| LLM-07 | LLM calls have token budget limits and rate limiting to prevent runaway costs | `TokenBudgetGuard` (hand-rolled — see Don't Hand-Roll section for why) tracks tokens-per-minute and total budget; circuit breaker stops queuing on exhaustion |
| LLM-08 | When LLM is off, semantic metadata fields return null with appropriate staleness indicators | Already implemented via `getStaleness()` + MCP staleness injection; `null` fields + `staleness` object already returned for stale files |
| COMPAT-02 | Existing exclude patterns honored by LLM pipeline — no LLM calls on excluded files | `isExcluded()` exists in `file-utils.ts`; LLMPipeline must check this before processing any job |
</phase_requirements>

---

## Summary

Phase 5 builds the background LLM pipeline that consumes the `llm_jobs` SQLite queue created by Phases 3 and 4. The queue already exists and is populated; Phase 5 adds the dequeue loop, LLM adapter, result writer, rate limiter, and on/off toggle. The infrastructure from prior phases (better-sqlite3, Drizzle ORM, CascadeEngine, `insertLlmJobIfNotPending`, `markStale`) is all in place and can be used without changes.

The Vercel AI SDK (package `ai`, version 6.0.x) is the correct choice for provider abstraction. The primary challenge is that `generateObject` is deprecated in v6 — the new pattern is `generateText` with `Output.object()` + Zod schema. For Ollama specifically, structured output reliability varies by model; the Anthropic provider and any OpenAI-compatible endpoint via `@ai-sdk/openai-compatible` work reliably. The research confirms the blocker noted in STATE.md: `generateObject` with Ollama has known JSON bugs in certain models, and the `mode: "tool"` workaround was removed in v5+. The plan must use `generateText + Output.object()` (the v6 pattern) and include a JSON-repair fallback for Ollama.

Rate limiting must be hand-rolled because no npm library cleanly integrates with both an SQLite-backed job queue and a circuit-breaker that writes error state to the DB. The pattern is straightforward: a sliding-window token counter per minute and a lifetime budget counter, both stored in-memory with the circuit-breaker state persisted to SQLite on exhaustion. The `isExcluded()` function in `file-utils.ts` already implements the exclude-pattern check; the pipeline must call it before processing each job.

**Primary recommendation:** Use `ai@^6` + `@ai-sdk/anthropic` + `@ai-sdk/openai-compatible` for the adapter layer; hand-roll rate limiting; call `isExcluded()` in the dequeue loop; use `generateText` + `Output.object()` (not the deprecated `generateObject`).

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ai` | ^6.0.116 | Unified LLM call API (generateText, Output.object) | Official Vercel AI SDK; single import for all providers; actively maintained |
| `@ai-sdk/anthropic` | ^3.0.58 | Anthropic Claude provider | Official provider; native structured output for Claude Sonnet 4.5+; reliable `Output.object()` |
| `@ai-sdk/openai-compatible` | latest | OpenAI-compatible endpoints (Ollama, vLLM, OpenRouter, etc.) | Official SDK package; `createOpenAICompatible({ baseURL, apiKey })` covers all REST-compatible providers |
| `zod` | ^3.25.28 | Schema definition for structured output | Already in project dependencies; used throughout codebase |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-sqlite3` | ^12.6.2 | Persisting job status, circuit-breaker state | Already in project; rate limit exhaustion writes error to `llm_jobs` row |
| `drizzle-orm` | ^0.45.1 | Job queries via typed ORM | Already in project; use for SELECT/UPDATE on `llm_jobs` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@ai-sdk/openai-compatible` (for Ollama) | `ollama-ai-provider` community package | Community package adds reliability wrappers but is unmaintained long-term; official package is simpler and sufficient for non-streaming use |
| Hand-rolled rate limiter | `@aid-on/llm-throttle` | `llm-throttle` is pure in-memory (no SQLite integration) and doesn't write circuit-breaker state to DB; hand-rolling is 30 lines and gives full control |
| `generateText + Output.object()` | `generateObject` (deprecated) | `generateObject` removed in v7; use new Output API now to avoid migration later |

**Installation:**

```bash
npm install ai @ai-sdk/anthropic @ai-sdk/openai-compatible
```

Note: `zod`, `better-sqlite3`, and `drizzle-orm` are already installed.

---

## Architecture Patterns

### Recommended Project Structure

```
src/
├── llm/
│   ├── adapter.ts           # LLMAdapter: provider factory, generateText wrapper
│   ├── pipeline.ts          # LLMPipeline: dequeue loop, job dispatch, result write
│   ├── prompts.ts           # Prompt templates for summary, concepts, change_impact
│   ├── rate-limiter.ts      # TokenBudgetGuard: sliding-window RPM + lifetime budget
│   └── types.ts             # LLMConfig, LLMProvider interfaces, output Zod schemas
├── db/
│   ├── schema.ts            # (extend: add concepts + change_impact TEXT columns)
│   └── repository.ts        # (extend: writeLlmResult, dequeueNextJob, markJobDone/Failed)
└── coordinator.ts           # (extend: init LLMPipeline, wire toggle MCP tool)
```

### Pattern 1: LLMAdapter — Provider Factory

**What:** A thin factory that reads `llm.provider` from config and returns a configured AI SDK model object. All callers use the same `model` reference regardless of provider.

**When to use:** Everywhere an LLM call is made (summary, concepts, change_impact prompts).

```typescript
// Source: https://ai-sdk.dev/providers/ai-sdk-providers/anthropic
//         https://ai-sdk.dev/providers/openai-compatible-providers
import { anthropic, createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModelV2 } from 'ai';
import type { LLMConfig } from './types.js';

export function createLLMModel(config: LLMConfig): LanguageModelV2 {
  switch (config.provider) {
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
        // baseURL override supported — useful for Anthropic-compatible proxies
      });
      return provider(config.model);
    }
    case 'openai-compatible': {
      const provider = createOpenAICompatible({
        name: 'custom',
        baseURL: config.baseURL!,
        apiKey: config.apiKey ?? 'ollama', // Ollama ignores the key but SDK requires it
      });
      return provider(config.model);
    }
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
```

### Pattern 2: generateText + Output.object() (v6 Pattern)

**What:** AI SDK v6 deprecated `generateObject`. Use `generateText` with `Output.object()` for all structured output.

**When to use:** concepts extraction (LLM-02) and change_impact assessment (LLM-03). Summary (LLM-01) uses plain `generateText` without Output.

```typescript
// Source: https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0
import { generateText, Output } from 'ai';
import { z } from 'zod';

const ConceptsSchema = z.object({
  functions: z.array(z.string()),
  classes: z.array(z.string()),
  interfaces: z.array(z.string()),
  exports: z.array(z.string()),
  purpose: z.string(),
});

const { output } = await generateText({
  model,
  output: Output.object({ schema: ConceptsSchema }),
  prompt: conceptsPrompt(fileContent),
  maxTokens: config.maxTokensPerCall ?? 1024,
});
// output is typed as z.infer<typeof ConceptsSchema>
```

### Pattern 3: Dequeue Loop

**What:** A polling loop that reads the highest-priority pending job from `llm_jobs`, acquires a rate-limit slot, executes the LLM call, and writes the result to `files`.

**When to use:** LLMPipeline constructor starts the loop; `stop()` signals it to exit.

```typescript
// Pseudocode — actual implementation in src/llm/pipeline.ts
async function dequeueLoop(): Promise<void> {
  while (!stopped) {
    const job = dequeueNextJob(); // SELECT ... ORDER BY priority_tier ASC, created_at ASC LIMIT 1
    if (!job) { await sleep(POLL_INTERVAL_MS); continue; }

    // COMPAT-02: skip excluded files
    if (isExcluded(job.file_path, projectRoot)) {
      markJobDone(job.job_id, 'skipped');
      continue;
    }

    // Rate limit check
    const slot = await budgetGuard.acquire(estimatedTokens);
    if (!slot) { await sleep(BACKOFF_MS); continue; }

    try {
      markJobInProgress(job.job_id);
      const result = await runJob(job);
      writeLlmResult(job.file_path, job.job_type, result);
      clearStaleness(job.file_path, job.job_type);
      markJobDone(job.job_id);
      budgetGuard.recordActual(result.usage.totalTokens);
    } catch (err) {
      markJobFailed(job.job_id, String(err));
      budgetGuard.recordError();
    }
  }
}
```

### Pattern 4: TokenBudgetGuard (Hand-Rolled)

**What:** Tracks tokens-per-minute (RPM guard) and lifetime token budget. Circuit breaker stops queuing when budget exhausted.

```typescript
// src/llm/rate-limiter.ts
export class TokenBudgetGuard {
  private windowTokens = 0;
  private windowStart = Date.now();
  private lifetimeTokens = 0;
  private exhausted = false;

  canConsume(estimatedTokens: number): boolean {
    if (this.exhausted) return false;
    this.rotateWindowIfNeeded();
    return (
      this.windowTokens + estimatedTokens <= this.maxTokensPerMinute &&
      this.lifetimeTokens + estimatedTokens <= this.tokenBudget
    );
  }

  recordActual(actualTokens: number): void {
    this.windowTokens += actualTokens;
    this.lifetimeTokens += actualTokens;
    if (this.lifetimeTokens >= this.tokenBudget) {
      this.exhausted = true;
      writeBudgetExhausted(); // write error state to SQLite
    }
  }

  private rotateWindowIfNeeded(): void {
    if (Date.now() - this.windowStart > 60_000) {
      this.windowTokens = 0;
      this.windowStart = Date.now();
      this.exhausted = false; // Reset per-minute exhaustion (not lifetime)
    }
  }
}
```

### Pattern 5: Config Extension with Zod

**What:** Extend existing `Config` type and `ConfigSchema` in `config-utils.ts` with `llm` section.

```typescript
// Extension to src/config-utils.ts and src/types.ts
export interface LLMConfig {
  enabled: boolean;
  provider: 'anthropic' | 'openai-compatible';
  model: string;
  baseURL?: string;         // required for openai-compatible
  apiKey?: string;          // overrides env var
  maxTokensPerCall?: number; // default 1024
  maxTokensPerMinute?: number; // default 40000
  tokenBudget?: number;     // lifetime cap, default unlimited
}

// Zod schema (config-utils.ts)
const LLMConfigSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['anthropic', 'openai-compatible']).default('anthropic'),
  model: z.string().default('claude-3-haiku-20240307'),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  maxTokensPerCall: z.number().int().positive().optional(),
  maxTokensPerMinute: z.number().int().positive().optional(),
  tokenBudget: z.number().int().positive().optional(),
}).optional();
```

### Pattern 6: Schema Extension (new columns)

**What:** `files` table needs `concepts` and `change_impact` TEXT columns. These are JSON blobs, same pattern as `exports_snapshot`. No migration runner needed — add to schema and use `ALTER TABLE ADD COLUMN IF NOT EXISTS` in the startup migration check.

```typescript
// Addition to src/db/schema.ts
export const files = sqliteTable('files', {
  // ... existing columns ...
  concepts:       text('concepts'),       // JSON blob: ConceptsResult | null
  change_impact:  text('change_impact'),  // JSON blob: ChangeImpactResult | null
});
```

```sql
-- Run in runMigrationIfNeeded or a dedicated schema-upgrade step
ALTER TABLE files ADD COLUMN IF NOT EXISTS concepts TEXT;
ALTER TABLE files ADD COLUMN IF NOT EXISTS change_impact TEXT;
```

Note: SQLite `ALTER TABLE ADD COLUMN IF NOT EXISTS` is supported in SQLite 3.37.0+. Alternatively use `pragma table_info()` to check before adding.

### Anti-Patterns to Avoid

- **Calling `generateObject` directly:** Deprecated in v6; breaks in v7. Use `generateText + Output.object()` exclusively.
- **Sharing a single API key across all job types:** Hard to debug cost attribution; makes rate limit exhaustion opaque.
- **Running `dequeueLoop` without a mutex or debounce:** The loop must be the single consumer; starting it twice (e.g., if coordinator.init is called twice) creates duplicate job processing.
- **Writing LLM results without checking generation counters:** Multiple jobs for the same file (e.g., from rapid file saves) can race. Use the job_id as a generation token — only write if the job row is still `in_progress` when the call returns.
- **Not calling `isExcluded()` in the dequeue loop:** Files added to exclude patterns after initial scan still exist as `llm_jobs` rows; they must be skipped at dequeue time (COMPAT-02).
- **Blocking coordinator init waiting for LLM warmup:** LLMPipeline must start asynchronously and not delay MCP server readiness.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Provider-specific LLM API calls | Custom HTTP fetch to Anthropic / OpenAI | `ai` + `@ai-sdk/anthropic` / `@ai-sdk/openai-compatible` | Provider auth, retry, streaming, error normalization already handled |
| Structured output JSON parsing | Prompt engineering + JSON.parse + retry | `generateText + Output.object()` | SDK handles schema enforcement, auto-retry on validation failure, provider-specific mode selection |
| OpenAI-compatible endpoint wiring | Custom HTTP client with Bearer auth | `@ai-sdk/openai-compatible` | Handles auth headers, base URL, request body format, and response normalization |
| Zod schema definition for output shapes | Custom TypeScript interfaces + manual validation | `zod` (already installed) | Type-safe at compile time AND runtime; descriptions improve LLM accuracy |

**Key insight:** The Vercel AI SDK's value is normalizing 20+ provider quirks (auth, request shape, response shape, error codes, retry strategies) into a single `generateText` call. Any custom HTTP client replicates this work incorrectly.

---

## Common Pitfalls

### Pitfall 1: Using `generateObject` (Deprecated in v6)

**What goes wrong:** Code compiles and runs but triggers deprecation warnings; will break when v7 removes it.
**Why it happens:** Training data and examples from 2024 use `generateObject`; AI SDK v6 changed the API.
**How to avoid:** Import `Output` from `ai` and use `generateText({ output: Output.object({ schema }) })` exclusively.
**Warning signs:** TypeScript deprecation strikethrough in IDE; `AI_SDK_LOG_WARNINGS` output in logs.

### Pitfall 2: Ollama Structured Output Failures

**What goes wrong:** `generateText + Output.object()` with Ollama returns malformed JSON or times out on certain models (llama3, phi3 especially).
**Why it happens:** Ollama JSON mode is model-dependent; some local models produce trailing commas, Python-style constants (`True`/`False`), or incomplete JSON.
**How to avoid:** For Ollama, wrap in try/catch; on parse failure, fall back to plain `generateText` and extract JSON from the text response manually with a lenient parser. Alternatively, use `ollama-ai-provider` community package which includes a cascade JSON-repair strategy.
**Warning signs:** `JSON.parse` errors in LLMPipeline logs; `failed` rows in `llm_jobs` table.

### Pitfall 3: Job Duplication on Process Restart

**What goes wrong:** On restart, `in_progress` jobs from before the crash are stuck forever; new jobs duplicate them.
**Why it happens:** Jobs set to `in_progress` by a crashed process are never reset.
**How to avoid:** On `LLMPipeline.start()`, run: `UPDATE llm_jobs SET status = 'pending', started_at = NULL WHERE status = 'in_progress'` to recover orphaned jobs.
**Warning signs:** Growing count of `in_progress` rows in `llm_jobs` that never complete.

### Pitfall 4: Rate Limit Budget Not Persisted

**What goes wrong:** After restart, `lifetimeTokens` resets to 0, allowing more calls than the configured budget.
**Why it happens:** In-memory counter doesn't survive process exit.
**How to avoid:** Add a `llm_budget_state` table (or a single row in `schema_version` extended) that records `lifetime_tokens_used`. Read it on startup; write it after each call.
**Warning signs:** Budget exhaustion never triggers across restarts; costs grow unbounded.

### Pitfall 5: Config Change Not Picked Up by Running Pipeline

**What goes wrong:** User sets `llm.enabled: false` in config file but pipeline keeps running.
**Why it happens:** Config loaded once at startup; no hot-reload.
**How to avoid:** The MCP toggle tool (LLM-06) directly calls `pipeline.stop()` / `pipeline.start()` rather than relying on config file polling. Config file change alone does not hot-reload — document this clearly.
**Warning signs:** Toggle MCP tool returns success but jobs keep processing.

### Pitfall 6: Blocking the Coordinator Event Loop

**What goes wrong:** LLM calls (which are async HTTP) block file event handling.
**Why it happens:** If `dequeueLoop` runs in the same async chain as `handleFileEvent`, it can starve the event loop.
**How to avoid:** `LLMPipeline` runs its dequeue loop independently via `setInterval` or a self-scheduling `setTimeout` chain. Never `await pipeline.dequeueLoop()` inside coordinator methods.
**Warning signs:** File events queue up but don't process while LLM calls are in flight.

### Pitfall 7: SQLite `ALTER TABLE ADD COLUMN IF NOT EXISTS` Not Available in Old SQLite

**What goes wrong:** `ALTER TABLE files ADD COLUMN IF NOT EXISTS concepts TEXT` throws `syntax error` on SQLite < 3.37.0.
**Why it happens:** `IF NOT EXISTS` for `ADD COLUMN` was added in SQLite 3.37.0 (2021). Some Node.js environments ship older SQLite versions.
**How to avoid:** Use `pragma table_info('files')` to check if `concepts` column exists before attempting `ALTER TABLE`. Wrap in a try/catch as a fallback.
**Warning signs:** DB open fails after deploy on older SQLite version.

---

## Code Examples

Verified patterns from official sources:

### generateText with plain text output (summary — LLM-01)

```typescript
// Source: https://ai-sdk.dev/docs/introduction
import { generateText } from 'ai';
import type { LanguageModelV2 } from 'ai';

export async function generateSummary(
  model: LanguageModelV2,
  fileContent: string,
  filePath: string,
): Promise<string> {
  const { text, usage } = await generateText({
    model,
    prompt: `Summarize the purpose of this file in 2-3 sentences:\n\n${fileContent}`,
    maxTokens: 256,
  });
  return text.trim();
}
```

### generateText with structured output (concepts — LLM-02)

```typescript
// Source: https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0
import { generateText, Output } from 'ai';
import { z } from 'zod';

const ConceptsSchema = z.object({
  functions: z.array(z.string()).describe('exported function names'),
  classes: z.array(z.string()).describe('exported class names'),
  interfaces: z.array(z.string()).describe('exported interface/type names'),
  exports: z.array(z.string()).describe('all top-level export names'),
  purpose: z.string().describe('one-sentence description of the file purpose'),
});

export async function extractConcepts(
  model: LanguageModelV2,
  fileContent: string,
): Promise<z.infer<typeof ConceptsSchema>> {
  const { output, usage } = await generateText({
    model,
    output: Output.object({ schema: ConceptsSchema }),
    prompt: `Extract structured concepts from this file:\n\n${fileContent}`,
    maxTokens: 512,
  });
  return output;
}
```

### createOpenAICompatible for Ollama / generic endpoints

```typescript
// Source: https://ai-sdk.dev/providers/openai-compatible-providers
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const provider = createOpenAICompatible({
  name: 'ollama',
  baseURL: 'http://localhost:11434/v1',
  apiKey: 'ollama', // Ollama ignores the key; SDK requires non-empty string
});

const model = provider('llama3.2');
```

### Recover orphaned in_progress jobs on startup

```typescript
// Source: project pattern — raw better-sqlite3 per Phase 4 decisions
import { getSqlite } from '../db/db.js';

export function recoverOrphanedJobs(): void {
  getSqlite()
    .prepare(
      "UPDATE llm_jobs SET status = 'pending', started_at = NULL WHERE status = 'in_progress'"
    )
    .run();
}
```

### Check column existence before ALTER TABLE

```typescript
// Source: SQLite PRAGMA docs
import { getSqlite } from '../db/db.js';

export function ensureColumn(table: string, column: string, definition: string): void {
  const sqlite = getSqlite();
  const info = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!info.some(col => col.name === column)) {
    sqlite.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
  }
}
```

### MCP toggle tool pattern

```typescript
// Extends coordinator.ts — add to registerTools
server.tool('toggle_llm', 'Enable or disable the LLM pipeline', {
  enabled: z.boolean(),
}, async ({ enabled }) => {
  if (enabled) {
    pipeline.start();
  } else {
    pipeline.stop();
  }
  // Persist to config file so restart respects the toggle
  const config = getConfig();
  if (config?.llm) config.llm.enabled = enabled;
  await saveConfig(config);
  return createMcpResponse(`LLM pipeline ${enabled ? 'started' : 'stopped'}`);
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `generateObject(model, schema, prompt)` | `generateText({ output: Output.object({ schema }) })` | AI SDK v6 (late 2025) | `generateObject` deprecated; v7 will remove it; use new Output API |
| Provider-specific SDKs (`openai`, `@anthropic-ai/sdk`) | `ai` + provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai-compatible`) | AI SDK v3+ (stable) | Unified interface; swap provider by swapping model object |
| `mode: "tool"` workaround for non-OpenAI structured output | `Output.object()` with provider-native fallback | AI SDK v5 removed it | Transparent; SDK picks best mode per provider automatically |
| Separate Ollama client library | `@ai-sdk/openai-compatible` with Ollama's `/v1` endpoint | Ollama added OpenAI-compat in 0.1.24 (2024) | No community package needed for basic text/structured output |

**Deprecated/outdated:**
- `generateObject()`: Deprecated in AI SDK v6; removed in v7.
- `streamObject()`: Same deprecation path.
- `CoreMessage` type: Removed in v6; use `ModelMessage`.
- `mode: "tool"` on generateObject: Removed in v5.

---

## Open Questions

1. **Does `Output.object()` work reliably with Ollama via `@ai-sdk/openai-compatible`?**
   - What we know: Ollama has a known JSON mode bug with llama3 and phi3; the `mode: "tool"` workaround was removed in v5+; community packages include JSON repair.
   - What's unclear: Whether the `@ai-sdk/openai-compatible` + Ollama `/v1` endpoint combination works with `Output.object()` for the specific models the user will configure.
   - Recommendation: In plan 05-01, add an explicit test harness that calls the configured Ollama model with `Output.object()` and validates the result. If it fails, wrap with a JSON-repair fallback (try JSON.parse → on failure extract JSON substring → log warning). This was the known blocker in STATE.md; verify it empirically during implementation rather than relying on research alone.

2. **Token budget state persistence across restarts**
   - What we know: In-memory counter doesn't survive restarts; the `llm_jobs` table has no budget-state row.
   - What's unclear: Should a new `llm_state` table be added, or should a single-row extension to `schema_version` be used?
   - Recommendation: Add a `llm_runtime_state` table with a single row: `lifetime_tokens_used INTEGER, budget_exhausted_at INTEGER`. Schema-upgrade it in plan 05-01 using `ensureColumn` pattern. This is small enough to avoid a full schema migration.

3. **File content reading for LLM prompts**
   - What we know: The `llm_jobs` table has a `payload` column (TEXT) that stores diffs for `change_impact` jobs. For `summary` and `concepts` jobs, no content is stored — the file must be read at job execution time.
   - What's unclear: If a file is deleted between job creation and execution, the read will fail.
   - Recommendation: On file-not-found during job execution, mark job as `failed` with error "file_deleted" and clear staleness flags (since the file no longer needs metadata). Do not retry.

---

## Existing Infrastructure Inventory

Phase 5 can rely on the following already-implemented components without changes:

| Component | Location | Used By Phase 5 |
|-----------|----------|-----------------|
| `llm_jobs` SQLite table | `src/db/schema.ts` | Dequeue source |
| `insertLlmJobIfNotPending()` | `src/db/repository.ts` | Already called by CascadeEngine |
| `insertLlmJob()` | `src/db/repository.ts` | For manual/priority job insertion |
| `getStaleness()` | `src/db/repository.ts` | Read staleness state |
| `markStale()` | `src/db/repository.ts` | (Not called by pipeline; called by CascadeEngine) |
| `isExcluded()` | `src/file-utils.ts` (private) | Must be exported for COMPAT-02 |
| `getSqlite()` / `getDb()` | `src/db/db.ts` | Raw SQL for job management |
| `better-sqlite3` prepared statements | Pattern from Phase 4 | For dequeue, status updates |
| `zod` | Already installed | Output schema definitions |
| Vitest | `vitest.config.ts` | Test runner for integration tests |

**Critical note:** `isExcluded()` in `file-utils.ts` is currently a module-private function. It must be exported (or a public wrapper created) for the LLMPipeline to use it. Alternatively, the pipeline can call `getConfig()?.excludePatterns` and perform its own micromatch check — the same logic `isExcluded()` uses internally.

---

## Sources

### Primary (HIGH confidence)

- [ai-sdk.dev/docs/introduction](https://ai-sdk.dev/docs/introduction) — AI SDK package structure, generateText, Output.object()
- [ai-sdk.dev/providers/ai-sdk-providers/anthropic](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic) — createAnthropic configuration, baseURL, apiKey
- [ai-sdk.dev/providers/openai-compatible-providers](https://ai-sdk.dev/providers/openai-compatible-providers) — createOpenAICompatible, baseURL, apiKey, configuration options
- [ai-sdk.dev/docs/migration-guides/migration-guide-6-0](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0) — generateObject deprecation, Output.object() pattern, v6 breaking changes
- Project codebase: `src/db/schema.ts`, `src/db/repository.ts`, `src/cascade/cascade-engine.ts`, `src/file-utils.ts` — existing infrastructure for Phase 5 to consume

### Secondary (MEDIUM confidence)

- [npmjs.com/package/ai](https://www.npmjs.com/package/ai) — Current version 6.0.116 confirmed
- [npmjs.com/package/@ai-sdk/anthropic](https://www.npmjs.com/package/@ai-sdk/anthropic) — Current version 3.0.58 confirmed
- [ai-sdk.dev/providers/community-providers/ollama](https://ai-sdk.dev/providers/community-providers/ollama) — Ollama community provider options and known limitations
- [github.com/vercel/ai/issues (v5 streamObject mode tool regression)](https://github.com/vercel/ai/issues/7791) — Confirmed mode:tool removed in v5+

### Tertiary (LOW confidence)

- WebSearch results on `@aid-on/llm-throttle` — rate limiting library, not verified against project requirements; hand-rolling recommended instead
- WebSearch on Ollama JSON mode bugs with llama3/phi3 — described in community provider README but not officially documented by Ollama; treat as MEDIUM risk requiring empirical validation

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — official docs verified; versions confirmed on npm
- Architecture: HIGH — patterns derived from verified AI SDK v6 docs and existing project code
- Pitfalls: MEDIUM — generateObject deprecation HIGH; Ollama structured output MEDIUM (empirical verification needed during implementation)
- Rate limiting: HIGH — hand-rolled pattern is straightforward; fits SQLite-backed job queue

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (AI SDK is fast-moving; re-verify if > 30 days)
