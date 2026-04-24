# Phase 38: MCP Surface - Research

**Researched:** 2026-04-24
**Domain:** MCP tool registration, SQLite JOIN queries, InMemoryTransport integration testing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `getCallers(name, filePath?, limit)` — exact-match symbol lookup, then `WHERE callee_symbol_id IN (target_ids) AND caller_symbol_id != callee_symbol_id`. INNER JOIN symbols + files for caller info. Returns `{items, total, unresolvedCount}`.

**D-02:** `getCallees(name, filePath?, limit)` — reversed: find caller symbol(s), then `WHERE caller_symbol_id IN (caller_ids) AND caller_symbol_id != callee_symbol_id`. Same envelope.

**D-03:** Both helpers use two queries: COUNT for `total` (pre-LIMIT, post-self-loop-filter), SELECT with LIMIT for `items`. Mirrors `findSymbols` pattern.

**D-04:** `filePath` filters the TARGET symbol's defining file. When omitted, all symbols matching `name` are included.

**D-05:** Query ordering: `path ASC, start_line ASC`.

**D-06:** `unresolvedCount` via separate COUNT query with LEFT JOIN — count rows where the opposite-side symbol ID does not exist in `symbols` (dangling FK from callee-side eventual consistency).

**D-07:** `unresolvedCount` is a staleness signal computed at query time. Zero in fresh repo.

**D-08:** Both tools use `ToolAnnotations`: `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`. Matches `find_symbol` exactly.

**D-09:** `maxItems`: `z.coerce.number().int().optional()`, clamped `[1, 500]`, default 50.

**D-10:** `name`: `z.string().min(1)` — exact match, no wildcard/GLOB.

**D-11:** `filePath`: `z.string().optional()` — no path normalization at tool layer.

**D-12:** Response envelope: `{ok: true, items: [{path, name, kind, startLine, confidence}], total, truncated?: true, unresolvedCount}`. No `endLine`, no `isExport`. `truncated` present only when `items.length < total`.

**D-13:** Tool descriptions include: purpose, filePath disambiguation, maxItems clamping/default, Ruby `attr_accessor` limitation, reopened-Ruby-class multi-result, staleness note, self-loop exclusion note, `NOT_INITIALIZED` handling, example usage.

**D-14:** Description format: `string[].join(' ')` literal.

**D-15:** Extend `tests/integration/mcp-transport.test.ts` — add two new `describe` blocks. Reuse existing `beforeAll`/`afterAll`.

**D-16:** Test fixture: multi-file TS setup in `beforeAll` — file A with `greet()` calling `helper()` from file B. Written BEFORE `coordinator.init(tmpDir)`.

**D-17:** Test cases per tool: envelope shape, `maxItems` clamping (0→1, 1000→500), self-loop exclusion, empty result for non-existent symbol, `NOT_INITIALIZED` error.

**D-18:** No `unresolvedCount > 0` test (fragile). Assert `unresolvedCount: 0` in clean scenario.

**D-19:** Two plans: 38-01 (helpers + tool registration + unit tests), 38-02 (integration tests + VERIFICATION.md).

### Claude's Discretion

- Exact SQL query shape (subquery vs JOIN for symbol lookup step)
- Whether `getCallers` and `getCallees` share a private helper or are two independent functions
- Whether the `unresolvedCount` query is inlined or factored into a helper
- Fixture file content for integration tests (specific function bodies)
- Whether to add a `confidence` filter parameter (not in requirements — likely omit)
- Ordering of new tools relative to existing tools in `registerTools()`

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MCP-01 | `find_callers(name, filePath?, maxItems?)` registered via `registerTool()` with `ToolAnnotations`. Response `{ok: true, items: [{path, name, kind, startLine, confidence}], total, truncated?, unresolvedCount}`. `maxItems` clamp `[1, 500]` default 50. Self-loops filtered. Repository helper `getCallers()` JOINs symbol_dependencies + symbols + files. | Verified pattern in `find_symbol` registration (mcp-server.ts:336), `findSymbols` query pattern (repository.ts:1049), `symbol_dependencies` schema (schema.ts:88) |
| MCP-02 | `find_callees(name, filePath?, maxItems?)` — same table, reversed query, same envelope, repository helper `getCallees()`. | Same as MCP-01, reversed FK direction |
| MCP-03 | Tool descriptions document Ruby limitations (`attr_accessor` not indexed; reopened-class multi-result behavior). | Existing `find_symbol` description is the template (mcp-server.ts:338-350) |
| MCP-04 | MCP transport integration tests via `InMemoryTransport` cover `find_callers` + `find_callees`, asserting envelope shape and `maxItems` clamping. | Existing `mcp-transport.test.ts` setup verified (beforeAll pattern, callAndParse helper) |
</phase_requirements>

