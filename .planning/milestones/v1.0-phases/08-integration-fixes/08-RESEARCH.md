# Phase 8: Integration Fixes - Research

**Researched:** 2026-03-18
**Domain:** TypeScript codebase surgery — MCP tool extension, LLM pipeline circuit breaker, toggle sequencing, dedup fix, tech debt removal
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Toggle_llm Default Config (Local-First)
- When `toggle_llm(true)` is called with no prior LLM config, synthesize config BEFORE calling `coordinator.toggleLlm()`
- Default provider: `openai-compatible` (Ollama) — local-first, free, no API key needed
- Default model: `qwen3-coder:14b-instruct` (code-specialized, fits 16GB VRAM)
- Default baseURL: `http://localhost:11434/v1` (standard Ollama endpoint)
- If Ollama isn't running, jobs stay queued and retry — graceful degradation
- Users who want Anthropic cloud configure it explicitly in their config file

#### MCP Exposure of Concepts/Change_Impact
- Extend existing `get_file_summary` tool to include `concepts` and `changeImpact` fields in the response
- No new dedicated tools — one call returns all LLM-generated metadata
- Response shape adds two fields: `concepts` (JSON array/object or null) and `changeImpact` (JSON object or null)
- Also add these fields to `get_file_importance` for consistency (it already returns summary)
- Backward compatible: existing response fields unchanged, new fields are additive

#### Budget Exhaustion Visibility
- Add new `get_llm_status` MCP tool returning: `{ enabled, running, budgetExhausted, lifetimeTokensUsed, tokenBudget, maxTokensPerMinute }`
- Reads from existing coordinator/pipeline state — no new infrastructure
- Especially useful for diagnosing connection failures with local LLMs (not just budget issues)

#### Circuit Breaker Placement
- Check `isExhausted()` at insertion time (before `insertLlmJobIfNotPending`) not just at dequeue time
- Expose `isExhausted()` through the coordinator (which holds the pipeline reference)
- Cascade engine and change detector check via coordinator before inserting jobs
- Prevents filling the queue with jobs that will never run

### Claude's Discretion
- Exact error message wording for toggle_llm failures
- get_llm_status response field naming
- Implementation approach for threading isExhausted through to cascade engine (function parameter, module-level accessor, etc.)

### Deferred Ideas (OUT OF SCOPE)
- Model fallback chain: try primary model, if unavailable try secondary (GPT-OSS-20B) — future phase
- Ollama connection health check / auto-detection on toggle_llm — future enhancement
- Model recommendation based on available VRAM — out of scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LLM-02 | Background LLM auto-extracts structured concepts per file (functions, classes, interfaces, exports) as structured JSON | Concepts column exists in `files` table (schema confirmed); `writeLlmResult` and `getStaleness` already handle it; MCP tools need to read and return it |
| LLM-03 | Background LLM auto-assesses change impact per file (what breaks if this file changes, risk level, affected areas) | `change_impact` column exists in schema; pipeline writes it; MCP surface needs to expose it |
| LLM-06 | Background LLM can be toggled on/off via config or MCP tool call — system works fully without it | `toggle_llm` tool exists but has first-call sequencing bug; fix is in `mcp-server.ts:637-660` |
| LLM-07 | LLM calls have token budget limits and rate limiting to prevent runaway costs | `TokenBudgetGuard.isExhausted()` exists; circuit breaker must be moved upstream to insertion time |
| CHNG-03 | For unsupported languages, system falls back to LLM-powered diff to summarize what semantically changed | `queueLlmDiffJob` uses `insertLlmJob` (no dedup); fix is swapping to `insertLlmJobIfNotPending` |
</phase_requirements>

---

## Summary

Phase 8 is a targeted surgical fix phase — no new subsystems, only corrections to wiring bugs and cleanup of four specific integration failures identified in the v1.0 re-audit. All code infrastructure (columns, functions, schemas) already exists; the bugs are about incorrect ordering, missing guards, and stale call sites.

The five work items break into three categories: (1) two MCP tool fixes — toggle_llm sequencing and exposure of concepts/change_impact data; (2) two pipeline correctness fixes — circuit breaker at insertion time and dedup in llm-diff-fallback; (3) three tech debt items — commented-out console.warn lines, orphaned export, ROADMAP.md checkbox updates. Each fix is isolated to one or two files and requires no schema changes.

