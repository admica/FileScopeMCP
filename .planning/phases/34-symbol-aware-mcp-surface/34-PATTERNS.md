# Phase 34: Symbol-Aware MCP Surface - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 7 (2 modified production, 1 optional production, 4 test)
**Analogs found:** 7 / 7 (all have direct in-repo precedent)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/mcp-server.ts` (add `find_symbol`) | MCP tool registration + handler | request-response (read) | `find_important_files` handler (`src/mcp-server.ts:224-271`) | exact — `{items, total, truncated?}` envelope + NOT_INITIALIZED guard + Zod inputSchema |
| `src/mcp-server.ts` (enrich `get_file_summary`) | MCP tool handler | request-response (read) | existing handler (`src/mcp-server.ts:273-319`) — structural modification, not new | exact (in-place enrich) |
| `src/db/repository.ts` (`findSymbols`) | repository helper (raw SQL read + slice) | CRUD read + count | `getDependenciesWithEdgeMetadata` (`src/db/repository.ts:212-223`) for SQL/typed row; `getCommunityForFile` (`src/db/repository.ts:828-839`) for dual-statement same-connection shape | exact — raw SQL + typed cast boundary |
| `src/db/repository.ts` (`getDependentsWithImports`) | repository helper (raw SQL + JS aggregation) | CRUD read + transform | `getCommunities` (`src/db/repository.ts:792-822`) — group-by-key via Map; `getExportsSnapshot` (`src/db/repository.ts:475-491`) — null-safe JSON parse with try/catch fallback | exact (composite) |
| `src/db/symbol-types.ts` (optional `DependentWithImports`) | type declaration | N/A | existing `Symbol`/`SymbolKind` interfaces (`src/db/symbol-types.ts:11-19`) | exact (same file, same shape convention) |
| `tests/unit/find-symbol.test.ts` (new) | unit test (handler logic) | request-response | `tests/unit/tool-outputs.test.ts` `describe('get_file_summary response contract' …)` (lines 116-154) | exact — ephemeral DB + simulate response construction |
| `tests/unit/file-summary-enrichment.test.ts` (new) | unit test (handler logic) | request-response | same — `tests/unit/tool-outputs.test.ts` (lines 29-109 for setup; 116-174 for shape assertions) | exact |
| `src/db/repository.test.ts` / `src/db/repository.symbols.test.ts` (extend) | unit test (repository helper) | CRUD | `describe('getSymbolsByName' …)` (`src/db/repository.symbols.test.ts:99-121`) and `describe('setEdges — imported_names …')` (lines 148-183) | exact — same fixture/describe convention |
| `tests/unit/tool-outputs.test.ts` (extend) | contract test (wire shape) | request-response | itself — existing `describe('<tool> response contract' …)` blocks (lines 116-414) + `MCP tool name registry` at 420-447 | exact (extend existing pattern) |
| `tests/unit/schema-coercion.test.ts` (extend, small) | contract test (schema syntax) | static-grep | existing 5 grep-source tests (lines 10-63) | exact |

## Pattern Assignments

### `src/mcp-server.ts` — `find_symbol` tool (new registration)

**Analog:** `server.registerTool("find_important_files", …)` at `src/mcp-server.ts:224-271`.

**Imports pattern** (modify block at `src/mcp-server.ts:14-32`):
Already-destructured imports from `./db/repository.js` follow a sorted block. Add `findSymbols`, `getDependentsWithImports`, and `getSymbolsForFile` alongside existing `getDependencies…` names. Add a typed-only import from `./db/symbol-types.js` for `SymbolKind`:

```typescript
// Precedent for typed-only import shape — phase-33 already brought SymbolKind into test files via:
//   import type { Symbol as SymbolRow } from './symbol-types.js';   (src/db/repository.symbols.test.ts:18)
// Follow same '.js' extension convention per .planning/codebase/CONVENTIONS.md.
```

**NOT_INITIALIZED guard pattern** (copy from `src/mcp-server.ts:238`):
```typescript
if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
```
Single-line form — this exact literal appears ~6x in the file; do NOT vary wording.

**`{items, total, truncated?}` envelope pattern** (copy structure from `src/mcp-server.ts:266-270`, with renamed keys per FIND-04):
```typescript
// ANALOG (find_important_files — uses files / totalCount keys):
return mcpSuccess({
  files: items,
  ...(isTruncated && { truncated: true }),
  ...(isTruncated && { totalCount: allMatching.length }),
});

