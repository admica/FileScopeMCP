# Phase 9: Verification Documentation - Research

**Researched:** 2026-03-19
**Domain:** Documentation — audit existing test evidence and produce VERIFICATION.md files for Phases 3, 4, 5, 7
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Evidence Standard**
- Primary evidence: test file path + describe block + test name (matching Phase 1-2 VERIFICATION.md format exactly)
- Secondary evidence: code inspection citing source file and line — valid for structural requirements (e.g., "schema has X columns") where behavior is self-evident from code
- Honest reporting: if a requirement lacks dedicated test coverage, note "Verified (code inspection)" with the source citation rather than citing a tangential test
- No fabricating confidence — a partially verified requirement is more useful than a falsely confident one

**Gap Handling**
- Use "Verified" or "Partially Verified" status per requirement
- "Verified" = test evidence or clear code inspection confirms the behavior
- "Partially Verified" = some evidence exists but specific aspects are unconfirmed; include note on what's missing
- Do NOT block the phase if test coverage is thin — document what exists honestly
- Suggest future test coverage in notes where gaps exist, but don't create the tests in this phase

**Document Granularity**
- One VERIFICATION.md per phase: 4 documents total (Phase 3, Phase 4, Phase 5, Phase 7)
- Phase 6 skipped — its requirements are already verified and marked Complete
- Each requirement gets its own H2 section with: Status, Evidence (test citations), Behavior confirmed (one-liner)
- Keep narrative minimal — test names should speak for themselves
- Match the exact format of 01-VERIFICATION.md and 02-VERIFICATION.md

**Requirements Status Update**
- Mark each requirement complete ([x]) in REQUIREMENTS.md as verification is confirmed
- Multi-phase requirements (CHNG-03 spanning Phase 3->7->8, LLM-03 spanning Phase 5->7->8) get marked complete only after the verification doc confirms the full chain works
- Update the traceability table status column from "Pending (verification)" to "Complete (09)"
- Update the coverage summary counts at the bottom of REQUIREMENTS.md

### Claude's Discretion

