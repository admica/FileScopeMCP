# Phase 7: Fix change_impact Pipeline - Research

**Researched:** 2026-03-18
**Domain:** Internal gap closure — TypeScript wiring of existing modules (change-detector, cascade-engine, repository, ast-parser)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Diff source for non-TS/JS files**
- Use `git diff HEAD -- <file>` as the primary diff source for unsupported languages
- Zero schema changes needed — git is universally available in dev environments
- If git is unavailable or file is untracked (no diff output), fall back to reading the current file content and annotating it as "new/untracked file" for the LLM
- The diff (or content fallback) is passed directly to `queueLlmDiffJob`, which already handles truncation at 16KB and inserts into llm_jobs with the payload

**Cascade job payloads**
- Extend `insertLlmJobIfNotPending` to accept an optional `payload` parameter
- For the **originally changed file**: `queueLlmDiffJob` handles this path (already exists, just needs wiring)
- For **cascade dependent files**: construct a payload containing the upstream file path, change type, and the dependent file's own content — the LLM needs both "what changed upstream" and "what does this file do" to assess cross-file impact
- `cascadeStale` in cascade-engine.ts needs to accept and propagate a change description to downstream jobs

**First-change bootstrapping**
- `git diff` naturally handles most cases (file was committed before the change)
- For truly first-seen files (created but never committed), pass the full file content as the diff payload with a "new file" annotation
- No proactive content caching on first scan — that's premature optimization for a rare edge case
- The LLM generates a baseline impact assessment rather than a comparative one

**Logger cleanup**
- Replace `console.warn` at ast-parser.ts:128 with `logger.warn` (or `log()` to match existing patterns)
- Straightforward find-and-replace, no behavioral changes

### Claude's Discretion
- Exact format of the "new/untracked file" annotation string passed to the LLM
- Whether to shell out to git via child_process.execSync or use a lightweight git library
- Exact payload construction format for cascade dependent jobs (plain text description vs structured JSON)
- Whether the git diff helper belongs in change-detector/ or a shared util

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CHNG-03 | For unsupported languages, system falls back to LLM-powered diff to summarize what semantically changed | `_classifyWithLlmFallback` wiring: call `queueLlmDiffJob` with git diff output instead of returning hardcoded unknown; `child_process.execSync` pattern for git diff |
| LLM-03 | Background LLM auto-assesses change impact per file (what breaks if this file changes, risk level, affected areas) | `insertLlmJobIfNotPending` payload extension; `cascadeStale` signature change; `LLMPipeline.runJob` already handles change_impact when payload is present |
</phase_requirements>

## Summary

Phase 7 is pure gap-closure work: all required capabilities already exist across Phases 3 and 5 and simply need to be wired together. The three root causes of the broken E2E flow are: (1) `ChangeDetector._classifyWithLlmFallback` returns early without calling `queueLlmDiffJob`, (2) `insertLlmJobIfNotPending` in repository.ts lacks a `payload` parameter so cascade-engine queued `change_impact` jobs have `payload = null`, and (3) `LLMPipeline.runJob` throws `no_payload` for any `change_impact` job with a null payload — silently failing the entire pipeline branch.

The fix requires changes to exactly four files: `change-detector.ts` (wire git diff → queueLlmDiffJob), `repository.ts` (add optional `payload` to `insertLlmJobIfNotPending`), `cascade-engine.ts` (accept a change description and propagate payload to change_impact jobs), and `ast-parser.ts` (swap `console.warn` for `log()`). No schema changes, no new dependencies beyond `child_process` (Node built-in), and no changes to LLMPipeline.

**Primary recommendation:** Make the changes surgical and additive — extend existing function signatures with optional parameters, keep all existing call sites working unchanged, and add a focused git diff helper in `change-detector/` alongside `llm-diff-fallback.ts`.

## Standard Stack

