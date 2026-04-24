# Phase 35-02 — list_changed_since MCP tool + input coercion + contract lock

**Completed:** 2026-04-23
**Requirements:** CHG-01, CHG-02, CHG-03, CHG-04, CHG-05

## Tasks completed

| # | Task | Status |
|---|------|--------|
| 1 | Extend `ErrorCode` union, register `list_changed_since` in `src/mcp-server.ts` with dual-mode handler (SHA regex → `execFileSync git diff`; else `Date.parse`) | Done |
| 2 | New `tests/unit/list-changed-since.test.ts` + schema-coercion + tool-outputs lock | Done |

## Files modified

- `src/mcp-server.ts` — +2 imports (`execFileSync`, `fsSync`, `canonicalizePath`), +2 repository helpers, ErrorCode union extended with `INVALID_SINCE | NOT_GIT_REPO`, new `list_changed_since` registration (description as `string[].join(' ')`, 8-sentence coverage of D-22 points).
- `tests/unit/list-changed-since.test.ts` — NEW, 21 tests across timestamp mode, SHA mode (injected git runner), dispatch boundary, envelope + clamp, NOT_INITIALIZED gate.
- `tests/unit/schema-coercion.test.ts` — +1 test locking `since: z.string().min(1)` and `maxItems: z.coerce.number().int()`.
- `tests/unit/tool-outputs.test.ts` — +1 describe block (5 tests) + registry count updated 14 → 15.

## Commits

- `d713c3f` — feat(35-02): register list_changed_since MCP tool + input coercion + contract lock

## Acceptance criteria

- [x] `list_changed_since` registered with `string[].join(' ')` description, `z.string().min(1)` for `since`, `z.coerce.number().int()` for `maxItems`
- [x] `ErrorCode` union contains `INVALID_SINCE` and `NOT_GIT_REPO`
- [x] Handler dispatch uses `^[0-9a-fA-F]{7,40}$` regex first, `Date.parse` fallback
- [x] SHA mode uses `execFileSync('git', [...])` not `execSync(string)`
- [x] `.git` existence checked via `fsSync.existsSync` before git shell-out
- [x] Response envelope `{items, total, truncated?}` matches find_symbol contract
- [x] Git output paths canonicalized via `canonicalizePath(path.resolve(projectRoot, p))`
- [x] `mtime` null → 0 coercion in response (SHA mode)
- [x] `maxItems` default 50, clamp [1, 500]
- [x] All 58 new tests pass (21 + 1 + 5 + existing full suite: 712 passing, 7 skipped)

## Deviations

None. Plan executed as specified. Partial handler work from rate-limited worktree (agent-ad4f7741) was recovered and completed inline by orchestrator after the rate-limit reset.
