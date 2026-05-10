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

- **Track A — Claude Code:** a primary daily driver. Build an *experimental rig* (compound tools, tool-description rewrites, project priming, hook templates) and run real sessions to measure whether agent reflexes actually change. Productize what works.
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

**Deliverable:** `docs/invocation-baseline.md` — five reference scenarios, the pre-rig invocation behavior in each, the criteria by which "the rig helped" will be judged, and a date stamp so future re-runs can show drift over time as base agents evolve.

---

## Phase 1 — Claude Code Experimental Rig

**Goal:** make it a no-brainer for Claude Code to invoke FileScopeMCP in scenarios where it would otherwise default to Bash/Read/Grep. Build the rig in this repo so any project can opt in. The rig is not a product; it is an experiment whose contents may change after Phase 2.

### Scope (direction, not implementation)

- **Project priming.** A short, imperative `CLAUDE.md` primer — trigger conditions ("call X before Y"), not capability descriptions. Installable into target projects with the marker convention from the layering rules. Lives in this repo as a template; gets generated into the user's project as a marked block.

- **Tool descriptions rewritten as triggers.** Every tool's `description` field in `mcp-server.ts` gets a "**When to call:**" prefix and a concrete trigger condition. Counterweights ("skip if …") where appropriate. Done in our repo; no user-side changes.

- **Two compound, ready-to-act MCP tools.** Their job is to *beat `Read` on cost* — to return enough context in one call that an agent under context pressure prefers them to chained primitives.
  - `session_digest(since?)` — sub-1 KB project orientation: top files, recent changes, broker state, hints.
  - `prepare_edit(filepath)` — pre-edit briefing: summary + dependents (with import lines) + exports + callers + cycle membership + community siblings, in one call.
  - These do not replace primitives; they sit alongside them. They earn their place by being invoked, or they get cut in Phase 3.

- **Hook templates as documentation, not auto-install.** `docs/claude-code-hooks.md` ships canonical hook snippets (PreToolUse on Read/Edit/Write, SessionStart) and a small `filescope-helper` CLI so the snippets are copy-paste-ready. The installer prints the doc URL and the snippet; users paste into their own `.claude/settings.json` if they want them. **No auto-write — see Layering Rules.**

- **Install command.** `filescope install --claude-code` detects Claude Code, runs `claude mcp add` (idempotent, public API), opt-in `CLAUDE.md` primer with markers, prints hook snippets and the doc URL, verifies with `claude mcp list`. Output: per-step ✓/✗ table.

### What we are explicitly not deciding yet

- Exact tool signatures and payload shape (will be designed in `.planning/phase-1/PLAN.md` when Phase 1 starts).
- Whether the helper CLI talks to a long-running daemon or spawns short-lived MCP servers.
- Whether hooks should fire on every Read or only the first Read of a file per session.
- Whether `prepare_edit` includes test-file heuristics in v1.
- Whether the install command itself ships as `filescope install ...` or as a flag on the existing `./build.sh` / `register-mcp.mjs` path.

### Phase 1 success criteria (how Phase 2 will judge this rig)

- Compound tools exist, are tested, and return target payloads under their size targets.
- Tool description rewrite is complete and reviewed.
- Hook templates and helper CLI exist and are documented; layering rules are honored.
- Installer detects Claude Code, registers MCP, and produces a clear ✓/✗ table — *without* writing to any user-owned hook config.
- Rig is opt-in end-to-end. A user who installs FileScopeMCP without the new install command sees no behavior change.

---

## Phase 2 — Run, Observe, Measure

Real Claude Code sessions on real codebases — this repo plus a fresh test repo where Claude has not been primed by prior sessions — across the five reference scenarios from Phase 0. With-rig versus without-rig invocation rates. Document anecdotes: what nudged the agent to invoke FileScopeMCP? What got in the way? Were the compound tools used? Did hooks (when wired up by the user) actually change behavior, or did the primer alone do the work?

**Bar:** in a with-rig session, the agent invokes FileScopeMCP unprompted in ≥ 3 of 5 reference scenarios. If the bar is missed, Phase 1 iterates rather than Phase 3 starting.

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

Hermes has no harness-level hook layer. The lever is system-prompt priming. Apply Phase 2's "trigger condition" insight to:

- A `SKILL.md` rewrite that uses the same imperative voice and trigger-condition framing.
- An `AGENTS.md` rewrite that surfaces the same priming concepts in the doc Hermes (and Codex) read.
- A skill auto-install verifier — not an auto-installer that writes config; a tool that checks whether the skill is in `~/.hermes/skills/` and tells the user how to fix it if not.

Track B does not blindly copy Track A; it applies Track A's *learnings* to a different mechanism. Same layering rules apply.

Codex / OpenClaw / Cursor: out of scope for this roadmap. They share the `AGENTS.md` lever with Hermes, so Phase 4's doc work benefits them indirectly. A first-class adapter for any of them is reconsidered after Phase 4 ships.

---

## Risks and Pivot Points

- **Phase 2 may show hooks don't help.** Then Phase 3 is primer-only and the helper CLI is descoped. Compound tools are kept if they were used; cut if not. The roadmap survives.
- **Compound tools may not get invoked.** Then they get cut in Phase 3 or merged back into existing primitives. We do not ship dead tool surface to look productive.
- **Hermes constraints may invalidate Track A learnings.** Then Track B reverts to the existing `SKILL.md` + `AGENTS.md` approach with sharper writing, and we accept the two tracks diverging.
- **Tool description rewrite may be the largest single lever.** If true, Phase 3 deprioritizes hooks and front-loads description quality across every tool — including the existing primitives.
- **The honest baseline may shift over time** as base agents change. The Phase 0 baseline file is date-stamped; re-running it periodically is part of long-term maintenance.

---

## Success Criteria (for the strategic bet, not just Phase 1)

- A measurable increase in unprompted FileScopeMCP invocation in Claude Code sessions, attributable to the rig and not to the user prompting it.
- Layering rules upheld in every shipped artifact — no pull request that auto-writes to a user-owned config file gets merged.
- A single, opinionated Hermes install path that does not regress what already works.
- The roadmap pivots in response to Phase 2 evidence, rather than being defended against it.

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
