# FileScopeMCP

## What This Is

A fully autonomous file intelligence system that watches project directories and maintains rich, up-to-date metadata about every file — summaries, relationships, key concepts, and change impact — so LLMs can query structured knowledge about a codebase without reading raw files. Runs as a standalone daemon or as an MCP server, with an optional background LLM that handles all metadata maintenance automatically.

## Core Value

LLMs get accurate, current answers about any file's role, relationships, and contents through MCP queries — without ever needing to read the raw files or maintain the metadata themselves.

## Requirements

### Validated

<!-- Shipped and confirmed valuable — existing capabilities. -->

- ✓ Recursive directory scanning with file tree building — existing
- ✓ Multi-language import/dependency parsing (JS/TS, Python, C/C++, Rust, Lua, Zig, PHP, C#, Java) — existing
- ✓ File importance scoring (0-10 scale based on dependents, type, location) — existing
- ✓ Real-time file system watching with debounced change detection — existing
- ✓ Atomic state mutations via async mutex — existing
- ✓ Incremental tree updates on file change — existing
- ✓ Self-healing integrity sweep (periodic disk validation) — existing
- ✓ Persistent JSON tree caching with freshness validation — existing
- ✓ MCP tool interface (20+ tools for querying and managing file metadata) — existing
- ✓ Manual summary get/set via MCP tools — existing
- ✓ File content reading via MCP — existing
- ✓ Configurable file watching (toggle, update config) — existing
- ✓ Exclude patterns and tree management — existing

### Active

<!-- Current scope. Building toward these. -->

- [ ] Smart cascade: when a file changes, analyze what actually changed (exports, types, logic) and re-evaluate only affected dependents
- [ ] AST-level diffing for supported languages (TS/JS/Python) to detect semantic changes
- [ ] LLM-powered diff fallback for unsupported languages
- [ ] Background LLM integration: configurable provider (OpenAI-compatible, Anthropic API, others) that autonomously regenerates summaries on file change
- [ ] Auto-generate key concepts per file (functions, classes, interfaces, exports — structured outline)
- [ ] Auto-assess change impact (what breaks if this file changes, risk level)
- [ ] Relationship metadata kept current through cascade re-evaluation
- [ ] Full dependency graph cascade: changes ripple through the graph, but intelligently — only files affected by the specific semantic change
- [ ] Dual-mode operation: standalone daemon (watches 24/7) OR MCP server with watching (starts/stops with client)
- [ ] Background LLM toggle: on/off via config or MCP call
- [ ] Multi-provider LLM adapter: support vLLM, Ollama, OpenRouter, Anthropic, any OpenAI-compatible endpoint (base URL + model config)
- [ ] SQLite storage: migrate from JSON to SQLite for structured queries, relationship lookups, and scale
- [ ] Queued cascade processing with rate limiting and priority ordering when LLM is involved
- [ ] Staleness detection: mark metadata as stale when source file or its dependencies change, track freshness per-field

### Out of Scope

- Multi-project in a single instance — one instance per project, simpler isolation
- Real-time streaming of changes to MCP clients — query-based, not push-based
- Code generation or refactoring — this is a read/analysis tool, not a writer
- Git integration (blame, history, branch awareness) — file-system level only for v1
- UI/dashboard — headless, MCP and daemon only

## Context

This is a brownfield project with a functional MCP server already built. The existing system handles file scanning, dependency parsing, importance scoring, and real-time watching. The gap is between "keep the tree structure current" (what exists) and "keep rich semantic metadata current" (the vision). The current system rebuilds the dependency graph on change but doesn't re-evaluate summaries, concepts, or downstream impact.

The key architectural shift is adding:
1. A **change analysis layer** (AST + LLM hybrid) that understands *what* changed semantically
2. A **cascade engine** that propagates staleness through the dependency graph intelligently
3. A **background LLM subsystem** that autonomously maintains metadata without the primary LLM needing to intervene
4. A **SQLite storage backend** to handle richer metadata and relationship queries efficiently

The existing file watcher, dependency parser, and MCP tool surface are solid foundations to build on.

**Tech stack:** TypeScript 5.8, Node.js 22, ESM, esbuild, @modelcontextprotocol/sdk, chokidar, zod, vitest.

## Constraints

- **Runtime**: Node.js 22 — must stay compatible, no native modules that limit portability
- **MCP compatibility**: Must maintain backward compatibility with existing MCP tool interface
- **One instance per project**: Simplifies state management and isolation
- **LLM costs**: Background LLM calls must be rate-limited and smart-cascaded to avoid runaway token usage
- **Storage migration**: JSON → SQLite must be non-breaking for existing users (migration path)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid AST + LLM change analysis | AST is fast/free for supported languages, LLM covers the rest | — Pending |
| SQLite over JSON for storage | Richer queries, relationship lookups, scales better with metadata growth | — Pending |
| Multi-provider LLM adapter | User may run local (vLLM/Ollama) or cloud (Anthropic/OpenAI) — flexibility is key | — Pending |
| Smart cascade over full cascade | Analyzing what actually changed prevents unnecessary LLM calls on dependents | — Pending |
| Dual-mode (daemon + MCP server) | Daemon keeps metadata fresh 24/7; MCP mode for lighter use cases | — Pending |
| One instance per project | Simpler isolation, avoids cross-project state complexity | — Pending |
| Background LLM is opt-in | Can toggle on/off via config or MCP call; system works without it (manual mode) | — Pending |

---
*Last updated: 2026-03-02 after initialization*
