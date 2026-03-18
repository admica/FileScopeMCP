// src/llm/adapter.ts
// Provider factory for the Vercel AI SDK.
// Returns a LanguageModelV2 for either 'anthropic' or 'openai-compatible' providers.
// Per RESEARCH.md Pattern 1.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { LLMConfig } from './types.js';

/**
 * Returns a LanguageModel configured for the provider specified in `config`.
 *
 * - 'anthropic': uses createAnthropic with optional apiKey override; falls back
 *   to ANTHROPIC_API_KEY environment variable if apiKey is not set in config.
 * - 'openai-compatible': uses createOpenAICompatible with baseURL (required) and
 *   apiKey (defaults to 'ollama' — Ollama ignores the key but SDK requires a
 *   non-empty string).
 *
 * Throws on unknown provider values.
 */
export function createLLMModel(config: LLMConfig): LanguageModel {
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
        apiKey: config.apiKey ?? 'ollama', // Ollama ignores the key; SDK requires non-empty string
      });
      return provider(config.model);
    }
    default: {
      // TypeScript exhaustiveness guard — provider type is narrowed, so
      // this path is only reached if a caller bypasses type safety.
      const exhaustiveCheck: never = config.provider;
      throw new Error(`Unknown LLM provider: ${exhaustiveCheck}`);
    }
  }
}
