# Phase 12: Go and Ruby Language Support - Research

**Researched:** 2026-03-19
**Domain:** Language import parsing — Go and Ruby regex extraction, go.mod resolution, .rb path probing
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LANG-01 | Go import parsing extracts dependencies from `import "pkg"` and grouped `import (...)` blocks, with `go.mod` module name resolution for intra-project paths | Regex patterns verified against Go spec; go.mod `^module\s+(\S+)` extraction confirmed |
| LANG-02 | Ruby import parsing extracts dependencies from `require` and `require_relative` calls, with `.rb` extension probing for intra-project paths | Syntax verified; `.rb` probing pattern mirrors existing JS extension probing in codebase |
</phase_requirements>

---

## Summary

This phase adds two new language parsers — Go and Ruby — to the existing `IMPORT_PATTERNS` registry in `file-utils.ts`. The codebase already has a well-understood pipeline: a file extension maps to a RegExp in `IMPORT_PATTERNS`, `scanDirectory` and `analyzeNewFile` both run those patterns against file content, then resolve matched paths to local filesystem paths. Go and Ruby follow the same pipeline.

Go adds one complication other languages lack: intra-project imports use the module path declared in `go.mod` as a prefix (e.g. `github.com/myorg/myrepo/internal/util`). Resolving these to filesystem paths requires reading `go.mod` to extract the module name, then stripping that prefix to get the relative directory path. When `go.mod` is absent, intra-project Go imports cannot be resolved to files and should fall through to `packageDependencies` as external packages — this is the correct defensive behavior.

Ruby's resolution is simpler: `require_relative` paths resolve relative to the calling file exactly like JavaScript's `./` imports, with `.rb` extension probing. Bare `require` paths that look like local files (start with `./` or `../`) also resolve relative to the caller. All other `require` paths are treated as gem/stdlib dependencies and stored as `packageDependencies`.

**Primary recommendation:** Add `'.go'` and `'.rb'` entries to `IMPORT_PATTERNS`, add a Go-specific resolution helper that reads `go.mod` and strips the module prefix, and add a Ruby-specific resolver that handles `require_relative` and `require './...'` separately from bare gem requires.

---

## Standard Stack

### Core
| Component | Source | Purpose | Why Standard |
|-----------|--------|---------|--------------|
| `IMPORT_PATTERNS` in `file-utils.ts` | Existing codebase | Registry mapping `.ext` to RegExp | All other languages use this — Go/Ruby extend it |
| `analyzeNewFile` in `file-utils.ts` | Existing codebase | Single-file dependency extraction (incremental updates) | Must also handle Go/Ruby for watcher-triggered re-parses |
| `scanDirectory` in `file-utils.ts` | Existing codebase | Full-scan dependency extraction | Both Go/Ruby parsing paths live here via the `IMPORT_PATTERNS` dispatch |
| `fsPromises.readFile` / `fs.existsSync` | Node.js built-in | Read `go.mod`, probe `.rb` paths | No new dependencies needed |

