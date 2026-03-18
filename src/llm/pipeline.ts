// src/llm/pipeline.ts
// LLMPipeline: dequeues llm_jobs, runs LLM calls via adapter, writes results to SQLite.
// Handles all 3 job types: summary, concepts, change_impact.
// Per Phase 5 Plan 02.
import * as fs from 'fs/promises';
import { generateText, Output } from 'ai';
import type { LanguageModel } from 'ai';
import { createLLMModel } from './adapter.js';
import { TokenBudgetGuard } from './rate-limiter.js';
import type { LLMConfig } from './types.js';
import { ConceptsSchema, ChangeImpactSchema } from './types.js';
import { buildSummaryPrompt, buildConceptsPrompt, buildChangeImpactPrompt } from './prompts.js';
import {
  dequeueNextJob,
  markJobInProgress,
  markJobDone,
  markJobFailed,
  writeLlmResult,
  clearStaleness,
  recoverOrphanedJobs,
} from '../db/repository.js';
import { isExcluded } from '../file-utils.js';
import { getProjectRoot } from '../global-state.js';
import { log } from '../logger.js';

// ─── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5000;  // 5 seconds when queue empty
const BACKOFF_MS = 30_000;       // 30 seconds when rate limited

// ─── Internal types ───────────────────────────────────────────────────────────

interface JobRunResult {
  text: string;
  totalTokens: number;
}

type DequeueJob = NonNullable<ReturnType<typeof dequeueNextJob>>;

// ─── LLMPipeline ─────────────────────────────────────────────────────────────

/**
 * LLMPipeline dequeues pending llm_jobs and dispatches them to the LLM via adapter.
 * Results are written back to SQLite and staleness flags are cleared.
 *
 * Lifecycle:
 *   - start() → recovers orphaned jobs, starts dequeue loop
 *   - stop()  → stops loop cleanly (does not abort in-flight call)
 */
export class LLMPipeline {
  private readonly model: LanguageModel;
  private readonly budgetGuard: TokenBudgetGuard;
  private readonly config: LLMConfig;
  private stopped: boolean = true;
  private loopTimer: NodeJS.Timeout | null = null;

  constructor(config: LLMConfig) {
    this.config = config;
    this.model = createLLMModel(config);
    this.budgetGuard = new TokenBudgetGuard({
      maxTokensPerMinute: config.maxTokensPerMinute,
      tokenBudget: config.tokenBudget,
    });
  }

  /**
   * Starts the pipeline dequeue loop.
   * Recovers any in_progress jobs left over from a previous crash.
   */
  start(): void {
    this.stopped = false;
    const recovered = recoverOrphanedJobs();
    if (recovered > 0) {
      log(`LLMPipeline: recovered ${recovered} orphaned job(s) to pending`);
    }
    this.scheduleNext(0);
    log('LLMPipeline started');
  }

  /**
   * Stops the pipeline. In-flight LLM calls are not cancelled.
   * The next scheduled tick will see stopped=true and exit the loop.
   */
  stop(): void {
    this.stopped = true;
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    log('LLMPipeline stopped');
  }

  /** Returns true if the pipeline is running. */
  isRunning(): boolean {
    return !this.stopped;
  }

  /**
   * Returns the TokenBudgetGuard for Plan 03 persistence wiring.
   * Allows callers to persist/restore lifetime token usage.
   */
  getBudgetGuard(): TokenBudgetGuard {
    return this.budgetGuard;
  }

  // ─── Private methods ──────────────────────────────────────────────────────

  /**
   * Core dequeue loop body. Self-scheduling via scheduleNext to allow backpressure.
   * NOT setInterval — each iteration waits for the previous to finish.
   */
  private async dequeueLoop(): Promise<void> {
    if (this.stopped) return;

    const job = dequeueNextJob();

    if (job === null) {
      // Queue empty — poll again after POLL_INTERVAL_MS
      this.scheduleNext(POLL_INTERVAL_MS);
      return;
    }

    // COMPAT-02: skip excluded files
    const projectRoot = getProjectRoot();
    if (projectRoot && isExcluded(job.file_path, projectRoot)) {
      log(`LLMPipeline: skipping excluded file ${job.file_path} (job ${job.job_id})`);
      markJobDone(job.job_id);
      this.scheduleNext(500);
      return;
    }

    // Rate limit check
    const estimatedTokens = this.config.maxTokensPerCall ?? 1024;
    if (!this.budgetGuard.canConsume(estimatedTokens)) {
      log(`LLMPipeline: rate limit / budget hit — backing off ${BACKOFF_MS}ms`);
      this.scheduleNext(BACKOFF_MS);
      return;
    }

    markJobInProgress(job.job_id);

    try {
      const result = await this.runJob(job);
      writeLlmResult(job.file_path, job.job_type, result.text);
      clearStaleness(job.file_path, job.job_type);
      markJobDone(job.job_id);
      this.budgetGuard.recordActual(result.totalTokens);
      log(`LLMPipeline: completed job ${job.job_id} (${job.job_type}) for ${job.file_path}`);
    } catch (err) {
      markJobFailed(job.job_id, String(err));
      this.budgetGuard.recordError();
      log(`LLMPipeline: job ${job.job_id} failed — ${err}`);
    }

    // Fast drain: schedule next tick immediately
    this.scheduleNext(500);
  }

