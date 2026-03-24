// src/broker/client.ts
// Broker client module for FileScopeMCP instances.
// Manages the connection lifecycle to the shared LLM broker over a Unix domain socket.
// Exports: connect, disconnect, submitJob, isConnected, requestStatus, resubmitStaleFiles
import * as net from 'node:net';
import * as readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
import { SOCK_PATH } from './config.js';
import type { SubmitMessage, StatusMessage, StatusResponse, BrokerMessage } from './types.js';
import { writeLlmResult, clearStaleness } from '../db/repository.js';
import { getSqlite } from '../db/db.js';
import { log } from '../logger.js';

// ─── Module-level state ───────────────────────────────────────────────────────

let socket: net.Socket | null = null;
let reconnectTimer: ReturnType<typeof setInterval> | null = null;
let repoPath: string = '';
let _intentionalDisconnect: boolean = false;

const pendingStatusRequests = new Map<string, (r: StatusResponse | null) => void>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the socket exists and has not been destroyed.
 */
export function isConnected(): boolean {
  return socket !== null && !socket.destroyed;
}

/**
 * Connect to the broker. Spawns the broker binary if the socket does not exist.
 * On connection, resubmits all stale files. Best-effort — does not throw on failure.
 */
export async function connect(repo: string): Promise<void> {
  repoPath = repo;
  _intentionalDisconnect = false;

  await spawnBrokerIfNeeded();
  await attemptConnect();
}

/**
 * Disconnect intentionally from the broker. Clears the reconnect timer.
 */
export function disconnect(): void {
  _intentionalDisconnect = true;
  clearReconnectTimer();
  if (socket) {
    socket.destroy();
    socket = null;
  }
}

/**
 * Submit a job to the broker. Fire-and-forget — silently dropped if not connected.
 */
export function submitJob(
  filePath: string,
  jobType: 'summary' | 'concepts' | 'change_impact',
  importance: number,
  fileContent: string,
  payload?: string,
): void {
  if (!isConnected()) return;

  const msg: SubmitMessage = {
    type: 'submit',
    id: randomUUID(),
    repoPath,
    filePath,
    jobType,
    importance,
    fileContent,
    payload,
  };

  socket!.write(JSON.stringify(msg) + '\n');
}

/**
 * Request current broker status. Returns null if not connected or if the
 * request times out (2 seconds). Fire-and-forget — does not throw.
 */
export function requestStatus(timeoutMs = 2000): Promise<StatusResponse | null> {
  if (!isConnected()) return Promise.resolve(null);

  return new Promise<StatusResponse | null>((resolve) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      pendingStatusRequests.delete(id);
      resolve(null);
    }, timeoutMs);
    timer.unref();

    pendingStatusRequests.set(id, (response) => {
      clearTimeout(timer);
      pendingStatusRequests.delete(id);
      resolve(response);
    });

    const msg: StatusMessage = { type: 'status', id };
    socket!.write(JSON.stringify(msg) + '\n');
  });
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Spawns the broker binary if the socket file does not exist.
 * Resolves the binary path relative to this compiled module (dist/broker/client.js).
 */
