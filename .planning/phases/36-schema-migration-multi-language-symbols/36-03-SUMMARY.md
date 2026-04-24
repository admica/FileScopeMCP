---
phase: 36-schema-migration-multi-language-symbols
plan: 03
subsystem: migration + test-infrastructure
tags: [bulk-backfill, kv-state, multi-language, symbols, grep-source-test, single-pass-invariant, pitfall-17, verification-gate]

# Dependency graph
requires:
  - "36-02 (extractLangFileParse exported, three-way coordinator dispatch, Py/Go/Rb symbol extractors)"
  - "36-01 (migration 0006 + SymbolKind += module/struct + tree-sitter-go/ruby installed)"
provides:
  - "runMultilangSymbolsBulkExtractionIfNeeded — three-sub-pass Py/Go/Rb backfill (MLS-05)"
  - "Three fresh kv_state gates: symbols_py_bulk_extracted, symbols_go_bulk_extracted, symbols_rb_bulk_extracted"
  - "Pitfall-17 guard: new backfill does NOT short-circuit on pre-existing v1.6 symbols_bulk_extracted"
  - "Permanent single-pass-invariant grep-source regression test (D-31/D-32)"
  - "Phase 36 VERIFICATION.md — exit gate with per-REQUIREMENT test citations (D-35)"
affects: [37-tsjs-call-site-edges, 38-find-callers-callees]

# Tech tracking
tech-stack:
  added: []   # No new deps — grammars already installed in 36-01, extractors already landed in 36-02.
  patterns:
    - "Three-sub-pass bulk backfill via LANGS table; one runSubPass helper invoked per language"
    - "Per-language kv_state gates — NEVER reuse v1.6 single-key gate (Pitfall 17 / D-28b)"
    - "Gate write AFTER each language loop finishes (D-28 — crash-safe idempotent retry)"
    - "Per-file try/catch inside loop — one bad file never aborts its language's pass (D-27)"
    - "Three-arg setEdgesAndSymbols for Py/Go/Rb (no importMeta per D-05)"
    - "Static source-read regex test with lexical-context-aware brace-walker (D-31/D-32)"
    - "VERIFICATION.md cites literal it() strings grepped from test files (D-35)"

key-files:
  created:
    - "src/migrate/bulk-multilang-symbol-extract.ts (84 lines — three-sub-pass bulk backfill)"
    - "src/migrate/bulk-multilang-symbol-extract.test.ts (147 lines — 7 integration tests)"
    - "src/change-detector/single-pass-invariant.test.ts (137 lines — permanent grep-source regression test)"
    - ".planning/phases/36-schema-migration-multi-language-symbols/36-VERIFICATION.md (77 lines — phase exit gate)"
  modified:
    - "src/coordinator.ts (+12 lines — import + try/catch block after v1.6 bulk, before buildFileTree)"
    - "package.json (+37 chars — added src/migrate/bulk-multilang-symbol-extract.ts to esbuild entry list)"

decisions:
  - "Build entry list fix: Added src/migrate/bulk-multilang-symbol-extract.ts to esbuild script in package.json (Rule 3 blocking — without this, dist/migrate/bulk-multilang-symbol-extract.js never ships and coordinator.init() crashes at startup; caught by tests/integration/mcp-stdout.test.ts timing out at 12s)"
  - "Brace-walker upgrade: Upgraded the single-pass-invariant test's brace-walker from naive `{`/`}` counting to a lexical-context-aware walker that skips strings / template literals / regex literals / line comments / block comments. Without this, extractSignature's `indexOf('{')` string literal unbalanced the counter and swept in the entire rest of the file, producing a false-positive `count=2` on a function that does zero parsing. Upgrade is sanctioned by the plan's action step 2(a)."
  - "Regex case sensitivity: Kept the literal `/parser\\.parse\\(/g` regex per D-31 verbatim. Research note 1061 claims it matches `pythonParser.parse(` — verified FALSE (regex is case-sensitive; `nParser.parse` does not match lowercase `parser.parse`). Existing extractors use the `(xxxParser as any).parse(content)` form which doesn't match; the regression pattern we actually catch is someone writing `const parser = getParser(); parser.parse(x); parser.parse(y);` inside an extractor body — verified via negative-check (injected second `parser.parse(source)` into extractRicherEdges; test failed as expected)."
  - "Sanity floor added to grep test: `expect(extractors.length).toBeGreaterThan(0)` per source file. Catches the regression where a future refactor breaks the FN_HEADER_RE or brace-walker, silently making the assertion vacuous."
  - "Restored locked baseline v1.7-baseline.json after running bench-scan (D-02 — baseline captured in 36-01 is the reference; running bench-scan during verification overwrites it, which is a contamination vector)."

