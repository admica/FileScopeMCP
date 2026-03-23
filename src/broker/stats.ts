// src/broker/stats.ts
// Per-repo token stats persistence for the FileScopeMCP LLM broker.
// Reads/writes ~/.filescope/stats.json to accumulate lifetime token totals per repo.
// Exports: readStats, writeStats, accumulateTokens, STATS_PATH, BrokerStats

import * as fs from 'node:fs';
import * as path from 'node:path';
import { FILESCOPE_DIR } from './config.js';

export const STATS_PATH = path.join(FILESCOPE_DIR, 'stats.json');

export type BrokerStats = {
  repoTokens: Record<string, number>;
};

export function readStats(): BrokerStats {
  try {
    return JSON.parse(fs.readFileSync(STATS_PATH, 'utf-8')) as BrokerStats;
  } catch {
    return { repoTokens: {} };
  }
}

export function writeStats(stats: BrokerStats): void {
  fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), 'utf-8');
}

export function accumulateTokens(repoPath: string, tokens: number): BrokerStats {
  const stats = readStats();
  stats.repoTokens[repoPath] = (stats.repoTokens[repoPath] ?? 0) + tokens;
  writeStats(stats);
  return stats;
}
