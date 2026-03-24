// src/llm/prompts.ts
// Prompt templates for the three LLM job types: summary, concepts, change_impact.
// These are intentionally minimal — the heavy lifting is in the Modelfile SYSTEM prompt
// baked into the FileScopeMCP-brain Ollama model. Per-request prompts only identify the
// task type and provide the input content.

/**
 * Builds a prompt for generating a plain-text file summary (LLM-01).
 */
export function buildSummaryPrompt(filePath: string, fileContent: string): string {
  return `TASK: summary
FILE: ${filePath}

\`\`\`
${fileContent}
\`\`\``;
}

/**
 * Builds a prompt for extracting structured concepts from a file (LLM-02).
 */
export function buildConceptsPrompt(filePath: string, fileContent: string): string {
  return `TASK: concepts
FILE: ${filePath}

\`\`\`
${fileContent}
\`\`\``;
}

/**
 * Builds a prompt for assessing the change impact of a diff (LLM-03).
 */
export function buildChangeImpactPrompt(filePath: string, diff: string): string {
  return `TASK: change_impact
FILE: ${filePath}

\`\`\`diff
${diff}
\`\`\``;
}
