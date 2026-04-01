// src/nexus/discover.ts
// Nexus registry read/write and 2-level auto-discovery scan for .filescope/data.db
// Exports: NexusRepo, NexusRegistry, NEXUS_JSON_PATH, readRegistry, writeRegistry, discoverRepos

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { FILESCOPE_DIR } from '../broker/config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type NexusRepo = { path: string; name: string };
export type NexusRegistry = { repos: NexusRepo[] };

// ─── Constants ────────────────────────────────────────────────────────────────

export const NEXUS_JSON_PATH = path.join(FILESCOPE_DIR, 'nexus.json');

// ─── Registry I/O ─────────────────────────────────────────────────────────────

/**
 * Read and parse ~/.filescope/nexus.json.
 * Returns null if file doesn't exist or is unparseable.
 */
export function readRegistry(): NexusRegistry | null {
  try {
    const raw = fs.readFileSync(NEXUS_JSON_PATH, 'utf-8');
    return JSON.parse(raw) as NexusRegistry;
  } catch {
    return null;
  }
}

/**
 * Write registry to NEXUS_JSON_PATH.
 * Creates ~/.filescope/ directory if it doesn't exist.
 */
export function writeRegistry(registry: NexusRegistry): void {
  fs.mkdirSync(FILESCOPE_DIR, { recursive: true });
  fs.writeFileSync(NEXUS_JSON_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

// ─── Discovery ────────────────────────────────────────────────────────────────

/**
 * Scan 2 levels deep from home directory for .filescope/data.db files.
 * Returns deduplicated list of { path, name } repo entries.
 */
export async function discoverRepos(): Promise<NexusRepo[]> {
  const home = os.homedir();
  const seen = new Set<string>();
  const repos: NexusRepo[] = [];

  // Level 1: ~/ProjectName/.filescope/data.db
  const level1Matches: string[] = [];
  for await (const m of fs.promises.glob('*/.filescope/data.db', { cwd: home })) {
    level1Matches.push(m);
  }
  // Level 2: ~/Parent/ProjectName/.filescope/data.db
  const level2Matches: string[] = [];
  for await (const m of fs.promises.glob('*/*/.filescope/data.db', { cwd: home })) {
    level2Matches.push(m);
  }

  for (const match of [...level1Matches, ...level2Matches]) {
    // match is relative: e.g. "ProjectName/.filescope/data.db"
    // Go up 2 dirs from data.db to get the repo root
    const fullDbPath = path.join(home, match);
    const repoRoot = path.resolve(fullDbPath, '../..');

    if (seen.has(repoRoot)) continue;
    seen.add(repoRoot);

    const name = path.basename(repoRoot);
    repos.push({ path: repoRoot, name });
  }

  return repos;
}
