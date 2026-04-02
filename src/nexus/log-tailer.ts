// src/nexus/log-tailer.ts
// Log tailing module for Nexus: watches broker.log and mcp-server.log via fs.watch(),
// maintains a 500-line ring buffer, parses structured log lines, and broadcasts
// new lines to registered SSE clients.
// Exports: LogLine, initLogTailer, stopLogTailer, getRecentLines, addSseClient

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as http from 'node:http';
import { FILESCOPE_DIR } from '../broker/config.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LogLine = {
  timestamp: string;             // ISO timestamp extracted from log line
  prefix: string;                // e.g. "INFO", "WORKER" — empty string if none
  message: string;               // remainder after timestamp and optional prefix
  source: 'broker' | 'mcp-server';
};

type FileState = {
  offset: number;
  watcher: fs.FSWatcher | null;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const RING_BUFFER_SIZE = 500;

const LOG_PATHS: string[] = [
  path.join(FILESCOPE_DIR, 'broker.log'),
  path.join(FILESCOPE_DIR, 'mcp-server.log'),
];

// ─── Parse regex ─────────────────────────────────────────────────────────────
// Handles:
//   [2026-04-01T02:32:33.150Z] BrokerWorker started
//   [2026-04-01T02:32:32.500Z] [INFO] Using default config

const LOG_REGEX = /^\[([^\]]+)\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/;

// ─── Module state ─────────────────────────────────────────────────────────────

const ringBuffer: LogLine[] = [];
const sseClients: Set<http.ServerResponse> = new Set();
const fileStates: Map<string, FileState> = new Map();

// ─── Exported functions ───────────────────────────────────────────────────────

/**
 * Returns a copy of the current ring buffer contents.
 */
export function getRecentLines(): LogLine[] {
  return [...ringBuffer];
}

/**
 * Adds an SSE client response to the broadcast set.
 * Returns a cleanup function that removes the client.
 */
export function addSseClient(res: http.ServerResponse): () => void {
  sseClients.add(res);
  return () => {
    sseClients.delete(res);
  };
}

/**
 * Initializes log tailing for all configured log paths.
 * Reads existing content into the ring buffer, then watches for new bytes.
 */
export function initLogTailer(): void {
  for (const logPath of LOG_PATHS) {
    const source: LogLine['source'] = logPath.includes('broker') ? 'broker' : 'mcp-server';
    const state: FileState = { offset: 0, watcher: null };

    // Read existing file content into ring buffer
    if (fs.existsSync(logPath)) {
      try {
        const raw = fs.readFileSync(logPath, 'utf-8');
        const lines = raw.split('\n');
        // Take last 500 lines to seed the ring buffer
        const seedLines = lines.slice(-RING_BUFFER_SIZE);
        for (const raw of seedLines) {
          const parsed = parseLine(raw, source);
          if (parsed) appendToBuffer(parsed);
        }
        state.offset = fs.statSync(logPath).size;
      } catch {
        // File may have been deleted between existsSync and read — skip
      }
    }

    // Watch for new bytes
    try {
      const watcher = fs.watch(logPath, { persistent: false }, () => {
        readNewBytes(logPath, state, source);
      });
      state.watcher = watcher;
    } catch {
      // ENOENT — file doesn't exist yet; watcher stays null
      state.watcher = null;
    }

    fileStates.set(logPath, state);
  }
}

/**
 * Stops all file watchers and clears module state.
 */
export function stopLogTailer(): void {
  for (const state of fileStates.values()) {
    if (state.watcher) {
      try {
        state.watcher.close();
      } catch {
        // ignore errors during cleanup
      }
    }
  }
  fileStates.clear();
  sseClients.clear();
}

// ─── Internal functions ───────────────────────────────────────────────────────

/**
 * Parses a raw log line into a LogLine, or returns null if unparseable.
 */
function parseLine(raw: string, source: LogLine['source']): LogLine | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = LOG_REGEX.exec(trimmed);
  if (!m) return null;
  return {
    timestamp: m[1],
    prefix: m[2] ?? '',
    message: m[3],
    source,
  };
}

/**
 * Appends a line to the ring buffer, evicting the oldest entry if full.
 */
function appendToBuffer(line: LogLine): void {
  if (ringBuffer.length >= RING_BUFFER_SIZE) {
    ringBuffer.shift();
  }
  ringBuffer.push(line);
}

/**
 * Formats a LogLine as an SSE payload and writes it to all registered clients.
 * Removes clients that produce errors (disconnected).
 */
function broadcast(line: LogLine): void {
  const payload = `data: ${JSON.stringify(line)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Reads any new bytes appended to the file since the last read offset.
 * Detects log rotation by checking if file size shrank below the stored offset.
 */
function readNewBytes(filePath: string, state: FileState, source: LogLine['source']): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return;
  }

  // Log rotation: file was truncated or replaced
  if (stat.size < state.offset) {
    state.offset = 0;
  }

  if (stat.size <= state.offset) {
    return; // no new data
  }

  const byteCount = stat.size - state.offset;
  const buf = Buffer.allocUnsafe(byteCount);

  let fd: number | null = null;
  let bytesRead = 0;
  try {
    fd = fs.openSync(filePath, 'r');
    bytesRead = fs.readSync(fd, buf, 0, byteCount, state.offset);
  } catch {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    return;
  }
  fs.closeSync(fd);

  state.offset += bytesRead;

  const text = buf.subarray(0, bytesRead).toString('utf-8');
  const lines = text.split('\n');
  for (const rawLine of lines) {
    const parsed = parseLine(rawLine, source);
    if (parsed) {
      appendToBuffer(parsed);
      broadcast(parsed);
    }
  }
}
