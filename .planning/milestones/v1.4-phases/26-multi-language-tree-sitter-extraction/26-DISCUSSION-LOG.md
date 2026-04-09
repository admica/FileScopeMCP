# Phase 26: Multi-Language Tree-sitter Extraction - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-09
**Phase:** 26-multi-language-tree-sitter-extraction
**Areas discussed:** Grammar packages, Extractor architecture, TS/JS richer edges, Edge weight counting
**Mode:** --auto (all decisions auto-selected)

---

## Grammar Packages

| Option | Description | Selected |
|--------|-------------|----------|
| Official tree-sitter org packages | tree-sitter-python, tree-sitter-c, tree-sitter-rust, tree-sitter-go — canonical npm packages matching installed tree-sitter@0.25.x | ✓ |
| Community/alternative packages | Various forks or alternative grammar implementations | |

**User's choice:** [auto] Official tree-sitter org packages (recommended default)
**Notes:** These are the standard, well-maintained grammars. ABI compatibility with tree-sitter 0.25.x needs verification during research/planning.

---

## Extractor Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Per-language extractors | Dedicated function per language, each walks language-specific AST nodes | ✓ |
| Shared generic walker | One function that dispatches on node type strings for all languages | |

**User's choice:** [auto] Per-language extractors (recommended default)
**Notes:** Matches existing pattern (TS/JS, Go, Ruby each have dedicated extractors). Each language has distinct import AST structures making a generic walker awkward.

---

## TS/JS Richer Edge Types

| Option | Description | Selected |
|--------|-------------|----------|
| Extend existing walker | Enhance extractTsJsEdges() and ast-parser.ts to detect re_exports and inherits | ✓ |
| Separate extraction pass | Add a second AST walk for richer edge types | |

**User's choice:** [auto] Extend existing walker (recommended default)
**Notes:** Re-exports already partially detected. Inherits via class_heritage/extends_clause nodes. Single-pass is more efficient.

---

## Edge Weight Counting

| Option | Description | Selected |
|--------|-------------|----------|
| Post-extraction aggregation | Extractors emit per-statement edges, extractEdges() aggregates duplicates | ✓ |
| In-extractor dedup | Each extractor tracks and counts duplicates internally | |

**User's choice:** [auto] Post-extraction aggregation (recommended default)
**Notes:** Keeps extractor logic simple. Map<target, EdgeResult> accumulator in extractEdges() merges duplicates and sums weights.

---

## Claude's Discretion

- Internal AST walker implementation details
- Parser instance management
- Test fixture contents
- Shared helper extraction for common post-extraction steps

## Deferred Ideas

None — discussion stayed within phase scope.
