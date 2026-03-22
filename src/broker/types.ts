// src/broker/types.ts
// Wire protocol message types, internal job shapes, and helpers for the FileScopeMCP LLM broker.
// Exports: SubmitMessage, StatusMessage, ClientMessage, ResultMessage, ErrorMessage, BrokerMessage,
//          QueueJob, JobResult, StatusResponse, dedupKey

import type * as net from 'node:net';

// ─── Client → Broker messages ─────────────────────────────────────────────────

export type SubmitMessage = {
  type: 'submit';
  id: string;           // client-generated correlation ID
  repoPath: string;
  filePath: string;
  jobType: 'summary' | 'concepts' | 'change_impact';
  importance: number;   // 0-10
  fileContent: string;  // file contents -- broker builds prompts
  payload?: string;     // diff text for change_impact jobs
};

export type StatusMessage = {
  type: 'status';
  id: string;
};

export type ClientMessage = SubmitMessage | StatusMessage;

// ─── Broker → Client messages ─────────────────────────────────────────────────

export type ResultMessage = {
  type: 'result';
  id: string;
  jobType: 'summary' | 'concepts' | 'change_impact';
  repoPath: string;
  filePath: string;
  text: string;          // LLM output
  totalTokens: number;
};

export type ErrorMessage = {
  type: 'error';
  id: string;
  code: 'timeout' | 'queue_full' | 'ollama_error' | 'parse_error';
  message: string;
  repoPath?: string;
  filePath?: string;
};

export type BrokerMessage = ResultMessage | ErrorMessage;

// ─── Internal queue job type ──────────────────────────────────────────────────

export type QueueJob = {
  id: string;            // client correlation ID
  repoPath: string;
  filePath: string;
  jobType: 'summary' | 'concepts' | 'change_impact';
  importance: number;
  fileContent: string;
  payload?: string;
  createdAt: number;     // Date.now() timestamp
  cancelled: boolean;    // lazy deletion flag for heap
  connection: net.Socket; // reference to submitting client's socket
};

// ─── Job result type (returned by worker) ────────────────────────────────────

export type JobResult = {
  text: string;
  totalTokens: number;
};

// ─── Status response (Phase 19 enriches) ─────────────────────────────────────

export type StatusResponse = {
  type: 'status_response';
  id: string;
  pendingCount: number;
  inProgressJob: { repoPath: string; filePath: string; jobType: string } | null;
  connectedClients: number;
};

// ─── Dedup key helper ─────────────────────────────────────────────────────────

export function dedupKey(repoPath: string, filePath: string, jobType: string): string {
  return `${repoPath}|${filePath}|${jobType}`;
}
