# Phase 32: Zero-Config Auto-Registration - Context

**Gathered:** 2026-04-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the broken `install-mcp-claude.sh` (which directly mutates `~/.claude.json` via temp Node script) with a clean, supported registration flow for Claude Code. Deliver two paths:

1. Committed `.mcp.json` at repo root — Claude Code auto-discovers FileScopeMCP when a developer opens the FileScopeMCP repo itself (contributor ergonomics / dogfooding).
2. `npm run register-mcp` script that invokes `claude mcp add --scope user` — registers FileScopeMCP globally so any Claude Code session on the same host can use it, no per-project setup.

Update setup docs (README quick-start, `docs/mcp-clients.md`) to reflect the new flow. Delete legacy registration artifacts.

**Not in scope:**
- Cross-host registration (WSL FileScopeMCP → Windows-host Claude Code) — documented as manual config.
- Cursor AI / Windows-native registration automation — those clients don't have a `claude mcp add` equivalent; JSON snippets stay in docs.
- LLM backend setup automation — already excluded in PROJECT.md Out of Scope.

</domain>

<decisions>
## Implementation Decisions

### Requirement Refactor (agreed with user)

- **D-00:** ZERO-02 reworded from "Auto-registration script ... replaces broken install-mcp-claude.sh" → **"One-command registration via `claude mcp add` CLI on same host; cross-host (WSL→Windows) is documented as manual config"**. The original "zero-config" framing overpromised — user still runs `git clone` + `./build.sh`. Phase delivers one-command install, not zero-config. PROJECT.md Active line updated to match.

### `.mcp.json` at Repo Root (ZERO-01)

- **D-01:** Commit `.mcp.json` at project root pointing at this repo's own `dist/mcp-server.js` via **relative path**. Claude Code runs MCP servers with repo root as CWD, so `{"command": "node", "args": ["dist/mcp-server.js"]}` works without absolute paths and stays portable across clones.
- **D-02:** Purpose is **dogfooding only** — auto-discovery when a contributor opens the FileScopeMCP repo in Claude Code. NOT a template for end-users. End-users register via `npm run register-mcp` instead. Do not ship a `.mcp.json.example` — pure duplication.
- **D-03:** `.mcp.json` must not include `--base-dir` override. FS auto-initializes to CWD (per the `260323-kgd` quick task) — dogfooding points FS at itself.

### `claude mcp add` Registration Script (ZERO-02)

- **D-04:** `npm run register-mcp` → invokes `claude mcp add --scope user FileScopeMCP <node-path> <absolute-path-to-dist/mcp-server.js>`. User scope = one-time install, works across all projects. Avoids per-project friction of `--scope local` and the invasiveness of `--scope project` (would litter `.mcp.json` into user repos).
- **D-05:** Script written as a small Node.js file (`scripts/register-mcp.mjs`) referenced from `package.json` scripts, not a bash script. Reason: cross-platform (macOS/Linux/Windows), no bash-on-Windows assumption, consistent with the Node-based codebase. Uses `child_process.spawnSync('claude', ['mcp', 'add', ...])`.
- **D-06:** Script fail-soft when `claude` CLI is not in PATH — print clear hint ("Claude Code CLI not found; install from https://claude.ai/code or add `claude` to PATH, then re-run") and exit 0. Do NOT fail the build.
- **D-07:** Script is idempotent — re-running updates the entry rather than duplicating. `claude mcp add` handles this natively; verify via `claude mcp list` in the script's post-check step.
- **D-08:** Script uses `process.execPath` (the current Node binary) as the `command` argument. Resolves the "which node" problem on systems with multiple Node installs (nvm, volta, system node).

### Legacy Cleanup (C3)

- **D-09:** Delete `install-mcp-claude.sh` outright — no backward compat, no legacy installs (per PROJECT.md + user rules).
- **D-10:** Delete root-level OS JSON templates: `mcp.json.linux`, `mcp.json.mac`, `mcp.json.win.txt`, `mcp.json.claude-code`, and generated `mcp.json`. Also drop the `mcp.json` generation step from `build.sh`.
- **D-11:** Consolidate Cursor AI and Windows-native JSON snippets into `docs/mcp-clients.md` as inline code blocks — the doc already has a "Cursor AI" section; extend it. One source of truth.
- **D-12:** Add `.mcp.json` to the FileScopeMCP repo's own `.gitignore` entries? **NO** — it's the committed dogfood config. But add the auto-generated legacy `mcp.json` to `.gitignore` during this phase if not already there, to prevent resurrection.