### Core (existing — no new dependencies)
| Module | Location | Purpose | Notes |
|--------|----------|---------|-------|
| `child_process.execSync` | Node built-in | Shell out to `git diff HEAD -- <file>` | First shell-out in the codebase; already decided in CONTEXT.md |
| `queueLlmDiffJob` | `src/change-detector/llm-diff-fallback.ts` | Truncates diff, inserts llm_job with payload | Fully implemented — just needs to be called |
| `insertLlmJob` | `src/db/repository.ts` | Low-level job insert with payload support | Already accepts `payload?: string` |
| `insertLlmJobIfNotPending` | `src/db/repository.ts` | Dedup-aware job insert | Currently lacks payload parameter — needs extension |
| `cascadeStale` | `src/cascade/cascade-engine.ts` | BFS staleness propagation | Currently calls `insertLlmJobIfNotPending` without payload |
| `log()` | `src/logger.ts` | Structured logger with daemon-mode suppression | Export: `import { log } from '../logger.js'` |

### No New Packages Required
The implementation uses only existing codebase modules plus Node's built-in `child_process`. No `npm install` needed.

## Architecture Patterns

### Recommended File Locations
```
src/
├── change-detector/
│   ├── change-detector.ts      # Edit: wire _classifyWithLlmFallback
│   ├── llm-diff-fallback.ts    # No change (already complete)
│   ├── git-diff.ts             # NEW: git diff helper (or inline in change-detector.ts)
│   └── ast-parser.ts           # Edit: console.warn → log()
├── cascade/
│   └── cascade-engine.ts       # Edit: extend cascadeStale signature
└── db/
    └── repository.ts           # Edit: extend insertLlmJobIfNotPending signature
```

### Pattern 1: Extending insertLlmJobIfNotPending with Payload

The existing `insertLlmJobIfNotPending` signature (line 374, repository.ts) takes `(filePath, jobType, priorityTier)` and calls `insertLlmJob` which already supports `payload?: string`. The fix is additive — add an optional 4th parameter:

```typescript
// Source: src/db/repository.ts (current implementation, lines 374-387)
// BEFORE:
export function insertLlmJobIfNotPending(
  filePath: string,
  jobType: 'summary' | 'concepts' | 'change_impact',
  priorityTier: number
): void {
  const sqlite = getSqlite();
  const existing = sqlite
    .prepare(
      "SELECT 1 FROM llm_jobs WHERE file_path = ? AND job_type = ? AND status = 'pending' LIMIT 1"
    )
    .get(filePath, jobType);
  if (existing) return;
  insertLlmJob({ file_path: filePath, job_type: jobType, priority_tier: priorityTier });
}

// AFTER: add optional payload parameter
export function insertLlmJobIfNotPending(
  filePath: string,
  jobType: 'summary' | 'concepts' | 'change_impact',
  priorityTier: number,
  payload?: string          // <-- new optional param
): void {
  const sqlite = getSqlite();
  const existing = sqlite
    .prepare(
      "SELECT 1 FROM llm_jobs WHERE file_path = ? AND job_type = ? AND status = 'pending' LIMIT 1"
    )
    .get(filePath, jobType);
  if (existing) return;
  insertLlmJob({ file_path: filePath, job_type: jobType, priority_tier: priorityTier, payload });
}
```

All existing callers (cascade-engine.ts lines 37–39, markSelfStale lines 75–76) continue to work unchanged since `payload` is optional.

### Pattern 2: Extending cascadeStale to Accept and Propagate Change Context

`cascadeStale` in cascade-engine.ts currently takes `(changedFilePath, opts: { timestamp: number })`. It calls `insertLlmJobIfNotPending(filePath, 'change_impact', 2)` for every node in the BFS. The fix passes change context for the direct changed file, and constructs a cross-file payload for cascade dependents:

```typescript
// Source: src/cascade/cascade-engine.ts (pattern to follow)
// Extend opts to include optional changeContext
export function cascadeStale(
  changedFilePath: string,
  opts: { timestamp: number; changeContext?: ChangeContext }
): void {
  const { timestamp, changeContext } = opts;
  // ... BFS loop ...
  // For each filePath in BFS:
  // - if filePath === changedFilePath && changeContext: use changeContext.directPayload
  // - else if changeContext: build cross-file payload from changeContext
  // - else: no payload (existing behavior preserved)
}
```