patterns-established:
  - "Milestone bulk-backfill with N languages: LANGS table of `{ ext, flag, label }` + shared runSubPass(). Add a language by appending to LANGS — no code duplication."
  - "Static source-read regex guard for invariants: `fs.readFileSync` + regex + brace-walk asserting per-function-body properties. Zero runtime cost; permanent suite resident. Useful pattern for any invariant that is expressible as a syntactic constraint."
  - "VERIFICATION.md exit gate: per-REQUIREMENT row citing test file + describe + literal `it('...')` strings (grep-verified). Closes the traceability loop from REQUIREMENTS → tests without retroactive generation at milestone close."
  - "esbuild entry list is a source of truth for what ships in dist/. Any new module imported by the server must be added to the `build` script entry list — missing entries manifest as runtime MODULE_NOT_FOUND at server startup."

requirements-completed: [MLS-05]

# Metrics
duration: 10min 36s
completed: 2026-04-24
---

# Phase 36 Plan 03: Multi-Lang Bulk Backfill + Single-Pass Invariant Guard + VERIFICATION Gate Summary

**Shipped `runMultilangSymbolsBulkExtractionIfNeeded` as three independent Py/Go/Rb sub-passes each gated by a fresh `kv_state` key (Pitfall 17 guard), wired it into coordinator init() after v1.6 bulk and before buildFileTree, landed the permanent single-pass-invariant grep-source regression test with a lexical-context-aware brace-walker, and authored the Phase 36 VERIFICATION.md exit gate citing literal `it(...)` strings per requirement — all while catching + fixing a latent build-script bug that would have broken `dist/mcp-server.js` startup on first boot.**

## Performance

- **Duration:** 10min 36s
- **Started:** 2026-04-24T15:33:39Z
- **Completed:** 2026-04-24 (~15:44Z)
- **Tasks:** 3/3 complete
- **Files created:** 4 (1 module, 2 tests, 1 VERIFICATION.md) — 445 total lines
- **Files modified:** 2 (coordinator.ts +12 lines, package.json +1 entry)

## Accomplishments

- **Three-sub-pass bulk backfill shipped** — `src/migrate/bulk-multilang-symbol-extract.ts` (84 lines) with a `LANGS: Lang[]` table (`[.py → symbols_py_bulk_extracted, .go → symbols_go_bulk_extracted, .rb → symbols_rb_bulk_extracted]`) and a shared `runSubPass` helper. Each sub-pass is independently gated, idempotent, and survives per-file failures (Python ENOENT test proves log-and-continue works). Gate writes happen AFTER each language's loop finishes (D-28 — a crash mid-Ruby pass leaves that gate unset; Python + Go gates already written; next boot retries only Ruby). Total: 7 integration tests across 3 describe blocks, all pass in 64ms.

- **Pitfall 17 explicitly guarded** — The kv_state-key-independence describe block pre-sets `symbols_bulk_extracted` (the v1.6 key) via `setKvState`, then runs the new multilang pass, and asserts (a) Python symbols ARE populated and (b) the NEW `symbols_py_bulk_extracted` gate is set. This catches the exact failure mode that would silently skip Python/Go/Ruby backfill on every v1.6→v1.7 upgrade. Test passes; negative-check: temporarily changing the module to `const FLAG = 'symbols_bulk_extracted'` causes this test to fail (not run here; the architecture enforces three separate constants).

- **Coordinator wiring surgical** — Line 19 + line 20 imports stacked; the new try/catch at lines 287-298 (11 lines of code + comment) sits IMMEDIATELY after the existing `runSymbolsBulkExtractionIfNeeded` try/catch and BEFORE `buildFileTree(newConfig)`. grep -n of the two function names confirms line-order invariant: v1.6 at 282, multilang at 293 (strictly higher line number).

