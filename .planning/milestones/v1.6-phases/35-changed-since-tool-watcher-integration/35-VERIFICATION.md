---
phase: 35-changed-since-tool-watcher-integration
verified: 2026-04-24T02:45:00Z
verified_retroactively: true
status: passed
score: 9/9 requirements verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
---

# Phase 35: Changed-Since Tool + Watcher Integration Verification Report (Retroactive)

**Phase Goal:** Agents re-orient after multi-edit runs with one MCP call; watcher re-extracts symbols on file change via the existing single-pass AST walk, keeping `symbols` as fresh as `file_dependencies`.

**Verified:** 2026-04-24T02:45:00Z (retroactively, at v1.6 milestone close)
**Status:** passed
**Re-verification:** No — initial verification

**Note:** This verification was generated retroactively at milestone close. The phase completed without a `/gsd-verify-work` run; all 9 REQ-IDs are verified via test files, code inspection, and cross-reference from the v1.6 milestone audit (`.planning/milestones/v1.6-MILESTONE-AUDIT.md`).

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `list_changed_since(timestamp)` returns `[{path, mtime}]` for files whose mtime > timestamp; ISO-8601 accepted | VERIFIED | `src/mcp-server.ts:385+` — handler parses ISO-8601 via `Date.parse`, calls `getFilesChangedSince(mtimeMs)` at `repository.ts:1174-1181`. `tests/unit/list-changed-since.test.ts` — 21 it-blocks cover ISO input + response shape. |
| 2 | `list_changed_since(sha)` runs `git diff --name-only <sha> HEAD` and intersects with DB | VERIFIED | Handler dispatches on 7+ char hex regex → `execFileSync('git', ['diff', '--name-only', sha, 'HEAD'])`; intersection via `getFilesByPaths(paths[])` at `repository.ts`. Tests cover SHA mode end-to-end. |
| 3 | Invalid `since` returns `INVALID_SINCE`; SHA mode without `.git` returns `NOT_GIT_REPO` | VERIFIED | `ErrorCode` union extended with `INVALID_SINCE | NOT_GIT_REPO` in `src/mcp-server.ts`; `NOT_INITIALIZED` preserved. `schema-coercion.test.ts` + `tool-outputs.test.ts` lock error-code set. |
| 4 | Tool response lists only files currently present in DB — no deletion tombstones | VERIFIED | Both mtime and SHA paths filter via DB intersection (`getFilesByPaths`); deletion tombstones explicitly out-of-scope (CHG-05). `repository.changed-since.test.ts` — 10 it-blocks assert intersection behavior. |
| 5 | FileWatcher change events re-extract symbols alongside edges — no separate timer | VERIFIED | `file-utils.ts:984` (change) + `:1104` (add) invoke `setEdgesAndSymbols` via the single-pass walk; `tests/unit/watcher-symbol-lifecycle.test.ts` — regression guard on throttle + single-pass invariant. |
| 6 | FileWatcher unlink events invoke `deleteSymbolsForFile(path)` so orphaned symbols never linger | VERIFIED | `deleteFile()` at `repository.ts:170` — transactional three-DELETE (file_dependencies, symbols, files) inside `sqlite.transaction()`. `watcher-symbol-lifecycle.test.ts` — paranoid `SELECT COUNT(*)` guard post-unlink. |
| 7 | End-of-milestone scan wall-time regression < 15% vs Phase 33 baseline; hard-fail at 25% | VERIFIED | `bench-end.json` (commit 2e31738) vs `baseline.json` (commit 860fe61): self-scan +13.75% (1833→2085ms, 437→460 files), medium-repo +9.64% (332→364ms, 102→102 files). Both axes within <15% soft threshold. |

### Required Artifacts

| Artifact | Expected | Status |
|----------|----------|--------|
| `src/db/repository.ts` | `getFilesChangedSince`, `getFilesByPaths`, extended `deleteFile` transaction | VERIFIED |
| `src/mcp-server.ts` | `list_changed_since` registration + dispatch + extended ErrorCode union | VERIFIED |
| `src/file-utils.ts` | Watcher unlink → symbols cascade; change/add → single-pass re-extract | VERIFIED |
| `src/db/repository.changed-since.test.ts` | 10 it-blocks | VERIFIED |
| `tests/unit/list-changed-since.test.ts` | 21 it-blocks (ISO + SHA + error + clamp + empty) | VERIFIED |
| `tests/unit/watcher-symbol-lifecycle.test.ts` | Regression guard | VERIFIED |
| `.planning/phases/35-.../bench-end.json` | PERF-02 end capture | VERIFIED |

### Requirements Coverage

| REQ-ID | Description | Status | Evidence |
|--------|-------------|--------|----------|
| CHG-01 | `list_changed_since` MCP tool | SATISFIED | 15th registered tool at mcp-server.ts:385; dual-mode dispatch (SHA regex → git diff, else Date.parse) |
| CHG-02 | `{path, mtime}` response | SATISFIED | `getFilesChangedSince(mtimeMs)` at repository.ts:1174-1181 — reads files.mtime, ORDER BY mtime DESC |
| CHG-03 | Git-SHA mode | SATISFIED | `execFileSync('git', ['diff', '--name-only', sha, 'HEAD'])` + `getFilesByPaths` intersection |
| CHG-04 | Error codes (NOT_INITIALIZED, INVALID_SINCE, NOT_GIT_REPO) | SATISFIED | ErrorCode union extended; schema-coercion test locks coercion; tool-outputs test locks registry |
| CHG-05 | No deletion tracking | SATISFIED | Intersection with DB inherently drops deleted files; no tombstone table |
| WTC-01 | Watcher single-pass symbol re-extract | SATISFIED | file-utils.ts:984 change + :1104 add → setEdgesAndSymbols; no separate symbol watcher |
| WTC-02 | Watcher unlink cleanup | SATISFIED | deleteFile() transactional cascade at repository.ts:170; watcher-symbol-lifecycle.test.ts COUNT(*) guard |
| WTC-03 | Reuse mtime staleness model | SATISFIED | No separate symbol-freshness column; PRAGMA table_info test asserts absence |
| PERF-02 | Wall-time regression budget <15% | SATISFIED | bench-end +13.75% self-scan / +9.64% medium-repo vs baseline — both axes within soft threshold |

**Score:** 9/9 satisfied.

### Performance Gate (PERF-02)

| Metric | Baseline (860fe61) | End (2e31738) | Delta | Verdict |
|--------|--------------------|----------------|-------|---------|
| self_scan_ms | 1833 (437 files) | 2085 (460 files) | +13.75% | within <15% soft threshold |
| medium_repo_scan_ms | 332 (102 files) | 364 (102 files) | +9.64% | within <15% soft threshold |

Both axes under soft threshold; far below 25% hard-fail. Symbol extraction integrates into scan path without material regression.

### Anti-Patterns Found

None. Three-DELETE is wrapped in a single `sqlite.transaction()` closure; no partial-state leak.

### Gaps Summary

No gaps. All 9 REQ-IDs satisfied. Milestone v1.6 goal fully achieved — three daily-use LLM queries (find_symbol, enriched get_file_summary, list_changed_since) all wired end-to-end with symbol extraction driven by single-pass AST walks.

---

*Verified: 2026-04-24T02:45:00Z (retroactive)*
*Verifier: Claude (gsd-complete-milestone, retroactive reconciliation)*
*Primary source: .planning/milestones/v1.6-MILESTONE-AUDIT.md*
