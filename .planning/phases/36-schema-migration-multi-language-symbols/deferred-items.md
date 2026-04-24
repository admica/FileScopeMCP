# Phase 36 — Deferred Items

Issues discovered during execution but out-of-scope for the current plan's
`files_modified` list. These are tracked for follow-up (next plan, next phase,
or triage).

## From plan 36-02 execution (2026-04-24)

### file-utils.ts `analyzeNewFile` dispatch parity

**Where:** `src/file-utils.ts:831-875` (`analyzeNewFile`)
**What:** Calls `extractTsJsFileParse` but has no sibling `extractLangFileParse`
branch. The watcher change-handler path (chokidar file-added / file-changed
events flow through `analyzeNewFile` via file-watcher handlers) still routes
`.py`/`.go`/`.rb` files through `extractEdges()` only — symbols are NOT
populated for newly-added or modified Python/Go/Ruby files on the watcher path.

**Why deferred:**
- Plan 36-02 `files_modified` lists only `src/language-config.ts`,
  `src/coordinator.ts`, `src/mcp-server.ts` + the three test files.
- `src/file-utils.ts` is explicitly NOT in scope — extending it would be
  out-of-bounds per the executor scope-boundary rule.
- Plan 36-02 Task 2 action 2(c) says "Scan the rest of `src/coordinator.ts`"
  (scoped to coordinator), with a parenthetical "(change-handler path, re-extract
  path)" that describes types of sites rather than expanding the scan scope.
- Plan 36-03 bulk-backfill covers ALREADY-INDEXED `.py`/`.go`/`.rb` files via
  the `kv_state` gated pass, so existing files are covered separately.

**Impact:**
- NEW Python/Go/Ruby files added while the MCP server is running (after the
  bulk backfill pass has already set its gates) will NOT get symbols indexed
  until the next full scan / server restart.
- EDITED existing Python/Go/Ruby files trigger `analyzeNewFile` on the watcher
  path — symbol rows for those files will not refresh.

**Recommended fix:** Add a sibling `isPyGoRb` branch to `analyzeNewFile` that
mirrors the coordinator pass-2 dispatch. One-line change similar to the
coordinator.ts edit in 36-02. Candidate for plan 36-03 or a dedicated plan.

**Severity:** Medium — doesn't block 36-02's core goal (scan-path symbols for
Py/Go/Rb work), but leaves the watcher path partially unwired for new languages.
