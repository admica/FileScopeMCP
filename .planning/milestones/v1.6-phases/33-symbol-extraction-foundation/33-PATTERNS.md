# Phase 33: Symbol Extraction Foundation - Pattern Map

**Mapped:** 2026-04-23
**Files analyzed:** 12 (new/modified)
**Analogs found:** 12 / 12

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/change-detector/ast-parser.ts` | parser/utility (MODIFY) | transform | self (extend `extractRicherEdges`) | self |
| `src/db/symbol-types.ts` | type definition (CREATE) | n/a | `src/change-detector/types.ts` | role-match |
| `src/language-config.ts` | dispatcher/service (MODIFY) | request-response | self (extend `extractTsJsEdges`) | self |
| `src/db/schema.ts` | schema/model (MODIFY) | n/a | self (extend existing tables) | self |
| `src/db/repository.ts` | repository/service (MODIFY) | CRUD | self (`setCommunities`, `setEdges`) | self |
| `src/coordinator.ts` | orchestrator (MODIFY) | request-response | `src/migrate/json-to-sqlite.ts` gate shape | role-match |
| `drizzle/0005_add_symbols_and_import_metadata.sql` | migration (CREATE) | n/a | `drizzle/0004_add_edge_metadata.sql` | exact |
| `scripts/inspect-symbols.mjs` | CLI utility (CREATE) | transform | `scripts/register-mcp.mjs` | role-match |
| `scripts/bench-scan.mjs` | CLI utility (CREATE) | batch | `scripts/register-mcp.mjs` | role-match |
| `package.json` | config (MODIFY) | n/a | self | self |
| `src/change-detector/ast-parser.symbols.test.ts` | test (CREATE) | n/a | `src/change-detector/ast-parser.test.ts` | exact |
| `src/db/repository.symbols.test.ts` | test (CREATE) | n/a | `src/db/repository.test.ts` | exact |

---

## Pattern Assignments

### `src/change-detector/ast-parser.ts` (parser/utility, MODIFY)

**Analog:** self — extend `extractRicherEdges()` starting at line 161

**Current `RicherEdgeData` interface** (lines 116–123) — widen this in place:
```typescript
export interface RicherEdgeData {
  regularImports: string[];
  reExportSources: string[];
  inheritsFrom: Array<{ className: string; sourceSpecifier: string }>;
  // ADD Phase 33:
  symbols:    Symbol[];      // from src/db/symbol-types.js
  importMeta: ImportMeta[];  // per import_statement metadata
}
```

**`ImportMeta` interface** — add alongside `RicherEdgeData`:
```typescript
export interface ImportMeta {
  specifier:     string;   // raw import specifier string (e.g. './utils')
  importedNames: string[]; // e.g. ["useState","useEffect"] or ["*"] or ["default"]
  line:          number;   // 1-indexed source line of the import_statement node
}
```

**Parser setup pattern** (lines 13–38) — one parser instance per grammar at module load, `createRequire` for CJS tree-sitter. All new parsers follow the same pattern. No new parsers needed for Phase 33.

**`visitNode` loop pattern** (lines 182–248) — the tree walk already handles `import_statement` and `export_statement`. Phase 33 adds two accumulators to the existing `visitNode` body. Key excerpt showing walk structure:
```typescript
function visitNode(node: any): void {
  if (node.type === 'import_statement') {
    const sourceNode = node.childForFieldName('source');
    if (sourceNode) {
      const specifier = getStringFragment(sourceNode);
      if (specifier) {
        regularImports.push(specifier);
        buildImportNameMap(node, specifier, importNameToSource);
        // ADD: push to importMeta here (same branch, same sourceNode)
      }
    }
  } else if (node.type === 'export_statement') {
    // existing re-export logic ...
    // ADD: symbol extraction from declaration field (see RESEARCH.md §Code Examples)
  }
  for (let i = 0; i < node.childCount; i++) visitNode(node.child(i));
}
```

**`buildImportNameMap` pattern** (lines 130–148) — the existing walk over `import_specifier`, `identifier`, `namespace_import` is the exact pattern to COPY into a new `extractImportedNames(importNode)` helper that returns `string[]` instead of building a Map. See RESEARCH.md §Import Name Extraction for the exact code.

**Line number pattern** — `node.startPosition.row + 1` (0-indexed → 1-indexed). Used at line 268 of RESEARCH.md code examples. Always add 1.

**`getStringFragment` helper** (lines 372–392) — reuse as-is to extract the raw specifier string from `import_statement.source` node.

**`isDefaultExport` helper** (lines 399–404) — reuse as-is to identify `export default` nodes for D-06 anonymous-default skipping.

**Error handling pattern** (lines 167–172):
```typescript
try {
  tree = parser.parse(source);
} catch (err) {
  log(`[ast-parser] tree-sitter parse failed for ${filePath}: ${err}`);
  return null;
}
```
Symbol extraction errors inside the walk should log and skip (not throw), matching D-12.

**Return statement** (line 251) — widen from:
```typescript
return { regularImports, reExportSources, inheritsFrom };
```
to:
```typescript
return { regularImports, reExportSources, inheritsFrom, symbols, importMeta };
```

**Non-TS/JS guard** — `extractRicherEdges` already returns `null` for unsupported extensions (line 162). Callers that receive `null` already skip gracefully. No change needed here.

---

### `src/db/symbol-types.ts` (type definition, CREATE)

**Analog:** `src/change-detector/types.ts` (lines 1–15)

**File header pattern** (from `types.ts` lines 1–4):
```typescript
// src/db/symbol-types.ts
// Phase 33 Symbol type for the symbols table.
// Distinct from ExportedSymbol in change-detector/types.ts (which keeps variable/default kinds + signature).
```

**Interface pattern** (copy shape from `ExportedSymbol` in `types.ts` lines 9–15):
```typescript
export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const';

