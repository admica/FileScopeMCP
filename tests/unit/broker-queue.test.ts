// tests/unit/broker-queue.test.ts
// Comprehensive tests for the PriorityQueue binary heap implementation.
// Tests ordering, dedup, lazy deletion, dropByConnection, peek, size tracking.
import { describe, it, expect, beforeEach } from 'vitest';
import { PriorityQueue } from '../../src/broker/queue.js';
import type { QueueJob } from '../../src/broker/types.js';
import { dedupKey } from '../../src/broker/types.js';
import type { Socket } from 'net';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let nextId = 0;

function mockSocket(): Socket {
  return { id: `sock-${nextId++}` } as unknown as Socket;
}

function makeJob(overrides: Partial<QueueJob> = {}): QueueJob {
  const id = `job-${nextId++}`;
  return {
    id,
    repoPath: '/repo',
    filePath: `/repo/file-${id}.ts`,
    jobType: 'summary',
    importance: 5,
    fileContent: 'content',
    createdAt: Date.now(),
    cancelled: false,
    connection: mockSocket(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Basic operations
// ═══════════════════════════════════════════════════════════════════════════════

describe('PriorityQueue basic operations', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('starts empty with size 0', () => {
    expect(queue.size).toBe(0);
  });

  it('dequeue returns null on empty queue', () => {
    expect(queue.dequeue()).toBeNull();
  });

  it('peek returns null on empty queue', () => {
    expect(queue.peek()).toBeNull();
  });

  it('enqueue increments size', () => {
    queue.enqueue(makeJob());
    expect(queue.size).toBe(1);
    queue.enqueue(makeJob());
    expect(queue.size).toBe(2);
  });

  it('dequeue decrements size', () => {
    queue.enqueue(makeJob());
    queue.enqueue(makeJob());
    queue.dequeue();
    expect(queue.size).toBe(1);
  });

  it('enqueue then dequeue returns the job', () => {
    const job = makeJob();
    queue.enqueue(job);
    const result = queue.dequeue();
    expect(result).not.toBeNull();
    expect(result!.id).toBe(job.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Priority ordering
// ═══════════════════════════════════════════════════════════════════════════════

describe('PriorityQueue ordering', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('higher importance dequeues before lower', () => {
    const low = makeJob({ importance: 1 });
    const high = makeJob({ importance: 10 });

    queue.enqueue(low);
    queue.enqueue(high);

    const first = queue.dequeue();
    expect(first!.importance).toBe(10);

    const second = queue.dequeue();
    expect(second!.importance).toBe(1);
  });

  it('same importance: older createdAt dequeues first', () => {
    const older = makeJob({ importance: 5, createdAt: 1000 });
    const newer = makeJob({ importance: 5, createdAt: 2000 });

    queue.enqueue(newer);
    queue.enqueue(older);

    const first = queue.dequeue();
    expect(first!.createdAt).toBe(1000);

    const second = queue.dequeue();
    expect(second!.createdAt).toBe(2000);
  });

  it('correctly orders many jobs by importance DESC', () => {
    const importances = [3, 8, 1, 10, 5, 7, 2, 9, 4, 6];
    for (const imp of importances) {
      queue.enqueue(makeJob({ importance: imp }));
    }

    const dequeued: number[] = [];
    let job;
    while ((job = queue.dequeue()) !== null) {
      dequeued.push(job.importance);
    }

    // Should be sorted descending
    expect(dequeued).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('mixed importance and time: importance wins over age', () => {
    const oldLow = makeJob({ importance: 1, createdAt: 100 });
    const newHigh = makeJob({ importance: 10, createdAt: 9999 });

    queue.enqueue(oldLow);
    queue.enqueue(newHigh);

    const first = queue.dequeue();
    expect(first!.importance).toBe(10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Deduplication
// ═══════════════════════════════════════════════════════════════════════════════

describe('PriorityQueue dedup', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('duplicate key replaces old entry (size stays 1)', () => {
    const socket = mockSocket();
    const job1 = makeJob({ repoPath: '/r', filePath: '/r/f.ts', jobType: 'summary', connection: socket });
    const job2 = makeJob({ repoPath: '/r', filePath: '/r/f.ts', jobType: 'summary', connection: socket });

    queue.enqueue(job1);
    queue.enqueue(job2);

    // Old job is cancelled, new job replaces it — size is 1
    expect(queue.size).toBe(1);
  });

  it('duplicate key: dequeue returns the newer job', () => {
    const socket = mockSocket();
    const job1 = makeJob({
      repoPath: '/r', filePath: '/r/f.ts', jobType: 'summary',
      importance: 5, connection: socket,
    });
    const job2 = makeJob({
      repoPath: '/r', filePath: '/r/f.ts', jobType: 'summary',
      importance: 8, connection: socket,
    });

    queue.enqueue(job1);
    queue.enqueue(job2);

    const result = queue.dequeue();
    expect(result!.id).toBe(job2.id);
  });

  it('different jobTypes on same file are NOT duplicates', () => {
    const socket = mockSocket();
    const summary = makeJob({ repoPath: '/r', filePath: '/r/f.ts', jobType: 'summary', connection: socket });
    const concepts = makeJob({ repoPath: '/r', filePath: '/r/f.ts', jobType: 'concepts', connection: socket });

    queue.enqueue(summary);
    queue.enqueue(concepts);

    expect(queue.size).toBe(2);
  });

  it('different filePaths are NOT duplicates', () => {
    const socket = mockSocket();
    const a = makeJob({ repoPath: '/r', filePath: '/r/a.ts', jobType: 'summary', connection: socket });
    const b = makeJob({ repoPath: '/r', filePath: '/r/b.ts', jobType: 'summary', connection: socket });

    queue.enqueue(a);
    queue.enqueue(b);

    expect(queue.size).toBe(2);
  });

  it('different repoPaths are NOT duplicates', () => {
    const socket = mockSocket();
    const r1 = makeJob({ repoPath: '/repo1', filePath: '/repo1/f.ts', jobType: 'summary', connection: socket });
    const r2 = makeJob({ repoPath: '/repo2', filePath: '/repo2/f.ts', jobType: 'summary', connection: socket });

    queue.enqueue(r1);
    queue.enqueue(r2);

    expect(queue.size).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Lazy deletion (cancelled jobs skipped during dequeue)
// ═══════════════════════════════════════════════════════════════════════════════

describe('PriorityQueue lazy deletion', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('cancelled job is skipped on dequeue', () => {
    const socket = mockSocket();
    const job1 = makeJob({
      repoPath: '/r', filePath: '/r/a.ts', jobType: 'summary',
      importance: 10, connection: socket,
    });
    const job2 = makeJob({
      repoPath: '/r', filePath: '/r/b.ts', jobType: 'summary',
      importance: 5, connection: socket,
    });

    queue.enqueue(job1);
    queue.enqueue(job2);

    // Cancel job1 by re-enqueuing with same key but different importance
    const replacement = makeJob({
      repoPath: '/r', filePath: '/r/a.ts', jobType: 'summary',
      importance: 1, connection: socket,
    });
    queue.enqueue(replacement);

    // First dequeue: should be job2 (importance 5), because job1 (importance 10) was cancelled
    const first = queue.dequeue();
    expect(first!.id).toBe(job2.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// dropByConnection
// ═══════════════════════════════════════════════════════════════════════════════

describe('PriorityQueue dropByConnection', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('drops all jobs for a specific connection', () => {
    const socketA = mockSocket();
    const socketB = mockSocket();

    queue.enqueue(makeJob({ connection: socketA }));
    queue.enqueue(makeJob({ connection: socketA }));
    queue.enqueue(makeJob({ connection: socketB }));

    const dropped = queue.dropByConnection(socketA);

    expect(dropped).toBe(2);
    expect(queue.size).toBe(1);
  });

  it('returns 0 when no jobs match', () => {
    const socketA = mockSocket();
    const socketB = mockSocket();

    queue.enqueue(makeJob({ connection: socketA }));

    const dropped = queue.dropByConnection(socketB);
    expect(dropped).toBe(0);
    expect(queue.size).toBe(1);
  });

  it('dropped jobs are not returned by dequeue', () => {
    const socket = mockSocket();
    const job = makeJob({ connection: socket, importance: 10 });
    const otherJob = makeJob({ importance: 1 });

    queue.enqueue(job);
    queue.enqueue(otherJob);

    queue.dropByConnection(socket);

    const result = queue.dequeue();
    expect(result!.id).toBe(otherJob.id);
  });

  it('empty queue returns 0', () => {
    expect(queue.dropByConnection(mockSocket())).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// peek
// ═══════════════════════════════════════════════════════════════════════════════

describe('PriorityQueue peek', () => {
  let queue: PriorityQueue;

  beforeEach(() => {
    queue = new PriorityQueue();
  });

  it('peek returns highest-priority job without removing it', () => {
    const low = makeJob({ importance: 1 });
    const high = makeJob({ importance: 10 });

    queue.enqueue(low);
    queue.enqueue(high);

    const peeked = queue.peek();
    expect(peeked!.importance).toBe(10);
    expect(queue.size).toBe(2); // Not removed
  });

  it('peek skips cancelled entries', () => {
    const socket = mockSocket();
    const job1 = makeJob({ repoPath: '/r', filePath: '/r/a.ts', jobType: 'summary', importance: 10, connection: socket });
    const job2 = makeJob({ importance: 5 });

    queue.enqueue(job1);
    queue.enqueue(job2);

    // Cancel job1 by re-enqueuing
    queue.enqueue(makeJob({ repoPath: '/r', filePath: '/r/a.ts', jobType: 'summary', importance: 1, connection: socket }));

    const peeked = queue.peek();
    expect(peeked!.importance).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// dedupKey helper
// ═══════════════════════════════════════════════════════════════════════════════

describe('dedupKey', () => {
  it('produces consistent key for same inputs', () => {
    const key1 = dedupKey('/repo', '/repo/file.ts', 'summary');
    const key2 = dedupKey('/repo', '/repo/file.ts', 'summary');
    expect(key1).toBe(key2);
  });

  it('produces different keys for different jobTypes', () => {
    const k1 = dedupKey('/r', '/r/f.ts', 'summary');
    const k2 = dedupKey('/r', '/r/f.ts', 'concepts');
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different filePaths', () => {
    const k1 = dedupKey('/r', '/r/a.ts', 'summary');
    const k2 = dedupKey('/r', '/r/b.ts', 'summary');
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different repoPaths', () => {
    const k1 = dedupKey('/r1', '/r1/f.ts', 'summary');
    const k2 = dedupKey('/r2', '/r2/f.ts', 'summary');
    expect(k1).not.toBe(k2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Stress test
// ═══════════════════════════════════════════════════════════════════════════════

describe('PriorityQueue stress', () => {
  it('handles 1000 enqueue/dequeue cycles correctly', () => {
    const queue = new PriorityQueue();
    const jobs: QueueJob[] = [];

    for (let i = 0; i < 1000; i++) {
      jobs.push(makeJob({ importance: Math.floor(Math.random() * 10) }));
    }

    for (const job of jobs) {
      queue.enqueue(job);
    }

    expect(queue.size).toBe(1000);

    let lastImportance = Infinity;
    let count = 0;
    let job;
    while ((job = queue.dequeue()) !== null) {
      // Importance should be non-increasing
      expect(job.importance).toBeLessThanOrEqual(lastImportance);
      lastImportance = job.importance;
      count++;
    }

    expect(count).toBe(1000);
    expect(queue.size).toBe(0);
  });
});
