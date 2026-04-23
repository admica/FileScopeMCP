# Roadmap: FileScopeMCP

## Milestones

- ✅ **v1.0 Autonomous File Metadata** — Phases 1-9 (shipped 2026-03-19)
- ✅ **v1.1 Hardening** — Phases 10-15 (shipped 2026-03-20)
- ✅ **v1.2 LLM Broker** — Phases 16-19 (shipped 2026-03-23)
- ✅ **v1.3 Nexus** — Phases 20-24 (shipped 2026-04-03)
- ✅ **v1.4 Deep Graph Intelligence** — Phases 25-28 (shipped 2026-04-09)
- ✅ **v1.5 Production-Grade MCP Intelligence Layer** — Phases 29-32 (shipped 2026-04-23)
- 🚧 **v1.6 Symbol-Level Intelligence** — Phases 33-35 (in progress)

## Phases

<details>
<summary>✅ v1.0 Autonomous File Metadata (Phases 1-9) — SHIPPED 2026-03-19</summary>

- [x] Phase 1: SQLite Storage (3/3 plans) — completed 2026-03-02
- [x] Phase 2: Coordinator + Daemon Mode (2/2 plans) — completed 2026-03-03
- [x] Phase 3: Semantic Change Detection (2/2 plans) — completed 2026-03-18
- [x] Phase 4: Cascade Engine + Staleness (2/2 plans) — completed 2026-03-18
- [x] Phase 5: LLM Processing Pipeline (3/3 plans) — completed 2026-03-18
- [x] Phase 6: Verification & Tech Debt Cleanup (2/2 plans) — completed 2026-03-18
- [x] Phase 7: Fix change_impact Pipeline (1/1 plan) — completed 2026-03-18
- [x] Phase 8: Integration Fixes (2/2 plans) — completed 2026-03-19
- [x] Phase 9: Verification Documentation (2/2 plans) — completed 2026-03-19

See: `.planning/milestones/v1.0-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.1 Hardening (Phases 10-15) — SHIPPED 2026-03-20</summary>

- [x] Phase 10: Code Quality and Bug Fixes — completed 2026-03-19
- [x] Phase 11: .filescopeignore Support — completed 2026-03-19
- [x] Phase 12: Go and Ruby Language Support — completed 2026-03-19
- [x] Phase 13: Streaming Directory Scan — completed 2026-03-20
- [x] Phase 14: mtime-Based Lazy Validation — completed 2026-03-20
- [x] Phase 15: Cycle Detection — completed 2026-03-20

See: `.planning/milestones/v1.1-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.2 LLM Broker (Phases 16-19) — SHIPPED 2026-03-23</summary>

- [x] Phase 16: Broker Core (2/2 plans) — completed 2026-03-22
- [x] Phase 17: Instance Client + Pipeline Wiring (2/2 plans) — completed 2026-03-22
- [x] Phase 18: Cleanup (2/2 plans) — completed 2026-03-22
- [x] Phase 19: Observability (2/2 plans) — completed 2026-03-23

See: `.planning/milestones/v1.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.3 Nexus (Phases 20-24) — SHIPPED 2026-04-03</summary>

- [x] Phase 20: Server Skeleton + Repo Discovery (3/3 plans) — completed 2026-04-01
- [x] Phase 21: File Tree + Detail Panel (2/2 plans) — completed 2026-04-02
- [x] Phase 22: Dependency Graph (2/2 plans) — completed 2026-04-02
- [x] Phase 23: System View + Live Activity (2/2 plans) — completed 2026-04-02
- [x] Phase 24: Polish (3/3 plans) — completed 2026-04-03

See: `.planning/milestones/v1.3-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.4 Deep Graph Intelligence (Phases 25-28) — SHIPPED 2026-04-09</summary>

- [x] Phase 25: Schema Foundation + LanguageConfig Scaffolding (2/2 plans) — completed 2026-04-09
- [x] Phase 26: Multi-Language Tree-sitter Extraction (2/2 plans) — completed 2026-04-09
- [x] Phase 27: Community Detection (2/2 plans) — completed 2026-04-09
- [x] Phase 28: MCP Polish (2/2 plans) — completed 2026-04-09

See: `.planning/milestones/v1.4-ROADMAP.md` for full phase details.

</details>

<details>
<summary>✅ v1.5 Production-Grade MCP Intelligence Layer (Phases 29-32) — SHIPPED 2026-04-23</summary>

