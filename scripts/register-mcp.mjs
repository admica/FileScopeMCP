// Registers FileScopeMCP with Claude Code via `claude mcp add --scope user`.
// - Fail-soft (exit 0) when `claude` CLI is not in PATH — see D-06.
// - Idempotent: claude mcp add handles duplicates natively; post-check via claude mcp list (D-07).
// - Uses process.execPath as the node binary so nvm/volta/system node users all get the right path (D-08).
// - Runs at --scope user (D-04): one-time install, visible across all Claude Code sessions on the host.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve repo root: this file lives at <repo>/scripts/register-mcp.mjs
const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const SERVER_JS = path.join(REPO_ROOT, 'dist', 'mcp-server.js');
const NODE_BIN = process.execPath;
const SERVER_NAME = 'FileScopeMCP';

console.log('');
console.log('=== FileScopeMCP — Claude Code Registration ===');
console.log('');

// Guard 1: dist/mcp-server.js must exist. If not, the user has not run ./build.sh yet.
// This is a real error (exit 1), not a fail-soft case.
if (!existsSync(SERVER_JS)) {
  console.error(`  ERROR: ${SERVER_JS} not found.`);
  console.error('  Run ./build.sh (or: npm install && npm run build) first.');
  process.exit(1);
}

// Guard 2: try spawning `claude mcp add`. If the binary is missing, spawnSync returns
// an error object with code === 'ENOENT'. Per D-06, this is fail-soft: print hint, exit 0.
const addResult = spawnSync(
  'claude',
  ['mcp', 'add', '--scope', 'user', SERVER_NAME, NODE_BIN, SERVER_JS],
  { stdio: 'inherit' }
);

if (addResult.error && addResult.error.code === 'ENOENT') {
  console.log('');
  console.log('  Claude Code CLI not found; install from https://claude.ai/code or add `claude` to PATH, then re-run.');
  console.log('  (This is not a build failure — other FileScopeMCP uses still work.)');
  console.log('');
  process.exit(0);
}

if (addResult.status !== 0) {
  console.error('');
  console.error(`  ERROR: \`claude mcp add\` exited with code ${addResult.status}.`);
  console.error('  Re-run with verbose output: claude mcp add --scope user FileScopeMCP "' + NODE_BIN + '" "' + SERVER_JS + '"');
  process.exit(addResult.status ?? 1);
}

// Post-check (D-07): confirm via `claude mcp list` that our entry is present.
const listResult = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf-8' });
const listedOk = listResult.status === 0 && typeof listResult.stdout === 'string' && listResult.stdout.includes(SERVER_NAME);

console.log('');
if (listedOk) {
  console.log('  ✓ Registered successfully (verified via `claude mcp list`).');
} else {
  console.log('  ⚠ `claude mcp add` succeeded but post-check could not confirm entry via `claude mcp list`.');
  console.log('    Run `claude mcp list` manually to verify.');
}
console.log('');
console.log(`  Node   : ${NODE_BIN}`);
console.log(`  Server : ${SERVER_JS}`);
console.log('  Scope  : user');
console.log('');
console.log('  Restart Claude Code (or run: claude mcp list) to confirm.');
console.log('');
