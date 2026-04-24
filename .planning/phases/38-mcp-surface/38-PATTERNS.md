# Phase 38: MCP Surface - Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 4 (3 modified, 1 new)
**Analogs found:** 4 / 4

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/db/repository.ts` (add `getCallers` + `getCallees`) | service | CRUD | `src/db/repository.ts` §`findSymbols` (line 1049) | exact — same file, same two-query COUNT+SELECT pattern |
| `src/mcp-server.ts` (add `find_callers` + `find_callees` registrations) | controller | request-response | `src/mcp-server.ts` §`find_symbol` (line 336) | exact — same file, same `registerTool` + `ToolAnnotations` skeleton |
| `tests/integration/mcp-transport.test.ts` (extend with new describe blocks) | test | request-response | `tests/integration/mcp-transport.test.ts` §`search` / §`find_symbol` describe blocks | exact — same file, same `callAndParse` + assertion pattern |
| `tests/unit/find-callers-callees.test.ts` (new) | test | CRUD | `tests/unit/find-symbol.test.ts` | role-match — same unit-test structure: `openDatabase`/`closeDatabase`, `simulateResponse` helper, `describe`/`it`/`expect` |

---

## Pattern Assignments

### `src/db/repository.ts` — add `getCallers()` and `getCallees()`

**Analog:** `src/db/repository.ts` §`findSymbols` (lines 1049–1084) and §`getSymbolsByName` (lines 1004–1010)

**Imports pattern** — no new imports needed; all required identifiers already present at top of file (lines 1–13):
```typescript
// Already imported at repository.ts:6
import { getSqlite } from './db.js';
// Already imported at repository.ts:12
import type { Symbol as SymbolRow, SymbolKind } from './symbol-types.js';
```

**Core two-query pattern** (repository.ts lines 1069–1083) — copy this shape exactly:
```typescript
const total = (sqlite
  .prepare(`SELECT COUNT(*) AS n FROM symbols WHERE ${whereSQL}`)
  .get(...params) as { n: number }).n;

const rows = sqlite
  .prepare(
    `SELECT path, name, kind, start_line, end_line, is_export
     FROM symbols
     WHERE ${whereSQL}
     ORDER BY is_export DESC, path ASC, start_line ASC
     LIMIT ?`
  )
  .all(...params, opts.limit) as SymbolDbRow[];