---

## Summary

Phase 38 adds two MCP tools — `find_callers` and `find_callees` — that query the `symbol_dependencies` table populated by Phase 37. The implementation is a direct extension of existing patterns: the repository helpers mirror `findSymbols()` (two-query: COUNT + SELECT-with-LIMIT), and the tool registration mirrors `find_symbol` (same `ToolAnnotations`, same `z.coerce` schema, same `mcpSuccess`/`mcpError` envelope). No new architectural patterns are introduced.

The key design insight carried from Phase 37's CONTEXT.md (D-19) is the caller-authoritative / callee-eventual-consistency model: `symbol_dependencies` rows are written under the caller's file transaction and left orphaned when callee files are renamed or deleted without re-scanning the callers. Phase 38 surfaces this as `unresolvedCount` — computed at query time via a dangling-FK count, not stored anywhere.

The integration test plan extends the existing `mcp-transport.test.ts` suite by writing a multi-file TS fixture (file A calls file B) before `coordinator.init(tmpDir)`, so the coordinator's extraction pass populates `symbol_dependencies` with real data. All test infrastructure (InMemoryTransport pair, `callAndParse()` helper, broker mock) is already in place.

**Primary recommendation:** Copy `find_symbol` handler code as the exact starting template for both new tools. The only new complexity is the JOIN query shape and the `unresolvedCount` LEFT JOIN — both are straightforward SQL.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Call-graph edge storage | Database / Storage | — | `symbol_dependencies` table, indexed on both FK columns |
| Caller/callee resolution query | Database / Storage | — | `getCallers()` / `getCallees()` in repository.ts perform JOIN + COUNT |
| Tool input validation + clamping | API / Backend | — | `registerTool()` handler in `mcp-server.ts` validates, clamps, delegates to repository |
| MCP response envelope | API / Backend | — | `mcpSuccess()` / `mcpError()` wrappers live in `mcp-server.ts` |
| Integration test fixture setup | — | API / Backend | Files written to tmpDir before `coordinator.init()` so extraction populates DB |

---

## Standard Stack

### Core (all pre-existing — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | already installed | `registerTool()`, `InMemoryTransport`, `McpServer` | Project MCP SDK, in use by all 15 existing tools [VERIFIED: existing imports in mcp-server.ts] |
| `zod` | already installed | Input schema validation (`z.coerce.number().int()`, `z.string().min(1)`) | Project standard for all tool inputSchema [VERIFIED: mcp-server.ts:7] |
| `better-sqlite3` | already installed | SQLite access via `getSqlite()` | Project DB layer, used by all repository functions [VERIFIED: repository.ts] |
| `vitest` | 3.1.4 | Test runner, `describe`/`it`/`expect` | Project test framework [VERIFIED: TESTING.md, package.json tests run vitest] |

**Installation:** No new packages required. Phase 38 is purely additive code using existing dependencies.

---

## Architecture Patterns

### System Architecture Diagram

```
MCP Client (agent)
       |
       | callTool("find_callers", { name, filePath?, maxItems? })
       v
mcp-server.ts :: registerTools()
       |
       | 1. coordinator.isInitialized() guard
       | 2. clamp maxItems to [1, 500], default 50
       | 3. call getCallers(name, filePath, limit)
       v
repository.ts :: getCallers()
       |
       | Query 1: SELECT id FROM symbols WHERE name = ? [AND path = ?]
       | Query 2: COUNT(*) FROM symbol_dependencies WHERE callee_symbol_id IN (...)
       |          AND caller_symbol_id != callee_symbol_id
       | Query 3: SELECT ... FROM symbol_dependencies
       |          INNER JOIN symbols (caller) INNER JOIN files (caller path)
       |          WHERE callee_symbol_id IN (...) AND self-loop excluded
       |          ORDER BY path ASC, start_line ASC LIMIT ?
       | Query 4: LEFT JOIN COUNT for unresolvedCount
       v
{ items: [{path, name, kind, startLine, confidence}], total, unresolvedCount }
       |
       v
mcp-server.ts :: mcpSuccess({ items, total, truncated?, unresolvedCount })
       |
       v
MCP Client receives { ok: true, items, total, truncated?, unresolvedCount }
```

