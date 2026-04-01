// src/change-detector/types.ts
// Stable TypeScript interfaces for the semantic change detection system.
// These types are consumed by Phase 4's CascadeEngine (CHNG-02).

/**
 * A single exported symbol from a TypeScript/JavaScript file.
 * Captures the name, kind, and declaration signature (not body).
 */
export interface ExportedSymbol {
  name: string;
  kind: 'function' | 'class' | 'variable' | 'type' | 'interface' | 'enum' | 'default';
  // Declaration signature — the first line/header, not the implementation body.
  // e.g., "export function foo(a: string): number"
  signature: string;
}

/**
 * A snapshot of a file's exported API surface and import dependencies.
 * Stored as a JSON blob in the exports_snapshot column on the files table.
 * On next file change, new snapshot is compared against stored snapshot.
 */
export interface ExportSnapshot {
  filePath: string;
  exports: ExportedSymbol[];
  imports: string[];   // import paths — extracted via AST, not regex
  capturedAt: number;  // ms timestamp
}

/**
 * The result of comparing two ExportSnapshots (or classifying a first-parse).
 * The affectsDependents boolean is the critical field for Phase 4's CascadeEngine.
 */
export interface SemanticChangeSummary {
  filePath: string;
  changeType: 'exports-changed' | 'types-changed' | 'body-only' | 'comments-only' | 'mixed' | 'unknown';
  affectsDependents: boolean;
  changedExports?: string[];
  confidence: 'ast' | 'llm' | 'heuristic';
  timestamp: number;
  /** For non-TS/JS files: the git diff to use as change_impact payload. */
  diff?: string;
}
