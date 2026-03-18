// src/llm/pipeline.test.ts
// Unit tests for LLMPipeline dequeue loop, exclude, delete, stop behavior, orphan recovery, and budget exhaustion.
// Uses vitest with fake timers and mocked dependencies.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MockedFunction } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../db/repository.js', () => ({
  dequeueNextJob: vi.fn(),
  markJobInProgress: vi.fn(),
  markJobDone: vi.fn(),
  markJobFailed: vi.fn(),
  writeLlmResult: vi.fn(),
  clearStaleness: vi.fn(),
  recoverOrphanedJobs: vi.fn().mockReturnValue(0),
}));

vi.mock('../file-utils.js', () => ({
  isExcluded: vi.fn().mockReturnValue(false),
}));

vi.mock('../global-state.js', () => ({
  getProjectRoot: vi.fn().mockReturnValue('/test/project'),
}));

vi.mock('./adapter.js', () => ({
  createLLMModel: vi.fn().mockReturnValue({ type: 'mock-model' }),
}));

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn().mockReturnValue({ type: 'object-output' }),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  log: vi.fn(),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { LLMPipeline } from './pipeline.js';
import * as repository from '../db/repository.js';
import * as fileUtils from '../file-utils.js';
import * as globalState from '../global-state.js';
import { generateText } from 'ai';
import * as fsPromises from 'fs/promises';

const mockDequeueNextJob = repository.dequeueNextJob as MockedFunction<typeof repository.dequeueNextJob>;
const mockMarkJobInProgress = repository.markJobInProgress as MockedFunction<typeof repository.markJobInProgress>;
const mockMarkJobDone = repository.markJobDone as MockedFunction<typeof repository.markJobDone>;
const mockMarkJobFailed = repository.markJobFailed as MockedFunction<typeof repository.markJobFailed>;
const mockWriteLlmResult = repository.writeLlmResult as MockedFunction<typeof repository.writeLlmResult>;
const mockClearStaleness = repository.clearStaleness as MockedFunction<typeof repository.clearStaleness>;
const mockRecoverOrphanedJobs = repository.recoverOrphanedJobs as MockedFunction<typeof repository.recoverOrphanedJobs>;
const mockIsExcluded = fileUtils.isExcluded as MockedFunction<typeof fileUtils.isExcluded>;
const mockGetProjectRoot = globalState.getProjectRoot as MockedFunction<typeof globalState.getProjectRoot>;
const mockGenerateText = generateText as MockedFunction<typeof generateText>;
const mockReadFile = fsPromises.readFile as MockedFunction<typeof fsPromises.readFile>;

// ─── Test config ──────────────────────────────────────────────────────────────

const TEST_CONFIG = {
  enabled: true,
  provider: 'anthropic' as const,
  model: 'claude-3-haiku-20240307',
  maxTokensPerCall: 512,
};

