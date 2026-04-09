# Phase 25: Schema Foundation + LanguageConfig Scaffolding - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md -- this log preserves the alternatives considered.

**Date:** 2026-04-09
**Phase:** 25-schema-foundation-languageconfig-scaffolding
**Areas discussed:** Schema migration approach, LanguageConfig registry design, Edge extraction interface, Integration seam
**Mode:** --auto (all decisions auto-selected by Claude as target user of MCP server)

---

## Schema Migration Approach

| Option | Description | Selected |
|--------|-------------|----------|
| New drizzle migration file (0004) | Follows established pattern, ALTER TABLE + defaults for existing rows | Y |
| Modify schema.ts only | Would require drizzle-kit generate step, less predictable | |
| Raw SQL migration (no drizzle) | Breaks the drizzle migration chain | |

**User's choice:** New drizzle migration file (0004_add_edge_metadata.sql)
**Notes:** Project has 4 existing migrations in drizzle/ folder. Sequential numbering is the established pattern. Schema.ts updated in parallel for type sync.

---

## LanguageConfig Registry Design

| Option | Description | Selected |
|--------|-------------|----------|
| New src/language-config.ts module | Dedicated module, Map<ext, LanguageConfig>, clean separation | Y |
| Extend ast-parser.ts | Keeps extraction together but conflates TS/JS-specific code with generic dispatch | |
| Add registry to file-utils.ts | Avoids new file but file-utils.ts is already 1395 lines | |

**User's choice:** New src/language-config.ts module
**Notes:** ast-parser.ts is specifically for TS/JS tree-sitter export/import extraction (change detection). The registry is a broader concept. Dedicated module is cleaner and easier to extend in Phase 26.

---

## Edge Extraction Interface

| Option | Description | Selected |
|--------|-------------|----------|
| New EdgeResult type | Clean type with all metadata fields, returned from extractEdges() | Y |
| Extend existing return type | Add fields to { dependencies[], packageDependencies[] } | |
| Tuple-based return | Less readable, harder to extend | |

**User's choice:** New EdgeResult type with target, edgeType, confidence, confidenceSource, weight, isPackage fields
**Notes:** Existing return type is a flat string array for dependencies -- adding metadata to it would be awkward. New type is self-documenting and carries all the richness needed.

---

## Integration Seam

| Option | Description | Selected |
|--------|-------------|----------|
| New extractEdges() replaces dispatch in analyzeNewFile | Minimal change, clean seam, analyzeNewFile calls extractEdges | Y |
| Rewrite analyzeNewFile entirely | Larger blast radius than needed for Phase 25 | |
| Keep dispatch in analyzeNewFile, just add metadata | Doesn't clean up the if/else chain | |

**User's choice:** New extractEdges() function in language-config.ts replaces dispatch logic
**Notes:** analyzeNewFile() keeps its signature for backward compat but delegates dispatch to extractEdges(). New setEdges() repository function writes the enriched columns.

---

## Claude's Discretion

- Internal naming of helper functions and intermediate types
- Whether to use a class or plain object for LanguageConfig entries
- Test file organization

## Deferred Ideas

None -- discussion stayed within phase scope.