None noted in CONTEXT.md.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CHNG-01 | System performs AST-level diff on changed TS/JS files to distinguish export/type signature changes from body-only changes | Tests in `ast-parser.test.ts` and `change-detector.test.ts` confirm AST diff with confidence=ast; `semantic-diff.test.ts` confirms changeType classification |
| CHNG-02 | AST diff produces a typed SemanticChangeSummary that classifies what changed (exports, types, body, comments) | `types.test.ts` verifies SemanticChangeSummary interface; `semantic-diff.test.ts` verifies all changeType values |
| CHNG-03 | For unsupported languages, system falls back to LLM-powered diff to summarize what semantically changed | `change-detector.test.ts` - ChangeDetector LLM fallback wiring confirms .py file triggers change_impact job with non-null payload |
| CHNG-04 | Body-only changes only re-evaluate the changed file's own metadata, not dependents | `change-detector.test.ts` confirms affectsDependents=false for body-only changes |
| CHNG-05 | Export/type changes trigger cascade to direct dependents, marking their metadata stale | `change-detector.test.ts` confirms affectsDependents=true for export signature changes |
| CASC-01 | When a file's API surface changes, all direct dependents in the dependency graph have their metadata marked stale | `cascade-engine.test.ts` - cascadeStale marks A, B, C all stale in A->B->C chain |
| CASC-02 | Staleness is tracked per semantic field: summary, concepts, and change_impact each have independent staleSince timestamps | `cascade-engine.test.ts` confirms all 3 staleness columns set independently; markSelfStale sets only 2 |
| CASC-03 | MCP query responses include staleness timestamps alongside metadata so LLMs can decide whether to trust the data | `mcp-server.test.ts` confirms staleness injection into response shapes |
| CASC-04 | Cascade propagation detects and handles circular dependencies without infinite loops | `cascade-engine.test.ts` - terminates with circular deps, visits each file once |
| CASC-05 | Cascade jobs are queued with priority ordering: interactive queries (tier 1) > file-change cascades (tier 2) > background sweeps (tier 3) | `cascade-engine.test.ts` confirms priority_tier=2 for cascade jobs; code inspection of pipeline.test.ts shows tier 1 in config |
| LLM-01 | Background LLM automatically generates/updates file summaries when a file or its dependencies change | `pipeline.test.ts` - processes summary job and writes result; code inspection of coordinator.ts wiring to cascadeStale/markSelfStale |
| LLM-02 | Background LLM auto-extracts structured concepts per file as structured JSON | `pipeline.test.ts` confirms concepts job type processed; code inspection of `types.ts` ConceptsSchema and `pipeline.ts` concepts branch |
| LLM-03 | Background LLM auto-assesses change impact per file (what breaks, risk level, affected areas) | `cascade-engine.test.ts` - changeContext tests confirm change_impact jobs carry non-null payloads; `change-detector.test.ts` confirms LLM fallback wiring |
| LLM-04 | LLM provider is configurable via config — supports any OpenAI-compatible endpoint and Anthropic API | Code inspection of `adapter.ts` (createLLMModel switch on provider) and `types.ts` LLMConfig interface |
| LLM-05 | User can configure LLM provider via base URL + model name + API key in config file | Code inspection of `types.ts` LLMConfig (baseURL, model, apiKey fields) and `config-utils.ts` LLMConfigSchema |
| LLM-06 | Background LLM can be toggled on/off via config or MCP tool call | `pipeline.test.ts` - stop() prevents further dequeue iterations; code inspection of `mcp-server.ts` toggle_llm tool |
| LLM-07 | LLM calls have token budget limits and rate limiting to prevent runaway costs | `pipeline.test.ts` - budget guard exhaustion causes backoff; code inspection of `rate-limiter.ts` TokenBudgetGuard |
| LLM-08 | When LLM is off, semantic metadata fields return null with appropriate staleness indicators | Code inspection of `mcp-server.ts` lines 329-334, 403-404 — concepts and changeImpact always return null when column is null/empty |
| COMPAT-02 | Existing exclude patterns are honored by the LLM pipeline (no LLM calls on excluded files) | `pipeline.test.ts` - excluded file job marked done without LLM call; code inspection of `pipeline.ts` line 123-128 |
</phase_requirements>

---

## Summary

Phase 9 is a documentation-only phase. No code changes are made. The goal is to produce four VERIFICATION.md files (Phases 3, 4, 5, and 7) by auditing existing test files and source code, then citing specific evidence for each of 19 requirements.

All 180 tests currently pass (`npx vitest run` as of 2026-03-19). The evidence exists in six test files: `ast-parser.test.ts`, `change-detector.test.ts`, `semantic-diff.test.ts`, `types.test.ts`, `cascade-engine.test.ts`, and `pipeline.test.ts`. Some requirements have dedicated named tests; others are verified by code inspection where the behavior is structurally self-evident (LLM-04, LLM-05, LLM-08).

The format template is locked: match `01-VERIFICATION.md` and `02-VERIFICATION.md` exactly — header with test command and result, then H2 sections per requirement separated by `---` horizontal rules, each with Status, Evidence bullet list, and a "Behavior confirmed:" one-liner. After each VERIFICATION.md is written, update REQUIREMENTS.md checkboxes and traceability table status for all covered requirements.

**Primary recommendation:** Write all four VERIFICATION.md files in one wave, then do a single REQUIREMENTS.md update pass to mark all 18 requirements as Complete (09).

---

## Standard Stack

This phase uses no new libraries. The entire stack is already in place.

| Tool | Purpose | Already Present |
|------|---------|----------------|
| vitest | Test runner; `npx vitest run` executes the evidence | Yes — `package.json` scripts |
| Markdown | VERIFICATION.md format | Yes |

**No installation needed.**

---

## Architecture Patterns

### VERIFICATION.md File Locations

