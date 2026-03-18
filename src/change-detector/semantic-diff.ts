// src/change-detector/semantic-diff.ts
// Compares two ExportSnapshots and produces a SemanticChangeSummary.
// The affectsDependents boolean is the critical output for Phase 4's CascadeEngine.
import type { ExportSnapshot, SemanticChangeSummary } from './types.js';

/**
 * Compares prev and next ExportSnapshots and classifies what semantically changed.
 *
 * Classification buckets:
 * - 'unknown':          No previous snapshot (first parse). Conservative default.
 * - 'body-only':        Exports and imports unchanged. Internal implementation changed.
 * - 'types-changed':    Only type aliases and/or interfaces changed.
 * - 'exports-changed':  Runtime exports (functions, classes, variables) added/removed/changed.
 *
 * affectsDependents = true for exports-changed, types-changed, unknown.
 * affectsDependents = false for body-only.
 */
export function computeSemanticDiff(
  prev: ExportSnapshot | null,
  next: ExportSnapshot,
): SemanticChangeSummary {
  // ─── First-parse case ────────────────────────────────────────────────────
  // No previous snapshot — new file or first scan after Phase 3 deployment.
  // Return conservative "unknown" — Phase 4 will cascade all dependents.
  if (!prev) {
    return {
      filePath: next.filePath,
      changeType: 'unknown',
      affectsDependents: true,
      confidence: 'ast',
      timestamp: Date.now(),
    };
  }

  // ─── Compare exports ─────────────────────────────────────────────────────
  const prevByName = new Map(prev.exports.map(e => [e.name, e]));
  const nextByName = new Map(next.exports.map(e => [e.name, e]));

  const added   = [...nextByName.keys()].filter(n => !prevByName.has(n));
  const removed = [...prevByName.keys()].filter(n => !nextByName.has(n));
  const changed = [...nextByName.keys()].filter(
    n => prevByName.has(n) && prevByName.get(n)!.signature !== nextByName.get(n)!.signature
  );

  // ─── Compare imports ─────────────────────────────────────────────────────
  const importsChanged =
    JSON.stringify([...prev.imports].sort()) !== JSON.stringify([...next.imports].sort());

  // ─── Classify ────────────────────────────────────────────────────────────
  const exportsDiffer = added.length > 0 || removed.length > 0 || changed.length > 0;
  const anythingChanged = exportsDiffer || importsChanged;

  if (!anythingChanged) {
    // API surface is identical — body or comments only changed
    return {
      filePath: next.filePath,
      changeType: 'body-only',
      affectsDependents: false,
      confidence: 'ast',
      timestamp: Date.now(),
    };
  }

  if (importsChanged && !exportsDiffer) {
    // Only imports changed — dependency graph changed, affects dependents
    return {
      filePath: next.filePath,
      changeType: 'exports-changed',
      affectsDependents: true,
      confidence: 'ast',
      timestamp: Date.now(),
    };
  }

  // Gather changed symbol names across all categories
  const changedExports = [...new Set([...added, ...removed, ...changed])];

  // Determine if changes are type-only (type aliases + interfaces) vs. runtime exports
  const onlyTypes = changedExports.every(name => {
    // Check next snapshot first (for added/changed), then prev (for removed)
    const sym = nextByName.get(name) ?? prevByName.get(name);
    return sym?.kind === 'type' || sym?.kind === 'interface';
  });

  const changeType = onlyTypes ? 'types-changed' : 'exports-changed';

  return {
    filePath: next.filePath,
    changeType,
    affectsDependents: true,
    changedExports: changedExports.length > 0 ? changedExports : undefined,
    confidence: 'ast',
    timestamp: Date.now(),
  };
}
