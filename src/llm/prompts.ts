// src/llm/prompts.ts
// Prompt templates for the three LLM job types: summary, concepts, change_impact.
// These are intentionally minimal — the heavy lifting is in the Modelfile SYSTEM prompt
// baked into the FileScopeMCP-brain Ollama model. Per-request prompts only identify the
// task type and provide the input content.

// ~16k tokens of source code ≈ 64KB. 7B models degrade on longer contexts.
const MAX_CONTENT_BYTES = 64 * 1024;

function truncateContent(content: string): string {
  if (content.length <= MAX_CONTENT_BYTES) return content;
  return content.slice(0, MAX_CONTENT_BYTES) + '\n... [truncated]';
}

/**
 * Builds a prompt for generating a plain-text file summary (LLM-01).
 */
export function buildSummaryPrompt(filePath: string, fileContent: string): string {
  return `TASK: summary
FILE: ${filePath}

\`\`\`
${truncateContent(fileContent)}
\`\`\``;
}

/**
 * Builds a prompt for extracting structured concepts from a file (LLM-02).
 */
export function buildConceptsPrompt(filePath: string, fileContent: string): string {
  return `TASK: concepts
FILE: ${filePath}

\`\`\`
${truncateContent(fileContent)}
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
