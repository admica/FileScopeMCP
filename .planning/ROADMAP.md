# Roadmap: FileScopeMCP

## Milestones

- ✅ **v1.0 Autonomous File Metadata** — Phases 1-9 (shipped 2026-03-19)
- 🚧 **v1.1 Hardening** — Phases 10-15 (in progress)

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

### 🚧 v1.1 Hardening (In Progress)

**Milestone Goal:** Fix open bugs, improve code quality, add cycle detection and richer language support, and harden performance for large codebases.

- [x] **Phase 10: Code Quality and Bug Fixes** - Establish a clean, correct baseline by eliminating dead code, consolidating imports, fixing path normalization, correcting the firebase false positive, fixing transitive importance propagation, and fixing watcher restart backoff (completed 2026-03-19)
- [x] **Phase 11: .filescopeignore Support** - Add gitignore-syntax project exclusion file that gates directory recursion at scan time (completed 2026-03-19)
- [x] **Phase 12: Go and Ruby Language Support** - Add full dependency parsing for Go (import blocks + go.mod resolution) and Ruby (require/require_relative) (completed 2026-03-19)
- [x] **Phase 13: Streaming Directory Scan** - Replace eager full-tree memory build with async generator that yields one FileNode at a time (completed 2026-03-20)
- [x] **Phase 14: mtime-Based Lazy Validation** - Replace 30-second polling integrity sweep with mtime comparison on MCP tool access (completed 2026-03-20)
- [ ] **Phase 15: Cycle Detection** - Add Tarjan's SCC cycle detection and expose via detect_cycles and get_cycles_for_file MCP tools

## Phase Details

### Phase 10: Code Quality and Bug Fixes
**Goal**: The codebase is clean, correct, and all existing tests pass — with accurate importance scores, reliable watcher error recovery, consolidated fs imports, and no dead code
**Depends on**: Nothing (first phase of v1.1)
**Requirements**: QUAL-01, QUAL-02, QUAL-03, QUAL-04, BUG-01, BUG-02
**Success Criteria** (what must be TRUE):
  1. Importance scores for files with transitive dependents reflect the full dependency chain depth, not just depth-1 dependents
  2. Watcher restart backoff counter holds its value through an error spike and only resets after 60 consecutive seconds of stable operation
  3. file-utils.ts has one consolidated fs import block with no duplicate `import * as fs` or `import * as fsSync` declarations
  4. `normalizePath` and `normalizeAndResolvePath` are replaced by a single canonical path normalization function with unambiguous naming
  5. Local files are never misclassified as package dependencies (react, firebase, etc.) due to a hardcoded fallback list, and the dead `createFileTree` export is absent from file-utils.ts
**Plans:** 2/2 plans complete
Plans:
- [ ] 10-01-PLAN.md — Dead code cleanup (fs imports, createFileTree, commonPkgs) and watcher backoff fix
- [ ] 10-02-PLAN.md — Path normalization consolidation and transitive importance propagation fix

### Phase 11: .filescopeignore Support
**Goal**: Users can place a `.filescopeignore` file (gitignore syntax) in their project root and have FileScopeMCP never enter excluded directories during scans or file watching
**Depends on**: Phase 10
**Requirements**: PERF-01
**Success Criteria** (what must be TRUE):
  1. A `.filescopeignore` file with gitignore-style patterns causes matching directories to be skipped entirely during recursive directory scan — their contents never appear in the file tree
  2. The ignore rules apply to both the initial scan and real-time file watching, with no additional configuration required beyond creating the file
  3. Standard gitignore syntax (negation, globstar, directory anchoring, comments) works correctly in `.filescopeignore`
**Plans:** 2/2 plans complete
Plans:
- [ ] 11-01-PLAN.md — Install ignore package, global-state integration, isExcluded wiring with tests
- [ ] 11-02-PLAN.md — FileWatcher integration with .filescopeignore for watch-time exclusion

