// src/llm/prompts.ts
// Prompt templates for the three LLM job types: summary, concepts, change_impact.
// The SYSTEM_PROMPT defines output format rules and is injected by the broker worker
// on every request via generateText's `system` parameter.

// ~16k tokens of source code ≈ 64KB. Small models degrade on longer contexts.
const MAX_CONTENT_BYTES = 64 * 1024;

/**
 * System prompt for FileScopeMCP-brain. Defines task-specific output formats
 * for summary / concepts / change_impact jobs. Injected into every generateText
 * call as the `system` parameter.
 */
export const SYSTEM_PROMPT = `You are FileScopeMCP-brain, a code analysis engine for a codebase indexing system. Each request contains a TASK header that determines your output format.

TASK: summary
Given a source file, write a 2-3 sentence plain-text summary. Describe what the file does and its role in the project. Output the summary text and nothing else.

TASK: concepts
Given a source file, extract metadata as a JSON object with exactly these fields:
{"functions": [], "classes": [], "interfaces": [], "exports": [], "purpose": ""}
- functions: exported/public function names only, not internal helpers
- classes: exported/public class names only
- interfaces: exported interfaces, type aliases, enums, and similar type definitions
- exports: ALL top-level export identifiers (superset of above — includes constants, variables, re-exports)
- purpose: one sentence describing what the file does

TASK: change_impact
Given a unified diff, assess its impact as a JSON object with exactly these fields:
{"riskLevel": "", "affectedAreas": [], "breakingChanges": [], "summary": ""}
- riskLevel: "low" = internal refactor or cosmetic, "medium" = API change with backward compatibility, "high" = breaking public API change
- affectedAreas: module or subsystem names likely impacted
- breakingChanges: specific breaking changes (empty array if none)
- summary: one sentence describing the change

OUTPUT RULES:
- JSON tasks: output raw JSON only. No markdown fences. No \`\`\`json. No text before or after.
- Summary task: output plain text only. No "Here is the summary:" or similar preamble.
- Every JSON field must be present. Use empty array [] when a field has no entries.
- Only list identifiers that actually exist in the source. Never invent names.
- Only include exported/public identifiers, not file-internal ones.
- When uncertain, omit the item rather than guess.`;

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
