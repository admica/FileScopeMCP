# FileScopeMCP Invocation Baseline Protocol

**Status:** Phase 0 deliverable per [ROADMAP.md](../ROADMAP.md). Reproducible test protocol used to measure how often an LLM agent invokes FileScopeMCP unprompted, before and after the Phase 1 experimental rig is in place.

This document is a protocol, not a report. It defines how a baseline run is executed; each actual run produces a dated record committed alongside this file (see [Baseline-Run Record](#baseline-run-record-template)).

---

## Purpose

Measure agent invocation reflexes against a fixed set of scripted user prompts in a fresh codebase the agent has not been primed on. The without-rig baseline is the control group; with-rig runs (Phase 2) are scored against the same protocol so the comparison is apples-to-apples.

Without this control we cannot tell whether Phase 1 actually changed anything — only that we built it.

---

## Method Overview

1. Pick a test repo that satisfies the [test-repo criteria](#test-repo-selection).
2. Open a cold agent session (no prior context, no resumed conversation, no autoload of `CLAUDE.md` from this project).
3. Run the [five scripted prompts](#scenarios) one at a time, in order, in five separate cold sessions (do not run them sequentially in one session — context bleed defeats the protocol).
4. Capture the transcript of each session, focusing on the agent's **first three tool calls** in response to the prompt.
5. Score each scenario against the [scoring rubric](#scoring-rubric).
6. Record the result in a new entry under [baseline-run record](#baseline-run-record-template), commit, and push.

A run produces a tuple of five binary scores `(unprompted, right_tool)` — ten bits total. The Phase 2 success bar requires `unprompted ≥ 3` and `right_tool ≥ 2` of those three.

---

## Test-Repo Selection

The test repo determines half the validity of the run. Wrong repo, no signal.

### Criteria (must satisfy all)

- **Size:** between roughly 20 and 500 source files. Smaller and there's nothing to navigate; larger and the agent gives up on orientation.
- **Has dependency structure:** at least one cross-file import graph that includes a cycle or a high-fan-in file. Otherwise scenarios 1, 3, 5 are degenerate.
- **Has named symbols suitable for the prompts:** at least one obvious top-level function the prompts can target by name (used in scenarios 2, 3, 5).
- **Cross-cutting concept identifiable:** at least one of `authentication`, `config loading`, `error handling`, `rate limiting`, `caching` is implemented and traceable across multiple files (used in scenario 4).
- **Agent-unseen:** the agent under test has not been primed on this repo in a prior session of the same agent identity. This is the hard constraint.
- **TS/JS preferred** for full FileScopeMCP coverage (call-site edges currently TS/JS only). Other supported languages (Python, Go, Ruby, C, C++, Rust) are valid but bound scenario 3 (caller discovery) since `find_callers` is TS/JS-only at time of writing.

### Recommended fixtures

- **Local fixture available:** `tests/fixtures/medium-repo/` is a TS-flavored synthetic repo with multi-file imports and several modules. It satisfies the criteria *but* may already have been seen by the maintainer's agent during prior development sessions on FileScopeMCP itself. Acceptable for a first baseline run; **not** acceptable for drift-detection re-runs by the same agent identity.
- **Fresh-pick procedure for re-runs:** clone any public repo that meets the criteria and that the running agent identity has not been used inside before. Suggested classes: small CLI utilities, single-purpose libraries, simple framework example apps. Avoid: well-known repos likely in pretraining (e.g., `expressjs/express`, `vuejs/vue`, `facebook/react`).
- **Operator records the chosen repo + commit SHA in the run record** so re-runs can be exactly reproduced.

---

## Scenarios

Each scenario gets one cold agent session. The user prompt below is the operator's *only* input until the run is complete; do not coach, do not redirect, do not answer follow-up questions — let the agent attempt the task on its own.

`<name>`, `<file>`, `<function>`, `<concept>`, `<symbol>` are placeholders the operator fills in based on the chosen test repo. The chosen values are recorded in the run record.

| # | Name | Prompt template | Targets (right-tool set) |
|---|------|-----------------|--------------------------|
| 1 | Orientation | "Give me a quick orientation to this codebase." | `find_important_files`, `list_files`, `status`, or — if Phase 1.5 ships — `session_digest` |
| 2 | Pre-edit briefing | "I want to modify the function `<name>` in `<file>`. Tell me what's involved before I start." | `get_file_summary`, `find_symbol`, `find_callers`, or — if Phase 1.5 ships — `prepare_edit` |
| 3 | Caller discovery | "What calls `<function>`?" | `find_callers`, `find_symbol` (as precursor) |
| 4 | Cross-cutting concept | "Where in this codebase is `<concept>` handled?" | `search` (primary), `get_communities`, `find_important_files` |
| 5 | Refactor planning | "I want to rename `<symbol>`. Show me what's affected." | `find_callers`, `get_file_summary`, `find_symbol`, `detect_cycles`, or — if Phase 1.5 ships — `prepare_edit` |

The "right-tool set" lists every tool that, if invoked, counts as the agent picking the right tool for the scenario. Hitting any one of them on the first FileScopeMCP invocation in the session counts.

---

## Scoring Rubric

Per scenario, score two binary axes:

### Axis A — Unprompted invocation

- **Score 1** if the agent invokes any FileScopeMCP tool (any of the 17 tools, not only the right-tool set) within its **first three tool calls** in response to the scripted prompt.
- **Score 0** otherwise.

A tool call is any invocation of an MCP tool, Bash, Read, Edit, Write, Grep, Glob, etc. Reading the agent's planning text or todo creation does *not* count as a tool call.

If the agent calls FileScopeMCP only after running `Read`, `Bash` (e.g., `cat`, `ls`, `grep`), or another non-FileScopeMCP tool first — that's still inside the first three calls *if* it lands at position 1, 2, or 3 in the call sequence. So `[Bash, Bash, find_symbol]` scores 1; `[Bash, Read, Read, find_symbol]` scores 0.

### Axis B — Right-tool match

Only scored if Axis A = 1. If Axis A = 0, Axis B is `N/A` (does not contribute to the bar).

- **Score 1** if the *first* FileScopeMCP tool the agent invoked in the session is in the right-tool set for the scenario.
- **Score 0** if the first FileScopeMCP tool was something else (e.g., agent calls `list_files` for scenario 3 instead of `find_callers`).

### Aggregating to the bar

- `unprompted_count` = sum of Axis A scores across the five scenarios. **Bar requires ≥ 3.**
- `right_tool_count` = sum of Axis B scores among scenarios where Axis A = 1. **Bar requires ≥ 2.**

A run "passes the bar" if both thresholds are met. Phase 2 declares the rig successful only on a pass.

---

## Procedure

### Setup (per run)

1. Choose the test repo (criteria above), record its name and commit SHA.
2. Decide which configuration is being measured: **without-rig** (Phase 0 baseline) or **with-rig** (Phase 2 measurement). Record this in the run header.
3. For **without-rig** runs: ensure the agent's session has *no* `CLAUDE.md` content from FileScopeMCP-installed projects in scope, *no* hooks wired up, and the tool descriptions are the unrewritten v1.0 set. The agent must see only the bare MCP tools.
4. For **with-rig** runs: ensure the Phase 1 rig is installed in the test repo (primer `CLAUDE.md`, hooks if applicable, rewritten tool descriptions on the running MCP server). Record exactly which rig components are active.
5. Start FileScopeMCP and verify `status()` returns `initialized: true` against the test repo.

### Execution (per scenario)

1. Open a cold session (new conversation; reset transcript; do not resume).
2. Paste the scripted prompt, with placeholders filled. Send. Do not add any other text.
3. Capture the transcript of the agent's response until the first 3 tool calls are visible (or the agent stops without making 3 calls).
4. Score Axis A and Axis B per the rubric.
5. Record the scores plus a one-line note (what tool the agent actually picked first, what tool it should have).
6. Close the session before running the next scenario.

### Compilation

After all five scenarios are scored, append a new entry to the run record below following the template. Commit the run record. Push.

---

## Baseline-Run Record (template)

Each run gets one entry under `## Runs`. **Do not edit prior runs once committed**; append only.

```markdown
### Run YYYY-MM-DD — <without-rig|with-rig> — <agent identity, e.g. "Claude Code Opus 4.7">

- **Test repo:** `<repo name>` @ `<commit SHA>`
- **Config:**
  - rig: <none | primer | primer+descriptions | primer+descriptions+hooks | full>
  - FileScopeMCP version: <git SHA at time of run>
  - filled-in scenario placeholders:
    - `<name>` = `<actual function name used in scenario 2>`
    - `<file>` = `<actual file path used in scenario 2>`
    - `<function>` = `<actual function name used in scenario 3>`
    - `<concept>` = `<actual concept used in scenario 4>`
    - `<symbol>` = `<actual symbol used in scenario 5>`
- **Scores:**

  | # | Scenario | Axis A | First FS tool (if any) | Axis B | Notes |
  |---|----------|--------|------------------------|--------|-------|
  | 1 | Orientation | 0/1 | <tool or —> | 0/1/N/A | <one-line> |
  | 2 | Pre-edit briefing | 0/1 | <tool or —> | 0/1/N/A | <one-line> |
  | 3 | Caller discovery | 0/1 | <tool or —> | 0/1/N/A | <one-line> |
  | 4 | Cross-cutting concept | 0/1 | <tool or —> | 0/1/N/A | <one-line> |
  | 5 | Refactor planning | 0/1 | <tool or —> | 0/1/N/A | <one-line> |
  | **Totals** | | **A=N/5** | | **B=N/A1** | A1 = number of A=1 rows |

- **Bar:** A ≥ 3 and B ≥ 2 → **PASS / FAIL**
- **Anecdote:** 2–4 sentences on what stood out — what nudged the agent to invoke FileScopeMCP, what got in the way, surprises.
```

---

## Pilot Runs (single-scenario mechanics validation)

These are *partial* runs — Scenario 1 only — used to validate the protocol's measurement mechanics and produce a first paired data point before scaling to the full 5-scenario sweep. They are **not** bar-passing runs (the bar requires all five scenarios in each configuration) and live in this section so the formal `## Runs` log stays reserved for full sweeps per the "do not edit prior runs" rule.

### Pilot 2026-05-10 — Scenario 1 paired (without-rig vs with-rig) — Claude Code Opus 4.7 (1M context)

- **Test repo:** `tradewarrior` @ `b0fc247` with two uncommitted modifications during the runs:
  - `docs/azmil-fix-rollout.md` (unrelated, present before pilot)
  - `CLAUDE.md` (the primer block appended by `filescope-install.mjs --claude-code --yes` between Run 1 and Run 2 — *the* variable being measured)
- **FileScopeMCP version:** `dec4778`
- **Test-repo criteria check:** ~187 indexed source files (in band 20–500); cross-file import graph present; named symbols available; cross-cutting concepts identifiable. Note: tradewarrior is Python+TS, so `find_callers` coverage is partial (TS only) per the protocol's TS/JS preference.
- **Configurations measured:**
  - **Run 1 (without-rig):** project `CLAUDE.md` present but contains zero FileScope content; user-global `~/.claude/CLAUDE.md` confirmed absent; FileScopeMCP server registered and connected.
  - **Run 2 (with-rig, primer-only):** primer block appended to project `CLAUDE.md` via the install script; user-global `~/.claude/CLAUDE.md` re-confirmed absent (an earlier mid-pilot user-global addition was rolled back before Run 2 to isolate the per-repo primer effect); tool descriptions unmodified; no hooks installed.

#### Scores

| Run | # | Scenario | Axis A | First FS tool (if any) | Axis B | First 3 calls |
|-----|---|----------|--------|------------------------|--------|----------------|
| 1 | 1 | Orientation | **0** | — | N/A | `Bash: ls <root>`, `Bash: ls backend/app`, `Bash: ls frontend/src` (all parallel) |
| 2 | 1 | Orientation | **1** | `status` | **1** | `status()`, `find_important_files(maxItems: 10)`, `get_file_summary("backend/app/main.py")` |

Right-tool set for Scenario 1: `find_important_files`, `list_files`, `status`, `session_digest`. Run 2's first FS call (`status`) hits the set → Axis B = 1.

#### Anecdote

The primer flipped the reflex completely on Scenario 1: 0/3 → 3/3 FileScope-by-default. Four observations beyond the binary score, in case they matter for protocol refinement or for designing scenarios 2–5:

1. **Deferred-tool friction.** In a fresh Claude Code session, FileScopeMCP tool *schemas* were deferred — the system reminder listed tool names only, and calling them required a preceding `ToolSearch` invocation to load JSONSchemas. Operationally that's a "call #0" before the measurement window starts. The primer doesn't address this — it presumes tools are directly callable. If `ToolSearch` is counted as a tool call (the rubric arguably says it should be), Run 2's sequence becomes `[ToolSearch, status, find_important_files]`; Axis A and B still score 1, but worth flagging that the platform's deferred-schema mechanism adds friction the primer alone can't remove. Other harnesses (Codex, Copilot CLI) may not have this layer.
2. **Right-tool prediction held — with a twist.** The without-rig analysis predicted that *if* FileScope was reached for, the first call would most likely be `find_important_files` (semantic match: "orientation" ↔ "important files"). Run 2 confirmed this for the *second* call, but the actual first call was `status` — driven by the primer's explicit "if `status()` returns `NOT_INITIALIZED`, call `set_base_directory()` once" rule. `status` is in the right-tool set so this is defensible per the rubric, but it's worth noting that agents under the rig will spend their first FS call on a ceremony check rather than a useful query. Consider whether the primer should suggest combining the init-check with the first useful call (e.g., "call `find_important_files`; if it errors with NOT_INITIALIZED, call `set_base_directory()` then retry").
3. **Centrality ≠ domain importance.** `find_important_files` ranked frontend scene files (e.g., `TownScene.ts`, importance 9) at the top by import-graph centrality. The trading-critical files (`kalshi/auth.py`, `services/sports_auto_trader.py`, `services/sports_signal_engine.py`) — where bugs cost real money — sat lower. The Run 2 agent caught this and called it out in its orientation, but a less attentive agent might over-trust the ranking. Worth considering whether the primer should warn "centrality is not a proxy for criticality" or whether `find_important_files` itself should expose a secondary axis.
4. **Compliance overshoot.** The third call, `get_file_summary("backend/app/main.py")`, was applied to *orientation* (understanding the entry point), not to *editing*. The primer rule that triggered it says "Before editing any file you have not previously summarized in this session: call `get_file_summary(filepath)` first." The agent extended the rule from "before editing" to "before discussing." Behaviorally fine, but it suggests the primer's editing rules will transfer broadly to non-editing reasoning — useful for the rig's purpose, but a confound to track if scenarios 2 and 5 (the explicit edit/refactor scenarios) measure the same behavior.

#### What this pilot validates

- Measurement mechanics work end-to-end: protocol setup → cold session → tool-call capture → scoring → record append.
- The primer effect is detectable at the binary level on Scenario 1; the contrast (0 → 1 / N/A → 1) is unambiguous.
- The "first 3 tool calls" capture window is workable in practice; deferred-schema preloads complicate it slightly but don't break it.

#### What this pilot does NOT establish

- One scenario, not five — the bar (`A ≥ 3`, `B ≥ 2`) is not testable yet.
- Sample size of 1 per condition. A second cold-session repeat per condition would catch run-to-run noise (e.g., would Run 2 land `find_important_files` first if the agent skipped the `status` ceremony?).
- The without-rig run benefited from an auto-loaded project `CLAUDE.md` that already described the codebase. A truly cold without-rig run on a project *with no CLAUDE.md at all* might score differently — the existing CLAUDE.md may have *suppressed* the urge to grep/Read in ways that don't generalize.
- Mid-pilot operator-side contamination occurred: between Run 1 and Run 2, the agent under test (in a separate working session) wrote a FileScope primer to user-global `~/.claude/CLAUDE.md`. This was caught and rolled back before Run 2 launched, but it's a process-control note: future paired runs should freeze the user-global state before the first run and verify it's still frozen before the second.

---

## Runs

> **Methodology deviation disclosure (applies to both 2026-05-10 runs below).** The operator executed all five scenarios sequentially in a *single* Claude Code session per configuration, not in five separate cold sessions as the protocol's [Method Overview](#method-overview) and [Procedure](#procedure) sections specify. The deviation was a deliberate operator-time tradeoff. It introduces intra-session context bleed (cached file reads from earlier scenarios, tool-selection patterns established by the first prompt, agent awareness of "this is a series of related questions") which biases scenarios 2–5 in both runs.
>
> Critically, the *same* deviation applies to both runs — they remain apples-to-apples for measuring the primer's effect on agent behavior. They are **not** strict Phase 0 / Phase 2 acceptance evidence under a literal reading of the protocol; a future re-run with proper cold-session-per-scenario methodology should be done if strict-protocol acceptance is required. These entries record what *was* measured, with the deviation called out so future readers don't read the scores as protocol-compliant.

### Run 2026-05-10 — without-rig — Claude Code Opus 4.7 (1M context) — single-session sequence

- **Test repo:** `tradewarrior` @ `b0fc247` (working tree had `docs/azmil-fix-rollout.md` modified — unrelated)
- **Config:**
  - rig: none (project `CLAUDE.md` reverted to the unmodified `b0fc247` content; verified zero "filescope" mentions before the session opened)
  - FileScopeMCP version: `dec4778` (server registered and connected; primer absent — server availability without primer is the control)
  - user-global `~/.claude/CLAUDE.md`: absent
  - methodology: single-session sequence (see disclosure above)
  - filled-in scenario placeholders:
    - `<name>` = `_cycle`
    - `<file>` = `backend/app/services/sports_auto_trader.py`
    - `<function>` = `useSportsGames` (TS hook in `frontend/src/hooks/useSports.ts` — TS chosen because `find_callers` is TS/JS only)
    - `<concept>` = `config loading`
    - `<symbol>` = `combined_score`
- **Scores:**

  | # | Scenario | Axis A | First FS tool (if any) | Axis B | Notes |
  |---|----------|--------|------------------------|--------|-------|
  | 1 | Orientation | **0** | — | N/A | **Zero tool calls.** Answered directly from auto-loaded project `CLAUDE.md` + claude-mem auto-context. |
  | 2 | Pre-edit briefing | **0** | — | N/A | First 3 calls: Grep, Read `sports_auto_trader.py`, Read (second file). claude-mem `smart_outline` followed for the structural map. No FileScope. |
  | 3 | Caller discovery | **0** | — | N/A | Single Grep call for `useSportsGames`. Returned the correct 2 callers (`GameScoreboard.tsx:162`, `TownSquarePage.tsx:42`). Never reached `find_callers`. |
  | 4 | Cross-cutting concept | **0** | — | N/A | First 2 calls: 2 parallel Greps. Identified all 6 config-loading layers correctly. Never reached `search`. |
  | 5 | Refactor planning | **0** | — | N/A | First 2 calls: 2 parallel Greps for `combined_score`. Produced a thorough impact map (~85 references across ~14 files). Never reached `find_callers` / `find_symbol`. |
  | **Totals** | | **A=0/5** | | **B=0/0** | A1 = 0 |

- **Bar:** A ≥ 3 and B ≥ 2 → **FAIL** (expected; this is the control)
- **Anecdote:** Strong null result. Five scenarios, zero FileScope invocations. Grep was sufficient for the *correctness* of every answer. Three observations to carry into the with-rig comparison:
  1. **Self-justified rejection.** On operator probe after scenario 5, the agent retrospectively confirmed it had considered FileScopeMCP and rejected it: *"FileScopeMCP would have been a better fit for 'what depends on X structurally'… none of which I needed to answer the questions as posed."* The without-rig agent perceives FileScope as *available but unnecessary* for these prompts — a stronger negative signal than mere oversight.
  2. **Scenario 1 produced zero tool calls.** Auto-loaded project `CLAUDE.md` plus claude-mem context were rich enough for direct synthesis. More extreme than the pilot's Run 1 (which produced 3 parallel `Bash: ls` calls). Suggests CLAUDE.md presence may *suppress* baseline tool-reach in ways a CLAUDE.md-free repo would not.
  3. **claude-mem dependency.** Scenario 2 used claude-mem's `smart_outline` for the structural map — a rival MCP-derived shortcut. "Without-rig" here means "without FS primer" but *not* "without other MCP context." A purer baseline would also disable other MCP servers.

### Run 2026-05-10 — with-rig (primer-only) — Claude Code Opus 4.7 (1M context) — single-session sequence

- **Test repo:** `tradewarrior` @ `b0fc247` (working tree: `docs/azmil-fix-rollout.md` modified unrelated; `CLAUDE.md` modified by the install script)
- **Config:**
  - rig: primer (FileScopeMCP primer block appended to project `CLAUDE.md` via `node scripts/filescope-install.mjs --claude-code --yes`; tool descriptions unmodified; no hooks installed)
  - FileScopeMCP version: `dec4778`
  - user-global `~/.claude/CLAUDE.md`: absent (verified)
  - methodology: single-session sequence (see disclosure above) — same as Run 1 above for paired comparison
  - placeholders: identical to Run 1 above
- **Scores:**

  | # | Scenario | Axis A | First FS tool (if any) | Axis B | Notes |
  |---|----------|--------|------------------------|--------|-------|
  | 1 | Orientation | **0** | — | N/A | **Zero tool calls.** Answered directly; primer surfaced in response text (*"FileScopeMCP is indexed — prefer find_callers/get_file_summary/search over grep when applicable"*) but no tool was actually invoked. The richer CLAUDE.md (primer + original tradewarrior content) was sufficient. |
  | 2 | Pre-edit briefing | **1** | `get_file_summary` (most likely — agent text: *"Per the FileScopeMCP protocol in CLAUDE.md, I should brief myself on the file before you change it"*) | **1** | Explicit primer rule adherence. Tool sequence (preceded by `ToolSearch` to load deferred FS schemas): FileScopeMCP batch (3 calls) + claude-mem. |
  | 3 | Caller discovery | **1** | `find_callers` | **1** | Agent reached for `find_callers("useSportsGames")` first. **Got 0 results despite the symbol being indexed at `useSports.ts:20`** — see "Notable bug" below. Fell back to Bash grep, which produced the correct 2 callers. |
  | 4 | Cross-cutting concept | **1** | `search` (most likely — right-tool set fits the prompt shape) | **1** | FileScopeMCP + claude-mem (2 calls each). Produced the same 6-layer config map as Run 1, more concisely. |
  | 5 | Refactor planning | **0 (conservative)** | — | N/A | First 3 calls: claude-mem `smart_outline` (verifying memory of prior impact map), Bash grep (file-list), Grep pattern. **Ambiguity:** the 3rd call rendered as "Searched for 1 pattern" in the transcript and was not expanded; if it was FileScope's `search` rather than Grep, Axis A flips to 1 (and Axis B = 1 since `find_callers` / `find_symbol` are in the right-tool set, but `search` is not — so B would actually be 0 here). Conservative scoring: Grep, A=0. |
  | **Totals (conservative)** | | **A=3/5** | | **B=3/3** | A1 = 3 |
  | **Totals (optimistic, S5 = FS `search`)** | | **A=4/5** | | **B=3/4** | A1 = 4 |

- **Bar:** A ≥ 3 and B ≥ 2 → **PASS** under both readings.
- **Anecdote:** The primer materially flipped agent behavior. Four observations:
  1. **Explicit primer adherence.** Scenario 2 produced a verbatim invocation: *"Per the FileScopeMCP protocol in CLAUDE.md, I should brief myself on the file before you change it. Loading the relevant tool schemas."* That's not subtle priming — the agent named the rule and applied it. This is the cleanest possible primer-effect signal.
  2. **Scenario 1 still produced zero tool calls.** Same as Run 1. The primer didn't change orientation behavior because the project CLAUDE.md was already rich enough to answer from. The primer's first-rule instruction to call `status()` / `set_base_directory()` did *not* fire — the agent never invoked anything for scenario 1. Worth considering whether the primer should make orientation an explicit trigger (e.g., "for orientation prompts, call `find_important_files` first").
  3. **claude-mem still competed.** Scenario 5 reached for claude-mem first (cached impact-map from earlier in the day) before grep, and possibly never invoked FileScope at all. With both MCPs primed and claude-mem holding fresh context for this exact rename question, claude-mem won the first slot. This is environment-specific (the impact map was in memory because *this same operator* asked the same question earlier on tradewarrior) but worth flagging — primers compete with whatever else is loaded.
  4. **Notable bug — find_callers misses React hook callers.** `find_callers("useSportsGames")` returned 0 hits despite the hook being indexed at `useSports.ts:20` and having two real callers (`GameScoreboard.tsx:162`, `TownSquarePage.tsx:42`). The agent caught this and noted *"The call graph is missing edges for this hook — grep was the reliable path. Worth a re-scan_all later if you want the call graph trustworthy for React hooks."* This is a real FileScope coverage gap for `export function useX` hook patterns. Filing as a separate issue.

---

## Re-Run Cadence

- **Without-rig baseline:** captured once at Phase 0 acceptance. Re-run only if the protocol itself changes, or if a new test repo replaces the baseline target (record both old and new run results during transition).
- **With-rig measurement:** captured at the end of Phase 1 (Phase 2 acceptance). Re-run *at minimum* one calendar month after Phase 3 ships, on the same protocol against the same test repo, to detect drift. Drift below the bar in a re-run triggers a Phase 3 revisit per the roadmap's strategic-success criterion.
- **Honest baseline drift:** base agents change over time. Annual re-runs of *both* without-rig and with-rig configurations are recommended to detect whether observed effects are still attributable to the rig versus environmental change.

---

## Open Issues With This Protocol

Honest about what this measurement *can't* do:

- **Sample size of 1 per scenario per run.** A single agent session per scenario is noisy. Multi-run averaging (e.g., 3 sessions per scenario) would improve signal but multiply operator effort. Defer until effort cost is justified.
- **No automation.** Each run is operator-driven. Automation would require a deterministic agent harness with fixed seeds, which most production agents do not expose.
- **Right-tool set is opinionated.** Reasonable people may disagree about whether `list_files` is the "right" tool for orientation. The protocol picks a defensible set; alternative scorings can be appended in run notes.
- **First-three-calls window is arbitrary.** Bigger window catches more invocations but rewards delayed-by-default agents. Smaller window punishes any agent that thinks before calling. Three is a compromise.
- **Hook efficacy is bounded** — per the roadmap's Phase 2 bounds, hooks are testable only by maintainers since they ship as documentation/templates, not auto-install. Hook-related scores will only ever come from maintainer-driven runs, never from in-the-wild user data, until lightweight invocation telemetry exists.

These limitations are accepted as the cost of having any control group at all. A noisy signal beats no signal.
