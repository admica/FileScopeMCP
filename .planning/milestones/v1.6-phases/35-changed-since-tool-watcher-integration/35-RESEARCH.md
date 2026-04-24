# Phase 35: Changed-Since Tool + Watcher Integration - Research

**Researched:** 2026-04-23
**Domain:** MCP tool implementation, SQLite read helpers, git shell-out, watcher lifecycle
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Input Parsing (CHG-01, CHG-04)**
- D-01: Dispatch via SHA regex `/^[0-9a-fA-F]{7,40}$/` first, then `Date.parse`. SHA wins for hex strings ≥ 7 chars.
- D-02: Fewer than 7 hex chars falls through to `Date.parse`, likely returns `INVALID_SINCE`.
- D-03: Case-insensitive hex (`a-fA-F`); pass through to git unchanged.
- D-04: Empty or whitespace-only → `INVALID_SINCE` (Zod `z.string().min(1)` catches pure-empty).

**SHA Mode (CHG-03, CHG-04)**
- D-05: `.git` existence gate via `fsSync.existsSync(path.join(projectRoot, '.git'))` before shelling out.
- D-06: `execFileSync('git', ['diff','--name-only', sha, 'HEAD'], opts)` — NOT `execSync(string)`.
- D-07: Timeout = 5000ms, matching `git-diff.ts` convention.
- D-08: Any git failure (bad SHA, git not found, etc.) after the `.git` check → `INVALID_SINCE`. Log stderr, never leak it.
- D-09: Git output is POSIX repo-relative → `path.resolve(projectRoot, p)` + `canonicalizePath()` to normalize.
- D-10: Deleted files in git output naturally filtered by DB intersection (CHG-05).

**Timestamp Mode (CHG-02)**
- D-11: `Date.parse(since)` is authoritative. Accepts ISO-8601 + RFC-2822 variants.
- D-12: NULL mtime rows excluded; `is_directory = 1` rows excluded — both filters in SQL.
- D-13: Strict `>` (not `>=`) comparison.

**Response Shape (CHG-02)**
- D-14: Standard envelope `{items: [{path, mtime}], total, truncated?: true}`.
- D-15: `mtime` is always a number; SHA-mode files with NULL DB mtime coerce to `0`.
- D-16: Ordering: `mtime DESC, path ASC`.
- D-17: `maxItems` default=50, clamped `[1, 500]`.
- D-18: Empty result is `{items: [], total: 0}` — success, not an error.

**Error Codes (CHG-04)**
- D-19: Extend `ErrorCode` union in `src/mcp-server.ts:138` with `INVALID_SINCE | NOT_GIT_REPO`.
- D-20: Only three codes: `NOT_INITIALIZED`, `INVALID_SINCE`, `NOT_GIT_REPO`.

**Input Schema (Zod)**
- D-21: `{ since: z.string().min(1), maxItems: z.coerce.number().int().optional() }`.

**Tool Description**
- D-22: Long-form covering 7 facts (purpose, two modes, SHA mode mechanics, no deletion tracking, response shape, error codes, two concrete examples).
- D-23: Authored as `string[].join(' ')` literal.

**Repository Helpers**
- D-24: `getFilesChangedSince(mtimeMs)` — raw SQL, `getSqlite().prepare(...)` style.
- D-25: `getFilesByPaths(paths[])` — empty input returns `[]`; batch at 500.
- D-26: No changes to `getFile`, `upsertFile`, `getAllFiles`.

**Unlink Cascade (WTC-02)**
- D-27: Extend `deleteFile()` — three deletes inside one `better-sqlite3` transaction.
- D-28: Do NOT add a separate `deleteSymbolsForFile` call in `removeFileNode`.
- D-29: `deleteSymbolsForFile()` stays as-is; `deleteFile` inlines the DELETE.

**WTC-01 — Regression Guard Only**
- D-30: No production code change. Test only (see D-36).

**WTC-03 — No Per-Symbol Staleness Column**
- D-31: No schema change. File-granular mtime is the staleness model.

**PERF-02**
- D-32: Run `npm run bench-scan` at phase close; copy output to `35-changed-since-tool-watcher-integration/bench-end.json` before next run.
- D-33: Thresholds — self-scan 1833 ms (soft: 2108, hard: 2291); medium-repo 332 ms (soft: 382, hard: 415).
- D-34: Record numbers + verdict in `35-VERIFICATION.md`.