- **Permanent single-pass-invariant test lives in the suite** — `src/change-detector/single-pass-invariant.test.ts` reads `src/language-config.ts` + `src/change-detector/ast-parser.ts` via `fs.readFileSync`, iterates every top-level `extract*` function via FN_HEADER_RE + a 40-line lexical-context-aware brace-walker, counts `/parser\\.parse\\(/g` matches per body, asserts `<= 1`. 2 tests, both pass. Zero runtime instrumentation (D-32 — no `Parser.prototype.parse` wrap). Negative-check performed: injecting a second `parser.parse(source)` into `extractRicherEdges` body fails the test with the expected message `extractRicherEdges in ast-parser.ts has 2 parser.parse() calls (expected ≤ 1)`; source restored.

- **VERIFICATION.md exit gate closes Phase 36** — Every REQUIREMENTS entry in scope (PERF-03, MLS-01, MLS-02, MLS-03, MLS-04, MLS-05, CSE-01) + the milestone-level single-pass rule maps to a concrete row citing test file + describe + literal `it(...)` strings. Test names were harvested by `grep -nE "describe\\(|it\\("` against each test file to ensure they match the actual source verbatim. 22 rows total.

- **Post-phase smoke passes** — The v1.6→v1.7 upgrade simulation from the plan's verification section runs end-to-end against `dist/migrate/bulk-multilang-symbol-extract.js`: pre-set `symbols_bulk_extracted = 2026-01-01T00:00:00Z` (simulate a v1.6 repo), add one `.py` file, run the multilang pass — output confirms all three v1.7 gates set to fresh ISO timestamps while the v1.6 gate is preserved at its original value. No cross-pollination.

## Task Commits

| Hash     | Type  | Summary                                                                                       |
|----------|-------|-----------------------------------------------------------------------------------------------|
| 3d94add  | test  | Add failing integration test for bulk-multilang-symbol-extract (7 tests, RED — module absent) |
| e3af2b0  | feat  | Implement bulk-multilang-symbol-extract + coordinator wiring (GREEN — all 7 pass)             |
| 7413a0d  | feat  | Single-pass-invariant grep-source test + package.json build entry fix                          |
| 6664099  | docs  | Phase 36 VERIFICATION.md — exit gate with per-REQ test citations                               |

**TDD gate compliance (Task 1):** `test(36-03)` commit (RED) precedes `feat(36-03)` commit (GREEN) in git log. No REFACTOR needed — module is 84 lines, already minimal and table-driven.

## Files Created

### `src/migrate/bulk-multilang-symbol-extract.ts` (84 lines)

```typescript
const LANGS: Lang[] = [
  { ext: '.py', flag: 'symbols_py_bulk_extracted', label: 'python' },
  { ext: '.go', flag: 'symbols_go_bulk_extracted', label: 'go' },
  { ext: '.rb', flag: 'symbols_rb_bulk_extracted', label: 'ruby' },
];

async function runSubPass(projectRoot: string, lang: Lang): Promise<void> {
  if (getKvState(lang.flag) !== null) { log(`... ${lang.label} flag already set — skipping`); return; }
  const files = getAllFiles().filter(f => !f.isDirectory && path.extname(f.path).toLowerCase() === lang.ext);
  // ... per-file try/catch → setEdgesAndSymbols(file.path, parsed.edges, parsed.symbols) ...
  setKvState(lang.flag, new Date().toISOString());   // D-28 — AFTER loop
}

export async function runMultilangSymbolsBulkExtractionIfNeeded(projectRoot: string): Promise<void> {
  for (const lang of LANGS) await runSubPass(projectRoot, lang);
}
```

Three gate strings verified present:

```
$ grep -cE "'symbols_py_bulk_extracted'|'symbols_go_bulk_extracted'|'symbols_rb_bulk_extracted'" src/migrate/bulk-multilang-symbol-extract.ts
3
$ grep -c "'symbols_bulk_extracted'" src/migrate/bulk-multilang-symbol-extract.ts
0
```

### `src/migrate/bulk-multilang-symbol-extract.test.ts` (147 lines)

Three `describe` blocks covering first-boot populate (Py/Go/Rb), kv_state key independence (Pitfall 17), idempotency (second-boot is a no-op).