  /**
   * Executes a single job by type, returns { text, totalTokens }.
   * Handles file reads, structured output, and Ollama JSON repair fallback.
   */
  private async runJob(job: DequeueJob): Promise<JobRunResult> {
    switch (job.job_type) {
      case 'summary': {
        const content = await this.readFileOrFail(job);
        const { text, usage } = await generateText({
          model: this.model,
          prompt: buildSummaryPrompt(job.file_path, content),
          maxOutputTokens: this.config.maxTokensPerCall ?? 1024,
        });
        return { text: text.trim(), totalTokens: usage?.totalTokens ?? 0 };
      }

      case 'concepts': {
        const content = await this.readFileOrFail(job);
        try {
          const { output, usage } = await generateText({
            model: this.model,
            output: Output.object({ schema: ConceptsSchema }),
            prompt: buildConceptsPrompt(job.file_path, content),
            maxOutputTokens: this.config.maxTokensPerCall ?? 1024,
          });
          return { text: JSON.stringify(output), totalTokens: usage?.totalTokens ?? 0 };
        } catch (structErr) {
          // Ollama JSON repair fallback (RESEARCH.md Pitfall 2)
          log(`LLMPipeline: structured output failed for concepts job ${job.job_id}, falling back to plain text — ${structErr}`);
          const { text, usage } = await generateText({
            model: this.model,
            prompt: buildConceptsPrompt(job.file_path, content),
            maxOutputTokens: this.config.maxTokensPerCall ?? 1024,
          });
          // Attempt to parse the plain text as JSON
          const parsed = JSON.parse(text.trim());
          return { text: JSON.stringify(parsed), totalTokens: usage?.totalTokens ?? 0 };
        }
      }

      case 'change_impact': {
        if (!job.payload) {
          const err = new Error('no_payload');
          markJobFailed(job.job_id, 'no_payload');
          throw err;
        }
        try {
          const { output, usage } = await generateText({
            model: this.model,
            output: Output.object({ schema: ChangeImpactSchema }),
            prompt: buildChangeImpactPrompt(job.file_path, job.payload),
            maxOutputTokens: this.config.maxTokensPerCall ?? 1024,
          });
          return { text: JSON.stringify(output), totalTokens: usage?.totalTokens ?? 0 };
        } catch (structErr) {
          // Ollama JSON repair fallback (RESEARCH.md Pitfall 2)
          log(`LLMPipeline: structured output failed for change_impact job ${job.job_id}, falling back to plain text — ${structErr}`);
          const { text, usage } = await generateText({
            model: this.model,
            prompt: buildChangeImpactPrompt(job.file_path, job.payload),
            maxOutputTokens: this.config.maxTokensPerCall ?? 1024,
          });
          const parsed = JSON.parse(text.trim());
          return { text: JSON.stringify(parsed), totalTokens: usage?.totalTokens ?? 0 };
        }
      }

      default: {
        throw new Error(`Unknown job type: ${(job as DequeueJob).job_type}`);
      }
    }
  }

  /**
   * Reads file content, or handles ENOENT by marking job failed and throwing.
   */
  private async readFileOrFail(job: DequeueJob): Promise<string> {
    try {
      return await fs.readFile(job.file_path, 'utf-8');
    } catch (err: unknown) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr.code === 'ENOENT') {
        markJobFailed(job.job_id, 'file_deleted');
        clearStaleness(job.file_path, job.job_type);
        throw new Error('file_deleted');
      }
      throw err;
    }
  }

  /**
   * Schedules the next dequeue loop tick.
   * Uses .unref() to prevent keeping the event loop alive during shutdown.
   */
  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.loopTimer = setTimeout(() => void this.dequeueLoop(), delayMs);
    this.loopTimer.unref();
  }
}
