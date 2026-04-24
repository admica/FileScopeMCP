# Phase 35: Changed-Since Tool + Watcher Integration - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 8 target files (2 modified, 2 new test files, 2 extended test files, 1 new repo test, 1 new watcher test)
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/mcp-server.ts` | extend existing | request-response | `src/mcp-server.ts` lines 331–378 (`find_symbol` registration) | exact |
| `src/db/repository.ts` | extend existing | CRUD | `src/db/repository.ts` lines 961–1061 (symbol read helpers + `deleteSymbolsForFile`) | exact |
| `src/db/repository.changed-since.test.ts` | new test | CRUD | `src/db/repository.symbols.test.ts` lines 1–58 (DB harness) | exact |
| `tests/unit/list-changed-since.test.ts` | new test | request-response | `tests/unit/find-symbol.test.ts` lines 1–50 (harness + simulate helper) | exact |
| `tests/unit/watcher-symbol-lifecycle.test.ts` | new test | event-driven | `src/db/repository.symbols.test.ts` lines 1–58 (real DB harness) | role-match |
| `tests/unit/schema-coercion.test.ts` | extend existing | — | `tests/unit/schema-coercion.test.ts` lines 65–75 (`find_symbol` coercion test) | exact |
| `tests/unit/tool-outputs.test.ts` | extend existing | — | `tests/unit/tool-outputs.test.ts` lines 436–485 (`find_symbol` contract block) | exact |

> **Location correction (RESEARCH Conflict 2):** CONTEXT.md D-37 names the repository test `tests/unit/repository.changed-since.test.ts` but the codebase places all repository-level tests under `src/db/`. The correct path is `src/db/repository.changed-since.test.ts`, matching the Phase 33 precedent at `src/db/repository.symbols.test.ts`.

---

## Pattern Assignments

---

### `src/mcp-server.ts` — extend `ErrorCode` union + register `list_changed_since`

**Analog:** `src/mcp-server.ts` lines 138–150 (`ErrorCode` + helpers) and lines 331–378 (`find_symbol` registration)

**ErrorCode union extension** (line 138 — add two new members):
```typescript
// BEFORE (line 138):
type ErrorCode = "NOT_INITIALIZED" | "INVALID_PATH" | "BROKER_DISCONNECTED" | "NOT_FOUND" | "OPERATION_FAILED";

// AFTER (extend with D-19):
type ErrorCode = "NOT_INITIALIZED" | "INVALID_PATH" | "BROKER_DISCONNECTED" | "NOT_FOUND" | "OPERATION_FAILED"
              | "INVALID_SINCE" | "NOT_GIT_REPO";
```

**`mcpError` / `mcpSuccess` helpers** (lines 140–151 — no changes, copy pattern):
```typescript
// src/mcp-server.ts:140-151
function mcpError(code: ErrorCode, message: string): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: code, message }) }],
    isError: true,
  };
}