### Pattern 3: Git Diff Helper

The git diff helper is new to the codebase. Key requirements based on CONTEXT.md decisions:

```typescript
// Source: internal codebase analysis
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';

/**
 * Returns the git diff for filePath relative to HEAD, or falls back to
 * reading file content (new/untracked file case).
 * Non-fatal: catches all errors and returns fallback payload.
 */
export async function getGitDiffOrContent(filePath: string): Promise<string> {
  try {
    const diff = execSync(`git diff HEAD -- "${filePath}"`, {
      cwd: path.dirname(filePath),   // or project root
      encoding: 'utf-8',
      timeout: 5000,                 // prevent hanging
    });
    if (diff.trim().length > 0) {
      return diff;
    }
    // Empty diff = file not yet committed or no change tracked
  } catch {
    // git unavailable or error — fall through to content fallback
  }

  // Content fallback for new/untracked files
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return `[new/untracked file]\n${content}`;
  } catch {
    return '[file content unavailable]';
  }
}
```

**Key decisions for Claude's discretion items:**
- Use `execSync` (not `exec`/`spawn`) — synchronous is appropriate since `_classifyWithLlmFallback` is in an async method; consistent with the project's synchronous DB patterns
- Place helper in `change-detector/git-diff.ts` — keeps it alongside the other change-detector modules; avoids polluting the root src/
- Use project root as `cwd` for git, not `path.dirname(filePath)` — git repos are rooted at project level

### Pattern 4: Wiring _classifyWithLlmFallback

```typescript
// Source: src/change-detector/change-detector.ts (lines 84-99 — current state)
// BEFORE: returns hardcoded unknown
private async _classifyWithLlmFallback(filePath: string): Promise<SemanticChangeSummary> {
  log(`[ChangeDetector] Unsupported language for ${filePath}, returning heuristic unknown`);
  return { filePath, changeType: 'unknown', affectsDependents: true, confidence: 'heuristic', timestamp: Date.now() };
}

// AFTER: wire git diff → queueLlmDiffJob
private async _classifyWithLlmFallback(filePath: string): Promise<SemanticChangeSummary> {
  const diff = await getGitDiffOrContent(filePath);   // new helper
  log(`[ChangeDetector] Unsupported language for ${filePath}, queuing LLM diff job`);
  return queueLlmDiffJob(filePath, diff);              // already handles truncation, DB insert, returns conservative summary
}
```

### Pattern 5: Cascade Payload for Dependent Files

For cascade-dependent files (not the originally changed file), the LLM needs context about what changed upstream AND what the dependent file does. Constructing this as a plain text string (not JSON) keeps it consistent with `buildChangeImpactPrompt`'s `diff` parameter which is expected to be readable text:

```
[upstream change impact: /path/to/changed-file changed (exports-changed)]
[assessing dependent file: /path/to/dependent-file]

<content of dependent file>
```

This gives the LLM the narrative it needs: what changed upstream, and what the downstream file does.

### Anti-Patterns to Avoid

- **Passing payload as a positional required arg:** Makes all existing callers fail to compile. Always use optional parameter with `?`.
- **Running git diff from file's directory:** Git repos are rooted at project level. Use `projectRoot` as `cwd`, not `path.dirname(filePath)`.
- **Throwing when git is unavailable:** Change detection must be non-fatal per established codebase pattern — log and return conservative summary.
- **Reading full file content into cascade payload for large files:** The `queueLlmDiffJob` truncation at 16KB applies, but callers should be aware that very large files will be truncated. For cascade payloads, truncate the dependent file content before constructing the payload string.
- **Calling `execSync` without a timeout:** Default timeout is unlimited. Always specify `timeout: 5000` to prevent blocking the event loop in edge cases.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Diff truncation | Custom truncation logic | Existing `queueLlmDiffJob` MAX_DIFF_BYTES=16384 | Already implemented, handles DB bloat and LLM context overflow |
| LLM job insertion | Direct SQL INSERT in cascade-engine | `insertLlmJobIfNotPending` (extended with payload) | Dedup logic already tested; consistent with rest of codebase |
| Git diff parsing | Parse unified diff format | Pass raw diff string to LLM | LLM handles the diff format natively; `buildChangeImpactPrompt` wraps it in a diff code fence |
| Structured LLM output for change_impact | New prompt builder | Existing `buildChangeImpactPrompt` + `ChangeImpactSchema` | Both already implemented in Phase 5 |

