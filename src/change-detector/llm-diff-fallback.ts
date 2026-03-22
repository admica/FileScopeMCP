// src/change-detector/llm-diff-fallback.ts
// LLM job queuing for unsupported languages (CHNG-03).
// When a file change cannot be classified via tree-sitter AST, this module
// queues an async LLM job so Phase 5's LLM pipeline can classify it later.
import { readFileSync } from 'node:fs';
import { getFile } from '../db/repository.js';
import { submitJob } from '../broker/client.js';
import { log } from '../logger.js';
import type { SemanticChangeSummary } from './types.js';

// ~16KB diff limit — prevents oversized payloads in the llm_jobs table.
// Calculated as MAX_DIFF_TOKENS * ~4 bytes/token with GPT-4 token estimates.
const MAX_DIFF_BYTES = 16 * 1024; // 16 384 bytes

/**
 * Queues an LLM diff classification job for a file that cannot be analysed
 * via tree-sitter (e.g., Go, Rust, Python).
 *
 * - Truncates the diff at MAX_DIFF_BYTES with a "[truncated]" suffix
 * - Inserts a row into llm_jobs (job_type='change_impact', priority_tier=2)
 * - Returns a conservative SemanticChangeSummary immediately (no await)
 *
 * The job is intentionally fire-and-forget here — Phase 5 will pick it up
 * asynchronously and update the summary once LLM classification is done.
 */
export function queueLlmDiffJob(filePath: string, diff: string): SemanticChangeSummary {
  // Truncate oversized diffs to avoid DB bloat and LLM context overflow
  const truncatedDiff =
    diff.length > MAX_DIFF_BYTES
      ? diff.slice(0, MAX_DIFF_BYTES) + '... [truncated]'
      : diff;

  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    const importance = getFile(filePath)?.importance ?? 0;
    submitJob(filePath, 'change_impact', importance, fileContent, truncatedDiff);
  } catch (err) {
    // Non-fatal: if file is unreadable or submit fails, log and continue
    log(`[llm-diff-fallback] Failed to queue LLM job for ${filePath}: ${err}`);
  }

  return {
    filePath,
    changeType: 'unknown',
    affectsDependents: true,
    confidence: 'heuristic',
    timestamp: Date.now(),
  };
}