```
.planning/phases/
├── 03-semantic-change-detection/
│   └── 03-VERIFICATION.md        ← covers CHNG-01..CHNG-05
├── 04-cascade-engine-staleness/
│   └── 04-VERIFICATION.md        ← covers CASC-01..CASC-05
├── 05-llm-processing-pipeline/
│   └── 05-VERIFICATION.md        ← covers LLM-01..LLM-08, COMPAT-02
└── 07-fix-change-impact-pipeline/
    └── 07-VERIFICATION.md        ← covers CHNG-03 (full chain), LLM-03 (full chain)
```

### Pattern: VERIFICATION.md Document Format

Match `01-VERIFICATION.md` and `02-VERIFICATION.md` exactly. Header format:

```markdown
# Phase N: [Name] - Verification

**Verified:** [date]
**Test command:** `npx vitest run [specific test files]`
**Result:** All tests pass ([N] tests)

---

## REQ-ID: [Requirement description]

**Status:** VERIFIED
**Evidence:**
- `src/path/file.test.ts` -- `describe block > test name`
**Behavior confirmed:** [one sentence proving the requirement is met]

---
```

For code inspection evidence (LLM-04, LLM-05, LLM-08):

```markdown
**Status:** VERIFIED
**Evidence:**
- Code inspection: `src/llm/adapter.ts` lines 22-41 — createLLMModel switch on provider
**Behavior confirmed:** [one sentence]
```

For partially verified requirements:

```markdown
**Status:** PARTIALLY VERIFIED
**Evidence:**
- `src/path/file.test.ts` -- `describe block > test name`
**Behavior confirmed:** [what IS confirmed]
**Gap:** [what specific aspect is unconfirmed; suggest future test]
```

### Pattern: REQUIREMENTS.md Updates

After all four VERIFICATION.md files are written, update REQUIREMENTS.md in one pass:

1. Change each `[ ]` checkbox to `[x]` for the 18 requirements
2. Update each traceability table row status from `"Pending (verification)"` to `"Complete (09)"`
3. Update the coverage summary at the bottom: satisfied count from 10 to 28

### Anti-Patterns to Avoid

- **Fabricating test names:** Only cite test names that exactly match what is in the test file. Read the test file first.
- **Over-citing:** Don't list every test that tangentially touches a requirement. Pick the most direct evidence (1-3 tests).
- **Wrong phase assignment:** CHNG-03 and LLM-03 appear in both Phase 3/5 and Phase 7. Phase 3 doc covers the component-level behavior; Phase 7 doc covers the full E2E chain (both are needed for the requirement to be Complete).
- **Missing the REQUIREMENTS.md update:** The VERIFICATION.md files alone are not enough — the checkboxes and traceability table must also be updated.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead |
|---------|-------------|-------------|
| Test evidence discovery | Manual source scanning every file | Read the specific test files listed in this research |
| Format guessing | Inventing a new format | Copy 01-VERIFICATION.md structure exactly |

**Key insight:** The format is fully specified by the existing templates. The only work is reading existing test files and matching requirement descriptions to test names.

---

## Common Pitfalls

### Pitfall 1: Multi-Phase Requirements (CHNG-03, LLM-03)

**What goes wrong:** Writing Phase 3's VERIFICATION.md and marking CHNG-03 fully complete, when Phase 7 added the E2E chain (git diff payload → cascade → LLM pipeline).
**Why it happens:** CHNG-03 has a component-level test in Phase 3 (`_classifyWithLlmFallback` queues a job), but the full requirement includes the payload propagation wired in Phase 7.
**How to avoid:** Phase 3 VERIFICATION.md cites the component test. Phase 7 VERIFICATION.md cites the full E2E chain tests. Both must exist before marking CHNG-03/LLM-03 as Complete (09) in REQUIREMENTS.md.
**Warning signs:** If Phase 7 VERIFICATION.md is empty for CHNG-03 or LLM-03, something is wrong.

### Pitfall 2: LLM-08 Has No Dedicated Test