**Key insight:** Every piece of this pipeline already exists. The work is exclusively wiring, signature extension, and one new helper function (git diff).

## Common Pitfalls

### Pitfall 1: Breaking Existing Callers of cascadeStale
**What goes wrong:** `cascadeStale` is called in coordinator.ts on both `change` and `unlink` events (lines 485, 498). If the signature change is not backward-compatible, TypeScript compilation fails.
**Why it happens:** Adding required parameters to existing functions.
**How to avoid:** Make `changeContext` optional in the `opts` object: `opts: { timestamp: number; changeContext?: ChangeContext }`. The existing callers pass `{ timestamp: Date.now() }` which remains valid.
**Warning signs:** TypeScript error `Expected N arguments but got M` at coordinator.ts call sites.

### Pitfall 2: execSync Blocking the Event Loop
**What goes wrong:** `execSync` is synchronous. If git hangs (e.g., on a very large repo with lock contention), it blocks the entire Node.js process.
**Why it happens:** `execSync` has no default timeout.
**How to avoid:** Always specify `{ timeout: 5000 }`. The 5-second timeout is generous for a simple `git diff HEAD` on any reasonably-sized repo.
**Warning signs:** Process appears frozen during file change events in large repos.

### Pitfall 3: Git Not Available or File Not in Repo
**What goes wrong:** `execSync('git diff ...')` throws if git is not installed, or if the project directory is not a git repo.
**Why it happens:** Not all environments have git, and new projects may not have made their first commit.
**How to avoid:** Wrap in try/catch and fall back to reading file content. CONTEXT.md already specifies this fallback. The annotation `[new/untracked file]` communicates to the LLM that this is a first-seen file.
**Warning signs:** `Error: Command failed: git diff` in logs. Should be caught silently and fall through to content read.

### Pitfall 4: Dedup Logic Discarding Payload Updates
**What goes wrong:** `insertLlmJobIfNotPending` returns early if a pending job already exists for `(file_path, job_type)`. If a cascade re-queues a `change_impact` job that was already queued without a payload (e.g., from an earlier cascade), the new payload-carrying call is silently dropped.
**Why it happens:** The dedup check only looks at status='pending' and job_type — it does not check whether the existing job has a payload.
**How to avoid:** The existing behavior is acceptable here: once a file is in the queue, we don't need to update the payload of a pending job. The LLM will process whichever job is first. If payload is null, pipeline.ts already marks it failed with `no_payload`. The fix ensures new cascade calls carry payloads from the start — the dedup case only arises when the same file cascades twice in quick succession, which is rare.
**Warning signs:** LLM logs show `no_payload` failures for files that were cascade-queued after the fix is deployed. Investigate whether the first queue call (without payload) is racing the second.

### Pitfall 5: Cascade Payload Construction Exceeds 16KB
**What goes wrong:** For large dependent files, reading the full content into the cascade payload produces a string >16KB. `queueLlmDiffJob` truncates at MAX_DIFF_BYTES, but for cascade jobs using `insertLlmJobIfNotPending` directly, there is no automatic truncation.
**Why it happens:** `insertLlmJobIfNotPending` calls `insertLlmJob` directly without truncation.
**How to avoid:** For cascade dependent job payloads, apply the same 16KB cap before passing to `insertLlmJobIfNotPending`. Either reuse the MAX_DIFF_BYTES constant (export it from `llm-diff-fallback.ts`) or inline the truncation in cascade-engine.ts.
**Warning signs:** Large payload TEXT values in the llm_jobs table causing unexpected DB growth.