```
$ npx vitest run src/migrate/bulk-multilang-symbol-extract.test.ts
✓ runMultilangSymbolsBulkExtractionIfNeeded — first boot > populates symbols for every tracked Python file
✓ runMultilangSymbolsBulkExtractionIfNeeded — first boot > populates symbols for every tracked Go file
✓ runMultilangSymbolsBulkExtractionIfNeeded — first boot > populates symbols for every tracked Ruby file
✓ runMultilangSymbolsBulkExtractionIfNeeded — first boot > sets all three language gates after running
✓ runMultilangSymbolsBulkExtractionIfNeeded — first boot > per-file failure does not abort the Python sub-pass (D-27 log + continue)
✓ runMultilangSymbolsBulkExtractionIfNeeded — kv_state key independence > does NOT skip Python pass when v1.6 symbols_bulk_extracted flag is set
✓ runMultilangSymbolsBulkExtractionIfNeeded — second boot (idempotent) > becomes a no-op for all three languages after first run

Test Files  1 passed (1)
     Tests  7 passed (7)
   Duration  1.01s
```

### `src/change-detector/single-pass-invariant.test.ts` (137 lines)

Reads `src/language-config.ts` + `src/change-detector/ast-parser.ts`; asserts `<= 1 parser.parse(` per `extract*` body.

```
$ npx vitest run src/change-detector/single-pass-invariant.test.ts
✓ single-pass invariant — parser.parse count per extractor > language-config.ts: every extract* function has ≤ 1 parser.parse() call
✓ single-pass invariant — parser.parse count per extractor > ast-parser.ts: every extract* function has ≤ 1 parser.parse() call

Test Files  1 passed (1)
     Tests  2 passed (2)
   Duration  10ms
```

**Extractor functions checked:**

- `language-config.ts` — `extractEdges` (dispatcher, 0 parses), `extractTsJsEdges`, `extractTsJsFileParse`, `extractPythonEdges`, `extractPythonSymbols`, `extractRustEdges`, `extractCEdges`, `extractCppEdges`, `extractGoEdges`, `extractGoSymbols`, `extractRubyEdges`, `extractRubySymbols`, `extractLangFileParse` (dispatcher, 0 parses), `extractIncludeEdges` (1 parse — `parser.parse(content)` at line 465).
- `ast-parser.ts` — `extractSignature` (utility, 0 parses — false-positive resolved by brace-walker upgrade), `extractImportedNames` (0 parses, pure walk), `extractBareTopLevelSymbol` (0 parses), `extractExportedSymbol` (0 parses), `extractRicherEdges` (1 parse at line 298), `extractSnapshot` (1 parse at line 421).

All extractors have `<= 1` — invariant holds on current codebase.

### `.planning/phases/36-schema-migration-multi-language-symbols/36-VERIFICATION.md` (77 lines)

22-row traceability table mapping PERF-03, MLS-01..05, CSE-01, and the milestone single-pass rule to concrete test citations. All 8 requirement-ID markers present:

```
$ for id in PERF-03 MLS-01 MLS-02 MLS-03 MLS-04 MLS-05 CSE-01 single-pass-invariant; do
>   grep -q "$id" .planning/.../36-VERIFICATION.md && echo "FOUND: $id"
> done
FOUND: PERF-03
FOUND: MLS-01
FOUND: MLS-02
FOUND: MLS-03
FOUND: MLS-04
FOUND: MLS-05
FOUND: CSE-01
FOUND: single-pass-invariant
```

## Files Modified

### `src/coordinator.ts` (+12 lines)

Import (lines 19-20):
```typescript
import { runSymbolsBulkExtractionIfNeeded } from './migrate/bulk-symbol-extract.js';
import { runMultilangSymbolsBulkExtractionIfNeeded } from './migrate/bulk-multilang-symbol-extract.js';
```

New try/catch (lines 287-298):
```typescript
// Phase 36 MLS-05 — populate symbols for every tracked Python/Go/Ruby file on first boot.
// Three independent per-language gates (D-26); does NOT reuse v1.6 symbols_bulk_extracted
// (Pitfall 17 / D-28b). Placement: AFTER runSymbolsBulkExtractionIfNeeded (so v1.6 symbols
// are in DB first), BEFORE buildFileTree (so the tree build sees all symbols).
// Non-fatal: a failure here logs and continues; the in-memory file tree is built either way.
try {
  await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);
} catch (err) {
  log(`Bulk multilang symbol extraction failed (non-fatal): ${err}`);
}
```

