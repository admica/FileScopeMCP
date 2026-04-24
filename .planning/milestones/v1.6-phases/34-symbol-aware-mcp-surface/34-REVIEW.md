---
phase: 34-symbol-aware-mcp-surface
reviewed: 2026-04-23T17:45:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - scripts/check-find-symbol-desc-len.mjs
  - src/db/repository.symbols.test.ts
  - src/db/repository.ts
  - src/mcp-server.ts
  - tests/unit/file-summary-enrichment.test.ts
  - tests/unit/find-symbol.test.ts
  - tests/unit/schema-coercion.test.ts
  - tests/unit/tool-outputs.test.ts
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
status: issues_found
---

# Phase 34: Code Review Report

**Reviewed:** 2026-04-23T17:45:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found (info-only — no Critical or Warning findings)

## Summary

Reviewed Phase 34's symbol-aware MCP surface: the new `find_symbol` tool, `get_file_summary` enrichment (exports + rich dependents), the `findSymbols` GLOB-based repository helper, and the `getDependentsWithImports` aggregator.

**Security:** Both new repository helpers use parameterized queries exclusively. The `findSymbols` WHERE clause is built from a fixed array of literal SQL fragments (`'name = ?'` / `'name GLOB ?'`, `'kind = ?'`, `'is_export = 1'`); the only string interpolated into the SQL is this fragment list joined with `' AND '`. No user input is ever concatenated into SQL. GLOB metacharacters in user-supplied names are escaped via `escapeGlobMeta` before being passed as a parameter.

**JSON safety:** `getDependentsWithImports` correctly handles the `imported_names` column with three layers of defense: NULL-check, `try/catch` around `JSON.parse`, and `Array.isArray` + per-element `typeof === 'string'` validation. Matches the `getExportsSnapshot` pattern at `repository.ts:545`.

**Input validation:** The `find_symbol` Zod schema clamps `maxItems` at the handler level via `Math.max(1, Math.min(500, maxItems ?? 50))`. Non-numeric and fractional values are rejected by Zod's `coerce.number().int()` before reaching the handler; negatives and oversized values are clamped. Tested across `find-symbol.test.ts` "maxItems clamp" describe block.

**Tool description:** 1197 chars, well under the 2000-char threshold enforced by `scripts/check-find-symbol-desc-len.mjs`. Description accurately reflects all 7 D-20 facts (exact/prefix matching, kind filter, exportedOnly default, maxItems clamp, response shape, when-to-use guidance, error semantics).

**Test coverage:** Exemplary. `repository.symbols.test.ts` covers all eight `findSymbols` scenarios plus seven `getDependentsWithImports` scenarios including NULL coercion, namespace imports, and package_import exclusion. `find-symbol.test.ts` simulates the handler-layer projection so tests assert on the exact shape agents see. `tool-outputs.test.ts` adds contract tests for the response envelope (truncated key absent on full match, present when truncated).

The four findings below are all Info-level — code-quality observations and minor robustness suggestions that do not affect correctness.

## Info

### IN-01: `kind` Zod schema accepts arbitrary string instead of constrained enum

**File:** `src/mcp-server.ts:346`
**Issue:** The `kind` input is declared as `z.string().optional()`, so any string reaches the handler. The handler then casts `kind as SymbolKind | undefined` (line 362) and passes it to SQL, which silently returns 0 rows for unknown kinds (D-06 documented behavior). While this is intentional per the plan, the schema could surface the valid enum to MCP clients via `z.enum([...])`, giving better tooling completion and self-documentation. The existing `unknown kind returns empty` tests would still pass since SQL would still return 0 rows for any value the enum somehow lets through.

**Fix:** Either keep current behavior (it is documented and tested) or tighten the schema:
```typescript
kind: z.enum(['function', 'class', 'interface', 'type', 'enum', 'const'])
  .optional()
  .describe("function | class | interface | type | enum | const"),
```
With the enum, the cast at line 362 (`kind as SymbolKind | undefined`) becomes safe by construction. Trade-off: a typo from the agent surfaces as a Zod validation error instead of silently empty results. The plan chose the latter intentionally — keep current behavior unless agent UX surveys suggest otherwise.

