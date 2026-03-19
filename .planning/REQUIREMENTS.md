# Requirements: FileScopeMCP v1.1

**Defined:** 2026-03-19
**Core Value:** LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## v1.1 Requirements

Requirements for v1.1 Hardening release. Each maps to roadmap phases.

### Bug Fixes

- [x] **BUG-01**: Importance propagation recurses through all transitive dependents when a file's importance changes, using a visited set to prevent infinite loops
- [x] **BUG-02**: Watcher restart backoff counter only resets after the watcher has been stable for at least 60 seconds, not immediately on successful start

### Code Quality

- [x] **QUAL-01**: file-utils.ts uses a single consolidated set of fs imports (no duplicate `import * as fs` and `import * as fsSync from 'fs'`)
- [x] **QUAL-02**: Path normalization uses one canonical function with clear naming, eliminating the confusing `normalizePath` vs `normalizeAndResolvePath` split
- [x] **QUAL-03**: `PackageDependency.fromPath()` no longer misclassifies local files as package dependencies due to the hardcoded fallback list (`react`, `firebase`, etc.)
- [x] **QUAL-04**: Dead `createFileTree` export removed from file-utils.ts

### Performance

- [ ] **PERF-01**: Project supports a `.filescopeignore` file (gitignore syntax) that gates directory recursion at scan time — ignored directories are never entered
- [ ] **PERF-02**: `scanDirectory` uses streaming (async generator via `fs.promises.opendir`) instead of building the full tree in memory
- [ ] **PERF-03**: Integrity sweep no longer polls on a fixed 30-second interval; instead, file freshness is validated lazily via mtime comparison on MCP tool access, with a full sweep only at startup

### Language Support

- [ ] **LANG-01**: Go import parsing extracts dependencies from `import "pkg"` and grouped `import (...)` blocks, with `go.mod` module name resolution for intra-project paths
- [ ] **LANG-02**: Ruby import parsing extracts dependencies from `require` and `require_relative` calls, with `.rb` extension probing for intra-project paths

### Cycle Detection

- [ ] **CYCL-01**: Tarjan's SCC algorithm detects circular dependency groups in the file graph using an iterative (non-recursive) implementation
- [ ] **CYCL-02**: Cycle information is exposed via MCP tools — users can detect all cycles in the project and query which cycle group a specific file belongs to

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### Architecture Cleanup

- **ARCH-01**: Eliminate `reconstructTreeFromDb` bridge pattern — work directly against SQLite model
- **ARCH-02**: Per-directory file watching granularity (less relevant with one-instance-per-project)

### Language Support

- **LANG-03**: Barrel re-export parsing (`export * from`) for TypeScript/JavaScript
- **LANG-04**: Python relative imports (`from . import`) and `importlib`
- **LANG-05**: Rust `mod` declarations resolving to `mod.rs` or same-name files

### Test Coverage

- **TEST-01**: Full watcher debounce integration tests
- **TEST-02**: Large-codebase performance benchmarks

## Out of Scope

| Feature | Reason |
|---------|--------|
| Git integration | Explicitly out of scope per PROJECT.md — file-system level only |
| `read_file_content` lazy loading | Low priority — rare for users to read very large files via MCP |
| tree-sitter AST parsing for Go/Ruby | Regex is sufficient for Go/Ruby import syntax; AST adds native dep complexity |
| Cascade-integrated cycle detection | v1.1 scope is display-only; cascade integration deferred to future milestone |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BUG-01 | Phase 10 | Complete |
| BUG-02 | Phase 10 | Complete |
| QUAL-01 | Phase 10 | Complete |
| QUAL-02 | Phase 10 | Complete |
| QUAL-03 | Phase 10 | Complete |
| QUAL-04 | Phase 10 | Complete |
| PERF-01 | Phase 11 | Pending |
| PERF-02 | Phase 13 | Pending |
| PERF-03 | Phase 14 | Pending |
| LANG-01 | Phase 12 | Pending |
| LANG-02 | Phase 12 | Pending |
| CYCL-01 | Phase 15 | Pending |
| CYCL-02 | Phase 15 | Pending |

**Coverage:**
- v1.1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0

---
*Requirements defined: 2026-03-19*
*Last updated: 2026-03-19 after roadmap creation*
