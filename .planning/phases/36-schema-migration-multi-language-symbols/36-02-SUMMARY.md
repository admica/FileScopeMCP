---
phase: 36-schema-migration-multi-language-symbols
plan: 02
subsystem: language-extraction
tags: [tree-sitter, symbols, python, go, ruby, coordinator, mcp-tool, multi-language]
requires:
  - "36-01 (SymbolKind += module/struct, tree-sitter-go@0.25.0 + tree-sitter-ruby@0.23.1, migration 0006)"
provides:
  - "extractPythonSymbols — top-level Python symbol extraction (MLS-01)"
  - "extractGoSymbols — top-level Go symbol extraction (MLS-02)"
  - "extractRubySymbols — top-level Ruby symbol extraction (MLS-03)"
  - "extractLangFileParse — non-TS/JS file-parse dispatcher returning { edges, symbols } | null (MLS-04)"
  - "Coordinator three-way pass-2 dispatch (TS/JS | Py/Go/Rb | other)"
  - "find_symbol MCP tool description documenting Ruby attr_accessor + reopened-class limitations (extension of v1.6 MCP-03)"
affects:
  - "src/language-config.ts (+330 lines: 3 extractors + dispatcher + parser singletons)"
  - "src/coordinator.ts (+12 lines: isPyGoRb branch in pass-2 dispatch)"
  - "src/mcp-server.ts (+2 description bullets; kind list extended with module/struct)"
  - "find_symbol now returns symbols for .py/.go/.rb files scanned live"
tech-stack:
  added: []  # Grammars already installed in 36-01; this plan uses them.
  patterns:
    - "Module-level parser singletons (eager construction via createParser) colocated with existing python/rust/c/cpp instances"
    - "Top-level-only AST walk via tree.rootNode.namedChild(i) — no recursion into class/function bodies"
    - "childForFieldName('name') for type-agnostic name extraction (handles Go field_identifier vs identifier uniformly)"
    - "Three-way dispatch by path.extname — extends existing two-way TS/JS-vs-other pattern"
    - "Null-for-unsupported return from extractLangFileParse mirrors extractTsJsFileParse"
key-files:
  created:
    - "src/language-config.python-symbols.test.ts — 15 tests, 5 describes (MLS-01 + dispatch contract)"
    - "src/language-config.go-symbols.test.ts — 12 tests, 4 describes (MLS-02)"
    - "src/language-config.ruby-symbols.test.ts — 10 tests, 5 describes (MLS-03 + attr_accessor guard)"
    - ".planning/phases/36-schema-migration-multi-language-symbols/deferred-items.md — file-utils.ts watcher parity deferred"
  modified:
    - "src/language-config.ts — 954 → 1284 lines (+330)"
    - "src/coordinator.ts — isPyGoRb dispatch branch added at line ~747"
    - "src/mcp-server.ts — find_symbol description + inputSchema.kind.describe() updated"
decisions:
  - "Parser singletons: eager module-level const (matches v1.6 python/rust pattern; discretion per CONTEXT.md Open Q2 resolved)"
  - "extractLangFileParse implemented in Task 1 commit rather than deferring to Task 2 — the dispatch contract tests were authored in RED alongside the extractor tests, so GREEN requires the dispatcher to exist"
  - "file-utils.ts analyzeNewFile watcher path NOT extended — out of scope per files_modified; logged in deferred-items.md"
  - "Unused _filePath parameter retained in all three extractors for signature-stability (future error-logging hook)"
metrics:
  duration_seconds: 406  # from git commit timestamps across 3 commits
  completed: 2026-04-24
  tests_added: 37
  tests_total: 759
---

# Phase 36 Plan 02: Python/Go/Ruby Symbol Extractors + Three-Way Dispatch Summary

## One-Liner

Implemented top-level symbol extractors for Python (MLS-01), Go (MLS-02), and Ruby (MLS-03) inline in `src/language-config.ts`, exported `extractLangFileParse()` as the non-TS/JS analog of `extractTsJsFileParse()`, wired the coordinator pass-2 dispatch to three-way (TS/JS | Py/Go/Rb | other), and documented Ruby `attr_accessor` + reopened-class limitations in the `find_symbol` MCP tool description — all preserving the D-04 single-parser-call invariant and the D-30 `string[].join(' ')` description literal shape.

## What Changed

### `src/language-config.ts` (954 → 1284 lines, +330)