### `build.sh` Integration + WSL (D1)

- **D-13:** `build.sh` still auto-registers at the end: after `npm install` + `npm run build`, calls `npm run register-mcp`. Preserves the README quick-start promise (`./build.sh` → done). Remove the old `bash install-mcp-claude.sh` invocation entirely.
- **D-14:** `build.sh` removes the `mcp.json` template copy step (lines generating `mcp.json` from `mcp.json.linux` / `mcp.json.mac` via sed). Templates are gone.
- **D-15:** WSL→Windows-Claude-Code case (FS running in WSL, Claude Code running on Windows host) is **out of scope for automation**. `docs/mcp-clients.md` gets a new "Cross-host (WSL)" section documenting the manual `wsl -d <distro>` shim — contents pulled from the existing `mcp.json.linux` template before deletion.
- **D-16:** `run.sh` is still generated by `build.sh` (used by Cursor AI WSL config per existing docs). Keep that generation step — orthogonal to Claude Code registration.

### Documentation (ZERO-03)

- **D-17:** README Quick Start unchanged in spirit (`./build.sh` → done), but add a line noting "`./build.sh` registers FileScopeMCP with Claude Code via `claude mcp add --scope user` — idempotent, re-runnable." Remove any mention of `install-mcp-claude.sh`.
- **D-18:** `docs/mcp-clients.md` fully rewritten: Claude Code section describes `npm run register-mcp` + `.mcp.json` dogfood behavior, Cursor AI section gets the inline OS-specific JSON snippets (was in separate template files), new "Cross-host (WSL)" section for manual WSL→Windows setup.
- **D-19:** Do NOT modify `setup-llm.sh` or LLM setup docs — LLM backend is explicitly out of scope per PROJECT.md.

### Testing

- **D-20:** Add a minimal integration test `tests/integration/register-mcp.test.ts` — spawns `node scripts/register-mcp.mjs` in a fake environment (missing `claude` CLI path), asserts it exits 0 with the documented hint. This is the only test needed — the real `claude mcp add` call requires actual Claude Code CLI installed and is E2E territory.
- **D-21:** No tests for `.mcp.json` itself — it's a static JSON file with a schema Claude Code parses. Lint via `npm run typecheck` (if schema applies) or just commit.

### Claude's Discretion

