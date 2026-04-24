# Phase 35: Changed-Since Tool + Watcher Integration - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 35-changed-since-tool-watcher-integration
**Mode:** `--auto` (Claude selected the recommended option for each gray area)
**Areas discussed:** since-input dispatch, git invocation safety, response envelope, unlink cascade, repository helpers, testing strategy, PERF-02 runner

---

## Since-Input Dispatch

| Option | Description | Selected |
|--------|-------------|----------|
| Regex-first (`/^[0-9a-fA-F]{7,40}$/`) → SHA, else `Date.parse` | Deterministic single-order dispatch. 7-char hex = SHA, nothing else | ✓ |
| `Date.parse` first, fall back to SHA | Ambiguous for all-digit SHAs that parse as numbers | |
| Explicit `{since, mode: 'timestamp'\|'sha'}` input | Requires caller to know mode — extra friction for LLM callers | |

**Selection:** Regex-first dispatch. Simple, one rule, covers CHG-01 exactly ("ISO-8601 timestamp or 7+ char git commit SHA").

**Rationale recorded in CONTEXT.md D-01, D-02.**

---

## Git Invocation Safety

| Option | Description | Selected |
|--------|-------------|----------|
| `execSync(string)` matching git-diff.ts | Consistent with existing codebase pattern | |
| `execFileSync('git', [args])` | Bypasses shell entirely — injection-safe by construction | ✓ |
| Library wrapper (`simple-git` etc.) | New dependency for one call — over-engineering | |

**Selection:** `execFileSync`. The SHA regex (D-01) is belt-and-suspenders; `execFileSync` is the defensive primitive. Diverging from `git-diff.ts` is justified because that function hard-codes its command with an already-validated `filePath`, whereas our SHA is user input.

**Rationale recorded in CONTEXT.md D-06.**

---

## .git Existence Check Order

| Option | Description | Selected |
|--------|-------------|----------|
| Check `.git` BEFORE shelling out | Gives precise `NOT_GIT_REPO` without subprocess cost | ✓ |
| Rely on git's own error | Single code path but leaks stderr, conflates two error modes | |

**Selection:** Existence check first. Keeps `NOT_GIT_REPO` and `INVALID_SINCE` semantically distinct (CHG-04 requires both).

**Rationale recorded in CONTEXT.md D-05.**

---

## Response Envelope

| Option | Description | Selected |
|--------|-------------|----------|
| `{items, total, truncated?: true}` — match find_symbol / list_files | Single envelope convention across v1.6 tools | ✓ |
| Bare array `[{path, mtime}]` | Inconsistent with other v1.6 tools; loses `total` signal | |
| `{items, cursor?}` cursor-based pagination | Over-engineering for current scale; no v1.6 tool paginates | |

**Selection:** Standard envelope (D-14). Consistency with find_symbol, find_important_files, list_files.

---

## mtime Comparison Semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Strict `>` (mtime > since) | Excludes exact-match; "changed since" literal reading | ✓ |
| Inclusive `>=` | Includes files last-written at exactly `since` | |

**Selection:** Strict `>`. "Since" means "after" in practice. Rationale in D-13.

---

## NULL mtime / Directory Row Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Exclude in SQL (`mtime IS NOT NULL AND is_directory = 0`) | One filter, SQL planner handles it, cheaper | ✓ |
| Include + post-filter in JS | More code; same result | |
| Include NULL as "unknown, assume stale" | Surfaces noise on every call; misuses the NULL semantic | |

**Selection:** SQL-level exclusion (D-12).

---

## maxItems Default + Clamp

| Option | Description | Selected |
|--------|-------------|----------|
| Default 50, clamp [1, 500] | Matches find_symbol D-04 exactly | ✓ |
| Default 100, clamp [1, 1000] | Larger but inconsistent with phase 34 precedent | |
| No clamp | Risk of dumping 10K+ rows into context | |

**Selection:** Match phase 34 (D-17).

---

## Unlink Cascade Implementation (WTC-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Extend `deleteFile()` with transactional DELETE from symbols | One code path; integrity sweep + watcher both benefit automatically | ✓ |
| Call `deleteSymbolsForFile` from `removeFileNode` | Two call sites (removeFileNode + future ones) drift risk | |
| Add ON DELETE CASCADE FK in schema | Additive-only migration policy discourages FKs; migration overhead | |

**Selection:** Cascade inside `deleteFile`. Rationale in D-27, D-28. Matches user pref "one code path, no legacy support".

---

## Repository Helpers

| Option | Description | Selected |
|--------|-------------|----------|
| `getFilesChangedSince(ms)` + `getFilesByPaths(paths[])` — raw SQL | Symmetric with phase-33 helpers (`getSymbolsByName`, `getSymbolsForFile`) | ✓ |
| Reuse `getAllFiles()` + in-memory filter | Simple but scans full table on every call | |
| Drizzle `db.select().where(inArray(...))` | Works but inconsistent with phase 33 raw-sql read pattern | |

**Selection:** New raw-SQL helpers (D-24, D-25).

---

## PERF-02 Runner

| Option | Description | Selected |
|--------|-------------|----------|
| Re-run `npm run bench-scan` at phase end, copy to `bench-end.json` | Reuses existing script; no code change | ✓ |
| Extend `bench-scan.mjs` with `--out` flag | Script change for one usage; YAGNI for v1.6 | |
| Build a new `bench-compare.mjs` | Extra machinery not required by PERF-02 spec | |

**Selection:** Reuse existing script, copy output (D-32). Script change deferred as Claude's discretion if planner prefers.

---

## Testing Surface

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated files per concern (`list-changed-since`, `watcher-symbol-lifecycle`, `repository.changed-since`) + extensions to schema-coercion + tool-outputs | Clear separation; easy to find in failure reports | ✓ |
| One big `phase-35.test.ts` | Less discoverable; mixes concerns | |
| Only extend existing test files | Phase 35 test volume justifies dedicated files | |

**Selection:** Multi-file (D-35 through D-40).

---

## Claude's Discretion (captured, not locked)

- since-dispatcher placement: inline handler vs small helper
- Test file split granularity (lifecycle vs per-event)
- bench-scan output copy mechanism (shell `cp` vs script flag)
- Drizzle `inArray` vs raw IN for `getFilesByPaths`
- Batch chunk size 100–900 for path IN queries
- Exact tool-description prose (facts in D-22 are mandatory; wording is free)

## Deferred Ideas

All deferred ideas recorded in CONTEXT.md `<deferred>` section. Key items: tombstones (CHG-05 explicit), partial SHA resolution, fuzzy timestamps, path-prefix filtering, CI regression gate, Python/Go/Ruby watcher support, Nexus UI surface.