**Testing Strategy**
- D-35: `tests/unit/list-changed-since.test.ts` (new).
- D-36: `tests/unit/watcher-symbol-lifecycle.test.ts` (new, WTC-01 + WTC-02 regression guard).
- D-37: `tests/unit/repository.changed-since.test.ts` (new — wait, this is `src/db/repository.changed-since.test.ts` based on the pattern of Phase 33's `src/db/repository.symbols.test.ts`; see Conflict #2 below).
- D-38: Extend `tests/unit/schema-coercion.test.ts`.
- D-39: Extend `tests/unit/tool-outputs.test.ts`.
- D-40: Extend description-length probe conditionally if script covers all tools.

### Claude's Discretion
- Exact placement of `since` dispatcher: inline in handler vs `resolveSinceReference()` helper.
- Test file naming (`watcher-symbol-lifecycle.test.ts` vs split files).
- Whether `bench-scan.mjs` gets `--out` flag or plan uses shell `cp`.
- Whether `getFilesByPaths` uses Drizzle `inArray()` or raw IN query.
- Batch chunk size (500 is conservative; 100–900 acceptable).
- Exact prose of `list_changed_since` tool description.

### Deferred Ideas (OUT OF SCOPE)
- Deletion tombstones (CHG-05).
- Partial/short SHA resolution (< 7 chars).
- Fuzzy timestamp parsing.
- Per-directory filter.
- Cursor-based pagination.
- PERF-02 automation in CI.
- Watcher integration for Python/Go/Ruby (v1.7).
- Nexus UI surface.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHG-01 | New MCP tool `list_changed_since(since, maxItems?)` accepting ISO-8601 timestamp or 7+ char git SHA | D-01 dispatch logic verified; SHA regex confirmed; `Date.parse` behavior verified in Node 22 |
| CHG-02 | Returns `[{path, mtime}]` filtered by DB mtime > since | `getFilesChangedSince` SQL shape confirmed; no mtime index exists (research target 3 covers cost) |
| CHG-03 | Git-SHA mode resolves via `git diff --name-only <sha> HEAD`, filtered to DB-present paths | `execFileSync` pattern confirmed; git exit code 128 on bad SHA verified; path format verified POSIX-relative |
| CHG-04 | Error codes: `NOT_INITIALIZED`, `INVALID_SINCE`, `NOT_GIT_REPO` | `ErrorCode` union extension at `mcp-server.ts:138` confirmed; `mcpError` helper reused |
| CHG-05 | No deletion tracking — only files currently in DB | DB intersection via `getFilesByPaths` naturally excludes deleted paths |
| WTC-01 | FileWatcher re-extracts symbols on file change via same throttled single-pass walk | CONFIRMED IMPLEMENTED at `file-utils.ts:984` and `:1104`; only a test is needed |
| WTC-02 | FileWatcher on unlink invokes symbol cleanup | NOT IMPLEMENTED — `deleteFile()` at `:153` does not delete from `symbols`; requires transaction extension |
| WTC-03 | Symbols stale under same mtime model as edges | CONFIRMED by `setEdgesAndSymbols` single transaction; test only needed |
| PERF-02 | Wall time regression < 15% from Phase 33 baseline | Baseline confirmed in `baseline.json`; `bench-scan.mjs` output path is FIXED (see research target 6) |
</phase_requirements>

---

## Summary

Phase 35 closes v1.6 with three additive changes: a new `list_changed_since` MCP tool, a cascade DELETE extension in `deleteFile()`, and a PERF-02 regression gate. All wiring for WTC-01 (watcher re-extracts symbols on change) is confirmed already present in the codebase — only a regression-guard test is needed to prevent future drift. WTC-02 (unlink cascade) is the only production code gap: `deleteFile()` at `src/db/repository.ts:153` handles `file_dependencies` but not `symbols`.

The research confirms all locked CONTEXT.md decisions are consistent with the actual codebase. No conflicts were found except two naming/location details noted in the Conflicts section. Key findings: SQLite max variable number is 32,766 (not 999 as often cited); `bench-scan.mjs` has a FIXED output path hardcoded to the Phase 33 directory (copy-after-run is mandatory); the description-length probe script exists as `scripts/check-find-symbol-desc-len.mjs` but targets only `find_symbol` and is NOT wired in `package.json`.

**Primary recommendation:** Implement in three tasks — (1) repository helpers + `deleteFile` cascade, (2) MCP tool registration, (3) test suite — with bench-scan copy as the final step.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `list_changed_since` tool registration | API/MCP handler | — | Same registration site as all other tools (`src/mcp-server.ts`) |
| Input dispatch (SHA vs timestamp) | API/MCP handler | — | Short enough to inline (5-10 lines); no separate tier needed |
| Git shell-out | API/MCP handler | OS/child_process | Handler calls `execFileSync` directly; no coordinator involvement |
| DB read helpers (`getFilesChangedSince`, `getFilesByPaths`) | Database/Storage | — | Same `getSqlite().prepare()` pattern as all Phase 33/34 helpers |
| Unlink cascade (`deleteFile` extension) | Database/Storage | — | Single transaction wrapping the three DELETEs |
| Watcher symbol re-extraction (WTC-01) | Database/Storage | File system watcher | Already wired; `analyzeNewFile` produces symbols; `setEdgesAndSymbols` commits them |
| PERF-02 measurement | Build/script | — | `scripts/bench-scan.mjs` standalone script outside src/ |

---

## Research Target 1: `list_changed_since` Input Parsing

### ISO-8601 and Date.parse Behavior

**Findings [VERIFIED: Node 22.21.1 runtime test]:**

```
Date.parse('2026-04-23T12:34:56Z')  → 1776947696000   (valid ms epoch)
Date.parse('bad-input')             → NaN              (invalid)
Date.parse('')                      → NaN              (invalid)
Date.parse('2026-04-23')            → 1776902400000    (valid — date-only accepted)
Date.parse('   ')                   → NaN              (whitespace-only)
```

`isNaN(Date.parse(since))` is the correct guard. Whitespace-only strings pass Zod `z.string().min(1)` if they contain non-empty chars, but `Date.parse(' ')` returns `NaN` so they cleanly land in `INVALID_SINCE`. Pure-empty is caught by Zod before the handler runs.

**D-01 dispatch order is correct [VERIFIED]:** The SHA regex `/^[0-9a-fA-F]{7,40}$/` tests trim-insensitive (there is no leading/trailing whitespace in a 7–40 hex string). A 7-char lowercase hex string like `860fe61` matches the regex before `Date.parse` is called — which is the correct priority since `Date.parse('860fe61')` returns `NaN` anyway, making the order irrelevant for valid SHAs but explicit for clarity.

**`Date.parse` for RFC-2822 [ASSUMED]:** "Thu, 23 Apr 2026 12:00:00 GMT" would be accepted by Node's implementation, though agents are unlikely to send this form. The `since` description should steer agents toward ISO-8601 to avoid ambiguity.

### SHA Regex Confirmed

`/^[0-9a-fA-F]{7,40}$/` correctly captures git short SHAs (minimum 7) through full 40-char SHAs. Note: some repos use SHA-256 objects (64 chars) in experimental modes — not supported by this regex. For standard git (SHA-1), 40 chars is the maximum. [ASSUMED: SHA-256 git is not in use here; user confirmed zero legacy concerns.]

---

## Research Target 2: Git Invocation Safety

### execFileSync Behavior [VERIFIED: runtime test]

```typescript
// Bad SHA — exit code 128, throws SpawnSyncReturns error
execFileSync('git', ['diff', '--name-only', 'NONEXISTENT_SHA_XXXXX', 'HEAD'], {
  cwd: projectRoot,
  timeout: 5000,
  encoding: 'utf-8'
});
// → throws Error: Command failed: git diff --name-only NONEXISTENT_SHA_XXXXX HEAD
//   fatal: ambiguous argument 'NONEXISTENT_SHA_XXXXX': ...
//   (error.status === 128, error.signal === null)
```

The try/catch around `execFileSync` catches `status: 128`. No other handling needed — any throw after the `.git` gate collapses to `INVALID_SINCE` per D-08.

```typescript
// Good SHA (HEAD itself) — returns empty string ""
execFileSync('git', ['diff', '--name-only', 'HEAD_SHA', 'HEAD'], ...)
// → "" (empty, zero changed files — valid success)
```

**Injection safety [VERIFIED]:** `execFileSync` with an array arg does not invoke a shell. The SHA regex (D-01) is a belt-and-suspenders guard — even without it, no shell injection is possible via the array form.

**Existing codebase divergence [VERIFIED by reading `src/change-detector/git-diff.ts:27`]:**
The existing `getGitDiffOrContent()` uses `execSync` with a template string. That function hardcodes the command with a quoted `filePath` — the shell is invoked but the argument is a static, trusted path already on disk. Our `list_changed_since` SHA comes from user input via MCP, so `execFileSync` (D-06) is the correct choice.

### Git Output Path Format [VERIFIED: runtime test]

```
$ git diff --name-only ba23c36ba5 HEAD
.planning/PROJECT.md
.planning/REQUIREMENTS.md
src/db/repository.ts
tests/unit/tool-outputs.test.ts
```

**Confirmed:** POSIX-relative to repo root, forward-slash delimiters on Linux/WSL2. No leading slash. `path.resolve(projectRoot, line)` produces the correct absolute path, then `canonicalizePath()` normalizes it.

**Edge case [VERIFIED]:** Files at repo root (e.g., `package.json`) emit as bare filenames. `path.resolve(projectRoot, 'package.json')` handles this correctly.

### Node 22 child_process Specifics [ASSUMED: no breaking changes in Node 22 for `execFileSync` array form]

`execFileSync` with array args has been stable since Node 0.x. No Node 22-specific gotchas found. The `encoding: 'utf-8'` option returns a string directly (no `Buffer.toString()` needed).

---

## Research Target 3: SQLite Read Patterns

### Raw SQL Pattern Confirmed [VERIFIED by reading repository.ts]

The established pattern for new read helpers is `getSqlite().prepare(...)`:

```typescript
// From getSymbolsByName (repository.ts:961–966) — reference pattern
export function getSymbolsByName(name: string, kind?: SymbolKind): Array<SymbolRow & { path: string }> {
  const sqlite = getSqlite();
  const rows = kind
    ? sqlite.prepare('SELECT ... FROM symbols WHERE name = ? AND kind = ?').all(name, kind)
    : sqlite.prepare('SELECT ... FROM symbols WHERE name = ?').all(name) as SymbolDbRow[];
  return rows.map(rowToSymbol);
}
```

`getFilesChangedSince` and `getFilesByPaths` must follow this same style. No Drizzle on read paths in Phase 33/34.

### mtime Index Coverage [VERIFIED by reading schema.ts and migration 0000]

The `files` table has ONE index: `files_is_directory_idx ON files(is_directory)`.

**There is NO index on `mtime`.** The query for timestamp mode:

```sql
SELECT path, mtime FROM files
WHERE is_directory = 0 AND mtime IS NOT NULL AND mtime > ?
ORDER BY mtime DESC
```

will use the `files_is_directory_idx` index to filter `is_directory = 0` rows, then scan those rows for the `mtime > ?` predicate. For a 437-file self-scan DB (verified count from `baseline.json`), this is a full scan of non-directory rows — not a concern at this scale.

**For 5,000-file DBs [ASSUMED cost estimate]:** An index scan on `is_directory = 0` returning ~4,500 file rows, each needing an mtime comparison, is O(n) on non-directory rows. SQLite handles this in microseconds for 5k rows (no disk I/O for a hot DB). A composite index on `(is_directory, mtime)` would help at 100k+ rows but is unnecessary for v1.6 scale. CONTEXT D-24 does not add an index, and the research confirms this is the right call.

### SQLite Variable Limit [VERIFIED: runtime test with better-sqlite3 v12.6.2]

SQLite compiled with `MAX_VARIABLE_NUMBER=32766` (verified by `PRAGMA compile_options`). The common 999-variable limit is from SQLite's historical default before version 3.32.0 (2020). This better-sqlite3 build uses the modern limit.

Both 999 and 1000 variable prepared statements succeeded in testing.

**D-25 chunk size of 500 is safe and conservative [VERIFIED].** Any value up to ~32,000 would work with this build. The 500-chunk is a good defensive default.

**`getFilesByPaths` empty-input guard [CONFIRMED as necessary]:** `WHERE path IN ()` is a SQL syntax error. The empty-array fast-path (return `[]`) is mandatory.

---

## Research Target 4: Transaction Pattern for Extended `deleteFile`

### Current `deleteFile` [VERIFIED by reading repository.ts:153–166]

```typescript
export function deleteFile(filePath: string): void {
  const db = getDb();
  // Clean up dependencies referencing this file
  db.delete(file_dependencies)
    .where(or(
      eq(file_dependencies.source_path, filePath),
      eq(file_dependencies.target_path, filePath)
    ))
    .run();
  // Delete the file row
  db.delete(files).where(eq(files.path, filePath)).run();
}
```

**Critical observation:** The current `deleteFile` has NO transaction wrapping. The two Drizzle deletes are non-atomic — a crash between them would leave orphaned `file_dependencies` rows. Phase 35 wraps all three deletes in a `better-sqlite3` transaction, which is an improvement over the current state.

### `better-sqlite3` Transaction Style [VERIFIED by reading repository.ts:922–934, `setEdgesAndSymbols`:1099]

```typescript
// Pattern A: upsertSymbols (lines 922-934)
const tx = sqlite.transaction(() => {
  sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(filePath);
  // ... inserts
});
tx();

// Pattern B: setEdgesAndSymbols (lines 1098-1152)
const tx = sqlite.transaction(() => {
  const db = getDb();
  db.delete(file_dependencies)...run();    // Drizzle inside better-sqlite3 transaction
  // ... inserts
  sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(sourcePath);
  // ... inserts
});
tx();
```

**CRITICAL FINDING:** `setEdgesAndSymbols` at line 1099 ALREADY mixes Drizzle (`db.delete(file_dependencies)`) with raw `sqlite.prepare()` inside a single `better-sqlite3` transaction — and the comment at line 1102 explains why this is safe:

> "Calling setEdges() from here would still work because better-sqlite3 nests transactions, but inlining keeps the single-transaction guarantee explicit."

The Drizzle `db` object and the `sqlite` object from `getSqlite()` share the same underlying better-sqlite3 connection (`getDb()` returns the Drizzle wrapper over the same `sqlite` instance). Drizzle calls go through the same underlying connection — so mixing Drizzle and raw `sqlite.prepare()` inside a `sqlite.transaction()` wrapper is safe and already established in this codebase.

**D-27 extended `deleteFile` pattern [CONFIRMED safe]:**

```typescript
export function deleteFile(filePath: string): void {
  const sqlite = getSqlite();
  const db = getDb();
  const tx = sqlite.transaction(() => {
    db.delete(file_dependencies)
      .where(or(
        eq(file_dependencies.source_path, filePath),
        eq(file_dependencies.target_path, filePath)
      ))
      .run();
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(filePath);
    db.delete(files).where(eq(files.path, filePath)).run();
  });
  tx();
}
```

This also makes the existing two Drizzle deletes atomic — a side-benefit over the current un-transacted state.

**`deleteSymbolsForFile()` at line 1058 [VERIFIED stays as-is]:**

```typescript
export function deleteSymbolsForFile(filePath: string): void {
  const sqlite = getSqlite();
  sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(filePath);
}
```

Still callable directly by tests and future code. `deleteFile` inlines its own `DELETE FROM symbols` rather than delegating to `deleteSymbolsForFile` — this is D-29 and is correct (sharing the transaction requires inlining).

---

## Research Target 5: Testing Landscape

### Existing Test Files [VERIFIED by directory listing]

**`tests/unit/` directory:**
- `ast-diffing.test.ts` — AST-level diff tests
- `broker-queue.test.ts` — broker queue tests
- `config-loading.test.ts` — config loading
- `dependency-graph.test.ts` — graph tests
- `file-summary-enrichment.test.ts` — Phase 34 enrichment (get_file_summary)
- `file-watcher.test.ts` — FileWatcher class with mocked chokidar
- `find-symbol.test.ts` — `find_symbol` MCP tool behavior
- `importance-scoring.test.ts` — importance algorithm
- `parsers.test.ts` — parser tests
- `schema-coercion.test.ts` — Zod coercion contract (EXTEND for D-38)
- `tool-outputs.test.ts` — MCP response contract locks (EXTEND for D-39)

**`src/db/` directory:**
- `db.test.ts` — database open/close
- `migration-0005.test.ts` — migration schema validation
- `repository.symbols.test.ts` — symbol CRUD (Phase 33; reference harness for D-37)
- `repository.test.ts` — core repository tests

**D-37 naming clarification:** CONTEXT.md says `tests/unit/repository.changed-since.test.ts` but the Phase 33 precedent places repository tests at `src/db/repository.symbols.test.ts`. See Conflicts section.

### `schema-coercion.test.ts` Pattern [VERIFIED by reading the file]

The file reads `src/mcp-server.ts` source via `fs.readFile`, regex-matches the `registerTool` block, and asserts the schema contains specific Zod patterns. For `list_changed_since`:

```typescript
it('list_changed_since uses z.string().min(1) for since and z.coerce.number().int() for maxItems', async () => {
  const src = await fs.readFile(path.resolve(process.cwd(), 'src/mcp-server.ts'), 'utf-8');
  const match = src.match(/registerTool\("list_changed_since"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
  expect(match, 'list_changed_since registerTool block not found').toBeTruthy();
  const block = match![1];
  expect(block).toMatch(/since:\s*z\.string\(\)\.min\(1\)/);
  expect(block).toMatch(/maxItems:\s*z\.coerce\.number\(\)\.int\(\)/);
});
```

### `tool-outputs.test.ts` Pattern [VERIFIED by reading the file]

The file uses a temporary in-memory SQLite DB (created with manual `sqlite.exec(CREATE TABLE...)`) seeded via helper functions. The Phase 34 `find_symbol` contract test at line 436 is the direct analog:

```typescript
describe('find_symbol response contract (Phase 34)', () => {
  it('returns {items: [], total: 0} with no truncated key on zero match', ...)
  it('returns items with expected shape keys and omits truncated on full match', ...)
  it('includes truncated: true when items.length < total', ...)
});
```

For `list_changed_since`, the same pattern applies: insert rows into `files`, call the repository helper directly, simulate the envelope construction, assert shape. The `files` table in the test harness already has a `mtime` column (visible at line 45: `mtime REAL`).

**Tool name registry at line 540** currently has 14 tools listed. `list_changed_since` must be added as the 15th:

```typescript
const expectedTools = [
  // ... 14 existing tools ...
  'list_changed_since',   // Phase 35
];
```

### Watcher Lifecycle Tests (D-36) — Test Setup Pattern

**`tests/unit/file-watcher.test.ts` pattern [VERIFIED by reading]:** Uses `vi.mock('chokidar', ...)` to mock the watcher. Calls `setConfig()` and `setProjectRoot()` from `global-state.js`. No real FS, no real SQLite.

**D-36 requires a REAL SQLite DB** because `updateFileNodeOnChange` and `removeFileNode` (`file-utils.ts`) call `upsertFile`, `setEdgesAndSymbols`, and `deleteFile` — all repository functions. The test must open a temp DB. The `repository.symbols.test.ts` pattern (open real DB in tmpdir, `beforeEach` / `afterEach`) is the correct harness model.

**Challenge for WTC-01 test:** `updateFileNodeOnChange` is an `async` function that also calls `recalculateImportanceForAffected` and reads from `activeFileTree`. A direct call requires constructing a `FileNode` tree — heavyweight setup. Alternative: test at the repository level only (confirm `setEdgesAndSymbols` is called when analyzer returns symbols). The simplest approach that doesn't require constructing a tree is to mock `analyzeNewFile` (or use `extractTsJsFileParse` directly with a real TS file) and assert `getSymbolsForFile()` output.

**Recommended approach for D-36 WTC-01 test:** Write a temp TS file, call `updateFileNodeOnChange` with a real (minimal) file tree, verify `getSymbolsForFile()` reflects the extracted symbols. The `useAtomicWrite` path at line 984 is exercised by any `.ts`/`.tsx`/`.js`/`.jsx` file since `analyzeNewFile` sets `useAtomicWrite = true` for those extensions.

**Recommended approach for D-36 WTC-02 test:** Seed symbols directly with `upsertSymbols`, call `deleteFile(path)` or `removeFileNode(path, tree, root)` directly, assert `getSymbolsForFile(path)` returns `[]` and `SELECT COUNT(*) FROM symbols WHERE path = ?` returns 0.

### MCP Handler-Level Testing

No handler-level integration tests exist in this codebase — all tool testing is at the unit/repository level (confirmed by structure). The `tool-outputs.test.ts` contract tests call repository functions directly and simulate envelope construction. `list_changed_since` handler testing follows the same pattern: no mock MCP server needed.

---

## Research Target 6: PERF-02 Runner Mechanics

### bench-scan.mjs Analysis [VERIFIED by reading the full script]

**Fixed output path [VERIFIED: lines 21-24 of bench-scan.mjs]:**

```javascript
const OUT_PATH = path.join(
  REPO_ROOT, '.planning', 'phases',
  '33-symbol-extraction-foundation', 'baseline.json'
);
```

The output path is **hardcoded** to `33-symbol-extraction-foundation/baseline.json`. Re-running the script **WILL overwrite the Phase 33 baseline**. D-32's "copy after run" is mandatory.

**Correct plan step for PERF-02:**
1. `npm run build` (required — script imports from `dist/`)
2. `npm run bench-scan` (writes to `33-symbol-extraction-foundation/baseline.json`)
3. `cp .planning/phases/33-symbol-extraction-foundation/baseline.json .planning/phases/35-changed-since-tool-watcher-integration/bench-end.json`

The plan does NOT need to modify `bench-scan.mjs` to add a `--out` flag. Shell `cp` is simpler and avoids touching a script that is a locked baseline tool.

**build dependency [VERIFIED: lines 26-30 of bench-scan.mjs]:**

```javascript
if (!existsSync(COORDINATOR_JS) || !existsSync(REPO_JS)) {
  console.error('Run `npm run build` first (bench-scan imports from dist/).');
  process.exit(1);
}
```

`npm run build` is required before `npm run bench-scan`.

**Force-exit caveat [VERIFIED: lines 85-89]:**

```javascript
// coordinator.init() starts a FileWatcher (chokidar) that keeps the event loop alive.
// We have no public shutdown API on ServerCoordinator yet, so force-exit after the write.
process.exit(0);
```

The script calls `process.exit(0)` after writing — deterministic termination confirmed.

**bench-end.json content format [VERIFIED: matches baseline.json]:**

```json
{
  "captured_at": "ISO timestamp",
  "self_scan_ms": NUMBER,
  "medium_repo_scan_ms": NUMBER,
  "file_counts": { "self": NUMBER, "medium_repo": NUMBER },
  "node_version": "v22.21.1",
  "commit_sha": "SHORT_SHA"
}
```

The `35-VERIFICATION.md` comparison must use `self_scan_ms` and `medium_repo_scan_ms` fields. Baselines from `baseline.json`: self=1833ms, medium=332ms.

---

## Research Target 7: Tool Description Structure for MCP Discoverability

### The 7-Point Checklist for `list_changed_since` [VERIFIED against CONTEXT D-22]

The following facts MUST appear in the description (prose wording is Claude's discretion per D-23):

- [ ] **1. One-line purpose:** Re-orient after multi-file edits — returns every tracked file whose mtime (or git history) is newer than a given reference point.
- [ ] **2. Two modes:** ISO-8601 timestamp (e.g. `2026-04-23T10:00:00Z`) vs git SHA ≥ 7 chars (e.g. `860fe61`). Disambiguation: a 7-40 char hex string is treated as SHA; everything else is parsed as a date.
- [ ] **3. SHA mode mechanics:** Invokes `git diff --name-only <sha> HEAD`; intersects results with the DB; git failure (unknown SHA, no git, etc.) returns `INVALID_SINCE`.
- [ ] **4. No deletion tracking:** Only files currently in the DB appear. Deleted files are NOT listed.
- [ ] **5. Response shape:** `{items: [{path, mtime}], total, truncated?: true}`; `mtime` is ms epoch number (0 if unknown for SHA-mode files); default `maxItems=50`, clamped `[1, 500]`.
- [ ] **6. Error codes:** `NOT_INITIALIZED` (server not set up), `INVALID_SINCE` (unparseable input or failed git), `NOT_GIT_REPO` (SHA mode without `.git`).
- [ ] **7. Concrete examples:** `list_changed_since("2026-04-23T10:00:00Z")` and `list_changed_since("860fe61")` both shown with expected return shape or behavior description.

### Description Authoring Style [VERIFIED]

`find_symbol` description in `src/mcp-server.ts:332–343` is authored as `string[].join(' ')` — confirmed. `list_changed_since` must follow the identical pattern for consistency and probe-script compatibility.

### Description-Length Probe Script [VERIFIED by reading `scripts/check-find-symbol-desc-len.mjs`]

The probe script is named `scripts/check-find-symbol-desc-len.mjs`. It:
- Reads `src/mcp-server.ts`
- Regex-matches `registerTool("find_symbol"...)` and the `description: [...].join` array
- Reports character count; exits 1 if > 2000 chars
- Is **NOT wired in `package.json`** as a named script (confirmed by `grep` — only `bench-scan` and `inspect-symbols` appear)

**D-40 assessment [VERIFIED]:** The existing probe is `find_symbol`-specific. CONTEXT D-40 says "add a `list_changed_since` description length probe if the script already covers tool descriptions." Since it does NOT (it only covers `find_symbol`), D-40 is technically not triggered by the "if already covers all tools" condition. However, the planner may choose to extend the script to cover `list_changed_since` as a parallel probe, or create a sibling `scripts/check-list-changed-since-desc-len.mjs`. Both are discretionary.

---

## Research Target 8: Risks and Landmines

### Risk 1: Timestamp Test Flakiness

**Scenario:** Timestamp-mode tests that insert a file with `mtime = Date.now()` and then call `getFilesChangedSince(Date.now())` may flake if clock resolution causes `mtime === since` (strict `>` boundary).

**Mitigation:** In tests, set `mtime` to a fixed past timestamp (e.g., `1000`) and call `getFilesChangedSince(999)`. Never compare against a live `Date.now()` in the boundary assertion. Use explicit numeric literals in all boundary tests.

### Risk 2: Git Repo State in SHA Mode Tests

**Scenario:** SHA mode tests must invoke git (or mock `execFileSync`). Using real git requires a stable SHA. HEAD changes with every commit — tests that call `git diff --name-only HEAD~1 HEAD` would enumerate real changed files from the actual repo, making assertions fragile.

**Recommended approach:** Mock `execFileSync` in the `list-changed-since.test.ts` unit test using `vi.mock('node:child_process', ...)` or `vi.spyOn`. Provide a fake stdout that returns a known list of paths. This is the correct unit-test approach — the git invocation itself is already verified by the runtime tests above.

For the DB intersection part, seed `files` rows with known paths and verify only seeded paths appear in the result.

**Capturing a stable SHA [if integration-style test is preferred]:** `git rev-parse HEAD` inside `beforeAll` gives the current HEAD SHA. `git diff --name-only HEAD HEAD` returns empty string (valid, 0 changed files) — this is a safe no-op SHA-mode integration test that exercises the full code path.

### Risk 3: WTC-01 Test Complexity

`updateFileNodeOnChange` takes `(filePath, activeFileTree, activeProjectRoot)`. The `activeFileTree` parameter requires a valid `FileNode` tree rooted at `activeProjectRoot`. For the regression guard test:

- Create a real `FileNode` tree with one file node (minimal: `{ path, name, isDirectory: false, ... }`)
- Write a real `.ts` file to tmpdir with a known symbol (e.g., `export function hello() {}`)
- Call `updateFileNodeOnChange(tmpFile, tree, tmpDir)`
- Assert `getSymbolsForFile(tmpFile)` contains `{ name: 'hello', kind: 'function', isExport: true }`

The `useAtomicWrite` flag is set to `true` in `analyzeNewFile` whenever the file extension is `.ts`/`.tsx`/`.js`/`.jsx` (verified at line 863). The test must use one of these extensions.

### Risk 4: `deleteFile` Transaction — Existing Tests May Need Updates

The current `deleteFile` is NOT wrapped in a transaction. Adding a `sqlite.transaction()` wrapper could affect tests that call `deleteFile` and then verify state in a way that assumed non-atomic behavior. Review `src/db/repository.test.ts` for any `deleteFile` calls before extending.

**Actual risk level:** LOW. Making two non-atomic operations atomic doesn't change the observable outcome from a test's perspective — tests already pass against the current non-atomic implementation. Adding a transaction only makes it more correct.

### Risk 5: bench-scan Overwrites Baseline

As confirmed in Research Target 6, running `npm run bench-scan` OVERWRITES `33-symbol-extraction-foundation/baseline.json`. If the plan does not copy the output before a subsequent run, the Phase 33 baseline is lost (it can be recovered from git, but this is a footgun).

**The plan MUST include the `cp` step immediately after `npm run bench-scan`.** Do not separate these into different tasks or waves.

### Risk 6: `.git` Detection Path

D-05 specifies `fsSync.existsSync(path.join(projectRoot, '.git'))`. The `projectRoot` comes from the coordinator's initialized state — same as what `git-diff.ts` uses as `cwd`. This is correct for standard git repos. Worktrees have `.git` as a file (not a directory) pointing to the main repo — `existsSync` returns true for both, so `.git` file worktrees are correctly handled.

---

## Standard Stack

### Core (this phase — no new dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.6.2 | SQLite transactions, raw prepare() | Already in use; verified MAX_VARIABLE_NUMBER=32766 |
| node:child_process | built-in | `execFileSync` for git shell-out | Built-in; injection-safe array form |
| node:fs (sync) | built-in | `.git` existence check | `fsSync.existsSync` already used elsewhere |
| zod | existing | Input schema validation | `z.string().min(1)` + `z.coerce.number().int()` |
| vitest | existing | Test framework | All existing tests use vitest |

No new npm dependencies are introduced by this phase.

---

## Architecture Patterns

### Pattern 1: Tool Handler with Dual-Mode Dispatch

```typescript
// Source: CONTEXT.md D-01 and verified Date.parse behavior
const SHA_RE = /^[0-9a-fA-F]{7,40}$/;

// In the MCP handler:
const limit = Math.max(1, Math.min(500, maxItems ?? 50));

if (SHA_RE.test(since)) {
  // SHA mode — D-05 through D-10
  if (!fsSync.existsSync(path.join(projectRoot, '.git'))) {
    return mcpError('NOT_GIT_REPO', '...');
  }
  try {
    const stdout = execFileSync('git', ['diff', '--name-only', since, 'HEAD'], {
      cwd: projectRoot,
      timeout: 5000,
      encoding: 'utf-8',
    });
    const repoPaths = stdout.trim().split('\n').filter(Boolean);
    const absPaths = repoPaths.map(p => canonicalizePath(path.resolve(projectRoot, p)));
    const rows = getFilesByPaths(absPaths);
    // sort by mtime DESC, path ASC; build envelope
  } catch (err) {
    log('[list_changed_since] git error:', err);
    return mcpError('INVALID_SINCE', '...');
  }
} else {
  const ms = Date.parse(since);
  if (isNaN(ms)) {
    return mcpError('INVALID_SINCE', '...');
  }
  // Timestamp mode — D-11 through D-13
  const rows = getFilesChangedSince(ms);
  // sort + build envelope
}
```

### Pattern 2: `getFilesChangedSince` Raw SQL [VERIFIED: matches D-24 and getSymbolsByName style]

```typescript
// Source: CONTEXT.md D-24; mirrors getSymbolsByName pattern at repository.ts:961
export function getFilesChangedSince(mtimeMs: number): Array<{ path: string; mtime: number }> {
  const sqlite = getSqlite();
  return (sqlite
    .prepare(
      'SELECT path, mtime FROM files WHERE is_directory = 0 AND mtime IS NOT NULL AND mtime > ? ORDER BY mtime DESC'
    )
    .all(mtimeMs) as Array<{ path: string; mtime: number }>);
}
```

### Pattern 3: `getFilesByPaths` with 500-item Chunking

```typescript
// Source: CONTEXT.md D-25; SQLITE_MAX_VARIABLE_NUMBER=32766 verified, 500 is safe
export function getFilesByPaths(paths: string[]): Array<{ path: string; mtime: number | null }> {
  if (paths.length === 0) return [];
  const sqlite = getSqlite();
  const results: Array<{ path: string; mtime: number | null }> = [];
  const CHUNK = 500;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const rows = sqlite
      .prepare(`SELECT path, mtime FROM files WHERE path IN (${placeholders})`)
      .all(...chunk) as Array<{ path: string; mtime: number | null }>;
    results.push(...rows);
  }
  return results;
}
```

### Pattern 4: Extended `deleteFile` [VERIFIED: mixes Drizzle + raw sqlite inside better-sqlite3 tx — safe per setEdgesAndSymbols precedent]

```typescript
export function deleteFile(filePath: string): void {
  const sqlite = getSqlite();
  const db = getDb();
  const tx = sqlite.transaction(() => {
    db.delete(file_dependencies)
      .where(or(
        eq(file_dependencies.source_path, filePath),
        eq(file_dependencies.target_path, filePath)
      ))
      .run();
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(filePath);
    db.delete(files).where(eq(files.path, filePath)).run();
  });
  tx();
}
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ISO-8601 parsing | Custom date parser | `Date.parse()` built-in | Node 22 handles ISO-8601 + RFC-2822; NaN for invalid |
| SHA validation | Multi-step git probe | Regex `/^[0-9a-fA-F]{7,40}$/` + try/catch | Git gives the definitive answer via exit code |
| SQL injection protection for SHA | Manual escaping | `execFileSync` array form | Shell never invoked; array args are not parsed |
| Variable-count SQL | Loop with individual queries | Batched `WHERE path IN (?,?,...)` | Batch is faster; 32k variable limit is not a real constraint |
| Transaction for deleteFile | Multiple single-statement calls | `sqlite.transaction(() => {...})()` | Already the repo pattern; atomicity is free |

---

## Conflicts with CONTEXT.md

### Conflict 1: `deleteFile` currently has NO transaction

**CONTEXT.md D-27 says:** "Wrap the three deletes in a `better-sqlite3` transaction."

**Reality:** The current `deleteFile()` (lines 153–166) has NO transaction wrapper. The two existing Drizzle deletes run non-atomically. Phase 35 adds the transaction AND adds the symbols delete — this is an improvement to the existing code, not a bug. The plan should note this and frame the change as "wrap + extend" not just "add one DELETE".

**Impact on planner:** The implementation task must call `getSqlite()` in addition to `getDb()`, and ensure the existing two Drizzle deletes are pulled inside the `sqlite.transaction()` callback.

### Conflict 2: D-37 repository test file location

**CONTEXT.md D-37 says:** `tests/unit/repository.changed-since.test.ts`

**Codebase precedent:** Phase 33 repository tests live at `src/db/repository.symbols.test.ts` (not under `tests/unit/`). The directory listing confirms `src/db/repository.symbols.test.ts` exists; there is no `tests/unit/repository.*.test.ts`.

**Recommendation:** Place the new file at `src/db/repository.changed-since.test.ts` to match the Phase 33 precedent. CONTEXT.md's path is inconsistent with the actual codebase structure. The planner should use `src/db/repository.changed-since.test.ts`.

### Conflict 3: `check-find-symbol-desc-len.mjs` is not in `package.json`

**CONTEXT.md D-40 references** a "description-length probe script in `scripts/`." The script exists as `scripts/check-find-symbol-desc-len.mjs` but is not wired in `package.json` as a named npm script (confirmed by grep). It is a standalone script run directly.

**Impact on planner:** If the plan includes a "run description probe" task for `list_changed_since`, it must use `node scripts/check-list-changed-since-desc-len.mjs` (new sibling script) or extend the existing one, not `npm run check-find-symbol-desc-len`. No `package.json` entry exists to call.

---

## Common Pitfalls

### Pitfall 1: Forgetting the bench-scan copy step

**What goes wrong:** `npm run bench-scan` overwrites `33-symbol-extraction-foundation/baseline.json`. If a subsequent `bench-scan` run is triggered (e.g., by a CI step or a developer running it manually), the Phase 33 baseline is clobbered.

**How to avoid:** The plan must make the copy (`cp baseline.json bench-end.json`) the immediate next step after `npm run bench-scan`. Never separate them.

**Warning signs:** `bench-end.json` file contains a `captured_at` timestamp from Phase 33 rather than Phase 35.

### Pitfall 2: Timestamp comparison with mtime=0 in SHA mode

**What goes wrong:** SHA mode returns files whose DB mtime is NULL (coerced to 0 per D-15). If the response consumer sorts by `mtime DESC`, these `0` entries sort to the bottom — correct. But if consumer interprets `mtime=0` as epoch zero (Jan 1 1970), it might confuse agents.

**How to avoid:** The tool description must explicitly state that `mtime: 0` means "unknown mtime for this file." D-22 fact 5 covers this.

### Pitfall 3: `WHERE path IN ()` syntax error

**What goes wrong:** If `getFilesByPaths([])` does not fast-return early and tries to build an empty `IN ()` clause, SQLite throws.

**How to avoid:** D-25 mandates the early return: `if (paths.length === 0) return []`. This is the only guard needed — no other empty-collection checks are required.

### Pitfall 4: SHA regex matches date strings

**What goes wrong:** A string like `20261201` (8 hex chars) matches `/^[0-9a-fA-F]{7,40}$/` and would be treated as a SHA. `Date.parse('20261201')` returns a valid timestamp (it's ISO 8601 basic format `YYYYMMDD`).

**Impact:** Low. The dispatch is SHA-first by design (D-01). An agent passing `20261201` would get `INVALID_SINCE` if that's not a valid SHA. This is an acceptable edge case — agents should pass ISO-8601 with separators (`2026-12-01`) to avoid ambiguity. Document in the tool description that strings matching 7–40 hex chars are always treated as SHAs.

### Pitfall 5: Mixing `db.delete()` and `sqlite.prepare()` without understanding the connection sharing

**What goes wrong:** A developer unfamiliar with the codebase might wrap only the `sqlite.prepare()` calls in the transaction and leave the Drizzle `db.delete()` calls outside.

**How to avoid:** The `setEdgesAndSymbols` function (lines 1099–1152) is the canonical reference: it wraps both Drizzle writes and raw `sqlite.prepare()` calls inside a single `sqlite.transaction()`. Follow that pattern exactly.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Date.parse` RFC-2822 form (e.g., "Thu, 23 Apr 2026") is accepted by Node 22 | Research Target 1 | Agents sending RFC-2822 get unexpected `INVALID_SINCE`; low risk since description steers toward ISO-8601 |
| A2 | SHA-256 git repos (64-char SHAs) are not in use here | Research Target 1 | 64-char SHAs fail the `/^[0-9a-fA-F]{7,40}$/` regex and land in `Date.parse` → `NaN` → `INVALID_SINCE` |
| A3 | Node 22 `execFileSync` has no breaking changes vs earlier versions | Research Target 2 | Extremely unlikely; `execFileSync` array form is a stable API |
| A4 | 5,000-file DBs do not require an mtime index for acceptable query performance | Research Target 3 | Full non-directory row scan at 5k rows is sub-millisecond in SQLite; only a problem at 100k+ rows |

---

## Open Questions

1. **`getFilesByPaths` — raw SQL vs Drizzle `inArray()`**
   - What we know: CONTEXT D-25 mentions both as options; discretion area; raw SQL is the Phase 33/34 precedent
   - What's unclear: Whether using Drizzle `inArray()` would be cleaner for the chunking case
   - Recommendation: Use raw SQL (`getSqlite().prepare()`) — matches `getFilesChangedSince` and keeps all new helpers in the same style

2. **`resolveSinceReference()` helper vs inline dispatch**
   - What we know: CONTEXT says this is Claude's discretion; both are 5-10 lines
   - What's unclear: Whether unit tests should test the helper in isolation
   - Recommendation: Inline in the handler for the same reason `find_symbol` inlines the clamp + projection (STATE.md Phase 34 decision). Tests can reach it via the handler test.

3. **`watcher-symbol-lifecycle.test.ts` — whether to call `updateFileNodeOnChange` directly or test at repository level**
   - What we know: `updateFileNodeOnChange` requires a `FileNode` tree; `deleteFile` can be tested directly
   - What's unclear: How heavyweight the tree construction would be
   - Recommendation: For WTC-01, test via `setEdgesAndSymbols` + `getSymbolsForFile` directly (repository level), with a comment citing the wiring at file-utils.ts:984. For WTC-02, test `deleteFile` directly — no tree needed.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| git | SHA mode + bench-scan commit SHA capture | ✓ | system git (WSL2) | — |
| node | bench-scan, tests | ✓ | v22.21.1 | — |
| better-sqlite3 | DB helpers | ✓ | ^12.6.2 | — |
| `dist/coordinator.js` | bench-scan | build-time | built by `npm run build` | Run `npm run build` first |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** `dist/coordinator.js` — requires `npm run build` before `npm run bench-scan`. Plan must include a build step before the PERF-02 task.

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED: runtime test, Node 22.21.1] — `Date.parse` behavior for ISO-8601 and invalid inputs
- [VERIFIED: runtime test, execFileSync] — git exit code 128 for bad SHA; path format for `git diff --name-only`
- [VERIFIED: runtime test, better-sqlite3 v12.6.2] — `MAX_VARIABLE_NUMBER=32766`; 500 and 999 variable prepared statements succeed
- [VERIFIED: src/db/repository.ts:153–166] — `deleteFile` is NOT transacted currently; no symbols DELETE
- [VERIFIED: src/db/repository.ts:1099–1152] — `setEdgesAndSymbols` mixes Drizzle + raw sqlite in one transaction; safe precedent
- [VERIFIED: src/file-utils.ts:983–984, 1103–1104] — `setEdgesAndSymbols` called by both `updateFileNodeOnChange` and `addFileNode`
- [VERIFIED: src/file-utils.ts:1215] — `removeFileNode` calls `deleteFile`
- [VERIFIED: scripts/bench-scan.mjs:21-24] — output path is FIXED to Phase 33 directory
- [VERIFIED: scripts/check-find-symbol-desc-len.mjs] — probe script exists; targets find_symbol only; not in package.json
- [VERIFIED: tests/unit/tool-outputs.test.ts:540–566] — tool name registry test; currently 14 tools
- [VERIFIED: src/db/schema.ts] — no mtime index; only `files_is_directory_idx` exists

### Secondary (MEDIUM confidence)
- [CITED: better-sqlite3 transaction docs pattern] — `sqlite.transaction(() => { ... })()` call style (confirmed by codebase usage)

---

## Metadata

**Confidence breakdown:**
- Input parsing and Date.parse behavior: HIGH — verified by runtime test
- Git invocation safety: HIGH — verified by runtime test with bad and good SHAs
- SQLite variable limit: HIGH — verified by runtime test; `MAX_VARIABLE_NUMBER=32766`
- Transaction mixing safety: HIGH — verified by reading `setEdgesAndSymbols` which already does this
- WTC-01 already implemented: HIGH — verified at exact line numbers
- bench-scan fixed output path: HIGH — verified by reading script source
- mtime index absence: HIGH — verified by reading all migration files
- Test file locations: HIGH — verified by directory listing and reading existing test files

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (stable codebase; no fast-moving dependencies)
