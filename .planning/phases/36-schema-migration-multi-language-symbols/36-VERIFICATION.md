# Phase 36: Verification Gate

**Phase:** 36 — Schema Migration + Multi-Language Symbols
**Generated:** 2026-04-24
**Status:** All Phase 36 requirements verified

## Gate: Every REQUIREMENTS.md v1.7 entry mapped to a test or artifact

Each row cites the concrete evidence an auditor can execute to confirm the requirement. Test names are the literal `it('...')` strings from the source files.

| Requirement | Artifact / Test File | describe block | test name(s) |
|-------------|----------------------|----------------|--------------|
| **PERF-03** (baseline captured before extraction code) | `.planning/phases/36-schema-migration-multi-language-symbols/v1.7-baseline.json` (committed artifact) + `scripts/bench-scan.mjs` (OUT_PATH edited) | N/A — committed artifact + git history | Commit `29945f5` (plan 36-01 Task 1) is chronologically the FIRST commit in the phase, preceding all extractor code (`git log --follow` confirms ordering; see "Commit ordering gate" below) |
| **MLS-01** (Python symbols — function_definition) | `src/language-config.python-symbols.test.ts` | `extractPythonSymbols — function_definition` | `'emits \`def foo(): pass\` as kind=function, isExport=true, 1-indexed startLine'`, `'marks \`_private\` function as isExport=false (D-13 underscore prefix)'`, `'marks \`__dunder__\` as isExport=false'`, `'emits \`async def foo()\` as kind=function (Pitfall 1 / D-11 — async is a keyword child, still function_definition)'` |
| **MLS-01** (class_definition) | `src/language-config.python-symbols.test.ts` | `extractPythonSymbols — class_definition` | `'emits \`class Foo: pass\` as kind=class, isExport=true'`, `'marks \`_PrivateClass\` as isExport=false'` |
| **MLS-01** (decorated_definition startLine) | `src/language-config.python-symbols.test.ts` | `extractPythonSymbols — decorated_definition` | `'startLine comes from decorated_definition (decorator line), NOT the def line (D-12)'`, `'decorated class uses decorator startLine + inner class name'`, `'decorated async function still emits kind=function with decorator startLine'` |
| **MLS-01** (top-level only — Pitfall 3) | `src/language-config.python-symbols.test.ts` | `extractPythonSymbols — top-level only` | `'does NOT emit nested methods inside a class (Pitfall 3)'`, `'does NOT emit nested classes'`, `'does NOT emit nested functions inside a top-level function'` |
| **MLS-02** (Go function_declaration) | `src/language-config.go-symbols.test.ts` | `extractGoSymbols — function_declaration` | `'emits \`func Hello()\` as kind=function, isExport=true (first char uppercase)'`, `'emits \`func unexported()\` with isExport=false (first char lowercase)'` |
| **MLS-02** (method_declaration — Pitfall 4) | `src/language-config.go-symbols.test.ts` | `extractGoSymbols — method_declaration` | `'emits \`func (r *T) Method()\` with name=Method, kind=function (Pitfall 4 — name is field_identifier)'`, `'emits generic receiver method \`func (s S[K, V]) Generic() K\` with name=Generic'`, `'marks lowercase method as isExport=false'` |
| **MLS-02** (type_declaration dispatch — D-15) | `src/language-config.go-symbols.test.ts` | `extractGoSymbols — type_declaration` | `'emits \`type Foo struct {...}\` as kind=struct (D-15 + D-06)'`, `'emits \`type Bar interface {...}\` as kind=interface'`, `'emits \`type Baz int\` as kind=type'`, `'emits \`type MyAlias = int\` (type_alias branch) as kind=type'` |
| **MLS-02** (const_spec loop — D-16) | `src/language-config.go-symbols.test.ts` | `extractGoSymbols — const_declaration` | `'emits \`const MaxSize = 100\` as one symbol, kind=const'`, `'emits \`const ( FirstConst = 1; SecondConst = 2 )\` as TWO symbols (D-16 one per const_spec)'`, `'marks lowercase const as isExport=false'` |
| **MLS-03** (Ruby method + singleton_method — D-07) | `src/language-config.ruby-symbols.test.ts` | `extractRubySymbols — method + singleton_method` | `'emits top-level \`def instance_method; end\` as kind=function, isExport=true'`, `'emits top-level \`def self.class_method; end\` as kind=function (D-07 singleton_method → function)'` |
| **MLS-03** (class + scope_resolution + reopened — D-22 + Pitfall 6) | `src/language-config.ruby-symbols.test.ts` | `extractRubySymbols — class` | `'emits simple \`class Foo; end\` as kind=class, name=Foo'`, `'emits \`class Baz::Nested; end\` with name="Baz::Nested" (scope_resolution text — D-22 note)'`, `'emits TWO symbols for reopened class \`class Foo; end\\nclass Foo; end\` (Pitfall 6)'` |
| **MLS-03** (module → kind=module — D-06) | `src/language-config.ruby-symbols.test.ts` | `extractRubySymbols — module` | `'emits \`module Bar; end\` as kind=module (D-06 new SymbolKind)'` |
| **MLS-03** (constant assignment — D-08) | `src/language-config.ruby-symbols.test.ts` | `extractRubySymbols — constant assignment` | `'emits \`CONST_VALUE = 42\` as kind=const (lhs type \`constant\`)'`, `'does NOT emit \`my_var = 42\` (lhs type \`identifier\`, not \`constant\`)'` |
| **MLS-03** (attr_accessor NOT indexed — D-20 / Pitfall 5) | `src/language-config.ruby-symbols.test.ts` | `extractRubySymbols — attr_accessor is NOT indexed (Pitfall 5 / D-20)` | `'\`class User; attr_accessor :email; end\` emits exactly ONE symbol (User) — no email symbol'`, `'\`attr_accessor :a, :b, :c\` inside class synthesizes zero extra symbols'` |
| **MLS-04** (extractLangFileParse dispatch — D-05) | `src/language-config.python-symbols.test.ts` | `extractLangFileParse — dispatch contract (D-05)` | `'returns { edges, symbols } for .py files'`, `'returns null for .ts files (they go through extractTsJsFileParse)'`, `'returns null for unsupported extensions'` |
| **MLS-04** (coordinator three-way dispatch — D-23) | `src/coordinator.ts` (source-grep) + full-suite integration envelope | N/A — source grep + `npm test` | `grep -nE "isPyGoRb\|extractLangFileParse" src/coordinator.ts` shows both the dispatch branch (line ~767) and the import (line 21); `npm test` passes (768 tests) as the integration envelope. |
| **MLS-04** (find_symbol description — MCP-03 portion, D-29 + D-30) | `src/mcp-server.ts` (grep: `attr_accessor`, `module`, `struct`) + `scripts/check-find-symbol-desc-len.mjs` (length probe, ceiling 2000) | N/A — source grep + script | Lines 339 + 341 include `module/struct`; line 347 includes `Ruby \`attr_accessor\` ... not indexed`; description remains a `string[].join(' ')` literal (D-30). |
| **MLS-05** (bulk backfill — first boot) | `src/migrate/bulk-multilang-symbol-extract.test.ts` | `runMultilangSymbolsBulkExtractionIfNeeded — first boot` | `'populates symbols for every tracked Python file'`, `'populates symbols for every tracked Go file'`, `'populates symbols for every tracked Ruby file'`, `'sets all three language gates after running'`, `'per-file failure does not abort the Python sub-pass (D-27 log + continue)'` |
| **MLS-05** (Pitfall-17 gate independence — D-28b) | `src/migrate/bulk-multilang-symbol-extract.test.ts` | `runMultilangSymbolsBulkExtractionIfNeeded — kv_state key independence` | `'does NOT skip Python pass when v1.6 symbols_bulk_extracted flag is set'` |
| **MLS-05** (idempotent second boot — D-28) | `src/migrate/bulk-multilang-symbol-extract.test.ts` | `runMultilangSymbolsBulkExtractionIfNeeded — second boot (idempotent)` | `'becomes a no-op for all three languages after first run'` |
| **CSE-01** (symbol_dependencies schema shape) | `src/db/migration-0006.test.ts` | `migration 0006 — fresh DB` | `'creates the symbol_dependencies table with all expected columns'`, `'creates the symbol_dependencies indexes'`, `'table ships empty — Phase 36 writes nothing'` |
| **CSE-01** (idempotent re-open — D-29c) | `src/db/migration-0006.test.ts` | `migration 0006 — idempotent re-open` | `'does not throw on a DB with existing symbols rows'` |
| **Milestone rule — single-pass invariant (D-31/D-32)** | `src/change-detector/single-pass-invariant.test.ts` | `single-pass invariant — parser.parse count per extractor` | `'language-config.ts: every extract* function has ≤ 1 parser.parse() call'`, `'ast-parser.ts: every extract* function has ≤ 1 parser.parse() call'` |

