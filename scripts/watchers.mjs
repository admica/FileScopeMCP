#!/usr/bin/env node
// scripts/watchers.mjs
//
// Spawns one dist/mcp-server.js child per repo registered in
// ~/.filescope/nexus.json. Each child holds a chokidar watcher open for its
// repo and processes file events incrementally.
//
// Source of truth for the repo list: readRegistry() from src/nexus/discover.ts
// (compiled to dist/nexus/discover.js). Falls back to discoverRepos() when
// nexus.json is missing or empty.
//
// Lifecycle:
//   - Children that exit unexpectedly are restarted after RESTART_DELAY_MS.
//   - SIGTERM/SIGINT: stop accepting restarts, SIGTERM all children, wait up
//     to SHUTDOWN_GRACE_MS, SIGKILL stragglers, exit 0.

import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { open, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readRegistry,
  discoverRepos,
  NEXUS_JSON_PATH,
} from '../dist/nexus/discover.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT  = path.resolve(path.dirname(__filename), '..');
const MCP_SERVER = path.join(REPO_ROOT, 'dist', 'mcp-server.js');
const NODE_BIN   = process.execPath;

const FILESCOPE_DIR = path.join(os.homedir(), '.filescope');
const LOG_DIR       = path.join(FILESCOPE_DIR, 'watcher-logs');

const RESTART_DELAY_MS  = 10_000;
const SHUTDOWN_GRACE_MS = 8_000;

const children = new Set();
let shuttingDown = false;

await mkdir(LOG_DIR, { recursive: true });

function logName(repoPath) {
  return path.join(
    LOG_DIR,
    repoPath.replace(/[\/\\]+/g, '_').replace(/^_+/, '') + '.log',
  );
}

async function loadRepos() {
  const reg = readRegistry();
  if (reg && Array.isArray(reg.repos) && reg.repos.length > 0) {
    return reg.repos;
  }
  console.error(
    `watchers: nexus.json missing or empty at ${NEXUS_JSON_PATH}; running fs discovery`,
  );
  return await discoverRepos();
}

async function startWatcher(repo) {
  if (shuttingDown) return;

  const logFh = await open(logName(repo.path), 'a');
  const child = spawn(NODE_BIN, [MCP_SERVER, `--base-dir=${repo.path}`], {
    cwd: repo.path,
    stdio: ['pipe', 'pipe', logFh.fd],
  });

  children.add(child);

  let nextId = 1;
  const send = (obj) => {
    try {
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...obj }) + '\n');
    } catch {
      // child may have died mid-handshake; the exit handler will restart.
    }
  };

  // Drain stdout so the pipe never fills (MCP responses are not parsed here).
  child.stdout.on('data', () => {});
  child.stdout.on('error', () => {});

  child.on('exit', (code, sig) => {
    children.delete(child);
    logFh.close().catch(() => {});
    if (shuttingDown) {
      console.log(`[${repo.name}] exited code=${code} sig=${sig} (shutdown)`);
      return;
    }
    console.error(
      `[${repo.name}] exited code=${code} sig=${sig}, restart in ${
        RESTART_DELAY_MS / 1000
      }s`,
    );
    setTimeout(() => {
      startWatcher(repo).catch((e) =>
        console.error(`[${repo.name}] restart err:`, e.message),
      );
    }, RESTART_DELAY_MS);
  });
  child.on('error', (e) =>
    console.error(`[${repo.name}] spawn error:`, e.message),
  );

  // MCP handshake → scan_all kick. Drives the initial full crawl; chokidar
  // takes over for incremental updates from this point on.
  await sleep(800);
  send({
    id: nextId++,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'fs-watchers', version: '1.0' },
      capabilities: {},
    },
  });
  await sleep(400);
  send({ method: 'notifications/initialized' });
  await sleep(400);
  send({
    id: nextId++,
    method: 'tools/call',
    params: { name: 'scan_all', arguments: {} },
  });
  console.log(
    `[${repo.name}] watcher started, scan_all queued, pid=${child.pid}`,
  );
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(
    `watchers: ${signal} received, terminating ${children.size} child(ren)...`,
  );
  for (const c of children) {
    try { c.kill('SIGTERM'); } catch { /* already gone */ }
  }
  const start = Date.now();
  while (children.size > 0 && Date.now() - start < SHUTDOWN_GRACE_MS) {
    await sleep(100);
  }
  if (children.size > 0) {
    console.error(
      `watchers: ${children.size} child(ren) still running after ${SHUTDOWN_GRACE_MS}ms, sending SIGKILL`,
    );
    for (const c of children) {
      try { c.kill('SIGKILL'); } catch { /* already gone */ }
    }
    await sleep(200);
  }
  console.log('watchers: clean exit');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

const repos = await loadRepos();
if (repos.length === 0) {
  console.error(
    'watchers: no repos to watch (nexus.json empty and discovery found nothing)',
  );
  process.exit(1);
}

for (const repo of repos) {
  try {
    await startWatcher(repo);
  } catch (e) {
    console.error(`failed to start ${repo.name}:`, e.message);
  }
}

console.log(`watchers: ${repos.length} watcher(s) running. Send SIGTERM to stop.`);

// Keep the event loop alive even if every child detaches its stdio.
setInterval(() => {}, 1 << 30);
