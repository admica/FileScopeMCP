---
phase: 32-zero-config-auto-registration
plan: 03
subsystem: infra
tags: [build-script, registration, legacy-cleanup, bash, git-rm]

# Dependency graph
requires:
  - phase: 32-zero-config-auto-registration
    plan: 02
    provides: "npm run register-mcp wired into package.json + scripts/register-mcp.mjs (ENOENT fail-soft)"
provides:
  - "build.sh routing Claude Code registration through `npm run register-mcp` (legacy bash script and OS-specific template generation removed)"
  - "Repo root cleaned of 5 legacy registration/template artifacts"
  - "docs/mcp-clients.md and docs/troubleshooting.md point at the new `npm run register-mcp` command (interim — Plan 04 owns the full mcp-clients.md rewrite)"
affects:
  - 32-04-plan (docs/mcp-clients.md: full rewrite with Cross-host WSL section and Cursor AI inline snippets per D-18, plus README quick-start line per D-17)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Invoke Node-based orchestration scripts from bash via `npm run <script>` to stay cross-platform"
    - "Fail-soft registration: build never breaks when an optional external CLI (`claude`) is missing — the called script (Plan 02) exits 0 with a documented hint"
    - "`git rm` over `rm -f` for repo-tracked deletions so removals stage automatically in a single commit"

key-files:
  created: []
  modified:
    - "build.sh (5 edits: 3x MCP_TEMPLATE assignment removal, 1x template-generation block deletion, 1x registration-call swap + final-message update) — 156 lines → 136 lines"
    - "docs/mcp-clients.md (1-line patch: `./install-mcp-claude.sh` → `npm run register-mcp`)"
    - "docs/troubleshooting.md (1-line patch: `./install-mcp-claude.sh` → `npm run register-mcp`)"
  deleted:
    - "install-mcp-claude.sh (D-09)"
    - "mcp.json.linux (D-10)"
    - "mcp.json.mac (D-10)"
    - "mcp.json.win.txt (D-10)"
    - "mcp.json.claude-code (D-10)"

key-decisions:
  - "Rule 2 deviation — patched the two stale `install-mcp-claude.sh` references in docs/mcp-clients.md and docs/troubleshooting.md with `npm run register-mcp`. Without the patch, those docs would actively mislead users (pointing at a just-deleted script). Plan 04 still owns the full rewrite of docs/mcp-clients.md per D-18 — this was the minimal change to keep internal consistency during the transition."
  - "Preserved the `run.sh` generation block in build.sh (D-16) — Cursor AI WSL config still consumes run.sh; unrelated to Claude Code registration."
  - "Kept existing bash logging helpers (print_action/print_detail/print_warning) — no new helpers introduced; reuse keeps LOGFILE fan-out intact."

patterns-established:
  - "build.sh delegates registration to `npm run <script>` (Node orchestration for cross-platform logic)"

requirements-completed:
  - ZERO-02

# Metrics
duration: ~5min
completed: 2026-04-22
---

# Phase 32 Plan 03: build.sh Migration + Legacy Cleanup Summary

**Migrated `build.sh` off deleted legacy artifacts: swapped the `install-mcp-claude.sh` invocation for `npm run register-mcp` (Plan 02 output), removed the `mcp.json` template-generation block and all three `MCP_TEMPLATE=...` assignments, updated final-message hints, and deleted five legacy files (`install-mcp-claude.sh` + four `mcp.json.*` templates) via `git rm`.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-04-22T02:53:16Z
- **Completed:** 2026-04-22T02:56:09Z
- **Tasks:** 2
- **Files modified:** 3 (build.sh, docs/mcp-clients.md, docs/troubleshooting.md)
- **Files deleted:** 5

## Accomplishments

