---
phase: 32-zero-config-auto-registration
fixed_at: 2026-04-22T04:44:21Z
review_path: .planning/phases/32-zero-config-auto-registration/32-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 32: Code Review Fix Report

**Fixed at:** 2026-04-22T04:44:21Z
**Source review:** `.planning/phases/32-zero-config-auto-registration/32-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (critical + warning)
- Fixed: 3
- Skipped: 0

All three warnings from the review were fixable with small, well-scoped edits. No critical findings existed. Info-level findings (IN-01 through IN-07) were out of scope for this pass.

## Fixed Issues

### WR-01: `run.sh` generator emits malformed script (pre-existing bug, still live after migration)

**Files modified:** `build.sh`
**Commit:** `4125760`
**Applied fix:** Replaced the four-line `echo` chain at `build.sh:108-114` with a single heredoc. `$@` is now escaped as `\$@` inside the heredoc so the literal `"$@"` token is written into `run.sh` (rather than being expanded at build time to the empty string). `${NODE_BIN}` and `${PROJECT_ROOT}` are now properly quoted to survive clone paths containing spaces. Also switched `$(which node)` to `$(command -v node)` as a portability nit. Verified:
- `bash -n build.sh` passes
- Simulated the generator with `PROJECT_ROOT="/home/autopcap/Dev Projects/FileScopeMCP"` and confirmed the emitted `run.sh` (a) contains literal `"$@"`, (b) parses under `bash -n`, and (c) has both path arguments properly quoted across the embedded space.

Note: requires human verification on next `./build.sh` invocation to confirm the regenerated `run.sh` behaves correctly under Cursor / cross-host WSL argument forwarding.

### WR-02: `.mcp.json` uses a relative path; silently dead if Claude Code is launched from anywhere other than the repo root

**Files modified:** `docs/troubleshooting.md`
**Commit:** `b203c83`
**Applied fix:** Took option 1 from the review (docs-only fix). Added a fifth bullet to the "MCP server not appearing in Claude Code" section that explains (a) the committed `.mcp.json` uses a relative path that only resolves when Claude Code's CWD is the repo root, (b) that the subprocess failing silently when spawned elsewhere is the expected failure mode, and (c) how to disambiguate when both repo-scope and user-scope entries are registered (via `claude mcp remove --scope <scope> FileScopeMCP`). Option 2 (absolute-path JSON variable) was not pursued because the review noted Claude Code variable support needed verification first — deferring to a future cleanup pass.

### WR-03: Substring match in `claude mcp list` post-check accepts false positives

**Files modified:** `scripts/register-mcp.mjs`
**Commit:** `ecd7d48`
**Applied fix:** Replaced the `.includes(SERVER_NAME)` substring match at `scripts/register-mcp.mjs:56` with a word-boundary regex match exactly as suggested in the review:
```js
const serverLineRegex = new RegExp(`(^|\\s)${SERVER_NAME}(\\s|:|$)`, 'm');
const listedOk = listResult.status === 0
  && typeof listResult.stdout === 'string'
  && serverLineRegex.test(listResult.stdout);
```
This prevents variant server names like `FileScopeMCP-dev` or `FileScopeMCP-fork` from causing the post-check to pass when the canonical `FileScopeMCP` entry failed to register. Verified via `node --check scripts/register-mcp.mjs`.

## Skipped Issues

_None — all three in-scope findings were fixed._

---

_Fixed: 2026-04-22T04:44:21Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