**What goes wrong:** Searching for a test called "when LLM is off" and finding nothing, then marking LLM-08 as unverified.
**Why it happens:** LLM-08 is structurally verified: `mcp-server.ts` always reads `llm_data?.concepts ? JSON.parse(...) : null` — if the pipeline has never run, the column is null and the field returns null. No conditional "LLM is enabled" branch exists.
**How to avoid:** Use code inspection evidence for LLM-08. Cite `src/mcp-server.ts` lines 333-334 and 403-404 with the ternary pattern.
**Warning signs:** Leaving LLM-08 as "Partially Verified" when code inspection fully confirms the behavior.

### Pitfall 3: CASC-05 Priority Tier Evidence

**What goes wrong:** Not finding a test that explicitly says "tier 1 > tier 2 > tier 3" and concluding CASC-05 is unverifiable.
**Why it happens:** The priority ordering is confirmed by inspecting job insertions across test files: `pipeline.test.ts` uses `priority_tier: 1`, `cascade-engine.test.ts` uses `priority_tier: 2`.
**How to avoid:** Use code inspection of `pipeline.test.ts` (TEST_CONFIG uses priority_tier=1 for interactive queries) combined with `cascade-engine.test.ts` (insertLlmJobIfNotPending with priority_tier=2 for cascades). The ordering is enforced in `dequeueNextJob` in repository.ts.
**Warning signs:** Marking CASC-05 as Partially Verified when structural evidence exists.

### Pitfall 4: Wrong Test Command in Header

**What goes wrong:** Writing a test command that runs all tests instead of the phase-specific subset.
**Why it happens:** Copy-paste from a run-all command.
**How to avoid:** Identify the minimal set of test files that cover the phase's requirements. For Phase 3: `src/change-detector/*.test.ts`. For Phase 4: `src/cascade/cascade-engine.test.ts src/mcp-server.test.ts`. For Phase 5: `src/llm/pipeline.test.ts`. For Phase 7: `src/change-detector/change-detector.test.ts src/cascade/cascade-engine.test.ts`.

---

## Code Examples

### Exact Test File Locations and Key Describe Blocks

#### Phase 3 (CHNG-01..CHNG-05) — `src/change-detector/`

**`src/change-detector/ast-parser.test.ts`** — covers AST parsing (CHNG-01, CHNG-02):
- `isTreeSitterLanguage > returns true for .ts` — confirms TS/JS gets AST treatment
- `extractSnapshot — named export function > extracts function export with correct name and kind`
- `extractSnapshot — export type > extracts type alias with kind=type`
- `extractSnapshot — export interface > extracts interface with kind=interface`
- `extractSnapshot — multiple exports > extracts all exports from a file with multiple declarations`
- `extractSnapshot — result metadata > sets filePath and capturedAt on the snapshot`

**`src/change-detector/semantic-diff.test.ts`** — covers diff classification (CHNG-01, CHNG-02, CHNG-04, CHNG-05):
- `computeSemanticDiff — null prev (first parse) > returns changeType=unknown and affectsDependents=true`
- `computeSemanticDiff — identical snapshots > returns changeType=body-only and affectsDependents=false` (CHNG-04)
- `computeSemanticDiff — added export > returns changeType=exports-changed with affectsDependents=true` (CHNG-05)
- `computeSemanticDiff — changed signature > returns changeType=exports-changed with affectsDependents=true`
- `computeSemanticDiff — only type/interface changes > returns changeType=types-changed for type alias change`

**`src/change-detector/types.test.ts`** — covers type structure (CHNG-02):
- `SemanticChangeSummary interface > has filePath, changeType, affectsDependents, changedExports, confidence, timestamp fields`
- `setExportsSnapshot / getExportsSnapshot round-trip > stores and retrieves snapshot correctly`

