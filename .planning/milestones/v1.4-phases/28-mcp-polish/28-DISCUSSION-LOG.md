# Phase 28: MCP Polish - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-09
**Phase:** 28-mcp-polish
**Mode:** --auto (all decisions auto-selected)
**Areas discussed:** Token budget scope, list_files behavior, find_important_files parameter, Dependency enrichment shape

---

## Token Budget Scope

| Option | Description | Selected |
|--------|-------------|----------|
| list_files and find_important_files only | Matches roadmap success criteria which names these two tools | :heavy_check_mark: |
| All list-returning tools (including get_communities) | Broader scope but not in success criteria | |

**User's choice:** [auto] list_files and find_important_files only (recommended default)
**Notes:** Success criteria explicitly names these two tools. get_communities is a new Phase 27 tool and can be enhanced later.

---

## list_files with maxItems

| Option | Description | Selected |
|--------|-------------|----------|
| Flat list when maxItems provided, tree when omitted | Success criteria says "ordered by importance" requiring flat list; tree preserved for no-param case | :heavy_check_mark: |
| Always flat list | Simpler but breaks current tree consumers | |
| Truncate tree by leaf count | Complex tree truncation with no clear semantics | |

**User's choice:** [auto] Flat list when maxItems provided, tree when omitted (recommended default)
**Notes:** "Ordered by importance" in success criteria implies flat list. Tree truncation is meaningless. Keeping tree when maxItems is omitted preserves current behavior.

---

## find_important_files Parameter

| Option | Description | Selected |
|--------|-------------|----------|
| Replace limit with maxItems | Zero legacy installs, cleaner single parameter | :heavy_check_mark: |
| Keep both limit and maxItems | Backward compatible but redundant | |
| Add maxItems alongside limit | Confusing two parameters that do the same thing | |

**User's choice:** [auto] Replace limit with maxItems (recommended default)
**Notes:** Per project memory: "No backward compatibility concerns -- zero legacy installs to support." Single parameter is cleaner.

---

## Dependency Enrichment Shape

| Option | Description | Selected |
|--------|-------------|----------|
| Change dependencies from string[] to {path, edgeType, confidence}[] | Clean break, enriched data inline | :heavy_check_mark: |
| Keep string[] and add separate dependencyEdges field | Backward compatible but two fields for same data | |
| Add edge metadata as separate lookup tool | Over-engineers the solution | |

**User's choice:** [auto] Change dependencies from string[] to {path, edgeType, confidence}[] (recommended default)
**Notes:** Zero legacy installs means no backward compat concern. Inline enrichment is the cleanest approach. Dependents stay as string[] per success criteria scope.

---

## Claude's Discretion

- Whether to add `weight` to dependency enrichment (success criteria only requires edge_type and confidence)
- Internal helper organization for truncation wrappers
- Test structure decisions

## Deferred Ideas

None -- all decisions within phase scope.
