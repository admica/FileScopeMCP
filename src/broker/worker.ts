// src/broker/worker.ts
// Serial LLM job processor for the FileScopeMCP broker.
// Dequeues jobs from a PriorityQueue, dispatches to Ollama via adapter/prompts,
// enforces per-job timeout via AbortController, and reports results via callbacks.
// Exports: BrokerWorker

import { generateText, Output } from 'ai';
import type { LanguageModel } from 'ai';
import { createLLMModel } from '../llm/adapter.js';
import { buildSummaryPrompt, buildConceptsPrompt, buildChangeImpactPrompt } from '../llm/prompts.js';
import { ConceptsSchema, ChangeImpactSchema } from '../llm/types.js';
import { log } from '../logger.js';
import type { QueueJob, JobResult } from './types.js';
import type { PriorityQueue } from './queue.js';
import type { BrokerConfig } from './config.js';

// ─── BrokerWorker ─────────────────────────────────────────────────────────────

export class BrokerWorker {
  private readonly model: LanguageModel;
  private readonly config: BrokerConfig;
  private readonly queue: PriorityQueue;
  private stopped: boolean = true;
  private loopTimer: NodeJS.Timeout | null = null;
  private currentJob: QueueJob | null = null;
  private currentJobPromise: Promise<void> | null = null;
  private readonly onJobComplete: (job: QueueJob, result: JobResult) => void;
  private readonly onJobError: (job: QueueJob, code: string, message: string) => void;

  constructor(
    config: BrokerConfig,
    queue: PriorityQueue,
    onJobComplete: (job: QueueJob, result: JobResult) => void,
    onJobError: (job: QueueJob, code: string, message: string) => void,
  ) {
    // Cast config.llm to LLMConfig shape for createLLMModel.
    // BrokerConfig.llm has provider, model, baseURL, apiKey, maxTokensPerCall.
    // LLMConfig additionally has enabled, maxTokensPerMinute, tokenBudget -- not needed by createLLMModel.
    this.model = createLLMModel(config.llm as any);
    this.config = config;
    this.queue = queue;
    this.onJobComplete = onJobComplete;
    this.onJobError = onJobError;
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  start(): void {
    this.stopped = false;
    this.scheduleNext(0);
    log('BrokerWorker started');
  }

  stop(): void {
    this.stopped = true;
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    log('BrokerWorker stopped');
  }

  /** Returns the promise of the currently running job, or null. Used by shutdown to await completion. */
  getCurrentJobPromise(): Promise<void> | null {
    return this.currentJobPromise;
  }

  /** Returns the currently processing job, or null. Used for status reporting. */
  getCurrentJob(): QueueJob | null {
    return this.currentJob;
  }

  /** Notify worker that new work is available — shortcut the poll delay. */
  nudge(): void {
    if (this.stopped || this.currentJob !== null) return;
    if (this.loopTimer !== null) {
      clearTimeout(this.loopTimer);
      this.loopTimer = null;
    }
    this.scheduleNext(0);
  }

  // ─── Private: dequeue loop ────────────────────────────────────────────────

  private async dequeueLoop(): Promise<void> {
    if (this.stopped) return;

    const job = this.queue.dequeue();
    if (job === null) {
      // Queue empty — poll again after 1 second
      this.scheduleNext(1000);
      return;
    }

    this.currentJob = job;
    log(`Processing job ${job.id} (${job.jobType}) for ${job.filePath}`);

    this.currentJobPromise = (async () => {
      try {
        const result = await this.runJobWithTimeout(job, this.config.jobTimeoutMs);
        this.onJobComplete(job, result);
        log(`Completed job ${job.id} (${job.jobType}) for ${job.filePath} — ${result.totalTokens} tokens`);
      } catch (err: any) {
        const isTimeout = err.name === 'AbortError';
        const code = isTimeout ? 'timeout' : 'ollama_error';
        const message = isTimeout
          ? `Job timed out after ${this.config.jobTimeoutMs}ms`
          : String(err.message || err);
        this.onJobError(job, code, message);
        log(`Failed job ${job.id} (${job.jobType}) for ${job.filePath} — ${code}: ${message}`);
      } finally {
        this.currentJob = null;
        this.currentJobPromise = null;
      }
    })();

    await this.currentJobPromise;

    // Fast drain: schedule next tick with minimal delay (50ms settle)
    this.scheduleNext(50);
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) return;
    this.loopTimer = setTimeout(() => void this.dequeueLoop(), delayMs);
    this.loopTimer.unref(); // Don't prevent process exit
  }

