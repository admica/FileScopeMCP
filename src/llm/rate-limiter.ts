// src/llm/rate-limiter.ts
// TokenBudgetGuard: sliding-window per-minute token counter + lifetime budget.
// Per RESEARCH.md Pattern 4. Hand-rolled for SQLite integration (no npm library needed).
export class TokenBudgetGuard {
  private windowTokens = 0;
  private windowStart = Date.now();
  private lifetimeTokens = 0;
  private exhausted = false;

  private readonly maxTokensPerMinute: number;
  private readonly tokenBudget: number;

  /**
   * @param opts.maxTokensPerMinute - Maximum tokens allowed per 60-second window (default 40000).
   * @param opts.tokenBudget        - Lifetime token cap; 0 = unlimited (default).
   */
  constructor(opts: { maxTokensPerMinute?: number; tokenBudget?: number } = {}) {
    this.maxTokensPerMinute = opts.maxTokensPerMinute ?? 40_000;
    this.tokenBudget = opts.tokenBudget ?? 0; // 0 means unlimited
  }

  /**
   * Returns true if `estimatedTokens` can be consumed right now.
   * Checks both the sliding 60-second window and the lifetime budget.
   * If the guard is already exhausted (lifetime cap hit), always returns false.
   */
  canConsume(estimatedTokens: number): boolean {
    if (this.exhausted) return false;
    this.rotateWindowIfNeeded();

    // Per-minute window check
    if (this.windowTokens + estimatedTokens > this.maxTokensPerMinute) {
      return false;
    }

    // Lifetime budget check (0 = unlimited)
    if (this.tokenBudget > 0 && this.lifetimeTokens + estimatedTokens > this.tokenBudget) {
      return false;
    }

    return true;
  }

  /**
   * Records actual tokens consumed after a successful LLM call.
   * Increments both the window and lifetime counters.
   * Sets exhausted=true if the lifetime budget is reached.
   */
  recordActual(actualTokens: number): void {
    this.windowTokens += actualTokens;
    this.lifetimeTokens += actualTokens;

    if (this.tokenBudget > 0 && this.lifetimeTokens >= this.tokenBudget) {
      this.exhausted = true;
    }
  }

  /**
   * Records an error (no token consumption). Does not increment counters.
   * Exists so callers can use a consistent protocol for success vs. error paths.
   */
  recordError(): void {
    // No token increment — only log (callers handle logging)
  }

  /**
   * Returns true when the lifetime token budget has been exhausted.
   * Circuit breaker: callers should stop queuing jobs when this is true.
   */
  isExhausted(): boolean {
    return this.exhausted;
  }

  /**
   * Resets the per-minute sliding window (NOT the lifetime counter).
   * Called externally if the caller knows 60 seconds have elapsed (e.g. in tests).
   */
  reset(): void {
    this.windowTokens = 0;
    this.windowStart = Date.now();
    // NOTE: exhausted is NOT reset here — only lifetime expiry sets it.
    // rotateWindowIfNeeded() also resets per-minute exhaustion on time rollover.
  }

  /**
   * Returns the lifetime tokens used so far.
   * Used by Plan 03 pipeline to persist state before shutdown.
   */
  getLifetimeTokensUsed(): number {
    return this.lifetimeTokens;
  }

  /**
   * Sets the lifetime tokens used counter (loaded from persisted state on startup).
   * Also rechecks if the budget is already exhausted.
   */
  setLifetimeTokensUsed(n: number): void {
    this.lifetimeTokens = n;
    if (this.tokenBudget > 0 && this.lifetimeTokens >= this.tokenBudget) {
      this.exhausted = true;
    }
  }

  /**
   * Checks if the 60-second window has elapsed and rotates if needed.
   * Resets windowTokens and windowStart; clears per-minute exhaustion state.
   */
  private rotateWindowIfNeeded(): void {
    if (Date.now() - this.windowStart >= 60_000) {
      this.windowTokens = 0;
      this.windowStart = Date.now();
    }
  }
}
