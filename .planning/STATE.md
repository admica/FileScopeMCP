---
gsd_state_version: 1.0
milestone: v1.7
milestone_name: Multi-Lang Symbols + Call-Site Edges
status: executing
stopped_at: Phase 36 context gathered
last_updated: "2026-04-24T14:59:08.520Z"
last_activity: 2026-04-24 -- Phase 36 execution started
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 3
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-24)

**Core value:** LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.
**Current focus:** Phase 36 — schema-migration-multi-language-symbols

## Current Position

Phase: 36 (schema-migration-multi-language-symbols) — EXECUTING
Plan: 1 of 3
Status: Executing Phase 36
Last activity: 2026-04-24 -- Phase 36 execution started

## Accumulated Context

### Decisions

All decisions logged in PROJECT.md Key Decisions table.

v1.6-specific decisions from scope audit (2026-04-23):

- File-granular → symbol-granular level-of-detail shift is the one structural change; all other LLM-surface gaps are workarounds for this mismatch
- Three tools only (`find_symbol`, enriched `get_file_summary`, `list_changed_since`) — everything else cut to avoid bloat
- TS/JS only v1.6; Python/Go/Ruby deferred to v1.7 pending adoption signal
- Parser emits symbols in single AST pass alongside edges — no second walk
- Additive schema only (`symbols` table); no breaking changes to existing tool responses
- Deletion tracking deferred — `list_changed_since` returns only existing files with mtime
- [Phase 34]: Inlined getDependentsWithImports return type — single call site, no new DependentWithImports interface in symbol-types.ts
- [Phase 34]: Used direct INSERT helper insertDepRow() in tests rather than extending setEdges() — needed fine-grained control over NULL imported_names and package_import rows
- [Phase 34]: Established GLOB+bracket-escape as the case-sensitive prefix-match pattern (new to codebase, no PRAGMA needed)
- [Phase 34]: Extended tests/unit/tool-outputs.test.ts as the contract test home (R-3: tests/contract/ does not exist); avoided a single-file directory
- [Phase 34]: Inlined find_symbol clamp + projection in the handler (5 lines) rather than extracting normalizeFindSymbolArgs()
- [Phase 34]: find_symbol description authored as string[].join(' ') literal so the length probe can regex-extract without JS eval

v1.7 scoping decisions (2026-04-24):

- Multi-lang symbol extraction covers Python + Go + Ruby
- D-06 REVERSED: Go uses `tree-sitter-go@0.25.0` for symbol extraction (grammar now stable); `resolveGoImports` regex stays for edge extraction only
- Ruby ships via `tree-sitter-ruby@0.23.1` AST extraction (STACK.md live-validated); ARCHITECTURE.md conservative "defer Ruby" recommendation superseded
- Symbol-level call-site edges are TS/JS only for v1.7; Python/Go/Ruby symbol-edges deferred to v1.8
- Edge depth limited to call-site resolution — no class-inheritance-at-symbol-level in v1.7
- Deletion tombstones on `list_changed_since` stay deferred (no adoption pull)
- Perf tuning of v1.6 scan regression (+13.75% / +9.64%) deferred — still under 15% soft threshold
- `symbol_dependencies` uses integer FK design (ARCHITECTURE.md) with atomic transaction-scoped ID replacement (FLAG-02 resolved) — not natural key FK substitute
- Tool names: `find_callers` / `find_callees` (not `get_` prefix) — consistency with existing `find_symbol`
- Per-language `kv_state` keys: `symbols_py_bulk_extracted`, `symbols_go_bulk_extracted`, `symbols_rb_bulk_extracted` — do NOT reuse `symbols_bulk_extracted` from v1.6
- VERIFICATION.md is a phase exit gate for every v1.7 phase — not retroactive artifact at milestone close

### Pending Todos

None.

### Blockers/Concerns

None — roadmap is ready.

## Deferred Items

Items acknowledged and deferred at milestone close on 2026-04-24:

| Category | Item | Status |
|----------|------|--------|
| quick_task | 1-update-readme-md-and-root-roadmap-md-to- | missing (pre-v1.6 artifact, no completion marker) — to be closed in Phase 39 |
| quick_task | 260323-kgd-auto-init-mcp-to-cwd-rename-set-project- | missing (commit 50b7016 landed; dir has no SUMMARY) — to be closed in Phase 39 |
| quick_task | 260324-0yz-comprehensive-documentation-update-readm | missing (commit a96b263 landed; dir has no SUMMARY) — to be closed in Phase 39 |
| quick_task | 260401-a19-fix-double-change-impact-and-structured-ou | missing (pre-v1.6 artifact, no completion marker) — to be closed in Phase 39 |
| quick_task | 260401-b7k-fix-cpp-dependency-parsing-and-importance | missing (pre-v1.6 artifact, no completion marker) — to be closed in Phase 39 |
| quick_task | 260414-otc-make-sure-the-install-setup-scripts-of-t | missing (commit 101d8f0 landed; dir has no SUMMARY) — to be closed in Phase 39 |
| quick_task | 260416-b8w-fix-nexus-tree-view-repo-store-queries-a | missing (commit 2d1177b landed; dir has no SUMMARY) — to be closed in Phase 39 |

All 7 are historical quick tasks from v1.0-v1.5. All scheduled for formal closure in Phase 39 (DEBT-01).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260323-kgd | Auto-init MCP to CWD, rename set_project_path to set_base_directory | 2026-03-23 | 50b7016 | [260323-kgd](./quick/260323-kgd-auto-init-mcp-to-cwd-rename-set-project-/) |
| 260324-0yz | Comprehensive documentation update: README and config.example.json for v1.2 | 2026-03-24 | a96b263 | [260324-0yz](./quick/260324-0yz-comprehensive-documentation-update-readm/) |
| 260402-u6p | Rewrite README.md to accurately reflect current codebase; extract Ollama guides to docs/ollama-setup.md | 2026-04-02 | 539f00b | [260402-u6p](./quick/260402-u6p-rewrite-readme-md-to-accurately-reflect-/) |
| 260414-otc | Polish setup-llm.sh WSL guide (AMD Vulkan canonical path) and scrub Ollama/11434/Modelfile from all user-facing docs; replace docs/ollama-setup.md with docs/llm-setup.md | 2026-04-14 | 101d8f0 | [260414-otc](./quick/260414-otc-make-sure-the-install-setup-scripts-of-t/) |
| 260416-b8w | Fix Nexus tree view "No files found" — query functions now use absolute paths for DB and return relative paths | 2026-04-16 | 2d1177b | [260416-b8w](./quick/260416-b8w-fix-nexus-tree-view-repo-store-queries-a/) |

## Session Continuity

Last activity: 2026-04-24
Stopped at: Phase 36 context gathered
Resume file: --resume-file

**Next:** `/gsd-plan-phase 36` to begin planning Phase 36: Schema Migration + Multi-Language Symbols.

**Planned Phase:** 36 (schema-migration-multi-language-symbols) — 3 plans — 2026-04-24T14:58:19.033Z
