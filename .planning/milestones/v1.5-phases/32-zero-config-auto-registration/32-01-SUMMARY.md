---
phase: 32-zero-config-auto-registration
plan: 01
subsystem: infra
tags: [mcp, claude-code, dogfood, zero-config, gitignore]

# Dependency graph
requires:
  - phase: quick-task-260323-kgd
    provides: auto-init MCP to CWD (eliminates need for --base-dir in dogfood config)
provides:
  - committed .mcp.json at repo root enabling Claude Code auto-discovery when contributors open the FileScopeMCP repo
  - verified .gitignore matches D-12 (legacy mcp.json ignored, new .mcp.json tracked)
affects:
  - 32-02-register-mcp-script
  - 32-03-build-sh-docs
  - 32-04-legacy-cleanup

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Relative-path dogfood MCP config (portable across clones, no absolute paths, no --base-dir)"

key-files:
  created:
    - .mcp.json
  modified: []

key-decisions:
  - "D-01: Relative path `dist/mcp-server.js` — Claude Code runs MCP servers with repo root as CWD, so portable across clones"
  - "D-02: Single committed dogfood config (no .mcp.json.example) — one source of truth"
  - "D-03: No `--base-dir` flag — FS auto-initializes to CWD per quick task 260323-kgd"
  - "D-12: No new .gitignore entry for .mcp.json — existing `mcp.json` pattern (no leading dot) does not match leading-dot filename"
  - "Schema minimal — no Cursor-only fields (transport, disabled, alwaysAllow) which Claude Code does not recognize"

patterns-established:
  - "Dogfood MCP config pattern: relative path in args, no flags, minimal schema (Claude Code only)"
  - "Read-only verification tasks for config-invariant work (Task 2 — no edit, just git check-ignore assertions)"

requirements-completed:
  - ZERO-01

# Metrics
duration: 103min
completed: 2026-04-22
---

# Phase 32 Plan 01: `.mcp.json` Dogfood Config Summary

**Committed `.mcp.json` at repo root with relative path `dist/mcp-server.js` — Claude Code now auto-discovers the FileScopeMCP server when contributors open this repo, zero manual config.**

## Performance

- **Duration:** ~103 min (wall clock — most elapsed time was idle/interrupt between initial commit and resume)
- **Started:** 2026-04-22T01:05:42Z
- **Completed:** 2026-04-22T02:48:26Z
- **Tasks:** 2 completed
- **Files modified:** 1 created (`.mcp.json`); 0 edited (`.gitignore` verified read-only)

## Accomplishments

- Created `.mcp.json` at repo root (8 lines, relative path, no Cursor-only fields, no `--base-dir`) — Claude Code auto-discovery now works on any clone of the FileScopeMCP repo without running `npm run register-mcp` first.
- Verified `.gitignore` already satisfies D-12 without modification — line 6 entry `mcp.json` correctly ignores the legacy generated file while leaving the new `.mcp.json` (leading-dot filename) tracked.
- Closed ZERO-01 — "Committed `.mcp.json` at repo root".

## Task Commits

Each task was committed atomically:

1. **Task 1: Create `.mcp.json` at repo root** — `73ae9ae` (feat)
2. **Task 2: Verify `.gitignore` matches D-12 expectations** — no commit (read-only verification, file already correct)

**Plan metadata:** added as separate final commit (see below).

## Files Created/Modified

- `.mcp.json` — NEW — Claude Code MCP config pointing at `dist/mcp-server.js` via relative path. Triggers auto-discovery when contributors open the FileScopeMCP repo in Claude Code.
- `.gitignore` — VERIFIED (no edit) — line 6 `mcp.json` entry left untouched; `.mcp.json` not added to ignore list per D-12.

## Decisions Made

- **Followed plan exactly.** D-01, D-02, D-03, D-12 all honored verbatim. No additional decisions required.
- **No `.gitignore` edit.** Plan Task 2 explicitly instructed "do NOT edit the file unless verification fails" — verification passed on first try.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None. Both tasks verified on first run:
- Task 1 automated verify (`node -e` JSON assertions) printed `ok`.
- Task 2 all five verification checks passed: `mcp.json` line present, no `.mcp.json` line, no matching glob, `git check-ignore .mcp.json` → exit 1, `git check-ignore mcp.json` → exit 0.

## User Setup Required

None — no external service configuration required. The committed `.mcp.json` takes effect the next time a contributor opens the FileScopeMCP repo in Claude Code (or restarts their existing session).

## Verification Results

All plan-level `<verification>` assertions satisfied:

| Check | Expected | Actual |
|-------|----------|--------|
| `.mcp.json` exists at repo root, 8 lines | 8 lines, valid JSON | 8 lines, valid JSON |
| Relative path, no Cursor fields, no `--base-dir` | `args=["dist/mcp-server.js"]` only | `args=["dist/mcp-server.js"]` only |
| `.gitignore` still contains `mcp.json` | present on a line | line 6 |
| `.mcp.json` tracked by git | `git ls-files .mcp.json` non-empty | tracked (via commit `73ae9ae`) |
| `git check-ignore -q .mcp.json` | exit 1 | exit 1 |
| `git check-ignore -q mcp.json` | exit 0 | exit 0 |

## Next Phase Readiness

- ZERO-01 closed. Plan 32-02 (`claude mcp add` registration script) already executed in parallel (commits `b09ea47`, `72bdf60`, `4aeb896`, merged at `345e30e`) — no coordination conflict since Plans 32-01 and 32-02 touch disjoint files.
- Plan 32-03 (build.sh + README + docs/mcp-clients.md rewrite) can proceed: references to `.mcp.json` in docs are now accurate because the file exists.
- Plan 32-04 (legacy cleanup: delete `install-mcp-claude.sh`, `mcp.json.*` templates, `mcp.json` generation step) can proceed safely — `.mcp.json` being present means there is no functional gap left by deleting the templates.

## Self-Check: PASSED

- FOUND: `.mcp.json` at repo root
- FOUND: `.planning/phases/32-zero-config-auto-registration/32-01-SUMMARY.md`
- FOUND: commit `73ae9ae` (Task 1)

All claimed artifacts exist on disk and in git history.

---
*Phase: 32-zero-config-auto-registration*
*Completed: 2026-04-22*
