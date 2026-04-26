// src/broker/worker.ts
// Serial LLM job processor for the FileScopeMCP broker.
// Dequeues jobs from a PriorityQueue, dispatches to the LLM via the ai SDK,
// enforces per-job timeout via AbortController, and reports results via callbacks.
// Exports: BrokerWorker

import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  SYSTEM_PROMPT,
  buildSummaryPrompt,
  buildConceptsPrompt,
  buildChangeImpactPrompt,
} from '../llm/prompts.js';
import { log } from '../logger.js';
import type { QueueJob, JobResult } from './types.js';
import type { PriorityQueue } from './queue.js';

/**
 * Normalize raw LLM output before consumption:
 *  1. Strip <think>...</think> / <thought>...</thought> blocks — Qwen3-class
 *     models may emit these even when thinking is nominally off.
 *  2. Strip ```json ... ``` fences that small models add despite instructions.
 */
function normalizeOutput(text: string): string {
  const noThink = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  return noThink
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
}
import type { BrokerConfig } from './config.js';

// ─── LLM model factory ────────────────────────────────────────────────────────

/**
 * Returns a LanguageModel configured for the provider specified in `config`.
 * Inlined from the deleted llm/adapter.ts — broker/worker.ts is the sole user.
 */
function createLLMModel(config: BrokerConfig['llm']): LanguageModel {
  switch (config.provider) {
    case 'anthropic': {
      const provider = createAnthropic({
        apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY,
      });
      return provider(config.model);
    }
    case 'openai-compatible': {
      const provider = createOpenAICompatible({
        name: 'custom',
        baseURL: config.baseURL!,
        apiKey: config.apiKey ?? 'llama',
      });
      return provider(config.model);
    }
    default: {
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown LLM provider: ${exhaustiveCheck}`);
    }
  }
}

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
    this.model = createLLMModel(config.llm);
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
        const code = isTimeout ? 'timeout' : 'llm_error';
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
   * Dispatches a single job to the LLM backend.
   * 1. Uses job.fileContent instead of reading from disk (content arrives from client).
   * 2. Uses job.payload for change_impact diff text.
   * 3. Threads abortSignal through every generateText call.
   * 4. Injects SYSTEM_PROMPT on every request (previously baked into an Ollama
   *    Modelfile; now lives in source and travels with each call).
   */
  private async runJob(job: QueueJob, signal: AbortSignal): Promise<JobResult> {
    const maxOutputTokens = this.config.llm.maxTokensPerCall ?? 1024;

    switch (job.jobType) {
      case 'summary': {
        const { text, usage } = await generateText({
          model: this.model,
          system: SYSTEM_PROMPT,
          prompt: buildSummaryPrompt(job.filePath, job.fileContent),
          maxOutputTokens,
          abortSignal: signal,
        });
        return { text: normalizeOutput(text), totalTokens: usage?.totalTokens ?? 0 };
      }

      case 'concepts': {
        const { text, usage } = await generateText({
          model: this.model,
          system: SYSTEM_PROMPT,
          prompt: buildConceptsPrompt(job.filePath, job.fileContent),
          maxOutputTokens,
          abortSignal: signal,
        });
        const conceptsParsed = JSON.parse(normalizeOutput(text));
        return { text: JSON.stringify(conceptsParsed), totalTokens: usage?.totalTokens ?? 0 };
      }

      case 'change_impact': {
        if (!job.payload) {
          throw Object.assign(new Error('no payload (diff text) for change_impact job'), { name: 'parse_error' });
        }
        const { text, usage } = await generateText({
          model: this.model,
          system: SYSTEM_PROMPT,
          prompt: buildChangeImpactPrompt(job.filePath, job.payload),
          maxOutputTokens,
          abortSignal: signal,
        });
        const impactParsed = JSON.parse(normalizeOutput(text));
        return { text: JSON.stringify(impactParsed), totalTokens: usage?.totalTokens ?? 0 };
      }

      default: {
        // TypeScript exhaustiveness guard
        const exhaustive: never = job.jobType;
        throw new Error(`Unknown job type: ${exhaustive}`);
      }
    }
  }
}