export interface Symbol {
  name:      string;
  kind:      SymbolKind;
  startLine: number;   // 1-indexed
  endLine:   number;   // 1-indexed
  isExport:  boolean;
}
```

No other imports needed in this file. It is a pure type definition — no runtime code.

---

### `src/language-config.ts` (dispatcher/service, MODIFY)

**Analog:** self — extend `extractTsJsEdges()` (lines 530–561)

**Current `extractTsJsEdges` signature and structure** (lines 530–561):
```typescript
async function extractTsJsEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  const richer = extractRicherEdges(filePath, content);
  if (!richer) return [];

  log(`[language-config] [AST] Found ${richer.regularImports.length} imports, ...`);

  const edges: EdgeResult[] = [];

  // Regular imports
  for (const imp of richer.regularImports) {
    const edge = await resolveTsJsImport(imp, filePath, projectRoot, 'imports');
    if (edge) edges.push(edge);
  }
  // ... re-exports, inherits ...
  return edges;
}
```

**Phase 33 changes to `extractTsJsEdges`:**
1. Destructure `richer.symbols` and `richer.importMeta` from the widened return.
2. Add `originalSpecifier` field to `EdgeResult` interface (OQ-1 answer: approach 1 — thread raw specifier through). When calling `resolveTsJsImport`, capture the specifier alongside the resolved edge.
3. Return a new result shape `{ edges, symbols, importMeta }` OR change `extractTsJsEdges` to return that shape and update the registry `extract` call-site.

**`EdgeResult` interface** (lines 79–96) — add `originalSpecifier?: string`:
```typescript
export interface EdgeResult {
  target:            string;
  edgeType:          string;
  confidence:        number;
  confidenceSource:  ConfidenceSource;
  weight:            number;
  isPackage:         boolean;
  packageName?:      string;
  packageVersion?:   string;
  originalSpecifier?: string;  // ADD: raw import specifier for ImportMeta matching
}
```

**Aggregation in `extractEdges`** (lines 893–905) — the deduplication loop at line 895–904 collapses same `(target, edgeType)` pairs. Per OQ-2 / D-08, `importMeta` rows must NOT be aggregated. Solution: `extractTsJsEdges` returns `importMeta` separately (pre-aggregation), while `edges` are returned for the aggregator. The coordinator writes `importMeta` directly alongside `upsertSymbols`, bypassing the aggregated `edges` for the `imported_names`/`import_line` columns.

**Import added at top of file** (line 25):
```typescript
import { extractRicherEdges } from './change-detector/ast-parser.js';
```
Also add:
```typescript
import type { Symbol as SymbolRow } from './db/symbol-types.js';
import type { ImportMeta } from './change-detector/ast-parser.js';
```

---

### `src/db/schema.ts` (schema/model, MODIFY)

**Analog:** self — extend by copying the `file_communities` table pattern (lines 51–57)

**Existing table definition pattern** (lines 51–57) — use for new `symbols` table:
```typescript
export const file_communities = sqliteTable('file_communities', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  community_id: integer('community_id').notNull(),
  file_path:    text('file_path').notNull(),
}, (t) => [
  index('communities_community_id_idx').on(t.community_id),
]);
```

**New `symbols` table** — copy pattern, two indexes:
```typescript
export const symbols = sqliteTable('symbols', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  path:       text('path').notNull(),
  name:       text('name').notNull(),
  kind:       text('kind').notNull(),
  start_line: integer('start_line').notNull(),
  end_line:   integer('end_line').notNull(),
  is_export:  integer('is_export', { mode: 'boolean' }).notNull().default(false),
}, (t) => [
  index('symbols_name_idx').on(t.name),
  index('symbols_path_idx').on(t.path),
]);
```

**New `kv_state` table** — simpler shape (no autoincrement — primary key is the string key):
```typescript
export const kv_state = sqliteTable('kv_state', {
  key:   text('key').primaryKey().notNull(),
  value: text('value').notNull(),
});
```

**Additive columns on `file_dependencies`** (lines 28–47) — copy the nullable column pattern from existing optional fields like `package_name` (line 35):
```typescript
// ADD after weight column:
imported_names: text('imported_names'),   // nullable JSON string array — D-08
import_line:    integer('import_line'),   // nullable source line — D-08
```
No `.notNull()`, no `.default()` — NULL is correct per D-10 for non-TS/JS rows.

**Imports at top** — `sqliteTable`, `text`, `integer`, `index`, `real` already imported (line 4). No new imports needed.

---

### `src/db/repository.ts` (repository/service, MODIFY)

**Analog:** self — copy `setCommunities` (lines 733–747) for `upsertSymbols`; copy `getDependenciesWithEdgeMetadata` (lines 210–221) for read helpers.

**`setCommunities` transaction pattern** (lines 733–747) — the canonical DELETE+bulk-INSERT pattern for this codebase:
```typescript
export function setCommunities(communities: CommunityResult[]): void {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM file_communities').run();
    const stmt = sqlite.prepare(
      'INSERT INTO file_communities (community_id, file_path) VALUES (?, ?)'
    );
    for (const c of communities) {
      for (const filePath of c.members) {
        stmt.run(c.communityId, filePath);
      }
    }
  });
  tx();
}
```

**`upsertSymbols` — copy this pattern exactly**, scoping the DELETE to `path` instead of table-wide:
```typescript
export function upsertSymbols(path: string, syms: SymbolRow[]): void {
  const sqlite = getSqlite();
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM symbols WHERE path = ?').run(path);
    const stmt = sqlite.prepare(
      'INSERT INTO symbols (path, name, kind, start_line, end_line, is_export) VALUES (?, ?, ?, ?, ?, ?)'
    );
    for (const s of syms) {
      stmt.run(path, s.name, s.kind, s.startLine, s.endLine, s.isExport ? 1 : 0);
    }
  });
  tx();
}
```

**`markStale` transaction pattern** (lines 633–643) — single prepared statement reused inside a transaction. Use for `getSymbolsForFile` bulk read with a single `.all()` call (no transaction needed for reads).

**`getDependenciesWithEdgeMetadata` raw-SQL read pattern** (lines 210–221) — copy for `getSymbolsByName` and `getSymbolsForFile`:
```typescript
export function getDependenciesWithEdgeMetadata(filePath: string): Array<{...}> {
  const sqlite = getSqlite();
  return sqlite
    .prepare(
      "SELECT target_path, edge_type, confidence FROM file_dependencies WHERE source_path = ? AND dependency_type = 'local_import'"
    )
    .all(filePath) as Array<{ target_path: string; edge_type: string; confidence: number }>;
}
```

**`getExportsSnapshot` JSON parse pattern** (lines 437–453) — copy the `JSON.parse` + try/catch for reading `imported_names` from `file_dependencies` rows:
```typescript
try {
  return JSON.parse(row.exports_snapshot) as ExportSnapshot;
} catch {
  return null;
}
```

**`kv_state` helpers** — use `getSqlite().prepare(...).get()` / `.run()` directly (same as `getDependenciesWithEdgeMetadata` raw SQL style):
```typescript
export function getKvState(key: string): string | null {
  const sqlite = getSqlite();
  const row = sqlite.prepare('SELECT value FROM kv_state WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setKvState(key: string, value: string): void {
  const sqlite = getSqlite();
  sqlite.prepare(
    'INSERT INTO kv_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, value);
}
```

**`setEdges` extension** (lines 321–345) — add optional `importMeta` parameter. The existing loop over `edges` already does one `db.insert(...).run()` per edge. Add `imported_names` + `import_line` to each insert values object, matched by `edge.originalSpecifier`:
```typescript
export function setEdges(
  sourcePath: string,
  edges: EdgeResult[],
  importMeta?: ImportMeta[]
): void {
  const db = getDb();
  const metaMap = new Map(importMeta?.map(m => [m.specifier, m]) ?? []);

  db.delete(file_dependencies).where(eq(file_dependencies.source_path, sourcePath)).run();

  for (const edge of edges) {
    const meta = edge.isPackage ? undefined : metaMap.get(edge.originalSpecifier ?? '');
    db.insert(file_dependencies).values({
      // ... existing fields unchanged ...
      imported_names: meta ? JSON.stringify(meta.importedNames) : null,
      import_line:    meta?.line ?? null,
    }).run();
  }
  markCommunitiesDirty();
}
```

**Imports to add at top** of repository.ts:
```typescript
import type { Symbol as SymbolRow, SymbolKind } from './symbol-types.js';
import type { ImportMeta } from '../change-detector/ast-parser.js';
import { symbols, kv_state } from './schema.js';  // add to existing schema import
```

---

### `src/coordinator.ts` (orchestrator, MODIFY)

**Analog:** `src/migrate/json-to-sqlite.ts` — one-shot startup gate shape (lines 35–43)

**Existing one-shot gate pattern in `json-to-sqlite.ts`** (lines 35–43):
```typescript
function checkAlreadyMigrated(sqlite: InstanceType<typeof Database>): boolean {
  try {
    const row = sqlite.prepare('SELECT COUNT(*) as n FROM files').get() as { n: number };
    return row.n > 0;
  } catch {
    return false;
  }
}
```

**`runMigrationIfNeeded` hook point in `coordinator.ts`** (line 269 — confirmed from source):
```typescript
try {
  runMigrationIfNeeded(projectRoot, getSqlite());
} catch (err) {
  log(`Migration failed (non-fatal): ${err}`);
}
// ADD HERE: runSymbolsBulkExtractionIfNeeded() call
try {
  await runSymbolsBulkExtractionIfNeeded(projectRoot);
} catch (err) {
  log(`Bulk symbol extraction failed (non-fatal): ${err}`);
}

try {
  await this.buildFileTree(newConfig);  // line 275 — unchanged
  // ...
```

**Error handling in coordinator startup** — non-fatal try/catch with `log()` is the established pattern. Matches `Migration failed (non-fatal)` phrasing at line 270.

**`getAllFiles()` call pattern** — already imported at line 19. Filter for TS/JS extensions:
```typescript
const tsJsExts = new Set(['.ts', '.tsx', '.js', '.jsx']);
const files = getAllFiles().filter(f =>
  !f.isDirectory && tsJsExts.has(path.extname(f.path).toLowerCase())
);
```

**File read pattern** — coordinator uses `fs/promises` (line 1 import). Match with `await fsPromises.readFile(filePath, 'utf-8')`.

---

### `drizzle/0005_add_symbols_and_import_metadata.sql` (migration, CREATE)

**Analog:** `drizzle/0004_add_edge_metadata.sql` (exact match)

**Full content of 0004** — shows the exact format to expect from `drizzle-kit generate`:
```sql
ALTER TABLE `file_dependencies` ADD COLUMN `edge_type` text NOT NULL DEFAULT 'imports';--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `confidence` real NOT NULL DEFAULT 0.8;--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `confidence_source` text NOT NULL DEFAULT 'inferred';--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `weight` integer NOT NULL DEFAULT 1;--> statement-breakpoint
CREATE TABLE `file_communities` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  ...
);--> statement-breakpoint
CREATE INDEX `communities_community_id_idx` ON `file_communities` (`community_id`);
```

**Do NOT hand-write this file.** Run `npx drizzle-kit generate` after updating `src/db/schema.ts`. The generated SQL follows the exact `-->statement-breakpoint` separator format shown above. The expected content is documented in RESEARCH.md §Drizzle Schema Extension.

**`drizzle.config.ts`** (the generator config):
```typescript
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
```
No changes needed to this file. Run `npx drizzle-kit generate` from the repo root.

---

### `scripts/inspect-symbols.mjs` (CLI utility, CREATE)

**Analog:** `scripts/register-mcp.mjs` (exact ESM structure)

**ESM scaffolding pattern** (lines 1–16 of `register-mcp.mjs`):
```javascript
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const SERVER_JS = path.join(REPO_ROOT, 'dist', 'mcp-server.js');
```

**Guard pattern** (lines 25–29 of `register-mcp.mjs`) — check that `dist/` build exists before proceeding:
```javascript
if (!existsSync(SERVER_JS)) {
  console.error(`  ERROR: ${SERVER_JS} not found.`);
  console.error('  Run ./build.sh (or: npm install && npm run build) first.');
  process.exit(1);
}
```

**`inspect-symbols.mjs` scaffold** — apply this pattern:
```javascript
// scripts/inspect-symbols.mjs
// Debugging CLI: parses a single TS/JS file and prints symbol table.
// Requires a prior `npm run build`. Imports from dist/, not src/.
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const PARSER_JS = path.join(REPO_ROOT, 'dist', 'change-detector', 'ast-parser.js');

if (!existsSync(PARSER_JS)) {
  console.error(`ERROR: ${PARSER_JS} not found. Run npm run build first.`);
  process.exit(1);
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: npm run inspect-symbols <path>');
  process.exit(1);
}

const jsonMode = process.argv.includes('--json');
const resolvedPath = path.resolve(filePath);

const { extractRicherEdges } = await import(PARSER_JS);
const source = await fs.readFile(resolvedPath, 'utf-8');
const result = extractRicherEdges(resolvedPath, source);

if (!result) {
  console.error(`No parse result for ${resolvedPath} (unsupported extension or parse error)`);
  process.exit(1);
}

for (const sym of result.symbols) {
  if (jsonMode) {
    console.log(JSON.stringify(sym));
  } else {
    const exp = sym.isExport ? ' [export]' : '';
    console.log(`${sym.name}  ${sym.kind}  L${sym.startLine}-L${sym.endLine}${exp}`);
  }
}
```

**`package.json` scripts entry** — copy the pattern of `"register-mcp": "node scripts/register-mcp.mjs"`:
```json
"inspect-symbols": "node scripts/inspect-symbols.mjs",
"bench-scan": "node scripts/bench-scan.mjs"
```

---

### `scripts/bench-scan.mjs` (CLI utility, CREATE)

**Analog:** `scripts/register-mcp.mjs` (ESM structure) + coordinator test pattern for standalone init

**ESM structure** — identical header to `inspect-symbols.mjs` above (same `__filename`, `REPO_ROOT`, `existsSync` guard, `createRequire` if needed).

**Coordinator import pattern** — imports `dist/coordinator.js` directly:
```javascript
const COORDINATOR_JS = path.join(REPO_ROOT, 'dist', 'coordinator.js');
if (!existsSync(COORDINATOR_JS)) {
  console.error(`ERROR: ${COORDINATOR_JS} not found. Run npm run build first.`);
  process.exit(1);
}
```

**Wall-time measurement pattern** — use `performance.now()` or `Date.now()`:
```javascript
const t0 = Date.now();
// ... operation ...
const elapsed = Date.now() - t0;
```

**`execSync` for git sha** (analogous to `register-mcp.mjs` use of `spawnSync`):
```javascript
import { execSync } from 'node:child_process';
const commitSha = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT })
  .toString().trim();
