#!/usr/bin/env node
// scripts/bench-scan.mjs
// Phase 33 PERF-01 baseline capture tool.
// Runs coordinator.init() over (a) the repo itself and (b) tests/fixtures/medium-repo.
// Writes .planning/phases/33-symbol-extraction-foundation/baseline.json.
//
// Reusable post-implementation for Phase 35 PERF-02 regression check (same script).
// REQUIRES a prior `npm run build` — imports from dist/.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const COORDINATOR_JS = path.join(REPO_ROOT, 'dist', 'coordinator.js');
const REPO_JS        = path.join(REPO_ROOT, 'dist', 'db', 'repository.js');
const FIXTURE_ROOT   = path.join(REPO_ROOT, 'tests', 'fixtures', 'medium-repo');
const OUT_PATH       = path.join(
  REPO_ROOT, '.planning', 'phases',
  '33-symbol-extraction-foundation', 'baseline.json'
);

if (!existsSync(COORDINATOR_JS) || !existsSync(REPO_JS)) {
  console.error(`ERROR: ${COORDINATOR_JS} not found.`);
  console.error('Run `npm run build` first (bench-scan imports from dist/).');
  process.exit(1);
}
if (!existsSync(FIXTURE_ROOT)) {
  console.error(`ERROR: ${FIXTURE_ROOT} not found.`);
  console.error('The medium-repo fixture must be committed before running bench-scan.');
  process.exit(1);
}

const { ServerCoordinator } = await import(COORDINATOR_JS);
const { getAllFiles } = await import(REPO_JS);

async function timeScan(projectPath) {
  // Each scan runs in an isolated CWD so the per-project .filescope/data.db doesn't collide.
  const cwd = process.cwd();
  const tmpCwd = mkdtempSync(path.join(os.tmpdir(), 'filescope-bench-'));
  try {
    process.chdir(tmpCwd);
    const coord = new ServerCoordinator();
    const t0 = Date.now();
    await coord.init(projectPath);
    const elapsed = Date.now() - t0;
    const fileCount = getAllFiles().length;
    return { elapsed, fileCount };
  } finally {
    process.chdir(cwd);
    try { rmSync(tmpCwd, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

let commitSha = 'unknown';
try {
  commitSha = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT })
    .toString().trim();
} catch { /* repo may not be git-tracked; keep 'unknown' */ }

console.error(`[bench-scan] self-scan: ${REPO_ROOT}`);
const self = await timeScan(REPO_ROOT);
console.error(`[bench-scan] self-scan: ${self.elapsed} ms, ${self.fileCount} files`);

console.error(`[bench-scan] medium-repo: ${FIXTURE_ROOT}`);
const fixture = await timeScan(FIXTURE_ROOT);
console.error(`[bench-scan] medium-repo: ${fixture.elapsed} ms, ${fixture.fileCount} files`);

const baseline = {
  captured_at:         new Date().toISOString(),
  self_scan_ms:        self.elapsed,
  medium_repo_scan_ms: fixture.elapsed,
  file_counts:         { self: self.fileCount, medium_repo: fixture.fileCount },
  node_version:        process.version,
  commit_sha:          commitSha,
};

mkdirSync(path.dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(baseline, null, 2) + '\n');
console.error(`[bench-scan] baseline written to ${OUT_PATH}`);

// coordinator.init() starts a FileWatcher (chokidar) that keeps the event loop
// alive indefinitely. We have no public shutdown API on ServerCoordinator yet,
// so force-exit after the write. Phase 35's PERF-02 check runs this in CI and
// must terminate deterministically.
process.exit(0);
