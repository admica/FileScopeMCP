import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const HELPER = path.join(REPO_ROOT, 'scripts', 'filescope-helper.mjs');

function runHelper(args: string[], stdin: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [HELPER, ...args], {
    input: stdin,
    encoding: 'utf-8',
    env: { ...process.env, ...env },
    timeout: 10000,
  });
}

describe('filescope-helper pre-tool-use', () => {
  it('respects FILESCOPE_HOOKS=off kill switch', () => {
    const r = runHelper(['pre-tool-use'], '{}', { FILESCOPE_HOOKS: 'off' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('emits {continue:true} on empty payload', () => {
    const r = runHelper(['pre-tool-use'], '{}');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ continue: true });
  });

  it('emits {continue:true} on malformed payload', () => {
    const r = runHelper(['pre-tool-use'], 'not json');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ continue: true });
  });

  it('emits {continue:true} when file_path is missing', () => {
    const r = runHelper(['pre-tool-use'], JSON.stringify({ tool_input: {} }));
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ continue: true });
  });

  it('emits {continue:true} for unknown subcommand', () => {
    const r = runHelper(['nonsense'], '{}');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ continue: true });
  });
});