- [x] Phase 29: Broker Lifecycle Hardening (2/2 plans) — completed 2026-04-17
- [x] Phase 30: MCP Spec Compliance (2/2 plans) — completed 2026-04-17
- [x] Phase 31: Test Infrastructure (3/3 plans) — completed 2026-04-18
- [x] Phase 32: Zero-Config Auto-Registration (4/4 plans) — completed 2026-04-22

See: `.planning/milestones/v1.5-ROADMAP.md` for full phase details.

</details>

### 🚧 v1.6 Symbol-Level Intelligence (In Progress)

**Milestone Goal:** Elevate FileScopeMCP from file-granular to symbol-granular for three daily-use LLM queries — kill grep for symbol navigation, expose import-names on dependent edges, add "changed since" re-orientation.

- [x] **Phase 33: Symbol Extraction Foundation** — Emit top-level symbols (name, kind, line range, export flag) and imported-name metadata during the existing TS/JS AST walk; add `symbols` schema, repository functions, migration-time bulk extraction, and `npm run inspect-symbols` CLI (completed 2026-04-23)
- [ ] **Phase 34: Symbol-Aware MCP Surface** — New `find_symbol(name, kind?, exportedOnly=true)` tool and enriched `get_file_summary` response (`exports[]` + `dependents[]` upgraded with `importedNames[]` and `importLines[]`)
- [ ] **Phase 35: Changed-Since Tool + Watcher Integration** — New `list_changed_since(since)` tool (timestamp and git-SHA modes, no deletion tracking) and FileWatcher re-extracts symbols on change via the existing single-pass AST walk

## Phase Details

### Phase 33: Symbol Extraction Foundation
**Goal**: TS/JS files populate a `symbols` table during scan with top-level declarations (name, kind, line range, export flag), and the dep parser records imported names and import lines during the same AST walk — no second parser pass per file.
**Depends on**: Phase 32 (previous milestone complete)
**Requirements**: SYM-01, SYM-02, SYM-03, SYM-04, SYM-05, SYM-06, SYM-07, SYM-08, IMP-01, IMP-02, IMP-03, PERF-01
**Success Criteria** (what must be TRUE):
  1. `symbols` table exists with indexes on `(name)` and `(path)`; migration runs cleanly on pre-v1.6 DBs (additive only)
  2. A single AST walk over a TS/JS file emits both the edge set and the symbol set — no second `parse()` call in any code path
  3. Exported top-level declarations of all six kinds (function, class, interface, type, enum, const) appear in `symbols` with correct `startLine`/`endLine`/`isExport`
  4. `file_dependencies` rows (or a join table) carry `importedNames` and `importLines` for every TS/JS edge; namespace imports record `*`
  5. First startup after migration bulk-extracts symbols for every tracked TS/JS file — no lazy per-query extraction path
  6. `npm run inspect-symbols <path>` prints the extracted symbol set for one file
  7. Re-export statements (`export * from './foo'`) do NOT populate symbols on the re-exporting file
  8. FileScopeMCP self-scan baseline wall-time captured before any symbol extraction code is merged

### Phase 34: Symbol-Aware MCP Surface
**Goal**: LLM agents resolve a symbol to `{path, line, kind}` in a single MCP call via `find_symbol`, and `get_file_summary` surfaces per-file exports plus dependent-edge import-names.
**Depends on**: Phase 33
**Requirements**: FIND-01, FIND-02, FIND-03, FIND-04, FIND-05, SUM-01, SUM-02, SUM-03, SUM-04
**Success Criteria** (what must be TRUE):
  1. `find_symbol(name)` returns matching symbols with `{path, name, kind, startLine, endLine, isExport}` — exact match case-sensitive, prefix match via trailing `*`
  2. `find_symbol` defaults `exportedOnly=true`; private helpers only appear when caller explicitly sets the flag false
  3. `find_symbol` uses standardized `{items, total, truncated?: true}` envelope; no matches returns `{items: [], total: 0}` not an error
  4. `get_file_summary` response carries an `exports: [{name, kind, startLine, endLine}]` array populated for TS/JS files
  5. `get_file_summary.dependents[]` upgrades from `string[]` to `[{path, importedNames: string[], importLines: number[]}]` — existing consumers see additive fields only
  6. Non-TS/JS files return `exports: []` and `dependents[].importedNames: []` without error