return { items: rows.map(rowToSymbol), total };
```

**Adaptation for `getCallers`:** The pattern becomes four queries instead of two:
1. Symbol ID resolution: `SELECT id FROM symbols WHERE name = ? [AND path = ?]` — mirrors `getSymbolsByName` (line 1007)
2. Early-return guard: `if (targetRows.length === 0) return { items: [], total: 0, unresolvedCount: 0 }` — prevents `IN ()` SQL syntax error
3. COUNT query: `SELECT COUNT(*) AS n FROM symbol_dependencies WHERE callee_symbol_id IN (${placeholders}) AND caller_symbol_id != callee_symbol_id`
4. SELECT+JOIN query: same WHERE + `INNER JOIN symbols s ON s.id = sd.caller_symbol_id` + `LIMIT ?`
5. Unresolved count: `SELECT COUNT(*) AS n FROM symbol_dependencies WHERE callee_symbol_id IN (${placeholders}) AND caller_symbol_id NOT IN (SELECT id FROM symbols)`

**Placeholder generation pattern** — used in `repository.call-sites.test.ts` line 46 (verified in codebase):
```typescript
const ids = targetRows.map(r => r.id);
const placeholders = ids.map(() => '?').join(', ');
// Use as: `WHERE callee_symbol_id IN (${placeholders})` with .all(...ids, ...)
```

**Function signature shape** (mirrors `findSymbols` at line 1049):
```typescript
export function getCallers(
  name: string,
  filePath?: string,
  limit: number = 50
): { items: Array<{ path: string; name: string; kind: string; startLine: number; confidence: number }>; total: number; unresolvedCount: number }
```

**`getCallees` reversal:** Swap `callee_symbol_id` and `caller_symbol_id` in all WHERE clauses. The symbol lookup uses `WHERE name = ?` to find caller symbol IDs, then the dependency query filters `WHERE caller_symbol_id IN (${placeholders})`.

**Section placement:** Add after `findSymbols` (line 1084), before `getSymbolsForFile` (line 1089), consistent with grouping all symbol-query exports together.

---

### `src/mcp-server.ts` — add `find_callers` and `find_callees` tool registrations

**Analog:** `src/mcp-server.ts` §`find_symbol` (lines 336–385)

**Import addition** (after existing repository imports at line 34–38):
```typescript
// Add to the repository import block (lines 16–39):
import {
  // ... existing imports ...
  findSymbols,
  // add:
  getCallers,
  getCallees,
} from './db/repository.js';
```

**Full tool registration skeleton** (lines 336–385) — copy verbatim, adapt underlined fields:
```typescript
server.registerTool("find_symbol", {
  title: "Find Symbol",
  description: [
    "Resolve a symbol name ...",
    // ... array of strings ...
  ].join(' '),
  inputSchema: {
    name: z.string().min(1).describe("Symbol name; trailing `*` triggers prefix match"),
    kind: z.string().optional().describe("..."),
    exportedOnly: z.coerce.boolean().default(true).describe("..."),
    maxItems: z.coerce.number().int().optional().describe("Max items to return, clamped to [1, 500], default 50"),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ name, kind, exportedOnly, maxItems }) => {
  if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
  const limit = Math.max(1, Math.min(500, maxItems ?? 50));
  const { items, total } = findSymbols({ name, kind: kindFilter, exportedOnly, limit });
  const truncated = items.length < total;
  return mcpSuccess({
    items: items.map(s => ({ path: s.path, name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine, isExport: s.isExport })),
    total,
    ...(truncated && { truncated: true }),
  });
});
```

**`find_callers` adaptations from the `find_symbol` template:**
- Tool name: `"find_callers"` (not `"find_symbol"`)
- Remove `kind`, `exportedOnly` from `inputSchema`; add `filePath: z.string().optional()`
- Call `getCallers(name, filePath, limit)` instead of `findSymbols(...)`
- Response projection: `{path, name, kind, startLine, confidence}` — NO `endLine`, NO `isExport` (D-12)
- Add `unresolvedCount` to `mcpSuccess(...)` spread (outside the conditional `truncated`)
- Description array covers: purpose, exact-match behavior, filePath disambiguation, maxItems clamp, Ruby limitations, reopened-class multi-result, staleness note, self-loop exclusion, NOT_INITIALIZED handling, example usage

**`mcpError` and `mcpSuccess` helpers** (lines 145–156) — do not reimplement; call as-is:
```typescript
// Line 145 — already available in module scope:
function mcpError(code: ErrorCode, message: string): ToolResponse { ... }
// Line 152 — already available in module scope:
function mcpSuccess(data: Record<string, unknown>): ToolResponse { ... }
```

**Registration placement:** Append both new `server.registerTool(...)` calls inside `registerTools()` (line 173) after the existing `find_symbol` block (line 385), before `list_changed_since` (line 387). Order has no semantic impact on MCP clients.

---

### `tests/integration/mcp-transport.test.ts` — extend with `find_callers` and `find_callees` describe blocks

**Analog:** `tests/integration/mcp-transport.test.ts` — the existing file IS the analog. Pattern: add new `describe` blocks following the same style as §`search` (lines 208–221) and §`detect_cycles` (lines 261–275).

**CRITICAL fixture constraint** (Pitfall 1 from RESEARCH.md): New cross-file fixture files MUST be written in the TOP-LEVEL `beforeAll` (lines 39–65), BEFORE the `coordinator.init(tmpDir)` call on line 52. Add new file path variable declarations at module scope alongside `sampleFilePath` (line 37).

**Module-scope variable additions** (after line 37):
```typescript
let sampleFilePath: string;
// Add:
let helperFilePath: string;
let greetFilePath: string;
```

**beforeAll fixture additions** — insert BEFORE `coordinator = new ServerCoordinator()` (line 51):
```typescript
// Write helper file (defines exported function to be called)
helperFilePath = path.join(tmpDir, 'helper.ts');
writeFileSync(helperFilePath, 'export function helper(): string { return "help"; }\n');