### Pitfall 6: console.warn in ast-parser.ts Still Suppressed in Daemon Mode
**What goes wrong:** After the fix, `console.warn` is replaced with `log()`. The behavior difference: `log()` respects daemon mode suppression (no console output in daemon mode), while `console.warn` always outputs to stderr.
**Why it happens:** This is actually the correct direction — tree-sitter parse failures during daemon operation should not spam stderr.
**How to avoid:** This is intentional. Use `log()` not `warn()`. The existing comment in logger.ts confirms `log()` is suppressed in daemon mode, which is correct behavior for a parse failure warning.
**Warning signs:** None — this is intended behavior. Document it in the commit message.

## Code Examples

### Full Wiring Sequence (coordinator.ts perspective)

```typescript
// Source: src/coordinator.ts lines 464-491 (current state — no change needed here)
// The coordinator already does the right thing:
//   1. changeSummary = await this.changeDetector.classify(filePath)  ← CHNG-03 fix lives here
//   2. if affectsDependents: cascadeStale(filePath, { timestamp })   ← LLM-03 fix lives here
//
// After Phase 7:
//   classify() calls _classifyWithLlmFallback() which calls queueLlmDiffJob(filePath, diff)
//   cascadeStale() receives changeContext and passes payload to insertLlmJobIfNotPending
//   LLMPipeline.runJob() receives change_impact job WITH payload → succeeds instead of throwing
```

### insertLlmJobIfNotPending After Extension

```typescript
// Source: src/db/repository.ts (pattern from existing insertLlmJob signature)
export function insertLlmJobIfNotPending(
  filePath: string,
  jobType: 'summary' | 'concepts' | 'change_impact',
  priorityTier: number,
  payload?: string   // optional — undefined passes through to insertLlmJob as null
): void {
  const sqlite = getSqlite();
  const existing = sqlite
    .prepare(
      "SELECT 1 FROM llm_jobs WHERE file_path = ? AND job_type = ? AND status = 'pending' LIMIT 1"
    )
    .get(filePath, jobType);
  if (existing) return;
  insertLlmJob({ file_path: filePath, job_type: jobType, priority_tier: priorityTier, payload });
}
```

### ChangeContext Type Definition

```typescript
// Define in cascade-engine.ts (or a shared types file if preferred)
interface ChangeContext {
  /** Payload for the directly changed file's change_impact job */
  directPayload: string;
  /** The change type from ChangeDetector (for constructing dependent payloads) */
  changeType: string;
  /** Path of the directly changed file (for dependent payload construction) */
  changedFilePath: string;
}
```

### Cascade Dependent Payload Construction

```typescript
// Source: cascade-engine.ts (new logic for non-root cascade nodes)
function buildDependentPayload(
  changeContext: ChangeContext,
  dependentFilePath: string
): string {
  const MAX_CONTENT_BYTES = 14 * 1024; // leave room for header text
  let content: string;
  try {
    content = readFileSync(dependentFilePath, 'utf-8');
    if (content.length > MAX_CONTENT_BYTES) {
      content = content.slice(0, MAX_CONTENT_BYTES) + '... [truncated]';
    }
  } catch {
    content = '[file content unavailable]';
  }
  return [
    `[upstream change: ${changeContext.changedFilePath} (${changeContext.changeType})]`,
    `[assessing dependent: ${dependentFilePath}]`,
    '',
    content,
  ].join('\n');
}
```

### ast-parser.ts Logger Fix