- `build.sh` now routes Claude Code registration through `npm run register-mcp`. Line count dropped 156 → 136 (-20 lines; plan's acceptance minimum was -17).
- Removed the `mcp.json` sed-from-template generation step and the three now-unused `MCP_TEMPLATE` assignments. No trace of the `{FILE_SCOPE_MCP_DIR}` placeholder pattern remains in `build.sh`.
- `run.sh` generation block preserved verbatim (D-16) — Cursor AI WSL users still depend on it.
- Five legacy files removed from repo root via `git rm` (single-commit staged deletions): `install-mcp-claude.sh`, `mcp.json.linux`, `mcp.json.mac`, `mcp.json.win.txt`, `mcp.json.claude-code`.
- `.mcp.json` (Plan 01 dogfood config) remains tracked and present — not collateral damage.
- Final-message hints updated: Cursor AI line now points at `docs/mcp-clients.md`, Claude Code line advertises `npm run register-mcp` as the re-run command.

## Task Commits

1. **Task 1 — build.sh edits:** `d15d70f` (refactor) — 6 insertions, 26 deletions
2. **Task 2 — legacy file deletions + doc patches:** `afae9e4` (chore) — 2 insertions, 127 deletions across 7 files

## Files Created/Modified

- `build.sh` (modified, 156 → 136 lines) — Five edits applied verbatim per the plan's interfaces block. No lines outside the targeted blocks were touched.
- `docs/mcp-clients.md` (modified, 1-line patch) — Swapped `./install-mcp-claude.sh` reference for `npm run register-mcp`. Section structure otherwise untouched — Plan 04 owns the full rewrite per D-18.
- `docs/troubleshooting.md` (modified, 1-line patch) — Swapped `./install-mcp-claude.sh` reference for `npm run register-mcp`.

## Files Deleted

- `install-mcp-claude.sh` (89 lines) — legacy bash registration script that mutated `~/.claude.json` directly. Replaced by `scripts/register-mcp.mjs` in Plan 02.
- `mcp.json.linux` (12 lines) — WSL shim template. Content to be consolidated into `docs/mcp-clients.md` Cross-host section in Plan 04.
- `mcp.json.mac` — macOS template (unused).
- `mcp.json.win.txt` — Windows native template (unused).
- `mcp.json.claude-code` — generic Claude Code template. Content equivalent already lives in Plan 01's `.mcp.json` (minus the `{FILE_SCOPE_MCP_DIR}` placeholder).

## Decisions Made

- **Cross-platform delegation to npm:** `build.sh` still the single entry point (D-13), but registration logic lives in Node per D-05 (cross-platform, no bash-on-Windows assumption). `build.sh` contains only one new token — `npm run register-mcp` — and delegates everything else.
- **Scope minimum doc patch:** Plan 04 owns the full `docs/mcp-clients.md` rewrite per D-18, but leaving two stale `install-mcp-claude.sh` references live would have actively misled users. Applied the smallest possible patch (two single-line swaps) to preserve internal consistency without encroaching on Plan 04's rewrite scope.
- **Explicit `git rm` over `rm`:** Every deletion staged via `git rm` so Task 2 lands as a single clean commit with no manual `git add` step needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Critical Consistency] Patched two stale `install-mcp-claude.sh` references in `docs/`**
- **Found during:** Task 2 (final verification of `grep -Rl 'install-mcp-claude' build.sh README.md docs/ scripts/ src/ package.json`)
- **Issue:** The plan's Task 2 acceptance criterion requires that non-planning grep find no references. Two pre-existing references remained:
  - `docs/mcp-clients.md:8` — `./install-mcp-claude.sh`
  - `docs/troubleshooting.md:10` — `./install-mcp-claude.sh`
  After the `git rm install-mcp-claude.sh` in Task 2, these references would point at a file that no longer exists — actively misleading users following troubleshooting steps.
- **Fix:** One-line patches in both files, swapping `./install-mcp-claude.sh` → `npm run register-mcp` (the replacement registration command wired in Plan 02). Total change: +2 lines, -2 lines across the two files.
- **Scope discipline:** Did NOT rewrite either file's structure or any other content. Plan 04 (per D-18) still owns:
  - Full rewrite of `docs/mcp-clients.md` Claude Code section
  - New Cross-host (WSL → Windows) section sourced from `mcp.json.linux` (preserved verbatim in 32-PATTERNS.md before deletion)
  - Cursor AI inline snippet extensions
  - README Quick Start line addition (D-17)