function mcpSuccess(data: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, ...data }) }],
  };
}
```

**Tool registration pattern** (lines 331–378 — `find_symbol` is the direct template):
```typescript
// src/mcp-server.ts:331-378
server.registerTool("find_symbol", {
  title: "Find Symbol",
  description: [
    "Resolve a symbol name ...",
    "Exact case-sensitive match; trailing `*` switches to prefix match ...",
    // ... additional string array elements
  ].join(' '),
  inputSchema: {
    name: z.string().min(1).describe("Symbol name; trailing `*` triggers prefix match"),
    kind: z.string().optional().describe("..."),
    exportedOnly: z.coerce.boolean().default(true).describe("..."),
    maxItems: z.coerce.number().int().optional().describe("..."),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ name, kind, exportedOnly, maxItems }) => {
  if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "...");

  const limit = Math.max(1, Math.min(500, maxItems ?? 50));  // D-17 clamp
  const { items, total } = findSymbols({ name, kind: kindFilter, exportedOnly, limit });
  const truncated = items.length < total;

  return mcpSuccess({
    items: items.map(s => ({ ... })),
    total,
    ...(truncated && { truncated: true }),  // conditional spread — D-14/D-07
  });
});
```

**Divergences for `list_changed_since`:**

1. **Input schema** (D-21): `{ since: z.string().min(1), maxItems: z.coerce.number().int().optional() }`. Note `since` is `z.string()` not `z.coerce.*` — the handler does the dispatch, not Zod.
2. **Three error codes** instead of one (D-20): `NOT_INITIALIZED`, `INVALID_SINCE`, `NOT_GIT_REPO`.
3. **Dual-mode dispatch** (D-01) — inline in the handler body (not a helper):
   ```typescript
   const SHA_RE = /^[0-9a-fA-F]{7,40}$/;
   const limit = Math.max(1, Math.min(500, maxItems ?? 50));
   if (SHA_RE.test(since)) {
     // SHA mode (D-05 through D-10)
     if (!fsSync.existsSync(path.join(projectRoot, '.git'))) {
       return mcpError('NOT_GIT_REPO', '...');
     }
     try {
       const stdout = execFileSync('git', ['diff', '--name-only', since, 'HEAD'], {
         cwd: projectRoot, timeout: 5000, encoding: 'utf-8',
       });
       const absPaths = stdout.trim().split('\n').filter(Boolean)
         .map(p => canonicalizePath(path.resolve(projectRoot, p)));
       const rows = getFilesByPaths(absPaths);
       // sort + envelope
     } catch (err) {
       log('[list_changed_since] git error:', err);
       return mcpError('INVALID_SINCE', '...');
     }
   } else {
     const ms = Date.parse(since);
     if (isNaN(ms)) return mcpError('INVALID_SINCE', '...');
     const rows = getFilesChangedSince(ms);
     // sort + envelope
   }
   ```
4. **`execFileSync` not `execSync`** (D-06): `git-diff.ts:27` uses `execSync` with a template string. For user-input SHAs, use `execFileSync('git', ['diff', '--name-only', sha, 'HEAD'], opts)` — injection-safe array form.
5. **Response item shape**: `{path, mtime}` not `{path, name, kind, ...}` (D-14). `mtime` coerced to `0` for NULL rows in SHA mode (D-15).
6. **Ordering**: `mtime DESC, path ASC` (D-16). For SHA mode, sort in JS after the DB intersection (DB returns unordered).
7. **`projectRoot`**: obtained from coordinator, same as other handlers that call `coordinator.getProjectRoot()` or equivalent.

---

### `src/db/repository.ts` — new `getFilesChangedSince`, `getFilesByPaths`, extend `deleteFile`

**Analog A (read helpers):** `src/db/repository.ts` lines 961–966 (`getSymbolsByName` raw-SQL pattern)

```typescript
// src/db/repository.ts:961-967
export function getSymbolsByName(name: string, kind?: SymbolKind): Array<SymbolRow & { path: string }> {
  const sqlite = getSqlite();
  const rows = kind
    ? sqlite.prepare('SELECT path, name, kind, start_line, end_line, is_export FROM symbols WHERE name = ? AND kind = ?').all(name, kind) as SymbolDbRow[]
    : sqlite.prepare('SELECT path, name, kind, start_line, end_line, is_export FROM symbols WHERE name = ?').all(name) as SymbolDbRow[];
  return rows.map(rowToSymbol);
}
```

**`getFilesChangedSince` pattern** (D-24 — single prepared statement, no Drizzle):
```typescript
// New function — mirrors getSymbolsByName style
export function getFilesChangedSince(mtimeMs: number): Array<{ path: string; mtime: number }> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      'SELECT path, mtime FROM files WHERE is_directory = 0 AND mtime IS NOT NULL AND mtime > ? ORDER BY mtime DESC'
    )
    .all(mtimeMs) as Array<{ path: string; mtime: number }>;
}
```

**`getFilesByPaths` pattern** (D-25 — empty guard + 500-item batching):
```typescript
// New function — empty guard is mandatory (WHERE path IN () is SQL syntax error)
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

**Analog B (transaction + symbols delete):** `src/db/repository.ts` lines 1092–1156 (`setEdgesAndSymbols` — authoritative reference for mixing Drizzle + raw sqlite inside one `sqlite.transaction()`)

```typescript
// src/db/repository.ts:1098-1155 — canonical mixed Drizzle+raw-sqlite transaction
export function setEdgesAndSymbols(...): void {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(() => {
    const db = getDb();
    db.delete(file_dependencies)          // Drizzle inside better-sqlite3 tx — safe
      .where(eq(file_dependencies.source_path, sourcePath))
      .run();
    // ... more Drizzle inserts ...
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(sourcePath);  // raw
    // ... raw inserts ...
  });
  tx();
}
```

