// src/broker/main.ts
// FileScopeMCP LLM Broker entry point.
// Handles config load, PID guard, logging setup, server start, and graceful shutdown.
// Compiled by esbuild to dist/broker.js.

import * as fs from 'node:fs';
import { log, enableFileLogging, enableDaemonFileLogging } from '../logger.js';
import { loadBrokerConfig, SOCK_PATH, PID_PATH, LOG_PATH, CONFIG_PATH } from './config.js';
import { BrokerServer } from './server.js';

// ─── Logging setup (Pattern 8: dual-output based on TTY detection) ────────────

if (process.stdout.isTTY) {
  // Interactive: logs to stdout (via console.error) AND file
  enableFileLogging(true, LOG_PATH);
} else {
  // Daemon/piped: logs to file only
  enableDaemonFileLogging(LOG_PATH);
}

// ─── PID guard helpers (BROKER-04, Pattern 4) ─────────────────────────────────

function isPidRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code !== 'ESRCH'; // ESRCH = no such process
  }
}

function checkPidGuard(): void {
  if (fs.existsSync(PID_PATH)) {
    const raw = fs.readFileSync(PID_PATH, 'utf-8').trim();
    const pid = parseInt(raw, 10);
    if (!isNaN(pid) && isPidRunning(pid)) {
      log(`Broker already running (PID ${pid})`);
      process.exit(0); // Non-error exit for auto-start race conditions
    }
    // Stale: remove leftover files
    log(`Cleaning stale PID file (PID ${raw} not running)`);
    fs.rmSync(SOCK_PATH, { force: true });
    fs.rmSync(PID_PATH, { force: true });
  } else if (fs.existsSync(SOCK_PATH)) {
    // Socket exists without PID file — also stale
    log('Cleaning stale socket file (no PID file)');
    fs.rmSync(SOCK_PATH, { force: true });
  }
}

// ─── Ollama connectivity check ────────────────────────────────────────────────

/** Checks if Ollama is reachable. Warns if not but always continues (self-healing). */
async function checkOllamaConnectivity(baseURL?: string): Promise<boolean> {
  const url = baseURL || 'http://localhost:11434';
  try {
    // Strip /v1 suffix for health check (Ollama health endpoint is at root)
    const healthURL = url.replace(/\/v1\/?$/, '');
    const res = await fetch(healthURL, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Load config (creates ~/.filescope/ and auto-copies default config on first run)
  const config = await loadBrokerConfig();

  // 2. PID guard — must run before binding socket
  checkPidGuard();

  // 3. Write PID file before binding socket
  fs.writeFileSync(PID_PATH, String(process.pid), 'utf-8');

  // 4. Verbose startup logging (CONTEXT.md locked decision)
  log(`FileScopeMCP Broker starting`);
  log(`  PID:       ${process.pid}`);
  log(`  Socket:    ${SOCK_PATH}`);
  log(`  Config:    ${CONFIG_PATH}`);
  log(`  Log:       ${LOG_PATH}`);
  log(`  Model:     ${config.llm.model}`);
  log(`  Provider:  ${config.llm.provider}`);
  log(`  Timeout:   ${config.jobTimeoutMs}ms`);
  log(`  Max queue: ${config.maxQueueSize}`);
  log(`  Node:      ${process.version}`);
  log(`  Started:   ${new Date().toISOString()}`);

  // 5. Ollama connectivity check (warn if unreachable, continue anyway)
  const ollamaOk = await checkOllamaConnectivity(config.llm.baseURL);
  if (ollamaOk) {
    log(`  Ollama:    reachable at ${config.llm.baseURL || 'http://localhost:11434'}`);
  } else {
    log(`  Ollama:    UNREACHABLE at ${config.llm.baseURL || 'http://localhost:11434'} (will retry per-job)`);
  }

  // 6. Create and start server
  const server = new BrokerServer(config);
  await server.start();

  // 7. Graceful shutdown (BROKER-10, Pattern 5)
  let shutdownStarted = false;

  async function shutdown(sig: string): Promise<void> {
    if (shutdownStarted) return;
    shutdownStarted = true;
    log(`Received ${sig} — graceful shutdown`);

    await server.shutdown();

    // Remove socket and PID files
    fs.rmSync(SOCK_PATH, { force: true });
    fs.rmSync(PID_PATH, { force: true });
    log('Broker stopped cleanly');
    process.exit(0);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

// ─── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error(`Broker failed to start: ${err}`);
  // Clean up PID file if we wrote it
  try { fs.rmSync(PID_PATH, { force: true }); } catch {}
  process.exit(1);
});