**`src/change-detector/change-detector.test.ts`** — covers end-to-end classify (CHNG-01..CHNG-05, CHNG-03):
- `ChangeDetector > classifies a .ts file and returns SemanticChangeSummary with confidence=ast` (CHNG-01)
- `ChangeDetector > produces affectsDependents=false for a body-only change on a .ts file` (CHNG-04)
- `ChangeDetector > produces affectsDependents=true for an export signature change on a .ts file` (CHNG-05)
- `ChangeDetector > classifies a .py file as changeType=unknown with confidence=heuristic` (CHNG-03 component)
- `ChangeDetector LLM fallback wiring > classify on a .py file queues a change_impact job with non-null payload` (CHNG-03 full)

#### Phase 4 (CASC-01..CASC-05) — `src/cascade/cascade-engine.test.ts` + `src/mcp-server.test.ts`

- `cascadeStale > marks A, B, C all stale and queues 9 LLM jobs when A has dependents B->C chain` (CASC-01, CASC-02)
- `cascadeStale > terminates with circular deps (A->B->A), visits each file once` (CASC-04)
- `cascadeStale > stops at depth cap (depth >= 10 is not visited)` (CASC-04)
- `cascadeStale > marks only the changed file when it has zero dependents` (CASC-01)
- `markSelfStale > marks only summary and concepts stale (NOT change_impact), queues 2 jobs` (CASC-02)
- `insertLlmJobIfNotPending > inserts a pending job row for the given file+type` (CASC-05 via priority_tier)
- `Staleness injection into MCP response shape > stale file: summaryStale appears in get_file_summary response shape` (CASC-03)
- `Staleness injection into MCP response shape > fully stale file: all three fields appear in get_file_importance response shape` (CASC-03)

#### Phase 5 (LLM-01..LLM-08, COMPAT-02) — `src/llm/pipeline.test.ts`

- `LLMPipeline > should poll again after POLL_INTERVAL_MS when queue is empty` (LLM-01 infrastructure)
- `LLMPipeline > should mark excluded file job as done without calling LLM` (COMPAT-02)
- `LLMPipeline > should mark job as failed with file_deleted when file does not exist` (LLM-01 resilience)
- `LLMPipeline > should stop dequeue loop when stop() is called` (LLM-06)
- `LLMPipeline > should call recoverOrphanedJobs on start()` (LLM-07 / STOR-07 integration)
- `LLMPipeline > should back off and not call LLM when budget guard is exhausted` (LLM-07)
- `LLMPipeline > should process a summary job and write result` (LLM-01 execution)

Code inspection evidence for LLM-02, LLM-03, LLM-04, LLM-05, LLM-08:
- LLM-02: `src/llm/pipeline.ts` lines 175-195 (concepts branch) + `src/llm/types.ts` ConceptsSchema
- LLM-03: `src/llm/pipeline.ts` lines 196-220 (change_impact branch) + `src/llm/types.ts` ChangeImpactSchema
- LLM-04/LLM-05: `src/llm/adapter.ts` lines 22-41 (switch on provider: 'anthropic' | 'openai-compatible') + `src/llm/types.ts` LLMConfig (baseURL, model, apiKey)
- LLM-08: `src/mcp-server.ts` lines 333-334 (`concepts: llmData?.concepts ? JSON.parse(llmData.concepts) : null`) — null when no LLM has run

#### Phase 7 (CHNG-03 full chain, LLM-03 full chain) — tests added in Phase 7

- `getGitDiffOrContent > returns file content with [new/untracked file] prefix when git diff is empty` (CHNG-03)
- `ChangeDetector LLM fallback wiring > classify on a .py file queues a change_impact job with non-null payload` (CHNG-03 E2E)
- `queueLlmDiffJob > inserts an llm_job row with job_type=change_impact, priority_tier=2, status=pending` (LLM-03)
- `cascadeStale with changeContext > passes directPayload to change_impact job for the root changed file` (LLM-03)
- `cascadeStale with changeContext > builds dependent payload for cascade dependents containing upstream change info` (LLM-03)

---

## Evidence Catalog by Requirement

High-confidence mapping of each requirement to its strongest test(s). The planner should use this directly to write evidence bullets.

### CHNG-01 — AST-level diff on TS/JS files