**Extended `deleteFile` pattern** (D-27 — wrap + add symbols DELETE):
```typescript
// BEFORE (lines 153-166): two non-atomic Drizzle deletes, no transaction
export function deleteFile(filePath: string): void {
  const db = getDb();
  db.delete(file_dependencies).where(or(...)).run();
  db.delete(files).where(eq(files.path, filePath)).run();
}

// AFTER (D-27): three deletes inside one sqlite.transaction()
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
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(filePath);  // NEW
    db.delete(files).where(eq(files.path, filePath)).run();
  });
  tx();
}
```

**Divergences:**
- `deleteFile` currently calls only `getDb()`. After the change it also calls `getSqlite()` to get the raw connection for the transaction wrapper and the `DELETE FROM symbols` statement.
- `deleteSymbolsForFile` at line 1058 is NOT delegated to — the DELETE is inlined to share the transaction (D-29).

---

### `src/db/repository.changed-since.test.ts` — new repository test

**Analog:** `src/db/repository.symbols.test.ts` lines 1–58 (DB lifecycle harness)

```typescript
// src/db/repository.symbols.test.ts:1-58
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase, getSqlite } from './db.js';
import { upsertSymbols, getSymbolsByName, ... } from './repository.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-sym-repo-'));
  return path.join(tmpDir, 'test.db');
}

beforeEach(() => {
  const dbPath = makeTmpDb();
  openDatabase(dbPath);
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
});
```

**What to import instead:**
```typescript
import { getFilesChangedSince, getFilesByPaths, upsertFile } from './repository.js';
```

**Seeding helper** — `upsertFile` inserts into `files` with an explicit `mtime`. The test also needs a helper that directly sets `mtime` via raw SQL since `upsertFile` may not expose `mtime` directly:
```typescript
// src/db/repository.symbols.test.ts:157-159 pattern — raw SQL for precise column control
getSqlite()
  .prepare('UPDATE files SET mtime = ? WHERE path = ?')
  .run(mtimeMs, filePath);
```

**Divergences:**
- No `SymbolRow` type import needed — these tests work with `{path, mtime}` shapes.
- D-37 tests to cover: ordering (`mtime DESC`), NULL-mtime rows excluded, `is_directory=1` rows excluded, strict `>` boundary, `getFilesByPaths` empty-input fast-return, partial path matches, batch-chunking behavior above 500 paths.
- Risk: timestamp boundary tests must use fixed numeric literals (e.g., `mtime = 1000`, `getFilesChangedSince(999)`) not live `Date.now()` — avoids flakiness (RESEARCH Risk 1).

---

### `tests/unit/list-changed-since.test.ts` — new MCP tool behavior test

**Analog:** `tests/unit/find-symbol.test.ts` lines 1–50 (harness + `simulateFindSymbolResponse` helper)

```typescript
// tests/unit/find-symbol.test.ts:1-50
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, closeDatabase } from '../../src/db/db.js';
import { findSymbols, upsertSymbols } from '../../src/db/repository.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-symbol-test-'));
  return path.join(tmpDir, 'test.db');
}

beforeEach(() => { openDatabase(makeTmpDb()); });
afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// Handler-level clamp + envelope simulation helper
function simulateFindSymbolResponse(args: {...}) {
  const limit = Math.max(1, Math.min(500, args.maxItems ?? 50));
  const { items, total } = findSymbols({ ... });
  const truncated = items.length < total;
  return { items: items.map(s => ({ ... })), total, ...(truncated && { truncated: true }) };
}
```

**Adapted `simulateListChangedSinceResponse` helper** — mirrors same pattern:
```typescript
// Inline the SHA_RE + dispatch logic from the handler for unit coverage
const SHA_RE = /^[0-9a-fA-F]{7,40}$/;

function simulateTimestampMode(since: string, maxItems?: number) {
  const limit = Math.max(1, Math.min(500, maxItems ?? 50));
  const ms = Date.parse(since);
  if (isNaN(ms)) return { ok: false, error: 'INVALID_SINCE' };
  const rows = getFilesChangedSince(ms);
  const total = rows.length;
  const items = rows.slice(0, limit).map(r => ({ path: r.path, mtime: r.mtime }));
  return { ok: true, items, total, ...(items.length < total && { truncated: true }) };
}
```

**For SHA mode** — mock `execFileSync` via `vi.mock('node:child_process', ...)` or `vi.spyOn`. Do NOT invoke real git with a live SHA (RESEARCH Risk 2). Use `git diff HEAD HEAD` as a no-op integration probe if real git is preferred.

