# FileScopeMCP Roadmap

This document is the strategic plan for FileScopeMCP. It is **direction-detailed by design**: we name what we are betting on, why, and what success looks like — but we deliberately under-specify implementation choices that should be made with evidence rather than guessed up front.

For per-phase implementation plans, see `.planning/<phase>/PLAN.md` once a phase begins. The atomic backlog of bugs, architecture items, and features lives at the bottom of this file under [Backlog](#backlog).

---

## Problem Statement

FileScopeMCP ships a strong tool surface — 17 MCP tools spanning semantic search, dependency analysis, symbol resolution, call-graph mapping, importance ranking, LLM-generated summaries, and a multi-repo dashboard. The capability ceiling is high. The capability *floor* — what agents actually invoke unprompted in a session — is low.

The honest baseline, from a first-person Claude Code session-reflex review:

| Situation | What the agent actually does | Why |
|---|---|---|
| Enter an unfamiliar codebase | `ls`, `cat README.md`, `find`, `grep` | Universal, in muscle memory. No signal in the system prompt that FileScopeMCP exists or that it should come first. |
| Before editing a file | `Read` the file | Source is authoritative; summaries can be stale. Reading 200 lines is "free." Unclear whether the summary saves work. |
| Debugging "who calls this function" | `grep -rn 'fnName'` | grep is reflexive. `find_callers` is novel. Coverage by language is uneven. |
| User asks "what's important in this codebase" | `find_important_files()` ✓ | Tool name semantically matches the user's word. |
| User asks about cycles / coupling | `detect_cycles()` ✓ | Same — name-to-noun match. |

**The pattern:** agents invoke FileScopeMCP only when a tool name semantically matches a noun the user just used. Outside of that, they default to Bash/Read/Grep — universal, habitual, "free." MCP tools sit in a pool agents *scan* when prompted, not a habit they reflexively reach for.

**The diagnosis follows:** this is not primarily a feature gap. The atomic primitives are good. The gap is **invocation** — the tools are not part of agent reflexes, and nothing nudges them to be. Tool descriptions today say *what tools do*, not *when to call them*. Atomic primitives lose to `Read` because `Read` is also one call and is universal. Agents under context pressure reach for the simplest path.

---

## The Strategic Bet

Two opinionated tracks, evidence-first, layered-not-monkeying:

- **Track A — Claude Code:** a primary daily driver. Build an *experimental rig* (project priming, tool-description rewrites, hook templates) and run real sessions to measure whether agent reflexes actually change. Add compound tools as a contingent follow-up only if the simpler rig misses the bar. Productize what works.
- **Track B — Hermes:** different mechanism (no harness-level hooks; lever is system-prompt priming via `SKILL.md` and `AGENTS.md`). Apply Track A's evidence to a Hermes-shaped install — not a copy of Track A.

Phases 2 and beyond are deliberately under-specified. We will not pre-decide what productization looks like before Phase 1 runs. Roadmaps that pre-bake their answer don't survive contact with reality.

A "one-size-fits-all install pipeline" was considered and rejected: Claude Code and Hermes diverge enough in mechanism (hooks vs. system-prompt priming, project-config vs. skills-directory discovery) that pretending one path serves both produces a worse result than two opinionated paths.

---

## Layering Rules (Non-Negotiable)

Cross-cutting constraint on every phase. FileScopeMCP **layers onto** agent runtimes; it does not modify their internal machinery.

- **`.claude/settings.json` (project hooks) and `~/.claude/settings.json` (user globals): never auto-write.** Even with a `--with-hooks` flag, the boundary holds. Hook configs ship as documented snippets the user copies in themselves.
- **`CLAUDE.md` and `AGENTS.md` are user-owned but tooling-edit-expected** (the `/init` pattern). FileScopeMCP may append content with explicit `<!-- BEGIN filescope -->` / `<!-- END filescope -->` markers — idempotent, removable, never trample existing content. Always opt-in, never silent.
- **Public CLI surfaces are fine to call** (`claude mcp add`, agent skill discovery directories that are documented as drop-points). Internal config files are not.
- **Anything ambiguous defaults to "documentation-and-templates,"** never auto-modify.

These rules apply to Track A, Track B, and anything we ship in the future. They are constraints on the *FileScopeMCP installer surface*, not on the agent's own actions during a session.

---

## Phase 0 — Honest Baseline

Before building, write down what we believe is true about agent invocation reflexes today (the table above) and commit it to the repo. This becomes the control group for Phase 2 measurements: with-rig invocation rates compared against without-rig baseline. Without this, we have no signal on whether the rig actually moved the needle.

**Deliverable:** `docs/invocation-baseline.md` — a reproducible test protocol, not just a table of situations.

**Protocol shape (must be concrete enough to score deterministically):**

- **Fresh test repository** — a small public repo the agent has not seen in prior sessions, cloned locally for each run. Eliminates the "agent already has context" confound.
- **Five scripted user prompts**, run on a cold session in this fresh repo. Each prompt targets one reference scenario:
  1. *Orientation:* "Give me a quick orientation to this codebase."
  2. *Pre-edit briefing:* "I want to modify the function `<name>` in `<file>`. Tell me what's involved before I start."
  3. *Caller discovery:* "What calls `<function>`?"
  4. *Cross-cutting concept:* "Where in this codebase is `<concept like authentication / config loading / error handling>` handled?"
  5. *Refactor planning:* "I want to rename `<symbol>`. Show me what's affected."
- **Deterministic scoring rubric** — for each scenario the transcript is scored on two binary axes: (a) Did the agent invoke any FileScopeMCP tool *unprompted* in its first 3 actions? (b) Was the invoked tool the *right* one for the scenario? "Right tool" is enumerated per-scenario in the protocol document.
- **Without-rig baseline run** is recorded first and committed. With-rig runs in Phase 2 compare against this baseline at the same scenario index.
- **Date stamp + agent version** — base agents drift; the baseline is timestamped and the agent identifier captured so future re-runs can detect drift independently from rig effect.

---

## Phase 1 — Claude Code Experimental Rig

**Goal:** make it a no-brainer for Claude Code to invoke FileScopeMCP in scenarios where it would otherwise default to Bash/Read/Grep. Build the rig in this repo so any project can opt in. The rig is not a product; it is an experiment whose contents may change after Phase 2.

### Scope (direction, not implementation)

- **Project priming.** A short, imperative `CLAUDE.md` primer — trigger conditions ("call X before Y"), not capability descriptions. Installable into target projects with the marker convention from the layering rules. Lives in this repo as a template; gets generated into the user's project as a marked block.

- **Tool descriptions rewritten as triggers.** Every tool's `description` field in `mcp-server.ts` gets a "**When to call:**" prefix and a concrete trigger condition. Counterweights ("skip if …") where appropriate. Done in our repo; no user-side changes. **Constraint: preserve the noun-match for primitives that already get reflexively invoked** (e.g., `find_important_files`, `detect_cycles`, `get_communities`) — adding a trigger prefix is fine, but the existing keywords that already drive invocation must remain in the description. Each tool's rewrite ships as a separate atomic commit so any single description change can be reverted without rolling back the whole pass.

- **Hook templates as documentation, not auto-install.** `docs/claude-code-hooks.md` ships canonical hook snippets (PreToolUse on Read/Edit/Write, SessionStart) and a small `filescope-helper` CLI so the snippets are copy-paste-ready. The installer prints the doc URL and the snippet; users paste into their own `.claude/settings.json` if they want them. **No auto-write — see Layering Rules.**

*(Compound MCP tools — `session_digest`, `prepare_edit` — were considered for Phase 1 but moved to a contingent Phase 1.5. Rationale: they are real engineering work with permanent maintenance cost. Building them before Phase 2 evidence is premature; Phase 1.5 below makes them a conditional follow-up.)*

- **Install command.** `filescope install --claude-code` detects Claude Code, runs `claude mcp add` (idempotent, public API), opt-in `CLAUDE.md` primer with markers, prints hook snippets and the doc URL, verifies with `claude mcp list`. Output: per-step ✓/✗ table.

### What we are explicitly not deciding yet

- The exact phrasing of the trigger-condition prefixes for each tool description (will be designed in `.planning/phase-1/PLAN.md` when Phase 1 starts).
- Whether the helper CLI talks to a long-running daemon or spawns short-lived MCP servers.
- Whether hooks should fire on every Read or only the first Read of a file per session.
- Whether the install command itself ships as `filescope install ...` or as a flag on the existing `./build.sh` / `register-mcp.mjs` path.
- Compound-tool signatures and payload shapes — deferred to Phase 1.5's plan if and when that phase triggers.

### Phase 1 success criteria (how Phase 2 will judge this rig)

- Tool description rewrite is complete, reviewed, and ships as one-tool-per-commit so any single rewrite is independently revertible.
- Description rewrite preserves the existing noun-match keywords for already-invoked primitives.
- Hook templates and helper CLI exist and are documented; layering rules are honored.
- Installer detects Claude Code, registers MCP, and produces a clear ✓/✗ table — *without* writing to any user-owned hook config.
- Rig is opt-in end-to-end. A user who installs FileScopeMCP without the new install command sees no behavior change.

---

## Phase 1.5 — Compound Tools (Contingent)

**Triggered only if Phase 2 evidence shows the Phase 1 rig (primer + description rewrite + hook templates) does not move agent invocation to the success bar on its own.** If Phase 2 hits the bar without compound tools, Phase 1.5 is skipped and the proposed tools are dropped from the plan.

**If triggered, ships two compound, ready-to-act MCP tools** whose job is to *beat `Read` on cost* — return enough context in one call that an agent under context pressure prefers them to chained primitives:

- `session_digest(since?)` — sub-1 KB project orientation: top files, recent changes, broker state, hints.
- `prepare_edit(filepath)` — pre-edit briefing: summary + dependents (with import lines) + exports + callers + cycle membership + community siblings, in one call.

These do not replace primitives; they sit alongside them. They re-enter Phase 2 measurement: a second with-rig run is scored against the same five scenarios. If they're invoked and move the bar, they ship to Phase 3. If they aren't invoked, they get cut without further iteration — no sunk-cost retention.

This staging eliminates the worst-case "build two tools, ship two tools, then delete two tools" by gating the build on evidence the simpler rig isn't enough.

---

## Phase 2 — Run, Observe, Measure

Real Claude Code sessions on real codebases — this repo plus the fresh test repo from the Phase 0 protocol — across the five reference scenarios. With-rig versus without-rig invocation rates, scored against the deterministic rubric from Phase 0. Document anecdotes: what nudged the agent to invoke FileScopeMCP? What got in the way? Did hooks (when wired up by the maintainer running the test) actually change behavior, or did the primer alone do the work?

**Bar:** in a with-rig session, the agent invokes FileScopeMCP unprompted in ≥ 3 of 5 reference scenarios *and* picks the right tool for the scenario in ≥ 2 of those 3. If the bar is missed, Phase 1 iterates or Phase 1.5 triggers; Phase 3 does not start.

**What Phase 2 can prove vs. what it can't:**

- *Provable here:* Whether the **primer + tool description rewrite** moves invocation reflexes. These are testable in any session, including future user sessions, because they ship as part of the install path.
- *Provable only by maintainers:* Whether **hooks** move behavior. Per the Layering Rules, hook configs are documentation/templates only — most users won't copy-paste them. So hook efficacy is measured exclusively by maintainer-driven runs where the hooks are wired up locally for the test. The product remains layered; the experiment uses a non-layered measurement rig.
- *Not provable here:* Long-tail real-world invocation drift. Phase 2 is a controlled experiment; ongoing user-session invocation rates would require telemetry that does not exist. See Success Criteria for how this gap is bounded.

This phase produces *evidence*, not a product. The evidence shapes Phase 3.

---

## Phase 3 — Productize the Claude Code Track

Productize what Phase 2 proved out. **Intentionally underspecified now.** The shape depends on what worked:

- If the primer alone moved the needle, the product is a tight project-init command around the primer template.
- If hooks were the thing, the product is hook templates + onboarding docs + helper-CLI ergonomics.
- If compound tools dominated, the product is more of them and the primitives get demoted in the SKILL guide.

In all branches, the layering rules from this document remain non-negotiable.

---

## Phase 4 — Hermes Track

**Prerequisite (must pass before Phase 4 begins):** verify Hermes auto-discovery actually injects `SKILL.md` content into Hermes's system prompt at runtime. The README documents the mechanism (`~/.hermes/skills/<category>/<name>/SKILL.md`); we have not end-to-end-verified that the current FileScopeMCP `SKILL.md` is actually picked up and surfaced to the agent. If auto-discovery doesn't inject the content, Track B's main lever does not exist and the phase has to be re-shaped (likely toward an explicit user-side skill-injection mechanism with appropriate documentation, still respecting layering rules).

Hermes has no harness-level hook layer. The lever is system-prompt priming. Once the prerequisite is verified, apply Phase 2's "trigger condition" insight to:

- A `SKILL.md` rewrite that uses the same imperative voice and trigger-condition framing.
- An `AGENTS.md` rewrite that surfaces the same priming concepts in the doc Hermes (and Codex) read.
- A skill auto-install verifier — not an auto-installer that writes config; a tool that checks whether the skill is in `~/.hermes/skills/` and tells the user how to fix it if not.

**Inter-track scheduling:** Track B does not block on Track A reaching final productized form. It blocks on Track A's *learnings* being stable — defined as "Phase 2 has produced its evidence and Phase 3 has chosen a productization shape." If Track A ends up iterating Phase 1 several times, Track B may begin in parallel from Phase 2 evidence alone rather than waiting for Phase 3 closure.

Track B does not blindly copy Track A; it applies Track A's *learnings* to a different mechanism. Same layering rules apply.

Codex / OpenClaw / Cursor: out of scope for this roadmap. They share the `AGENTS.md` lever with Hermes, so Phase 4's doc work benefits them indirectly. A first-class adapter for any of them is reconsidered after Phase 4 ships.

---

## Risks and Pivot Points

- **Phase 2 may show hooks don't help.** Then Phase 3 is primer-only and the helper CLI is descoped. Phase 1.5 (compound tools) may still trigger if the primer alone misses the bar. The roadmap survives.
- **Phase 1.5 compound tools may not get invoked.** Then they get cut without further iteration — atomic-commit revertibility makes the rollback clean. We do not ship dead tool surface to look productive.
- **Description rewrite may worsen invocation of a previously-working primitive.** Mitigations: (a) the noun-match preservation constraint in Phase 1, (b) one-tool-per-commit so any single rewrite can be reverted without rolling back the whole pass, (c) the Phase 0 baseline includes runs against the unrewritten primitives so we can detect regressions in the diff.
- **Hermes auto-discovery may not actually inject `SKILL.md` content.** Phase 4's prerequisite check exists for this. If it fails, Track B reshapes around an explicit user-side skill-injection path; we don't pretend the lever works when it doesn't.
- **Hermes constraints may invalidate Track A learnings even with auto-discovery working.** Then Track B reverts to the existing `SKILL.md` + `AGENTS.md` approach with sharper writing, and we accept the two tracks diverging.
- **Tool description rewrite may be the largest single lever.** If true, Phase 3 deprioritizes hooks and front-loads description quality across every tool — including the existing primitives.
- **The honest baseline may shift over time** as base agents change. The Phase 0 baseline file is date-stamped; re-running it periodically is part of long-term maintenance.

---

## Success Criteria (for the strategic bet, not just Phase 1)

- **Phase 2's invocation bar (≥3/5 unprompted, ≥2/3 right-tool) holds in re-run sessions over time** — at minimum a re-run one calendar month after Phase 3 ships, on the same protocol against the same fresh test repo. Drift below the bar in a re-run triggers a Phase 3 revisit, not silent acceptance.
- Layering rules upheld in every shipped artifact — no pull request that auto-writes to a user-owned config file gets merged.
- A single, opinionated Hermes install path that does not regress what already works.
- The roadmap pivots in response to Phase 2 evidence, rather than being defended against it.

**On telemetry:** the strategic-bet criterion above is intentionally bounded to the controlled re-run because real-world invocation telemetry does not exist today. Lightweight invocation logging (e.g., an opt-in `~/.filescope/invocation-log.jsonl` that records tool calls per session) is plausible future work and would let us measure drift in actual user sessions instead of just controlled re-runs. It is a future Phase, not a precondition for closing this roadmap.

---

## Backlog

The remainder of this file is the atomic backlog: completed work preserved as historical context, plus open bugs, architecture items, and features. The strategic roadmap above sets *direction*; the backlog tracks *items*. Items are grouped by category and roughly prioritized within each section.

### Completed (v1.0+)

Items below have been implemented and are listed here for historical context.

#### Bug Fixes

- **Concurrency: no mutex on tree mutations** — Added `AsyncMutex` serializing all watcher and sweep mutations.
- **`calculateImportance` non-idempotent** — Formula now always recalculates from base; canonical and idempotent.
- **`@modelcontextprotocol/sdk` hardcoded importance bonus** — Flattened to equal weight for all package imports.
- **`debounceMs` config field stored but never applied** — Field removed; effective debounce is 2 s constant + chokidar 300 ms stability threshold.
- **Dead `.blade.php`/`.phtml` code** — Removed unreachable patterns and unused `SUPPORTED_EXTENSIONS`.
- **Integrity sweep ignores `autoRebuildTree`** — Now respects the config flag.
- **Dead modules: `grouping-rules.ts` and `layout-engine.ts`** — Deleted.
- **Integrity sweep and watcher can double-save** — Serialized via mutex.
- **Watcher restart resets `restartAttempts` too eagerly** — Now requires 60 s stability before resetting backoff counter.
- **Importance propagation shallow (depth 1 only)** — `recalculateImportanceForAffected` now propagates transitively through dependents with visited-set cycle protection.
- **`normalizePath` consolidation** — Unified into `canonicalizePath` with cosmetic and resolution modes.

#### Architecture

- **Replace polling integrity sweep with mtime-based lazy validation** — One-time startup sweep replaces the 30 s polling loop. Per-file mtime checks on MCP tool access catch changes missed by the watcher. No more periodic full-tree scans.
- **SQLite storage** — Replaced JSON file persistence with SQLite + WAL mode. drizzle-orm typed schema. Auto-migration from legacy JSON trees.
- **Test coverage** — 880+ tests covering change detection, cascade engine, LLM pipeline, SQLite migration, MCP server integration, repository layer, coordinator lifecycle, cycle detection, streaming scan, `.filescopeignore`, symbol extraction, call-site edges, community detection, search tokenization, path-portability invariants, and InMemoryTransport integration.

#### Features

- **Summary auto-generation** — Full background LLM pipeline with multi-provider support (Anthropic, Ollama, OpenAI-compatible).
- **Cycle detection** — Iterative Tarjan's SCC algorithm detects all circular dependency groups. Exposed via `detect_cycles` and `get_cycles_for_file` MCP tools.
- **Community detection** — Louvain clustering on import graph groups tightly-coupled files. Exposed via `get_communities` MCP tool.
- **Go language support** — `import` statement parsing with `go.mod` module resolution. Tree-sitter symbol extraction.
- **Ruby language support** — `require` and `require_relative` parsing with `.rb` probing. Tree-sitter symbol extraction.
- **Python language support** — Tree-sitter AST for both dependency edges and symbol extraction.
- **Symbol extraction** — Tree-sitter-based extraction of functions, classes, interfaces, types, enums, consts, modules, and structs for TS/JS, Python, Go, and Ruby. Exposed via `find_symbol` MCP tool.
- **Call-site edges** — TS/JS call-expression resolution linking caller symbols to callee symbols with confidence scoring. Exposed via `find_callers` and `find_callees` MCP tools.
- **Changed-since tracking** — `list_changed_since` tool finds files modified after a timestamp or git SHA.
- **Metadata search** — `search` tool queries across symbols, purpose, summaries, and paths with ranked results.
- **Streaming directory scan** — `scanDirectory` converted to async generator using `fs.promises.opendir`. Eliminates full-tree memory buildup.
- **`.filescopeignore` support** — Gitignore-syntax exclusion file loaded at startup, applied alongside `config.json` exclude patterns.
- **Exclusion pattern persistence** — `exclude_and_remove` saves patterns to `config.json` (replaced legacy `FileScopeMCP-excludes.json`).
- **Daemon mode** — Standalone `--daemon` operation with PID guard, graceful shutdown, and file-only logging.
- **Coordinator config reload** — `init()` reloads `config.json` from disk each time, so runtime edits take effect without server restart.
- **Ghost record purge** — `purgeRecordsOutsideRoot()` cleans database records from wrong project paths.
- **Nexus dashboard** — Web UI at `localhost:1234` for visual codebase exploration across repos. File trees, dependency graphs, live broker activity, per-repo health.
- **Multi-repo watchers (systemd)** — `scripts/watchers.mjs` supervisor + `filescope-watchers.service` user unit; per-repo MCP server children with auto-restart and SIGTERM-clean shutdown. `nexus.sh install-watchers` / `uninstall-watchers` install/remove the unit symmetrically.

### Open Items

#### Bug Fixes & Correctness

##### `PackageDependency` false positives

`PackageDependency.fromPath()` in `types.ts` has a hardcoded fallback list (`react`, `axios`, `uuid`, `yup`, `express`, `firebase`, `date-fns`) used when a path doesn't contain `node_modules`. Any resolved path containing these strings gets misclassified.

**Fix:** Remove the hardcoded list and only classify packages whose path contains `node_modules/`, or require the import string to start with the bare package name.

---

#### Architecture

##### Eliminate `reconstructTreeFromDb` bridge

The coordinator reconstructs a `FileNode` tree from SQLite for tools that expect the legacy tree shape. This adds overhead and complexity. Refactoring tools to query SQLite directly would simplify the data path.

---

##### Separate in-memory model from persistence (further)

SQLite + WAL solved the partial-write corruption concern, but the coordinator still rebuilds the full `FileNode` tree for several operations. Working directly against the SQLite model would improve both clarity and memory usage on large projects.

---

#### Features

##### Git integration

Surface version-control context alongside dependency data:
- Mark files changed in the current working tree (unstaged/staged)
- Show last-commit date per file as a proxy for "recently active"
- Optional: weight importance by recency so stale files rank lower

Note: explicitly out of scope for the current milestone. Listed here for future consideration.

---

##### File watching: per-directory granularity

Currently file watching is a global toggle. Per-directory enable/disable would allow ignoring noisy directories while watching the rest.

---

##### Call-site edges for Python, Go, Ruby

TS/JS call-site edge extraction is complete. Extending `find_callers` / `find_callees` to Python, Go, and Ruby requires per-language call-expression AST walkers and resolution logic.

---

##### Performance: large codebase handling

- Benchmark and optimize for repos with 10k+ files

---

##### Richer language support

Some edge cases remain:
- **TypeScript/JavaScript:** dynamic `import()` with variable arguments
- **Python:** `importlib` dynamic imports
- **Rust:** complex `mod` path resolution in workspaces
