# Phase 14: mtime-Based Lazy Validation - Context

**Gathered:** 2026-03-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate the 30-second polling integrity sweep (`setInterval` + full filesystem walk). Replace with two mechanisms: (1) a one-time full integrity sweep at startup that blocks initialization, and (2) per-file mtime comparison on MCP tool access for file-specific queries. The file watcher remains the primary change detection mechanism — lazy mtime validation is the safety net for gaps.

</domain>

<decisions>
## Implementation Decisions

### Validation Scope
- Only **file-specific MCP tools** trigger per-file mtime checks: `get_file_summary`, `get_file_info`, `read_file_content`, and similar tools that return data about a single file
- **Tree-wide tools** (`get_file_tree`, `find_files`, etc.) do NOT trigger mtime validation — the watcher handles live changes for the full tree
- This keeps disk I/O minimal: one `stat()` call per file-specific query, not a sweep of all tracked files

### Staleness Response
- When mtime differs from stored value: return **cached data immediately** with a `stale: true` indicator in the response
- **Update mtime in SQLite synchronously** (fast, prevents re-triggering on subsequent queries)
- **Queue the file for background LLM re-analysis** (summary, concepts, change_impact regeneration)
- Rationale: LLM re-analysis takes seconds; blocking would make MCP queries slow. LLM consumers can read raw file content via `read_file_content` if they need current truth

### Startup Sweep
- Run the existing `integrityCheck` function **once at startup**, blocking `init()` before accepting MCP queries
- Detects files added/deleted/modified while server was down
- After startup, **remove `setInterval`** — no periodic sweep runs
- The `startIntegritySweep()` method and `integritySweepInterval` field are eliminated

### Watcher Interaction
- File watcher remains the **primary** mechanism for detecting live changes
- Lazy mtime validation is the **safety net** for edge cases: changes while server was down, watcher gaps, external tool edits
- **No overlap or conflict** — if the watcher already processed a change, the stored mtime matches disk and lazy check is a no-op
- No changes to watcher behavior, LLM pipeline, or cascade engine

### Claude's Discretion
- Which specific MCP tool handlers get the mtime check (exact list of ~5 tools)
- Whether the mtime check is a shared helper function or inline per-handler
- How the stale flag is surfaced in MCP response format (field name, placement)
- Whether startup sweep runs before or after watcher initialization (both valid)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core implementation
- `src/coordinator.ts` — `startIntegritySweep()` (line 554-604): current polling implementation to remove. `buildFileTree()` (line 609+): startup flow. `integritySweepInterval` field (line 65). `init()` method where sweep is started (line 250-252)
- `src/file-utils.ts` — `integrityCheck()` (line 1444-1504): existing sweep logic to reuse at startup. mtime stat patterns throughout

### MCP tool handlers
- `src/mcp-server.ts` — MCP tool definitions and handlers. `getFileTree()` calls (lines 292, 495, 713). File-specific tool handlers that need mtime checks

### Storage and types
- `src/types.ts` — `FileNode.mtime` field (line 35)
- `src/db/repository.ts` — mtime read/write in SQLite (lines 28, 50)
- `src/db/schema.ts` — mtime column definition (line 14)

### Requirements
- `.planning/REQUIREMENTS.md` — PERF-03 requirement definition

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `integrityCheck()` in file-utils.ts: Already does mtime comparison + new/deleted file detection — reuse at startup as-is
- `getAllFiles()` in db/repository.ts: Returns all FileNodes from SQLite — used by current sweep, reusable for startup sweep
- mtime stat pattern (1ms tolerance): Already established in `integrityCheck` and `buildFileTree` — same pattern for lazy checks

### Established Patterns
- `updateFileNodeOnChange()`, `removeFileNode()`, `addFileNode()`: Existing healing functions called by current sweep — reuse at startup
- `reconstructTreeFromDb()`: Bridge pattern used by current sweep to convert DB files to tree for integrityCheck — needed at startup too
- Coordinator methods return `createMcpResponse()` objects — stale flag needs to fit this format

### Integration Points
- `init()` method in coordinator.ts: Where startup sweep replaces `startIntegritySweep()` call
- `shutdown()` method: `clearInterval` cleanup becomes unnecessary (nothing to clear)
- MCP tool handlers in mcp-server.ts: File-specific handlers need a coordinator method to check/return staleness
- LLM pipeline queue: Stale files need to be queued for re-analysis (existing `markFieldStale`/cascade mechanism)

</code_context>

<specifics>
## Specific Ideas

- The actual code change is small: remove `setInterval`, add a per-file mtime check helper, call it from ~5 file-specific MCP handlers, run existing sweep once at startup
- Key insight from discussion: two layers of staleness exist — structural (deps, importance) is fast to refresh, LLM-generated (summary, concepts) is slow. Only the LLM layer gets the stale flag; mtime update is synchronous

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-mtime-based-lazy-validation*
*Context gathered: 2026-03-19*