**Divergences from `find-symbol.test.ts`:**
- Imports `getFilesChangedSince` + `getFilesByPaths` from repository, not `findSymbols`.
- The DB harness must seed `files` rows with explicit `mtime` values. Use raw SQL `UPDATE files SET mtime = ?` after `upsertFile` since `upsertFile` may not surface `mtime`.
- SHA mode tests require `vi.mock` or `vi.spyOn` on `node:child_process` — not needed in `find-symbol.test.ts`.
- Also needs `fsSync.existsSync` mocking for the `.git` gate test (`NOT_GIT_REPO` case).
- D-35 cases: valid ISO passes; NULL-mtime rows excluded; directory rows excluded; strict `>` boundary; empty → `{items:[], total:0}`; `.git` missing → `NOT_GIT_REPO`; bad SHA → `INVALID_SINCE`; deleted files dropped by DB intersection; `truncated` present iff `items.length < total`; `maxItems` clamp.

---

### `tests/unit/watcher-symbol-lifecycle.test.ts` — WTC-01 + WTC-02 regression guard

**Analog:** `src/db/repository.symbols.test.ts` lines 1–58 (real SQLite DB harness — NOT mocked chokidar pattern from `file-watcher.test.ts`)

This test requires a REAL DB (not the chokidar mock pattern) because it calls `upsertSymbols`, `deleteFile`, and asserts `getSymbolsForFile`. The `file-watcher.test.ts` mock pattern is not applicable here.

**Harness pattern** (identical to `repository.symbols.test.ts`):
```typescript
// src/db/repository.symbols.test.ts:24-58
let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-sym-repo-'));
  return path.join(tmpDir, 'test.db');
}

beforeEach(() => {
  const dbPath = makeTmpDb();
  openDatabase(dbPath);
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
});
```

**WTC-02 test pattern** (can call `deleteFile` directly — no tree needed):
```typescript
// Pattern from repository.symbols.test.ts:125-131 (deleteSymbolsForFile test shape)
it('deleteFile cascades symbols — WTC-02', () => {
  upsertFile({ path: '/project/a.ts', ... });
  upsertSymbols('/project/a.ts', [makeSymbol({ name: 'foo' })]);
  // Verify present before deletion
  expect(getSymbolsForFile('/project/a.ts')).toHaveLength(1);
  deleteFile('/project/a.ts');
  // All symbol rows gone
  expect(getSymbolsForFile('/project/a.ts')).toHaveLength(0);
  // Sanity: raw count also zero (guards against future schema splits)
  const count = getSqlite()
    .prepare('SELECT COUNT(*) AS n FROM symbols WHERE path = ?')
    .get('/project/a.ts') as { n: number };
  expect(count.n).toBe(0);
  // File row gone
  expect(getFile('/project/a.ts')).toBeUndefined();
});
```

**WTC-01 test pattern** (RESEARCH recommends repository-level, not `updateFileNodeOnChange`):
```typescript
// Tests that setEdgesAndSymbols replaces symbols atomically (the wiring
// at file-utils.ts:984 and :1104 calls this — we guard the contract, not the call site)
it('setEdgesAndSymbols replaces symbols on re-call — WTC-01 contract', () => {
  const symsV1 = [makeSymbol({ name: 'oldFn', kind: 'function' })];
  const symsV2 = [makeSymbol({ name: 'newFn', kind: 'function' })];
  upsertFile({ path: '/project/a.ts', ... });
  setEdgesAndSymbols('/project/a.ts', [], symsV1, []);
  expect(getSymbolsForFile('/project/a.ts').map(s => s.name)).toEqual(['oldFn']);
  setEdgesAndSymbols('/project/a.ts', [], symsV2, []);
  expect(getSymbolsForFile('/project/a.ts').map(s => s.name)).toEqual(['newFn']);
});
```

**Divergences:**
- Place file at `tests/unit/watcher-symbol-lifecycle.test.ts` (not under `src/db/`) — the regression guards live alongside other MCP-surface unit tests.
- Imports `deleteFile` from `src/db/repository.js` (not `removeFileNode` from `file-utils.ts`) for the WTC-02 test; add comment citing `file-utils.ts:1215` where `removeFileNode` delegates to `deleteFile`.
- For WTC-01: import `setEdgesAndSymbols` and `getSymbolsForFile` from repository; comment citing `file-utils.ts:984` and `:1104`.