// Write caller file (imports and calls helper; includes recursive function for self-loop test)
greetFilePath = path.join(tmpDir, 'greet.ts');
writeFileSync(greetFilePath, [
  "import { helper } from './helper.js';",
  'export function greet(): string { return helper(); }',
  'export function recurse(): void { recurse(); }',
].join('\n'));
```

**`callAndParse` helper** (lines 90–93) — reuse exactly as-is:
```typescript
async function callAndParse(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name: toolName, arguments: args });
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}
```

**New describe block pattern** — copy §`search` (lines 208–221) structure:
```typescript
describe('find_callers', () => {
  it('returns correct envelope shape for a known callee', async () => {
    const parsed = await callAndParse('find_callers', { name: 'helper' });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(typeof parsed.total).toBe('number');
    expect(typeof parsed.unresolvedCount).toBe('number');
    expect(parsed.unresolvedCount).toBe(0);
  });

  it('clamps maxItems 0 to 1', async () => { ... });
  it('clamps maxItems 1000 to 500', async () => { ... });
  it('excludes self-loops', async () => { ... });
  it('returns empty result for non-existent symbol', async () => { ... });
});
```

**NOT_INITIALIZED test placement:** Per RESEARCH.md Pattern 4 and Pitfall 5, the shared `beforeAll` always initializes the coordinator. Place `NOT_INITIALIZED` guard tests in the unit test file (`find-callers-callees.test.ts`), not here. This matches `find_symbol` precedent — `find_symbol`'s `NOT_INITIALIZED` guard is tested in `tests/unit/find-symbol.test.ts`, not in `mcp-transport.test.ts`.

---

### `tests/unit/find-callers-callees.test.ts` (new file)

**Analog:** `tests/unit/find-symbol.test.ts` (lines 1–50 for setup; lines 52–170 for test structure)

**File header and imports pattern** (find-symbol.test.ts lines 1–11):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, closeDatabase } from '../../src/db/db.js';
import { getCallers, getCallees, upsertSymbols, setEdgesAndSymbols } from '../../src/db/repository.js';
```

**Also import `upsertFile` and `setEdgesAndSymbols`** — needed to seed `symbol_dependencies` rows. Reference: `src/db/repository.call-sites.test.ts` lines 11–12:
```typescript
import { upsertFile, upsertSymbols, setEdgesAndSymbols } from './repository.js';
import type { CallSiteEdge } from '../change-detector/types.js';
import type { FileNode } from '../types.js';
```

**DB lifecycle pattern** (find-symbol.test.ts lines 14–32):
```typescript
let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'find-callers-test-'));
  return path.join(tmpDir, 'test.db');
}

beforeEach(() => {
  openDatabase(makeTmpDb());
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
```

**Seed helper pattern** (repository.call-sites.test.ts lines 32–41):
```typescript
function seedFile(filePath: string, symbols: Array<{ name: string; startLine?: number }>): void {
  upsertFile(makeFileNode(filePath));
  upsertSymbols(filePath, symbols.map(s => ({
    name: s.name,
    kind: 'function' as const,
    startLine: s.startLine ?? 1,
    endLine: (s.startLine ?? 1) + 4,
    isExport: true,
  })));
}
```

**`simulate` helper pattern** (find-symbol.test.ts lines 36–50) — mirror for callers/callees:
```typescript
function simulateGetCallersResponse(args: { name: string; filePath?: string; maxItems?: number }) {
  const limit = Math.max(1, Math.min(500, args.maxItems ?? 50));
  return getCallers(args.name, args.filePath, limit);
}
```

