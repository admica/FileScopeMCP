// src/change-detector/llm-diff-fallback.ts
// LLM diff preparation for unsupported languages (CHNG-03).
// When a file change cannot be classified via tree-sitter AST, this module
// returns the git diff in the SemanticChangeSummary so cascadeStale can
// submit a single change_impact job with the real diff as payload.
import type { SemanticChangeSummary } from './types.js';

// ~16KB diff limit — prevents oversized payloads sent to the LLM broker.
const MAX_DIFF_BYTES = 16 * 1024;

/**
 * Prepares a conservative SemanticChangeSummary for a file that cannot be
 * analysed via tree-sitter (e.g., Go, Rust, Python, C++).
 *
 * Returns the git diff in the `diff` field so the coordinator can pass it
 * through changeContext.directPayload to cascadeStale — making cascadeStale
 * the single submission point for change_impact jobs.
 */
export function queueLlmDiffJob(filePath: string, diff: string): SemanticChangeSummary {
  const truncatedDiff =
    diff.length > MAX_DIFF_BYTES
      ? diff.slice(0, MAX_DIFF_BYTES) + '... [truncated]'
      : diff;

  return {
    filePath,
    changeType: 'unknown',
    affectsDependents: true,
    confidence: 'heuristic',
    timestamp: Date.now(),
    diff: truncatedDiff,
  };
}