```typescript
// Source: src/change-detector/ast-parser.ts line 128 (current)
// BEFORE:
console.warn(`[ast-parser] tree-sitter parse failed for ${filePath}:`, err);

// AFTER: (import { log } from '../logger.js' already present in many codebase files)
// Add to imports at top of ast-parser.ts:
import { log } from '../logger.js';
// Replace line 128:
log(`[ast-parser] tree-sitter parse failed for ${filePath}: ${err}`);
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `_classifyWithLlmFallback` returns hardcoded unknown, never calls queueLlmDiffJob | Calls `getGitDiffOrContent` then `queueLlmDiffJob` | CHNG-03 closes: non-TS/JS changes now produce LLM-classified diffs |
| `insertLlmJobIfNotPending` has no payload parameter, change_impact jobs always null | Extended with optional `payload` | Cascade change_impact jobs now carry context |
| `cascadeStale` calls `insertLlmJobIfNotPending` with no change context | Accepts optional `changeContext`, passes payload to change_impact jobs only | LLM-03 closes: pipeline processes cascade change assessments |
| `console.warn` in ast-parser.ts | `log()` from logger.ts | Consistent logging, daemon-mode aware |

## Open Questions

1. **Git cwd: use projectRoot or file directory?**
   - What we know: git repos are anchored at project root; `git diff HEAD -- <file>` works from any directory within the repo as long as the file path is absolute or relative to the repo root
   - What's unclear: whether using an absolute file path with `git diff HEAD -- /absolute/path/to/file` works reliably across platforms when cwd is set to projectRoot
   - Recommendation: use `this.projectRoot` as cwd (ChangeDetector already has `projectRoot` in its constructor) and pass an absolute filePath — this is the most reliable approach and consistent with how the coordinator tracks projectRoot

2. **Should cascadeStale pass changeContext from coordinator or derive it from changeSummary?**
   - What we know: `cascadeStale` is called in coordinator.ts with `{ timestamp: Date.now() }` after `changeSummary` is already available
   - What's unclear: whether coordinator.ts should build the `changeContext` object and pass it to `cascadeStale`, or whether `cascadeStale` should receive the raw `changeSummary`
   - Recommendation: pass `changeContext` from coordinator.ts — keeps cascade-engine.ts decoupled from SemanticChangeSummary type. Coordinator already has `changeSummary` in scope at the call site (coordinator.ts line 485).

3. **What about the readFileSync in cascade-engine.ts for dependent payloads?**
   - What we know: cascade-engine.ts currently uses only synchronous better-sqlite3 operations; adding `readFileSync` (from `node:fs`) for dependent content is consistent with that pattern
   - What's unclear: whether reading file content synchronously during a BFS walk is acceptable for large dependency graphs
   - Recommendation: use `readFileSync` with try/catch for simplicity — this is consistent with the sync-first pattern used throughout cascade and db modules. For very deep graphs, content reads add latency but the cascade is already doing multiple DB writes per node; the performance profile is similar.

## Sources

### Primary (HIGH confidence)
- Direct code inspection: `src/change-detector/change-detector.ts` — confirmed `_classifyWithLlmFallback` returns hardcoded unknown without calling `queueLlmDiffJob`
- Direct code inspection: `src/cascade/cascade-engine.ts` — confirmed `insertLlmJobIfNotPending(filePath, 'change_impact', 2)` called without payload parameter
- Direct code inspection: `src/db/repository.ts` lines 374-387 — confirmed `insertLlmJobIfNotPending` signature lacks payload
- Direct code inspection: `src/llm/pipeline.ts` lines 199-203 — confirmed `no_payload` throw for change_impact jobs with null payload
- Direct code inspection: `src/change-detector/llm-diff-fallback.ts` — confirmed `queueLlmDiffJob` is fully implemented and needs no changes
- Direct code inspection: `src/change-detector/ast-parser.ts` line 128 — confirmed `console.warn` location
- Direct code inspection: `src/logger.ts` — confirmed `log()`, `warn()` exports and daemon-mode suppression behavior
- Direct code inspection: `src/coordinator.ts` lines 464-491 — confirmed cascadeStale call site and changeSummary availability

### Secondary (MEDIUM confidence)
- Node.js built-in `child_process.execSync` API behavior (timeout option, encoding option) — standard Node.js API, stable across all Node versions used in this project

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all modules verified by direct code inspection; no external library research needed
- Architecture patterns: HIGH — function signatures, call sites, and integration points all confirmed from source
- Pitfalls: HIGH — dedup behavior confirmed from source; git/execSync pitfalls are well-known Node.js patterns

**Research date:** 2026-03-18
**Valid until:** 2026-06-18 (stable — no fast-moving dependencies; all changes are internal TypeScript wiring)
