import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
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

describe('filescope-helper session-start', () => {
  it('respects FILESCOPE_HOOKS=off', () => {
    const r = runHelper(['session-start'], '{}', { FILESCOPE_HOOKS: 'off' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('emits {continue:true} on malformed payload', () => {
    const r = runHelper(['session-start'], 'not json');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout.trim())).toEqual({ continue: true });
  });

  it('emits {continue:true} when cwd has no .filescope/data.db', () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'filescope-helper-test-'));
    try {
      const r = runHelper(['session-start'], JSON.stringify({ cwd: tmp }));
      expect(r.status).toBe(0);
      const parsed = JSON.parse(r.stdout.trim());
      expect(parsed.continue).toBe(true);
      // Sanity: with the existsSync short-circuit in place, this path must be fast.
      // If it ever exceeds 1s, the short-circuit has regressed.
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
