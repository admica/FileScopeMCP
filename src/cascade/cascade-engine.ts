// src/cascade/cascade-engine.ts
// CascadeEngine — BFS staleness propagation through the dependency graph.
// When Phase 3's ChangeDetector flags an API surface change, this module
// ensures staleness propagates to all transitive dependents so Phase 5
// can regenerate their summaries and concepts.
import { getDependents, markStale, insertLlmJobIfNotPending } from '../db/repository.js';
import { getSqlite } from '../db/db.js';
import { log } from '../logger.js';

const MAX_CASCADE_DEPTH = 10;

/**
 * Propagate staleness from `changedFilePath` to all transitive dependents
 * using a BFS walk over the dependency graph.
 *
 * For each visited file (including the changed file itself):
 *  - Sets all 3 staleness columns (summary, concepts, change_impact)
 *  - Queues 3 LLM jobs at priority tier 2 with deduplication
 *
 * Cycle protection: each file is visited at most once (visited Set).
 * Depth cap: stops at depth >= MAX_CASCADE_DEPTH (10).
 */
export function cascadeStale(changedFilePath: string, opts: { timestamp: number }): void {
  const { timestamp } = opts;
  const visited = new Set<string>();
  const queue: Array<[string, number]> = [[changedFilePath, 0]];
  visited.add(changedFilePath);

  let totalVisited = 0;

  while (queue.length > 0) {
    const item = queue.shift()!;
    const [filePath, depth] = item;

    // Mark this file stale and queue 3 jobs
    markStale([filePath], timestamp);
    insertLlmJobIfNotPending(filePath, 'summary', 2);
    insertLlmJobIfNotPending(filePath, 'concepts', 2);
    insertLlmJobIfNotPending(filePath, 'change_impact', 2);
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
export function markSelfStale(filePath: string, opts: { timestamp: number }): void {
  const { timestamp } = opts;
  const sqlite = getSqlite();
  sqlite
    .prepare(
      'UPDATE files SET summary_stale_since = ?, concepts_stale_since = ? WHERE path = ?'
    )
    .run(timestamp, timestamp, filePath);

  insertLlmJobIfNotPending(filePath, 'summary', 2);
  insertLlmJobIfNotPending(filePath, 'concepts', 2);

  log(`[CascadeEngine] markSelfStale: ${filePath} → summary and concepts marked stale`);
}