---

### `tests/unit/schema-coercion.test.ts` — extend for `list_changed_since`

**Analog:** `tests/unit/schema-coercion.test.ts` lines 65–75 (`find_symbol` coercion test — direct template)

```typescript
// tests/unit/schema-coercion.test.ts:65-75
it('find_symbol uses z.coerce.boolean().default(true) for exportedOnly and z.coerce.number().int() for maxItems', async () => {
  const src = await fs.readFile(
    path.resolve(process.cwd(), 'src/mcp-server.ts'),
    'utf-8'
  );
  const match = src.match(/registerTool\("find_symbol"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
  expect(match, 'find_symbol registerTool block not found').toBeTruthy();
  const block = match![1];
  expect(block, 'exportedOnly should use z.coerce.boolean().default(true)').toMatch(/exportedOnly:\s*z\.coerce\.boolean\(\)\.default\(true\)/);
  expect(block, 'maxItems should use z.coerce.number().int()').toMatch(/maxItems:\s*z\.coerce\.number\(\)\.int\(\)/);
});
```

**New test to add** (D-38):
```typescript
it('list_changed_since uses z.string().min(1) for since and z.coerce.number().int() for maxItems', async () => {
  const src = await fs.readFile(
    path.resolve(process.cwd(), 'src/mcp-server.ts'),
    'utf-8'
  );
  const match = src.match(/registerTool\("list_changed_since"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
  expect(match, 'list_changed_since registerTool block not found').toBeTruthy();
  const block = match![1];
  expect(block).toMatch(/since:\s*z\.string\(\)\.min\(1\)/);
  expect(block).toMatch(/maxItems:\s*z\.coerce\.number\(\)\.int\(\)/);
});
```

**Divergence:** `since` uses `z.string().min(1)` not `z.coerce.*` — the handler does the SHA/timestamp dispatch, not Zod.

---

### `tests/unit/tool-outputs.test.ts` — extend for `list_changed_since`

**Analog:** `tests/unit/tool-outputs.test.ts` lines 436–486 (`find_symbol` contract block — direct template)

```typescript
// tests/unit/tool-outputs.test.ts:436-486
describe('find_symbol response contract (Phase 34)', () => {
  it('returns {items: [], total: 0} with no truncated key on zero match', () => {
    clear();
    const { items, total } = findSymbols({ name: 'Nothing', exportedOnly: true, limit: 50 });
    const truncated = items.length < total;
    const response: Record<string, unknown> = {
      items: items.map(s => ({ path: s.path, name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine, isExport: s.isExport })),
      total,
      ...(truncated && { truncated: true }),
    };
    expect(response.items).toEqual([]);
    expect(response.total).toBe(0);
    expect('truncated' in response).toBe(false);
  });
  // ... more shape assertions
});
```

**New contract block to add** (D-39):
```typescript
describe('list_changed_since response contract (Phase 35)', () => {
  it('returns {items: [], total: 0} with no truncated key on zero match', () => {
    clear();
    const rows = getFilesChangedSince(Date.now() + 9999999);  // future timestamp — no rows
    const total = rows.length;
    const items = rows.slice(0, 50).map(r => ({ path: r.path, mtime: r.mtime }));
    const truncated = items.length < total;
    const response = { items, total, ...(truncated && { truncated: true }) };
    expect(response.items).toEqual([]);
    expect(response.total).toBe(0);
    expect('truncated' in response).toBe(false);
  });

  it('items have shape {path: string, mtime: number}', () => {
    clear();
    // insertFile helper sets mtime=0 by default; use raw SQL to set a specific mtime
    insertFile('/src/a.ts', { importance: 5 });
    getSqlite().prepare('UPDATE files SET mtime = 1000 WHERE path = ?').run('/src/a.ts');
    const rows = getFilesChangedSince(999);
    expect(rows).toHaveLength(1);
    expect(typeof rows[0].path).toBe('string');
    expect(typeof rows[0].mtime).toBe('number');
  });

  it('includes truncated: true when items.length < total (simulated via limit)', () => {
    clear();
    for (let i = 0; i < 5; i++) {
      insertFile(`/src/f${i}.ts`, { importance: 1 });
      getSqlite().prepare('UPDATE files SET mtime = ? WHERE path = ?').run(1000 + i, `/src/f${i}.ts`);
    }
    const rows = getFilesChangedSince(0);  // all 5
    const limit = 2;
    const items = rows.slice(0, limit);
    const total = rows.length;
    const response = { items, total, ...(items.length < total && { truncated: true }) };
    expect(response.total).toBe(5);
    expect(response.truncated).toBe(true);
  });
});
```

