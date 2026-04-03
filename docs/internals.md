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

## Cycle Detection

1. Loads all local import edges from SQLite in a single batch query
2. Runs iterative Tarjan's SCC algorithm on the directed dependency graph
3. Filters out trivial SCCs (single files with no self-loop)
4. Returns cycle groups listing all participating files

## Storage

All data in `.filescope/data.db` (SQLite, WAL mode):

- `files` — metadata, staleness flags, summary, concepts, change_impact
- `file_dependencies` — bidirectional relationships
- `schema_version` — migration versioning

Auto-migration: on first run, any legacy JSON tree files are imported into SQLite automatically.

## LLM Broker Architecture

The broker is a standalone Node.js process that owns all Ollama communication:

- **IPC** — Unix domain socket at `~/.filescope/broker.sock`, NDJSON protocol
- **Queue** — in-memory priority queue (importance DESC, created_at ASC)
- **Tiers** — interactive (tier 1) > cascade (tier 2) > background (tier 3)
- **Dedup** — one pending job per file+type per repo, latest content wins
- **Timeout** — 120s per job for hung Ollama calls
- **Auto-spawn** — first MCP instance spawns the broker if `broker.sock` is missing
- **Stats** — per-repo token totals persisted to `~/.filescope/stats.json`
