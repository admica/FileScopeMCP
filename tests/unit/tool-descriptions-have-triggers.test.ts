import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const SRV = path.join(REPO_ROOT, 'src', 'mcp-server.ts');

describe('mcp-server.ts tool descriptions', () => {
  const content = readFileSync(SRV, 'utf-8');
  const toolCount = (content.match(/server\.registerTool\(/g) ?? []).length;
  const triggerCount = (content.match(/\*\*When to call:\*\*/g) ?? []).length;

  it('registers exactly 17 tools (Phase 1 baseline)', () => {
    expect(toolCount).toBe(17);
  });

  it('every registered tool has a "**When to call:**" trigger prefix in its description', () => {
    expect(triggerCount).toBe(toolCount);
  });
});