**Test cases structure** (find-symbol.test.ts lines 52–170 pattern):
```typescript
describe('getCallers — Phase 38', () => {
  describe('basic caller resolution', () => { ... });
  describe('filePath filter', () => { ... });
  describe('self-loop exclusion', () => { ... });
  describe('maxItems clamp', () => { ... });
  describe('empty result for unknown symbol', () => { ... });
  describe('unresolvedCount', () => { ... });
});

describe('getCallees — Phase 38', () => {
  // Mirror structure
});
```

---

## Shared Patterns

### Initialization Guard
**Source:** `src/mcp-server.ts` line 364 (in `find_symbol` handler)
**Apply to:** Both `find_callers` and `find_callees` tool handlers — first line of each async handler
```typescript
if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
```

### maxItems Clamping
**Source:** `src/mcp-server.ts` line 367 (in `find_symbol` handler)
**Apply to:** Both `find_callers` and `find_callees` tool handlers
```typescript
const limit = Math.max(1, Math.min(500, maxItems ?? 50));
```

### Conditional `truncated` Spread
**Source:** `src/mcp-server.ts` lines 371–383 (in `find_symbol` handler)
**Apply to:** Both `find_callers` and `find_callees` `mcpSuccess(...)` calls
```typescript
const truncated = items.length < total;
return mcpSuccess({
  items,
  total,
  ...(truncated && { truncated: true }),
  unresolvedCount,  // ← addition vs find_symbol: always present, never conditional
});
```

### ToolAnnotations Block
**Source:** `src/mcp-server.ts` lines 358–362 (in `find_symbol` registration)
**Apply to:** Both new tool registrations — copy verbatim, no changes
```typescript
annotations: {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
},
```

### Description Array Format
**Source:** `src/mcp-server.ts` lines 338–350 (in `find_symbol` registration)
**Apply to:** Both new tool description fields
```typescript
description: [
  "First sentence.",
  "Second sentence.",
  // ...
].join(' '),
```

### DB Parameterized Query Safety
**Source:** `src/db/repository.ts` lines 1069–1083
**Apply to:** All SQL in `getCallers` and `getCallees` — user-supplied `name` and `filePath` MUST go through `?` placeholders only. The dynamic `IN (${placeholders})` uses `ids.map(() => '?').join(', ')` where `ids` are integers from a prior `SELECT id FROM symbols` query — never user input.

### Broker Mock Hoisting
**Source:** `tests/integration/mcp-transport.test.ts` lines 12–19
**Apply to:** The new `find-callers-callees.test.ts` unit test does NOT use InMemoryTransport and does NOT need the broker mock. Only the integration test extension reuses the existing top-level mock.

---

## No Analog Found

None — all four files have close analogs in the codebase.

---

## Key Pitfalls Captured (from RESEARCH.md)

| Pitfall | Impact | Mitigation Pattern |
|---------|--------|--------------------|
| Fixture files written after `coordinator.init()` | `find_callers` returns empty results in integration tests | Write all fixture files in top-level `beforeAll` BEFORE `coordinator.init(tmpDir)` (line 52) |
| `IN ()` with empty ID list | SQLite syntax error when symbol not found | Early-return guard: `if (targetRows.length === 0) return { items: [], total: 0, unresolvedCount: 0 }` |
| Self-loop stored but not filtered | Recursive functions appear as their own callers | Both COUNT and SELECT queries include `AND caller_symbol_id != callee_symbol_id` |
| `unresolvedCount` query direction swapped | Always reports 0 or wrong count | For `getCallers`: check `caller_symbol_id NOT IN (SELECT id FROM symbols)`. For `getCallees`: check `callee_symbol_id NOT IN (...)` |
| `NOT_INITIALIZED` test in shared `beforeAll` suite | Cannot test un-initialized state in transport test | Place `NOT_INITIALIZED` coverage in unit test (`find-callers-callees.test.ts`), not in `mcp-transport.test.ts` |

---

## Metadata

**Analog search scope:** `src/`, `src/db/`, `src/mcp-server.ts`, `tests/integration/`, `tests/unit/`
**Files scanned:** 8 source files read directly + directory listings
**Pattern extraction date:** 2026-04-24