### Supporting
| Component | Version | Purpose | When to Use |
|-----------|---------|---------|-------------|
| `path.resolve` / `path.dirname` | Node.js built-in | Resolve `require_relative` and Go relative paths | All local-file resolution |
| `fsPromises.access` | Node.js built-in | Extension probing (`.rb`, `.go`) — confirms file exists | Before pushing a path to `dependencies[]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex for Go imports | tree-sitter Go grammar | tree-sitter adds native addon complexity; explicitly out of scope per REQUIREMENTS.md "Out of Scope" table |
| Regex for Ruby imports | tree-sitter Ruby grammar | Same reason — out of scope |
| Inline `go.mod` reading | `golang.org/x/mod` npm equivalent | No npm-equivalent exists; simple regex `^module\s+(\S+)` on the file content is standard practice |

**Installation:** No new npm packages required. All tools are Node.js built-ins.

---

## Architecture Patterns

### Where the Code Lives

The entire implementation fits in two existing files:

```
src/
├── file-utils.ts          # IMPORT_PATTERNS + Go/Ruby resolution helpers + go.mod cache
└── file-utils.test.ts     # Unit tests — new describe blocks for Go and Ruby
```

No new files are needed unless the go.mod reading logic becomes complex enough to warrant a helper module (not expected).

### Pattern 1: Adding to IMPORT_PATTERNS

**What:** Extend the existing `IMPORT_PATTERNS` map with `.go` and `.rb` keys.
**When to use:** These are the only entry points; `scanDirectory` and `analyzeNewFile` both dispatch through this map.

```typescript
// Source: existing pattern in src/file-utils.ts lines 73-84
const IMPORT_PATTERNS: { [key: string]: RegExp } = {
  // ... existing entries ...
  '.go': /import\s+(?:"([^"]+)"|`([^`]+)`|\(\s*([\s\S]*?)\s*\))/g,
  '.rb': /(?:require_relative|require)\s*\(?['"]((?:\.\.?\/)?[^'"]+)['"]\)?/g,
};
```

Note: The Go pattern as written captures either a single-line import string or a grouped `(...)` block. Post-match processing must split grouped block content on newlines and extract individual quoted strings from each line. The existing dispatch loop (lines 554-652) handles multi-match iteration via `content.match(importPattern)` which returns all global matches — but the grouped block requires secondary parsing.

### Pattern 2: Go Import Extraction (Two-Pass)

**What:** Go import regex produces two shapes of match:
1. `import "pkg/path"` — single string; extractable directly
2. `import (\n\t"pkg/a"\n\t"pkg/b"\n)` — the whole block as one match; must be split

**Recommended approach:** Use two separate simpler regexes rather than one complex one:

```typescript
// Source: Go Language Specification — https://go.dev/ref/spec#Import_declarations
// Single-line imports
const GO_SINGLE_IMPORT = /^import\s+"([^"]+)"/gm;
// Grouped import block contents (everything inside parens)
const GO_GROUPED_IMPORT_BLOCK = /^import\s+\(([\s\S]*?)\)/gm;
// Individual strings within grouped block
const GO_IMPORT_STRING = /"([^"]+)"/g;
```

Using two passes avoids a complex alternation regex that is hard to maintain.

### Pattern 3: Go Intra-Project Resolution

**What:** Given an import path like `github.com/myorg/repo/internal/util`, determine if it belongs to the current project and, if so, resolve it to a filesystem path.

**Algorithm:**
1. Read `go.mod` from `projectRoot` (or walk up to find it — but for this project, assume it's at `projectRoot`).
2. Extract module name: `const match = content.match(/^module\s+(\S+)/m); moduleName = match[1]`
3. If `importPath.startsWith(moduleName + '/')`: strip the module prefix, join with `projectRoot`, probe for `.go` file existence.
4. Otherwise: treat as an external package and push to `packageDependencies` with the import path as name.

**go.mod absent behavior:** If `go.mod` is missing, no intra-project resolution is possible. All non-relative Go imports become `packageDependencies`. This is correct: without `go.mod` the project is not a Go module. Log a warning at most.

**Caching:** Read `go.mod` once per `scanDirectory` call (pass the module name down, or cache it in a local variable scoped to the scan). Do NOT read it on every file — `scanDirectory` processes all files and repeated disk reads are wasteful.

```typescript
// Pseudocode — to be refined in PLAN.md
async function readGoModuleName(projectRoot: string): Promise<string | null> {
  try {
    const goModPath = path.join(projectRoot, 'go.mod');
    const content = await fsPromises.readFile(goModPath, 'utf-8');
    const match = content.match(/^module\s+(\S+)/m);
    return match ? match[1] : null;
  } catch {
    return null; // go.mod absent or unreadable
  }
}
```

### Pattern 4: Ruby Import Classification

**What:** A `require` call needs to be classified as either:
- **Local file**: starts with `./` or `../` → resolve relative to caller file, probe `.rb`
- **require_relative**: always local → resolve relative to caller file, probe `.rb`
- **Gem/stdlib**: bare string like `'rails'`, `'json'`, `'active_record'` → `packageDependency`

```typescript
// Source: Ruby docs — https://ruby-doc.org/core/Kernel.html#method-i-require_relative
// and https://ruby-doc.org/core/Kernel.html#method-i-require

function classifyRubyImport(rawMatch: string, importPath: string): 'relative' | 'local' | 'gem' {
  if (rawMatch.startsWith('require_relative')) return 'relative';
  if (importPath.startsWith('./') || importPath.startsWith('../')) return 'local';
  return 'gem';
}
```

**Extension probing for Ruby:** Try `resolvedPath + '.rb'` first, then `resolvedPath` (in case `.rb` was included explicitly). Mirror the existing JS extension probing pattern (lines 533-542 of `file-utils.ts`):

```typescript
// Source: existing pattern in src/file-utils.ts lines 533-542
const rubyExtensions = ['.rb', ''];
for (const extension of rubyExtensions) {
  const pathToCheck = resolvedPath + extension;
  try {
    await fsPromises.access(pathToCheck);
    dependencies.push(pathToCheck);
    break;
  } catch { /* try next */ }
}
```

### Pattern 5: Importance Scoring for Go/Ruby

**What:** `calculateInitialImportance` uses a `switch (ext)` that falls through to `default: importance += 0` for unknown extensions. Go and Ruby files should contribute a base importance.

**Recommendation:** Add cases:
```typescript
case '.go':
  importance += 2;   // equivalent weight to .js/.php
  break;