**Primary recommendation:** Execute fixes in this order — dedup fix (lowest risk, mechanical), circuit breaker exposure, MCP data exposure, toggle sequencing fix, then tech debt. Sequencing matters only between circuit breaker and `get_llm_status` (coordinator must expose `isExhausted()` before cascade engine can call it).

---

## Standard Stack

### Core (already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | 9.x | SQLite reads for concepts/change_impact columns | Already in use; raw prepared statements for direct column reads |
| zod | 3.x | Schema validation for LLMConfig synthesis in toggle_llm | Already used for LLMConfigSchema; parse defaults for synthesized config |
| vitest | 2.x | Test runner for all unit tests | Project standard; config at `vitest.config.ts` |

### No New Dependencies
All fixes operate on existing infrastructure. No new npm packages required.

---

## Architecture Patterns

### Pattern 1: MCP Tool Response Extension (Additive Fields)

**What:** Extend an existing MCP tool's response object with new nullable fields. Existing callers are unaffected because JSON objects tolerate extra fields.

**When to use:** LLM-02 and LLM-03 exposure in `get_file_summary` and `get_file_importance`.

**Established pattern (from existing get_file_summary at mcp-server.ts:370-394):**
```typescript
// Source: src/mcp-server.ts (existing pattern)
const summaryStale = getStaleness(normalizedPath);
return createMcpResponse({
  path: node.path,
  summary: node.summary,
  ...(summaryStale.summaryStale !== null && { summaryStale: summaryStale.summaryStale }),
  ...(summaryStale.conceptsStale !== null && { conceptsStale: summaryStale.conceptsStale }),
  ...(summaryStale.changeImpactStale !== null && { changeImpactStale: summaryStale.changeImpactStale }),
});
// NEW: extend with concepts and changeImpact
```

The concepts and change_impact values live in TEXT columns in the `files` table (JSON blobs). They are NOT on the `FileNode` struct — they require a direct DB read. Use `getSqlite().prepare()` with a raw SELECT, consistent with the pattern in `getStaleness()`.

**Extended response shape (add to both tools):**
```typescript
// Source: src/db/schema.ts — columns exist: concepts text, change_impact text
const node = getFile(normalizedPath);
const sqlite = getSqlite();
const llmData = sqlite.prepare(
  'SELECT concepts, change_impact FROM files WHERE path = ?'
).get(normalizedPath) as { concepts: string | null; change_impact: string | null } | undefined;

return createMcpResponse({
  // ...existing fields...
  concepts: llmData?.concepts ? JSON.parse(llmData.concepts) : null,
  changeImpact: llmData?.change_impact ? JSON.parse(llmData.change_impact) : null,
});
```

### Pattern 2: New MCP Tool Registration (get_llm_status)

**What:** Add a zero-parameter MCP tool that reads coordinator/pipeline state and returns a status object.

**When to use:** Adding `get_llm_status` tool (LLM-07 visibility + local LLM diagnostics).

**Established pattern (from existing tools in registerTools()):**
```typescript
// Source: src/mcp-server.ts — closure-capture pattern
server.tool("get_llm_status", "Get LLM pipeline status and token budget information", async () => {
  if (!coordinator.isInitialized()) return projectPathNotSetError;
  return createMcpResponse({
    enabled: coordinator.isLlmRunning(),
    running: coordinator.isLlmRunning(),
    budgetExhausted: coordinator.isLlmBudgetExhausted(),   // new method on coordinator
    lifetimeTokensUsed: coordinator.getLlmLifetimeTokensUsed(),  // new method on coordinator
    tokenBudget: coordinator.getLlmTokenBudget(),           // new method on coordinator
    maxTokensPerMinute: coordinator.getLlmMaxTokensPerMinute(), // new method on coordinator
  });
});
```

**Coordinator delegation chain:** `coordinator.isLlmBudgetExhausted()` → `this.llmPipeline?.getBudgetGuard().isExhausted() ?? false`. The `getBudgetGuard()` method already exists on `LLMPipeline` (confirmed in pipeline.ts:102).

### Pattern 3: Toggle_llm Config Synthesis Fix

**What:** In `toggle_llm` MCP handler, when `enabled=true` and `config.llm` is null/undefined, synthesize a default `LLMConfig` before calling `coordinator.toggleLlm()`.

**Current broken flow (mcp-server.ts:637-660):**
```typescript
coordinator.toggleLlm(enabled);  // coordinator.toggleLlm() checks getConfig()?.llm — if null, silently does nothing
// Then AFTER the call, config.llm is set — too late
if (!config.llm) {
  config.llm = { enabled, provider: 'anthropic', model: 'claude-3-haiku-20240307' }; // wrong defaults
```