- **Files modified:** `docs/mcp-clients.md`, `docs/troubleshooting.md`
- **Verification:** `grep -Rl 'install-mcp-claude' build.sh README.md docs/ scripts/ src/ package.json` now returns no results. `grep -n 'npm run register-mcp' docs/` shows the two new references at the same line positions.
- **Committed in:** `afae9e4` (bundled with Task 2 since the patches and the deletions are logically one unit — without the patches, the deletions would leave broken references).

---

**Total deviations:** 1 Rule 2 auto-fix
**Impact on plan:** Purely defensive — preserves internal repo consistency during the transition window between Plans 03 and 04. Does not encroach on Plan 04's full-rewrite scope (structure, new sections, Cross-host docs, README line all still Plan 04's responsibility).

## Issues Encountered

- None blocking. The `grep -n 'npm run register-mcp' build.sh` acceptance criterion read "exactly one match" but the plan's interfaces block explicitly specified three occurrences (the invocation plus two user-facing messages). The interfaces block is the authoritative spec (it has the verbatim before/after content); the three-occurrence outcome matches the spec. The plan's `<verify><automated>` check uses `grep -qE` (presence-only) which passed cleanly.

## User Setup Required

None — no external service changes. End users running `./build.sh` on a clean clone will:
1. Install deps (`npm install`)
2. Build TypeScript (`npm run build`)
3. Generate `run.sh` (Cursor AI WSL consumers)
4. Register with Claude Code via `npm run register-mcp` — fail-soft if `claude` CLI missing (Plan 02's ENOENT handler)

## Known Stubs

None — no placeholder content, mock data, or hardcoded empty values introduced.

## TDD Gate Compliance

N/A — plan frontmatter declares `type: execute` (not `type: tdd`). Both tasks are mechanical file edits and deletions; no feature-behavior test needed for the diff itself. The functional correctness of `npm run register-mcp` is already locked by Plan 02's integration test (`tests/integration/register-mcp.test.ts`), which passes unchanged.

## Next Phase Readiness

- Plan 04 can now proceed: `docs/mcp-clients.md` is in its interim state (stale-reference-free but structurally unchanged from pre-Plan-03); the full rewrite per D-18 will replace the Claude Code section, extend Cursor AI, add Cross-host (WSL), and Daemon Mode. The Cross-host section source content is captured verbatim in `32-PATTERNS.md` §`docs/mcp-clients.md` before the `mcp.json.linux` deletion.
- `README.md` Quick Start line per D-17 remains Plan 04's deliverable.
- `.mcp.json` (Plan 01) and `scripts/register-mcp.mjs` (Plan 02) remain in place; build.sh → npm wiring verified working.
- No pre-existing references to deleted files remain outside `.planning/` (historical SUMMARYs are allowed per plan acceptance criteria).

## Self-Check: PASSED

Verified on completion:
- build.sh exists and passes `bash -n`: ok
- `grep -cE 'npm run register-mcp' build.sh` = 3 (invocation + error hint + final-message hint, all specified in plan interfaces): ok
- `grep -cE 'install-mcp-claude' build.sh` = 0: ok
- `grep -cE 'MCP_TEMPLATE' build.sh` = 0: ok
- `grep -cE 'FILE_SCOPE_MCP_DIR' build.sh` = 0: ok
- `grep -cE 'chmod \+x run\.sh' build.sh` = 1 (D-16 preserved): ok
- install-mcp-claude.sh absent on disk: ok
- mcp.json.linux absent on disk: ok
- mcp.json.mac absent on disk: ok
- mcp.json.win.txt absent on disk: ok
- mcp.json.claude-code absent on disk: ok
- .mcp.json present on disk AND tracked in git: ok
- `grep -Rl 'install-mcp-claude' build.sh README.md docs/ scripts/ src/ package.json` returns nothing: ok
- Commit `d15d70f` exists in git log: FOUND
- Commit `afae9e4` exists in git log: FOUND
- Line count of build.sh dropped from 156 to 136 (-20, acceptance minimum was -17): ok

---
*Phase: 32-zero-config-auto-registration*
*Completed: 2026-04-22*
