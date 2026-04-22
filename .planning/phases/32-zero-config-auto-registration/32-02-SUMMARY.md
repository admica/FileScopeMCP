---
phase: 32-zero-config-auto-registration
plan: 02
subsystem: infra
tags: [esm, node-cli, claude-code, mcp-registration, spawnSync, vitest, integration-test]

# Dependency graph
requires:
  - phase: 31-test-infrastructure
    provides: vitest integration-test conventions (mcp-stdout.test.ts skipIf pattern, spawn+stdout-capture lifecycle)
provides:
  - "scripts/register-mcp.mjs — ESM CLI that invokes `claude mcp add --scope user FileScopeMCP <node> <abs-path>` with fail-soft ENOENT handling and `claude mcp list` post-check"
  - "npm run register-mcp — package.json script entry"
  - "tests/integration/register-mcp.test.ts — integration test locking the fail-soft contract"
affects:
  - 32-03-plan (build.sh will call `npm run register-mcp` replacing the legacy bash script)
  - 32-04-plan (docs reference the new command)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESM Node CLI script (.mjs) with node: import prefixes"
    - "spawnSync with stdio:'inherit' for interactive CLI delegation; encoding:'utf-8' for parseable stdout"
    - "Fail-soft exit-0 convention on ENOENT for optional dev-tool dependencies (D-06)"
    - "Idempotent registration via `claude mcp add` + post-check with `claude mcp list` substring match (D-07)"

key-files:
  created:
    - scripts/register-mcp.mjs
    - tests/integration/register-mcp.test.ts
  modified:
    - package.json (added `register-mcp` script entry)

key-decisions:
  - "ESM/.mjs script over bash — cross-platform (macOS/Linux/Windows) per D-05"
  - "process.execPath over 'node' string literal — correct node resolution on nvm/volta/system-node hosts per D-08"
  - "Fail-soft ENOENT (exit 0 + documented hint) — never break ./build.sh for users without claude CLI per D-06"
  - "Widen test skipIf guard to also require dist/mcp-server.js — Guard 1 fires before Guard 2, so ENOENT branch only reachable post-build (Rule 1 deviation)"

patterns-established:
  - "scripts/*.mjs ESM CLI convention: resolve paths via import.meta.url, never rely on cwd"
  - "Two-guard registration script: exit-1 on real build-state errors, exit-0 on optional-tool absence"

requirements-completed:
  - ZERO-02

# Metrics
duration: ~25min
completed: 2026-04-22
---

# Phase 32 Plan 02: Zero-Config Auto-Registration Summary

**ESM Node CLI `scripts/register-mcp.mjs` that delegates FileScopeMCP registration to `claude mcp add --scope user` with fail-soft ENOENT handling, wired as `npm run register-mcp` and locked by an integration test.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-04-22T00:36:00Z (approx)
- **Completed:** 2026-04-22T01:00:55Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Replaced the bash `install-mcp-claude.sh` logic (which mutated `~/.claude.json` directly) with a supported, idempotent delegation to `claude mcp add --scope user`.
- Script is cross-platform ESM Node — runs unchanged on macOS, Linux, and Windows.
- Fail-soft on missing `claude` CLI: prints documented hint and exits 0, never blocks `./build.sh`.
- Locked the fail-soft contract in CI via `tests/integration/register-mcp.test.ts` (spawn with `PATH=/nonexistent-path`, assert exit 0 + hint on stdout).
- Idempotent by virtue of `claude mcp add`'s native behavior, with `claude mcp list` post-check for truthful success messaging.
- Zero new npm dependencies.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write integration test first (RED)** — `4aeb896` (test)
2. **Task 2: Implement register-mcp.mjs + wire npm script (GREEN)** — `72bdf60` (feat, also contains Rule 1 test-guard widen)

_Note: Task 2 bundles the GREEN implementation and one Rule 1 deviation fix in a single commit because the test guard widen is a precondition for GREEN to pass in any environment without a pre-built `dist/`._

## Files Created/Modified

- `scripts/register-mcp.mjs` (new, 72 lines) — ESM CLI: resolves `dist/mcp-server.js` via `import.meta.url`, spawns `claude mcp add --scope user FileScopeMCP <process.execPath> <abs-path>`, handles ENOENT (exit 0 + hint), validates success via `claude mcp list` substring match, prints Node/Server/Scope summary.
- `tests/integration/register-mcp.test.ts` (new, 55 lines) — Integration test: spawns script with `PATH=/nonexistent-path`, asserts exit 0 + stdout contains `Claude Code CLI not found`. `describe.skipIf(!scriptExists || !serverBinExists)` degrades gracefully when script is absent (pre-task-2) or when `dist/` is unbuilt.
- `package.json` (modified, +1 line) — added `"register-mcp": "node scripts/register-mcp.mjs"` between `start` and `test`.

## Decisions Made