function makeSummaryJob(overrides = {}) {
  return {
    job_id: 1,
    file_path: '/test/project/src/foo.ts',
    job_type: 'summary',
    priority_tier: 1,
    payload: null,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LLMPipeline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockRecoverOrphanedJobs.mockReturnValue(0);
    mockIsExcluded.mockReturnValue(false);
    mockGetProjectRoot.mockReturnValue('/test/project');
    // Default: queue is empty
    mockDequeueNextJob.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── Test 1: Empty queue — no crash ─────────────────────────────────────

  it('should poll again after POLL_INTERVAL_MS when queue is empty', async () => {
    const pipeline = new LLMPipeline(TEST_CONFIG);
    pipeline.start();

    // First tick: dequeue returns null, schedules next at POLL_INTERVAL_MS
    await vi.advanceTimersByTimeAsync(0);
    expect(mockDequeueNextJob).toHaveBeenCalledTimes(1);
    expect(mockGenerateText).not.toHaveBeenCalled();

    // After POLL_INTERVAL_MS, dequeue is called again
    await vi.advanceTimersByTimeAsync(5000);
    expect(mockDequeueNextJob).toHaveBeenCalledTimes(2);

    pipeline.stop();
  });

  // ─── Test 2: Excluded file — marked done without LLM call ────────────────

  it('should mark excluded file job as done without calling LLM', async () => {
    const job = makeSummaryJob();
    mockDequeueNextJob
      .mockReturnValueOnce(job)
      .mockReturnValue(null);
    mockIsExcluded.mockReturnValue(true);

    const pipeline = new LLMPipeline(TEST_CONFIG);
    pipeline.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(mockIsExcluded).toHaveBeenCalledWith(job.file_path, '/test/project');
    expect(mockMarkJobDone).toHaveBeenCalledWith(job.job_id);
    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockMarkJobInProgress).not.toHaveBeenCalled();

    pipeline.stop();
  });

  // ─── Test 3: Deleted file — marked failed with 'file_deleted' ────────────

  it('should mark job as failed with file_deleted when file does not exist', async () => {
    const job = makeSummaryJob();
    mockDequeueNextJob
      .mockReturnValueOnce(job)
      .mockReturnValue(null);
    mockIsExcluded.mockReturnValue(false);

    // readFile throws ENOENT
    const enoentError = Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValueOnce(enoentError);

    const pipeline = new LLMPipeline(TEST_CONFIG);
    pipeline.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(mockMarkJobInProgress).toHaveBeenCalledWith(job.job_id);
    expect(mockMarkJobFailed).toHaveBeenCalledWith(job.job_id, 'file_deleted');
    expect(mockGenerateText).not.toHaveBeenCalled();

    pipeline.stop();
  });

  // ─── Test 4: stop() prevents further dequeue iterations ──────────────────

  it('should stop dequeue loop when stop() is called', async () => {
    const pipeline = new LLMPipeline(TEST_CONFIG);
    pipeline.start();

    // Let first tick run (returns null → schedules at 5000ms)
    await vi.advanceTimersByTimeAsync(0);
    expect(mockDequeueNextJob).toHaveBeenCalledTimes(1);

    // Stop the pipeline
    pipeline.stop();
    expect(pipeline.isRunning()).toBe(false);

    // Advance past POLL_INTERVAL_MS — should NOT call dequeue again
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockDequeueNextJob).toHaveBeenCalledTimes(1);
  });

  // ─── Test 5: recoverOrphanedJobs called on start() ───────────────────────

  it('should call recoverOrphanedJobs on start()', () => {
    mockRecoverOrphanedJobs.mockReturnValue(3);

    const pipeline = new LLMPipeline(TEST_CONFIG);
    pipeline.start();
    pipeline.stop();

    expect(mockRecoverOrphanedJobs).toHaveBeenCalledTimes(1);
  });

  // ─── Test 6: Budget guard exhaustion causes backoff ───────────────────────

  it('should back off and not call LLM when budget guard is exhausted', async () => {
    const job = makeSummaryJob();
    mockDequeueNextJob
      .mockReturnValueOnce(job)
      .mockReturnValue(null);
    mockIsExcluded.mockReturnValue(false);

    // Exhaust the budget: tokenBudget=1 means after recording 1 token, canConsume returns false
    // We use a very small maxTokensPerMinute to trigger rate limiting
    const config = { ...TEST_CONFIG, maxTokensPerMinute: 1, maxTokensPerCall: 2 };
    const pipeline = new LLMPipeline(config);
    pipeline.start();

    // First tick: budget check should fail (2 tokens > 1 max per minute)
    await vi.advanceTimersByTimeAsync(0);

    expect(mockMarkJobInProgress).not.toHaveBeenCalled();
    expect(mockGenerateText).not.toHaveBeenCalled();
    // Should not mark done either
    expect(mockMarkJobDone).not.toHaveBeenCalled();

    pipeline.stop();
  });

  // ─── Bonus: successful summary job ───────────────────────────────────────

  it('should process a summary job and write result', async () => {
    const job = makeSummaryJob();
    mockDequeueNextJob
      .mockReturnValueOnce(job)
      .mockReturnValue(null);
    mockIsExcluded.mockReturnValue(false);
    mockReadFile.mockResolvedValueOnce('file content here');
    mockGenerateText.mockResolvedValueOnce({
      text: '  Summary text.  ',
      usage: { totalTokens: 100 },
    } as Awaited<ReturnType<typeof generateText>>);

    const pipeline = new LLMPipeline(TEST_CONFIG);
    pipeline.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(mockMarkJobInProgress).toHaveBeenCalledWith(job.job_id);
    expect(mockWriteLlmResult).toHaveBeenCalledWith(job.file_path, 'summary', 'Summary text.');
    expect(mockClearStaleness).toHaveBeenCalledWith(job.file_path, 'summary');
    expect(mockMarkJobDone).toHaveBeenCalledWith(job.job_id);

    pipeline.stop();
  });
});