### Recommended Project Structure

No new directories. Files modified:

```
src/db/
└── repository.ts       # Add getCallers() + getCallees() exports

src/
└── mcp-server.ts       # Add find_callers + find_callees registerTool() calls
                        # Add getCallers + getCallees to import list (line 16-39)

tests/integration/
└── mcp-transport.test.ts  # Add describe blocks for find_callers + find_callees
                            # Extend beforeAll to write cross-file fixture

tests/unit/
└── find-callers-callees.test.ts  # New unit test file for repository helpers
```

### Pattern 1: Repository Helper — Two-Query Shape (COUNT + SELECT-LIMIT)

**What:** Every paginated repository query runs two prepared statements against the same `getSqlite()` connection: one COUNT (pre-LIMIT) for `total`, one SELECT with LIMIT for `items`.

**When to use:** All paginated read queries on the DB — established by `findSymbols` in Phase 34.

**Example (from existing `findSymbols`, repository.ts:1069-1083):**
```typescript
// Source: src/db/repository.ts (verified)
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

**Adaptation for `getCallers`:** Replace `symbols` single-table query with a multi-step:
1. Resolve target symbol IDs: `SELECT id FROM symbols WHERE name = ? [AND path = ?]`
2. COUNT query on `symbol_dependencies WHERE callee_symbol_id IN (?) AND caller_symbol_id != callee_symbol_id`
3. SELECT + JOIN query with same WHERE + `LIMIT ?`
4. Separate LEFT JOIN COUNT for `unresolvedCount`

### Pattern 2: Tool Registration Template (registerTool + ToolAnnotations)

**What:** Every tool in `registerTools()` follows the identical skeleton: `server.registerTool(name, { title, description: [...].join(' '), inputSchema: { ... }, annotations: { ... } }, async (args) => { ... })`.

**When to use:** All new MCP tools in this codebase.

**Example (from `find_symbol`, mcp-server.ts:336-385, verified):**
```typescript
// Source: src/mcp-server.ts:336 (verified)
server.registerTool("find_symbol", {
  title: "Find Symbol",
  description: [
    "Resolve a symbol name ...",
    "...",
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
  if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "...");
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

**Adaptation for `find_callers`:** Replace `findSymbols` call with `getCallers`, adjust projection to `{path, name, kind, startLine, confidence}` (no `endLine`, no `isExport`), add `unresolvedCount` to envelope.

### Pattern 3: InMemoryTransport Integration Test

**What:** Tests use `InMemoryTransport.createLinkedPair()` to create a server+client pair, write real TS files to a temp dir, call `coordinator.init(tmpDir)` to extract real data, then use `callAndParse(toolName, args)` helper to invoke tools and assert on the JSON response.

**When to use:** All MCP tool integration tests that need real DB data.

**Key setup (from mcp-transport.test.ts:39-93, verified):**
```typescript
// Source: tests/integration/mcp-transport.test.ts (verified)
beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-transport-test-'));
  mkdirSync(path.join(tmpDir, '.filescope'), { recursive: true });
  writeFileSync(sampleFilePath, 'export const x = 1;\nexport function hello(): string { return "hello"; }\n');

  coordinator = new ServerCoordinator();
  await coordinator.init(tmpDir);  // ← real extraction, real SQLite

  server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerTools(server, coordinator);

  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
}, 30_000);

async function callAndParse(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name: toolName, arguments: args });
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}
```

**Critical constraint for Phase 38:** The multi-file fixture (greet.ts + helper.ts) MUST be written BEFORE `coordinator.init(tmpDir)`. The existing `beforeAll` calls `coordinator.init()` after writing `sample.ts`. Phase 38's new fixture files must follow the same ordering.

**Problem:** The existing `beforeAll` is shared — Phase 38 tests cannot add a second `beforeAll` in a new describe block for additional fixture setup (that would run AFTER `coordinator.init()` has already been called). The cross-file fixture files must be written in the top-level `beforeAll` alongside `sample.ts`.

### Pattern 4: `NOT_INITIALIZED` Error Path Test

**What:** Every tool integration test includes a case that calls the tool before `set_base_directory` is invoked, expecting `{ok: false, error: 'NOT_INITIALIZED'}`.

**Problem for Phase 38:** The shared `beforeAll` already calls `coordinator.init(tmpDir)` before any tests run. Testing `NOT_INITIALIZED` requires calling the tool in an un-initialized state, which means creating a NEW server instance with a fresh un-initialized coordinator — or calling `set_base_directory` on a non-existent path to force failure.

**Recommended approach (D-17):** Create a second disposable server/client pair in a nested `describe` with its own `beforeAll`/`afterAll` that starts an un-initialized coordinator, connects it, and calls the tool. Alternatively, test the guard directly in the unit test (not in mcp-transport.test.ts). The existing mcp-transport.test.ts does not test `NOT_INITIALIZED` for `find_symbol` either — the `find_symbol` guard is tested in `tests/unit/find-symbol.test.ts` via the `simulateFindSymbolResponse` helper.

**Resolution:** `NOT_INITIALIZED` test is best placed in the new unit test file (`find-callers-callees.test.ts`) that directly calls `getCallers()`/`getCallees()` on an un-initialized DB — the repository throws or returns empty. The integration test in `mcp-transport.test.ts` focuses on the happy path and clamping behavior. This matches how `find_symbol` handles the split.

### Anti-Patterns to Avoid

- **Calling `coordinator.initServer()`** in tests — reads `process.argv`, auto-inits to CWD. Use `coordinator.init(tmpDir)` directly. [VERIFIED: mcp-transport.test.ts comment line 48]
- **Writing fixture files after `coordinator.init()`** — the extraction pass runs during `init()`. Files written after init are not scanned unless `scan_all` is triggered.
- **Adding `endLine` or `isExport` to the response envelope** — D-12 explicitly excludes them. Lighter response for navigation use case.
- **Using GLOB or `%` LIKE for name matching in `getCallers`/`getCallees`** — D-10 locks exact match only. The `name` parameter is used in `WHERE name = ?`, not `GLOB`.
- **Normalizing `filePath` in the tool handler** — D-11: path normalization is the repository's concern. Pass `filePath` through unchanged.
- **Using `find_` prefix inconsistency** — REQUIREMENTS.md explicitly rejects `get_callers` / `get_callees`. Names are `find_callers` / `find_callees`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input schema validation | Custom parsing code | `z.coerce.number().int()` / `z.string().min(1)` | Established pattern across all 15 tools; Zod coercion handles string-to-number from MCP client |
| Response envelope assembly | Custom JSON builder | `mcpSuccess()` / `mcpError()` | Private helpers in mcp-server.ts (line 145/152), used by every tool |
| `maxItems` clamping | `if/else` guards | `Math.max(1, Math.min(500, maxItems ?? 50))` | One-liner — already proven across `find_symbol`, `list_files`, `list_changed_since` |
| DB result pagination | Manual array slicing | SQL `LIMIT ?` + COUNT query | Matches `findSymbols` pattern; DB-side LIMIT is more efficient than fetching all rows |
| InMemoryTransport wiring | Custom test transport | `InMemoryTransport.createLinkedPair()` | Already in `mcp-transport.test.ts`; reuse the existing shared server/client |

**Key insight:** Phase 38 is almost entirely copy-adapt-extend work. The MCP registration pattern, envelope shape, clamping logic, and test infrastructure are all pre-built. The only new code is the SQL JOIN query shape in the repository helpers.

---

## Code Examples

### getCallers — Full Query Shape

```typescript
// Based on: D-01..D-07 decisions + findSymbols pattern (repository.ts:1049) [ASSUMED shape]
export function getCallers(
  name: string,
  filePath?: string,
  limit: number = 50
): { items: Array<{ path: string; name: string; kind: string; startLine: number; confidence: number }>; total: number; unresolvedCount: number } {
  const sqlite = getSqlite();

  // Step 1: resolve target symbol IDs
  const targetRows = filePath
    ? sqlite.prepare('SELECT id FROM symbols WHERE name = ? AND path = ?').all(name, filePath) as Array<{ id: number }>
    : sqlite.prepare('SELECT id FROM symbols WHERE name = ?').all(name) as Array<{ id: number }>;

  if (targetRows.length === 0) return { items: [], total: 0, unresolvedCount: 0 };

  const ids = targetRows.map(r => r.id);
  const placeholders = ids.map(() => '?').join(', ');

  // Step 2: COUNT pre-LIMIT (self-loop excluded)
  const total = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM symbol_dependencies
     WHERE callee_symbol_id IN (${placeholders})
       AND caller_symbol_id != callee_symbol_id`
  ).get(...ids) as { n: number }).n;

  // Step 3: SELECT with LIMIT + JOIN for caller info
  interface CallerRow { path: string; name: string; kind: string; start_line: number; confidence: number; }
  const rows = sqlite.prepare(
    `SELECT f.path, s.name, s.kind, s.start_line, sd.confidence
     FROM symbol_dependencies sd
     INNER JOIN symbols s ON s.id = sd.caller_symbol_id
     INNER JOIN files f ON f.path = s.path
     WHERE sd.callee_symbol_id IN (${placeholders})
       AND sd.caller_symbol_id != sd.callee_symbol_id
     ORDER BY f.path ASC, s.start_line ASC
     LIMIT ?`
  ).all(...ids, limit) as CallerRow[];

  // Step 4: unresolvedCount — callers that no longer exist in symbols
  const unresolvedCount = (sqlite.prepare(
    `SELECT COUNT(*) AS n FROM symbol_dependencies
     WHERE callee_symbol_id IN (${placeholders})
       AND caller_symbol_id NOT IN (SELECT id FROM symbols)`
  ).get(...ids) as { n: number }).n;

  return {
    items: rows.map(r => ({ path: r.path, name: r.name, kind: r.kind, startLine: r.start_line, confidence: r.confidence })),
    total,
    unresolvedCount,
  };
}
```

### find_callers — Tool Registration Skeleton

```typescript
// Source: mcp-server.ts find_symbol pattern (line 336) adapted for find_callers [ASSUMED]
server.registerTool("find_callers", {
  title: "Find Callers",
  description: [
    "Find all symbols that call the named symbol.",
    "Exact case-sensitive name match. If multiple symbols share the name (e.g., reopened Ruby classes), callers of all matching symbols are returned.",
    "`filePath` restricts which symbol definition is the target — use it when a name is defined in multiple files.",
    "`maxItems` defaults to 50, clamped to [1, 500].",
    "Response: `{items: [{path, name, kind, startLine, confidence}], total, truncated?: true, unresolvedCount}`.",
    "`unresolvedCount` reports how many caller edges reference a symbol that no longer exists — trigger `scan_all` to refresh stale edges.",
    "Self-calls (recursive functions) are excluded from results.",
    "Ruby `attr_accessor` / `attr_reader` / `attr_writer` are not indexed and will not appear as callers.",
    "Returns `NOT_INITIALIZED` if the server hasn't been set up. Zero matches returns `{items: [], total: 0, unresolvedCount: 0}` — never an error.",
    "Example: `find_callers(\"processFile\")` returns every symbol that calls `processFile`.",
  ].join(' '),
  inputSchema: {
    name: z.string().min(1).describe("Symbol name — exact case-sensitive match"),
    filePath: z.string().optional().describe("Restrict target lookup to this file path"),
    maxItems: z.coerce.number().int().optional().describe("Max items to return, clamped to [1, 500], default 50"),
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
}, async ({ name, filePath, maxItems }) => {
  if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
  const limit = Math.max(1, Math.min(500, maxItems ?? 50));
  const { items, total, unresolvedCount } = getCallers(name, filePath, limit);
  const truncated = items.length < total;
  return mcpSuccess({
    items,
    total,
    ...(truncated && { truncated: true }),
    unresolvedCount,
  });
});
```

### Integration Test Fixture — Cross-File Call Setup

```typescript
// Extends beforeAll in mcp-transport.test.ts (BEFORE coordinator.init())
// Source: D-16 decision + mcp-transport.test.ts pattern (verified) [ASSUMED exact content]

// Write helper file (defines the function being called)
const helperFilePath = path.join(tmpDir, 'helper.ts');
writeFileSync(helperFilePath, [
  'export function helper(): string { return "help"; }',
].join('\n'));

// Write caller file (imports and calls helper)
const greetFilePath = path.join(tmpDir, 'greet.ts');
writeFileSync(greetFilePath, [
  "import { helper } from './helper.js';",
  'export function greet(): string { return helper(); }',
  '// recursive self-call for self-loop exclusion test',
  'export function recurse(): void { recurse(); }',
].join('\n'));

// coordinator.init(tmpDir) must come AFTER all fixture files are written
await coordinator.init(tmpDir);
```

### Integration Test Assertions — Envelope Shape

```typescript
// Source: D-17 decisions + callAndParse pattern (mcp-transport.test.ts:90) [ASSUMED test code]
describe('find_callers', () => {
  it('returns correct envelope shape for a known callee', async () => {
    const parsed = await callAndParse('find_callers', { name: 'helper' });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(typeof parsed.total).toBe('number');
    expect(typeof parsed.unresolvedCount).toBe('number');
    expect(parsed.unresolvedCount).toBe(0); // D-18: clean scenario
  });

  it('clamps maxItems 0 to 1', async () => {
    const parsed = await callAndParse('find_callers', { name: 'helper', maxItems: 0 });
    expect(parsed.ok).toBe(true);
    expect(parsed.items.length).toBeLessThanOrEqual(1);
  });

  it('clamps maxItems 1000 to 500', async () => {
    const parsed = await callAndParse('find_callers', { name: 'helper', maxItems: 1000 });
    expect(parsed.ok).toBe(true);
    // items <= 500 (likely 1 in test fixture)
    expect(parsed.items.length).toBeLessThanOrEqual(500);
  });

  it('excludes self-loops (recursive call not in callers)', async () => {
    const parsed = await callAndParse('find_callers', { name: 'recurse' });
    expect(parsed.ok).toBe(true);
    // recurse() calls itself — should NOT appear as its own caller
    const selfCaller = parsed.items.find((i: any) => i.name === 'recurse');
    expect(selfCaller).toBeUndefined();
  });

  it('returns empty result for non-existent symbol', async () => {
    const parsed = await callAndParse('find_callers', { name: 'no_such_symbol_xyzzy' });
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toEqual([]);
    expect(parsed.total).toBe(0);
    expect(parsed.unresolvedCount).toBe(0);
  });
});
```

---

## Common Pitfalls

### Pitfall 1: Fixture Files Written After `coordinator.init()`

**What goes wrong:** Symbol extraction runs during `coordinator.init()`. Any TS files written after `init()` are not in the DB, so `symbol_dependencies` has no rows for them. `find_callers` returns empty results in integration tests.

**Why it happens:** The existing `beforeAll` initializes in this order: write sample.ts → `coordinator.init()`. Adding new fixture files to a nested `describe` block's `beforeAll` runs AFTER the top-level `beforeAll`, which means AFTER `init()`.

**How to avoid:** Write ALL fixture files (including cross-file caller/callee setup) in the TOP-LEVEL `beforeAll` in `mcp-transport.test.ts`, BEFORE the `coordinator.init(tmpDir)` call. Add new file variable declarations at module scope alongside `sampleFilePath`.

**Warning signs:** `find_callers` returns `{items: [], total: 0}` when the fixture function is queried.

### Pitfall 2: Self-Loop Stored but Must Be Filtered

**What goes wrong:** Phase 37 (D-14) STORES self-loop edges in `symbol_dependencies` (a recursive call `foo` → `foo` produces a row with `caller_symbol_id == callee_symbol_id`). If the WHERE clause forgets `AND caller_symbol_id != callee_symbol_id`, self-calls appear in `find_callers` results.

**Why it happens:** Developer forgets the filtering requirement because the data looks correct in the table view.

**How to avoid:** Both COUNT query and SELECT query MUST include `AND caller_symbol_id != callee_symbol_id`. Enforce via the self-loop exclusion integration test.

**Warning signs:** `find_callers("recurse")` returns `{name: "recurse", ...}` as a caller of itself.

### Pitfall 3: `unresolvedCount` Query Direction

**What goes wrong:** Swapping the direction — for `getCallers`, checking if `callee_symbol_id NOT IN (SELECT id FROM symbols)` instead of `caller_symbol_id NOT IN (SELECT id FROM symbols)`.

**Why it happens:** The `unresolvedCount` semantics are subtle: for `getCallers`, the CALLEE is the target (target symbol is the callee), and the CALLERS are the edge source. The "unresolved" side is the CALLER — the symbol that no longer exists in the `symbols` table.

**How to avoid:**
- `getCallers`: `WHERE callee_symbol_id IN (target_ids) AND caller_symbol_id NOT IN (SELECT id FROM symbols)` — counts orphaned callers
- `getCallees`: `WHERE caller_symbol_id IN (caller_ids) AND callee_symbol_id NOT IN (SELECT id FROM symbols)` — counts orphaned callees

**Warning signs:** `unresolvedCount` is always 0 even after deleting symbols from the DB.

### Pitfall 4: `files` Table JOIN vs `symbols.path`

**What goes wrong:** Attempting to JOIN `files` table using `files.path` when `symbols` already has a `path` column. The JOIN is redundant if the goal is just to get the file path, but necessary if the `files` table has canonical path normalization.

**Why it happens:** The response item needs `path` (file path), and it's tempting to use `symbols.path` directly since it's already in the SELECT.

**How to avoid:** In the existing codebase, `symbols.path` is the canonical path (set by the extraction pass using the same normalization). The `files.path` JOIN is needed only if additional file-level metadata is required. For Phase 38's lightweight response (`{path, name, kind, startLine, confidence}`), `symbols.path` is sufficient — no `files` JOIN needed for path alone. However, if the JOIN is included for forward-compatibility or consistency, use `INNER JOIN files f ON f.path = s.path`. [VERIFIED: setEdgesAndSymbols uses `symbols.path` as canonical path]

### Pitfall 5: `NOT_INITIALIZED` Test in Shared `beforeAll` Suite

**What goes wrong:** The top-level `beforeAll` in `mcp-transport.test.ts` calls `coordinator.init(tmpDir)` — by the time any test runs, the coordinator is initialized. Testing `NOT_INITIALIZED` requires an un-initialized coordinator, which conflicts with the shared setup.

**Why it happens:** D-17 specifies a `NOT_INITIALIZED` test case but D-15 says to reuse the existing `beforeAll`.

**How to avoid:** Per the pattern analysis, `find_symbol`'s `NOT_INITIALIZED` test lives in `tests/unit/find-symbol.test.ts` (calls repository directly on un-initialized DB), not in `mcp-transport.test.ts`. Place `NOT_INITIALIZED` coverage in the new unit test file (`find-callers-callees.test.ts`) rather than the integration transport test. The integration test focuses on envelope shape, clamping, self-loop exclusion, and empty result.

### Pitfall 6: `IN ()` with Empty List

**What goes wrong:** If `targetRows` is empty (symbol not found), the SQL `WHERE callee_symbol_id IN ()` is invalid SQLite syntax and throws.

**Why it happens:** Dynamic `IN` list generation — if `ids.length === 0`, `placeholders` is an empty string.

**How to avoid:** Early-return `{ items: [], total: 0, unresolvedCount: 0 }` immediately after the symbol lookup if `targetRows.length === 0`. [VERIFIED: standard guard used in existing code]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| File-granular dependency edges | Symbol-granular call-site edges in `symbol_dependencies` | Phase 37 (v1.7) | Enables "who calls foo" queries |
| No caller/callee query tools | `find_callers` / `find_callees` with `unresolvedCount` | Phase 38 (this phase) | Agents can navigate call graphs without grepping source |

**No deprecated patterns in scope.** Phase 38 is purely additive.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getCallers` / `getCallees` SQL shape — subquery-based target ID resolution with `IN (ids)` + self-loop `!=` exclusion | Code Examples | Minor: planner may choose JOIN instead of subquery — functionally identical, both hit the `symbol_deps_callee_idx` index |
| A2 | Cross-file fixture (greet.ts calls helper.ts) is sufficient for Phase 37's resolution algorithm to produce `symbol_dependencies` rows with `confidence: 0.8` | Code Examples | Low: if Phase 37's imported-call resolution requires more elaborate import setup, fixture may need adjustment |
| A3 | `NOT_INITIALIZED` test placed in unit test rather than transport integration test | Common Pitfalls | Low: D-17 says "add to describe blocks" — if CONTEXT.md intent is strictly transport test, unit test placement is a minor deviation |
| A4 | `symbols.path` is usable directly without a `files` JOIN for the response `path` field | Code Examples | Low: both use the same canonical path; a JOIN would be redundant but harmless |
| A5 | Tool registration order: new tools appended at the end of `registerTools()` | Architecture | None: MCP tool order has no semantic impact on clients |

---

## Open Questions

1. **Fixture file content for confidence verification**
   - What we know: Phase 37 uses `confidence: 0.8` for imported calls (imported symbol lookup via `importedSymbolIndex`). The fixture greet.ts → helper.ts is a cross-file import call.
   - What's unclear: Whether Phase 37's extraction correctly handles `import { helper } from './helper.js'` in a plain TS file in a temp dir (no `tsconfig.json`, no `package.json`).
   - Recommendation: Test that `find_callers("helper")` returns at least 1 item with `confidence` present. If 0 items, debug Phase 37's extraction against the temp dir fixture.

2. **`NOT_INITIALIZED` guard test placement**
   - What we know: D-17 lists `NOT_INITIALIZED` as a required test case. The shared transport test `beforeAll` always initializes.
   - What's unclear: Whether D-17 intends transport-layer testing or just coverage presence.
   - Recommendation: Put `NOT_INITIALIZED` in the unit test (`find-callers-callees.test.ts`) — matches `find_symbol` precedent. Note this in the plan so reviewer doesn't flag it as missing.

---

## Environment Availability

Step 2.6: SKIPPED — Phase 38 is purely code-level changes using existing dependencies. No new external tools, CLIs, or services required. All dependencies (`@modelcontextprotocol/sdk`, `zod`, `better-sqlite3`, `vitest`) are already installed and verified operational (test suite passes: 823/830 tests).

---

## Validation Architecture

`nyquist_validation` is `false` in `.planning/config.json` — validation architecture section SKIPPED per config.

---

## Security Domain

Phase 38 adds read-only query tools. ASVS applicability:

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | MCP tools operate within coordinator initialization gate (`isInitialized()` guard) |
| V3 Session Management | No | Stateless per-call tool invocations |
| V4 Access Control | No | Local stdio MCP server — no multi-user access |
| V5 Input Validation | Yes | `z.string().min(1)`, `z.coerce.number().int()`, `z.string().optional()` — Zod validates before handler runs |
| V6 Cryptography | No | Read-only DB queries, no secrets involved |

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via `name` parameter | Tampering | Parameterized queries via `sqlite.prepare('...WHERE name = ?').all(name)` — never string concatenation for user values |
| SQL injection via `filePath` parameter | Tampering | Same parameterized query approach |
| `IN (ids)` list injection | Tampering | `ids` array is derived from `SELECT id FROM symbols` — DB integers only, never user string |

The dynamic `IN (${placeholders})` with `ids.map(() => '?').join(', ')` is safe because placeholders are `?` characters (never user input) and `ids` contains only integers from the DB.

---

## Sources

### Primary (HIGH confidence)
- `src/mcp-server.ts:336-385` — `find_symbol` registerTool pattern; verified in codebase
- `src/db/repository.ts:1049-1083` — `findSymbols` two-query COUNT+SELECT pattern; verified in codebase
- `src/db/schema.ts:88-97` — `symbol_dependencies` table schema; verified in codebase
- `tests/integration/mcp-transport.test.ts:1-93` — InMemoryTransport setup, `callAndParse` helper; verified in codebase
- `tests/unit/find-symbol.test.ts` — `simulateFindSymbolResponse` unit test pattern; verified in codebase
- `.planning/phases/38-mcp-surface/38-CONTEXT.md` — all D-01..D-19 locked decisions; source of truth
- `.planning/REQUIREMENTS.md §MCP-01..04` — requirement specifications; verified

### Secondary (MEDIUM confidence)
- `.planning/codebase/CONVENTIONS.md` — ESM `.js` extensions, camelCase exports, double-quote strings; codebase analysis
- `.planning/codebase/TESTING.md` — vitest 3.1.4, test structure; codebase analysis

### Tertiary (LOW confidence)
- None — all claims in this research are backed by direct codebase inspection or locked decisions from CONTEXT.md.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are pre-existing, verified in codebase imports
- Architecture: HIGH — patterns are directly extracted from existing code, not inferred
- SQL query shape: MEDIUM — D-01..D-07 lock the semantics; exact SQL is Claude's Discretion (A1)
- Integration test fixture: MEDIUM — D-16 locks the structure; exact file content is Claude's Discretion (A2)
- Pitfalls: HIGH — derived from direct code inspection and Phase 37 data model analysis

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (stable codebase, locked decisions)