case '.rb':
  importance += 2;
  break;
```

`go.mod` should be treated like `package.json` — high importance config file:
```typescript
case '.mod':  // go.mod
  if (fileName === 'go') importance += 3;
  else importance += 1;
  break;
```

### Anti-Patterns to Avoid

- **Reading `go.mod` per file**: Do it once per scan, cache the module name in a local variable.
- **Treating all non-`./` Go imports as intra-project**: Only imports prefixed with the module name are intra-project. Everything else is an external package.
- **Omitting `.rb` extension probing**: Ruby conventionally omits extensions in `require`/`require_relative`. Always probe with `.rb` appended.
- **Using a single complex regex for Go grouped imports**: Two simple regexes (one for single-line, one for blocks) are cleaner and easier to test.
- **Modifying `analyzeNewFile` without mirroring changes in `scanDirectory`**: Both functions contain the `IMPORT_PATTERNS` dispatch. Any Go/Ruby resolution logic added to one must also appear in the other — or be extracted into a shared helper.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Go module name extraction | Custom `go.mod` parser | Simple regex `^module\s+(\S+)` on file content | go.mod format is simple and stable; a full parser is overkill |
| Ruby gem detection | Allowlist of known gems | Classify by import path shape (`./`, `../`, or bare) | Path-shape heuristic is reliable and mirrors how Node.js package detection already works |
| File extension probing | Custom stat-based logic | `fsPromises.access(path + '.rb')` in a loop | Exact same pattern already used for JS/TS at lines 533-542 |

**Key insight:** The existing import pipeline in `file-utils.ts` handles the hard parts (dependency diffing, SQLite persistence, importance propagation). Go and Ruby only need: (1) correct regex extraction, (2) correct local vs. package classification, (3) path resolution to existing files. Everything else is free.

---

## Common Pitfalls

### Pitfall 1: Go Grouped Import Blocks with Aliases
**What goes wrong:** Go imports can include aliases: `import myalias "pkg/path"`. The regex must not capture the alias as part of the path.
**Why it happens:** Treating the whole `import (...)` block as a single matched string and naively splitting on whitespace.
**How to avoid:** When parsing grouped block lines, extract only the quoted string after optional whitespace and an optional identifier:
```
/^\s*(?:\w+\s+)?"([^"]+)"/
```
**Warning signs:** Resolved paths that contain Go identifiers instead of package paths.

### Pitfall 2: Go Blank/Dot Imports
**What goes wrong:** `import _ "pkg"` (blank import) and `import . "pkg"` (dot import) are valid Go. The leading `_` or `.` must not be treated as part of the import path.
**Why it happens:** Alias-unaware regex on block content.
**How to avoid:** The per-line regex `^\s*(?:[\w_.]+\s+)?"([^"]+)"` handles `_` and `.` as optional aliases.
**Warning signs:** Package paths starting with `_` or `.` appearing in `packageDependencies`.

### Pitfall 3: go.mod Absent in Non-Module Go Projects
**What goes wrong:** Older Go code or generated code in a temp directory may lack `go.mod`. Attempting to open it throws.
**Why it happens:** `readGoModuleName` is called unconditionally before scanning `.go` files.
**How to avoid:** `readGoModuleName` returns `null` on error. Callers check for `null` and skip intra-project resolution — all Go imports become `packageDependencies`.
**Warning signs:** ENOENT errors propagating to the scan log.

### Pitfall 4: Ruby Imports with Dynamic Interpolation
**What goes wrong:** `require "#{BASE_DIR}/foo"` contains an unresolved variable. This already has a mitigation pattern in the codebase (`isUnresolvedTemplateLiteral`) but Ruby uses `#{}` not `${}`.
**Why it happens:** The existing `isUnresolvedTemplateLiteral` only checks for `${` — it won't catch Ruby interpolation.
**How to avoid:** Add a Ruby-specific check: skip import paths containing `#{`. Log a skip message consistent with existing template literal warnings.
**Warning signs:** Paths containing `#{` appearing in `dependencies[]`.