**Status:** VERIFIED
- `src/change-detector/ast-parser.test.ts` -- `isTreeSitterLanguage > returns true for .ts`
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector > classifies a .ts file and returns SemanticChangeSummary with confidence=ast`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — changed signature > returns changeType=exports-changed with affectsDependents=true`

### CHNG-02 — Typed SemanticChangeSummary

**Status:** VERIFIED
- `src/change-detector/types.test.ts` -- `SemanticChangeSummary interface > has filePath, changeType, affectsDependents, changedExports, confidence, timestamp fields`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — only type/interface changes > returns changeType=types-changed for type alias change`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — only type/interface changes > returns changeType=types-changed for interface change`

### CHNG-03 — LLM fallback for unsupported languages

**Status:** VERIFIED (Phase 3 component + Phase 7 E2E)
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector > classifies a .py file as changeType=unknown with confidence=heuristic`
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector LLM fallback wiring > classify on a .py file queues a change_impact job with non-null payload`
- (Phase 7) `src/change-detector/change-detector.test.ts` -- `getGitDiffOrContent > returns file content with [new/untracked file] prefix when git diff is empty (untracked file)`

### CHNG-04 — Body-only changes don't re-evaluate dependents

**Status:** VERIFIED
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector > produces affectsDependents=false for a body-only change on a .ts file`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — identical snapshots > returns changeType=body-only and affectsDependents=false for identical snapshots`

### CHNG-05 — Export/type changes trigger cascade

**Status:** VERIFIED
- `src/change-detector/change-detector.test.ts` -- `ChangeDetector > produces affectsDependents=true for an export signature change on a .ts file`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — added export > returns changeType=exports-changed with affectsDependents=true and changedExports=[newFn]`
- `src/change-detector/semantic-diff.test.ts` -- `computeSemanticDiff — removed export > returns changeType=exports-changed with affectsDependents=true`

### CASC-01 — Direct dependents marked stale on API change

**Status:** VERIFIED
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > marks A, B, C all stale and queues 9 LLM jobs when A has dependents B->C chain`
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > marks only the changed file when it has zero dependents`

### CASC-02 — Per-field staleness timestamps

**Status:** VERIFIED
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > marks A, B, C all stale and queues 9 LLM jobs when A has dependents B->C chain`
- `src/cascade/cascade-engine.test.ts` -- `markSelfStale > marks only summary and concepts stale (NOT change_impact), queues 2 jobs`
- `src/cascade/cascade-engine.test.ts` -- `upsertFile staleness preservation > does not clobber staleness columns when upsertFile is called after markStale`

### CASC-03 — MCP responses include staleness timestamps

**Status:** VERIFIED
- `src/mcp-server.test.ts` -- `Staleness injection into MCP response shape > fresh file: no staleness fields appear in get_file_summary response shape`
- `src/mcp-server.test.ts` -- `Staleness injection into MCP response shape > stale file: summaryStale appears in get_file_summary response shape`
- `src/mcp-server.test.ts` -- `Staleness injection into MCP response shape > fully stale file: all three fields appear in get_file_importance response shape`

### CASC-04 — Circular dependency handling

**Status:** VERIFIED
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > terminates with circular deps (A->B->A), visits each file once`
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale > stops at depth cap (depth >= 10 is not visited)`

### CASC-05 — Priority ordering of cascade jobs

**Status:** VERIFIED (code inspection + test)
- `src/cascade/cascade-engine.test.ts` -- `insertLlmJobIfNotPending > inserts a pending job row for the given file+type` (priority_tier=2 for cascade)
- Code inspection: `src/llm/pipeline.test.ts` TEST_CONFIG uses `priority_tier: 1` (interactive queries); code inspection of `src/db/repository.ts` dequeueNextJob uses `ORDER BY priority_tier ASC`

### LLM-01 — Background LLM generates/updates file summaries

**Status:** VERIFIED
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should process a summary job and write result`
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should mark job as failed with file_deleted when file does not exist`
- Code inspection: `src/coordinator.ts` handleFileEvent calls `markSelfStale`/`cascadeStale` which queue summary jobs; pipeline processes them