```

**Output file path** — `.planning/phases/33-symbol-extraction-foundation/baseline.json` relative to `REPO_ROOT`. Write with `fs.writeFileSync` (sync is fine for a one-shot script).

**Baseline JSON schema** (from RESEARCH.md §Benchmark Script):
```json
{
  "captured_at": "2026-04-23T07:31:24.700Z",
  "self_scan_ms": 1234,
  "medium_repo_scan_ms": 5678,
  "file_counts": { "self": 58, "medium_repo": 120 },
  "node_version": "v22.21.1",
  "commit_sha": "abc1234"
}
```

---

### `package.json` (config, MODIFY)

**Analog:** self — `"register-mcp"` script entry (line 17)

**Existing pattern** (line 17):
```json
"register-mcp": "node scripts/register-mcp.mjs"
```

**Add two entries** in the same `scripts` block:
```json
"inspect-symbols": "node scripts/inspect-symbols.mjs",
"bench-scan": "node scripts/bench-scan.mjs"
```

**Build script extension** (line 8) — the `build` script lists every `src/**/*.ts` entry point explicitly. Add new src files if they contain importable exports: `src/db/symbol-types.ts` must be added to the esbuild command since `repository.ts` imports from it. Add it immediately after `src/db/schema.ts`:
```
... src/db/schema.ts src/db/symbol-types.ts src/db/db.ts src/db/repository.ts ...
```

---

### `src/change-detector/ast-parser.symbols.test.ts` (test, CREATE)

**Analog:** `src/change-detector/ast-parser.test.ts` (exact match — same file, same describe/it pattern)

**File header and imports pattern** (lines 1–6 of `ast-parser.test.ts`):
```typescript
// src/change-detector/ast-parser.symbols.test.ts
// Tests for Phase 33 symbol extraction and import-name metadata from extractRicherEdges().
import { describe, it, expect } from 'vitest';
import { extractRicherEdges } from './ast-parser.js';
import type { RicherEdgeData } from './ast-parser.js';
```

**`describe`/`it` pattern** (lines 41–51):
```typescript
describe('extractRicherEdges — exported function symbol', () => {
  it('emits function symbol with name, kind=function, lines, isExport=true', () => {
    const source = `export function foo(a: string): number { return 1; }`;
    const result = extractRicherEdges('/project/foo.ts', source);
    expect(result).not.toBeNull();
    expect(result!.symbols).toHaveLength(1);
    expect(result!.symbols[0].name).toBe('foo');
    expect(result!.symbols[0].kind).toBe('function');
    expect(result!.symbols[0].isExport).toBe(true);
  });
});
```

**Negative-case pattern** (lines 149–158 of `ast-parser.test.ts`):
```typescript
it('does NOT extract import paths from string literals', () => {
  const source = `const msg = "import { X } from './fake.js'";`;
  const snapshot = extractSnapshot('/project/foo.ts', source);
  expect(snapshot!.imports).not.toContain('./fake.js');
});
```
Apply same style for D-05 re-export skip, D-06 anonymous default skip, `export let` skip (Pitfall 2), line-number correctness (Pitfall 3).

**Inline source strings** — all test sources are inline strings (no tmp files), consistent with `ast-parser.test.ts`. No `beforeEach`/`afterEach` needed.

---

### `src/db/repository.symbols.test.ts` (test, CREATE)

**Analog:** `src/db/repository.test.ts` (exact match — DB setup/teardown pattern)

**`beforeEach`/`afterEach` DB setup pattern** (lines 22–50 of `repository.test.ts`):
```typescript
let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-repo-test-'));
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

