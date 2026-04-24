# Phase 33: Symbol Extraction Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 33-symbol-extraction-foundation
**Mode:** `--auto` — Claude auto-selected the recommended option for every gray area. No interactive questions asked.
**Areas discussed:** Parser architecture, Schema layout, Bulk extraction trigger, Symbol kind typing, Default export handling, CLI output format, Performance baseline capture, Storage batching

---

## Parser Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Extend existing `extractRicherEdges()` to also emit symbols + per-import names/lines | Single function produces everything; `extractSnapshot()` left intact for semantic-diff | ✓ |
| (b) Write new unified `extractAll()` and deprecate `extractRicherEdges` + `extractSnapshot` | Cleanest boundary but forces semantic-diff migration work unrelated to phase 33 | |
| (c) Keep both, duplicate AST walk inside each | Violates SYM-02 (single-pass) | |

**Selected:** (a) — recommended. Keeps semantic-diff untouched and satisfies SYM-02.
**Notes:** Planner decides whether to widen return type of `extractRicherEdges` in place or rename (e.g., `extractParseResult`). Either is acceptable.

---

## Import-Name Storage Schema

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Additive JSON-array columns on `file_dependencies` | `imported_names TEXT` (JSON) + `import_line INTEGER`; mirrors existing `exports_snapshot` JSON-blob pattern | ✓ |
| (b) Separate `file_dependency_imports` join table | Normalized per-name/line rows; more JOINs in Phase 34 queries | |
| (c) Columns + join table | Over-engineered for v1.6 scope | |

**Selected:** (a) — recommended. Additive, no breaking changes (IMP-03), consistent with existing JSON-blob pattern.
**Notes:** Namespace imports encode as `["*"]`. Default imports as `["default"]`. Non-TS/JS rows keep NULL.

---

## Bulk Extraction Trigger

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Run on schema version bump (tied to migration 0005) | Migrations run SQL only; extraction is application code — awkward coupling | |
| (b) Per-query lazy fallback | Violates SYM-05 | |
| (c) One-shot flag in `kv_state` / metadata row, checked at coordinator startup post-migration | Clean separation, idempotent, matches existing `migrate-json-to-sqlite` pattern | ✓ |

**Selected:** (c) — recommended.
**Notes:** Flag name `symbols_bulk_extracted` with ISO timestamp value. On startup: if flag unset, iterate TS/JS files via `getAllFiles()`, run extraction, insert, set flag.

---

## Symbol Kind Typing

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Rename existing `ExportedSymbol.kind = 'variable'` → `'const'` | Breaks `exports_snapshot` JSON format for historical rows | |
| (b) New `Symbol` interface distinct from `ExportedSymbol` | Phase 33 symbols = new concept + new table; semantic-diff path untouched | ✓ |
| (c) Widen ExportedSymbol enum to accept both, coerce at write-time | Keeps two kind vocabularies alive in one type; confusing | |

**Selected:** (b) — recommended. Introduces a clean `Symbol` type with exactly the 6 Phase 33 kinds.
**Notes:** Location TBD by planner — likely `src/db/symbol-types.ts` or added to `src/types.ts`.

---

## Default Export Handling

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Emit all defaults (anonymous included) under name `"default"` | `find_symbol("default")` returns every project default — not useful | |
| (b) Skip defaults entirely | Loses named defaults like `export default class Foo {}` | |
| (c) Named default = named (kind from decl), anonymous default = skip | Preserves useful lookups, skips noise | ✓ |

**Selected:** (c) — recommended.

---

## `inspect-symbols` CLI Output Format

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Plain text (`NAME  KIND  L{start}-L{end}  [export]`) with `--json` flag for JSONL | Terminal-friendly default, tooling-friendly via flag | ✓ |
| (b) JSON-only output | Forces pipe-through-jq for human reading | |
| (c) Pretty table | Wider than terminals; extra dep or formatting code | |

**Selected:** (a) — recommended.

---

## Performance Baseline Capture (PERF-01)

| Option | Description | Selected |
|--------|-------------|----------|
| (a) One-off manual measurement committed as markdown | Not reproducible for Phase 35 regression check | |
| (b) `npm run bench-scan` script → JSON baseline file, committed BEFORE Phase 33 code lands | Reproducible, reusable by PERF-02, captured at clean baseline | ✓ |
| (c) Inline timing logs at scan path | No committed reference; lost after restart | |

**Selected:** (b) — recommended.
**Notes:** Output at `.planning/phases/33-symbol-extraction-foundation/baseline.json`. First Plan of phase 33 should capture baseline before any symbol code is written.

---

## Storage Batching

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Per-file `upsertSymbols` in its own transaction | Simple but decouples symbols from edges (possible inconsistency mid-scan) | |
| (b) Bulk insert all files at scan end | Violates existing per-file transaction pattern; breaks watcher path (per-file changes) | |
| (c) Symbols share the coordinator's existing per-file edge-write transaction | Atomic per file; consistent with `setEdges` pattern; same path works for watcher | ✓ |

**Selected:** (c) — recommended.

---

## Claude's Discretion

- Migration filename (`0005_add_symbols_and_import_metadata.sql` suggested)
- Whether to add a new `kv_state` table or reuse an existing metadata row for the bulk-extraction flag
- Parser function rename vs widen-in-place
- Fixture selection for `medium-repo` benchmark

## Deferred Ideas

- Python/Go/Ruby symbol extraction (v1.7)
- Deletion tombstones for `list_changed_since` (explicit v1.6 cut)
- Lazy per-query extraction path (rejected — SYM-05)
- React `component` kind (rejected — SYM-07)
- FileWatcher symbol re-extraction (Phase 35)
- `find_symbol` MCP tool (Phase 34)
