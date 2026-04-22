---
phase: 32-zero-config-auto-registration
plan: 04
subsystem: docs
tags: [docs, readme, mcp-clients, claude-code, cursor-ai, wsl, cross-host]

# Dependency graph
requires:
  - phase: 32-zero-config-auto-registration
    plan: 01
    provides: ".mcp.json committed at repo root (Contributor dogfood section references it verbatim)"
  - phase: 32-zero-config-auto-registration
    plan: 02
    provides: "`npm run register-mcp` wired via scripts/register-mcp.mjs (doc command is now the canonical entrypoint)"
  - phase: 32-zero-config-auto-registration
    plan: 03
    provides: "Legacy files deleted (install-mcp-claude.sh, mcp.json.linux|mac|win.txt|claude-code) and build.sh migrated to npm run register-mcp; interim 1-line doc patch applied"
provides:
  - "README Quick Start paragraph documenting `claude mcp add --scope user` mechanism with idempotency note and manual-setup fallback link to docs/mcp-clients.md"
  - "Fully rewritten docs/mcp-clients.md with four sections in D-18 order: Claude Code, Cursor AI, Cross-host (WSL -> Windows), Daemon Mode"
  - "Cross-host (WSL -> Windows) section preserving the WSL shim JSON previously held in the deleted mcp.json.linux template (D-15)"
  - "Contributor dogfood subsection documenting the .mcp.json relative-path pattern (D-01, D-03)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline OS-specific JSON snippets over external template files (D-11 single-source-of-truth for each client context)"
    - "Doc-section ordering reflects primary user journey (Claude Code end-users -> Cursor AI manual -> Cross-host manual -> Daemon Mode) per D-18"

key-files:
  created: []
  modified:
    - "README.md (+2 lines: one paragraph after the build.sh code fence in Quick Start)"
    - "docs/mcp-clients.md (+48 / -3 lines: full rewrite, 76 lines -> 120 lines)"

key-decisions:
  - "D-17 executed: README Quick Start gains one paragraph linking `./build.sh` behaviour to `claude mcp add --scope user` + `npm run register-mcp` + manual-setup fallback, without touching the existing code fence or 'That's it.' paragraph"
  - "D-18 executed: docs/mcp-clients.md rewritten top-to-bottom with sections in the exact specified order; Cursor AI subsections kept in prior WSL -> Windows Native -> macOS/Linux order for continuity"
  - "Cross-host (WSL -> Windows) JSON block reproduced verbatim as it appeared in mcp.json.linux (minus the {FILE_SCOPE_MCP_DIR} placeholder replaced with /home/yourname/FileScopeMCP example) -- preserves D-11 one-source-of-truth while making the snippet copy-pasteable"
  - "Cursor AI §WSL JSON block intentionally duplicates the Cross-host §WSL JSON block -- each context is self-contained per D-11, no de-duplication"

patterns-established:
  - "Doc rewrite via full-file Write with verbatim content from the plan's <interfaces> block -- avoids line-by-line Edit churn when the entire file changes"
  - "D-18 section ordering for FileScopeMCP client docs: primary/automated -> secondary/manual -> edge-case -> standalone"

requirements-completed:
  - ZERO-03

# Metrics
duration: 2min
completed: 2026-04-22
---

# Phase 32 Plan 04: README Quick Start + docs/mcp-clients.md Rewrite Summary

