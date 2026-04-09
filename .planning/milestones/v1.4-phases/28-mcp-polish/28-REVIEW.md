---
phase: 28-mcp-polish
reviewed: 2026-04-09T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/db/repository.ts
  - src/mcp-server.ts
  - src/mcp-server.test.ts
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
status: issues_found
---

# Phase 28: Code Review Report

**Reviewed:** 2026-04-09
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Three files were reviewed: the SQLite repository layer, the MCP server entry point with all tool handlers, and the test suite for staleness / dependency edge metadata. The code is generally well-structured with clear separation between the repository and the tool handlers. No security vulnerabilities or data-loss risks were found.

Five warnings were identified, mostly around unhandled error paths, a risky SQL injection surface in `writeLlmResult`/`clearStaleness`, and a test that silently reads the wrong file on certain path configurations. Four informational items note dead-code / redundancy patterns.

---

## Warnings

### WR-01: SQL column name injected directly into query string without whitelist guard

**File:** `src/db/repository.ts:567`
**Issue:** `writeLlmResult` builds a raw SQL string by concatenating the `column` variable directly into a `prepare()` call. The `column` value is derived from a `switch` statement on `jobType`, which is a string parameter. Although the function throws on unknown `jobType` values, the pattern creates a fragile trust boundary: any future code path that passes an attacker-controlled string as `jobType` (e.g., after refactoring the switch cases) can inject arbitrary SQL. The same pattern exists in `clearStaleness` at line 592.

```typescript
// Current (fragile)
sqlite.prepare(`UPDATE files SET ${column} = ? WHERE path = ?`).run(result, filePath);

// Safer: use an explicit allowlist Map at the top of the function
const ALLOWED_COLUMNS: Record<string, string> = {
  summary: 'summary',
  concepts: 'concepts',
  change_impact: 'change_impact',
};
const column = ALLOWED_COLUMNS[jobType];
if (!column) throw new Error(`writeLlmResult: unknown jobType '${jobType}'`);
sqlite.prepare(`UPDATE files SET ${column} = ? WHERE path = ?`).run(result, filePath);
```

The same fix applies to `clearStaleness` (swap to a `STALE_COLUMNS` map).

---

### WR-02: `get_file_summary` swallows JSON.parse errors on `concepts` and `change_impact` columns

**File:** `src/mcp-server.ts:290-291`
**Issue:** The handler calls `JSON.parse(llmData.concepts)` and `JSON.parse(llmData.change_impact)` with no error handling. If either column holds malformed JSON (e.g., LLM wrote a partial result before a crash), `JSON.parse` throws and the entire MCP tool call crashes, returning an unhandled rejection to the client rather than a clean error response.

```typescript
// Current (throws on bad JSON)
concepts: llmData?.concepts ? JSON.parse(llmData.concepts) : null,
changeImpact: llmData?.change_impact ? JSON.parse(llmData.change_impact) : null,

// Fix: wrap each in a helper
function safeParse(json: string | null | undefined): unknown {
  if (!json) return null;
  try { return JSON.parse(json); } catch { return null; }
}
// then:
concepts: safeParse(llmData?.concepts),
changeImpact: safeParse(llmData?.change_impact),
```

---

### WR-03: `getCommunities()` calls `getAllFiles()` unconditionally — O(N) allocation for every read

**File:** `src/db/repository.ts:641`
**Issue:** `getCommunities()` fetches every file in the project (`getAllFiles()`) just to build an importance map for representative selection. This is called from `get_communities` in the MCP handler on every request when the dirty flag is clear (i.e., the hot path). For large projects, this creates a full table scan on every community read, even though the importance values were already known at `setCommunities()` time. The same problem exists in `getCommunityForFile()` at line 675.

**Fix:** Store the representative path in the `file_communities` table at write time (inside `setCommunities`), eliminating the need to recompute it on every read. The `CommunityResult` already carries `representative`; persist it as a column.

```sql
-- Add to migration:
ALTER TABLE file_communities ADD COLUMN is_representative INTEGER DEFAULT 0;
```

```typescript
// In setCommunities(), mark the representative row:
stmt.run(c.communityId, filePath, filePath === c.representative ? 1 : 0);

// In getCommunities(), SELECT WHERE is_representative = 1 per community
// instead of calling getAllFiles().
```

---

### WR-04: `StdioTransport.start()` — buffer size check uses `this.buffer.toString().length` which re-serializes the entire buffer on every chunk

