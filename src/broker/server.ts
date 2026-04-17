// src/broker/server.ts
// Unix socket server for the FileScopeMCP LLM broker.
// Accepts client connections on ~/.filescope/broker.sock, parses NDJSON messages,
// routes submit/status to the queue and worker, tracks connections, and sends results back.
// Exports: BrokerServer

import * as net from 'node:net';
import * as readline from 'node:readline';
import { log } from '../logger.js';
import type { BrokerConfig } from './config.js';
import { SOCK_PATH } from './config.js';
import { readStats, accumulateTokens } from './stats.js';
import { PriorityQueue } from './queue.js';
import { BrokerWorker } from './worker.js';
import type {
  SubmitMessage,
  QueueJob,
  JobResult,
  ResultMessage,
  ErrorMessage,
  StatusResponse,
} from './types.js';

// ─── BrokerServer ─────────────────────────────────────────────────────────────

export class BrokerServer {
  private readonly server: net.Server;
  private readonly queue: PriorityQueue;
  private readonly worker: BrokerWorker;
  private readonly config: BrokerConfig;
  private readonly connections: Set<net.Socket> = new Set();
  private repoTokens: Record<string, number> = {};

  constructor(config: BrokerConfig) {
    this.config = config;
    this.queue = new PriorityQueue();
    this.worker = new BrokerWorker(
      config,
      this.queue,
      (job, result) => this.handleJobComplete(job, result),
      (job, code, message) => this.handleJobError(job, code, message),
    );
    this.server = net.createServer((socket) => this.handleConnection(socket));
    this.repoTokens = readStats().repoTokens;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  /** Binds to the Unix socket path and starts the worker loop. Returns when listening. */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject);
      this.server.listen(SOCK_PATH, () => {
        this.server.removeListener('error', reject);
        log(`Broker listening on ${SOCK_PATH}`);
        this.worker.start();
        resolve();
      });
    });
  }

  /**
   * Graceful shutdown sequence (BRKR-03, D-01):
   * 1. Stop worker (prevents new job pickup).
   * 2. Await current job completion OR drain timeout — whichever comes first.
   * 3. Destroy all client connections.
   * 4. Close server (stop accepting new connections).
   */
  async shutdown(drainTimeoutMs: number = 15_000): Promise<void> {
    // 1. Stop worker — prevents new job pickup
    this.worker.stop();

    // 2. Await current job completion with drain timeout (D-01)
    const pending = this.worker.getCurrentJobPromise();
    if (pending) {
      log(`Waiting for current job to finish (drain timeout: ${drainTimeoutMs}ms)...`);
      const drainTimeout = new Promise<void>(resolve => {
        const t = setTimeout(resolve, drainTimeoutMs);
        t.unref(); // Don't prevent process exit if job finishes first
      });
      await Promise.race([pending, drainTimeout]);
    }

    // 3. Destroy all client connections
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    // 4. Close server — stop accepting new connections
    await new Promise<void>((resolve) => this.server.close(() => resolve()));

    log('Broker server shut down');
  }

  // ─── Status accessors (for status_response) ───────────────────────────────

  getConnectedClientCount(): number {
    return this.connections.size;
  }

  getQueue(): PriorityQueue {
    return this.queue;
  }

  getWorker(): BrokerWorker {
    return this.worker;
  }

  // ─── Private: connection handling ─────────────────────────────────────────

  private handleConnection(socket: net.Socket): void {
    this.connections.add(socket);
    log(`Client connected (${this.connections.size} total)`);

    const rl = readline.createInterface({ input: socket, terminal: false });

    rl.on('line', (line: string) => {
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg, socket);
      } catch (err) {
        // Malformed JSON — log and ignore
        log(`Malformed message from client: ${err}`);
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
      // BROKER-11: drop all pending jobs for this connection
      const dropped = this.queue.dropByConnection(socket);
      if (dropped > 0) {
        log(`Client disconnected — dropped ${dropped} pending job(s) (${this.connections.size} remaining)`);
      } else {
        log(`Client disconnected (${this.connections.size} remaining)`);
      }
    });

    socket.on('error', (err) => {
      log(`Client socket error: ${err.message}`);
      // Socket will emit 'close' after error
    });
  }

  // ─── Private: message routing ─────────────────────────────────────────────

  private handleMessage(msg: any, socket: net.Socket): void {
    switch (msg.type) {
      case 'submit':
        this.handleSubmit(msg as SubmitMessage, socket);
        break;
      case 'status':
        this.handleStatus(msg, socket);
        break;
      default:
        log(`Unknown message type: ${msg.type}`);
        break;
    }
  }

  private handleSubmit(msg: SubmitMessage, socket: net.Socket): void {
    // Check queue capacity (BROKER-11 edge case: reject if full)
    if (this.queue.size >= this.config.maxQueueSize) {
      const error: ErrorMessage = {
        type: 'error',
        id: msg.id,
        code: 'queue_full',
        message: `Queue full (${this.config.maxQueueSize} max)`,
        repoPath: msg.repoPath,
        filePath: msg.filePath,
      };
      this.send(socket, error);
      return;
    }

    const job: QueueJob = {
      id: msg.id,
      repoPath: msg.repoPath,
      filePath: msg.filePath,
      jobType: msg.jobType,
      importance: msg.importance,
      fileContent: msg.fileContent,
      payload: msg.payload,
      createdAt: Date.now(),
      cancelled: false,
      connection: socket,
    };

    this.queue.enqueue(job);
    log(`Job received: ${msg.jobType} for ${msg.filePath} (importance=${msg.importance}, queue=${this.queue.size})`);

    // Nudge worker to pick up new work immediately
    this.worker.nudge();
  }

  private handleStatus(msg: any, socket: net.Socket): void {
    const currentJob = this.worker.getCurrentJob();
    const response: StatusResponse = {
      type: 'status_response',
      id: msg.id,
      pendingCount: this.queue.size,
      inProgressJob: currentJob
        ? { repoPath: currentJob.repoPath, filePath: currentJob.filePath, jobType: currentJob.jobType }
        : null,
      connectedClients: this.connections.size,
      repoTokens: { ...this.repoTokens },
    };
    this.send(socket, response);
  }

  // ─── Private: worker callbacks ────────────────────────────────────────────

  private handleJobComplete(job: QueueJob, result: JobResult): void {
    // Accumulate token stats regardless of connection state
    const updated = accumulateTokens(job.repoPath, result.totalTokens);
    this.repoTokens = updated.repoTokens;

    // Pitfall 3: check if connection is still alive before writing
    if (job.connection.destroyed) {
      log(`Job ${job.id} completed but client disconnected — discarding result`);
      return;
    }
    const msg: ResultMessage = {
      type: 'result',
      id: job.id,
      jobType: job.jobType,
      repoPath: job.repoPath,
      filePath: job.filePath,
      text: result.text,
      totalTokens: result.totalTokens,
    };
    this.send(job.connection, msg);
  }

  private handleJobError(job: QueueJob, code: string, message: string): void {
    if (job.connection.destroyed) {
      log(`Job ${job.id} failed but client disconnected — discarding error`);
      return;
    }
    const msg: ErrorMessage = {
      type: 'error',
      id: job.id,
      code: code as ErrorMessage['code'],
      message,
      repoPath: job.repoPath,
      filePath: job.filePath,
    };
    this.send(job.connection, msg);
  }

  // ─── Private: NDJSON write helper ─────────────────────────────────────────

  /** Fire-and-forget NDJSON write. (Pitfall 7: don't await drain) */
  private send(socket: net.Socket, msg: object): void {
    if (!socket.destroyed) {
      socket.write(JSON.stringify(msg) + '\n');
    }
  }
}
