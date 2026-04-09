---
phase: 26-multi-language-tree-sitter-extraction
reviewed: 2026-04-09T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/language-config.ts
  - src/change-detector/ast-parser.ts
  - src/language-config.test.ts
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-04-09
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Reviewed the Phase 26 multi-language tree-sitter extraction implementation: the language
registry (`src/language-config.ts`), the TS/JS AST parser (`src/change-detector/ast-parser.ts`),
and the accompanying test suite (`src/language-config.test.ts`).

The overall architecture is sound. The registry dispatch pattern, confidence constants,
deduplication-by-weight aggregation, and grammar-isolation-via-try/catch at load time are
all well-structured. The TS/JS extractor in ast-parser.ts is clean and correct.

Two areas need attention before this is production-ready:

1. `extractPythonEdges` contains a double-traversal bug where the tree is walked twice and
   first-walk results are explicitly thrown away. The first walk fires async operations with
   `void` (unawaited), so relative-import edges from it are silently dropped. The second walk
   collects them correctly. The first walk is dead weight and should be removed.

2. Python, Rust, and C/C++ parse calls are unwrapped — no try/catch around `parser.parse()`.
   A malformed input file will throw and propagate up to the outer `extractEdges` catch block
   (so no crash), but the failure mode is inconsistent with ast-parser.ts which wraps parse
   in try/catch and returns null. This inconsistency is a maintenance hazard.

---

## Warnings

### WR-01: Double-traversal dead code in `extractPythonEdges` with silently dropped async edges

**File:** `src/language-config.ts:173-222`

**Issue:** `extractPythonEdges` walks the AST twice. The first walk (lines 173-193) calls
`handlePythonModule` with `void` — meaning for relative imports that call `fsPromises.access`,
the async operation is fired and forgotten. For those imports, the `edges.push()` inside the
async callback never executes in the first-walk context. The code attempts to fix this on
line 219 by clearing `edges` (`edges.length = 0`) and doing a second `visitNodeAsync` walk
that properly collects promises into `asyncEdgePromises`. The fix works, but the entire
first walk (lines 173-193, plus the inner `visitNode` closure) is dead weight. More
importantly, if any caller ever removes the `edges.length = 0` reset, the duplicate edges
from the first walk (package deps, which are synchronously pushed) would be re-included,
causing incorrect weight inflation.

**Fix:** Delete the first `visitNode` closure and the `void handlePythonModule(...)` calls
entirely. Keep only the `asyncEdgePromises`/`visitNodeAsync` approach. The function should
look like:

```typescript
async function extractPythonEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  const tree = (pythonParser as any).parse(content);
  const edges: EdgeResult[] = [];
  const asyncEdgePromises: Promise<void>[] = [];

  function visitNode(node: any): void {
    if (node.type === 'import_statement') {
      for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        const moduleName: string = child.type === 'aliased_import'
          ? (child.childForFieldName('name')?.text ?? '')
          : child.text;
        if (moduleName) asyncEdgePromises.push(handlePythonModule(moduleName, filePath, projectRoot, edges));
      }
    } else if (node.type === 'import_from_statement') {
      const modNameNode = node.childForFieldName('module_name');
      if (modNameNode) {
        asyncEdgePromises.push(handlePythonModule(modNameNode.text as string, filePath, projectRoot, edges));
      }
    }
    for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
  }

  visitNode(tree.rootNode);
  await Promise.all(asyncEdgePromises);
  return edges;
}
```

---

### WR-02: Missing try/catch around `parser.parse()` in Python, Rust, and C/C++ extractors

**File:** `src/language-config.ts:169`, `326`, `371`

**Issue:** `extractPythonEdges`, `extractRustEdges`, and the closure returned by
`makeIncludeExtractor` all call `parser.parse(content)` without wrapping in try/catch.
A malformed or extremely large file can cause tree-sitter to throw at the parse step.
The outer `extractEdges` try/catch (line 886-890) will catch it and return `[]`, so
there is no crash — but the caller gets an empty result with no indication of why, and
the error is logged at `[language-config] extractEdges failed` rather than a more
descriptive message. This is also inconsistent with `extractRicherEdges` in ast-parser.ts
(lines 167-172) which wraps parse in its own try/catch and returns null with a targeted
log message.

**Fix:** Wrap each parse call in a dedicated try/catch, matching the ast-parser.ts pattern:

```typescript
// In extractPythonEdges (line 169):
let tree: any;
try {
  tree = (pythonParser as any).parse(content);
} catch (err) {
  log(`[language-config] tree-sitter parse failed for ${filePath}: ${err}`);
  return [];
}

// Same pattern in extractRustEdges (line 326) and makeIncludeExtractor (line 371).
```

---

### WR-03: Bogus `target` for Python absolute-module package edges

**File:** `src/language-config.ts:149-159`