**Updated user-facing documentation so a developer following the setup from scratch reaches a working Claude Code installation with no manual JSON editing. README Quick Start gained one paragraph explaining the `claude mcp add --scope user` mechanism; docs/mcp-clients.md was rewritten with four sections in D-18 order (Claude Code, Cursor AI, Cross-host (WSL -> Windows), Daemon Mode) and all OS-specific JSON snippets inlined to replace the deleted template files.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-22T02:59:21Z
- **Completed:** 2026-04-22T03:01:03Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- README Quick Start now makes the registration mechanism explicit (`claude mcp add --scope user`, idempotent, re-runnable via `npm run register-mcp`) and provides a manual-setup fallback link — no reference to the deleted `install-mcp-claude.sh`.
- `docs/mcp-clients.md` fully rewritten (76 -> 120 lines) with the four-section structure mandated by D-18.
- Claude Code section now describes both flows: `npm run register-mcp` for end users (scope=user, idempotent, ENOENT fail-soft) and the committed `.mcp.json` contributor dogfood for anyone opening this repo in Claude Code.
- Cursor AI section retains the three OS subsections (WSL, Windows Native, macOS/Linux Native) with self-contained JSON blocks — no cross-references to deleted template files.
- New Cross-host (WSL → Windows) section documents the manual WSL shim pattern previously held only in the deleted `mcp.json.linux` template — content preserved verbatim per 32-PATTERNS.md.
- Daemon Mode section preserved verbatim from the pre-rewrite file (orthogonal to registration).
- Every deleted legacy filename (install-mcp-claude.sh, mcp.json.linux, mcp.json.mac, mcp.json.win.txt, mcp.json.claude-code) has zero references in README.md or docs/mcp-clients.md.
- Closed ZERO-03 ("documentation reflects new flow; no stale references to deleted artifacts").

## Task Commits

Each task committed atomically:

1. **Task 1: Update README Quick Start with registration note** — `97a9760` (docs)
2. **Task 2: Rewrite docs/mcp-clients.md with four sections in D-18 order** — `e09efa1` (docs)

## Files Created/Modified

- `README.md` (modified, +2 lines) — One new paragraph inserted after the Quick Start code fence (between existing lines 32 and 34) noting the registration mechanism, idempotency, fail-soft behavior, and manual-setup fallback link. No other README lines touched.
- `docs/mcp-clients.md` (modified, 76 -> 120 lines; +48 insertions, -3 deletions in git-stat) — Full rewrite. Four H2 sections in D-18 order; three Cursor OS subsections; new Contributor dogfood H3 subsection under Claude Code; new Cross-host (WSL -> Windows) H2 section with verbatim WSL shim JSON from the deleted mcp.json.linux template.

## Decisions Made

- **Followed D-17 and D-18 verbatim.** The plan's `<interfaces>` block specified the target content for both README (insertion paragraph) and docs/mcp-clients.md (full file body). Reproduced that content exactly, no paraphrasing.
- **Full-file Write for docs/mcp-clients.md, not incremental Edit.** The rewrite touched every section boundary — line-by-line Edit would have produced noisier diffs than a single Write. Structural shape changes (new H2 + new H3 + reordering) justify the full rewrite.
- **Cursor subsection order preserved from pre-rewrite file** (WSL → Windows Native → macOS/Linux Native). Plan's rules explicitly say "matches current file's order for the three existing ones," so no reordering.
- **Cross-host JSON block uses `/home/yourname/FileScopeMCP` placeholder path** matching the Cursor §WSL block. The deleted `mcp.json.linux` used `{FILE_SCOPE_MCP_DIR}` as a template placeholder; the published doc uses a human-readable example path because it's meant to be copy-edited, not sed-substituted.

## Deviations from Plan

None — plan executed exactly as written. Every success criterion matched on first verification run.

## Issues Encountered

None. Both tasks passed automated verification on first attempt.

## User Setup Required

None. Docs-only changes take effect immediately on checkout. Users reading README or docs/mcp-clients.md will see the updated flow.

## Known Stubs

None — no placeholder/mock data introduced. All JSON snippets are copy-pasteable with the noted replacements (`Ubuntu-24.04`, `/home/yourname/FileScopeMCP`, etc.).

## Verification Results

Plan-level `<verification>` block — all assertions satisfied:

