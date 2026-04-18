// @vitest-pool forks
// Integration tests for the broker lifecycle: spawn, shutdown, crash recovery,
// PID guard, socket connectivity, NDJSON job submission, and reconnection.
// Requires dist/broker/main.js — run `npm run build` first.
//
// NOTE: These tests take exclusive control of ~/.filescope/broker.sock and
// ~/.filescope/broker.pid. They cannot run while a live FileScopeMCP session
// is active on the same machine (broker client reconnect timers will interfere).
// In CI (no live sessions) these tests run unconditionally. Locally, kill any
// running broker and MCP server instances before running.

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, execSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as net from 'node:net';
import { SOCK_PATH, PID_PATH } from '../../src/broker/config.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const BROKER_BIN = path.join(process.cwd(), 'dist/broker/main.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function waitForSocket(
  sockPath: string,
  pollIntervalMs: number,
  maxWaitMs: number,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (existsSync(sockPath)) return true;
    await new Promise<void>(r => setTimeout(r, pollIntervalMs));
  }
  return existsSync(sockPath);
}

/**
 * Waits for PID_PATH to appear and contain a specific PID.
 * Returns true when the file exists with any valid PID, false on timeout.
 */
async function waitForPidFile(maxWaitMs: number): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (existsSync(PID_PATH)) {
      const raw = readFileSync(PID_PATH, 'utf-8').trim();
      const pid = parseInt(raw, 10);
      if (!isNaN(pid) && pid > 0) return true;
    }
    await new Promise<void>(r => setTimeout(r, 200));
  }
  return false;
}

async function connectSocket(sockPath: string): Promise<net.Socket> {
  return new Promise<net.Socket>((resolve, reject) => {
    const sock = net.connect(sockPath);
    sock.once('connect', () => resolve(sock));
    sock.once('error', reject);
  });
}

function closeSocket(sock: net.Socket): void {
  if (!sock.destroyed) {
    sock.destroy();
  }
}

/**
 * Reads the current PID from PID_PATH, returns 0 if not found or invalid.
 */
function readCurrentPid(): number {
  if (!existsSync(PID_PATH)) return 0;
  const raw = readFileSync(PID_PATH, 'utf-8').trim();
  const pid = parseInt(raw, 10);
  return isNaN(pid) ? 0 : pid;
}

/**
 * Returns true if there are other broker/main.js processes running (not spawned
 * by this test suite). Used to detect live FileScopeMCP sessions.
 */