### IN-02: `findSymbols` runs two SQL statements where one window-function query could suffice

**File:** `src/db/repository.ts:1006-1041`
**Issue:** `findSymbols` issues two prepared statements against the same connection: a `COUNT(*)` and a `SELECT ... LIMIT`. Both statements are re-prepared on every call (no statement caching at this layer). For `find_symbol` workloads this is negligible, but the shape diverges from `searchFiles` at line 700 which uses a single `LIMIT @limit` query with `maxItems + 1` to detect truncation in one round-trip.

**Fix:** Optional refactor — adopt the `LIMIT @limit + 1` pattern used by `searchFiles`:
```typescript
const rows = sqlite.prepare(
  `SELECT path, name, kind, start_line, end_line, is_export
   FROM symbols
   WHERE ${whereSQL}
   ORDER BY is_export DESC, path ASC, start_line ASC
   LIMIT ?`
).all(...params, opts.limit + 1) as SymbolDbRow[];
const truncated = rows.length > opts.limit;
const items = (truncated ? rows.slice(0, opts.limit) : rows).map(rowToSymbol);
// total is unknown without COUNT — would change the contract
```
**Important caveat:** Adopting this pattern would lose the pre-truncation `total` count, which is part of the documented response contract (D-07 — total is pre-LIMIT). Callers and three test cases (`tool-outputs.test.ts` "includes truncated: true when items.length < total", `find-symbol.test.ts` "default 50 when undefined" expects `total: 60`, etc.) rely on the exact pre-truncation count. **Do not adopt this change** unless the contract is explicitly relaxed. Filed as Info purely for visibility — current two-query implementation is correct and matches the contract.

### IN-03: `getDependentsWithImports` swallows malformed JSON silently with no log

**File:** `src/db/repository.ts:283-285`
**Issue:** The `try/catch` around `JSON.parse(r.imported_names)` silently treats corrupt JSON as `[]`. This matches `getExportsSnapshot:545-549` semantics (good consistency), but a corrupt `imported_names` value indicates a writer bug (since the column is only written via `JSON.stringify(meta.importedNames)` at `setEdges:421`). A silent swallow makes such bugs invisible.

**Fix:** Add a one-line debug log so corruption is observable in `~/.filescope/mcp-server.log` without changing user-visible behavior:
```typescript
} catch (err) {
  log(`getDependentsWithImports: corrupt imported_names JSON for source=${r.source_path}: ${(err as Error).message}`);
  /* corrupt JSON — treat as empty; do not throw */
}
```
This requires importing `log` from `../logger.js`. Low priority — corruption is unlikely in practice since the writer is single-source.

### IN-04: Two near-identical Zod-schema regexes in tests will silently mismatch on multi-brace inputSchemas

**File:** `tests/unit/schema-coercion.test.ts:17, 30, 40, 50, 60, 70`
**Issue:** Each test uses `inputSchema:\s*\{([\s\S]*?)\}` (non-greedy, capture until first `}`). This works today because no input schema in `mcp-server.ts` contains nested braces inside its `inputSchema:` literal. If a future tool adds e.g. `default: () => ({ x: 1 })` inside an inputSchema, the regex will capture the wrong region and the assertion will fail in a confusing way (`expected to match` rather than indicating the regex truncated early). Same fragility applies to `check-find-symbol-desc-len.mjs:8` for the `description: [...].join` extraction.

**Fix:** Optional — make the test regex anchored on a sentinel that always closes the inputSchema block, e.g. `inputSchema:\s*\{([\s\S]*?)\},\s*\n\s*annotations:` so it matches up to the next `annotations` key. The current fragility only matters once a contributor adds nested braces, but the failure mode is non-obvious. Lowest priority — file under "robustness" rather than "bug".

---

_Reviewed: 2026-04-23T17:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