// PHASE-34 SHAPE (find_symbol — FIND-04 mandates items / total keys; see RESEARCH §Envelope Naming):
return mcpSuccess({
  items: projectedItems,
  total,
  ...(truncated && { truncated: true }),
});
```
Key difference from analog: FIND-04 locks `items` (not `files`) and `total` always present (not conditional on truncation). Do NOT retrofit `list_files`/`find_important_files` to the new names — out of scope.

**Zod inputSchema pattern** (copy coerce conventions from `src/mcp-server.ts:228-229` and `src/mcp-server.ts:414-415`):
```typescript
// ANALOG (find_important_files):
inputSchema: {
  maxItems: z.coerce.number().optional().describe("Maximum number of files to return (default: 10)"),
  minImportance: z.coerce.number().optional().describe("Minimum importance score (0-10)"),
},

// ANALOG (scan_all — proves .default() passes through SDK):
inputSchema: {
  min_importance: z.coerce.number().optional().default(1).describe("…"),
  remaining_only: z.boolean().optional().default(false).describe("…"),
},
```
Drop CONTEXT D-08 verbatim: `name: z.string().min(1)`, `kind: z.string().optional()`, `exportedOnly: z.coerce.boolean().default(true)`, `maxItems: z.coerce.number().int().optional()`.

**`annotations` block pattern** (copy from any read-only tool e.g. `src/mcp-server.ts:231-236`):
```typescript
annotations: {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
},
```

**maxItems clamp pattern** — NO direct precedent for `[1, 500]` clamp with silent coercion; synthesize from scratch per D-04:
```typescript
const limit = Math.max(1, Math.min(500, maxItems ?? 50));
```
Mirrors the `Math.min(10, Math.max(0, importance))` shape at `src/mcp-server.ts:386` and `:396` (set_file_importance 0-10 clamp).

---

### `src/mcp-server.ts` — `get_file_summary` enrichment (modify existing handler)

**Analog:** itself (`src/mcp-server.ts:273-319`). Structural swap of two fields, preserve all others.

**Add `exports[]` field** — use existing helper directly, no new repository call:
```typescript
// src/db/repository.ts:913-919 (getSymbolsForFile — ALREADY RETURNS the needed shape)
export function getSymbolsForFile(filePath: string): Array<SymbolRow & { path: string }> {
  const sqlite = getSqlite();
  const rows = sqlite
    .prepare('SELECT path, name, kind, start_line, end_line, is_export FROM symbols WHERE path = ? ORDER BY start_line')
    .all(filePath) as SymbolDbRow[];
  return rows.map(rowToSymbol);
}
```
Per D-09/D-10/D-11: filter `s.isExport`, project out `path` + `isExport` fields, keep `ORDER BY start_line` from the SQL (no re-sort needed). Inline the filter + projection at the handler — repository returns schema-shape, handler returns wire-shape.

**Swap `dependents` assignment** — change line 310:
```typescript
// BEFORE (src/mcp-server.ts:310):
dependents: node.dependents || [],

