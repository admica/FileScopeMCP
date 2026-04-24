---
phase: quick
plan: 260401-b7k
subsystem: file-utils
tags: [bug-fix, cpp, c, dependency-parsing, importance-scoring]
dependency_graph:
  requires: []
  provides: [correct-cpp-dependency-extraction, correct-cpp-importance-scores]
  affects: [src/file-utils.ts]
tech_stack:
  added: []
  patterns: [isCppFile boolean guard, quoted-vs-angled include disambiguation]
key_files:
  created: []
  modified:
    - src/file-utils.ts
decisions:
  - "isCppFile boolean defined per extension to gate the quoted-vs-angled branch"
  - "platformio and CMakeLists.txt added to significantNames for boost"
metrics:
  duration_minutes: 15
  completed_date: "2026-04-01"
  tasks_completed: 1
  files_modified: 1
---

# Quick Task 260401-b7k: Fix C/C++ Dependency Parsing and Importance Scoring

**One-liner:** Fixed three bugs in src/file-utils.ts: C/C++ IMPORT_PATTERNS regex had no capture groups (all includes silently dropped), analyzeNewFile misclassified local C includes as packages, and calculateInitialImportance had no C/C++ extension case.

## Problem

`IMPORT_PATTERNS` for C/C++ extensions had no capture groups so `match[1]` was always `undefined` and all includes were silently dropped. The generic import branch classified all non-dot-prefixed imports as packages, misclassifying C/C++ local ("quoted") includes as npm packages. `calculateInitialImportance` had no case for any C/C++ extension, causing all C/C++ files to default to importance 0.

## What Was Done

### Edit 1: IMPORT_PATTERNS — fix regex and add extensions

Added capture groups to the C/C++ include regex and added missing extensions `.cc`, `.cxx`, `.h`, `.hpp`, `.hh`, `.hxx`:

```typescript
'.c': /#include\s+["<]([^">]+)[">]/g,
'.cpp': /#include\s+["<]([^">]+)[">]/g,
'.cc': /#include\s+["<]([^">]+)[">]/g,
// ... and .cxx, .h, .hpp, .hh, .hxx
```

### Edit 2: analyzeNewFile — quoted vs angled include disambiguation

Added `isCppFile` boolean guard; quoted includes (`"local.h"`) treated as local file dependencies, angled includes (`<system.h>`) treated as system/package dependencies:

```typescript
const isCppFile = ['.c','.cpp','.cc','.cxx','.h','.hpp','.hh','.hxx'].includes(ext);
if (normalizedResolvedPath.includes('node_modules') ||
    (!isCppFile && !importPath.startsWith('.') && !importPath.startsWith('/')) ||
    (isCppFile && match[0].includes('<')))
```

### Edit 3: calculateInitialImportance — add C/C++ scores

Added C/C++ extensions with base score `+2` and added `platformio` and `CMakeLists.txt` to `significantNames` for boost:

```typescript
case '.c':
case '.cpp':
case '.cc':
case '.cxx':
case '.h':
case '.hpp':
case '.hh':
case '.hxx':
  importance += 2;
  break;
```

## Commits

| Task | Commit  | Message                                              |
|------|---------|------------------------------------------------------|
| 1    | 86bbf0c | fix: C/C++ dependency parsing and importance scoring |

## Verification

- `npm run build` — succeeded
- `npx vitest run` — all tests passed

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — changes are parser logic corrections with no new network endpoints, auth paths, or trust boundary changes.

## Self-Check: PASSED

- `src/file-utils.ts` — modified, verified present
- Commit 86bbf0c — verified in git log