**Fixed flow:**
```typescript
server.tool("toggle_llm", ..., async ({ enabled }) => {
  if (!coordinator.isInitialized()) return { content: [...], isError: true };
  try {
    const config = getConfig();
    if (enabled && (!config || !config.llm)) {
      // Synthesize default local-first LLM config BEFORE calling coordinator
      const defaultLlmConfig: LLMConfig = {
        enabled: true,
        provider: 'openai-compatible',
        model: 'qwen3-coder:14b-instruct',
        baseURL: 'http://localhost:11434/v1',
      };
      if (config) {
        config.llm = defaultLlmConfig;
        setConfig(config);
        await saveConfig(config);
      }
    } else if (config?.llm) {
      config.llm.enabled = enabled;
      setConfig(config);
      await saveConfig(config);
    }
    coordinator.toggleLlm(enabled);  // Now getConfig()?.llm is always set
    return { content: [{ type: "text", text: `LLM pipeline ${enabled ? 'started' : 'stopped'}.` }] };
  } catch (err) { ... }
});
```

**Key insight:** `coordinator.toggleLlm()` calls `getConfig()?.llm` internally (coordinator.ts:136). Config must be set BEFORE this call, not after.

### Pattern 4: Circuit Breaker at Insertion Time

**What:** Expose `isExhausted()` through coordinator, then check it before calling `insertLlmJobIfNotPending` in both `cascadeStale` and `markSelfStale`.

