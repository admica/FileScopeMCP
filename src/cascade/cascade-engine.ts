// src/cascade/cascade-engine.ts
// CascadeEngine — BFS staleness propagation through the dependency graph.
// When Phase 3's ChangeDetector flags an API surface change, this module
// ensures staleness propagates to all transitive dependents so Phase 5
// can regenerate their summaries and concepts.
import { readFileSync } from 'node:fs';
import { getDependents, markStale, getFile } from '../db/repository.js';
import { submitJob } from '../broker/client.js';
import { getSqlite } from '../db/db.js';
import { log } from '../logger.js';

const MAX_CASCADE_DEPTH = 10;

// 14KB content limit for dependent file payloads.
// Leaves room for the header text within the 16KB LLM job payload limit.
const MAX_DEP_CONTENT_BYTES = 14 * 1024;

/**
 * Context about the originally changed file, passed to cascadeStale so it can
 * build meaningful payloads for change_impact jobs on all cascade-visited files.
 */
interface ChangeContext {
  /** Payload for the root changed file's change_impact job (e.g., the git diff). */
  directPayload: string;
  /** From SemanticChangeSummary.changeType — describes the kind of change. */
  changeType: string;
  /** Path of the originally changed file (used in dependent payloads). */
  changedFilePath: string;
}

/**
 * Builds a payload for a cascade-dependent file's change_impact job.
 * Includes upstream change info plus the dependent file's own content
 * so the LLM has both "what changed upstream" and "what does this file do".
 *
 * File content is truncated at MAX_DEP_CONTENT_BYTES to stay within the
 * 16KB LLM job payload limit (header text is added on top of content).
 */
function buildDependentPayload(changeContext: ChangeContext, dependentFilePath: string): string {
  let content: string;
  try {
    content = readFileSync(dependentFilePath, 'utf-8');
    if (content.length > MAX_DEP_CONTENT_BYTES) {
      content = content.slice(0, MAX_DEP_CONTENT_BYTES) + '... [truncated]';
    }
  } catch {
    content = '[file content unavailable]';
  }

  return [
    `[upstream change: ${changeContext.changedFilePath} (${changeContext.changeType})]`,
    `[assessing dependent: ${dependentFilePath}]`,
    '',
    content,
  ].join('\n');
}

/**
 * Propagate staleness from `changedFilePath` to all transitive dependents
 * using a BFS walk over the dependency graph.
 *
 * For each visited file (including the changed file itself):
 *  - Sets all 3 staleness columns (summary, concepts, change_impact)
 *  - Queues 3 LLM jobs at priority tier 2 with deduplication
 *  - If changeContext is provided, change_impact jobs carry a non-null payload:
 *    - Root file gets directPayload
 *    - Dependent files get a payload with upstream change info + their own content
 *
 * Cycle protection: each file is visited at most once (visited Set).
 * Depth cap: stops at depth >= MAX_CASCADE_DEPTH (10).
 */
export function cascadeStale(
  changedFilePath: string,
  opts: { timestamp: number; changeContext?: ChangeContext; isExhausted?: () => boolean }
): void {
  const { timestamp, changeContext, isExhausted } = opts;
  const visited = new Set<string>();
  const queue: Array<[string, number]> = [[changedFilePath, 0]];
  visited.add(changedFilePath);

  let totalVisited = 0;

  while (queue.length > 0) {
    const item = queue.shift()!;
    const [filePath, depth] = item;

    // Determine the change_impact payload for this file (if changeContext provided)
    let changeImpactPayload: string | undefined;
    if (changeContext) {
      if (filePath === changedFilePath) {
        changeImpactPayload = changeContext.directPayload;
      } else {
        changeImpactPayload = buildDependentPayload(changeContext, filePath);
      }
    }

    // Mark this file stale — always applies
    // summary and concepts jobs never get payload — only change_impact does
    markStale([filePath], timestamp);
    // Read file content and importance for broker submission
    let fileContent: string;
    try {
      fileContent = readFileSync(filePath, 'utf-8');
    } catch {
      // File deleted or unreadable — staleness already set, skip job submission
      totalVisited++;
      continue;
    }
    const importance = getFile(filePath)?.importance ?? 0;
    submitJob(filePath, 'summary', importance, fileContent);
    submitJob(filePath, 'concepts', importance, fileContent);
    submitJob(filePath, 'change_impact', importance, fileContent, changeImpactPayload);
    totalVisited++;

    // Stop BFS expansion if at depth cap
    if (depth >= MAX_CASCADE_DEPTH) continue;

    // Find files that depend on this file and enqueue unvisited ones
    const dependents = getDependents(filePath);
    for (const dep of dependents) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push([dep, depth + 1]);
      }
    }
  }

  log(`[CascadeEngine] cascadeStale: ${changedFilePath} → ${totalVisited} files marked stale`);
}

/**
 * Mark only the changed file itself stale — used for body-only changes
 * where the API surface is unchanged, so dependents do not need re-generation.
 *
 * Sets summary_stale_since and concepts_stale_since ONLY (NOT change_impact).
 * Body-only changes don't affect the change impact assessment of the file.
 * Queues 2 LLM jobs: summary and concepts at priority tier 2.
 */
export function markSelfStale(filePath: string, opts: { timestamp: number; isExhausted?: () => boolean }): void {
  const { timestamp, isExhausted } = opts;
  const sqlite = getSqlite();
  sqlite
    .prepare(
      'UPDATE files SET summary_stale_since = ?, concepts_stale_since = ? WHERE path = ?'
    )
    .run(timestamp, timestamp, filePath);

  // Read file content and importance for broker submission
  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    const importance = getFile(filePath)?.importance ?? 0;
    submitJob(filePath, 'summary', importance, fileContent);
    submitJob(filePath, 'concepts', importance, fileContent);
  } catch {
    // File deleted or unreadable — staleness already set, skip job submission
  }

  log(`[CascadeEngine] markSelfStale: ${filePath} → summary and concepts marked stale`);
}
