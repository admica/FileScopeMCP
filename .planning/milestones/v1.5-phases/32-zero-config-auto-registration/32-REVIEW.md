---
phase: 32-zero-config-auto-registration
reviewed: 2026-04-21T00:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - .mcp.json
  - scripts/register-mcp.mjs
  - tests/integration/register-mcp.test.ts
  - package.json
  - build.sh
  - README.md
  - docs/mcp-clients.md
  - docs/troubleshooting.md
findings:
  critical: 0
  warning: 3
  info: 7
  total: 10
status: issues_found
---

# Phase 32: Code Review Report

**Reviewed:** 2026-04-21
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 32 replaces the deleted legacy installer + template-file approach with a single cross-platform ESM script (`scripts/register-mcp.mjs`) driven by the Claude Code CLI, plus a committed repo-root `.mcp.json` for contributor dogfood. The design is sound: fail-soft ENOENT handling keeps `build.sh` green on dev machines without the `claude` CLI, `process.execPath` correctly threads the user's node binary through registration, and the post-check via `claude mcp list` gives useful feedback without being load-bearing.

Findings are concentrated in the legacy shell glue in `build.sh` that escaped migration cleanup, plus a couple of cross-platform / robustness concerns in the new script. No critical (security / crash) issues detected. The most impactful warning is that the `run.sh` generator in `build.sh:111-113` produces a malformed artifact — empirically verified against `run.sh` on disk — which is a pre-existing bug now surfaced by the phase's renewed attention to the build path.

## Critical Issues

_None._

## Warnings

### WR-01: `run.sh` generator emits malformed script (pre-existing bug, still live after migration)

**File:** `build.sh:108-113`
**Issue:** Two problems compose here, verified against the generated `run.sh` on disk:

1. **Literal empty-string tail.** Line 113 is `echo "\"$@\"" >> run.sh`. `$@` is expanded at `build.sh`-execution time, not when `run.sh` later runs. When `build.sh` is invoked with no args (the documented path in README.md:31), `"$@"` becomes the empty string and `run.sh` ends with a literal `""` argv token. Real generated output:
   ```
   /home/autopcap/.nvm/versions/node/v22.21.1/bin/node /home/autopcap/FileScopeMCP/dist/mcp-server.js ""
   ```
   This passes an empty argument to `mcp-server.js` on every invocation, and more importantly the intended `"$@"` placeholder — which `docs/mcp-clients.md:110` promises "forwards arguments to `node dist/mcp-server.js`" — is never written. Cursor / cross-host WSL users who copy the documented `run.sh --base-dir=${projectRoot}` invocation get `--base-dir=...` dropped on the floor because there is no `"$@"` in `run.sh` to receive it.

2. **Unquoted `PROJECT_ROOT` via nested double quotes.** Line 112 is:
   ```bash
   echo -n ""${PROJECT_ROOT}/dist/mcp-server.js" " >> run.sh
   ```
   The pairing is `""` + `${PROJECT_ROOT}/dist/mcp-server.js` + `" "` — so `PROJECT_ROOT` is actually outside quotes. If the repo is cloned to a path with spaces (common on macOS under `~/Dev Projects/...`), the generated line splits across the space and breaks `run.sh`.

**Fix:** Use a single heredoc with literal `"$@"`. This also eliminates the nested-quote hazard and the string-at-a-time echo chain:
```bash
NODE_BIN="$(command -v node)"
cat > run.sh <<EOF
#!/bin/bash
# Adapt this for your needs in WSL/Linux.
# Format: <node> <mcp-server.js> --base-dir=<your-project>
"${NODE_BIN}" "${PROJECT_ROOT}/dist/mcp-server.js" "\$@"
EOF
chmod +x run.sh
```
Note the escaped `\$@` so `$@` is written literally into `run.sh` for later expansion. `${NODE_BIN}` and `${PROJECT_ROOT}` expand at build time (desired).

### WR-02: `.mcp.json` uses a relative path; silently dead if Claude Code is launched from anywhere other than the repo root

**File:** `.mcp.json:5`
**Issue:** `"args": ["dist/mcp-server.js"]` resolves relative to whatever Claude Code picks as the MCP server's CWD. Per docs (`docs/mcp-clients.md:28`) this is "only takes effect when Claude Code is open on this repo (its CWD is this repo root)", but:
- If Claude Code ever resolves `.mcp.json` against the repo root but spawns the subprocess from the user's home (common behavior for some clients), the server cannot find `dist/mcp-server.js` and fails silently.
- There is no guard in the launch path that reports this clearly; the MCP stdio negotiation just times out and the user sees an opaque failure.

The phase 32 design note (WR scope) explicitly chose relative for dogfood reasons — that's fine — but pairing it with `register-mcp.mjs` (which uses absolute paths via `REPO_ROOT`) means two registrations can coexist and behave differently, which is a recipe for contributor confusion.

**Fix:** Two options, pick one:
1. Keep relative, but add a troubleshooting entry in `docs/troubleshooting.md` ("MCP server not appearing in Claude Code" section) for the clash case: "If you see both a user-scope `FileScopeMCP` entry from `build.sh` and the repo-scope `.mcp.json` entry active simultaneously, Claude Code's resolution order is user-scope first — remove one with `claude mcp remove --scope user FileScopeMCP` to avoid drift."
2. Use absolute path resolution in `.mcp.json` via a JSON variable (if Claude Code supports `${workspaceRoot}` style) — verify support before changing.

### WR-03: Substring match in `claude mcp list` post-check accepts false positives