| Check | Expected | Actual |
|-------|----------|--------|
| `README.md` contains `npm run register-mcp` | at least one match | 1 match |
| `README.md` contains `claude mcp add --scope user` | at least one match | 1 match |
| `README.md` does NOT reference `install-mcp-claude` | zero matches | 0 matches |
| `README.md` does NOT reference any `mcp.json.linux|mac|win.txt|claude-code` | zero matches | 0 matches |
| `docs/mcp-clients.md` does NOT reference `install-mcp-claude` | zero matches | 0 matches |
| `docs/mcp-clients.md` does NOT reference deleted templates | zero matches | 0 matches |
| `docs/mcp-clients.md` has 4 sections in D-18 order | Claude Code < Cursor AI < Cross-host < Daemon Mode | lines 3, 40, 93, 113 (strict ascending) |
| `docs/mcp-clients.md` has balanced code fences | even number | 16 fences (8 pairs) |
| `docs/mcp-clients.md` `## Claude Code` contains `npm run register-mcp` and `claude mcp add --scope user` | both present | both present |
| `docs/mcp-clients.md` `### Contributor dogfood` shows `.mcp.json` with relative path `dist/mcp-server.js` | present | present (line 22 inside the JSON block) |
| `docs/mcp-clients.md` Cursor AI has three OS subsections in order WSL, Windows Native, macOS / Linux Native | correct order | lines 42, 62, 78 |
| `docs/mcp-clients.md` Cross-host (WSL -> Windows) contains `"command": "wsl"` and references `run.sh` | both present | both present (lines 100, 110) |
| `docs/mcp-clients.md` Daemon Mode contains `--daemon` and `--base-dir=` | both present | both present (line 117) |
| `docs/mcp-clients.md` line count between 80 and 120 | 80-120 | 120 (upper bound inclusive) |
| `./build.sh          # installs deps, compiles, registers with Claude Code` still in README | one match | line 31 |
| README diff is one hunk around Quick Start | 1 hunk | 1 hunk, 2 insertions at lines 33-34 |

## Success Criteria Satisfied

1. **ZERO-03 satisfied:** A developer following README from scratch reaches a working install with no manual JSON editing (primary path via `./build.sh` → `npm run register-mcp`), with `docs/mcp-clients.md` providing manual fallbacks for Cursor AI, cross-host WSL→Windows, and daemon mode.
2. **D-17 satisfied:** README Quick Start notes the mechanism (`claude mcp add --scope user`, idempotent, re-runnable via `npm run register-mcp`) in a single paragraph.
3. **D-18 satisfied:** `docs/mcp-clients.md` rewritten with four sections in the specified order and inline Cursor JSON snippets (no external template files).
4. **D-11 satisfied:** Each client-context JSON block lives in exactly one place. The Cursor §WSL and Cross-host §WSL blocks are deliberately similar but each is self-contained for its context; no cross-section `@see` or `as above` references.
5. **All deleted-artifact references gone:** Zero matches for `install-mcp-claude` or any `mcp.json.(linux|mac|win.txt|claude-code)` filename across README.md and docs/mcp-clients.md.

## Next Phase Readiness

- Phase 32 is fully complete after this plan merges: all four requirements (ZERO-01 via Plan 01, ZERO-02 via Plan 02+03, ZERO-03 via Plan 04) are closed.
- `/gsd:transition` can proceed to review PROJECT.md Active requirements (should move "One-command agent registration (same-host)" to Validated).
- No open blockers, no deferred items, no follow-up TODOs.

## Threat Flags

None — plan was docs-only, introduced no new network endpoints, auth paths, file-access patterns, or trust-boundary surfaces. The `<threat_model>` block in the plan (T-32-15 through T-32-18) was fully mitigated: stale-reference grep passes, no absolute/contributor-specific paths in examples (only `/path/to/...` / `/home/yourname/...` / `C:\\FileScopeMCP\\...` placeholders), all JSON blocks sourced verbatim from pre-existing plan-captured content, balanced code fences.

## Self-Check: PASSED

Verified on completion:

- README.md exists and contains the new paragraph: FOUND at line 33
- docs/mcp-clients.md exists with 4 H2 sections in D-18 order: FOUND at lines 3, 40, 93, 113
- docs/mcp-clients.md has `### Contributor dogfood` subsection: FOUND at line 13
- docs/mcp-clients.md has Cursor `### WSL`, `### Windows Native`, `### macOS / Linux Native` in order: FOUND at lines 42, 62, 78
- Commit `97a9760` exists (Task 1): FOUND
- Commit `e09efa1` exists (Task 2): FOUND
- Zero references to `install-mcp-claude` in README.md or docs/mcp-clients.md: ok
- Zero references to `mcp.json.(linux|mac|win.txt|claude-code)` in README.md or docs/mcp-clients.md: ok
- Balanced code fences in docs/mcp-clients.md (16 = 8 pairs): ok
- docs/mcp-clients.md line count 120 (within 80-120 bound): ok

---
*Phase: 32-zero-config-auto-registration*
*Completed: 2026-04-22*
