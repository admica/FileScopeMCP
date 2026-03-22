// src/llm/types.ts
// LLM configuration types and structured output schemas for FileScopeMCP Phase 5.
// Exports: LLMConfig interface, Zod schemas for concepts/change_impact, inferred types.
import { z } from 'zod';

// ─── LLM Configuration ────────────────────────────────────────────────────────

/**
 * LLM instance configuration. Stored in the top-level config file under `llm`.
 * Model and provider config has moved to ~/.filescope/broker.json.
 */
export interface LLMConfig {
  enabled?: boolean;
}

/**
 * Zod schema for LLMConfig — used in config-utils.ts ConfigSchema.
 */
export const LLMConfigSchema = z.object({
  enabled: z.boolean().optional(),
}).optional();

// ─── Structured output schemas ─────────────────────────────────────────────────

/**
 * Schema for structured concept extraction (LLM-02).
 * Used with generateText + Output.object() — descriptions guide the LLM.
 */
export const ConceptsSchema = z.object({
  functions: z.array(z.string()).describe('exported function names in this file'),
  classes: z.array(z.string()).describe('exported class names in this file'),
  interfaces: z.array(z.string()).describe('exported interface and type alias names in this file'),
  exports: z.array(z.string()).describe('all top-level export identifiers in this file'),
  purpose: z.string().describe('one-sentence description of the file purpose'),
});

export type ConceptsResult = z.infer<typeof ConceptsSchema>;

/**
 * Schema for change impact assessment (LLM-03).
 * Used with generateText + Output.object() — descriptions guide the LLM.
 */
export const ChangeImpactSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']).describe(
    'overall risk level of this change: low = internal refactor, medium = API change with compatible signature, high = breaking change'
  ),
  affectedAreas: z.array(z.string()).describe(
    'list of module or subsystem names likely to be affected by this change'
  ),
  breakingChanges: z.array(z.string()).describe(
    'list of specific breaking changes, if any (empty array if none)'
  ),
  summary: z.string().describe(
    'one-sentence summary of the change and its impact'
  ),
});

export type ChangeImpactResult = z.infer<typeof ChangeImpactSchema>;