**Imports pattern** (lines 1–19 of `repository.test.ts`):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { openDatabase, closeDatabase } from './db.js';
import {
  upsertSymbols,
  getSymbolsByName,
  getSymbolsForFile,
  deleteSymbolsForFile,
  getKvState,
  setKvState,
} from './repository.js';
import type { Symbol as SymbolRow } from './symbol-types.js';
```

**Test fixture helper** — copy `makeFile` pattern (lines 28–38) for a `makeSymbol` helper:
```typescript
function makeSymbol(overrides: Partial<SymbolRow> = {}): SymbolRow {
  return {
    name:      'foo',
    kind:      'function',
    startLine: 1,
    endLine:   5,
    isExport:  true,
    ...overrides,
  };
}
```

**`setDependencies` replace-test pattern** (lines 164–175) — copy for `upsertSymbols` replace test:
```typescript
it('replaces old symbols on second upsert (DELETE then INSERT)', () => {
  upsertSymbols('/project/a.ts', [makeSymbol({ name: 'foo' })]);
  upsertSymbols('/project/a.ts', [makeSymbol({ name: 'bar' })]);
  const syms = getSymbolsForFile('/project/a.ts');
  expect(syms).toHaveLength(1);
  expect(syms[0].name).toBe('bar');
  expect(syms).not.toContain(expect.objectContaining({ name: 'foo' }));
});
```

---

## Shared Patterns

### Raw SQL Reads via `getSqlite().prepare().all()`
**Source:** `src/db/repository.ts` lines 210–221 (`getDependenciesWithEdgeMetadata`)
**Apply to:** `getSymbolsByName`, `getSymbolsForFile`, `deleteSymbolsForFile`, `getKvState`, `setKvState`
```typescript
const sqlite = getSqlite();
return sqlite
  .prepare('SELECT ... FROM symbols WHERE ...')
  .all(param) as Array<{ ... }>;