function hasExternalBrokerProcesses(): boolean {
  try {
    const output = execSync('pgrep -f "broker/main.js"', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    const pids = output.trim().split('\n').filter(Boolean).map(Number);
    // Filter out current process and parent — any broker running that isn't ours
    return pids.length > 0;
  } catch {
    // pgrep exits non-zero when no matches found
    return false;
  }
}

// ─── Skip guards ──────────────────────────────────────────────────────────────

const brokerBinExists = existsSync(BROKER_BIN);

// Detect live FileScopeMCP sessions that will interfere with these tests.
// External broker processes keep spawning new broker instances via reconnect
// timers, making exclusive control of ~/.filescope/broker.sock impossible.
const hasConflictingBrokers = hasExternalBrokerProcesses();

describe.skipIf(!brokerBinExists || hasConflictingBrokers)('broker lifecycle', () => {
  let broker: ChildProcess | null = null;

  // ─── beforeAll: clean any stale broker state ────────────────────────────────

  beforeAll(async () => {
    // Remove any stale socket and PID files from previous runs
    rmSync(SOCK_PATH, { force: true });
    rmSync(PID_PATH, { force: true });
  });

  // ─── afterEach: kill spawned broker and clean up files ─────────────────────

  afterEach(async () => {
    try {
      if (broker && !broker.killed) {
        broker.kill('SIGTERM');
        // Wait for broker to exit cleanly
        await new Promise<void>(r => {
          broker!.once('exit', r);
          setTimeout(r, 2_000); // fallback: 2s max wait
        });
      }
    } finally {
      broker = null;
      // Allow signal handlers to complete before cleaning up
      await new Promise<void>(r => setTimeout(r, 300));
      rmSync(SOCK_PATH, { force: true });
      rmSync(PID_PATH, { force: true });
    }
  });

  // ─── afterAll: final cleanup ────────────────────────────────────────────────

  afterAll(() => {
    rmSync(SOCK_PATH, { force: true });
    rmSync(PID_PATH, { force: true });
  });

  // ─── TEST-02: spawn, shutdown, crash recovery ────────────────────────────────

  it('creates PID file and socket on spawn', async () => {
    broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });

    // PID file is written before the LLM check and server.start()
    const pidReady = await waitForPidFile(5_000);
    expect(pidReady).toBe(true);

    const pid = readCurrentPid();
    expect(pid).toBeGreaterThan(0);
    expect(pid).toBe(broker.pid); // PID file matches the spawned process

    // Socket appears after LLM connectivity check (~5s)
    const socketReady = await waitForSocket(SOCK_PATH, 500, 10_000);
    expect(socketReady).toBe(true);
  }, 20_000);

  it('removes socket and PID file on SIGTERM', async () => {
    broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });

    const socketReady = await waitForSocket(SOCK_PATH, 500, 12_000);
    expect(socketReady).toBe(true);

    // Send SIGTERM and wait for exit
    broker.kill('SIGTERM');
    await new Promise<void>(r => broker!.once('exit', () => r()));
    broker = null; // prevent afterEach from double-killing

    expect(existsSync(SOCK_PATH)).toBe(false);
    expect(existsSync(PID_PATH)).toBe(false);
  }, 20_000);

  it('PID guard detects concurrent instance and exits cleanly', async () => {
    // Start first broker and wait for socket (confirms it's fully running)
    broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });
    const socketReady = await waitForSocket(SOCK_PATH, 500, 12_000);
    expect(socketReady).toBe(true);

    const firstPid = readCurrentPid();
    expect(firstPid).toBe(broker.pid);

    // Attempt to start a second broker — PID guard should detect the running instance
    // and exit 0. Use stdio pipe to capture any error output for diagnostics.
    const second = spawn(process.execPath, [BROKER_BIN], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const exitCode = await new Promise<number | null>(r => second.on('exit', r));

    // PID guard exits 0 to signal "already running" (not an error)
    expect(exitCode).toBe(0);

    // First broker must still be alive and its PID file unchanged
    expect(readCurrentPid()).toBe(firstPid);
    expect(existsSync(SOCK_PATH)).toBe(true);
  }, 25_000);

  it('recovers from SIGKILL by detecting stale PID on next spawn', async () => {
    // Start first broker
    broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });
    const socketReady = await waitForSocket(SOCK_PATH, 500, 12_000);
    expect(socketReady).toBe(true);

    const originalPid = readCurrentPid();
    expect(originalPid).toBeGreaterThan(0);
    expect(originalPid).toBe(broker.pid);

    // SIGKILL — no cleanup handlers fire, stale files remain
    broker.kill('SIGKILL');
    await new Promise<void>(r => broker!.once('exit', () => r()));
    broker = null;

    // Stale files must still exist (SIGKILL can't clean up)
    expect(existsSync(SOCK_PATH)).toBe(true);
    expect(existsSync(PID_PATH)).toBe(true);
    expect(readCurrentPid()).toBe(originalPid); // same stale PID

    // Spawn a new broker — PID guard detects dead PID, cleans stale files, starts fresh
    broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });

    // Wait for new socket to appear (proves recovery succeeded)
    const newSocketReady = await waitForSocket(SOCK_PATH, 500, 12_000);
    expect(newSocketReady).toBe(true);

    // New PID file must match the new broker process
    const newPid = readCurrentPid();
    expect(newPid).toBeGreaterThan(0);
    expect(newPid).toBe(broker.pid); // new PID file matches new process

    // Verify the new broker accepts connections (functional proof of recovery)
    const sock = await connectSocket(SOCK_PATH);
    expect(sock.destroyed).toBe(false);
    closeSocket(sock);
  }, 30_000);

  // ─── TEST-04: socket connectivity, NDJSON job submission, reconnection ────────

  it('broker accepts socket connection after spawn', async () => {
    broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });
    const ready = await waitForSocket(SOCK_PATH, 500, 12_000);
    expect(ready).toBe(true);

    const sock = await connectSocket(SOCK_PATH);
    expect(sock.destroyed).toBe(false);
    closeSocket(sock);
  }, 20_000);

  it('submitJob writes NDJSON to a connected socket', async () => {
    broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });
    const ready = await waitForSocket(SOCK_PATH, 500, 12_000);
    expect(ready).toBe(true);

    const sock = await connectSocket(SOCK_PATH);

    // Write a valid submit message as NDJSON
    const msg = JSON.stringify({
      type: 'submit',
      id: 'test-job-001',
      repoPath: '/tmp/test-repo',
      filePath: '/tmp/test-repo/test.ts',
      jobType: 'summary',
      importance: 5,
      fileContent: 'export const x = 1;',
    }) + '\n';
    sock.write(msg);

    // Wait briefly for broker to process — socket must still be alive
    await new Promise<void>(r => setTimeout(r, 500));
    expect(sock.destroyed).toBe(false);

    closeSocket(sock);
  }, 20_000);

  it('reconnection: new connection succeeds after socket close and reopen', async () => {
    broker = spawn(process.execPath, [BROKER_BIN], { stdio: 'ignore' });
    const ready = await waitForSocket(SOCK_PATH, 500, 12_000);
    expect(ready).toBe(true);

    // Establish first connection then destroy it
    const sock1 = await connectSocket(SOCK_PATH);
    expect(sock1.destroyed).toBe(false);
    sock1.destroy();

    // Wait for cleanup
    await new Promise<void>(r => setTimeout(r, 200));

    // Establish a second connection — broker must still be accepting connections
    const sock2 = await connectSocket(SOCK_PATH);
    expect(sock2.destroyed).toBe(false);

    closeSocket(sock2);
  }, 20_000);
});