### Phase 35: Changed-Since Tool + Watcher Integration
**Goal**: Agents re-orient after multi-edit runs with one MCP call; watcher re-extracts symbols on file change via the existing single-pass AST walk, keeping `symbols` as fresh as `file_dependencies`.
**Depends on**: Phase 33, Phase 34
**Requirements**: CHG-01, CHG-02, CHG-03, CHG-04, CHG-05, WTC-01, WTC-02, WTC-03, PERF-02
**Success Criteria** (what must be TRUE):
  1. `list_changed_since(timestamp)` returns `[{path, mtime}]` for files whose mtime > timestamp; ISO-8601 strings accepted
  2. `list_changed_since(sha)` runs `git diff --name-only <sha> HEAD` and returns the intersection with files present in the DB
  3. Invalid `since` values return `INVALID_SINCE`; git-SHA mode without a `.git` dir returns `NOT_GIT_REPO`
  4. Tool response lists only files currently present in the DB — no tombstones for deletions
  5. FileWatcher change events re-extract symbols alongside edges using the same throttle — no separate symbol-specific watcher timer
  6. FileWatcher unlink events invoke `deleteSymbolsForFile(path)` so orphaned symbols never linger
  7. End-of-milestone scan wall-time regression < 15% vs Phase 33 baseline; hard-fail threshold 25%

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. SQLite Storage | v1.0 | 3/3 | Complete | 2026-03-02 |
| 2. Coordinator + Daemon Mode | v1.0 | 2/2 | Complete | 2026-03-03 |
| 3. Semantic Change Detection | v1.0 | 2/2 | Complete | 2026-03-18 |
| 4. Cascade Engine + Staleness | v1.0 | 2/2 | Complete | 2026-03-18 |
| 5. LLM Processing Pipeline | v1.0 | 3/3 | Complete | 2026-03-18 |
| 6. Verification & Tech Debt | v1.0 | 2/2 | Complete | 2026-03-18 |
| 7. Fix change_impact Pipeline | v1.0 | 1/1 | Complete | 2026-03-18 |
| 8. Integration Fixes | v1.0 | 2/2 | Complete | 2026-03-19 |
| 9. Verification Documentation | v1.0 | 2/2 | Complete | 2026-03-19 |
| 10. Code Quality and Bug Fixes | v1.1 | 2/2 | Complete | 2026-03-19 |
| 11. .filescopeignore Support | v1.1 | 2/2 | Complete | 2026-03-19 |
| 12. Go and Ruby Language Support | v1.1 | 2/2 | Complete | 2026-03-19 |
| 13. Streaming Directory Scan | v1.1 | 2/2 | Complete | 2026-03-20 |
| 14. mtime-Based Lazy Validation | v1.1 | 1/1 | Complete | 2026-03-20 |
| 15. Cycle Detection | v1.1 | 2/2 | Complete | 2026-03-20 |
| 16. Broker Core | v1.2 | 2/2 | Complete | 2026-03-22 |
| 17. Instance Client + Pipeline Wiring | v1.2 | 2/2 | Complete | 2026-03-22 |
| 18. Cleanup | v1.2 | 2/2 | Complete | 2026-03-22 |
| 19. Observability | v1.2 | 2/2 | Complete | 2026-03-23 |
| 20. Server Skeleton + Repo Discovery | v1.3 | 3/3 | Complete | 2026-04-01 |
| 21. File Tree + Detail Panel | v1.3 | 2/2 | Complete | 2026-04-02 |
| 22. Dependency Graph | v1.3 | 2/2 | Complete | 2026-04-02 |
| 23. System View + Live Activity | v1.3 | 2/2 | Complete | 2026-04-02 |
| 24. Polish | v1.3 | 3/3 | Complete | 2026-04-03 |
| 25. Schema Foundation + LanguageConfig Scaffolding | v1.4 | 2/2 | Complete | 2026-04-09 |
| 26. Multi-Language Tree-sitter Extraction | v1.4 | 2/2 | Complete | 2026-04-09 |
| 27. Community Detection | v1.4 | 2/2 | Complete | 2026-04-09 |
| 28. MCP Polish | v1.4 | 2/2 | Complete | 2026-04-09 |
| 29. Broker Lifecycle Hardening | v1.5 | 2/2 | Complete | 2026-04-17 |
| 30. MCP Spec Compliance | v1.5 | 2/2 | Complete | 2026-04-17 |
| 31. Test Infrastructure | v1.5 | 3/3 | Complete | 2026-04-18 |
| 32. Zero-Config Auto-Registration | v1.5 | 4/4 | Complete | 2026-04-22 |
| 33. Symbol Extraction Foundation | v1.6 | 5/1 | Complete    | 2026-04-23 |
| 34. Symbol-Aware MCP Surface | v1.6 | 0/? | Not started | - |
| 35. Changed-Since Tool + Watcher Integration | v1.6 | 0/? | Not started | - |
