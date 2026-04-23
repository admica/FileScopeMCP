# Phase 32: Zero-Config Auto-Registration - Pattern Map

**Mapped:** 2026-04-21
**Files analyzed:** 13 (3 new, 4 edited, 6 deleted)
**Analogs found:** 9 / 9 applicable (deletions and simple config edits don't need analogs)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.mcp.json` (NEW, root) | config (static JSON) | — | `mcp.json.claude-code` (being deleted) | exact — reuse schema minus placeholders |
| `scripts/register-mcp.mjs` (NEW) | utility script (Node CLI) | request-response (spawn claude → exit code) | `install-mcp-claude.sh` (being deleted, same goal) + `scripts/nexus.sh` (closest Node script pattern, though that one is bash) | role-match (goal) / partial (shape) |
| `tests/integration/register-mcp.test.ts` (NEW) | integration test | event-driven (spawn child, capture exit/stdout) | `tests/integration/mcp-stdout.test.ts` | exact — same shape (spawn Node script, assert stdout/exit) |
| `package.json` (EDIT) | config (manifest) | — | existing `scripts` block | exact — append one key |
| `build.sh` (EDIT) | orchestration script | — | `build.sh` itself (self-modify: swap one invocation, remove one block) | self |
| `README.md` §Quick Start (EDIT) | docs | — | current README §Quick Start | self |
| `docs/mcp-clients.md` (EDIT, rewrite) | docs | — | current `docs/mcp-clients.md` (extend/rewrite) | self |
| `.gitignore` (EDIT, verify) | config | — | current `.gitignore` | self (no edit expected — `mcp.json` already listed line 11) |
| `install-mcp-claude.sh` (DELETE) | — | — | — | n/a |
| `mcp.json.linux` (DELETE) | — | — | — | n/a |
| `mcp.json.mac` (DELETE) | — | — | — | n/a |
| `mcp.json.win.txt` (DELETE) | — | — | — | n/a |
| `mcp.json.claude-code` (DELETE) | — | — | — | n/a |
| `mcp.json` (DELETE, generated) | — | — | — | n/a (already in .gitignore) |

## Pattern Assignments

### `.mcp.json` at repo root (NEW, config)

**Analog:** `/home/autopcap/FileScopeMCP/mcp.json.claude-code` (to be deleted — contents are the template)

**Current template body** (full file, 8 lines):
```json
{
  "mcpServers": {
    "FileScopeMCP": {
      "command": "node",
      "args": ["{FILE_SCOPE_MCP_DIR}/dist/mcp-server.js"]
    }
  }
}
```

**Copy pattern:** Keep the `mcpServers.FileScopeMCP.command = "node"` shape. Per D-01, replace the `{FILE_SCOPE_MCP_DIR}/dist/mcp-server.js` placeholder with the **relative path** `dist/mcp-server.js` so the committed file is portable across clones. Per D-03, do NOT add `--base-dir` — FS auto-initializes to CWD.

**Final expected file:**
```json
{
  "mcpServers": {
    "FileScopeMCP": {
      "command": "node",
      "args": ["dist/mcp-server.js"]
    }
  }
}
```

**Note on schema validity:** `mcp.json.linux` (line 1-11 at `/home/autopcap/FileScopeMCP/mcp.json.linux`) also includes `"transport": "stdio"`, `"disabled": false`, `"alwaysAllow": []` — these are Cursor-specific fields and are NOT needed for Claude Code's `.mcp.json`. Keep the schema minimal to match `mcp.json.claude-code`.

---

### `scripts/register-mcp.mjs` (NEW, utility script)

**Closest analog (by goal):** `/home/autopcap/FileScopeMCP/install-mcp-claude.sh` — same goal (register FileScopeMCP with Claude Code), being replaced.

**Closest analog (by shape):** No existing `.mjs` Node CLI in the repo. `scripts/nexus.sh` is bash. The `spawn`/`spawnSync` pattern used in tests (`tests/integration/mcp-stdout.test.ts` lines 9, 20-24) is the most idiomatic example in this codebase.

**Key behaviors to copy from `install-mcp-claude.sh`:**

1. **Locate `dist/mcp-server.js` and fail if missing** (lines 33-37):
   ```bash
   SERVER_JS="${PROJECT_ROOT}/dist/mcp-server.js"
   if [ ! -f "$SERVER_JS" ]; then
       fail "dist/mcp-server.js not found. Run ./build.sh first to compile the project."
   fi
   ```

2. **Locate node binary** (lines 28-30):
   ```bash
   NODE_BIN="$(command -v node 2>/dev/null || true)"
   [ -z "$NODE_BIN" ] && fail "node not found in PATH. Install Node.js 18+ first."
   ```
   Per D-08, replace this with `process.execPath` in the Node script — no PATH lookup needed.

3. **Idempotency messaging** (lines 76-80):
   ```bash
   if [ "$ALREADY" = "yes" ]; then
       ok "Already registered (no changes needed)"
   else
       ok "Registered successfully"
   fi
   ```
   Per D-07, replace the hand-rolled JSON-mutation detection with `claude mcp add` (native idempotent) followed by `claude mcp list` verification.

4. **Closing hint message style** (lines 82-88):
   ```bash
   info "Config : $CLAUDE_CONFIG"
   info "Command: $NODE_BIN"
   info "Server : $SERVER_JS"
   echo ""
   echo -e "${GREEN}Done.${NC} Restart Claude Code (or run: claude mcp list) to confirm."
   ```
   Keep the summary style (Config/Command/Server triplet) — use `console.log` since ESM Node script, no color library dependency.

**Spawn pattern to copy from `tests/integration/mcp-stdout.test.ts`** (lines 9, 20-24):
```typescript
import { spawn } from 'node:child_process';
// ...
const proc = spawn(process.execPath, [SERVER_BIN], {
  cwd: os.tmpdir(),
  stdio: ['pipe', 'pipe', 'ignore'],
});
```
For `register-mcp.mjs`, use `spawnSync` (synchronous) because it's a short-lived CLI invocation with an exit code check:

```javascript
import { spawnSync } from 'node:child_process';
// ...
const result = spawnSync('claude', ['mcp', 'add', '--scope', 'user', 'FileScopeMCP', process.execPath, serverJsPath], {
  stdio: 'inherit',
});
```

**Fail-soft pattern (D-06)** — when `claude` CLI missing, `spawnSync` returns `{ error: { code: 'ENOENT' } }`:
```javascript
if (result.error && result.error.code === 'ENOENT') {
  console.log('Claude Code CLI not found; install from https://claude.ai/code or add `claude` to PATH, then re-run.');
  process.exit(0); // do NOT fail the build
}
```

**Post-check (D-07)** — call `claude mcp list` to verify registration:
```javascript
const check = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf-8' });
if (check.stdout?.includes('FileScopeMCP')) {
  console.log('Registered successfully. Restart Claude Code to pick up the change.');
}
```

**ESM convention (code_context note):** File is `.mjs`, use `import` syntax (matches `"type": "module"` in `package.json:6`). Use `node:` prefix for built-ins (matches `import { spawn } from 'node:child_process'` in `tests/integration/mcp-stdout.test.ts:9`).

---

### `tests/integration/register-mcp.test.ts` (NEW, integration test)

**Analog:** `/home/autopcap/FileScopeMCP/tests/integration/mcp-stdout.test.ts` — exact match (spawns a Node script with controlled env, asserts on exit/stdout).

**Imports pattern to copy** (lines 8-12):
```typescript
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
```

**Skip-guard pattern to copy** (lines 14-17):
```typescript
const SERVER_BIN = path.join(process.cwd(), 'dist/mcp-server.js');
const serverBinExists = existsSync(SERVER_BIN);

describe.skipIf(!serverBinExists)('mcp stdout pollution', () => {
```
For the new test, the skip guard should check that `scripts/register-mcp.mjs` exists (it's ESM source — no build needed):
```typescript
const SCRIPT_PATH = path.join(process.cwd(), 'scripts/register-mcp.mjs');
const scriptExists = existsSync(SCRIPT_PATH);
describe.skipIf(!scriptExists)('register-mcp fail-soft', () => { ... });
```

**Child process lifecycle pattern to copy** (lines 20-24 + finally block 54-60):
```typescript
const proc = spawn(process.execPath, [SERVER_BIN], {
  cwd: os.tmpdir(),
  stdio: ['pipe', 'pipe', 'ignore'],
});

try {
  // ... assertions
} finally {
  proc.kill('SIGTERM');
  await new Promise<void>(resolve => {
    proc.on('exit', resolve);
    setTimeout(resolve, 3_000);
  });
}
```

**For D-20 (missing `claude` CLI test)** — override PATH to exclude any `claude` binary:
```typescript
const proc = spawn(process.execPath, [SCRIPT_PATH], {
  cwd: os.tmpdir(),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PATH: '/nonexistent-path' }, // force ENOENT on `claude`
});
```

**Exit-code + stdout assertion pattern:**
```typescript
const [exitCode, stdout] = await new Promise<[number | null, string]>(resolve => {
  let out = '';
  proc.stdout!.on('data', (c: Buffer) => { out += c.toString(); });
  proc.on('exit', code => resolve([code, out]));
});
expect(exitCode).toBe(0); // fail-soft per D-06
expect(stdout).toMatch(/Claude Code CLI not found/); // documented hint
```

**Test timeout convention** (line 61):
```typescript
}, 20_000);
```
Use `10_000` for this test — it's a fast fail path with no I/O waits.

---

### `package.json` (EDIT, add script)

**Analog:** existing `scripts` block (`package.json:7-19`).

**Current scripts block excerpt** (lines 7-19):
```json
"scripts": {
  "build": "esbuild ...",
  "build:nexus-api": "esbuild ...",
  "postbuild:nexus-api": "grep ...",
  "build:nexus-ui": "vite build ...",
  "build:nexus": "npm run build && npm run build:nexus-api && npm run build:nexus-ui",
  "dev:nexus-ui": "vite dev ...",
  "nexus": "node dist/nexus/main.js",
  "typecheck": "tsc --noEmit",
  "start": "node dist/mcp-server.js",
  "test": "vitest",
  "coverage": "vitest run --coverage"
}
```

**Pattern to copy:** Simple `"node <path>"` invocations (see `"nexus": "node dist/nexus/main.js"` at line 14, `"start": "node dist/mcp-server.js"` at line 16). Add one sibling key:
```json
"register-mcp": "node scripts/register-mcp.mjs"
```

Placement (D-17): anywhere in the block. Suggest alphabetical or near `start` since it's user-invokable.

---

### `build.sh` (EDIT — self-modify)

**Analog:** the file itself (`/home/autopcap/FileScopeMCP/build.sh`).

**Block to DELETE (D-14)** — `mcp.json` template generation (lines 109-124):
```bash
# Ensure MCP template exists
if [ ! -f "$MCP_TEMPLATE" ]; then
    print_error "$MCP_TEMPLATE not found in $PROJECT_ROOT."
    exit 1
fi

# Generate MCP config from template in the base directory
print_action "Generating MCP configuration..."
if ! grep -q "{FILE_SCOPE_MCP_DIR}" "$MCP_TEMPLATE"; then
    print_warning "No {projectRoot} placeholder in $MCP_TEMPLATE. Output may be incorrect."
fi
if sed -e "s|{FILE_SCOPE_MCP_DIR}|${PROJECT_ROOT}|g" "$MCP_TEMPLATE" > "mcp.json" 2>> "$LOGFILE"; then
    print_detail "MCP configuration generated at ./mcp.json"
else
    print_error "Failed to generate mcp.json. Check $LOGFILE for details."
fi
```

**Also remove related `MCP_TEMPLATE` assignment** in the OS-detection block (lines 21-38): the three `MCP_TEMPLATE="mcp.json.mac"` / `"mcp.json.linux"` lines (lines 23, 29, 35) become unused.

**Block to REPLACE (D-13)** — Claude Code registration (lines 141-147):
```bash
# Register with Claude Code
print_action "Registering with Claude Code..."
if bash "${PROJECT_ROOT}/install-mcp-claude.sh" 2>&1 | tee -a "$LOGFILE"; then
    print_detail "Claude Code MCP registration complete."
else
    print_warning "Claude Code registration failed. Run install-mcp-claude.sh manually after setup."
fi
```

**Replace with:**
```bash
# Register with Claude Code (idempotent; fail-soft if `claude` CLI missing)
print_action "Registering with Claude Code..."
if npm run register-mcp 2>&1 | tee -a "$LOGFILE"; then
    print_detail "Claude Code MCP registration complete."
else
    print_warning "Claude Code registration failed. Run 'npm run register-mcp' manually after setup."
fi
```

**Block to KEEP (D-16)** — `run.sh` generation (lines 126-139) is orthogonal; leave it alone.

**Final-message block to UPDATE (lines 149-156)** — remove stale references:
```bash
# Current:
echo -e "${CYAN}Cursor AI: copy ./mcp.json to your project's .cursor/ directory.${NC}"
echo -e "${CYAN}Claude Code: registration was attempted above (or run install-mcp-claude.sh manually).${NC}"
```
Update the Cursor AI hint to point at `docs/mcp-clients.md` (no more generated `./mcp.json`), and update the Claude Code hint to mention `npm run register-mcp` (never `install-mcp-claude.sh`).

**Logging helper reuse** — keep using existing `print_action`, `print_detail`, `print_warning`, `print_error` (defined lines 41-75) for all new lines. No new helpers needed.

---

### `README.md` §Quick Start (EDIT)

**Analog:** current README `/home/autopcap/FileScopeMCP/README.md` §Quick Start (lines 26-47).

**Current block to update** (lines 26-34):
```markdown
## Quick Start

\`\`\`bash
git clone https://github.com/admica/FileScopeMCP.git
cd FileScopeMCP
./build.sh          # installs deps, compiles, registers with Claude Code
\`\`\`

That's it. Open a Claude Code session in any project and FileScopeMCP auto-initializes. Try:
```

**Per D-17:** comment on line 31 already says "registers with Claude Code" — accurate. Add a single line below the code block noting idempotency and that the mechanism is `claude mcp add --scope user` (idempotent, re-runnable via `npm run register-mcp`). Do not mention `install-mcp-claude.sh` anywhere.

Example insertion (between current lines 32 and 34):
```markdown
`./build.sh` registers FileScopeMCP globally via `claude mcp add --scope user`. Re-run any time — idempotent. Missing the `claude` CLI? The build still succeeds; see [docs/mcp-clients.md](docs/mcp-clients.md) for manual setup.
```

---

### `docs/mcp-clients.md` (EDIT — full rewrite per D-18)

**Analog:** current `docs/mcp-clients.md` (all 76 lines). Structure stays — section headers are reusable, content rewritten.

**Current structure to preserve:**
- `## Claude Code` (lines 3-15) — rewrite
- `## Cursor AI` (lines 17-65) — keep, extend with inline JSON that was in deleted templates
- `## Daemon Mode` (lines 67-75) — keep as-is (orthogonal)

**New section to add:** `## Cross-host (WSL → Windows)` — content sourced from `mcp.json.linux` (before deletion), which currently reads:
```json
{
  "mcpServers": {
    "FileScopeMCP": {
      "command": "wsl",
      "args": ["-d", "Ubuntu-24.04", "{FILE_SCOPE_MCP_DIR}/run.sh", "--base-dir=${projectRoot}"],
      "transport": "stdio",
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```
Pull this block verbatim into the new Cross-host section, with instructions explaining it's manual config (per D-15).

**Current Claude Code section to REPLACE** (lines 3-15):
```markdown
## Claude Code

Registered automatically by `build.sh`. To re-register without rebuilding:

\`\`\`bash
./install-mcp-claude.sh
\`\`\`

The server auto-initializes to the current working directory...
```

**Replace with:** describe `npm run register-mcp` (D-04, D-17), mention the committed `.mcp.json` dogfood behavior for contributors (D-02), keep the `set_base_directory` guidance at the bottom.

**Cursor AI inline snippets to KEEP** (lines 19-65): already inline and correct — these are the source of truth per D-11. No further extension needed; the Cursor content is already complete (WSL, Windows Native, macOS/Linux Native). The consolidation is conceptual: the OS-specific template files (`mcp.json.mac`, `mcp.json.win.txt`) are deleted because this doc already contains equivalent JSON blocks.

**Order per D-18 discretion:** Claude Code first (primary target), Cursor AI second, Cross-host (WSL) third, Daemon Mode last.

---

### `.gitignore` (EDIT — verify only)

**Analog:** current `/home/autopcap/FileScopeMCP/.gitignore`.

**Current content (relevant lines):**
```
# line 11:
mcp.json
```

**Per D-12:** `mcp.json` is already listed on line 11 — no edit needed. **Do NOT** add `.mcp.json` (note the leading dot) — that's the new committed dogfood config and must be tracked.

**Verification:** confirm `mcp.json` (the generated legacy file being deleted) stays ignored and `.mcp.json` (the new file) is NOT in the ignore list (it isn't — the line 11 pattern is `mcp.json` without the leading dot, so `.mcp.json` won't match).

---

## Shared Patterns

### ESM module conventions
**Source:** `package.json:6` (`"type": "module"`) + `tests/integration/mcp-stdout.test.ts:9`
**Apply to:** `scripts/register-mcp.mjs`, `tests/integration/register-mcp.test.ts`
```javascript
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
```
Always prefix built-ins with `node:`. Use `import` not `require`.

### Child-process spawn pattern
**Source:** `tests/integration/mcp-stdout.test.ts:20-24` and `tests/integration/broker-lifecycle.test.ts:147`
**Apply to:** `scripts/register-mcp.mjs` (spawning `claude`), `tests/integration/register-mcp.test.ts` (spawning the script)
```typescript
const proc = spawn(process.execPath, [SCRIPT_BIN], {
  cwd: os.tmpdir(),
  stdio: ['pipe', 'pipe', 'ignore'],
});
```
For the script itself, prefer `spawnSync` (short-lived, need exit code). For the test, `spawn` with async collection matches existing test patterns.

### Fail-soft / non-fatal exit convention
**Source:** `install-mcp-claude.sh` (the whole script uses `set -e` but build.sh calls it with `|| print_warning` — lines 141-147) + broker PID guard pattern (`tests/integration/broker-lifecycle.test.ts:194-195` — `exitCode === 0` means "already running, not an error")
**Apply to:** `scripts/register-mcp.mjs`
Convention: `process.exit(0)` when the tool/CLI is missing — signals "nothing to do" to the build pipeline, not a failure. Use `process.exit(1)` only for genuine breakage (e.g., `dist/mcp-server.js` missing — mirrors `install-mcp-claude.sh:34-36`).

### Vitest skip-guard convention
**Source:** `tests/integration/mcp-stdout.test.ts:17` (`describe.skipIf(!serverBinExists)`) + `tests/integration/broker-lifecycle.test.ts:98-105`
**Apply to:** `tests/integration/register-mcp.test.ts`
```typescript
const SCRIPT_PATH = path.join(process.cwd(), 'scripts/register-mcp.mjs');
const scriptExists = existsSync(SCRIPT_PATH);
describe.skipIf(!scriptExists)('register-mcp fail-soft', () => { /* ... */ });
```

### Logging style in build.sh edits
**Source:** `build.sh:41-75` — existing helpers (`print_header`, `print_action`, `print_detail`, `print_warning`, `print_error`)
**Apply to:** any new `build.sh` lines
Reuse existing helpers; do not introduce new ones. Colors are already defined (lines 10-15). All helpers log to `$LOGFILE` — preserve this behavior.

## No Analog Found

None. Every new file has a closest analog in the existing codebase (even if imperfect).

## Metadata

**Analog search scope:**
- `/home/autopcap/FileScopeMCP/scripts/` (1 file — `nexus.sh`, bash)
- `/home/autopcap/FileScopeMCP/tests/integration/` (4 files)
- `/home/autopcap/FileScopeMCP/docs/` (5 files)
- Repo root (build.sh, install-mcp-claude.sh, package.json, .gitignore, README.md, all `mcp.json*` templates)
- `vitest.config.ts` (for test-config conventions)

**Files scanned:** 21
**Pattern extraction date:** 2026-04-21