Line-order verification:
```
$ grep -n "runMultilangSymbolsBulkExtractionIfNeeded\|runSymbolsBulkExtractionIfNeeded" src/coordinator.ts
19:import { runSymbolsBulkExtractionIfNeeded } from './migrate/bulk-symbol-extract.js';
20:import { runMultilangSymbolsBulkExtractionIfNeeded } from './migrate/bulk-multilang-symbol-extract.js';
282:      await runSymbolsBulkExtractionIfNeeded(projectRoot);
289:    // (Pitfall 17 / D-28b). Placement: AFTER runSymbolsBulkExtractionIfNeeded (so v1.6 symbols
293:      await runMultilangSymbolsBulkExtractionIfNeeded(projectRoot);
```

Multilang call at line 293 is strictly after v1.6 call at line 282 — line-order invariant satisfied.

### `package.json` (+37 chars in `build` script)

Before:
```
"src/migrate/json-to-sqlite.ts src/migrate/bulk-symbol-extract.ts src/cascade/cascade-engine.ts"
```

After:
```
"src/migrate/json-to-sqlite.ts src/migrate/bulk-symbol-extract.ts src/migrate/bulk-multilang-symbol-extract.ts src/cascade/cascade-engine.ts"
```

Without this, `dist/migrate/bulk-multilang-symbol-extract.js` never ships and `dist/mcp-server.js` throws `MODULE_NOT_FOUND` at coordinator startup (caught by `tests/integration/mcp-stdout.test.ts` timing out at 12s instead of the usual ~2s).

## Test Results

| Metric                                                   | Value            |
|----------------------------------------------------------|------------------|
| `npx vitest run src/migrate/bulk-multilang-symbol-extract.test.ts` | **7 / 7 passed** (1.01s) |
| `npx vitest run src/change-detector/single-pass-invariant.test.ts` | **2 / 2 passed** (392ms)  |
| `npm test` (full suite)                                  | **768 passing, 7 skipped, 0 failed** (8.34s wall) |
| `npm run build`                                          | exit 0 (~18ms esbuild) |

**Full suite growth:** 759 passing → **768 passing** (+9 tests: 7 bulk-multilang + 2 single-pass-invariant). 7 skipped (unchanged from 36-02).

## End-to-End v1.6→v1.7 Upgrade Smoke

From plan `<verification>` §4:

```
$ node -e "... runMultilangSymbolsBulkExtractionIfNeeded(proj).then(...) ..."
[bulk-multilang-symbol-extract] python: processing 1 files
[bulk-multilang-symbol-extract] python: 1 succeeded, 0 skipped
[bulk-multilang-symbol-extract] go: processing 0 files
[bulk-multilang-symbol-extract] go: 0 succeeded, 0 skipped
[bulk-multilang-symbol-extract] ruby: processing 0 files
[bulk-multilang-symbol-extract] ruby: 0 succeeded, 0 skipped
v1.6→v1.7 upgrade smoke OK
  py_gate: 2026-04-24T15:43:30.172Z
  go_gate: 2026-04-24T15:43:30.173Z
  rb_gate: 2026-04-24T15:43:30.174Z
  v1.6 gate (preserved): 2026-01-01T00:00:00Z
```

All three v1.7 gates freshly set; pre-existing v1.6 gate untouched; Python symbol row populated for the lone `a.py` file. End-to-end invariant holds.

## Bench-Scan Delta (Informational — Not a Gate)

