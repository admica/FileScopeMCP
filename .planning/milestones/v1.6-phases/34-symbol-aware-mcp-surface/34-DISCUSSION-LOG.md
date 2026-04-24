# Phase 34: Symbol-Aware MCP Surface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 34-symbol-aware-mcp-surface
**Areas discussed:** find_symbol matching details, dependents[] aggregation shape, Repository helper design, Tool description for LLMs
**Mode:** interactive selection; user deferred substantive answers to Claude with note "this whole app is for YOU remember"

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| find_symbol matching details | Prefix syntax, maxItems default, result ordering, kind filter validation | ✓ |
| dependents[] aggregation shape | Aggregate per source path vs flat per row | ✓ |
| Repository helper design | Extend existing getSymbolsByName vs add new findSymbols | ✓ |
| Tool description for LLMs | Verbose with examples vs terse | ✓ |

**User's choice:** All four selected; user requested Claude supply the answers ("give me your best answers here, this whole app is for YOU remember. do we need all these things? what would you want?").

**Notes:** User explicitly framed the MCP surface as an LLM-first artifact. No interactive Q&A on the sub-questions — Claude locked decisions directly in CONTEXT.md under D-01 through D-26.

---

## find_symbol matching details

**Claude's picks:**
- Trailing `*` only — middle/leading `*` treated as literal character (no second error class)
- Case-sensitivity via SQLite `GLOB` (recommended) or `LIKE … ESCAPE '\\'` with `PRAGMA case_sensitive_like` — planner picks
- `maxItems` default 50, hard clamp [1, 500]
- Ordering: `isExport DESC, path ASC, startLine ASC`
- Unknown `kind` → empty result, not an error
- `total` = pre-truncation count; `truncated` field omitted when false

**Rationale:** Keeps FIND-05 (NOT_INITIALIZED only) clean, matches existing `list_files` / `find_important_files` envelope precedent, deterministic ordering for agent-side diffing.

---

## dependents[] aggregation shape

**Claude's picks:**
- Aggregate one entry per source path (matches SC #5 plural-arrays wording exactly)
- `importedNames` deduped + sorted alphabetically
- `importLines` preserves all occurrences sorted ascending
- NULL `imported_names` rows → empty array (phase 33 D-10 fallback)
- Breaking wire shape change from `string[]` to `Array<{path, …}>` — explicitly sanctioned by SUM-03

**Alternatives considered:** Flat one-entry-per-row with duplicate `path` values. Rejected — forces agents to do the grouping themselves; SC #5 wording unambiguously specifies plural arrays per dependent.

---

## Repository helper design

**Claude's picks:**
- New helper `findSymbols({name, kind?, exportedOnly, limit})` — wraps phase-33 primitive, supports prefix + truncation + count
- Old `getSymbolsByName(name, kind?)` stays for phase-33 exact-match tests
- New helper `getDependentsWithImports(targetPath)` — aggregated rich shape for MCP only
- Old `getDependents(path): string[]` stays — still feeds `FileNode.dependents` at repository.ts:54; no cascade into nexus/broker

**Alternatives considered:** Overload existing helpers with options objects. Rejected — positional-arg games for the 3 existing phase-33 test callers; cleaner to add a sibling helper.

---

## Tool description for LLMs

**Claude's picks:**
- Verbose long-form descriptions with inline examples — MCP descriptions drive LLM tool selection
- `find_symbol`: cover purpose, prefix-rule example (`React*`), kind enum values, `exportedOnly` default semantics, response shape, when-to-use vs `get_file_summary`, error policy
- `get_file_summary`: append sentence about new `exports[]` and shape-changed `dependents[]` with a navigation hint

**Rationale:** This surface IS read by LLMs making tool-selection decisions. Under-describing costs agent accuracy; over-describing costs a few dozen tokens per session — net positive.

---

## Claude's Discretion

- `GLOB` vs `LIKE … ESCAPE` for case-sensitive matching
- Internal helper names (`findSymbols` vs `queryMatchingSymbols` vs `searchSymbols`)
- Test file naming + fixture choices
- Whether to extract a small `normalizeFindSymbolArgs()` helper in mcp-server.ts or inline

## Deferred Ideas

- Cross-file reference lookup (future milestone)
- Fuzzy / regex / case-insensitive search
- Rename/move tracking
- Python/Go/Ruby symbol emission (v1.7)
- Deletion tombstones (explicitly rejected for v1.6)
- `get_symbols_for_file` as standalone tool (redundant with enriched `get_file_summary.exports`)
