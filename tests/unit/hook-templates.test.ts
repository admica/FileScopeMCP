import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const HOOKS_DOC = path.join(REPO_ROOT, 'docs', 'claude-code-hooks.md');

function extractJsonBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const fence = /```json\n([\s\S]*?)\n```/g;
  let match;
  while ((match = fence.exec(markdown)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

describe('claude-code-hooks.md', () => {
  const content = readFileSync(HOOKS_DOC, 'utf-8');

  it('contains at least three json snippets', () => {
    const blocks = extractJsonBlocks(content);
    expect(blocks.length).toBeGreaterThanOrEqual(3);
  });

  it('every json snippet parses (with elision comments stripped)', () => {
    const blocks = extractJsonBlocks(content);
    for (const block of blocks) {
      // Strip "/* ... as above ... */" elision comments used in the combined example.
      const stripped = block.replace(/\/\*[\s\S]*?\*\//g, '"__elided__"');
      expect(() => JSON.parse(stripped)).not.toThrow();
    }
  });

  it('each parsed snippet has a "hooks" key', () => {
    const blocks = extractJsonBlocks(content);
    for (const block of blocks) {
      const stripped = block.replace(/\/\*[\s\S]*?\*\//g, '"__elided__"');
      const parsed = JSON.parse(stripped);
      expect(parsed).toHaveProperty('hooks');
    }
  });

  it('mentions the layering rule', () => {
    expect(content).toContain('Layering rule');
    expect(content).toContain('never auto-writes');
  });

  it('mentions the FILESCOPE_HOOKS kill switch', () => {
    expect(content).toContain('FILESCOPE_HOOKS');
    expect(content).toContain('off');
  });
});