**File:** `src/mcp-server.ts:64`
**Issue:** `this.buffer.toString()` is called on every incoming stdin chunk to measure the current buffer length. `ReadBuffer` is a third-party MCP SDK type; calling `.toString()` on it may serialize all buffered bytes each time, making the check O(buffer size) per chunk. For large messages this creates quadratic work. Additionally if `ReadBuffer.toString()` does not return the raw bytes (it's not documented as doing so), the size check may be inaccurate.

**Fix:** Track the running byte count in a separate counter variable instead of re-measuring the buffer:

```typescript
private _bufferedBytes = 0;

// in start(), data handler:
if (this._bufferedBytes + chunk.length > this.MAX_BUFFER_SIZE) { ... }
this._bufferedBytes += chunk.length;
this.buffer.append(chunk);
// after readMessage() drains, reset or decrement _bufferedBytes appropriately.
// On buffer reset: this._bufferedBytes = 0;
```

---

### WR-05: COMPAT-01 test reads its own source path through a fragile URL rewrite

**File:** `src/mcp-server.test.ts:505-509`
**Issue:** The test constructs a URL via `import.meta.url`, then does `.pathname.replace('/src/mcp-server.ts', '/src/mcp-server.ts')` — a no-op replacement. If the test file is relocated, compiled into `dist/`, or run in a different working directory, the path construction silently produces the wrong file path. The `catch` fallback reads `'./src/mcp-server.ts'` relative to CWD, which is also fragile depending on where the test runner is invoked. A failure here causes the COMPAT-01 test to pass vacuously (empty string contains no tool names but `toContain` would throw before then — however partial failure paths may silently degrade coverage).

**Fix:** Use `new URL('../src/mcp-server.ts', import.meta.url)` directly without the no-op replace:

```typescript
const src = await import('node:fs/promises').then(fsp =>
  fsp.readFile(new URL('../src/mcp-server.ts', import.meta.url), 'utf-8')
);
```

Remove the catch/fallback; a real file-not-found should fail loudly, not silently switch paths.

---

## Info

### IN-01: `get_communities` tool is missing from the COMPAT-01 expected tools list

**File:** `src/mcp-server.test.ts:512-524`
**Issue:** The COMPAT-01 test verifies 11 tool names are registered (`set_base_directory` through `get_cycles_for_file`). The `get_communities` tool, added in phase 27, is not in the `expectedTools` array. If `get_communities` is accidentally renamed or removed, no test catches it.

**Fix:** Add `'get_communities'` to the `expectedTools` array on line 524.

```typescript
const expectedTools = [
  // ...existing 11 tools...
  'get_communities',  // add this
];
```

---

### IN-02: `exclude_and_remove` contains dead init-fallback code that duplicates startup logic

**File:** `src/mcp-server.ts:411-418`
**Issue:** The handler checks `!coordinator.isInitialized()` and, if true, reads `--base-dir` from `process.argv` and calls `coordinator.init()` inline. But `initServer()` (called at startup) already handles auto-init from `process.cwd()` and `--base-dir`. This fallback will never be reached in normal MCP operation and adds a divergent code path that is not tested.

**Fix:** Remove the inline init fallback and simply return `projectPathNotSetError` like every other tool:

```typescript
if (!coordinator.isInitialized()) return projectPathNotSetError;
```

---

### IN-03: `setDependencies()` is now superseded by `setEdges()` but is still exported

**File:** `src/db/repository.ts:275`
**Issue:** The JSDoc on `setEdges()` (line 318) says "Callers migrated to `extractEdges()` should use this instead of `setDependencies()`", implying `setDependencies()` is deprecated. If no callers remain, the function is dead code. Keeping it exported preserves a lower-fidelity write path (no `edge_type`, `confidence`, or `weight`) that can be called accidentally.

**Fix:** Confirm there are no remaining callers of `setDependencies()` with `grep`. If none, remove the export. If callers remain, add a `@deprecated` JSDoc tag.

---

### IN-04: `purgeRecordsOutsideRoot` uses a LIKE pattern that can match sibling directories

**File:** `src/db/repository.ts:370`
**Issue:** The purge query uses `path NOT LIKE '/home/user/myproject%'`. This pattern would also match `/home/user/myproject-backup/` or any path that starts with the same prefix. The condition should anchor to a directory boundary.

**Fix:** Append a `/` to the pattern so it only matches files strictly under the root:

```typescript
// For files: ensure the path either IS the root or starts with root + '/'
const pattern = projectRoot.endsWith('/') ? projectRoot + '%' : projectRoot + '/%';
// Also add an OR for the root path itself if it can be stored directly:
// WHERE path NOT LIKE ? AND path != ?
```

---

_Reviewed: 2026-04-09_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
