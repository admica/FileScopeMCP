# Internals

Technical details on how FileScopeMCP works under the hood.

## Dependency Detection

Import patterns detected per language:

| Language | Patterns |
|----------|----------|
| Python | `import`, `from ... import` |
| JavaScript / TypeScript | `import`, `require()`, dynamic `import()` |
| C / C++ | `#include` |
| Rust | `use`, `mod` |
| Go | `import` with `go.mod` module resolution |
| Ruby | `require`, `require_relative` with `.rb` probing |
| Lua | `require` |
| Zig | `@import` |
| PHP | `require`, `require_once`, `include`, `include_once`, `use` |
| C# | `using` |
| Java | `import` |

## Importance Calculation

Scores (0-10) from a weighted formula:

| Factor | Max contribution |
|--------|-----------------|
| Incoming dependents (files that import this file) | +3 |
| Outgoing dependencies (files this file imports) | +2 |
| Package dependencies imported | +1 |
| File type (TS/JS base score; PHP +2; config files like package.json +3) | varies |
| Location (`src/`, `app/` weighted higher) | varies |
| Naming (`index`, `main`, `server`, `app`, `config`, `types`, etc.) | varies |

## Autonomous Update Pipeline

When a file event fires:

1. **Debounce** — events coalesced per `filePath:eventType` key (default 2s)
2. **Mutex** — all mutations serialized through `AsyncMutex`
3. **Semantic change detection** — tree-sitter AST diff (TS/JS) or LLM-powered diff (all other languages) classifies the change
4. **Incremental update** — re-parses the changed file, diffs dependency lists, patches reverse-dependency map, recalculates importance
5. **Cascade engine** — BFS propagates staleness to transitive dependents if exports/types changed; body-only changes affect only the changed file
6. **LLM broker** — picks up stale files and regenerates summaries, concepts, and change impact in priority order

## Freshness Validation

Two complementary strategies:

- **Startup sweep** — runs once at initialization. Compares every tracked file against the filesystem to detect adds, deletes, and modifications that occurred while the server was offline.
- **Per-file mtime check** — when you call `get_file_summary`, the system compares current mtime against the last recorded value. If changed, the file is immediately flagged stale and queued for re-analysis.

## Symbol Extraction

Tree-sitter AST parsing extracts top-level symbols (functions, classes, interfaces, types, enums, consts, modules, structs) from source files. Symbols are stored in the `symbols` table with name, kind, start/end line, export status, and owning file path.

Extraction runs per-language:

| Language | Kinds extracted | Export rule |
|----------|----------------|------------|
| TypeScript / JavaScript | function, class, interface, type, enum, const | `export` keyword |
| Python | function, class (top-level only, decorator-aware) | `!name.startsWith('_')` |
| Go | function, method, struct, interface, type, const | Uppercase first char |
| Ruby | function, class, module, const | Always exported (no keyword) |

Ruby `attr_accessor` / `attr_reader` / `attr_writer` are not indexed (synthesized at runtime, not in AST). Reopened Ruby classes produce multiple symbol rows with the same name.

## Call-Site Edges (TS/JS)

For TypeScript and JavaScript files, a second AST pass over the already-parsed tree extracts call expressions and resolves them to symbol-level edges in the `symbol_dependencies` table:

1. **Local resolution** — callee name matches a symbol defined in the same file (confidence 1.0)
2. **Imported resolution** — callee name matches a symbol imported from another file, verified against the DB (confidence 0.8)
3. **Unresolvable** — silently discarded (no edge created)

Barrel files (`index.ts` etc.) are excluded to prevent over-matching. Ambiguous names (same name imported from multiple files) are discarded. Self-calls (recursion) are filtered from query results.

Call-site edges for Python, Go, and Ruby are not yet implemented.

## Community Detection

Louvain clustering on the local import graph groups tightly-coupled files into communities. Each community is represented by its highest-importance member. Communities are lazily recomputed only when the dependency graph changes (dirty flag tracked in DB).

## Cycle Detection

1. Loads all local import edges from SQLite in a single batch query
2. Runs iterative Tarjan's SCC algorithm on the directed dependency graph
3. Filters out trivial SCCs (single files with no self-loop)
4. Returns cycle groups listing all participating files

## Storage

All data in `.filescope/data.db` (SQLite, WAL mode):

| Table | Purpose |
|-------|---------|
| `files` | Metadata, staleness flags, summary, concepts, change_impact |
| `file_dependencies` | Directed import edges with edge type, confidence, and weight |
| `symbols` | Extracted symbols (name, kind, startLine, endLine, isExport) per file |
| `symbol_dependencies` | Call-site edges between symbols (caller → callee with confidence) |
| `file_communities` | Louvain community assignments |
| `kv_state` | Key-value store for bulk migration gates and feature flags |
| `schema_version` | Migration versioning |

Auto-migration: on first run, any legacy JSON tree files are imported into SQLite automatically. Schema migrations run automatically on startup.

## LLM Broker Architecture

The broker is a standalone Node.js process that owns all LLM communication (llama.cpp's `llama-server` or any OpenAI-compatible HTTP API):

- **IPC** — Unix domain socket at `~/.filescope/broker.sock`, NDJSON protocol
- **Queue** — in-memory priority queue (importance DESC, created_at ASC)
- **Tiers** — interactive (tier 1) > cascade (tier 2) > background (tier 3)
- **Dedup** — one pending job per file+type per repo, latest content wins
- **Timeout** — 120s per job for hung LLM calls
- **Auto-spawn** — first MCP instance spawns the broker if `broker.sock` is missing
- **Stats** — per-repo token totals persisted to `~/.filescope/stats.json`
