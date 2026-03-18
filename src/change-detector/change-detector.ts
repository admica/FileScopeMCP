// src/change-detector/change-detector.ts
// Public entry point for semantic change classification (CHNG-01, CHNG-03).
//
// For TS/JS files: uses tree-sitter AST extraction + snapshot diffing.
// For all other languages: queues an LLM job for async classification.
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { extractSnapshot, isTreeSitterLanguage } from './ast-parser.js';
import { computeSemanticDiff } from './semantic-diff.js';
import { queueLlmDiffJob } from './llm-diff-fallback.js';
import { getExportsSnapshot, setExportsSnapshot } from '../db/repository.js';
import { log } from '../logger.js';
import type { SemanticChangeSummary } from './types.js';

/**
 * ChangeDetector classifies a file change as one of:
 * - 'body-only'        — internal implementation changed, no cascade needed
 * - 'exports-changed'  — API surface changed, cascade to dependents
 * - 'types-changed'    — only type definitions changed
 * - 'unknown'          — unsupported language or parse error (conservative)
 *
 * Phase 4's CascadeEngine reads the returned SemanticChangeSummary and
 * triggers dependent re-analysis when affectsDependents=true.
 */
export class ChangeDetector {
  constructor(private readonly projectRoot: string) {}

  /**
   * Classify a file change semantically.
   *
   * @param filePath Absolute path to the changed file.
   * @returns SemanticChangeSummary describing the nature of the change.
   */
  async classify(filePath: string): Promise<SemanticChangeSummary> {
    try {
      const ext = path.extname(filePath).toLowerCase();

      if (isTreeSitterLanguage(ext)) {
        return await this._classifyWithAst(filePath);
      } else {
        return await this._classifyWithLlmFallback(filePath);
      }
    } catch (err) {
      log(`[ChangeDetector] Unexpected error classifying ${filePath}: ${err}`);
      return this._unknownSummary(filePath);
    }
  }

  // ─── AST path (TS/JS) ──────────────────────────────────────────────────────

  private async _classifyWithAst(filePath: string): Promise<SemanticChangeSummary> {
    // Read file source
    let source: string;
    try {
      source = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
      log(`[ChangeDetector] Cannot read file ${filePath}: ${err}`);
      return this._unknownSummary(filePath);
    }

    // Extract AST snapshot
    const nextSnapshot = extractSnapshot(filePath, source);
    if (!nextSnapshot) {
      // Parse error — fall back to 'unknown' (conservative)
      log(`[ChangeDetector] AST parse failed for ${filePath}, returning unknown`);
      return this._unknownSummary(filePath);
    }

    // Load previous snapshot from DB
    const prevSnapshot = getExportsSnapshot(filePath);

    // Compute semantic diff
    const summary = computeSemanticDiff(prevSnapshot, nextSnapshot);

    // Persist new snapshot for next comparison
    setExportsSnapshot(filePath, nextSnapshot);

    log(`[ChangeDetector] AST classified ${filePath}: ${summary.changeType} (affectsDependents=${summary.affectsDependents})`);
    return summary;
  }

  // ─── LLM fallback path (non-TS/JS) ────────────────────────────────────────

  private async _classifyWithLlmFallback(filePath: string): Promise<SemanticChangeSummary> {
    // For unsupported languages we do NOT cache content (no schema change needed).
    // The simplest approach: return 'unknown' immediately without queuing an LLM job,
    // since we have no previous version to diff against.
    //
    // Phase 5 can enhance this by storing previous content hashes and generating
    // unified diffs for LLM consumption.
    log(`[ChangeDetector] Unsupported language for ${filePath}, returning heuristic unknown`);
    return {
      filePath,
      changeType: 'unknown',
      affectsDependents: true,
      confidence: 'heuristic',
      timestamp: Date.now(),
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private _unknownSummary(filePath: string): SemanticChangeSummary {
    return {
      filePath,
      changeType: 'unknown',
      affectsDependents: true,
      confidence: 'heuristic',
      timestamp: Date.now(),
    };
  }
}