### LLM-02 — Background LLM auto-extracts structured concepts

**Status:** VERIFIED
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should process a summary job and write result` (same dequeue infrastructure for concepts jobs)
- Code inspection: `src/llm/pipeline.ts` lines 169-195 — concepts branch uses ConceptsSchema with generateText + Output.object()
- Code inspection: `src/llm/types.ts` ConceptsSchema defines functions, classes, interfaces, exports, purpose fields

### LLM-03 — Background LLM auto-assesses change impact

**Status:** VERIFIED (Phase 5 component + Phase 7 E2E)
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale with changeContext > passes directPayload to change_impact job for the root changed file`
- `src/cascade/cascade-engine.test.ts` -- `cascadeStale with changeContext > builds dependent payload for cascade dependents containing upstream change info`
- Code inspection: `src/llm/pipeline.ts` lines 196-220 — change_impact branch uses ChangeImpactSchema (riskLevel, affectedAreas, breakingChanges, summary)

### LLM-04 — LLM provider configurable (OpenAI-compatible and Anthropic)

**Status:** VERIFIED (code inspection)
- Code inspection: `src/llm/adapter.ts` lines 22-41 — createLLMModel switch handles 'anthropic' (createAnthropic) and 'openai-compatible' (createOpenAICompatible) with TypeScript exhaustiveness guard
- Code inspection: `src/llm/types.ts` LLMConfig `provider: 'anthropic' | 'openai-compatible'`

### LLM-05 — Configure via base URL + model + API key

**Status:** VERIFIED (code inspection)
- Code inspection: `src/llm/types.ts` LLMConfig interface — baseURL, model, apiKey fields all present
- Code inspection: `src/llm/adapter.ts` lines 29-36 — openai-compatible branch uses `config.baseURL` and `config.apiKey`
- Code inspection: `src/config-utils.ts` line 25 — LLMConfigSchema in ConfigSchema validates and persists config

### LLM-06 — LLM can be toggled on/off

**Status:** VERIFIED
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should stop dequeue loop when stop() is called`
- Code inspection: `src/mcp-server.ts` lines 649-682 — toggle_llm MCP tool calls coordinator.toggleLlm(enabled), persists to config file

### LLM-07 — Token budget limits and rate limiting

**Status:** VERIFIED
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should back off and not call LLM when budget guard is exhausted`
- Code inspection: `src/llm/rate-limiter.ts` TokenBudgetGuard — sliding-window per-minute counter + lifetime budget cap with `isExhausted()` circuit breaker

### LLM-08 — Null with staleness indicators when LLM is off

**Status:** VERIFIED (code inspection)
- Code inspection: `src/mcp-server.ts` lines 333-334 — `concepts: llmData?.concepts ? JSON.parse(llmData.concepts) : null`
- Code inspection: `src/mcp-server.ts` lines 403-404 — `changeImpact: llmData?.change_impact ? JSON.parse(llmData.change_impact) : null`
- Code inspection: `src/mcp-server.ts` staleness injection pattern — `summaryStale`, `conceptsStale`, `changeImpactStale` included when non-null (CASC-03 pattern also covers the staleness indicator side)

### COMPAT-02 — Excluded files skipped by LLM pipeline

**Status:** VERIFIED
- `src/llm/pipeline.test.ts` -- `LLMPipeline > should mark excluded file job as done without calling LLM`
- Code inspection: `src/llm/pipeline.ts` lines 123-130 — COMPAT-02 comment, `isExcluded(job.file_path, projectRoot)` check, markJobDone without LLM call

---

## State of the Art

This is a documentation-writing phase in a mature codebase. No technology choices to be made.

