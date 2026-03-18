// src/change-detector/git-diff.ts
// Git diff helper for non-TS/JS files (CHNG-03).
// Provides diff content for unsupported languages so queueLlmDiffJob can
// pass meaningful context to the LLM pipeline instead of an empty string.
import { execSync } from 'node:child_process';
import * as fs from 'node:fs/promises';

/**
 * Returns the git diff for a file relative to HEAD, or the file's content
 * with a "[new/untracked file]" annotation if git diff is empty.
 *
 * Falls back to "[file content unavailable]" if the file cannot be read.
 *
 * This function never throws — all errors are caught and handled internally.
 * Per the established codebase pattern: non-fatal change detection.
 *
 * @param filePath Absolute path to the file.
 * @param projectRoot Absolute path to the project root (git repo root).
 * @returns A string suitable for passing to queueLlmDiffJob.
 */
export async function getGitDiffOrContent(
  filePath: string,
  projectRoot: string
): Promise<string> {
  // Try to get a git diff first
  try {
    const diff = execSync(`git diff HEAD -- "${filePath}"`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 5000,
    });

    if (diff && diff.trim().length > 0) {
      return diff;
    }
  } catch {
    // git unavailable, not a git repo, or other error — fall through to content fallback
  }

  // Git diff was empty or failed — fall back to reading the file content
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return `[new/untracked file]\n${content}`;
  } catch {
    // File doesn't exist or can't be read
    return '[file content unavailable]';
  }
}
