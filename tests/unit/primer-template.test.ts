import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const PRIMER_PATH = path.join(REPO_ROOT, 'templates', 'CLAUDE-md-primer.md');

describe('CLAUDE.md primer template', () => {
  const content = readFileSync(PRIMER_PATH, 'utf-8');

  it('starts with the BEGIN marker', () => {
    expect(content.startsWith('<!-- BEGIN filescope -->')).toBe(true);
  });

  it('ends with the END marker (allowing trailing newline)', () => {
    expect(content.trimEnd().endsWith('<!-- END filescope -->')).toBe(true);
  });

  it('contains the Operating Protocol heading', () => {
    expect(content).toContain('## FileScopeMCP — Operating Protocol');
  });

  it('is bounded to under 100 lines', () => {
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThan(100);
  });

  it('uses imperative voice (mentions "Before" or "Use" at least 3 times)', () => {
    const matches = content.match(/\b(Before|Use|Call|Try)\b/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });
});

describe('marker regex contract', () => {
  // Anchor the regex used by filescope-install: must match the BEGIN..END block
  // greedy across newlines, with the markers themselves included.
  const MARKER_REGEX = /<!-- BEGIN filescope -->[\s\S]*?<!-- END filescope -->/;

  it('regex matches the entire primer file', () => {
    const content = readFileSync(PRIMER_PATH, 'utf-8');
    const match = content.match(MARKER_REGEX);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('Operating Protocol');
  });

  it('regex matches when primer is embedded inside a larger CLAUDE.md', () => {
    const content = readFileSync(PRIMER_PATH, 'utf-8');
    const wrapped = `# Project notes\n\nLeading content.\n\n${content}\n\nTrailing content.\n`;
    const match = wrapped.match(MARKER_REGEX);
    expect(match).not.toBeNull();
    expect(match![0]).toContain('Operating Protocol');
  });

  it('regex matches non-greedily — does not span two primer blocks', () => {
    const content = readFileSync(PRIMER_PATH, 'utf-8');
    const doubled = `${content}\n\n${content}`;
    const matchAll = [...doubled.matchAll(new RegExp(MARKER_REGEX.source, 'g'))];
    expect(matchAll.length).toBe(2);
  });
});
