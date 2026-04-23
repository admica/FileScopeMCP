# Phase 32: Zero-Config Auto-Registration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-21
**Phase:** 32-zero-config-auto-registration
**Areas discussed:** `.mcp.json` purpose, `claude mcp add` scope, Legacy cleanup, build.sh + WSL
**Mode:** Claude-proposed + user-approved (user requested "ask the questions, then provide your best answers")

---

## `.mcp.json` Purpose

| Option | Description | Selected |
|--------|-------------|----------|
| A1. Dogfood only | Committed file points at this repo's own `dist/mcp-server.js` via relative path. Auto-discovery for contributors working on FS. | ✓ |
| A2. Template only | Commit as `.mcp.json.example` with placeholder paths; users copy and edit. | |
| A3. Both | Commit dogfood `.mcp.json` + `.mcp.json.example`. | |

**Claude's pick:** A1
**User's response:** Approved
**Rationale:** End-users who want FS in their own project should use `npm run register-mcp` (scope = user), not copy-paste JSON. Template is pure duplication. Relative path `["dist/mcp-server.js"]` = portable across clones; CC runs MCP servers with repo root as CWD.

---

## `claude mcp add` Scope

| Option | Description | Selected |
|--------|-------------|----------|
| B1. `--scope user` | Writes to `~/.claude.json`, FS available in every CC session everywhere. Run once. | ✓ |
| B2. `--scope local` | Writes to CWD's `~/.claude.json` entry. Must run in each project. | |
| B3. `--scope project` | Writes `.mcp.json` to CWD. Commits to that repo. | |
| B4. Flag-driven | Support `--scope=user\|local\|project` with user default. | |

**Claude's pick:** B1
**User's response:** Approved
**Rationale:** Matches "one command, works everywhere" goal. `local` = per-project friction. `project` = invasive (writes into user repos). Flag = over-engineering for single-user tool. Trade-off: absolute path to FS dir gets written to `~/.claude.json`; if user moves FS, breaks. Acceptable + documented.

---

## Legacy Cleanup

| Option | Description | Selected |
|--------|-------------|----------|
| C1. Full purge | Delete all: `install-mcp-claude.sh`, `mcp.json.{linux,mac,win.txt,claude-code}`, generated `mcp.json`. | |
| C2. Keep Cursor/Windows templates | Delete only Claude-specific files. | |
| C3. Archive to docs | Move template contents into `docs/mcp-clients.md`, delete root files. | ✓ |

**Claude's pick:** C3
**User's response:** Approved
**Rationale:** Cursor AI users still need JSON templates — `claude mcp add` doesn't help them. Consolidate into existing `docs/mcp-clients.md` for single source of truth. Keeps repo root clean. `install-mcp-claude.sh` deleted outright (no backward compat).

---

## build.sh + WSL

| Option | Description | Selected |
|--------|-------------|----------|
| D1. build.sh still auto-registers | Calls `npm run register-mcp` at end. Preserves `./build.sh → done`. | ✓ |
| D2. build.sh only builds | Print next-step hint; user runs register-mcp separately. | |
| D3. Auto-register, skip on WSL | Detect WSL + warn, don't try cross-host magic. | partial |

**Claude's pick:** D1 + WSL scoped out
**User's response:** Approved
**Rationale:** Preserve README quick-start promise. `claude mcp add` idempotent — re-running on rebuild is safe. Fail-soft if `claude` CLI missing (print hint, exit 0, don't break build).

**WSL sub-decision:** WSL→Windows-Claude-Code case is inherently user-specific (distro name varies, node-path vs wsl-path confusion). Auto-detection attempted in D3 would be fragile. Decision: scope out. Document manually in `docs/mcp-clients.md` Cross-host section using content from existing `mcp.json.linux` template before that template is deleted.

---

## Requirement Refactor (raised by user)

**User's observation:** "we might be trying to do an impossible task of complete automation of the installation and need to refactor our designs and requirements"

**Claude's audit:**
- ZERO-01 (`.mcp.json` auto-discovery): Achievable but only for *working on FS itself*, not for *using FS in arbitrary projects*.
- ZERO-02 (auto-registration): Achievable as **one-command**, not **zero-config**. User still runs git clone + ./build.sh.
- ZERO-03 (docs): Achievable.
- Cross-platform / cross-host: Not without user-specific config.

**Proposed refactor:**
- ZERO-02 reworded: "One-command registration via `claude mcp add` CLI on same host; cross-host (WSL→Windows) documented as manual config"
- PROJECT.md Active requirement "Zero-config agent integration (MCP/broker lifecycle)" → "One-command agent registration (same-host)"

**User's response:** "i agree with your ansers, you make the best decisions you can."

**Locked:** D-00 in CONTEXT.md captures the reworded requirement + PROJECT.md line update.

---

## Claude's Discretion

- Exact wording of script hints and error messages
- README line placement/phrasing for new registration note
- Whether `scripts/register-mcp.mjs` uses a dedicated logger or plain `console.log`
- Order in which `docs/mcp-clients.md` presents clients

## Deferred Ideas

- WSL→Windows-CC auto-detection (distro detection + shim generation) — fragile, not worth complexity
- Cursor AI registration automation — no CLI equivalent exists
- FS self-registration on startup — high complexity, brittle

---

*Discussion recorded: 2026-04-21*
