// src/db/symbol-types.ts
// Phase 33 SYM-01 / SYM-02 — Symbol type for the `symbols` SQLite table.
//
// Deliberately distinct from `ExportedSymbol` in src/change-detector/types.ts:
//   - ExportedSymbol powers the semantic-diff pipeline (kinds: variable, default, etc.,
//     plus a `signature` field used by exports_snapshot JSON blob).
//   - Symbol powers the find_symbol MCP tool (Phase 34) and stays narrowly scoped:
//     only top-level navigable declarations with line-range info.
// Keeping them separate prevents coupling find_symbol's schema to semantic-diff churn.

export type SymbolKind = 'function' | 'class' | 'interface' | 'type' | 'enum' | 'const' | 'module' | 'struct';

export interface Symbol {
  name:      string;
  kind:      SymbolKind;
  startLine: number;   // 1-indexed source line of the declaration start
  endLine:   number;   // 1-indexed source line of the declaration end
  isExport:  boolean;  // true when wrapped in `export` or `export default`
}