async function spawnBrokerIfNeeded(): Promise<void> {
  if (existsSync(SOCK_PATH)) return;

  try {
    const distBrokerDir = path.dirname(fileURLToPath(import.meta.url));
    const brokerBin = path.resolve(distBrokerDir, 'main.js');
    spawn(process.execPath, [brokerBin], { detached: true, stdio: 'ignore' }).unref();
    // Give the broker 500ms to bind the socket before we try to connect
    await new Promise<void>(r => setTimeout(r, 500));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[broker-client] Warning: failed to spawn broker: ${msg}`);
  }
}

/**
 * Attempts to connect to the broker socket. Resolves (not rejects) on error —
 * connection is best-effort. Starts reconnect timer on failure.
 */
function attemptConnect(): Promise<void> {
  return new Promise<void>(resolve => {
    // Already connected — nothing to do
    if (socket !== null && !socket.destroyed) {
      resolve();
      return;
    }

    const sock = net.createConnection(SOCK_PATH);

    sock.on('connect', () => {
      socket = sock;
      clearReconnectTimer();
      attachListener(sock);
      log('[broker-client] Connected to broker');
      resubmitStaleFiles();
      resolve();
    });

    sock.on('error', (err: Error) => {
      log(`[broker-client] Connection error: ${err.message}`);
      startReconnectTimer();
      resolve(); // best-effort; do NOT reject
    });

    sock.on('close', () => {
      socket = null;
      // Clean up any pending status requests — they'll never get a response
      for (const resolve of pendingStatusRequests.values()) {
        resolve(null);
      }
      pendingStatusRequests.clear();
      if (!_intentionalDisconnect) {
        log('[broker-client] Disconnected — reconnecting in 10s');
        startReconnectTimer();
      }
    });
  });
}

/**
 * Attaches an NDJSON readline listener to the socket.
 * Dispatches each parsed line to handleBrokerMessage.
 */
function attachListener(sock: net.Socket): void {
  const rl = readline.createInterface({ input: sock, terminal: false });
  rl.on('line', (line: string) => {
    try {
      const msg = JSON.parse(line) as BrokerMessage;
      handleBrokerMessage(msg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`[broker-client] Malformed message from broker: ${msg}`);
    }
  });
}

/**
 * Handles a message received from the broker.
 * On result: writes LLM output to DB and clears staleness.
 * On error: logs and leaves the file stale for later resubmission.
 */
function handleBrokerMessage(msg: BrokerMessage): void {
  if (msg.type === 'result') {
    writeLlmResult(msg.filePath, msg.jobType, msg.text);
    clearStaleness(msg.filePath, msg.jobType);
    log(`[broker-client] Result received: ${msg.jobType} for ${msg.filePath} (${msg.totalTokens} tokens)`);
  } else if (msg.type === 'error') {
    log(`[broker-client] Broker error [${msg.code}]: ${msg.message}${msg.filePath ? ` (${msg.filePath})` : ''}`);
    // File stays stale — will be resubmitted on next reconnect
  } else if (msg.type === 'status_response') {
    const resolver = pendingStatusRequests.get(msg.id);
    if (resolver) resolver(msg);
  }
}

/**
 * Queries for stale files and resubmits each stale job to the broker.
 * Called after every successful connection.
 */
export function resubmitStaleFiles(): void {
  try {
    const sqlite = getSqlite();
    const rows = sqlite
      .prepare(
        `SELECT path, importance,
                summary_stale_since, concepts_stale_since, change_impact_stale_since
         FROM files
         WHERE summary_stale_since IS NOT NULL
            OR concepts_stale_since IS NOT NULL
            OR change_impact_stale_since IS NOT NULL
         ORDER BY importance DESC`
      )
      .all() as Array<{
        path: string;
        importance: number;
        summary_stale_since: number | null;
        concepts_stale_since: number | null;
        change_impact_stale_since: number | null;
      }>;

    let submitted = 0;

    for (const row of rows) {
      let fileContent: string;
      try {
        fileContent = readFileSync(row.path, 'utf-8');
      } catch {
        // File deleted or unreadable — skip
        continue;
      }

      if (row.summary_stale_since !== null) {
        submitJob(row.path, 'summary', row.importance, fileContent);
        submitted++;
      }
      if (row.concepts_stale_since !== null) {
        submitJob(row.path, 'concepts', row.importance, fileContent);
        submitted++;
      }
      if (row.change_impact_stale_since !== null) {
        submitJob(row.path, 'change_impact', row.importance, fileContent);
        submitted++;
      }
    }

    if (submitted > 0) {
      log(`[broker-client] Resubmitted ${submitted} stale job(s) after connect`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`[broker-client] resubmitStaleFiles error: ${msg}`);
  }
}

/**
 * Starts a 10-second reconnect interval if one is not already running.
 * The interval is unref()'d so it does not prevent process exit.
 */
function startReconnectTimer(): void {
  if (reconnectTimer !== null) return;
  reconnectTimer = setInterval(() => {
    attemptConnect().catch(() => {});
  }, 10_000);
  reconnectTimer.unref();
}

/**
 * Clears the reconnect interval.
 */
function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
}