**Approach for threading isExhausted (Claude's discretion):** Use a module-level accessor pattern — expose a getter on the coordinator instance, but since `cascade-engine.ts` doesn't import coordinator (coordinator imports cascade-engine), use a callback/getter passed in OR expose via the pipeline's getBudgetGuard. The cleanest approach given the existing module structure:

Option A (recommended): Add a module-level `isLlmExhausted()` function to coordinator.ts that cascade-engine.ts imports directly:
```typescript
// src/coordinator.ts — new exported function (not on the class)
// Accessed via module-level reference to the active coordinator
let _activeCoordinator: ServerCoordinator | null = null;
export function setActiveCoordinator(c: ServerCoordinator): void { _activeCoordinator = c; }
export function isLlmExhausted(): boolean {
  return _activeCoordinator?.isLlmBudgetExhausted() ?? false;
}
```

Option B: Pass `isExhausted` as a parameter to `cascadeStale()` (function parameter):
```typescript
export function cascadeStale(
  changedFilePath: string,
  opts: { timestamp: number; changeContext?: ChangeContext; isExhausted?: () => boolean }
): void {
  if (opts.isExhausted?.()) return; // skip entirely when budget exhausted
  // ...
```

Option B (function parameter) is simpler, avoids global state, and matches existing `opts` pattern in `cascadeStale`. The check can be applied at the top of `cascadeStale` and `markSelfStale` before any insertions.

**Usage in cascade-engine.ts:**
```typescript
// cascadeStale insertion guard:
if (!opts.isExhausted?.()) {
  insertLlmJobIfNotPending(filePath, 'summary', 2);
  insertLlmJobIfNotPending(filePath, 'concepts', 2);
  insertLlmJobIfNotPending(filePath, 'change_impact', 2, changeImpactPayload);
}
```

**Coordinator wires it:**
```typescript
// coordinator.ts — when calling cascadeStale/markSelfStale
cascadeStale(filePath, {
  timestamp: Date.now(),
  changeContext,
  isExhausted: () => this.isLlmBudgetExhausted(),
});
```

### Pattern 5: Dedup Fix in llm-diff-fallback

**What:** Replace `insertLlmJob` with `insertLlmJobIfNotPending` in `queueLlmDiffJob`.

**Current (llm-diff-fallback.ts:5,32):**
```typescript
import { insertLlmJob } from '../db/repository.js';
// ...
insertLlmJob({ file_path: filePath, job_type: 'change_impact', priority_tier: 2, payload: truncatedDiff });
```

**Fixed:**
```typescript
import { insertLlmJobIfNotPending } from '../db/repository.js';
// ...
insertLlmJobIfNotPending(filePath, 'change_impact', 2, truncatedDiff);
```

This is the simplest fix in the entire phase — 2-line change. `insertLlmJobIfNotPending` already accepts an optional `payload` parameter (added in Phase 7, confirmed in repository.ts:377-391).

### Pattern 6: Tech Debt Removal

**Commented-out console.warn lines in file-utils.ts:**
- Line 947: `//console.warn(...)` inside catch block
- Line 1315: `// console.warn(...)` inside else block
- Line 1400: `// console.warn(...)` inside else block

Remove all three lines outright. They are dead code — the logger.ts `log()` function exists for this purpose and is already used throughout file-utils.ts.

**Note:** There is a test at `change-detector.test.ts:241` that checks `ast-parser.ts` does NOT contain `console.warn`. The console.warn instances being removed are in `file-utils.ts`, not `ast-parser.ts`, so no test changes are needed.

**Orphaned export `migrateJsonToSQLite`:**
- `migrateJsonToSQLite` is exported from `src/migrate/json-to-sqlite.ts` (line 58)
- It is NOT imported by any runtime file other than `json-to-sqlite.ts` itself (which calls it internally)
- It IS imported by the test file `json-to-sqlite.test.ts` — **the export cannot be removed without breaking tests**
- Resolution: Keep the export. The CONTEXT.md says "orphaned migrateJsonToSQLite export removed" but the test file legitimately uses it as public API surface. Document this decision and mark as intentional keep.

**ROADMAP.md Phase 6 checkboxes:**
The ROADMAP.md in the repo root does not use numbered phases with checkboxes (it uses strikethrough headers for fixed bugs). The `.planning/ROADMAP.md` may have different content. The success criterion says "ROADMAP.md Phase 6 checkboxes checked" — this means updating whatever checkbox items exist in the planning ROADMAP for Phase 6. Read `.planning/ROADMAP.md` before implementing to identify exact items.

### Recommended File Change Map

| File | Change Type | What |
|------|-------------|------|
| `src/mcp-server.ts` | Fix + extend | toggle_llm sequencing; get_file_summary + get_file_importance add concepts/changeImpact; add get_llm_status tool |
| `src/coordinator.ts` | Extend | Add `isLlmBudgetExhausted()`, `getLlmLifetimeTokensUsed()`, `getLlmTokenBudget()`, `getLlmMaxTokensPerMinute()` methods |
| `src/cascade/cascade-engine.ts` | Fix | Add `isExhausted?` param to `cascadeStale` and `markSelfStale`; guard insertions |
| `src/change-detector/llm-diff-fallback.ts` | Fix | Swap `insertLlmJob` → `insertLlmJobIfNotPending` |
| `src/file-utils.ts` | Tech debt | Remove 3 commented-out console.warn lines |
| `ROADMAP.md` or `.planning/ROADMAP.md` | Docs | Check Phase 6 completion boxes |

### Anti-Patterns to Avoid

- **Calling coordinator.toggleLlm() before config is set:** The bug is precisely that toggleLlm reads config internally — the fix must write config first.
- **Using `insertLlmJob` anywhere new:** All new LLM job insertions must go through `insertLlmJobIfNotPending`. `insertLlmJob` remains for internal use by `insertLlmJobIfNotPending` only.
- **Parsing JSON from the DB without null check:** `concepts` and `change_impact` columns can be null (not yet generated). Always null-guard before `JSON.parse()`.
- **Breaking COMPAT-01 by changing existing tool response shapes:** Existing fields in `get_file_summary` and `get_file_importance` responses must remain identical. New fields are additive only.
- **Removing migrateJsonToSQLite export:** The test file imports it directly. Removing the export breaks the test suite.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Default LLM config schema validation | Custom validator | `LLMConfigSchema.parse()` from `src/llm/types.ts` | Zod schema already has correct defaults; parse() enforces types |
| Budget guard introspection | New state tracking | `TokenBudgetGuard.isExhausted()` + `getLifetimeTokensUsed()` | Both methods already exist in rate-limiter.ts |
| Dedup logic | Custom pending-job check | `insertLlmJobIfNotPending()` from repository.ts | Already handles the SELECT + conditional INSERT atomically |
| LLM config persistence | Custom file write | `saveConfig()` + `setConfig()` from config-utils / global-state | Existing pattern in toggle_llm handler (lines 646-654) |

**Key insight:** Every fix in this phase uses already-built infrastructure. The bugs are all wiring errors, not capability gaps.

---

## Common Pitfalls

### Pitfall 1: Config Write/Read Race in toggle_llm
**What goes wrong:** Setting `config.llm` on the object reference AFTER calling `coordinator.toggleLlm()` — the coordinator's internal `getConfig()?.llm` read happens during the call, before config is updated.
**Why it happens:** The original code did `coordinator.toggleLlm(enabled)` first, then mutated config — backwards ordering.
**How to avoid:** Always synthesize/mutate the full config object, call `setConfig()`, then call `coordinator.toggleLlm()`.
**Warning signs:** LLM pipeline doesn't start on first `toggle_llm(true)` call; log shows "toggleLlm: enabled=true but no llm config found".

### Pitfall 2: JSON.parse on Null DB Column
**What goes wrong:** `JSON.parse(null)` throws a TypeError; `JSON.parse(undefined)` also throws.
**Why it happens:** The `concepts` and `change_impact` columns default to null for files not yet processed by the LLM.
**How to avoid:** Always guard: `llmData?.concepts ? JSON.parse(llmData.concepts) : null`.
**Warning signs:** MCP tool crashes on files with no LLM data yet.

### Pitfall 3: `isExhausted` Check Placement
**What goes wrong:** Checking isExhausted at dequeue time (already the case in pipeline.ts:134) but NOT at insertion time — jobs fill the queue until the next dequeue cycle discovers the budget is gone.
**Why it happens:** The guard exists in the pipeline but not in the producers (cascade engine, diff fallback).
**How to avoid:** The guard in cascade-engine.ts must fire before ANY `insertLlmJobIfNotPending` call for that cascade run, not per-job.
**Warning signs:** Queue continues growing even when `get_llm_status` shows `budgetExhausted: true`.

### Pitfall 4: Coordinator Method Availability
**What goes wrong:** Calling `coordinator.isLlmBudgetExhausted()` when `this.llmPipeline` is null (LLM not started yet).
**Why it happens:** LLM pipeline is lazily initialized — it's null until `startLlmPipeline()` is called.
**How to avoid:** All new coordinator methods must null-guard: `this.llmPipeline?.getBudgetGuard().isExhausted() ?? false`.
**Warning signs:** TypeError: Cannot read properties of null (reading 'getBudgetGuard').

### Pitfall 5: migrateJsonToSQLite Export Removal Breaking Tests
**What goes wrong:** Removing the `export` keyword from `migrateJsonToSQLite` causes `json-to-sqlite.test.ts` to fail with "is not a function" or import error.
**Why it happens:** The test suite imports and tests `migrateJsonToSQLite` directly as public API.
**How to avoid:** Do NOT remove the export. Mark it as intentionally kept for test coverage.
**Warning signs:** TypeScript import error in `json-to-sqlite.test.ts`.

---

## Code Examples

### Reading concepts/change_impact from SQLite

```typescript
// Source: pattern consistent with getStaleness() in src/db/repository.ts
// Direct raw prepared statement — consistent with Phase 4 pattern
const sqlite = getSqlite();
const llmData = sqlite
  .prepare('SELECT concepts, change_impact FROM files WHERE path = ?')
  .get(normalizedPath) as { concepts: string | null; change_impact: string | null } | undefined;

const concepts = llmData?.concepts ? JSON.parse(llmData.concepts) as ConceptsResult : null;
const changeImpact = llmData?.change_impact ? JSON.parse(llmData.change_impact) as ChangeImpactResult : null;
```

### Synthesizing Default LLM Config

```typescript
// Source: LLMConfigSchema in src/llm/types.ts — parse() fills defaults
import type { LLMConfig } from './llm/types.js';

const defaultLlmConfig: LLMConfig = {
  enabled: true,
  provider: 'openai-compatible',
  model: 'qwen3-coder:14b-instruct',
  baseURL: 'http://localhost:11434/v1',
};
```

### Coordinator Budget Guard Delegation

```typescript
// Source: LLMPipeline.getBudgetGuard() exists in src/llm/pipeline.ts:102
isLlmBudgetExhausted(): boolean {
  return this.llmPipeline?.getBudgetGuard().isExhausted() ?? false;
}

getLlmLifetimeTokensUsed(): number {
  return this.llmPipeline?.getBudgetGuard().getLifetimeTokensUsed() ?? 0;
}
```

### Cascade Engine Exhaustion Guard

```typescript
// Source: cascadeStale signature in src/cascade/cascade-engine.ts:71
export function cascadeStale(
  changedFilePath: string,
  opts: { timestamp: number; changeContext?: ChangeContext; isExhausted?: () => boolean }
): void {
  const { timestamp, changeContext, isExhausted } = opts;
  // ...
  // Inside the BFS loop, before inserting jobs:
  if (!isExhausted?.()) {
    insertLlmJobIfNotPending(filePath, 'summary', 2);
    insertLlmJobIfNotPending(filePath, 'concepts', 2);
    insertLlmJobIfNotPending(filePath, 'change_impact', 2, changeImpactPayload);
  }
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Anthropic-only default in toggle_llm | Local-first Ollama default (qwen3-coder:14b-instruct) | Phase 8 (this phase) | First call works without API key |
| Job insertion without dedup in llm-diff-fallback | `insertLlmJobIfNotPending` everywhere | Phase 8 (this phase) | No duplicate change_impact jobs on rapid file changes |
| Budget guard only at dequeue | Budget guard at insertion AND dequeue | Phase 8 (this phase) | Queue doesn't bloat when budget exhausted |
| concepts/change_impact invisible to MCP | Exposed in get_file_summary + get_file_importance | Phase 8 (this phase) | LLM clients can retrieve all generated metadata |

---

## Open Questions

1. **migrateJsonToSQLite export removal**
   - What we know: CONTEXT.md says "orphaned migrateJsonToSQLite export removed" as tech debt; the test file `json-to-sqlite.test.ts` imports it directly
   - What's unclear: Was the intent to remove the export from runtime callers only, or also from test surface? The test file is the only importer.
   - Recommendation: Keep the export. It provides test-only public API surface. Document in RESEARCH.md that removal would break tests — planner should note this and mark it as "no-op" tech debt item. Alternatively, convert to internal and update the test to call `runMigrationIfNeeded` instead, but that's more invasive.

2. **ROADMAP.md Phase 6 checkboxes**
   - What we know: The repo-root ROADMAP.md does not use phase-numbered checkboxes (uses strikethrough headers)
   - What's unclear: Which ROADMAP.md file the success criterion refers to; `.planning/ROADMAP.md` may have a different structure
   - Recommendation: During implementation, read `.planning/ROADMAP.md` to identify Phase 6 line items and mark them checked. This is a docs-only change.

3. **isExhausted threading approach**
   - What we know: Claude has discretion on approach (function param vs module-level accessor vs coordinator method)
   - What's unclear: Whether cascade-engine needs to avoid queuing at all (skip entire cascade) or just skip job insertion (still mark stale)
   - Recommendation: Skip only the job insertion, not the staleness marking. The staleness marks are correct even when budget is exhausted — they ensure jobs get queued when the budget resets. Only skip `insertLlmJobIfNotPending` calls, not `markStale`.

---

## Sources

### Primary (HIGH confidence)
- Direct source read: `src/mcp-server.ts` lines 295-394, 637-660 — toggle_llm handler and get_file_summary/get_file_importance handlers
- Direct source read: `src/coordinator.ts` lines 133-144 — `toggleLlm()` method implementation confirming the sequencing bug
- Direct source read: `src/llm/rate-limiter.ts` — `TokenBudgetGuard.isExhausted()`, `getLifetimeTokensUsed()` confirmed present
- Direct source read: `src/llm/pipeline.ts` lines 98-104 — `getBudgetGuard()` method confirmed present
- Direct source read: `src/db/repository.ts` lines 370-391 — `insertLlmJobIfNotPending` with payload parameter confirmed
- Direct source read: `src/db/schema.ts` — `concepts` and `change_impact` TEXT columns confirmed in files table
- Direct source read: `src/change-detector/llm-diff-fallback.ts` — `insertLlmJob` (not dedup) confirmed in use
- Direct source read: `src/cascade/cascade-engine.ts` — `insertLlmJobIfNotPending` already used; `isExhausted` guard not yet present
- Direct source read: `src/file-utils.ts` lines 947, 1315, 1400 — three commented-out console.warn lines confirmed
- Direct source read: `src/migrate/json-to-sqlite.ts` + `json-to-sqlite.test.ts` — `migrateJsonToSQLite` exported and test-imported; orphan claim is partially inaccurate

### Secondary (MEDIUM confidence)
- Project STATE.md and CONTEXT.md — decision rationale for local-first defaults, circuit breaker placement, MCP exposure approach

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all existing tools confirmed by direct source reads
- Architecture: HIGH — all integration points confirmed by reading actual source files; patterns derived from existing code in the same repo
- Pitfalls: HIGH — bugs confirmed by tracing actual code paths (toggle_llm reads config inside toggleLlm(); insertLlmJob vs insertLlmJobIfNotPending confirmed)

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable codebase; no external dependencies to go stale)