### Phase 12: Go and Ruby Language Support
**Goal**: FileScopeMCP correctly parses import dependencies for Go and Ruby files, enabling accurate dependency graphs and importance scoring for projects using those languages
**Depends on**: Phase 11
**Requirements**: LANG-01, LANG-02
**Success Criteria** (what must be TRUE):
  1. Go files with single-line `import "pkg"` and grouped `import (...)` blocks have their imported packages extracted and intra-project paths resolved to filesystem paths using the module name from `go.mod`
  2. Ruby files have `require` and `require_relative` calls extracted, with `require_relative` paths and local `require` paths resolved to `.rb` files in the project tree
  3. Go and Ruby files appear in dependency graphs with correct dependent/dependency relationships, and their importance scores reflect how many other files import them
**Plans:** 2/2 plans complete
Plans:
- [ ] 12-01-PLAN.md — Go import parsing (regex extraction, go.mod resolution, importance scoring, tests)
- [ ] 12-02-PLAN.md — Ruby import parsing (require/require_relative resolution, .rb probing, importance scoring, tests)

### Phase 13: Streaming Directory Scan
**Goal**: Large codebases scan without loading all file nodes into memory at once — the directory scanner yields one FileNode at a time using an async generator
**Depends on**: Phase 12
**Requirements**: PERF-02
**Success Criteria** (what must be TRUE):
  1. Projects with 10,000+ files complete an initial scan without exhausting process memory, measured by peak RSS not growing proportionally with file count
  2. The streamed scan produces an identical file tree and dependency graph to the previous eager scan for the same project directory
  3. `.filescopeignore` exclusion remains a pre-recursion gate in the streaming scan — excluded directories are never entered by the async generator
**Plans:** 2/2 plans complete
Plans:
- [ ] 13-01-PLAN.md — Convert scanDirectory to async generator with opendir, add collectStream test helper
- [ ] 13-02-PLAN.md — Coordinator two-pass integration (stream-to-SQLite, dependency extraction, importance calculation)

### Phase 14: mtime-Based Lazy Validation
**Goal**: The 30-second polling integrity sweep is eliminated — file freshness is validated on demand when MCP tools access file data, with a startup-only full sweep for new/deleted file detection
**Depends on**: Phase 13
**Requirements**: PERF-03
**Success Criteria** (what must be TRUE):
  1. No `setInterval` integrity sweep timer runs after startup — file freshness is checked only at startup (full sweep) and on MCP tool access (per-file mtime comparison)
  2. When an MCP tool accesses a file whose mtime differs from the stored value, the response includes a `stale: true` indicator and the file is queued for re-analysis
  3. Disk I/O on large projects (1,000+ tracked files) drops measurably after startup — no background stat-polling of all files every 30 seconds
**Plans:** 1/1 plans complete
Plans:
- [ ] 14-01-PLAN.md — Remove polling sweep, add startup sweep + per-file checkFileFreshness, wire into MCP handlers

### Phase 15: Cycle Detection
**Goal**: Users can detect circular dependency groups in their project and query which cycle group any file belongs to, via two new MCP tools backed by an iterative Tarjan's SCC implementation
**Depends on**: Phase 10
**Requirements**: CYCL-01, CYCL-02
**Success Criteria** (what must be TRUE):
  1. `detect_cycles` MCP tool returns all circular dependency groups in the project, each listing the files that form the cycle
  2. `get_cycles_for_file` MCP tool returns the cycle group a specific file belongs to, or indicates the file is not part of any cycle
  3. Cycle detection runs on-demand only (not on every file change) and completes in under 2 seconds on a project with 10,000+ dependency edges
  4. A project with no circular dependencies returns an empty cycle list from `detect_cycles`
**Plans:** 2 plans
Plans:
- [ ] 15-01-PLAN.md — Iterative Tarjan's SCC algorithm + batch edge loader (TDD)
- [ ] 15-02-PLAN.md — Wire detect_cycles and get_cycles_for_file MCP tools

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
| 10. Code Quality and Bug Fixes | 2/2 | Complete    | 2026-03-19 | - |
| 11. .filescopeignore Support | 2/2 | Complete    | 2026-03-19 | - |
| 12. Go and Ruby Language Support | 2/2 | Complete    | 2026-03-19 | - |
| 13. Streaming Directory Scan | 2/2 | Complete    | 2026-03-20 | - |
| 14. mtime-Based Lazy Validation | 1/1 | Complete    | 2026-03-20 | - |
| 15. Cycle Detection | v1.1 | 0/2 | Not started | - |