## Perf check (Milestone rule — self-scan stays < 20% above v1.7-baseline.json)

```bash
npm run build
node scripts/bench-scan.mjs
# Writes fresh v1.7-baseline.json; COMMIT IS NOT desired — the baseline is locked to 36-01's capture.
# Informal comparison only: self_scan elapsed_ms should be within ±20% of 2403ms baseline.
```

**Observed after Phase 36 close** (captured during 36-02; re-confirmed informally):

| Target       | Baseline (36-01) | Post-36-02 observation | Delta   |
|--------------|------------------|------------------------|---------|
| Self-scan    | 2403ms / 490 files | 2171ms / 491 files   | −9.7%   |
| Medium-repo  | 434ms / 102 files  | 391ms / 102 files    | −9.9%   |

Both directions favorable / within noise. Py/Go/Rb path is new per-file cost only — fires rarely in the fixture repos. Perf gate: **PASS**.

## Commit ordering gate (D-02 — baseline-first invariant)

```bash
git log --follow --format="%h %s" -- \
  .planning/phases/36-schema-migration-multi-language-symbols/v1.7-baseline.json \
  src/language-config.ts \
  src/db/schema.ts \
  drizzle/0006_add_symbol_dependencies.sql \
  src/migrate/bulk-multilang-symbol-extract.ts
```

Chronologically earliest commit touching this set MUST be `29945f5 perf(36-01): capture v1.7 baseline bench-scan snapshot`. Later commits: migration 0006 → SymbolKind + grammar install → extractors + dispatch (36-02) → bulk-multilang + grep-invariant test (36-03). **Verified ordering: PASS** (see 36-01-SUMMARY.md § "Commit order verification").

## Final green gate

```bash
npm run build && npm test
```

- `npm run build` exits 0 (esbuild Done in ~20ms; dist/migrate/bulk-multilang-symbol-extract.js present).
- `npm test` exits 0 — **768 tests passing, 7 skipped, 0 failed**.

Phase 36 exit gate **closed**.