- **ESM over bash:** `scripts/register-mcp.mjs`, not a shell script. Matches codebase conventions (`"type": "module"`) and delivers cross-platform behavior (Windows lacks bash natively).
- **`process.execPath`, not `'node'`:** Whatever Node launched the script is the Node registered with Claude Code — avoids the "which node" problem on nvm/volta hosts.
- **Delegation over mutation:** Call `claude mcp add --scope user` and let Claude Code own its own config. The legacy `install-mcp-claude.sh` wrote `~/.claude.json` directly, which broke on schema changes.
- **Two-guard design:** Guard 1 (missing `dist/mcp-server.js`) exits 1 — genuine build-state error. Guard 2 (missing `claude` CLI) exits 0 — optional dependency. Different exit codes communicate different things to `build.sh`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Widened test `skipIf` guard to also require `dist/mcp-server.js`**
- **Found during:** Task 2 (smoke-testing the ENOENT branch)
- **Issue:** The plan's test as literally written would FAIL (not skip) in any environment where `scripts/register-mcp.mjs` exists but `dist/mcp-server.js` does not (e.g., CI test runs without a prior `npm run build`). The script's Guard 1 fires before Guard 2, so when `dist/mcp-server.js` is missing the script exits 1 with a build-error message, never reaching the ENOENT branch the test asserts on. Manual smoke with a stub `dist/mcp-server.js` confirmed the GREEN path works correctly; the issue was test reachability.
- **Fix:** Added `const SERVER_BIN = path.join(process.cwd(), 'dist/mcp-server.js'); const serverBinExists = existsSync(SERVER_BIN);` and changed the suite to `describe.skipIf(!scriptExists || !serverBinExists)`. Matches the exact pattern in `tests/integration/mcp-stdout.test.ts:14-17` which also skips when build artifacts are missing.
- **Files modified:** `tests/integration/register-mcp.test.ts`
- **Verification:** Script grep checks still pass (`describe.skipIf(` present, `PATH: '/nonexistent-path'` present, hint assertion present, `expect(exitCode).toBe(0)` present). Manual smoke test confirms: with stubbed `dist/mcp-server.js` and `PATH=/nonexistent-path`, the script exits 0 and prints the hint — the exact condition the test asserts.
- **Committed in:** `72bdf60` (part of Task 2 commit — the test-guard fix is a GREEN precondition)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for correctness. Without the wider skipIf, the test would fail on any fresh-clone CI run that doesn't execute `npm run build` before `npm test`. The fix matches the established analog pattern (`mcp-stdout.test.ts`) rather than introducing new behavior. No scope creep — still a single test, still asserting the exact ENOENT contract.

## Issues Encountered

- **vitest not executable in worktree:** `node_modules/` is not populated in this worktree (parallel-executor default). The plan's verification step (`npx vitest run tests/integration/register-mcp.test.ts`) could not run here. Mitigated by: (a) the test file satisfies all grep-based acceptance criteria, (b) a manual smoke reproduces the exact behavior the test asserts (exit 0 + hint on stdout with scrubbed PATH and stubbed `dist/mcp-server.js`), (c) the test's `skipIf` guard means it will safely skip in environments without artifacts and run cleanly in CI after a build.

## User Setup Required

None — no external service configuration required. End-user runs `./build.sh` (which Plan 03 will wire to `npm run register-mcp`) and registration happens automatically if `claude` CLI is installed; otherwise the build still succeeds with a hint.

## Known Stubs

None — no placeholder/mock data introduced.

## TDD Gate Compliance

- RED gate: `4aeb896` (test commit, preceding implementation). The script did not exist at the time of commit, so the suite would have SKIPPED rather than PASSED — valid RED state per the plan's acceptance criteria ("SKIP or FAIL, not PASS").
- GREEN gate: `72bdf60` (feat commit introducing `scripts/register-mcp.mjs` + npm script).
- REFACTOR gate: not needed — implementation is already minimal and idiomatic.

## Next Phase Readiness

- `npm run register-mcp` is ready to be invoked from `build.sh` (Plan 03 deliverable).
- Docs can reference `npm run register-mcp` as the canonical registration command (Plan 04 deliverable).
- `install-mcp-claude.sh` is unchanged by this plan — deletion is Plan 03's responsibility.
- No lingering references to `install-mcp-claude.sh` in `scripts/` (verified).

## Self-Check: PASSED

Verified on completion:
- `scripts/register-mcp.mjs` exists: FOUND
- `tests/integration/register-mcp.test.ts` exists: FOUND
- `package.json` has `"register-mcp": "node scripts/register-mcp.mjs"`: FOUND
- Commit `4aeb896` exists in git log: FOUND
- Commit `72bdf60` exists in git log: FOUND
- `node --check scripts/register-mcp.mjs` succeeds: ok
- `grep -RE 'install-mcp-claude\.sh' scripts/` returns nothing: ok
- Manual smoke (stub `dist/mcp-server.js` + `PATH=/nonexistent-path`) → exit 0 + "Claude Code CLI not found" on stdout: ok

---
*Phase: 32-zero-config-auto-registration*
*Completed: 2026-04-22*