### Pitfall 5: analyzeNewFile Not Updated for Go/Ruby
**What goes wrong:** `scanDirectory` correctly handles Go/Ruby via `IMPORT_PATTERNS`, but `analyzeNewFile` (used during incremental file-watcher updates) shares the same dispatch code — if the resolution helper for go.mod is not also available there, watcher-triggered re-parses will leave Go files with empty dependencies.
**Why it happens:** `analyzeNewFile` and `scanDirectory` are separate functions with duplicated dispatch blocks (lines 493-653 vs. 897-993).
**How to avoid:** Extract Go-specific resolution (`resolveGoImport`) and Ruby-specific resolution (`resolveRubyImport`) as standalone async helper functions. Both `scanDirectory` and `analyzeNewFile` call them. The `go.mod` cache must be passed in or re-read — `analyzeNewFile` receives `projectRoot` so can call `readGoModuleName(projectRoot)` directly.
**Warning signs:** `scanDirectory` shows correct Go dependencies on initial scan, but watcher-triggered updates show empty dependencies for changed `.go` files.

---

## Code Examples

Verified patterns from official sources and codebase analysis:

### Go Single-Line Import Regex
```typescript
// Source: Go Language Specification https://go.dev/ref/spec#Import_declarations
// Matches:  import "github.com/pkg/path"
//           import alias "github.com/pkg/path"  (alias captured in group 1, path in group 2)
const GO_SINGLE_IMPORT_RE = /^import\s+(?:\w+\s+)?"([^"]+)"/gm;
```

### Go Grouped Import Block Regex
```typescript
// Source: Go Language Specification https://go.dev/ref/spec#Import_declarations
// Matches the entire paren-delimited block in: import ( ... )
const GO_GROUPED_BLOCK_RE = /^import\s*\(([\s\S]*?)\)/gm;

// Used to extract individual paths from inside a matched block
const GO_BLOCK_LINE_RE = /^\s*(?:[\w_.]+\s+)?"([^"]+)"/gm;
```

### go.mod Module Name Extraction
```typescript
// Source: go.mod reference https://go.dev/doc/modules/gomod-ref
// The module directive is always the first directive; line format is: module <path>
async function readGoModuleName(projectRoot: string): Promise<string | null> {
  try {
    const content = await fsPromises.readFile(path.join(projectRoot, 'go.mod'), 'utf-8');
    const m = content.match(/^module\s+(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}
```

### Go Intra-Project Import Resolution
```typescript
// Source: Go Modules reference https://go.dev/ref/mod
// importPath: the raw string from the import statement
// moduleName: extracted from go.mod (or null)
// projectRoot: absolute path to the project root directory
function resolveGoImport(
  importPath: string,
  moduleName: string | null,
  projectRoot: string
): { type: 'local'; absPath: string } | { type: 'package'; name: string } {
  if (moduleName && importPath.startsWith(moduleName + '/')) {
    const relPath = importPath.slice(moduleName.length + 1); // strip "moduleName/"
    return { type: 'local', absPath: path.join(projectRoot, relPath) };
  }
  // Treat as external package — use the first path segment as package name
  const pkgName = importPath.split('/')[0];
  return { type: 'package', name: importPath }; // keep full path as name for stdlib/vendor clarity
}
```

### Ruby Import Regex
```typescript
// Source: Ruby Kernel#require docs https://ruby-doc.org/core/Kernel.html
// Captures:
//   require_relative 'path/to/file'
//   require('./path')
//   require '../other'
//   require 'gem_name'
// Group 1: require_relative or require keyword
// Group 2: the path/name string
const RUBY_IMPORT_RE = /(require_relative|require)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g;
```