**Issue:** In `handlePythonModule`, the `else` branch (absolute imports like `os`, `json`,
`serde`) constructs `resolved = path.resolve(path.dirname(filePath), moduleName)` and
stores it as `target`. For a file at `/project/src/app.py` importing `os`, this produces
`target: '/project/src/os'` — a path that does not exist and has no semantic meaning for a
stdlib or PyPI module. The `isPackage: true` flag and `packageName` are correct, but the
`target` field is misleading garbage that downstream consumers (e.g., cycle detection, edge
rendering) may use.

For comparison, the TS/JS package path in `resolveTsJsImport` produces a proper
`node_modules/...` resolved path or the raw specifier. Go and Ruby use `pkg.path` from their
resolvers. Python is the odd one out.

**Fix:** For absolute Python module imports, use the module name itself (or a conventional
`pypi:<name>` sentinel) as the target rather than a fabricated filesystem path:

```typescript
} else {
  const topLevel = moduleName.split('.')[0];
  edges.push({
    target: topLevel,   // or `pypi:${topLevel}` for clarity
    edgeType: 'imports',
    confidence: EXTRACTED,
    confidenceSource: CONFIDENCE_SOURCE_EXTRACTED,
    weight: 1,
    isPackage: true,
    packageName: topLevel,
  });
}
```

---

### WR-04: `buildAstExtractor` always returns regex results even when grammar loading succeeds

**File:** `src/language-config.ts:750-769`

**Issue:** `buildAstExtractor` is exported and documented as the integration seam for Phase
26. In its current form, the `try` block loads the grammar (`_grammar`) and then immediately
discards it (`void _grammar`) before calling `regexFallback`. This means even when grammar
loading succeeds the function returns regex results — not AST results. The comment says
"Phase 26 will add actual AST extraction here" but this function IS in the Phase 26 diff.
As written, callers who use `buildAstExtractor` (none today, but the export implies future
use) will always get regex-level confidence (INFERRED 0.8), not EXTRACTED 1.0, with no
indication that the grammar loaded successfully.

This is not a crash risk, but it is a logic error in the abstraction: the exported function
promises AST-first behavior and does not deliver it.

**Fix:** Either (a) remove the export and the function until Phase 26 is ready to plug in
real extraction, or (b) add a `// TODO(phase-26): replace void _grammar with actual AST
extraction` comment on the `void _grammar` line and rename the function
`buildAstExtractorStub` to make the incompleteness obvious to future readers. Option (a) is
cleaner given the project's "no dead code" preference.

---

### WR-05: Import statements interleaved with `const` declarations

**File:** `src/language-config.ts:61-70`

**Issue:** The `import { IMPORT_PATTERNS, ... }` block at line 61 appears after `const`
declarations at lines 57-60 (`pythonParser`, `rustParser`, `cParser`, `cppParser`). ES
module `import` declarations are hoisted by the runtime, so execution order is unaffected,
but placing imports after `const` declarations violates conventional module structure and
will trigger ESLint `import/first` if that rule is enabled. It also makes it harder to
understand the module's dependencies at a glance.

**Fix:** Move the `import { IMPORT_PATTERNS, ... }` and `import { PackageDependency }` blocks
to the top of the file, alongside the other imports (lines 19-25).

---

## Info

### IN-01: Test hardcodes raw confidence values instead of named constants

**File:** `src/language-config.test.ts:299,301`

**Issue:** The Go extraction test asserts `expect(e.confidence).toBe(0.8)` and
`expect(e.confidenceSource).toBe('inferred')` using raw literals. If the `INFERRED` or
`CONFIDENCE_SOURCE_INFERRED` constants are ever changed, this test will silently diverge from
the system behavior rather than failing loudly.

**Fix:** Import and use the named constants:

```typescript
import { INFERRED, CONFIDENCE_SOURCE_INFERRED } from './confidence.js';
// ...
expect(e.confidence).toBe(INFERRED);
expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_INFERRED);
```

---

### IN-02: `void projectRoot` suppression in `handlePythonModule` and `handleRustUse`

**File:** `src/language-config.ts:129`, `233`

**Issue:** Both `handlePythonModule` and `handleRustUse` declare `projectRoot` as a parameter
and immediately suppress it with `void projectRoot`. The comment says it is "reserved for
future use." This is harmless but adds noise and passes `projectRoot` through the call chain
unnecessarily.

**Fix:** If `projectRoot` is not used, either omit it from the signature and update callers,
or prefix it with `_projectRoot` (which is the convention already used in `handleRustMod` at
line 297) so linters do not warn about unused parameters.

---

### IN-03: `extractPythonEdges` uses `edges.length = 0` to clear an array mid-function

**File:** `src/language-config.ts:219`

**Issue:** `edges.length = 0` is used to discard results from the first walk before the
second walk runs. This is a valid JavaScript/TypeScript idiom but is non-obvious to readers
who expect `const edges: EdgeResult[]` to be append-only after initialization. Combined with
WR-01 (the entire first walk is dead), this line should simply be deleted as part of that fix.
Noted here separately for clarity.

**Fix:** Addressed by WR-01. Remove the first walk entirely; `edges.length = 0` becomes
unnecessary.

---

_Reviewed: 2026-04-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
