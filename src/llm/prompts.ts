// src/llm/prompts.ts
// Prompt templates for the three LLM job types: summary, concepts, change_impact.
// Prompts are kept concise to minimize token usage.

/**
 * Builds a prompt for generating a plain-text file summary (LLM-01).
 * Used with plain generateText — no structured output schema.
 */
export function buildSummaryPrompt(filePath: string, fileContent: string): string {
  return `You are a code documentation assistant. Summarize the purpose of the following file in 2-3 sentences. Focus on what it does and its role in the codebase. Be concise.

File: ${filePath}

\`\`\`
${fileContent}
\`\`\`

Respond with only the summary text, no preamble.`;
}

/**
 * Builds a prompt for extracting structured concepts from a file (LLM-02).
 * Used with generateText + Output.object({ schema: ConceptsSchema }).
 */
export function buildConceptsPrompt(filePath: string, fileContent: string): string {
  return `You are a code analysis assistant. Extract structured metadata from the following source file. Respond in JSON matching the requested schema.

File: ${filePath}

\`\`\`
${fileContent}
\`\`\`

Extract:
- functions: list of exported function names
- classes: list of exported class names
- interfaces: list of exported interface and type alias names
- exports: all top-level export identifiers
- purpose: one sentence describing the file's purpose

Respond with only the JSON object.`;
}

/**
 * Builds a prompt for assessing the change impact of a diff (LLM-03).
 * Used with generateText + Output.object({ schema: ChangeImpactSchema }).
 * @param filePath - Path of the changed file (for context).
 * @param diff     - The unified diff text for the file change.
 */
export function buildChangeImpactPrompt(filePath: string, diff: string): string {
  return `You are a code review assistant. Analyze the following diff and assess its impact. Respond in JSON matching the requested schema.

File: ${filePath}

\`\`\`diff
${diff}
\`\`\`

Assess:
- riskLevel: "low" (internal refactor), "medium" (API change, compatible), or "high" (breaking change)
- affectedAreas: list of module or subsystem names likely affected
- breakingChanges: list of specific breaking changes (empty array if none)
- summary: one sentence describing the change and its impact

Respond with only the JSON object.`;
}
