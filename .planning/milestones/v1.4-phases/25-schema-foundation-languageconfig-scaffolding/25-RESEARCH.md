# Phase 25: Schema Foundation + LanguageConfig Scaffolding - Research

**Researched:** 2026-04-09
**Domain:** SQLite schema migration (drizzle-orm), TypeScript module design, tree-sitter dispatch
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** New drizzle migration file `drizzle/0004_add_edge_metadata.sql` adds edge_type, confidence, confidence_source, and weight columns to file_dependencies. Existing rows get `edge_type = 'imports'`, `confidence = 0.8`, `confidence_source = 'inferred'`, `weight = 1` as defaults.
- **D-02:** `file_communities` table created in the same migration: community_id (integer), file_path (text, FK to files.path), with index on community_id. No data populated yet.
- **D-03:** Update `src/db/schema.ts` in parallel so drizzle-orm types stay in sync with the migration.
- **D-04:** New `src/confidence.ts` module exports named constants: `EXTRACTED = 1.0`, `INFERRED = 0.8`, and their string labels `'extracted'`, `'inferred'`. No extractor uses raw float literals.
- **D-05:** New `src/language-config.ts` module with a `Map<string, LanguageConfig>` keyed by file extension. Each entry holds: grammar loader (nullable), extractor function, and fallback flag.
- **D-06:** TS/JS extensions (.ts, .tsx, .js, .jsx) get tree-sitter AST entries that delegate to existing `ast-parser.ts` extraction plus new edge metadata.
- **D-07:** All other currently-supported extensions (Py, C/C++, Rust, Lua, Zig, PHP, C#, Java, Go, Ruby) get regex fallback entries sourced from the existing `IMPORT_PATTERNS` map and language-specific resolvers.
- **D-08:** Broken grammar loading catches the error and falls back to regex — never crashes the server. Log the failure once, not per-file.
- **D-09:** New `extractEdges(filePath: string, content: string, projectRoot: string): Promise<EdgeResult[]>` in `language-config.ts` replaces the dispatch logic in `analyzeNewFile()`.
- **D-10:** `EdgeResult` type: `{ target: string, edgeType: string, confidence: number, confidenceSource: string, weight: number, isPackage: boolean, packageName?: string, packageVersion?: string }`.
- **D-11:** `analyzeNewFile()` calls `extractEdges()` and maps results to the existing return shape (`dependencies[]` + `packageDependencies[]`) for backward compatibility. Full EdgeResult data flows to a new `setEdges()` repository function.
- **D-12:** Existing `setDependencies()` gains a sibling `setEdges()` that writes edge_type, confidence, confidence_source, weight. `setDependencies()` remains for backward compatibility.

### Claude's Discretion

- Internal naming of helper functions and intermediate types
- Whether to use a class or plain object for LanguageConfig entries
- Test file organization (co-located vs separate test file)

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EDGE-01 | Schema migration adds edge_type, confidence, confidence_score, and weight columns to dependencies table | D-01: migration file pattern confirmed; D-03: schema.ts drizzle type sync; see Migration Pattern section |
| EDGE-02 | Confidence constants module defines EXTRACTED (1.0) and INFERRED (0.8) tiers with numeric scores | D-04: `src/confidence.ts` module; see Confidence Constants section |
| AST-01 | LanguageConfig registry dispatches tree-sitter grammars per file extension via a single generic extractor | D-05 through D-09: language-config.ts registry; see LanguageConfig Registry section |
| AST-06 | Regex fallback extracts import edges for unsupported languages (Zig, Lua, PHP, C#, Java) | D-07: IMPORT_PATTERNS sourced into registry; Go/Ruby special-cased via resolvers; see Regex Fallback section |
</phase_requirements>

## Summary

Phase 25 is a foundation-laying phase: no new user-visible features, but every subsequent phase in v1.4 depends on it being right. The work splits cleanly into three independent tracks that can proceed in parallel once the schema migration is landed: (1) database schema changes, (2) the confidence constants module, and (3) the LanguageConfig registry with its `extractEdges()` integration seam.

The existing codebase has well-established patterns for all three tracks. Migration 0004 follows the `ALTER TABLE ... ADD COLUMN` pattern used in 0001 and 0002, plus a `CREATE TABLE` for file_communities. The LanguageConfig registry is a new module but wraps existing code — `ast-parser.ts`'s `extractSnapshot()` and the `IMPORT_PATTERNS` map in `file-utils.ts` are both already correct and just need to be wired into the new dispatch surface. The integration seam (`analyzeNewFile()` → `extractEdges()`) is the trickiest part because it must preserve the exact return shape that `setDependencies()` and the coordinator both expect.

The grammar fallback pattern for D-08 has a specific implementation constraint: tree-sitter grammars for TS/JS are loaded at module-import time in `ast-parser.ts` (not lazily). Since those grammars are already proven to work (they are in production), the fallback guard exists primarily to protect Phase 26 grammar additions. For Phase 25, the practical concern is that the LanguageConfig entries for TS/JS must not re-attempt grammar loading at runtime — they should delegate directly to the existing parser instances.

**Primary recommendation:** Land the migration first (it is a prerequisite for the Drizzle type updates), then write confidence.ts and language-config.ts as independent modules, then wire them into analyzeNewFile() last.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| drizzle-orm | ^0.45.1 | SQLite ORM + migration runner | Already in use; `migrate()` applies SQL files from `drizzle/` folder automatically on `openDatabase()` |
| better-sqlite3 | ^12.6.2 | Synchronous SQLite driver | Already in use; all repository functions are synchronous |
| tree-sitter | ^0.25.0 | Parser engine | Already in use via `ast-parser.ts` |
| tree-sitter-typescript | ^0.23.2 | TS/TSX grammar | Already loaded at module level in `ast-parser.ts` |
| tree-sitter-javascript | ^0.25.0 | JS/JSX grammar | Already loaded at module level in `ast-parser.ts` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:path | built-in | Extension extraction, path resolution | Extension dispatch in language-config.ts |
| vitest | dev dep | Test runner | Existing test suite; co-located `*.test.ts` files |

**Installation:** No new packages needed. All dependencies are already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── confidence.ts          # NEW: EXTRACTED/INFERRED constants
├── language-config.ts     # NEW: LanguageConfig registry + extractEdges()
├── db/
│   ├── schema.ts          # MODIFY: add edge columns + file_communities table
│   └── repository.ts      # MODIFY: add setEdges() alongside setDependencies()
├── file-utils.ts          # MODIFY: analyzeNewFile() calls extractEdges()
└── change-detector/
    └── ast-parser.ts      # READ-ONLY: existing extractSnapshot() reused
drizzle/
└── 0004_add_edge_metadata.sql  # NEW: migration file
```

### Pattern 1: Drizzle Migration File (ALTER TABLE + CREATE TABLE)

**What:** A `.sql` file with `-->statement-breakpoint` delimiters that drizzle's `migrate()` applies once and tracks in the `__drizzle_migrations` table.

**When to use:** Any schema change. Drizzle checks already-applied migrations by hash, so re-running `openDatabase()` is safe.

**Example (based on existing 0001 and 0002 patterns):**
```sql
-- drizzle/0004_add_edge_metadata.sql
ALTER TABLE `file_dependencies` ADD COLUMN `edge_type` text NOT NULL DEFAULT 'imports';--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `confidence` real NOT NULL DEFAULT 0.8;--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `confidence_source` text NOT NULL DEFAULT 'inferred';--> statement-breakpoint
ALTER TABLE `file_dependencies` ADD COLUMN `weight` integer NOT NULL DEFAULT 1;--> statement-breakpoint
CREATE TABLE `file_communities` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `community_id` integer NOT NULL,
  `file_path` text NOT NULL,
  FOREIGN KEY (`file_path`) REFERENCES `files`(`path`) ON DELETE CASCADE
);--> statement-breakpoint
CREATE INDEX `communities_community_id_idx` ON `file_communities` (`community_id`);
```

**Critical detail:** The `-->statement-breakpoint` delimiter is required between each statement. Drizzle's migration runner splits on this token and executes each statement separately. Missing it causes the entire block to be treated as one statement, which fails for multi-statement files.

**Migration journal:** `drizzle/meta/_journal.json` does NOT need a manual entry. Drizzle's `migrate()` function tracks applied migrations via the `__drizzle_migrations` table in SQLite, not via the journal. The journal is only used by drizzle-kit (the CLI codegen tool) which is not used in this project. Do not edit `_journal.json`.

### Pattern 2: Drizzle Schema Type Sync (schema.ts)

**What:** After adding migration columns, update `src/db/schema.ts` table definitions so TypeScript infers the correct column types for `$inferInsert` and `$inferSelect`.

**When to use:** Every time a migration adds/drops columns.

**Example (file_dependencies new columns):**
```typescript
// Source: existing schema.ts pattern + drizzle-orm/sqlite-core docs
export const file_dependencies = sqliteTable('file_dependencies', {
  // ... existing columns ...
  edge_type:          text('edge_type').notNull().default('imports'),
  confidence:         real('confidence').notNull().default(0.8),
  confidence_source:  text('confidence_source').notNull().default('inferred'),
  weight:             integer('weight').notNull().default(1),
}, (t) => [
  index('dep_source_idx').on(t.source_path),
  index('dep_target_idx').on(t.target_path),
]);
```

**Note on `real` column type:** drizzle-orm/sqlite-core exports `real` for floating-point columns. The import line in `schema.ts` currently reads `import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core'` — `real` must be added to this import.

**file_communities table definition:**
```typescript
export const file_communities = sqliteTable('file_communities', {
  id:           integer('id').primaryKey({ autoIncrement: true }),
  community_id: integer('community_id').notNull(),
  file_path:    text('file_path').notNull(),
}, (t) => [
  index('communities_community_id_idx').on(t.community_id),
]);
```

### Pattern 3: Confidence Constants Module

**What:** Simple module exporting numeric constants and their string labels. Prevents float literal drift across extractors.

**Implementation:**
```typescript
// src/confidence.ts
export const EXTRACTED = 1.0;
export const INFERRED  = 0.8;

export const CONFIDENCE_SOURCE_EXTRACTED = 'extracted' as const;
export const CONFIDENCE_SOURCE_INFERRED  = 'inferred'  as const;

export type ConfidenceSource = typeof CONFIDENCE_SOURCE_EXTRACTED | typeof CONFIDENCE_SOURCE_INFERRED;
```

**Why `as const`:** Enables TypeScript to narrow the type to a string literal instead of `string`, which lets `setEdges()` in repository.ts accept a typed `confidenceSource` parameter without requiring a union type import.

### Pattern 4: LanguageConfig Registry

**What:** A `Map<string, LanguageConfig>` keyed by file extension. Each entry is a plain object (not a class — simpler for this use case) with a nullable grammar loader, an extractor function, and a boolean fallback flag.

**Interface design:**
```typescript
// src/language-config.ts
import type { PackageDependency } from './types.js';
import type { ConfidenceSource } from './confidence.js';

export interface EdgeResult {
  target: string;
  edgeType: string;
  confidence: number;
  confidenceSource: ConfidenceSource;
  weight: number;
  isPackage: boolean;
  packageName?: string;
  packageVersion?: string;
}

interface LanguageConfig {
  // Nullable: TS/JS grammars are loaded at ast-parser.ts import time;
  // Phase 26 grammars will use a loader function here.
  grammarLoader: (() => unknown) | null;
  // Whether this entry uses regex fallback (true) or AST (false)
  usesRegexFallback: boolean;
  // The extractor function for this extension
  extract: (filePath: string, content: string, projectRoot: string) => Promise<EdgeResult[]>;
}
```

**Registry initialization (Phase 25 scope):**
```typescript
const registry = new Map<string, LanguageConfig>();

// TS/JS: delegate to existing ast-parser.ts
for (const ext of ['.ts', '.tsx', '.js', '.jsx']) {
  registry.set(ext, {
    grammarLoader: null,        // grammars already loaded in ast-parser.ts module scope
    usesRegexFallback: false,
    extract: extractTsJsEdges,  // wraps extractSnapshot() from ast-parser.ts
  });
}

// Go and Ruby: delegate to their specialized resolvers
registry.set('.go', { grammarLoader: null, usesRegexFallback: true, extract: extractGoEdges });
registry.set('.rb', { grammarLoader: null, usesRegexFallback: true, extract: extractRubyEdges });

// All IMPORT_PATTERNS languages: generic regex extractor
for (const ext of Object.keys(IMPORT_PATTERNS)) {
  registry.set(ext, { grammarLoader: null, usesRegexFallback: true, extract: buildRegexExtractor(ext) });
}
```

**`extractEdges()` public function:**
```typescript
export async function extractEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  const ext = path.extname(filePath).toLowerCase();
  const config = registry.get(ext);
  if (!config) return [];  // unsupported extension — no edges
  return config.extract(filePath, content, projectRoot);
}
```

### Pattern 5: Grammar Fallback Guard (D-08)

**What:** In Phase 25, the only grammars are TS/JS which are already proven. The guard matters for Phase 26. But the registry structure must be ready. Implement the guard pattern now so Phase 26 just adds entries.

**How:** For entries where `grammarLoader` is non-null (Phase 26+), wrap the grammar load in try/catch at registry initialization time, not per-call:

```typescript
function buildAstExtractor(loadGrammar: () => unknown, regexFallback: (f:string,c:string,r:string) => Promise<EdgeResult[]>) {
  let grammarFailed = false;
  return async (filePath: string, content: string, projectRoot: string): Promise<EdgeResult[]> => {
    if (grammarFailed) return regexFallback(filePath, content, projectRoot);
    try {
      // use grammar ...
    } catch (err) {
      log(`[language-config] Grammar load failed for ${path.extname(filePath)}: ${err}. Falling back to regex.`);
      grammarFailed = true;  // log once, fallback permanently for this process lifetime
      return regexFallback(filePath, content, projectRoot);
    }
  };
}
```

**For Phase 25 TS/JS entries:** `grammarLoader` is `null` and `grammarFailed` guard is not needed — `extractSnapshot()` from `ast-parser.ts` already handles parse failures by returning `null`. Map `null` snapshot → empty edge list.

### Pattern 6: setEdges() in repository.ts

**What:** New function alongside `setDependencies()` that writes enriched edge rows with the new columns. `setDependencies()` remains unchanged — callers that haven't migrated yet continue to work.

**Implementation approach:**
```typescript
export function setEdges(sourcePath: string, edges: EdgeResult[]): void {
  const db = getDb();
  db.delete(file_dependencies)
    .where(eq(file_dependencies.source_path, sourcePath))
    .run();

  for (const edge of edges) {
    db.insert(file_dependencies).values({
      source_path:       sourcePath,
      target_path:       edge.target,
      dependency_type:   edge.isPackage ? 'package_import' : 'local_import',
      package_name:      edge.packageName ?? null,
      package_version:   edge.packageVersion ?? null,
      is_dev_dependency: null,
      edge_type:         edge.edgeType,
      confidence:        edge.confidence,
      confidence_source: edge.confidenceSource,
      weight:            edge.weight,
    }).run();
  }
}
```

**Import requirement:** `EdgeResult` is defined in `language-config.ts`, so `repository.ts` will need to import it. Watch for circular imports: `repository.ts` → `language-config.ts` is fine; `language-config.ts` must NOT import from `repository.ts`.

### Pattern 7: analyzeNewFile() Integration Seam

**What:** `analyzeNewFile()` in `file-utils.ts` is the incremental-update path (called from `updateFileNodeOnChange()` and `addFileNode()`). The bulk-scan path is in `coordinator.ts` around line 729. D-09 targets `analyzeNewFile()`. The coordinator.ts bulk path should also be updated but is technically in scope for the same phase since AST-06 requires all currently-supported languages to work.

**Callers of `analyzeNewFile()`:**
- `file-utils.ts:1011` — inside `updateFileNodeOnChange()`
- `file-utils.ts:1160` — inside the add-file path

**Updated shape (backward compatible):**
```typescript
async function analyzeNewFile(filePath: string, projectRoot: string): Promise<{ dependencies: string[]; packageDependencies: PackageDependency[] }> {
  const content = await fsPromises.readFile(filePath, 'utf-8');
  const edges = await extractEdges(filePath, content, projectRoot);

  const dependencies = edges
    .filter(e => !e.isPackage)
    .map(e => e.target);

  const packageDependencies = edges
    .filter(e => e.isPackage)
    .map(e => {
      const pkg = new PackageDependency();
      pkg.name = e.packageName ?? '';
      pkg.version = e.packageVersion;
      pkg.path = e.target;
      return pkg;
    });

  return { dependencies, packageDependencies };
}
```

**Note:** The callers of `analyzeNewFile()` currently call `setDependencies()` separately after the return. For Phase 25, we also need `setEdges()` to be called. The simplest approach: call both in the same call sites, or have `analyzeNewFile()` return edges alongside the legacy shape so the caller can invoke `setEdges()`.

### Anti-Patterns to Avoid

- **Don't edit `drizzle/meta/_journal.json`:** Drizzle's runtime migrator tracks applied migrations via `__drizzle_migrations` table in SQLite. The journal file is only used by drizzle-kit CLI (not used in this project). Editing it manually will corrupt the codegen state and has no effect on runtime migration.
- **Don't use `real` SQLite type as `integer` in schema.ts:** Confidence is a float (0.8, 1.0). Use `real()` column type, not `integer()`. SQLite stores both but drizzle TypeScript types will be wrong if you use `integer`.
- **Don't import `language-config.ts` from `repository.ts` for `EdgeResult`:** This creates a cross-layer dependency. Define `EdgeResult` in a shared location (either `language-config.ts` exported as a plain type, or in `types.ts`) and import from there.
- **Don't reset `grammarFailed` per call:** The fallback guard must be permanent within a process lifetime (D-08: "log once, not per-file"). Using a `let` closed over in the extractor closure achieves this.
- **Don't call `extractSnapshot()` for non-TS/JS extensions inside language-config.ts:** `extractSnapshot()` dispatches via `getParser()` which returns `null` for unknown extensions and returns `null` from `extractSnapshot()`. That null check in language-config.ts creates confusion. Keep TS/JS and regex paths strictly separated.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SQLite migration tracking | Custom migration version table | `drizzle-orm/better-sqlite3/migrator` `migrate()` | Already integrated in `db.ts`; handles idempotency automatically |
| Tree-sitter import extraction for TS/JS | New AST walker | `extractSnapshot()` from `ast-parser.ts` | Already handles ES6 imports, re-exports, require(), dynamic import(), template literal filtering |
| Regex import extraction | New regex engine | `IMPORT_PATTERNS` map + existing resolution logic in file-utils.ts | Covers 12 extensions; Go/Ruby have specialized resolvers already |
| Grammar ABI error handling | Complex version checking | Simple `try/catch` with `grammarFailed` flag | ABI mismatch throws synchronously at `setLanguage()` — a plain catch is sufficient |

**Key insight:** Phase 25 is almost entirely assembly work — the raw materials (grammars, regexes, resolvers) already exist. The phase's value is the clean dispatch interface (`extractEdges()`), not new extraction logic.

## Common Pitfalls

### Pitfall 1: Missing `-->statement-breakpoint` Delimiter
**What goes wrong:** Drizzle's migrator fails to execute the migration, or executes only part of it silently.
**Why it happens:** The delimiter must appear between every statement. Forgetting it after one of the `ALTER TABLE` statements causes the remaining SQL to be treated as part of the prior statement.
**How to avoid:** Each SQL statement in the migration file must end with `;--> statement-breakpoint` (except the very last statement). Check existing migrations 0001 and 0002 as reference.
**Warning signs:** `openDatabase()` throws `SqliteError: near "CREATE": syntax error` or similar.

### Pitfall 2: `real` vs `integer` Column Type in schema.ts
**What goes wrong:** Drizzle infers TypeScript type as `number` correctly for both, but SQLite stores differently. More importantly, the `real()` type must be imported from `drizzle-orm/sqlite-core` (it is not in the current import list in schema.ts).
**Why it happens:** The current schema.ts import is `import { sqliteTable, text, integer, index }` — `real` is missing.
**How to avoid:** Add `real` to the import at the top of schema.ts.
**Warning signs:** TypeScript error `Cannot find name 'real'` at compile time.

### Pitfall 3: analyzeNewFile() Callers Not Calling setEdges()
**What goes wrong:** Edge metadata columns (confidence, edge_type, etc.) are never written; all existing edges written after the migration have NULL values in the new columns (they default to inferred/0.8, so it is not a crash, but confidence data is lost for new edges).
**Why it happens:** `analyzeNewFile()` currently returns `{ dependencies, packageDependencies }` and the caller invokes `setDependencies()`. If `setEdges()` is added but callers are not updated, the enriched data is discarded.
**How to avoid:** Update both call sites at `file-utils.ts:1011` and `file-utils.ts:1160` (and the coordinator.ts bulk path at line 832) to call `setEdges()` instead of (or in addition to) `setDependencies()`.
**Warning signs:** Query on `file_dependencies` after analysis shows `confidence = 0.8` for all rows including TS/JS files (which should show `confidence = 1.0` as EXTRACTED).

### Pitfall 4: Duplicate Edge Rows
**What goes wrong:** If `setEdges()` is called AND `setDependencies()` is also called for the same source file, both delete-and-reinsert. Since both functions start with `DELETE WHERE source_path = ?`, the second call wipes what the first wrote. This is actually safe (no duplicate rows), but if `setDependencies()` is called second, the enriched edge columns are lost (it doesn't write them).
**Why it happens:** The call sites currently call `setDependencies()`. Adding `setEdges()` without removing the old call is tempting for "backward compatibility" but produces incorrect results.
**How to avoid:** At each call site, switch from `setDependencies()` to `setEdges()` as the primary writer. Keep `setDependencies()` in the repository for any callers that haven't been migrated yet (e.g., `file-utils.ts:1071` — the removal path that writes an empty dep list).
**Warning signs:** Confidence values are 0.8 even for TS/JS files after the phase is complete.

### Pitfall 5: Go/Ruby Not Covered in language-config.ts Registry
**What goes wrong:** The registry covers `IMPORT_PATTERNS` extensions and TS/JS. Go (`.go`) and Ruby (`.rb`) have their own specialized resolvers (`resolveGoImports`, `resolveRubyImports`) but are NOT in `IMPORT_PATTERNS`. If they are omitted from the registry, `extractEdges()` returns `[]` for Go/Ruby files.
**Why it happens:** Go and Ruby were handled as special cases (separate `else if` branches) in `analyzeNewFile()` rather than via `IMPORT_PATTERNS`. It is easy to miss them when iterating `Object.keys(IMPORT_PATTERNS)` to build the registry.
**How to avoid:** Explicitly add `.go` and `.rb` entries to the registry with their specialized extractors.
**Warning signs:** Go and Ruby files show zero dependencies after the phase lands; existing test suite for those languages regresses.

### Pitfall 6: Circular Import Between language-config.ts and repository.ts
**What goes wrong:** TypeScript compilation fails with circular dependency error, or types resolve to `any`.
**Why it happens:** If `repository.ts` imports `EdgeResult` from `language-config.ts` and `language-config.ts` imports anything from `repository.ts` (e.g., to check dependencies), the cycle is created.
**How to avoid:** `EdgeResult` type can be defined in `language-config.ts` and only imported from there by `repository.ts`. `language-config.ts` must not import from `repository.ts` — the dependency arrow is one-directional: `repository.ts` → `language-config.ts`.

## Code Examples

### Migration Column Addition Pattern (from existing migrations)
```sql
-- Source: drizzle/0001_add_exports_snapshot.sql (verified in codebase)
ALTER TABLE `files` ADD COLUMN `exports_snapshot` text;--> statement-breakpoint
ALTER TABLE `llm_jobs` ADD COLUMN `payload` text;
```

### Drizzle schema.ts Column Definitions (from existing schema.ts)
```typescript
// Source: src/db/schema.ts (verified in codebase)
// Integer column:
is_dev_dependency: integer('is_dev_dependency', { mode: 'boolean' }),
// Text column with enum constraint:
dependency_type: text('dependency_type', { enum: ['local_import', 'package_import'] }).notNull(),
// Real column — NOT currently in schema.ts but is a standard drizzle-orm/sqlite-core type:
// confidence: real('confidence').notNull().default(0.8),
```

### TS/JS Extractor Wrapper (wrapping existing extractSnapshot)
```typescript
// Source: src/change-detector/ast-parser.ts extractSnapshot() return shape (verified)
// extractSnapshot() returns: { filePath, exports, imports: string[], capturedAt }
// 'imports' is raw import specifiers (e.g., './foo', 'react')
// These need resolveImportPath() to become absolute paths (same as analyzeNewFile() currently does)

async function extractTsJsEdges(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<EdgeResult[]> {
  const snapshot = extractSnapshot(filePath, content);
  if (!snapshot) return [];
  const edges: EdgeResult[] = [];
  for (const importSpecifier of snapshot.imports) {
    if (isUnresolvedTemplateLiteral(importSpecifier)) continue;
    // ... resolve and classify, then push EdgeResult with confidence: EXTRACTED
  }
  return edges;
}
```

### setDependencies() Pattern to Replicate in setEdges()
```typescript
// Source: src/db/repository.ts setDependencies() (verified in codebase)
// Pattern: delete-then-reinsert for the source file
db.delete(file_dependencies)
  .where(eq(file_dependencies.source_path, sourcePath))
  .run();
// Then insert each row with db.insert(file_dependencies).values({...}).run()
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Flat dep list (source→target only) | Enriched edge rows with type/confidence/weight | Phase 25 (this phase) | Enables trust-weighted dependency queries in Phase 28 |
| `analyzeNewFile()` with inline dispatch logic | `extractEdges()` via LanguageConfig registry | Phase 25 (this phase) | Phase 26 adds new languages by adding registry entries only |
| Raw float literals for confidence (e.g., `0.8`) | Named constants `INFERRED`/`EXTRACTED` | Phase 25 (this phase) | Prevents drift; all extractors use the same values |

**No deprecated items for Phase 25.** `setDependencies()` is retained (not deprecated) for backward compatibility during the v1.4 transition.

## Open Questions

1. **coordinator.ts bulk-scan path (lines 729-832)**
   - What we know: The bulk-scan path in `coordinator.ts` performs the same dispatch logic as `analyzeNewFile()` and calls `setDependencies()` at line 832.
   - What's unclear: Should it also be updated to call `extractEdges()` + `setEdges()` in Phase 25, or deferred to Phase 26?
   - Recommendation: Include it. AST-06 says "all currently-supported languages produce the same dependency results as before through the regex fallback path." That success criterion applies to both the incremental and bulk paths. If the bulk path is not updated, existing files analyzed during a full scan won't have enriched edge metadata.

2. **`file-utils.ts:1071` — removal path calls `setDependencies()` with empty arrays**
   - What we know: When a file is removed, `setDependencies(path, [], [])` is called to clear its edges.
   - What's unclear: Does `setEdges()` need to handle the empty-array case as a "clear" operation?
   - Recommendation: Yes, `setEdges()` with an empty array is valid and correct — the delete step runs with no inserts following it. This effectively clears the file's edges. Update the removal call site to use `setEdges(path, [])`.

## Sources

### Primary (HIGH confidence)
- Direct inspection of `src/db/schema.ts` — current table definitions, column types, index pattern
- Direct inspection of `src/db/repository.ts` — `setDependencies()` delete-then-reinsert pattern, `getDb()` usage
- Direct inspection of `drizzle/0001_add_exports_snapshot.sql` and `0002_add_llm_columns.sql` — verified `-->statement-breakpoint` delimiter format
- Direct inspection of `drizzle/meta/_journal.json` — confirmed journal is NOT runtime-managed (only drizzle-kit concern)
- Direct inspection of `src/db/db.ts` — confirmed `migrate()` runs from `drizzle/` folder at `openDatabase()` time
- Direct inspection of `src/change-detector/ast-parser.ts` — verified `extractSnapshot()` signature, `isTreeSitterLanguage()`, parser instantiation at module scope
- Direct inspection of `src/file-utils.ts` lines 82-97 — verified `IMPORT_PATTERNS` map (12 extensions, no `.go`/`.rb`)
- Direct inspection of `src/file-utils.ts` lines 846-974 — verified `analyzeNewFile()` full dispatch chain including Go/Ruby special cases
- Direct inspection of `src/coordinator.ts` lines 729-832 — verified duplicate dispatch logic in bulk-scan path

### Secondary (MEDIUM confidence)
- drizzle-orm/sqlite-core `real` column type — standard type, verified by checking drizzle SQLite docs URL referenced in schema.ts header (`https://orm.drizzle.team/docs/column-types/sqlite`)

## Metadata

**Confidence breakdown:**
- Schema migration pattern: HIGH — verified from 4 existing migration files and db.ts migration runner
- Drizzle schema.ts sync: HIGH — verified from existing schema.ts patterns; `real` type is standard drizzle-orm
- Confidence constants module: HIGH — trivial module, no external dependencies
- LanguageConfig registry design: HIGH — all constituent pieces (IMPORT_PATTERNS, extractSnapshot, resolvers) verified in source
- Integration seam (analyzeNewFile + setEdges): HIGH — both call sites verified, return shape verified
- Pitfall about journal.json: HIGH — verified journal only has entries 0-3, migrate() uses SQLite table not JSON
- Go/Ruby omission pitfall: HIGH — verified Go and Ruby are NOT in IMPORT_PATTERNS (separate else-if branches)

**Research date:** 2026-04-09
**Valid until:** 2026-05-09 (stable domain; no fast-moving external dependencies)