- Exact wording of script hints and error messages (LLM-consumable style per D-08 in Phase 30)
- README line placement/phrasing for the new registration note
- Whether `scripts/register-mcp.mjs` uses a dedicated logger or plain `console.log` (small script — plain `console` is fine)
- Order in which `docs/mcp-clients.md` presents clients (suggest: Claude Code first since it's the primary target)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Current Registration Flow (to be replaced)
- `install-mcp-claude.sh` — The broken script being replaced. Contains the Node temp-script pattern writing to `~/.claude.json`.
- `build.sh` §"Register with Claude Code" — lines ~140-150 invoke `install-mcp-claude.sh`. Also see §"Generate MCP configuration" (lines ~115-125) for the `mcp.json` template step being removed.

### MCP Templates (to be consolidated into docs)
- `mcp.json.linux` — WSL wrapper: `{ "command": "wsl", "args": ["-d", "Ubuntu-24.04", "...run.sh"] }` — content moves to docs/mcp-clients.md Cross-host section.
- `mcp.json.mac`, `mcp.json.win.txt`, `mcp.json.claude-code` — delete after content consolidation.

### Claude Code CLI Reference
- `claude mcp add --help` — CLI reference for registration scopes (`user`, `local`, `project`). Verify scope semantics before implementation.
- `claude mcp list` — post-check mechanism for D-07.

### Touch Points
- `package.json` — add `register-mcp` script entry.
- `README.md` §Quick Start (lines ~26-40) — update registration phrasing, remove install-mcp-claude reference.
- `docs/mcp-clients.md` — rewrite Claude Code section, extend Cursor AI with inline JSON, add Cross-host (WSL) section.
- `.gitignore` — verify generated legacy `mcp.json` stays ignored.

### Requirements + Prior Context
- `.planning/REQUIREMENTS.md` §Zero-Config Agent Registration — ZERO-01, ZERO-02, ZERO-03. **Note: ZERO-02 wording refactored per D-00.**
- `.planning/PROJECT.md` §Out of Scope — "One-script LLM backend setup" clause explicitly excludes LLM automation; §Active requirements — "Zero-config agent integration" line updated per D-00.
- `.planning/phases/29-broker-lifecycle-hardening/29-CONTEXT.md` — broker spawn timing decisions (Phase 32 doesn't modify broker registration).
- `.planning/phases/30-mcp-spec-compliance/30-CONTEXT.md` — `registerTool()` API, structured errors (unchanged by Phase 32).
- `.planning/phases/31-test-infrastructure/31-CONTEXT.md` — test file conventions and vitest patterns for D-20.

### Auto-init Behavior (informs D-03)
- `.planning/STATE.md` Quick Tasks §`260323-kgd` — auto-init MCP to CWD, `set_base_directory` rename. FS initializes to CWD automatically when Claude Code starts it; no `--base-dir` flag needed for dogfood config.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `build.sh` color/logging helpers (print_header, print_action, print_detail, print_error) — reuse if any bash remains. Script continues calling `npm run register-mcp` so no new bash needed.
- `package.json` scripts pattern — add `register-mcp` alongside existing `build`, `test`, `coverage`.
- Existing `.gitignore` entries — verify generated `mcp.json` pattern is covered after template deletion.

### Established Patterns
- ESM throughout (`"type": "module"` in package.json) — `scripts/register-mcp.mjs` uses ESM imports.
- Node 22 runtime — can use modern APIs (`node:child_process` spawnSync, top-level await if needed).
- No bash scripting for new work — cross-platform means Node script for logic, bash only for orchestration (build.sh already exists).

### Integration Points
- `build.sh` — one-line edit: replace `bash "${PROJECT_ROOT}/install-mcp-claude.sh"` with `npm run register-mcp`. Also remove the `mcp.json` template generation block.
- `package.json` scripts — add `"register-mcp": "node scripts/register-mcp.mjs"`.
- README — swap out `install-mcp-claude.sh` reference (none currently — README calls it implicitly via build.sh).
- `docs/mcp-clients.md` — full section rewrite for Claude Code; extend Cursor AI; add Cross-host section.

### Deletion Targets
- `install-mcp-claude.sh` (91 lines)
- `mcp.json.linux`, `mcp.json.mac`, `mcp.json.win.txt`, `mcp.json.claude-code` (4 files, ~50 lines total)
- Generated `mcp.json` (produced by build.sh sed step — step itself removed)

</code_context>

<specifics>
## Specific Ideas

- User confirmed the "zero-config" framing in the original requirements overpromises — user preference is truthful scope over aspirational language. Refactored requirement wording locked into D-00.
- One-command install (not zero-config) is the deliverable. `./build.sh` remains the single entry point for contributors.
- Registration script must fail-soft when `claude` CLI missing (don't break `./build.sh` for people who just want to use FS as a standalone daemon).
- Cross-platform = Node-based script, not bash. Matches the rest of the codebase.

</specifics>

<deferred>
## Deferred Ideas

- **WSL→Windows-Claude-Code auto-detection** — detecting WSL distro name + generating the `wsl -d <distro>` shim automatically. Feasible but fragile (distro names vary, default distro inconsistent, node-in-WSL vs node-on-Windows path confusion). Not worth automation complexity for a cross-host edge case. Documented as manual setup only.
- **Cursor AI registration automation** — Cursor doesn't have a `claude mcp add` equivalent; manual JSON editing is the only path. Out of Phase 32 scope.
- **Self-registration on FS startup** — FS could detect "running under Claude Code for the first time" and auto-register itself. High complexity, brittle. Not worth pursuing.

</deferred>

---

*Phase: 32-zero-config-auto-registration*
*Context gathered: 2026-04-21*