**File:** `scripts/register-mcp.mjs:56`
**Issue:**
```js
const listedOk = listResult.status === 0
  && typeof listResult.stdout === 'string'
  && listResult.stdout.includes(SERVER_NAME);
```
A user who has registered a variant server named e.g. `FileScopeMCP-dev` or `FileScopeMCP-fork` will have the post-check pass even if the exact `FileScopeMCP` entry failed to register. This is a "verified successfully" lie path.

**Fix:** Tighten the match. `claude mcp list` output is line-oriented; match the server name at a word boundary:
```js
const serverLineRegex = new RegExp(`(^|\\s)${SERVER_NAME}(\\s|:|$)`, 'm');
const listedOk = listResult.status === 0
  && typeof listResult.stdout === 'string'
  && serverLineRegex.test(listResult.stdout);
```

## Info

### IN-01: Non-ASCII glyphs in console output render as mojibake on Windows `cmd.exe`

**File:** `scripts/register-mcp.mjs:20, 60, 62`
**Issue:** Uses `—`, `✓`, `⚠` in `console.log`. On Windows under the default `cmd.exe` codepage (CP-437/CP-1252), these render as garbage. Windows Terminal / PowerShell 7+ handle UTF-8, but `cmd.exe` is still the default shell invoked by `npm run register-mcp` from many Windows setups.
**Fix:** Replace with ASCII equivalents (`--`, `[ok]`, `[!]`) for the registration script's critical output lines, or explicitly set `process.stdout` encoding. ASCII is simpler:
```js
console.log('  [ok] Registered successfully (verified via `claude mcp list`).');
```

### IN-02: Fallback-command suggestion in error path is not shell-safe if paths contain `"`

**File:** `scripts/register-mcp.mjs:50`
**Issue:**
```js
console.error('  Re-run with verbose output: claude mcp add --scope user FileScopeMCP "' + NODE_BIN + '" "' + SERVER_JS + '"');
```
Unix paths can legally contain `"`. If `NODE_BIN` or `SERVER_JS` contains a double quote, the printed command is unshellable and misleading. Extremely unlikely but trivially fixed.
**Fix:** Use single-quote wrapping and escape any embedded single quotes, or recommend the user copy the path argv pair shown in `process.argv` instead of re-constructing a command line.

### IN-03: `$(which node)` in `build.sh:111` pins to current nvm shim

**File:** `build.sh:111`
**Issue:** `echo -n "$(which node) " >> run.sh` captures the current `node` resolution at build time. Users who `nvm use` to a different version afterwards will have `run.sh` still pointing at the old shim, which is often a broken path. This mirrors the design choice in `register-mcp.mjs` (`process.execPath`), but the register path is re-run on each build while `run.sh` is a persistent artifact.
**Fix:** Either (a) document that `run.sh` must be regenerated after node upgrades, (b) resolve to a stable path like `/usr/bin/env node`, or (c) leave as-is and rely on `register-mcp.mjs` as the primary path. Option (b) is the least-surprise choice:
```bash
cat > run.sh <<EOF
#!/usr/bin/env bash
exec node "${PROJECT_ROOT}/dist/mcp-server.js" "\$@"
EOF
```

### IN-04: Integration test silently skips on non-Linux/non-macOS hosts because of hardcoded `/nonexistent-path`

**File:** `tests/integration/register-mcp.test.ts:28`
**Issue:** `env: { ...process.env, PATH: '/nonexistent-path' }` uses a Unix-style absolute path. On Windows, `PATH=/nonexistent-path` may still resolve `claude.exe` via `PATHEXT` fallbacks in some shells, making the ENOENT branch unreachable and the assertion `expect(stdout).toMatch(/Claude Code CLI not found/)` flake.
**Fix:** Use an explicit `describe.skipIf(process.platform === 'win32')` guard, or use a path that is guaranteed empty on every platform (e.g., an empty string `''` or a dynamically-created empty tempdir).

### IN-05: `package.json:17` `register-mcp` script is Unix-centric

**File:** `package.json:17`
**Issue:** `"register-mcp": "node scripts/register-mcp.mjs"` — forward slash works under npm on Windows (npm normalizes), so this is fine in practice. Noting for completeness since the phase explicitly targets cross-platform. No action needed.
**Fix:** None.

### IN-06: Troubleshooting doc missing guidance on `.mcp.json` vs `register-mcp` coexistence

**File:** `docs/troubleshooting.md:8-12`
**Issue:** The "MCP server not appearing in Claude Code" section tells users to run `claude mcp list` and `npm run register-mcp`, but does not address the case where `.mcp.json` (dogfood / repo-scope) conflicts with a user-scope registration. Contributors who clone the repo and run `build.sh` end up with two registrations; which one wins (and how to inspect) is unclear. See also WR-02.
**Fix:** Add a bullet:
> 5. If working inside the FileScopeMCP repo itself, the committed `.mcp.json` (repo scope) can coexist with the user-scope entry created by `build.sh`. Claude Code prefers more specific scopes — use `claude mcp list` to see what is active, and `claude mcp remove --scope <scope> FileScopeMCP` to disambiguate.

### IN-07: Docs snippet uses `C:\\FileScopeMCP\\...` without "example path" disclaimer

**File:** `docs/mcp-clients.md:69`
**Issue:** The Windows Native Cursor AI snippet hardcodes `C:\\FileScopeMCP\\dist\\mcp-server.js`. A reader who copy-pastes without customizing will get a silent failure. Other snippets explicitly say "Replace `Ubuntu-24.04` with your WSL distro"; this one does not have a similar hint.
**Fix:** Add a one-line note after the snippet: "Replace `C:\\FileScopeMCP\\...` with the actual absolute path to your clone."

---

_Reviewed: 2026-04-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