  // ─── Private: timeout wrapper ─────────────────────────────────────────────

  /** BROKER-09: Enforce per-job timeout via AbortController. */
  private async runJobWithTimeout(job: QueueJob, timeoutMs: number): Promise<JobResult> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    timer.unref();
    try {
      return await this.runJob(job, ac.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Private: job dispatch ────────────────────────────────────────────────

  /**
   * Dispatches a single job to Ollama.
   * Mirrors pipeline.ts runJob() pattern but:
   * 1. Uses job.fileContent instead of reading from disk (content arrives from client).
   * 2. Uses job.payload for change_impact diff text.
   * 3. Threads abortSignal through every generateText call.
   * 4. Re-throws AbortError before fallback attempt (Pitfall 5 from RESEARCH.md).
   */
  private async runJob(job: QueueJob, signal: AbortSignal): Promise<JobResult> {
    const maxOutputTokens = this.config.llm.maxTokensPerCall ?? 1024;

    switch (job.jobType) {
      case 'summary': {
        const { text, usage } = await generateText({
          model: this.model,
          prompt: buildSummaryPrompt(job.filePath, job.fileContent),
          maxOutputTokens,
          abortSignal: signal,
        });
        return { text: text.trim(), totalTokens: usage?.totalTokens ?? 0 };
      }

      case 'concepts': {
        try {
          const { output, usage } = await generateText({
            model: this.model,
            output: Output.object({ schema: ConceptsSchema }),
            prompt: buildConceptsPrompt(job.filePath, job.fileContent),
            maxOutputTokens,
            abortSignal: signal,
          });
          return { text: JSON.stringify(output), totalTokens: usage?.totalTokens ?? 0 };
        } catch (err: any) {
          // CRITICAL: re-throw AbortError before entering fallback (RESEARCH.md Pitfall 5)
          if (err.name === 'AbortError') throw err;
          // Ollama JSON repair fallback
          log(`BrokerWorker: structured output failed for concepts job ${job.id}, falling back to plain text — ${err}`);
          const { text, usage } = await generateText({
            model: this.model,
            prompt: buildConceptsPrompt(job.filePath, job.fileContent),
            maxOutputTokens,
            abortSignal: signal,
          });
          const parsed = JSON.parse(text.trim());
          return { text: JSON.stringify(parsed), totalTokens: usage?.totalTokens ?? 0 };
        }
      }

      case 'change_impact': {
        if (!job.payload) {
          throw Object.assign(new Error('no payload (diff text) for change_impact job'), { name: 'parse_error' });
        }
        try {
          const { output, usage } = await generateText({
            model: this.model,
            output: Output.object({ schema: ChangeImpactSchema }),
            prompt: buildChangeImpactPrompt(job.filePath, job.payload),
            maxOutputTokens,
            abortSignal: signal,
          });
          return { text: JSON.stringify(output), totalTokens: usage?.totalTokens ?? 0 };
        } catch (err: any) {
          // CRITICAL: re-throw AbortError before entering fallback (RESEARCH.md Pitfall 5)
          if (err.name === 'AbortError') throw err;
          // Ollama JSON repair fallback
          log(`BrokerWorker: structured output failed for change_impact job ${job.id}, falling back to plain text — ${err}`);
          const { text, usage } = await generateText({
            model: this.model,
            prompt: buildChangeImpactPrompt(job.filePath, job.payload),
            maxOutputTokens,
            abortSignal: signal,
          });
          const parsed = JSON.parse(text.trim());
          return { text: JSON.stringify(parsed), totalTokens: usage?.totalTokens ?? 0 };
        }
      }

      default: {
        // TypeScript exhaustiveness guard
        const exhaustive: never = job.jobType;
        throw new Error(`Unknown job type: ${exhaustive}`);
      }
    }
  }
}
