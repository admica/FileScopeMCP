---
name: filescope-mcp
description: Codebase intelligence via FileScopeMCP — symbol lookup, dependency mapping, importance ranking, and semantic search. Use when navigating unfamiliar code, planning refactors, assessing change impact, or finding entry points in a large project.
version: 1.0.0
author: admica
license: All Rights Reserved
metadata:
  hermes:
    tags: [codebase, navigation, dependencies, symbols, mcp]
    category: development
---

# FileScopeMCP Tool Guide

FileScopeMCP is an MCP server that indexes your codebase and exposes it as tools. This skill teaches you when and how to use each tool effectively.

## Getting Oriented in a New Codebase

Start here when you enter an unfamiliar project:

1. **`status()`** — verify FileScopeMCP is initialized and healthy. Check file count, broker state, last update time.
2. **`find_important_files(maxItems: 10)`** — see the top 10 most critical files. These are your entry points.
3. **`get_file_summary(filepath)`** — read the summary of each important file. Gives you: what it does, what it depends on, what depends on it, exported symbols.

This three-step sequence gives you a working mental model in seconds.

## Tool Reference

### Navigation Tools

**`find_symbol(name, kind?, exportedOnly?)`**
Resolve a symbol name to its file + line range. Exact case-sensitive match. Trailing `*` enables prefix match.
- Use when you know a function/class name but not where it lives
- `kind` accepts: function, class, interface, type, enum, const, module, struct
- `exportedOnly` defaults true — pass false to find private helpers
- Example: `find_symbol("processFile")` → `{path: "src/coordinator.ts", startLine: 142, endLine: 198}`

**`search(query, maxItems?)`**
Semantic search across symbols, summaries, purposes, and paths. Ranked results.
- Use when you have a concept ("authentication", "rate limiting") but no exact name
- Searches LLM-generated summaries, so it understands intent not just strings
- Example: `search("dependency cycle detection")` → files related to circular imports

**`get_file_summary(filepath)`**
Full intelligence on one file: summary, importance, dependencies (with edge types), dependents (with import lines), exported symbols, concepts, change impact, staleness.
- Use before editing any file to understand its role and blast radius
- `importLines` in dependents tells you exactly where each consumer imports from this file

### Dependency Analysis

**`find_callers(name, filePath?, maxItems?)`**
Every symbol that calls the named symbol. Case-sensitive exact match.
- Use before renaming or changing a function's signature
- `filePath` disambiguates when multiple files define the same name
- Currently supports TS/JS call-site edges

**`find_callees(name, filePath?, maxItems?)`**
Every symbol the named symbol calls.
- Use to understand what a function depends on before modifying it
- Helps trace execution flow through the codebase

**`detect_cycles()`**
All circular dependency groups in the project.
- Use to identify tightly-coupled modules before refactoring
- Returns cycle groups (arrays of file paths)

**`get_cycles_for_file(filepath)`**
Cycles involving one specific file.
- Use when you suspect a file is part of a circular dependency

**`get_communities(file_path?)`**
Louvain-clustered file communities — groups of tightly coupled files.
- Use to understand module boundaries and which files change together
- Filter to one file's community to see its neighborhood

### Project-Level Tools

**`list_files(maxItems?)`**
All tracked files. Without maxItems: nested directory tree. With maxItems: flat list sorted by importance.
- Use for broad project overview
- Prefer `find_important_files` when you only need the top N

**`find_important_files(maxItems?, minImportance?)`**
Top files by importance with dependency counts and staleness flags.
- Use to find critical files and check if their metadata is stale

**`list_changed_since(since, maxItems?)`**
Files changed since a timestamp or git SHA.
- Use after multi-file edits to see what changed
- Accepts ISO-8601 (`2026-04-23T10:00:00Z`) or git SHA (`860fe61`)

### Mutation Tools

**`set_base_directory(path)`**
Point FileScopeMCP at a different project directory. Re-initializes everything.
- Use when switching between projects in one session

**`set_file_importance(filepath, importance)`**
Override auto-calculated importance (0-10).
- Use when the algorithm undervalues a critical config or entrypoint

**`set_file_summary(filepath, summary)`**
Override LLM-generated summary.
- Use when auto-summary is wrong or you want custom annotations

**`scan_all(min_importance?, remaining_only?)`**
Queue files for LLM summarization. Requires active broker + LLM backend.
- `remaining_only: true` skips already-summarized files (incremental scan)
- Use after first setup or major codebase changes

**`exclude_and_remove(filepath)`**
Permanently exclude a file/pattern from tracking. DESTRUCTIVE — cannot be undone without re-scan.
- Use for generated files, build artifacts, false positives
- Adds pattern to `.filescopeignore`

## Common Workflows

### "What calls this function and what would break if I change it?"
```
find_callers("functionName")       → list of callers
get_file_summary("path/to/file")   → see dependents with import lines
```

### "I need to understand this module before editing it"
```
get_file_summary("src/coordinator.ts")  → summary, deps, dependents, exports
find_callees("mainExportedFn")      → what it calls internally
get_communities("src/coordinator.ts")   → its architectural neighborhood
```

### "Where should I add this new feature?"
```
search("authentication middleware")  → find related files by concept
find_important_files(maxItems: 5)    → see the highest-traffic files
get_file_summary("likely-file.ts")   → verify it's the right place
```

### "What changed since my last session?"
```
list_changed_since("abc1234")        → files changed since that commit
status()                             → check for stale summaries
scan_all(remaining_only: true)       → refresh any unsummarized files
```

### "Is there a circular dependency problem?"
```
detect_cycles()                      → all cycle groups
get_cycles_for_file("suspect.ts")    → cycles involving one file
```

## Tips

- Call `status()` first if tools return `NOT_INITIALIZED` — the server may need `set_base_directory`.
- `find_symbol` is faster than grep for finding where something is defined.
- `search` understands concepts because it searches LLM summaries, not just text.
- `get_file_summary` is your single best tool — use it before editing anything.
- `unresolvedCount` in caller/callee results means stale edges exist — run `scan_all` to refresh.
- The broker must be connected for `scan_all` to work. Check `status()` for broker state.
