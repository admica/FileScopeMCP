// Integration smoke test: verify the MCP server does not emit non-JSON bytes to stdout.
// Any console.log or debug output before the MCP handshake silently breaks the session.
// This test spawns dist/mcp-server.js, sends an MCP initialize request, and asserts
// that the first byte of stdout is 0x7B ('{'), confirming JSON-RPC output.
//
// Requires dist/mcp-server.js — run `npm run build` first.

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const SERVER_BIN = path.join(process.cwd(), 'dist/mcp-server.js');
const serverBinExists = existsSync(SERVER_BIN);

describe.skipIf(!serverBinExists)('mcp stdout pollution', () => {

  it('first byte of mcp-server.js stdout is { (ASCII 0x7B)', async () => {
    const proc = spawn(process.execPath, [SERVER_BIN], {
      cwd: os.tmpdir(), // neutral dir — fast scan, no .filescope confusion
      stdio: ['pipe', 'pipe', 'ignore'],
    });

    try {
      const firstChunk = await new Promise<Buffer>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timeout waiting for MCP server stdout (12s)')),
          12_000,
        );

        proc.stdout!.once('data', (chunk: Buffer) => {
          clearTimeout(timer);
          resolve(chunk);
        });

        // Trigger output by sending MCP initialize request to stdin.
        // The server only writes to stdout after receiving a valid message.
        const initMsg = JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            clientInfo: { name: 'smoke-test', version: '1.0.0' },
            capabilities: {},
          },
        }) + '\n';
        proc.stdin!.write(initMsg);
      });

      // First byte must be '{' — confirms JSON-RPC, not console.log pollution
      expect(firstChunk[0]).toBe(0x7b);
    } finally {
      proc.kill('SIGTERM');
      await new Promise<void>(resolve => {
        proc.on('exit', resolve);
        setTimeout(resolve, 3_000); // fallback if exit never fires
      });
    }
  }, 20_000);

});