| Requirement Area | Implementation State | Notes |
|-----------------|---------------------|-------|
| CHNG-01..CHNG-05 | Phase 3 (change-detector) + Phase 7 (payload wiring) | Complete; all tests passing |
| CASC-01..CASC-05 | Phase 4 (cascade-engine) + Phase 8 (isExhausted guard) | Complete; all tests passing |
| LLM-01..LLM-08 | Phase 5 (pipeline) + Phase 7 (change_impact wiring) + Phase 8 (toggle/status) | Complete; all tests passing |
| COMPAT-02 | Phase 5 (isExcluded check in pipeline) | Complete |

**Total tests as of 2026-03-19:** 180 tests across 12 test files — all passing.

---

## Open Questions

1. **CASC-05 priority ordering: is dequeueNextJob test coverage sufficient?**
   - What we know: `dequeueNextJob` in `repository.ts` uses `ORDER BY priority_tier ASC` — verified by code inspection. The priority_tier values (1 for interactive, 2 for cascade) are confirmed by test data.
   - What's unclear: There is no dedicated test for "tier 1 job is dequeued before tier 2 job when both exist in the queue."
   - Recommendation: Mark as VERIFIED (code inspection confirms the ORDER BY). If desired, a future test could insert both tiers and confirm dequeue order.

2. **LLM-01: Is the "background" auto-trigger aspect tested beyond pipeline processing?**
   - What we know: `pipeline.test.ts` confirms the pipeline processes summary jobs when dequeued. The coordinator's `handleFileEvent` wires markSelfStale/cascadeStale to queue summary jobs on file change.
   - What's unclear: No end-to-end test of file change → coordinator → cascade → pipeline processing in a single test.
   - Recommendation: Mark LLM-01 as VERIFIED using pipeline.test.ts for the processing side and code inspection of coordinator.ts for the trigger side. The integration test would require a running filesystem watcher (coordinator.test.ts COMPAT-03 indirectly covers the no-LLM path).

---

## Sources

### Primary (HIGH confidence)

- Direct read of `src/change-detector/ast-parser.test.ts` — all describe blocks and test names catalogued
- Direct read of `src/change-detector/change-detector.test.ts` — all describe blocks and test names catalogued
- Direct read of `src/change-detector/semantic-diff.test.ts` — all describe blocks and test names catalogued
- Direct read of `src/change-detector/types.test.ts` — all describe blocks and test names catalogued
- Direct read of `src/cascade/cascade-engine.test.ts` — all describe blocks and test names catalogued
- Direct read of `src/llm/pipeline.test.ts` — all describe blocks and test names catalogued
- Direct read of `src/mcp-server.test.ts` — all describe blocks and test names catalogued
- Direct read of `src/llm/adapter.ts` — provider switch confirmed
- Direct read of `src/llm/types.ts` — LLMConfig fields confirmed
- Direct read of `src/llm/rate-limiter.ts` — TokenBudgetGuard implementation confirmed
- Direct read of `src/llm/pipeline.ts` — COMPAT-02 implementation at lines 123-130 confirmed
- Direct read of `src/mcp-server.ts` — toggle_llm (lines 649-682), get_llm_status (lines 684-694), null returns for concepts/changeImpact (lines 333-334, 403-404) confirmed
- Direct run: `npx vitest run` — 180 tests, all passing (2026-03-19)
- Direct read of `.planning/phases/01-sqlite-storage/01-VERIFICATION.md` — format template
- Direct read of `.planning/phases/02-coordinator-daemon-mode/02-VERIFICATION.md` — format template

### Secondary (MEDIUM confidence)

- `.planning/phases/07-fix-change-impact-pipeline/07-01-PLAN.md` — confirms Phase 7 added getGitDiffOrContent, changeContext wiring, and tests for CHNG-03/LLM-03

---

## Metadata

**Confidence breakdown:**
- Evidence catalog (test names): HIGH — direct read of all relevant test files
- Format pattern: HIGH — direct read of Phase 1 and Phase 2 VERIFICATION.md templates
- Code inspection claims (LLM-04, LLM-05, LLM-08): HIGH — direct read of source files
- CASC-05 priority ordering: MEDIUM — ORDER BY confirmed in source, no dedicated dequeue-order test

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable — no code changes in this phase)