**New module-level grammar loaders + parser singletons** (colocated with existing python/rust/c/cpp block at lines 32-69):
- `GoLang` + `RubyLang` loaded via `_require('tree-sitter-go')` / `_require('tree-sitter-ruby')` inside try/catch (one bad grammar doesn't block others — matches v1.6 pattern).
- `goParser` + `rubyParser` created via the existing `createParser()` helper as module-level `const`.

**Three new symbol extractors** (exported, one `parser.parse()` call each per D-04):
- `extractPythonSymbols(_filePath, content): Symbol[]` at line 259 — handles `function_definition`, `async_function_definition` (D-11 defensive, current grammar uses `function_definition` with async keyword child per Pitfall 1), `class_definition`, and `decorated_definition` (startLine from outer per D-12/Pitfall 2, name+kind from inner). `isExport = !name.startsWith('_')` (D-13). Top-level only via `tree.rootNode.namedChild(i)` (D-10).
- `extractGoSymbols(_filePath, content): Symbol[]` at line 762 — handles `function_declaration` (name=`identifier`), `method_declaration` (name=`field_identifier`, extracted via `childForFieldName('name')` per Pitfall 4), `type_declaration` dispatched by inner spec shape (`type_spec` with `struct_type`→struct / `interface_type`→interface / else→type; `type_alias`→type per D-15), and `const_declaration` emitting one symbol per `const_spec` child (D-16). `isGoExported()` helper tests first ASCII char ∈ [65..90] (D-17).
- `extractRubySymbols(_filePath, content): Symbol[]` at line 935 — handles `method` + `singleton_method` → `function` (D-07), `class` (name from `constant` or `scope_resolution` full text per D-22), `module` → `module` (D-06 new kind), top-level `assignment` where `left.type === 'constant'` → `const` (D-08). All `isExport: true` (D-21). NO `attr_accessor` synthesis (Pitfall 5/D-20). Reopened classes emit multiple rows naturally (Pitfall 6/D-22).

**New non-TS/JS dispatcher** (MLS-04, D-05):
- `extractLangFileParse(filePath, content, projectRoot)` at line 998 — `path.extname` switch dispatches `.py`/`.go`/`.rb` to sibling edge + symbol extractors returning `{ edges, symbols }`; returns `null` for all other extensions so callers fall back to `extractEdges()`. `importMeta` intentionally omitted (v1.7 carries `imported_names` only for TS/JS).

### `src/coordinator.ts` (+12 lines)

**Before** (pass-2 dispatch, line 746):
```typescript
const isTsJs = ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx';
// ...
if (isTsJs) {
  const parsed = await extractTsJsFileParse(filePath, content, config.baseDirectory);
  if (parsed) { /* atomic write */ } else { edges = await extractEdges(...); }
} else {
  edges = await extractEdges(filePath, content, config.baseDirectory);
}
```

**After**:
```typescript
const isTsJs   = ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx';
const isPyGoRb = ext === '.py' || ext === '.go' || ext === '.rb';   // NEW
// ...
if (isTsJs) {
  /* unchanged */
} else if (isPyGoRb) {                                              // NEW branch
  const parsed = await extractLangFileParse(filePath, content, config.baseDirectory);
  if (parsed) {
    edges = parsed.edges;
    symbols = parsed.symbols;
    // importMeta deliberately unset — D-05.
    useAtomicWrite = true;
  } else {
    edges = await extractEdges(filePath, content, config.baseDirectory);
  }
} else {
  edges = await extractEdges(filePath, content, config.baseDirectory);
}
```

Import line (line 21) extended: `import { extractEdges, extractTsJsFileParse, extractLangFileParse } from './language-config.js';`

### `src/mcp-server.ts` (find_symbol description)

**Before** (9 bullets, description length ~1200):
1. "Resolve a symbol name (function/class/interface/type/enum/const)..."
3. "`kind` accepts: \"function\" | \"class\" | \"interface\" | \"type\" | \"enum\" | \"const\"..."
9. "Example: `find_symbol(\"useState*\")`..."

**After** (11 bullets, description length 1466):
1. "Resolve a symbol name (function/class/interface/type/enum/const**/module/struct**)..."  ← kind list extended
3. "`kind` accepts: ... \"enum\" | \"const\" **| \"module\" | \"struct\"**..."  ← kind list extended
9. **NEW:** "Ruby `attr_accessor` / `attr_reader` / `attr_writer` are not indexed (synthesized at runtime, not in AST)."
10. **NEW:** "Reopened Ruby classes produce multiple symbol rows with the same name — filter by `filePath` if disambiguation is needed."
11. "Example: `find_symbol(\"useState*\")`..." (unchanged)

`inputSchema.kind.describe()` updated to list the extended kind set:
```typescript
kind: z.string().optional().describe("function | class | interface | type | enum | const | module | struct (unknown kind returns empty)"),
```

Description literal remains a `string[].join(' ')` expression — D-30 length-probe preserved. `scripts/check-find-symbol-desc-len.mjs` reports 1466 chars (ceiling 2000).

## Commits

| Hash     | Type | Summary |
|----------|------|---------|
| b9664fd  | test | Add failing tests for Python/Go/Ruby symbol extractors (37 tests, RED) |
| 86740f1  | feat | Implement extractors + extractLangFileParse (GREEN — all 37 pass) |
| be633fb  | feat | Wire coordinator three-way dispatch + find_symbol description update |

## Test Results

| Test file | describes | its | status |
|-----------|-----------|-----|--------|
| `src/language-config.python-symbols.test.ts` | 5 | 15 | pass |
| `src/language-config.go-symbols.test.ts` | 4 | 12 | pass |
| `src/language-config.ruby-symbols.test.ts` | 5 | 10 | pass |
| `tests/unit/tool-outputs.test.ts` (regression check) | — | 29 | pass |

**Full suite:** 759 passing, 7 skipped (was 720 passing before plan; +37 new + 2 noise). Build: `esbuild` completes in ~24ms.

**Smoke test** (from plan `<verification>`):
```bash
node -e "const {extractLangFileParse} = require('./dist/language-config.js');
extractLangFileParse('/tmp/x.py','def foo(): pass\\nclass Bar: pass','/tmp').then(r => {
  if (!r || r.symbols.length !== 2) process.exit(1);
  console.log('ok:', r.symbols.map(s => s.name).sort());
});"
# ok: [ 'Bar', 'foo' ]
```

## Bench-Scan Delta (Informational — Not a Gate)

Captured a post-36-02 bench-scan for informational comparison against the locked `v1.7-baseline.json` (the baseline file was restored after capture since it's locked per D-02):

| Target       | Baseline (36-01) | Post-36-02 | Delta |
|--------------|------------------|------------|-------|
| Self-scan    | 2403ms / 490 files | 2171ms / 491 files | **-232ms (-9.7%)** |
| Medium-repo  | 434ms / 102 files  | 391ms / 102 files  | **-43ms (-9.9%)** |

Both directions favorable / within noise. No perf regression from adding Py/Go/Rb symbol extraction to the scan path (fixture repo has very few Py/Go/Rb files, so the new extractors barely fire; slight variance likely measurement noise). Plan 36-03's bulk backfill will be the perf-sensitive pass — re-bench there.

## Deviations from Plan

### Auto-fixed / architectural observations

**1. [Rule 3 — Ordering] Implemented `extractLangFileParse` in Task 1 GREEN commit, not Task 2**
- **Found during:** Writing tests in RED phase.
- **Reason:** The plan's Task 2 action 3 says "Write a minimal new test ... append to the file — don't create a new file" for the `extractLangFileParse` dispatch contract. The RED phase requires authoring ALL failing tests at the start of the TDD cycle, so the dispatch tests landed in the RED commit alongside the extractor tests. This means GREEN must include `extractLangFileParse` — otherwise the test file's top-level `import { extractLangFileParse }` fails and ALL tests in that file error out.
- **Fix:** Implemented `extractLangFileParse` in the Task 1 feat commit (same time as the three extractors). Task 2 then contains only coordinator + mcp-server changes.
- **Files modified:** `src/language-config.ts` (Task 1 commit includes +60 lines for `extractLangFileParse`).
- **Commit:** 86740f1.

**2. [Scope boundary — Deferred] file-utils.ts analyzeNewFile watcher path NOT extended**
- **Found during:** Surveying `extractTsJsFileParse` call sites (plan Task 2 action 2c).
- **Observation:** `src/file-utils.ts:858` (`analyzeNewFile`) is the third call site of `extractTsJsFileParse` in the codebase, invoked from the watcher change-handler path. It was NOT extended with a sibling `extractLangFileParse` branch because:
  - Plan's `files_modified` frontmatter does not list `src/file-utils.ts`.
  - Plan Task 2 action 2(c) says "Scan the rest of **`src/coordinator.ts`** for OTHER call sites" — scope is explicitly coordinator.
  - Plan 36-03 bulk-backfill populates symbols for existing `.py`/`.go`/`.rb` files already indexed, so existing repos are covered.
- **Impact:** Python/Go/Ruby files ADDED or EDITED via the file watcher after the server is running will not get symbols refreshed via the watcher path until a full scan/restart. Logged in `deferred-items.md` for follow-up.

No other deviations — both tasks executed exactly as written.

## Known Stubs

None. All three extractors are fully wired into the dispatcher and coordinator pass-2 dispatch. The symbol rows they produce flow directly through the existing `setEdgesAndSymbols` → `find_symbol` plumbing (D-24: no tool-shape changes).

## Threat Flags

None. The changes introduce no new trust boundaries — tree-sitter parsers already parse user-owned source files across the codebase (Python via `extractPythonEdges`, etc.); the new symbol extractors consume the same AST shape with the same crash-safety guarantees (tree-sitter returns partial trees with `ERROR` nodes on malformed input; per-file try/catch in coordinator pass-2 contains exceptions). Threat register T-36-06..T-36-09 dispositions hold unchanged.

## Self-Check: PASSED

**Files verified to exist:**
- FOUND: src/language-config.ts (1284 lines, +330 from baseline 954)
- FOUND: src/language-config.python-symbols.test.ts
- FOUND: src/language-config.go-symbols.test.ts
- FOUND: src/language-config.ruby-symbols.test.ts
- FOUND: src/coordinator.ts (isPyGoRb + extractLangFileParse import verified)
- FOUND: src/mcp-server.ts (attr_accessor + module|struct verified)
- FOUND: .planning/phases/36-schema-migration-multi-language-symbols/deferred-items.md

**Commits verified to exist in git log:**
- FOUND: b9664fd (test — RED gate)
- FOUND: 86740f1 (feat — GREEN gate)
- FOUND: be633fb (feat — dispatch + MCP description)

**TDD gate compliance:** RED → GREEN → (no REFACTOR needed — code is clean per RESEARCH.md sketches).
