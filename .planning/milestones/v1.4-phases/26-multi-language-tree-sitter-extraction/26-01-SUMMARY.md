---
phase: 26-multi-language-tree-sitter-extraction
plan: "01"
subsystem: language-config
tags: [tree-sitter, ast, python, rust, c, cpp, dependency-extraction, confidence]
dependency_graph:
  requires:
    - src/confidence.ts (EXTRACTED/INFERRED constants)
    - src/change-detector/ast-parser.ts (createRequire pattern, grammar loading)
    - src/file-utils.ts (normalizePath, resolveImportPath, IMPORT_PATTERNS)
  provides:
    - Python AST extractor (extractPythonEdges)
    - Rust AST extractor (extractRustEdges)
    - C/C++ AST extractor (makeIncludeExtractor)
    - buildRegexExtractor export for test access
  affects:
    - src/language-config.ts (registry, new extractors)
    - src/language-config.test.ts (new parity test file)
    - package.json (four new grammar dependencies)
tech_stack:
  added:
    - tree-sitter-python@0.25.0
    - tree-sitter-c@0.24.1
    - tree-sitter-cpp@0.23.4
    - tree-sitter-rust@0.24.0
  patterns:
    - createRequire grammar loading with per-language try/catch isolation
    - visitNode recursive AST walk (same pattern as ast-parser.ts)
    - makeIncludeExtractor factory for sharing C/C++ logic
    - Grammar load failure → registry gap → ensureRegexExtractors fills with regex fallback
key_files:
  modified:
    - path: src/language-config.ts
      changes: Added createRequire grammar loading, Python/Rust/C/C++ extractors, registry entries, exported buildRegexExtractor
  created:
    - path: src/language-config.test.ts
      changes: 19 parity and confidence tests for Python, Rust, C, C++ extractors
decisions:
  - "Python regex has no capture groups — parity tests compare AST output directly rather than to broken regex output"
  - "C/C++ system includes use pathNode.type discrimination (system_lib_string vs string_literal) — more accurate than regex angle-bracket heuristic"
  - "Local includes use fsPromises.access() check matching existing regex behavior (skip nonexistent files)"
  - "makeIncludeExtractor factory used for C and C++ to share identical include-parsing logic"
  - "Grammar load failure leaves registry gap; ensureRegexExtractors fills it — no explicit fallback needed per extractor"
metrics:
  duration: ~3 minutes
  completed: "2026-04-09"
  tasks: 2
  files: 3
requirements: [AST-02, AST-03, AST-04, EDGE-03]
---

# Phase 26 Plan 01: Grammar Installation + Python/Rust/C/C++ AST Extractors Summary

Python, Rust, C, and C++ AST extractors using tree-sitter grammars, replacing regex-based dependency extraction with structurally-correct AST parsing at EXTRACTED confidence (1.0).

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Install grammar packages and create Python/Rust/C/C++ AST extractors | 08b6f79 | src/language-config.ts, package.json |
| 2 | Parity tests for Python, Rust, and C/C++ extractors | 55e54e7 | src/language-config.test.ts |

## What Was Built

### Grammar Installation
Four tree-sitter grammar packages installed as runtime dependencies:
- `tree-sitter-python@0.25.0`
- `tree-sitter-c@0.24.1`
- `tree-sitter-cpp@0.23.4`
- `tree-sitter-rust@0.24.0`

### Grammar Loading (language-config.ts)
Added `createRequire` pattern (matching `ast-parser.ts`) with per-language try/catch isolation. Grammar load failure for any language leaves the registry entry absent, causing `ensureRegexExtractors()` to fill it with the regex fallback — the D-03 graceful fallback behavior.

### Python Extractor (`extractPythonEdges`)
Walks `import_statement` (multiple `dotted_name`/`aliased_import` children) and `import_from_statement` (module_name field) AST nodes. Absolute imports → `isPackage: true`, relative imports → `fsPromises.access()` check. All edges carry `EXTRACTED` confidence (1.0).

### Rust Extractor (`extractRustEdges`)
Handles three AST node types:
- `use_declaration` → `argument` field gives the use path
- `mod_item` → only emits edge if no `body` field (bodyless = external reference)
- `extern_crate_declaration` → `name` field gives crate name

Paths starting with `crate::`, `super::`, `self::` → local file resolution. Everything else → `isPackage: true` with `packageName = first segment before ::`.

### C/C++ Extractor (`makeIncludeExtractor`)
Factory function shared by both C and C++ parsers. Handles `preproc_include` nodes:
- `system_lib_string` node type → system include (e.g., `<stdio.h>`) → `isPackage: true`, `packageName = header name`
- `string_literal` node type → local include (e.g., `"myfile.h"`) → resolved path + `fsPromises.access()` check

### Registry Entries Added
- `.py` → `extractPythonEdges` (`usesRegexFallback: false`)
- `.rs` → `extractRustEdges` (`usesRegexFallback: false`)
- `.c`, `.h` → C include extractor (`usesRegexFallback: false`)
- `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hh`, `.hxx` → C++ include extractor (`usesRegexFallback: false`)

### `buildRegexExtractor` Export
Added to the exports so parity tests can directly call the regex extractor alongside the AST extractor.

### Parity Tests (language-config.test.ts)
19 tests covering:
- Python: package edge production, EXTRACTED confidence, `from X import Y` top-level extraction
- Rust: external crates, `extern crate`, inline module (no edge), bodyless mod (file check)
- C: system include → `isPackage: true`, parity count vs regex, EXTRACTED confidence
- C++: same as C with C++ parser, parity count vs regex
- Grammar fallback: unknown extension returns `[]` cleanly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Python async edge collection used `void` — edges missed**
- **Found during:** Task 1 implementation
- **Issue:** Initial `visitNode` called `handlePythonModule` with `void`, meaning async file-access checks for relative imports would not be awaited.
- **Fix:** Implemented a second `visitNodeAsync` pass that collects all `Promise<void>` into `asyncPromises` array and awaits with `Promise.all()`. Package imports (synchronous push) are handled correctly in both paths.
- **Files modified:** src/language-config.ts
- **Commit:** 08b6f79

**2. [Rule 1 - Bug] C/C++ parity test compared mismatched target representations**
- **Found during:** Task 2 RED phase
- **Issue:** Plan's `expect(astPkgs).toEqual(regexPkgs)` compared AST `packageName` (`"stdio.h"`) against regex `target` (`"/project/src/stdio.h"`) — never equal.
- **Fix:** Rewrote parity tests to compare edge counts (both produce same number of package edges) and verify AST `packageName` values directly.
- **Files modified:** src/language-config.test.ts
- **Commit:** 55e54e7

**3. [Note] Python regex has no capture groups**
- The `.py` regex pattern `/(?:import\s+[\w.]+|from\s+[\w.]+\s+import\s+[\w*]+)/g` has no capture groups, so `buildRegexExtractor` skips all Python imports (`match[1]` is undefined). Python "parity" tests verify AST output correctness directly rather than comparing to broken regex output.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/language-config.ts exists | FOUND |
| src/language-config.test.ts exists | FOUND |
| 26-01-SUMMARY.md exists | FOUND |
| commit 08b6f79 (Task 1) exists | FOUND |
| commit 55e54e7 (Task 2) exists | FOUND |
| `npx tsc --noEmit` exits 0 | PASSED |
| `npx vitest run src/language-config.test.ts` 19/19 pass | PASSED |