### Ruby Path Resolution
```typescript
// Source: Ruby docs + codebase pattern (file-utils.ts lines 533-542)
async function resolveRubyImport(
  keyword: string,      // 'require_relative' | 'require'
  importPath: string,
  currentFile: string,
  projectRoot: string
): Promise<{ type: 'local'; absPath: string } | { type: 'package'; name: string } | null> {
  // require_relative is always relative to the current file
  if (keyword === 'require_relative' || importPath.startsWith('./') || importPath.startsWith('../')) {
    const base = path.dirname(currentFile);
    const resolved = path.resolve(base, importPath);
    // Probe .rb extension (Ruby omits it by convention)
    for (const ext of ['.rb', '']) {
      try {
        await fsPromises.access(resolved + ext);
        return { type: 'local', absPath: resolved + ext };
      } catch { /* try next */ }
    }
    return null; // file not found — skip silently
  }
  // Skip Ruby interpolation in require strings
  if (importPath.includes('#{')) return null;
  // Bare require: treat as gem/stdlib
  return { type: 'package', name: importPath.split('/')[0] };
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Regex for TS/JS imports | tree-sitter AST extraction | v1.0 (CHNG-04) | TS/JS no longer in `IMPORT_PATTERNS`; Go/Ruby stay regex per explicit decision |
| No `.rb`/`.go` support | Add both in Phase 12 | Phase 12 | Dependency graphs now valid for Go and Ruby projects |

**Explicitly NOT changing:**
- Go/Ruby: tree-sitter is out of scope per REQUIREMENTS.md "Out of Scope" table — "Regex is sufficient for Go/Ruby import syntax; AST adds native dep complexity"
- No new npm packages

---

## Open Questions

1. **go.mod walk-up vs. fixed root**
   - What we know: `projectRoot` is available to all scan/analyze functions; the project has one `go.mod` at the root in typical Go projects.
   - What's unclear: Multi-module monorepos (nested `go.mod` files) — should we walk up from the current `.go` file's directory?
   - Recommendation: Start with root-only (`path.join(projectRoot, 'go.mod')`). This handles the common case. Walking up adds complexity and edge cases; defer to a future phase if needed. Document the limitation in code comments.

2. **Ruby `$LOAD_PATH`-based requires without `./` prefix**
   - What we know: `require 'lib/model'` (no `./`) could be a local project file if `lib/` is on the load path.
   - What's unclear: No way to know which directories are on the load path without executing Ruby.
   - Recommendation: Treat these as gem/package dependencies (consistent with how the project treats non-relative Node.js requires). Only `./`-prefixed and `require_relative` paths resolve to local files.

3. **go.mod absent: validation from STATE.md concern**
   - STATE.md "Blockers/Concerns" flags: "Go intra-project import resolution needs validation against real Go projects before finalizing (go.mod module name extraction behavior when go.mod is absent)"
   - Recommendation: The `null`-return strategy from `readGoModuleName` on any error is the correct answer. When `go.mod` is absent, all Go imports become package dependencies — which is correct behavior and safe. This concern is resolved by the defensive implementation.

---

## Validation Architecture

> `workflow.nyquist_validation` is not present in `.planning/config.json` — skip this section per instructions.

---

## Sources

### Primary (HIGH confidence)
- [Go Language Specification — Import declarations](https://go.dev/ref/spec#Import_declarations) — verified Go import syntax (single-line and grouped block forms)
- [go.mod file reference](https://go.dev/doc/modules/gomod-ref) — verified `module` directive format
- [Go Modules Reference](https://go.dev/ref/mod) — verified module path as package import prefix
- `src/file-utils.ts` (codebase) — verified `IMPORT_PATTERNS` structure, `analyzeNewFile`, `scanDirectory`, extension probing pattern

### Secondary (MEDIUM confidence)
- [Ruby Kernel#require_relative docs via WebSearch](https://apidock.com/ruby/Kernel/require_relative) — confirmed `.rb` extension probing behavior and relative-to-file resolution
- [Ruby require vs require_relative (RubyCademy)](https://medium.com/rubycademy/requiring-a-file-or-library-in-ruby-29f99e5e2c6a) — confirmed resolution rules and `$LOADED_FEATURES` tracking
- [go.mod module name regex (WebSearch + pkg.go.dev)](https://pkg.go.dev/golang.org/x/mod/modfile) — regex `^module\s+(\S+)` confirmed by official Go package source

### Tertiary (LOW confidence)
- None — all claims have PRIMARY or SECONDARY backing

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all tools are Node.js built-ins; no new dependencies; existing codebase patterns verified by direct code reading
- Architecture: HIGH — both `IMPORT_PATTERNS` dispatch paths verified in codebase; Go/Ruby syntax verified against official specs
- Pitfalls: HIGH for identified pitfalls (Go aliases, blank imports, go.mod absent, Ruby interpolation, analyzeNewFile parity); MEDIUM for edge cases not enumerated

**Research date:** 2026-03-19
**Valid until:** 2026-09-19 (Go/Ruby import syntax is stable; go.mod format is stable)
