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
 * Phase 37 CSE-02 — pre-resolution record emitted by extractRicherEdges()
 * when a call_expression inside a tracked top-level caller is encountered.
 * Resolved into CallSiteEdge by language-config.extractTsJsFileParse().
 */
export interface CallSiteCandidate {
  callerName:       string;   // enclosing function/class/const name (top-level only)
  callerStartLine:  number;   // joining key back to symbol row after upsert
  calleeName:       string;   // raw identifier at the call site
  calleeSpecifier:  string | null;  // import specifier if imported; null = same-file candidate
  callLine:         number;   // 1-indexed source line of the call expression
}

/**
 * Phase 37 CSE-03/04 — resolved call-site edge consumed by
 * setEdgesAndSymbols(). caller_symbol_id / callee_symbol_id are
 * resolved inside the same sqlite.transaction() after upsertSymbols
 * runs (Pitfall 7 / FLAG-02 resolution).
 */
export interface CallSiteEdge {
  callerName:       string;
  callerStartLine:  number;
  calleePath:       string;   // sourcePath for local; import target's absolute path for imported
  calleeName:       string;
  callLine:         number;
  confidence:       number;   // 1.0 local, 0.8 imported
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