```

### Transaction Pattern (DELETE + bulk INSERT)
**Source:** `src/db/repository.ts` lines 733–747 (`setCommunities`)
**Apply to:** `upsertSymbols`
```typescript
const sqlite = getSqlite();
const tx = sqlite.transaction(() => {
  sqlite.prepare('DELETE FROM table WHERE path = ?').run(path);
  const stmt = sqlite.prepare('INSERT INTO table (...) VALUES (?, ?, ...)');
  for (const item of items) {
    stmt.run(...);
  }
});
tx();
```

### JSON Blob Column Encode/Decode
**Source:** `src/db/repository.ts` lines 462–480 (`setExportsSnapshot`) and lines 448–453 (`getExportsSnapshot`)
**Apply to:** `imported_names` column on `file_dependencies` when writing/reading in `setEdges`
```typescript
// Encode:
JSON.stringify(meta.importedNames)   // → '["useState","useEffect"]'

// Decode:
try {
  return JSON.parse(row.imported_names) as string[];
} catch {
  return [];
}
```

### Non-Fatal Try/Catch in Coordinator Startup
**Source:** `src/coordinator.ts` lines 268–272
**Apply to:** bulk symbol extraction hook in `coordinator.ts`
```typescript
try {
  await runSymbolsBulkExtractionIfNeeded(projectRoot);
} catch (err) {
  log(`Bulk symbol extraction failed (non-fatal): ${err}`);
}
```

### ESM Script File Structure
**Source:** `scripts/register-mcp.mjs` lines 1–16
**Apply to:** `scripts/inspect-symbols.mjs`, `scripts/bench-scan.mjs`
- Use `fileURLToPath(import.meta.url)` for `__filename`
- Use `path.resolve(path.dirname(__filename), '..')` for `REPO_ROOT`
- Guard with `existsSync(DIST_FILE)` before import; exit 1 with helpful message if missing
- Node built-ins use `node:` protocol prefix (`node:fs`, `node:path`, `node:url`, etc.)

### `.js` Extension on Relative Imports (ESM Rule)
**Source:** All files in `src/` uniformly
**Apply to:** All new `.ts` source files
```typescript
import { Symbol } from './symbol-types.js';   // .js not .ts
import type { ImportMeta } from '../change-detector/ast-parser.js';
```

### `log()` for Diagnostics (not console.log/console.error)
**Source:** `src/change-detector/ast-parser.ts` line 10 + usage at line 170
**Apply to:** All new `src/` files (NOT CLI scripts — those use `console.log/error`)
```typescript
import { log } from '../logger.js';
// ...
log(`[ast-parser] tree-sitter parse failed for ${filePath}: ${err}`);
```

---

## No Analog Found

All Phase 33 files have close analogs. No files require falling back to RESEARCH.md patterns exclusively.

---

## Metadata

**Analog search scope:** `src/`, `drizzle/`, `scripts/`, `tests/`
**Files scanned:** 14 source files read directly
**Pattern extraction date:** 2026-04-23

**Key codebase facts confirmed:**
- `extractRicherEdges` returns `RicherEdgeData | null` (line 161 of `ast-parser.ts`) — widen in-place, do not rename
- `setEdges` uses Drizzle ORM `.delete()` + `.insert()` (not a `sqlite.transaction()` wrapper) — lines 321–345 of `repository.ts`
- `setCommunities` uses raw `sqlite.transaction()` — the pattern for `upsertSymbols`
- `schema_version` has no runtime INSERT/SELECT in `src/` — confirmed; `kv_state` is the correct new table
- Migration 0004 uses `-->statement-breakpoint` separators — 0005 will match
- `package.json` `build` script lists every entry point explicitly — `src/db/symbol-types.ts` must be added
- All relative imports use `.js` extension even in `.ts` files
- CLI scripts import from `dist/` not `src/`; guard with `existsSync` before import