**Tool name registry** (lines 539–566 — add 15th entry):
```typescript
// tests/unit/tool-outputs.test.ts:540 — currently checks 14 tools
describe('MCP tool name registry', () => {
  it('all 15 expected tool names exist in mcp-server.ts source', async () => {
    // ...
    const expectedTools = [
      // ... existing 14 ...
      'list_changed_since',   // Phase 35
    ];
```

Note: update the `it` description from "all 14" to "all 15".

**Divergences:**
- `getFilesChangedSince` must be imported at the top of the file alongside existing repo imports.
- The `files` table in the test harness already has `mtime REAL` (line 45 of current `tool-outputs.test.ts`). No schema change needed.
- The `insertFile` helper does not pass `mtime`; use raw SQL `UPDATE files SET mtime = ?` to set known values.

---

## Shared Patterns

### `NOT_INITIALIZED` Guard
**Source:** `src/mcp-server.ts:357` (and ~7 other handlers)
**Apply to:** `list_changed_since` handler entry (first line of the `async` callback)
```typescript
if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
```

### Conditional `truncated` spread
**Source:** `src/mcp-server.ts:376`
**Apply to:** `list_changed_since` envelope construction
```typescript
...(truncated && { truncated: true }),  // omit key entirely when not truncated
```

### `getSqlite().prepare()` raw SQL read pattern
**Source:** `src/db/repository.ts:961-966`
**Apply to:** `getFilesChangedSince`, `getFilesByPaths`
```typescript
const sqlite = getSqlite();
return sqlite.prepare('SELECT ... FROM ...').all(param) as Array<{...}>;
```

### `sqlite.transaction(() => { ... })()` mixed transaction
**Source:** `src/db/repository.ts:1098-1155` (`setEdgesAndSymbols`)
**Apply to:** extended `deleteFile`
```typescript
const sqlite = getSqlite();
const db = getDb();
const tx = sqlite.transaction(() => {
  db.delete(...)...run();               // Drizzle — safe inside better-sqlite3 tx
  sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(filePath);  // raw
  db.delete(...)...run();               // Drizzle
});
tx();
```

### Tool description as `string[].join(' ')`
**Source:** `src/mcp-server.ts:333-343`
**Apply to:** `list_changed_since` description
```typescript
description: [
  "First sentence.",
  "Second sentence.",
  // ...
].join(' '),
```

### DB harness (`tmpDir` + `openDatabase` + cleanup)
**Source:** `src/db/repository.symbols.test.ts:24-58`
**Apply to:** `src/db/repository.changed-since.test.ts` and `tests/unit/watcher-symbol-lifecycle.test.ts`

---

## No Analog Found

All target files have close analogs. No entries.

---

## Key Divergences Summary (planner callouts)

| Decision | Diverges From | Detail |
|---|---|---|
| D-06: `execFileSync` | `git-diff.ts:27` uses `execSync` | User-input SHA requires injection-safe array form |
| D-21: `since` is `z.string()` | Other numeric args use `z.coerce.*` | Handler does dispatch; Zod only gates empty string |
| D-27: `deleteFile` wrap + extend | Current `deleteFile` is NOT transacted | Must add `getSqlite()` call and wrap existing two Drizzle deletes inside the new `sqlite.transaction()` |
| D-29: inline DELETE, not delegate | `deleteSymbolsForFile` exists at line 1058 | Must NOT call it from `deleteFile` — inline to share the transaction |
| RESEARCH Conflict 2: test location | CONTEXT D-37 says `tests/unit/` | Use `src/db/repository.changed-since.test.ts` to match Phase 33 precedent |

---

## Metadata

**Analog search scope:** `src/mcp-server.ts`, `src/db/repository.ts`, `src/db/repository.symbols.test.ts`, `tests/unit/find-symbol.test.ts`, `tests/unit/schema-coercion.test.ts`, `tests/unit/tool-outputs.test.ts`, `tests/unit/file-watcher.test.ts`, `src/change-detector/git-diff.ts`, `src/file-utils.ts`
**Files scanned:** 9 source files read in full or by section
**Pattern extraction date:** 2026-04-23