Captured a post-36-03 bench-scan for informational comparison. **Locked baseline was backed up and restored** after the capture per D-02 (baseline is frozen at 36-01's value).

| Target       | Baseline (36-01 locked) | Post-36-03 observation    | Delta      |
|--------------|-------------------------|---------------------------|------------|
| Self-scan    | 2403ms / 490 files      | 2204ms / 503 files        | **−199ms (−8.3%)** |
| Medium-repo  | 434ms  / 102 files      | 404ms  / 102 files        | **−30ms  (−6.9%)** |

Both directions favorable / within noise. The new multilang bulk backfill runs only on first boot (gated); subsequent boots are effectively no-ops. TS/JS scan path is unchanged. Phase 36 perf envelope: well below +20%, comfortably below baseline even. Phase 37's CSE-02..06 population pass will be the perf-sensitive one.

## Decisions Made

- **Kept regex case-sensitive per D-31 verbatim:** The research note (line 1061) claims `/parser\\.parse\\(/g` matches `pythonParser.parse(` — verified FALSE. The regex is case-sensitive and `nParser.parse(` does not match lowercase `parser.parse(`. However, every Py/Go/Rb extractor uses the `(xxxParser as any).parse(content)` form which is already unmatchable regardless of regex case. The guard the test actually provides is against a contributor writing `const parser = getParser(); parser.parse(x); parser.parse(y);` inside an extractor — verified caught via negative-check. Kept D-31's literal spec; documented the actual failure mode caught.

- **Upgraded the brace-walker to lexical-context-awareness:** The naive walker mis-counted on `extractSignature` because its body contains the string literal `'{'` (line 104 of ast-parser.ts). The naive counter treated that `{` as opening depth and swept the rest of the file into a 21KB "function body", producing a false-positive `count=2`. Plan action step 2(a) explicitly sanctions this: "inspect the offending extractor and either upgrade the brace-walker or adjust the extractor to avoid brace-heavy strings". Upgraded walker tracks code / single-quote / double-quote / template-literal / regex / line-comment / block-comment contexts; template-literal `${...}` expression nesting handled via a dedicated stack. 40 lines of walker code; all tests pass; negative-check still catches regressions.

- **Added a sanity floor to the grep test:** `expect(extractors.length).toBeGreaterThan(0)` per source file. A future refactor that breaks FN_HEADER_RE or the walker could silently make the assertion vacuous (iterating over zero extractors = no expects). Sanity floor catches that silent failure.

- **Restored the locked baseline after bench-scan:** Running `scripts/bench-scan.mjs` overwrites `v1.7-baseline.json`. D-02 locks the baseline to 36-01's capture (commit a6a4676 era). After informational comparison, the file was restored byte-for-byte from a `/tmp/baseline-locked.json` backup. Verified with `git diff` (empty output).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `bulk-multilang-symbol-extract.ts` was missing from the esbuild entry list in package.json**

- **Found during:** Task 2 `npm test` run after adding the single-pass-invariant test.
- **Issue:** `npm run build` completed, but `dist/migrate/bulk-multilang-symbol-extract.js` did not exist because the esbuild `build` script in package.json lists source files explicitly and did not include the new module. Coordinator init() therefore threw `MODULE_NOT_FOUND` when importing it. Manifested as `tests/integration/mcp-stdout.test.ts` timing out at 12s (was 2.15s pre-change) because the MCP server child process crashed before writing its first stdout byte.
- **Root cause:** `package.json` build script is a literal space-separated list of .ts entrypoints. New modules must be explicitly added — esbuild does not auto-discover.
- **Fix:** Added `src/migrate/bulk-multilang-symbol-extract.ts` to the esbuild entry list (alphabetical position, next to `bulk-symbol-extract.ts`).
- **Verification:** `ls dist/migrate/` now shows `bulk-multilang-symbol-extract.js`; `tests/integration/mcp-stdout.test.ts` passes in 2.07s; full suite green (768 passing).
- **Files modified:** `package.json`.
- **Committed in:** `7413a0d` (bundled with the single-pass-invariant test commit since the test run was the discovery vector).

**2. [Rule 1 — Bug] Naive brace-walker produced false positive on `extractSignature`**

- **Found during:** Task 2 first run of `src/change-detector/single-pass-invariant.test.ts`.
- **Issue:** `extractSignature` body contains `firstLine.indexOf('{')` — a string literal `'{'`. The naive `{`/`}` counter treated that `{` as an opening brace, depth never returned to 0 within the function body, and the walker swept forward consuming the rest of `ast-parser.ts`. `parser.parse(` appears twice more later in the file (inside `extractRicherEdges` and `extractSnapshot`), so `extractSignature`'s reported body count became 2, failing the `<= 1` assertion.
- **Root cause:** Naive brace-walker doesn't track string/comment/regex context. Plan's action step 2(a) explicitly anticipates this class of false positive.
- **Fix:** Upgraded the walker to a 40-line state machine tracking 7 lexical contexts (code, single-quote, double-quote, template, regex, line-comment, block-comment) plus a template-literal expression-nesting stack. Regex-literal detection is heuristic (preceding token must be one of `=`, `(`, `,`, `:`, `;`, `!`, `&`, `|`, `?`, `{`, `}`, `[`, whitespace, or start-of-source).
- **Verification:** All extractors now report correct counts (extractSignature=0, extractRicherEdges=1, extractSnapshot=1, extractPythonSymbols=0 [uses cast form], etc.). Negative check: temporarily injected a second `parser.parse(source)` into `extractRicherEdges`; test failed with expected message `extractRicherEdges in ast-parser.ts has 2 parser.parse() calls (expected ≤ 1)`; source restored.
- **Files modified:** `src/change-detector/single-pass-invariant.test.ts` (replacing the naive walker before the first commit — no intermediate commit of the broken naive form).
- **Committed in:** `7413a0d`.

**3. [Rule 3 — Environment] Planning docs absent from worktree (carried over from 36-01/02 pattern)**

- **Found during:** Pre-execution context load.
- **Issue:** `.planning/phases/36-.../36-03-PLAN.md` + `36-CONTEXT.md` + `36-RESEARCH.md` + `36-PATTERNS.md` + `36-DISCUSSION-LOG.md` + `36-01-PLAN.md` + `36-02-PLAN.md` live only in the main repo checkout; the worktree inherits from an older commit that predates them.
- **Fix:** Copied the seven `.md` planning docs from `/home/autopcap/FileScopeMCP/.planning/phases/36-.../` into the worktree's corresponding directory. These remain untracked in the worktree (orchestrator will merge the authoritative versions at wave close).
- **Impact:** None on shipped code. Same pattern as 36-01 / 36-02.
- **Committed in:** Not committed.

**Total deviations:** 3 auto-fixed (1 Rule 1 bug, 2 Rule 3 blocking). No Rule 4 architectural decisions needed. No scope creep. All three deviations were necessary for the plan to execute at all against its own verify gates.

## Known Stubs

None. `runMultilangSymbolsBulkExtractionIfNeeded` is fully wired into the coordinator startup sequence; `extractLangFileParse` already lives in `language-config.ts` (shipped in 36-02); `setEdgesAndSymbols` already exists in `repository.ts` (shipped in 33). The three fresh kv_state keys have real code reading + writing them. The single-pass-invariant test does real work (reads source files, runs regex + walker, asserts). VERIFICATION.md cites real test names grep-verified against real source files.

## Threat Flags

None new. The threat register in the PLAN (`T-36-10..T-36-14`) all have `mitigate` dispositions; each is implemented:
- **T-36-10** (DoS — bad file aborts pass) → mitigated by per-file `try/catch` inside `runSubPass` loop, verified by `per-file failure does not abort the Python sub-pass (D-27 log + continue)` test.
- **T-36-11** (Data Integrity — gate written before loop completes) → mitigated by `setKvState(lang.flag, ...)` placed AFTER the `for (const file of files)` loop; verified by code inspection + idempotency test.
- **T-36-12** (Tampering — v1.6 gate causes skip) → mitigated by three FRESH kv_state keys (`symbols_py_bulk_extracted` / `_go_` / `_rb_`) and verified by the Pitfall-17 guard test.
- **T-36-13** (Info Disclosure — PII in error logs) → disposition `accept`; log format is `<label>: skipping <file.path>: <err>` — file path only, matches v1.6 precedent.
- **T-36-14** (DoS — crafted extract* defeats grep test) → mitigated by the lexical-context-aware brace-walker + sanity floor (`extractors.length > 0`). If a future refactor introduces brace-heavy content that the walker can't handle, the author has two escape valves: simplify the extractor, or upgrade the walker to a proper tokenizer (plan sanctions this path).

No new trust boundaries introduced by this plan.

## Issues Encountered

- **package.json build entry list discovery vector was indirect:** The missing esbuild entry manifested as an integration-test timeout rather than a build error. `npm run build` reported "Done in 18ms" with exit 0 because esbuild only bundles what you tell it to — and silently omits unmentioned files. The failure surface only when `dist/mcp-server.js` tried to import the missing module at runtime. This is a systemic risk for any future `src/**` module: there's no build-time guarantee that all server imports have corresponding dist entries. Not fixing in this plan; logged as a latent foot-gun.
- **Restored `v1.7-baseline.json` manually** after bench-scan instead of automating. A minor refactor to `scripts/bench-scan.mjs` (e.g., write to a passed-in path, default to baseline) would eliminate the D-02 contamination risk. Not scope of this plan; logged as a future hygiene item.

## User Setup Required

None — pure additive code + one-line build-entry edit + docs. No env vars, no external services, no manual configuration. `dist/` is regenerated by existing `npm run build`. The three new kv_state keys materialize on first boot after upgrade; no migration step.

## Next Phase Readiness

**Phase 37 (CSE-02..06 — TS/JS call-site edge population) can proceed:**
- `symbol_dependencies` table exists empty; Phase 37 adds write paths via atomic per-file transaction-scoped ID replacement (resolves Pitfall 7 / FLAG-02).
- v1.7 symbols are populated for existing repos (first boot after 36-03 runs the three sub-passes).
- Single-pass-invariant test will guard Phase 37's new TS/JS call-site extractor against adding a second `parser.parse` call to `extractTsJsFileParse` or `extractRicherEdges`.

**Phase 38 (MCP-01..04 — find_callers / find_callees tools) can proceed once Phase 37 lands:**
- `find_symbol` description already mentions the `module`/`struct` kinds; the new tools can reuse the kind filter surface.
- VERIFICATION.md pattern established — Phase 38 ships its own VERIFICATION.md with literal `it(...)` citations per requirement.

**v1.7 milestone is now code-complete for Phase 36's scope.** REQUIREMENTS mapping: PERF-03 ✓ CSE-01 ✓ MLS-01..05 ✓ milestone single-pass rule ✓.

## TDD Gate Compliance

Task 1 (bulk-multilang module) followed strict RED → GREEN flow:
- **RED:** `3d94add` (`test(36-03): add failing integration test for bulk-multilang-symbol-extract`) — 7 tests, all fail with `Error: Cannot find module './bulk-multilang-symbol-extract.js'`.
- **GREEN:** `e3af2b0` (`feat(36-03): implement bulk-multilang-symbol-extract + coordinator wiring`) — module shipped + coordinator wired; all 7 pass in 64ms.
- **REFACTOR:** None — 84-line module already minimal, table-driven by a 3-row LANGS array; nothing to clean up.

Task 2 (grep test) is not TDD-mode (`tdd="true"` was false on task 2 per the plan `<task type="auto" tdd="true">` — actually Task 2 is marked `tdd="true"` in the plan, but the test itself IS the deliverable; there's no code being tested by it. The test lands in a single commit because writing a "failing" version of this kind of test would require temporarily breaking another file, which is the opposite of what the guard tests for. One commit is appropriate.

Task 3 (VERIFICATION.md) is not TDD — doc deliverable. One commit.

Gate sequence verified: `test(36-03)` → `feat(36-03)` pair present in git log for Task 1.

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: src/migrate/bulk-multilang-symbol-extract.ts
- FOUND: src/migrate/bulk-multilang-symbol-extract.test.ts
- FOUND: src/change-detector/single-pass-invariant.test.ts
- FOUND: .planning/phases/36-schema-migration-multi-language-symbols/36-VERIFICATION.md
- FOUND: src/coordinator.ts (modified — import + try/catch verified via grep)
- FOUND: package.json (modified — build entry list includes bulk-multilang)

**Commits verified to exist in git log:**
- FOUND: 3d94add (Task 1 RED)
- FOUND: e3af2b0 (Task 1 GREEN + coordinator wiring)
- FOUND: 7413a0d (Task 2 + package.json fix)
- FOUND: 6664099 (Task 3 VERIFICATION.md)

**Final gates green:**
- `npm test` → 768 passing, 7 skipped, 0 failed
- `npm run build` → exit 0 (~18ms)
- v1.6→v1.7 upgrade smoke → all three v1.7 gates set, v1.6 gate preserved
- `symbol_dependencies` write path count → 0 (schema-only; Phase 37 populates)

---
*Phase: 36-schema-migration-multi-language-symbols*
*Plan: 03*
*Completed: 2026-04-24*
