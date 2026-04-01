#!/usr/bin/env node
// src/nexus/main.ts
// CLI entry point for the Nexus HTTP server.
// Handles: arg parsing, repo discovery/registry, DB connections, 60s recheck, graceful shutdown.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readRegistry, writeRegistry, discoverRepos } from './discover.js';
import { openRepo, closeAll, recheckOffline } from './repo-store.js';
import { createServer } from './server.js';

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs(): { port: number; host: string } {
  const args = process.argv.slice(2);
  let port = 1234;
  let host = '0.0.0.0';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i], 10);
    if (args[i] === '--host' && args[i + 1]) host = args[++i];
  }
  return { port, host };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const config = parseArgs();

  // ── Repo discovery ──────────────────────────────────────────────────────────

  let registry = readRegistry();
  if (!registry) {
    console.log('Nexus: no nexus.json found, scanning for repos...');
    const discovered = await discoverRepos();
    registry = { repos: discovered };
    writeRegistry(registry);
    console.log(`Nexus: discovered ${discovered.length} repos, saved to nexus.json`);
  }

  // ── Open repo databases ─────────────────────────────────────────────────────

  for (const repo of registry.repos) {
    const state = openRepo(repo.name, repo.path);
    const status = state.online ? 'online' : 'OFFLINE';
    console.log(`  - ${repo.name} (${repo.path}) [${status}]`);
  }

  // ── Periodic recheck for offline repos ─────────────────────────────────────

  const recheckInterval = setInterval(() => recheckOffline(), 60_000);
  recheckInterval.unref(); // don't keep process alive just for recheck

  // ── Create and start HTTP server ────────────────────────────────────────────

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const staticDir = path.join(__dirname, 'static');

  const server = await createServer({ staticDir });
  await server.listen({ port: config.port, host: config.host });
  console.log(`Nexus: http://${config.host}:${config.port}`);

  // ── Graceful shutdown ───────────────────────────────────────────────────────

  async function shutdown(signal: string) {
    console.log(`Nexus: received ${signal}, shutting down...`);
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    clearInterval(recheckInterval);
    closeAll();
    await server.close();
    clearTimeout(timeout);
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Nexus: fatal error', err);
  process.exit(1);
});
