---
phase: 33-symbol-extraction-foundation
plan: 01
subsystem: infra
tags: [benchmarking, performance-baseline, esm-cli, tree-sitter, fixture]

# Dependency graph
requires:
  - phase: 32-zero-config-auto-registration
    provides: stable v1.5 MCP surface that scan pipeline currently serves without symbol extraction
provides:
  - tests/fixtures/medium-repo/ — deterministic 100-file TS fixture for repeatable scan benchmarks
  - scripts/bench-scan.mjs — ESM CLI that times coordinator.init() and writes baseline.json
  - .planning/phases/33-symbol-extraction-foundation/baseline.json — pre-implementation PERF-01 reference
  - bench-scan npm script — reusable entry point for PERF-02 regression check in Phase 35
affects: [33-02, 33-03, 33-04, 33-05, 35-changed-since-and-watcher-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ESM .mjs scripts matching scripts/register-mcp.mjs convention (fileURLToPath + __filename + REPO_ROOT)"
    - "Dynamic import from dist/ so bench tooling does not need ts-node or compile-on-the-fly"
    - "Isolated tmp CWD per scan so per-project .filescope/data.db does not collide between runs"
    - "Baseline JSON keyed to git commit SHA so future regression checks can verify the comparison anchor"

key-files:
  created:
    - scripts/bench-scan.mjs
    - tests/fixtures/medium-repo/package.json
    - tests/fixtures/medium-repo/README.md
    - tests/fixtures/medium-repo/src/{users,products,orders,payments,auth,db,api,utils,components,hooks}/*.ts (100 files)
    - .planning/phases/33-symbol-extraction-foundation/baseline.json
  modified:
    - package.json (added "bench-scan" script entry between start and register-mcp)

key-decisions:
  - "Synthetic fixture committed rather than generated at bench time — deterministic file_counts make cross-run comparisons meaningful"
  - "Fixture filename variants (base, -api, -store, -utils, -types, -helpers, -validator, -mapper, -service, -test) give 10 files per domain without code duplication between them"
  - "Named test file -test.ts (not *.test.ts) so vitest does NOT pick up fixture files as test suites"
  - "bench-scan calls process.exit(0) after write — ServerCoordinator has no public shutdown API and FileWatcher keeps the event loop alive indefinitely; explicit exit is the only deterministic termination path for CI"
  - "Phase-33 planning context files (33-01-PLAN, 33-CONTEXT, 33-RESEARCH, 33-PATTERNS, 33-DISCUSSION-LOG) force-added past .gitignore in the same commit as baseline.json — they travel together as the referenceable record"

patterns-established:
  - "bench-scan CLI: time coordinator.init() twice (self + fixture), emit JSON baseline — reusable for every future perf-budget phase"
  - "Per-scan isolated tmp CWD — chdir + mkdtemp + guaranteed finally rm so scans never share on-disk state"
  - "Baseline commit lands BEFORE implementation in the wave ordering — commit_sha in baseline.json points to pre-change HEAD, making the regression comparison falsifiable"

requirements-completed: [PERF-01]

# Metrics
duration: 11min 27s
completed: 2026-04-23
---

# Phase 33 Plan 01: Pre-Implementation Scan Baseline Summary

**PERF-01 baseline captured: self-scan 1833ms (437 files) and 100-file synthetic medium-repo 332ms on commit 860fe61 before any Phase 33 symbol code lands — plus a reusable `npm run bench-scan` CLI that Phase 35 re-runs for the 25% regression budget check.**

## Performance

- **Duration:** 11 min 27 s
- **Started:** 2026-04-23T13:40:38Z
- **Completed:** 2026-04-23T13:52:05Z
- **Tasks:** 3
- **Files created:** 103 (100 fixture .ts + fixture package.json + fixture README.md + scripts/bench-scan.mjs + baseline.json — 104 counting the 5 planning docs force-added)
- **Files modified:** 1 (package.json — single new scripts entry)

## Accomplishments

- **Synthetic medium-repo fixture** (100 .ts files across 10 domains, deterministic content, zero external package imports, DAG-shaped cross-domain relative imports) — committed as a static asset so bench-scan never regenerates it
- **`scripts/bench-scan.mjs`** — ESM CLI that:
  - Guards for `dist/` presence and fixture presence
  - Times `coordinator.init()` for the FileScopeMCP repo itself AND the medium-repo fixture
  - Runs each scan under an isolated `mkdtempSync` CWD so `.filescope/data.db` never collides
  - Extracts `git rev-parse --short HEAD` so the baseline is anchored to a verifiable commit
  - Exits `0` after writing — prevents the coordinator's FileWatcher from keeping the event loop alive
- **`baseline.json` captured and committed** at commit `860fe61` (the commit _immediately before_ this plan's final baseline commit and before ANY Phase 33 symbol-code work) — this is the anchor for Phase 35 PERF-02's 15%/25% regression budget

## Task Commits

Each task was committed atomically:

1. **Task 1: Create synthetic medium-repo fixture** — `2f57418` (feat)
   - 102 files created (100 .ts + fixture package.json + fixture README.md)
   - Generator script (throwaway in /tmp) used to produce deterministic content; only the generated files are committed
2. **Task 2: Create scripts/bench-scan.mjs + add bench-scan npm script** — `860fe61` (feat)
   - scripts/bench-scan.mjs and `"bench-scan"` entry inside package.json scripts block
3. **Task 3: Build, run bench-scan, commit baseline.json in isolation** — `7386395` (perf)
   - `npm install` (466 packages, no new deps added — install-only) + `npm run build` (clean) + `npm run bench-scan`
   - baseline.json written on first successful run; NOT re-run after that (per plan directive)
   - Also force-added phase planning docs (plan, context, research, patterns, discussion-log) past `.gitignore`
   - Rule-2 fix to bench-scan.mjs (process.exit(0) after write — see Deviations)

## Files Created/Modified

### Created

- `tests/fixtures/medium-repo/package.json` — fixture package manifest (`"name": "medium-repo-fixture"`, `"type": "module"`, `"private": true`)
- `tests/fixtures/medium-repo/README.md` — one-paragraph description referring back to bench-scan.mjs
- `tests/fixtures/medium-repo/src/{users,products,orders,payments,auth,db,api,utils,components,hooks}/{domain}[-api|-store|-utils|-types|-helpers|-validator|-mapper|-service|-test].ts` — 100 files, each with 9 top-level declarations (type alias, interface, enum, function, class×2, const×3) + 0-2 relative-path imports
- `scripts/bench-scan.mjs` — the benchmark CLI (84 lines, ESM, no new dependencies)
- `.planning/phases/33-symbol-extraction-foundation/baseline.json` — captured baseline
- `.planning/phases/33-symbol-extraction-foundation/{33-01-PLAN.md, 33-CONTEXT.md, 33-RESEARCH.md, 33-PATTERNS.md, 33-DISCUSSION-LOG.md}` — planning docs force-added via `git add -f` past the `.planning/` `.gitignore` entry

### Modified

- `package.json` — added one line inside the scripts block: `"bench-scan": "node scripts/bench-scan.mjs",` between `"start"` and `"register-mcp"` (no other changes)

## Captured Baseline Values

From `.planning/phases/33-symbol-extraction-foundation/baseline.json`:

| Metric | Value |
|---|---|
| captured_at | 2026-04-23T13:44:28.551Z |
| self_scan_ms | 1833 |
| medium_repo_scan_ms | 332 |
| file_counts.self | 437 |
| file_counts.medium_repo | 102 |
| node_version | v22.21.1 |
| commit_sha | `860fe61` |

### Hardware / Environment Context

- **Host:** WSL2 Ubuntu on Windows (per project convention: llama-server runs on Windows, FileScopeMCP in WSL2)
- **Kernel:** Linux 6.6.87.2-microsoft-standard-WSL2
- **Node:** v22.21.1
- **Platform:** linux x64
- **Shell:** bash
- **Notes:** Scans ran sequentially; medium_repo_scan_ms was measured after the self-scan (so language-config, tree-sitter grammar, and drizzle module caches are already warm by the time the fixture scan starts — this is the intended measurement because downstream Phase 35 regression checks will exhibit the same warm-cache ordering).

### Baseline vs Commit SHA Semantics

`commit_sha` in the baseline is `860fe61` — the commit of **Task 2 (bench-scan CLI added)**, captured at the moment bench-scan ran. This is ONE commit before the Task 3 commit (`7386395`) that writes the baseline.json itself, and exactly the pre-symbol-code HEAD that Phase 35 regression budgets refer to. Subsequent Phase 33 plans (33-02..33-05) will land NEW commits after `860fe61`; any of those commits can be compared to the baseline by re-running `npm run bench-scan` and reading the new `self_scan_ms` / `medium_repo_scan_ms` off a fresh run.

## Decisions Made

- **Synthetic fixture over borrowed repo** — no existing vitest fixture matched the ~100 TS/JS file target, and relying on an external repo would make the baseline non-reproducible across clones. A committed generator-produced fixture is the only way to make `file_counts.medium_repo` deterministic. (Decision per plan's D-19 deferral to planner/executor.)
- **10 filename variants per domain** (base, -api, -store, -utils, -types, -helpers, -validator, -mapper, -service, -test) — gives 10 files per domain × 10 domains = 100 files exactly, with every filename being a realistic TS module name.
- **`-test.ts` not `*.test.ts`** — naming the test variant `user-test.ts` (not `user.test.ts`) prevents vitest from discovering fixture files as test suites. Important: this fixture is a fixture, not a tested fixture.
- **Cross-domain imports form a DAG** (users→db,utils; orders→users,products; payments→orders,auth; etc.) — gives realistic edge extraction pressure without cycles that would skew scan time.
- **`process.exit(0)` after baseline write** — this was a Rule 2 auto-fix. See Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] bench-scan.mjs process termination**

- **Found during:** Task 3 (first successful bench-scan run)
- **Issue:** `coordinator.init()` starts a chokidar FileWatcher that keeps the Node event loop alive indefinitely. After writing `baseline.json`, the script wrote the file (verified), but the `node scripts/bench-scan.mjs` process never exited. An orphan `node scripts/bench-scan.mjs` process was visible in `ps aux` and was manually killed to continue. In CI or in Phase 35's automated regression check this would hang the build.
- **Fix:** Added `process.exit(0)` as the last statement in `scripts/bench-scan.mjs`, immediately after `console.error('[bench-scan] baseline written to ...')`. Added a 4-line comment explaining that ServerCoordinator has no public shutdown API yet and this is the deterministic termination path.
- **Files modified:** `scripts/bench-scan.mjs`
- **Verification:** The baseline was already captured on the PRIOR invocation, so the fix was added AFTER the successful baseline write and did NOT require a re-run (per plan's "Do NOT run bench-scan again" instruction). The fix lands in the same commit as the baseline (`7386395`), which is the intended ordering: Phase 35 users running `npm run bench-scan` will terminate cleanly.
- **Committed in:** `7386395` (part of Task 3 commit — deviation squashed with baseline to keep src/ out of the commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical — CI deterministic termination)
**Impact on plan:** Deviation is strictly additive to the bench-scan.mjs tail; no plan behavior changed. The baseline values in baseline.json are AUTHORITATIVE because they were captured on the prior invocation before the fix landed — the fix makes the script a reliable CI tool without invalidating the baseline it produced. No scope creep.

## Issues Encountered

- **Worktree base mismatch on startup** — the worktree was spawned with base `a36b54d0` but the orchestrator-supplied expected base was `c7f76515`. Executed the prescribed `git reset --hard c7f76515` from `<worktree_branch_check>`; HEAD was corrected before any other operation. No data lost — the worktree branch had no meaningful commits on `a36b54d0` besides the base itself.
- **`.planning/phases/` absent from the worktree at start** — the main repo has the Phase 33 planning docs under `.planning/phases/33-symbol-extraction-foundation/` but those files were untracked (the parent `.planning/` is gitignored and the phase dir had not been force-added in the base commit). Copied the planning docs from the main repo into the worktree before starting Task 1 so the plan file could be referenced during execution. Force-added the five planning docs in the Task 3 commit so the baseline and the plan that produced it travel together when the orchestrator merges the worktree back.
- **`node_modules` missing** — worktree didn't have npm install run in it yet. `npm install` was run once in Task 3; it added 466 packages, no new dependencies beyond what `package.json` already specified. No `package-lock.json` churn committed (lock file already tracked in `git ls-files`; the install did not mutate it meaningfully for our purposes).

## User Setup Required

None — no external service configuration required. `npm run bench-scan` is a local-only benchmark that requires only `npm install && npm run build` to be runnable.

## Next Phase Readiness

- **Ready for 33-02 (schema + repo functions):** baseline.json exists and is anchored to commit `860fe61`. Any code change after this point can be compared via `npm run bench-scan`.
- **Ready for Phase 35 PERF-02 regression check:** the same `scripts/bench-scan.mjs` re-run at end-of-milestone produces comparable numbers; the 25% hard-fail budget is well-defined against the captured values.
- **No blockers.**

## Self-Check: PASSED

Verified items:
- `scripts/bench-scan.mjs` exists: FOUND
- `tests/fixtures/medium-repo/package.json` exists: FOUND
- `tests/fixtures/medium-repo/README.md` exists: FOUND
- 100 .ts files under `tests/fixtures/medium-repo/`: FOUND (count = 100)
- `.planning/phases/33-symbol-extraction-foundation/baseline.json` exists and is valid JSON with all required keys: FOUND
- `package.json` contains `"bench-scan":`: FOUND (exactly 1)
- Commit `2f57418` (Task 1): FOUND
- Commit `860fe61` (Task 2): FOUND
- Commit `7386395` (Task 3): FOUND
- No `src/*.ts` file appears in any of this plan's commits: CONFIRMED (checked via `git show --name-only --format="" $c | grep '^src/'` for each commit — all empty)

---
*Phase: 33-symbol-extraction-foundation*
*Completed: 2026-04-23*
