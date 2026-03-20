# FileScopeMCP

## What This Is

A fully autonomous file intelligence system that watches project directories and maintains rich, up-to-date metadata about every file — summaries, relationships, key concepts, and change impact — so LLMs can query structured knowledge about a codebase without reading raw files. Runs as a standalone daemon or as an MCP server, with a background LLM that handles all metadata maintenance automatically.

## Core Value

LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## Requirements

### Validated

- ✓ Recursive directory scanning with file tree building — existing
- ✓ Multi-language import/dependency parsing (JS/TS, Python, C/C++, Rust, Lua, Zig, PHP, C#, Java, Go, Ruby) — Phase 12
- ✓ File importance scoring (0-10 scale based on dependents, type, location) — existing
- ✓ Real-time file system watching with debounced change detection — existing
- ✓ Atomic state mutations via async mutex — existing
- ✓ Incremental tree updates on file change — existing
- ✓ Self-healing integrity sweep (startup sweep + lazy mtime validation) — existing, refined Phase 14
- ✓ Persistent JSON tree caching with freshness validation — existing
- ✓ MCP tool interface (20+ tools for querying and managing file metadata) — existing
- ✓ Manual summary get/set via MCP tools — existing
- ✓ File content reading via MCP — existing
- ✓ Configurable file watching (toggle, update config) — existing
- ✓ Exclude patterns and tree management — existing
- ✓ SQLite storage with transparent JSON migration — v1.0
- ✓ Standalone coordinator + daemon mode (24/7 operation) — v1.0
- ✓ AST-level semantic change detection for TS/JS — v1.0
- ✓ LLM-powered diff fallback for unsupported languages — v1.0
- ✓ Cascade engine: staleness propagation through dependency graph — v1.0
- ✓ Per-field staleness tracking (summary, concepts, change_impact) — v1.0
- ✓ Background LLM auto-generates summaries, concepts, and change impact — v1.0
- ✓ Multi-provider LLM adapter (OpenAI-compatible, Anthropic, Ollama, vLLM) — v1.0
- ✓ LLM toggle on/off via config or MCP tool — v1.0
- ✓ Token budget limits and rate limiting — v1.0
- ✓ Priority-ordered job queuing (interactive > cascade > background) — v1.0
- ✓ Circular dependency protection in cascade — v1.0
- ✓ Full backward compatibility with existing MCP tools — v1.0

### Active

**Current Milestone: v1.1 Hardening**

**Goal:** Fix open bugs, improve code quality, add cycle detection and richer language support, and harden performance for large codebases.

**Target:**
- ✓ Fix shallow importance propagation — BFS transitive propagation with cycle safety — Phase 10
- ✓ Fix watcher restart backoff reset — 60s stability timer — Phase 10
- ✓ Replace polling integrity sweep with mtime-based lazy validation — startup sweep + per-file checkFileFreshness — Phase 14
- ✓ Add cycle detection (Tarjan's SCC) and expose via tools — Phase 15
- ✓ Go and Ruby language support — go.mod resolution, require/require_relative parsing — Phase 12
- ✓ .filescopeignore support — gitignore-syntax exclusion for scan-time and watch-time — Phase 11
- ✓ Streaming directory scan — async generator with two-pass SQLite integration — Phase 13
- Lazy file content for large codebases
- ✓ Code quality: consolidated fs imports, unified canonicalizePath, fixed firebase false positive, removed dead code — Phase 10

### Out of Scope

- Multi-project in a single instance — one instance per project, simpler isolation
- Real-time streaming of changes to MCP clients — query-based, not push-based
- Code generation or refactoring — this is a read/analysis tool, not a writer
- Git integration (blame, history, branch awareness) — file-system level only
- UI/dashboard — headless, MCP and daemon only
- Vector embedding search — structured metadata serves LLM needs better
- Full AST caching in storage — ASTs too large and go stale immediately

## Context

Shipped v1.0 with 9,515 LOC TypeScript across 9 phases. 250 tests passing. Phase 10 (code quality + bug fixes), Phase 11 (.filescopeignore support), Phase 12 (Go and Ruby language support), Phase 13 (streaming directory scan), Phase 14 (mtime-based lazy validation), and Phase 15 (cycle detection) complete.

Tech stack: TypeScript 5.8, Node.js 22, ESM, esbuild, @modelcontextprotocol/sdk, chokidar, zod, vitest, better-sqlite3, drizzle-orm, tree-sitter, Vercel AI SDK.

The system is a complete autonomous file intelligence platform: watches directories, detects semantic changes via AST diffing, propagates staleness through the dependency graph, and uses a background LLM to maintain summaries, concepts, and change impact assessments — all queryable via 20+ MCP tools.

## Constraints

- **Runtime**: Node.js 22 — must stay compatible, no native modules that limit portability
- **MCP compatibility**: Must maintain backward compatibility with existing MCP tool interface
- **One instance per project**: Simplifies state management and isolation
- **LLM costs**: Background LLM calls must be rate-limited and smart-cascaded to avoid runaway token usage

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid AST + LLM change analysis | AST is fast/free for supported languages, LLM covers the rest | ✓ Good — tree-sitter for TS/JS, LLM fallback for others |
| SQLite over JSON for storage | Richer queries, relationship lookups, scales better with metadata growth | ✓ Good — transparent migration, WAL mode, drizzle-orm |
| Multi-provider LLM adapter | User may run local (vLLM/Ollama) or cloud (Anthropic/OpenAI) — flexibility is key | ✓ Good — Vercel AI SDK abstracts providers cleanly |
| Smart cascade over full cascade | Analyzing what actually changed prevents unnecessary LLM calls on dependents | ✓ Good — body-only changes skip dependents entirely |
| Dual-mode (daemon + MCP server) | Daemon keeps metadata fresh 24/7; MCP mode for lighter use cases | ✓ Good — both modes share coordinator logic |
| One instance per project | Simpler isolation, avoids cross-project state complexity | ✓ Good — clean separation |
| Background LLM is opt-in | Can toggle on/off via config or MCP call; system works without it | ✓ Good — structural metadata always available |
| better-sqlite3 via createRequire | Native ESM project needs CJS addon loading | ✓ Good — works reliably with esbuild |
| tree-sitter via createRequire | Same CJS-from-ESM pattern as better-sqlite3 | ✓ Good — consistent native addon strategy |
| Vercel AI SDK for LLM abstraction | Unified interface across OpenAI-compatible and Anthropic providers | ✓ Good — structured output with JSON repair fallback |

---
*Last updated: 2026-03-20 after Phase 15 completion*
