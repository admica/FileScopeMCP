// Integration test: register-mcp fail-soft when `claude` CLI is missing.
// Spawns scripts/register-mcp.mjs with PATH scrubbed of any `claude` binary,
// asserts exit code 0 (per D-06, never break the build) and the documented
// hint is written to stdout so build.sh's `tee -a $LOGFILE` captures it.

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts/register-mcp.mjs');
const scriptExists = existsSync(SCRIPT_PATH);

describe.skipIf(!scriptExists)('register-mcp fail-soft', () => {

  it('exits 0 and prints hint when `claude` CLI is missing', async () => {
    const proc = spawn(process.execPath, [SCRIPT_PATH], {
      cwd: os.tmpdir(),
      stdio: ['ignore', 'pipe', 'pipe'],
      // Scrub PATH so spawnSync('claude', ...) inside the script resolves to ENOENT.
      // /nonexistent-path is guaranteed not to contain a `claude` binary.
      env: { ...process.env, PATH: '/nonexistent-path' },
    });

    try {
      const [exitCode, stdout] = await new Promise<[number | null, string]>((resolve, reject) => {
        let out = '';
        let err = '';
        const timer = setTimeout(
          () => reject(new Error('timeout waiting for register-mcp.mjs exit (10s)\nstdout: ' + out + '\nstderr: ' + err)),
          10_000,
        );
        proc.stdout!.on('data', (c: Buffer) => { out += c.toString(); });
        proc.stderr!.on('data', (c: Buffer) => { err += c.toString(); });
        proc.on('exit', code => {
          clearTimeout(timer);
          resolve([code, out]);
        });
      });

      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/Claude Code CLI not found/);
    } finally {
      if (!proc.killed) proc.kill('SIGTERM');
    }
  }, 10_000);

});