// AFTER:
dependents: getDependentsWithImports(normalizedPath),
```
Parallels existing call pattern at `src/mcp-server.ts:305` where `getDependenciesWithEdgeMetadata(normalizedPath)` is called directly (the helper-bypasses-FileNode precedent).

**Preserve conditional-field-spread pattern for optional fields** (`src/mcp-server.ts:313-315`):
```typescript
...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
```
Do NOT use conditional spreads for `exports` or `dependents` — both must ALWAYS appear (per SUM-04: non-TS/JS files → `exports: []`; helper returns `[]` for no dependents).

---

### `src/db/repository.ts` — `findSymbols(opts)` (new helper)

**Analog:** `getDependenciesWithEdgeMetadata` at `src/db/repository.ts:212-223` for the raw-SQL+typed-row pattern; `getCommunityForFile` at `src/db/repository.ts:828-839` for the dual-`.prepare()`-same-connection shape.

**Raw SQL + typed cast boundary pattern** (copy from `src/db/repository.ts:212-223`):
```typescript
// ANALOG: getDependenciesWithEdgeMetadata (pattern exemplar — see RESEARCH §Pattern 1)
export function getDependenciesWithEdgeMetadata(filePath: string): Array<{
  target_path: string;
  edge_type: string;
  confidence: number;
}> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT target_path, edge_type, confidence FROM file_dependencies WHERE source_path = ? AND dependency_type = 'local_import'"
    )
    .all(filePath) as Array<{ target_path: string; edge_type: string; confidence: number }>;
}
```

**Row-to-domain mapping pattern** (copy from `src/db/repository.ts:887-896`):
```typescript
// ANALOG: rowToSymbol — already converts is_export: number → isExport: boolean and snake→camel
function rowToSymbol(r: SymbolDbRow): SymbolRow & { path: string } {
  return {
    path:      r.path,
    name:      r.name,
    kind:      r.kind as SymbolKind,
    startLine: r.start_line,
    endLine:   r.end_line,
    isExport:  r.is_export === 1,
  };
}
```
Reuse `rowToSymbol` directly; do NOT duplicate. `SymbolDbRow` + `rowToSymbol` are already in scope within repository.ts (private).

**Exact-match primitive left untouched** (`src/db/repository.ts:902-908`):
```typescript
// ANALOG + INVARIANT: D-17 says this stays as the exact-match-only low-level helper.
export function getSymbolsByName(name: string, kind?: SymbolKind): Array<SymbolRow & { path: string }> {
  const sqlite = getSqlite();
  const rows = kind
    ? sqlite.prepare('SELECT path, name, kind, start_line, end_line, is_export FROM symbols WHERE name = ? AND kind = ?').all(name, kind) as SymbolDbRow[]
    : sqlite.prepare('SELECT path, name, kind, start_line, end_line, is_export FROM symbols WHERE name = ?').all(name) as SymbolDbRow[];
  return rows.map(rowToSymbol);
}
```
`findSymbols` wraps this role for the MCP path; it does NOT replace it (`repository.symbols.test.ts:99-121` pins the existing signature).

**Dual-statement count + slice pattern** — no direct precedent; synthesize from Pattern 1 + `getCommunityForFile` (two `.prepare().all()` against same `getSqlite()` without an explicit transaction):
```typescript
// PROPOSED (from RESEARCH §Pattern 2, keep signature per D-17):
export function findSymbols(opts: {
  name: string;
  kind?: SymbolKind;
  exportedOnly: boolean;
  limit: number;
}): { items: Array<SymbolRow & { path: string }>; total: number } {
  const sqlite = getSqlite();
  const { namePredicate, nameParam } = buildNamePredicate(opts.name);  // GLOB vs = branch
  // Build WHERE dynamically — only opts.exportedOnly and opts.kind add parts.
  // SELECT COUNT(*) for total (pre-truncation per D-07)
  // SELECT … ORDER BY is_export DESC, path ASC, start_line ASC LIMIT ?
  // Return { items: rows.map(rowToSymbol), total }
}
```

**GLOB name-predicate builder** — no precedent (new helper). Keep private to `repository.ts`, tight escape contract:
```typescript
// From RESEARCH §GLOB vs LIKE Decision — one-line escape, no PRAGMA.
function escapeGlobMeta(s: string): string {
  return s.replace(/([*?\[])/g, '[$1]');
}
function buildNamePredicate(name: string): { namePredicate: string; nameParam: string } {
  if (name.endsWith('*')) {
    const prefix = escapeGlobMeta(name.slice(0, -1));
    return { namePredicate: 'name GLOB ?', nameParam: prefix + '*' };
  }
  return { namePredicate: 'name = ?', nameParam: name };
}
```

---

### `src/db/repository.ts` — `getDependentsWithImports(targetPath)` (new helper)

**Analog:** `getCommunities` at `src/db/repository.ts:792-822` for the group-by-key Map aggregation; `getExportsSnapshot` at `src/db/repository.ts:475-491` for the null-safe JSON parse with try/catch fallback; `getDependenciesWithEdgeMetadata` at `:212-223` for the raw-SQL + typed-row shape.

**JS-level aggregation via Map pattern** (copy from `src/db/repository.ts:800-821`):
```typescript
// ANALOG: getCommunities — group rows by key, post-process each group, sort at the end
const groups = new Map<number, string[]>();
for (const row of rows) {
  if (!groups.has(row.community_id)) groups.set(row.community_id, []);
  groups.get(row.community_id)!.push(row.file_path);
}
// … downstream sorts members: members.sort() (line 818)
```
Adapt to `Map<source_path, { names: Set<string>; lines: number[] }>` for phase 34 — the Set-for-dedupe + array-for-all-lines mirrors D-13's "set-style names, every-occurrence lines" directly.

**Null-safe JSON parse pattern** (copy from `src/db/repository.ts:482-490`):
```typescript
// ANALOG: getExportsSnapshot — the exact null-safe JSON.parse contract D-14 wants
if (!row || row.exports_snapshot === null || row.exports_snapshot === undefined) {
  return null;
}
try {
  return JSON.parse(row.exports_snapshot) as ExportSnapshot;
} catch {
  return null;
}
```
Adapt: return `[]` instead of `null` on null/malformed (D-14: never surface null in MCP response). Keep the `try { JSON.parse } catch { return [] }` shape one-to-one.

**SQL + typed-row shape** (copy from `getDependenciesWithEdgeMetadata`, adjust columns):
```typescript
// SELECT source_path, imported_names, import_line
// FROM file_dependencies
// WHERE target_path = ? AND dependency_type = 'local_import'
// .all(targetPath) as Array<{ source_path: string; imported_names: string | null; import_line: number | null }>;
```
`dependency_type = 'local_import'` filter mirrors `getDependenciesWithEdgeMetadata` at line 220 — package-import edges excluded from dependents contract.

**Sort-at-end pattern** (echoes `getCommunities:818` `members.sort()`):
Per D-13 + D-15 + Specifics §: sort `importedNames` alphabetically, `importLines` ascending, outer `dependents[]` by `path ASC` before returning.

**Left-alone primitive** (`src/db/repository.ts:230-238`):
```typescript
// D-18 INVARIANT: getDependents stays unchanged — still used by rowToFileNode(:54) and coordinator(:539).
export function getDependents(filePath: string): string[] { /* … Drizzle query, returns string[] … */ }
```
`getDependentsWithImports` is ADDED alongside — no override, no rename. Two helpers for two consumers (in-memory FileNode vs wire-shape MCP response).

---

### `src/db/symbol-types.ts` — optional `DependentWithImports` interface

**Analog:** `Symbol` interface at `src/db/symbol-types.ts:13-19` + `SymbolKind` union at `:11`.

**Interface declaration pattern** (copy shape from same file):
```typescript
// ANALOG: src/db/symbol-types.ts:13-19
export interface Symbol {
  name:      string;
  kind:      SymbolKind;
  startLine: number;
  endLine:   number;
  isExport:  boolean;
}
```
Proposed addition (planner's call per CONTEXT Claude's Discretion §):
```typescript
export interface DependentWithImports {
  path:          string;
  importedNames: string[];
  importLines:   number[];
}
```
Alternative per RESEARCH: inline the return type in `getDependentsWithImports`'s signature — research leans inline since single call site. Either matches the "one interface per domain object" convention already in this file.

---

### `tests/unit/find-symbol.test.ts` (new)

**Analog:** `tests/unit/tool-outputs.test.ts` setup block (lines 29-109) + `describe('get_file_summary response contract', …)` at lines 116-154.

**Ephemeral DB + schema setup pattern** (copy from `tests/unit/tool-outputs.test.ts:29-74`):
```typescript
// ANALOG (abbreviated):
let tmpDir: string;
let dbPath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-outputs-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  openDatabase(dbPath);

  const sqlite = getSqlite();
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS files ( … );
    CREATE TABLE IF NOT EXISTS file_dependencies ( … );
    CREATE TABLE IF NOT EXISTS file_communities ( … );
  `);
});

afterAll(async () => {
  closeDatabase();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function clear(): void {
  const sqlite = getSqlite();
  sqlite.exec('DELETE FROM files; DELETE FROM file_dependencies; DELETE FROM file_communities;');
}
```
Adapt: add `symbols` table to schema setup. Real schema at `src/db/schema.ts` — or borrow column list directly from phase-33 migration `drizzle/0005_add_symbols_and_import_metadata.sql`. Alternative analog: `src/db/repository.symbols.test.ts:22-55` uses `openDatabase`/`closeDatabase` via the real migration path — that may be simpler; planner's call.

**Simulate-response-construction pattern** (copy from `tests/unit/tool-outputs.test.ts:127-141`):
```typescript
// ANALOG: construct the wire shape in-test from repository helper outputs,
// do NOT invoke the MCP server. Assert on the plain object.
const response = {
  path: node!.path,
  importance: node!.importance || 0,
  dependencies: deps.map(d => ({ path: d.target_path, edgeType: d.edge_type, confidence: d.confidence })),
  dependents: node!.dependents || [],
  // ...
};
expect(response.path).toBe('/src/main.ts');
```
For `find_symbol`, call `findSymbols({ … })` directly, compute `truncated`, spread conditionally, assert on the envelope.

**Test coverage per D-23:** exact match, prefix (`*`-suffix), `exportedOnly` default + override, `kind` filter, unknown kind → `{items:[], total:0}`, `maxItems` clamp (0, 1, 500, 10000), `truncated` field presence/absence, zero-match empty shape. NOT_INITIALIZED is a handler-level concern — exercise via the existing `tool-outputs.test.ts` guard precedent if needed (or via an explicit mock of `coordinator.isInitialized()`).

---

### `tests/unit/file-summary-enrichment.test.ts` (new)

**Analog:** same as above — `tests/unit/tool-outputs.test.ts:116-154`.

**Same setup + simulate-response pattern.** Additionally seed `symbols` rows + `file_dependencies` rows with `imported_names` JSON blob per phase-33 write path. Can reuse `insertDep` helper precedent at `tool-outputs.test.ts:98-109`:

```typescript
// ANALOG: insertDep at tests/unit/tool-outputs.test.ts:98
function insertDep(src: string, tgt: string, opts: Record<string, any> = {}): void {
  const sqlite = getSqlite();
  sqlite.prepare(
    'INSERT INTO file_dependencies (source_path, target_path, dependency_type, edge_type, confidence, confidence_source, package_name) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(src, tgt, opts.dependency_type ?? 'local_import', opts.edge_type ?? 'imports', opts.confidence ?? 0.8, opts.confidence_source ?? 'inferred', opts.package_name ?? null);
}
```
Extend with `imported_names` and `import_line` columns (INSERT statement missing them today — add fields to the helper). Alternative: use the real `setEdges`/`setEdgesAndSymbols` from `repository.ts` to write phase-33 shape — same precedent used by `src/db/repository.symbols.test.ts:148-170`.

**Test coverage per D-24:** `exports[]` populated + sorted by startLine; non-TS/JS path (no symbols rows) → `exports: []`; `dependents[]` one entry per source path; `importedNames` deduped across multi-row same-pair edges; namespace imports `['*']` pass-through; NULL `imported_names` → `[]`.

---

### `src/db/repository.test.ts` or `src/db/repository.symbols.test.ts` (extend, D-25)

**Analog (preferred file):** `src/db/repository.symbols.test.ts` at lines 99-121 (`describe('getSymbolsByName', …)`) and lines 148-183 (`describe('setEdges — imported_names + import_line persistence (IMP-03)', …)`).

**Fixture-and-factory pattern** (copy from `src/db/repository.symbols.test.ts:29-56`):
```typescript
// ANALOG: tmp-dir-per-test, openDatabase + real migrations, tiny `makeSymbol` / `makeEdge` factories
let tmpDir: string;
function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-sym-repo-'));
  return path.join(tmpDir, 'test.db');
}
function makeSymbol(overrides: Partial<SymbolRow> = {}): SymbolRow {
  return { name: 'foo', kind: 'function', startLine: 1, endLine: 5, isExport: true, ...overrides };
}
beforeEach(() => { openDatabase(makeTmpDb()); });
afterEach(() => { try { closeDatabase(); } catch {} /* cleanup tmpDir */ });
```
Append two new `describe(…)` blocks at the end: one for `findSymbols` (LIMIT + total count, kind filter, exportedOnly, `GLOB` prefix, empty unknown-kind), one for `getDependentsWithImports` (aggregation, NULL → `[]`, dedupe, sort, namespace-import pass-through).

**Recommend: extend `repository.symbols.test.ts`, not `repository.test.ts`.** The `.symbols.test.ts` file already owns every symbol- and import-metadata-related test; `repository.test.ts` covers the older CRUD helpers (files, deps, staleness). Keep domain boundary intact.

---

### `tests/unit/tool-outputs.test.ts` (extend, D-26 reinterpreted — see RESEARCH R-3)

**Analog:** itself. Extend existing `describe('<tool> response contract', …)` convention.

**Tool-name registry pattern** (`tests/unit/tool-outputs.test.ts:420-447`):
```typescript
// ANALOG: must add 'find_symbol' to expectedTools array on line ~441
const expectedTools = [
  'set_base_directory', 'list_files', 'find_important_files', 'get_file_summary',
  'set_file_summary', 'set_file_importance', 'scan_all', 'search', 'status',
  'exclude_and_remove', 'detect_cycles', 'get_cycles_for_file', 'get_communities',
  // ADD: 'find_symbol',
];
// Also update the describe title: "all 14 expected tool names …"
```

**Envelope contract pattern** (derived from `describe('get_file_summary response contract')` at `:116-154`):
Add two new describe blocks:
1. `describe('find_symbol response contract', …)` — assert `items` is Array, `total` is number, `truncated` absent-vs-true per D-07.
2. `describe('get_file_summary response contract — Phase 34 enrichment', …)` (OR extend existing block) — assert `exports` is array (including empty), `dependents[0]` is object with `path`/`importedNames`/`importLines` keys.

**Do NOT create `tests/contract/mcp-tools.test.ts`.** Per RESEARCH R-3, the directory does not exist and creating it for one file is structure-for-structure's-sake. Extend the already-contract-flavored `tool-outputs.test.ts` — its header literally says "Contract tests for MCP tool response shapes."

---

### `tests/unit/schema-coercion.test.ts` (extend, small — recommended)

**Analog:** itself. Five existing grep-source tests at lines 10-63 follow identical shape.

**Grep-source test pattern** (copy from `tests/unit/schema-coercion.test.ts:10-23`):
```typescript
// ANALOG:
it('find_important_files uses z.coerce.number() for maxItems and minImportance', async () => {
  const src = await fs.readFile(path.resolve(process.cwd(), 'src/mcp-server.ts'), 'utf-8');
  const match = src.match(/registerTool\("find_important_files"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
  expect(match, 'find_important_files registerTool block not found').toBeTruthy();
  const block = match![1];
  expect(block).toMatch(/maxItems:\s*z\.coerce\.number\(\)/);
  expect(block).toMatch(/minImportance:\s*z\.coerce\.number\(\)/);
});
```
Add one `it(…)` asserting `find_symbol` block contains `exportedOnly: z.coerce.boolean().default(true)` and `maxItems: z.coerce.number().int()`. Prevents regression on the D-08 schema shape.

## Shared Patterns

### mcpSuccess / mcpError envelope
**Source:** `src/mcp-server.ts:136-147`
**Apply to:** Both new `find_symbol` handler and the modified `get_file_summary` handler.
```typescript
type ErrorCode = "NOT_INITIALIZED" | "INVALID_PATH" | "BROKER_DISCONNECTED" | "NOT_FOUND" | "OPERATION_FAILED";

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
DO NOT extend `ErrorCode` (RESEARCH §Anti-Patterns — FIND-05 mandates NOT_INITIALIZED-only; every other outcome returns an empty items array). Every MCP response in phase 34 flows through these two helpers — no new error machinery.

### NOT_INITIALIZED guard (one-line)
**Source:** repeated ~6x in `src/mcp-server.ts` — e.g. `:194`, `:238`, `:286`, `:335`, `:368`, `:424`.
**Apply to:** First line of every new/modified MCP handler.
```typescript
if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
```
Verbatim literal — do NOT rephrase. Every existing handler uses the exact same string.

### Conditional field spread for optional keys
**Source:** `src/mcp-server.ts:219-220`, `:268-269`, `:303`, `:313-315`
**Apply to:** `find_symbol`'s `truncated` field; `get_file_summary`'s staleness fields (existing, preserve).
```typescript
// Pattern — emit the key only when the condition holds. Never emit { key: false } or { key: undefined }.
...(isTruncated && { truncated: true }),
...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
```
RESEARCH Pitfall 3 flags this: `truncated: false` is wrong; omit the key.

### Raw SQL via `getSqlite().prepare()` for read-heavy paths
**Source:** `src/db/repository.ts:212-223` (`getDependenciesWithEdgeMetadata`), `:475-491` (`getExportsSnapshot`), `:902-908` (`getSymbolsByName`), `:913-919` (`getSymbolsForFile`), `:792-822` (`getCommunities`)
**Apply to:** Both new repository helpers (`findSymbols`, `getDependentsWithImports`).
```typescript
const sqlite = getSqlite();
const rows = sqlite
  .prepare('SELECT col1, col2 FROM table WHERE key = ?')
  .all(keyValue) as Array<{ col1: T1; col2: T2 }>;
// Map rows → domain shape if snake_case columns
```
RESEARCH §Anti-Patterns: do NOT use Drizzle for new phase-34 helpers — the raw-SQL pattern is already dominant for reads (9+ call sites). GLOB + aggregation read more cleanly as raw SQL.

### Null-safe JSON parse with empty fallback
**Source:** `src/db/repository.ts:482-490` (`getExportsSnapshot`)
**Apply to:** `getDependentsWithImports` when reading `imported_names`.
```typescript
// Inline the try/catch at the aggregation site — single call site, no new shared helper.
if (r.imported_names !== null) {
  try {
    const arr = JSON.parse(r.imported_names) as unknown;
    if (Array.isArray(arr)) for (const n of arr) if (typeof n === 'string') bucket.names.add(n);
  } catch { /* malformed JSON — treat as empty, matches getExportsSnapshot semantics */ }
}
```
RESEARCH Pitfall 2: parse in the helper, return typed `string[]`. Let `mcpSuccess`'s single outer `JSON.stringify` handle wire encoding once. Never re-stringify intermediate values.

### ES modules + `.js` extensions in relative imports
**Source:** `.planning/codebase/CONVENTIONS.md`
**Apply to:** All new imports in `mcp-server.ts` additions.
```typescript
import { findSymbols, getDependentsWithImports, getSymbolsForFile } from './db/repository.js';
import type { SymbolKind } from './db/symbol-types.js';
```
Every existing import in `src/mcp-server.ts:11-37` uses `.js` extensions. No exceptions.

### Ephemeral-DB test fixture
**Source:** `tests/unit/tool-outputs.test.ts:29-79` and `src/db/repository.symbols.test.ts:22-56`
**Apply to:** `find-symbol.test.ts` and `file-summary-enrichment.test.ts`.
Two working shapes in the codebase — either works:
- **Shape A (inline schema):** `beforeAll` + raw `sqlite.exec()` CREATE TABLE. Lets test be hermetic without importing migrations. Used by `tool-outputs.test.ts`.
- **Shape B (real migrations):** `beforeEach` + `openDatabase(tmpPath)` which runs drizzle migrations. Used by `repository.symbols.test.ts`.

Phase 34 tests need the `symbols` table + `file_dependencies.imported_names`/`import_line` columns — Shape B is simpler (get the real schema for free). Planner's call.

## No Analog Found

All files have at least a role-match analog. **Zero gaps.** Specific notes:

| File | Role | Data Flow | Notes |
|------|------|-----------|-------|
| `findSymbols` (dual count+LIMIT SQL) | repository helper | CRUD + pagination | **No exact pagination precedent** — closest is `getCommunityForFile` which runs two prepared statements against the same connection. RESEARCH §Pattern 2 synthesizes the shape from Pattern 1 + `getCommunityForFile`. Planner treats this as "compose two existing patterns" not "invent new." |
| `find_symbol` envelope `{items, total, truncated?}` | MCP handler | request-response | **Envelope key names are new** — existing `list_files`/`find_important_files` use `files` + `totalCount`. RESEARCH §Envelope Naming flags this as a conscious divergence per FIND-04; planner honors FIND-04 and does NOT retrofit existing tools. |

## Metadata

**Analog search scope:** `src/mcp-server.ts`, `src/db/repository.ts`, `src/db/symbol-types.ts`, `src/db/repository.symbols.test.ts`, `tests/unit/tool-outputs.test.ts`, `tests/unit/schema-coercion.test.ts`.
**Files scanned:** 6 source + 3 test fixtures consulted.
**Pattern extraction date:** 2026-04-23.
**Confidence:** HIGH — every phase 34 file has a direct precedent within 100 lines of the modified section. Only `findSymbols`'s SQL-level count+slice and the envelope key rename are new-at-this-scale, both explicitly locked by CONTEXT + validated by RESEARCH.
