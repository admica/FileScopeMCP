// src/broker/queue.ts
// In-memory priority queue with binary heap, dedup map, and lazy deletion for the FileScopeMCP LLM broker.
// Exports: PriorityQueue

import type * as net from 'node:net';
import type { QueueJob } from './types.js';
import { dedupKey } from './types.js';

// ─── Comparator ───────────────────────────────────────────────────────────────

// Returns negative when a should be dequeued BEFORE b.
// importance DESC (higher = dequeue first), createdAt ASC (older = dequeue first at same importance)
function compare(a: QueueJob, b: QueueJob): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  return a.createdAt - b.createdAt;
}

// ─── PriorityQueue ────────────────────────────────────────────────────────────

export class PriorityQueue {
  private heap: QueueJob[] = [];
  private dedupMap: Map<string, QueueJob> = new Map();

  /**
   * Active job count. The dedup map is the source of truth — not heap.length,
   * which may contain cancelled ghost entries awaiting lazy deletion.
   */
  get size(): number {
    return this.dedupMap.size;
  }

  /**
   * Add a job to the queue. If a job with the same (repoPath, filePath, jobType)
   * is already pending, the old entry is marked cancelled (lazy deletion) and
   * the new job replaces it in the dedup map (BROKER-06).
   */
  enqueue(job: QueueJob): void {
    const key = dedupKey(job.repoPath, job.filePath, job.jobType);
    const existing = this.dedupMap.get(key);
    if (existing) {
      existing.cancelled = true;
    }
    this.dedupMap.set(key, job);
    this.heapPush(job);
  }

  /**
   * Remove and return the highest-priority active job, or null if the queue
   * is empty. Skips cancelled heap entries (lazy deletion).
   */
  dequeue(): QueueJob | null {
    while (this.heap.length > 0) {
      const job = this.heapPop()!;
      const key = dedupKey(job.repoPath, job.filePath, job.jobType);
      if (!job.cancelled && this.dedupMap.get(key) === job) {
        // Pitfall 4: remove from dedup map immediately on dequeue so the slot
        // is available for a new submission with the same key.
        this.dedupMap.delete(key);
        return job;
      }
    }
    return null;
  }

  /**
   * Mark all pending jobs for the given connection as cancelled and remove them
   * from the dedup map (BROKER-11). Returns the number of jobs dropped.
   */
  dropByConnection(connection: net.Socket): number {
    let dropped = 0;
    for (const [key, job] of this.dedupMap) {
      if (job.connection === connection) {
        job.cancelled = true;
        this.dedupMap.delete(key);
        dropped++;
      }
    }
    return dropped;
  }

  /**
   * Peek at the highest-priority active job without removing it.
   * Used for status reporting.
   */
  peek(): QueueJob | null {
    for (let i = 0; i < this.heap.length; i++) {
      const job = this.heap[i];
      const key = dedupKey(job.repoPath, job.filePath, job.jobType);
      if (!job.cancelled && this.dedupMap.has(key)) {
        return job;
      }
    }
    return null;
  }

  // ─── Binary min-heap internals ──────────────────────────────────────────────

  private heapPush(job: QueueJob): void {
    this.heap.push(job);
    this.siftUp(this.heap.length - 1);
  }

  private heapPop(): QueueJob | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (compare(this.heap[i], this.heap[parent]) >= 0) break;
      [this.heap[i], this.heap[parent]] = [this.heap[parent], this.heap[i]];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && compare(this.heap[left], this.heap[smallest]) < 0) smallest = left;
      if (right < n && compare(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest === i) break;
      [this.heap[i], this.heap[smallest]] = [this.heap[smallest], this.heap[i]];
      i = smallest;
    }
  }
}
