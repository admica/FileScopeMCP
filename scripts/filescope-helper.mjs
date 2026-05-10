#!/usr/bin/env node
// FileScopeMCP hook helper.
// Invoked by Claude Code hooks (PreToolUse, SessionStart) — see docs/claude-code-hooks.md.
// Layering: this script is invoked from user-owned hook configs. It does not modify any
// Claude Code internal state; it only reads hook payload from stdin and writes the
// hook response on stdout per Claude Code's hook protocol.

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __helperFile = fileURLToPath(import.meta.url);
const __helperDir = path.dirname(__helperFile);
const REPO_ROOT = path.resolve(__helperDir, '..');
const SERVER_JS = path.join(REPO_ROOT, 'dist', 'mcp-server.js');

// Kill switch: FILESCOPE_HOOKS=off disables all hook output without removing the config.
if (process.env.FILESCOPE_HOOKS === 'off') {
  process.exit(0);
}

const subcommand = process.argv[2];

function emitContinue() {
  process.stdout.write(JSON.stringify({ continue: true }) + '\n');
  process.exit(0);
}

function emitContext(text) {
  process.stdout.write(JSON.stringify({
    continue: true,
    additionalContext: text,
  }) + '\n');
  process.exit(0);
}

function readStdin() {
  try {
    return readFileSync(0, 'utf-8');
  } catch {
    return '';
  }
}

switch (subcommand) {
  case 'pre-tool-use':
    handlePreToolUse(readStdin());
    break;
  case 'session-start':
    handleSessionStart(readStdin());
    break;
  default:
    // Unknown subcommand — fail open, do not block.
    emitContinue();
}

function isFileScopeProject(baseDir) {
  // Cheap check: a FileScopeMCP-tracked project has .filescope/data.db.
  // If it doesn't, spawning mcp-server.js will produce nothing useful and waste seconds.
  return existsSync(path.join(baseDir, '.filescope', 'data.db'));
}

function callMcpTool(toolName, args, baseDir) {
  // Skip the spawn entirely if this directory isn't a FileScopeMCP project.
  if (!isFileScopeProject(baseDir)) return null;
  // Spawn dist/mcp-server.js with --base-dir and send a single JSON-RPC tool call.
  // Returns the parsed result or null on any error (fail-open).
  const initialize = {
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'filescope-helper', version: '1.0' },
    },
  };
  const initialized = { jsonrpc: '2.0', method: 'notifications/initialized' };
  const request = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
  };
  const stdinPayload = `${JSON.stringify(initialize)}\n${JSON.stringify(initialized)}\n${JSON.stringify(request)}\n`;
  const child = spawnSync(process.execPath, [SERVER_JS, `--base-dir=${baseDir}`], {
    input: stdinPayload,
    encoding: 'utf-8',
    timeout: 2000,
  });
  if (child.status !== 0 && child.status !== null) return null;
  // Find the line with id:1 in stdout.
  const lines = (child.stdout ?? '').split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.id === 1) return parsed.result ?? null;
    } catch {
      /* skip non-JSON */
    }
  }
  return null;
}

function handlePreToolUse(stdinPayload) {
  let payload;
  try {
    payload = JSON.parse(stdinPayload);
  } catch {
    emitContinue();
    return;
  }
  const filePath = payload?.tool_input?.file_path;
  const cwd = payload?.cwd ?? process.cwd();
  if (!filePath) {
    emitContinue();
    return;
  }
  const result = callMcpTool('get_file_summary', { filepath: filePath }, cwd);
  if (!result || result.isError) {
    emitContinue();
    return;
  }
  // Extract the text content of the first content block.
  const text = result.content?.[0]?.text ?? '';
  if (!text) {
    emitContinue();
    return;
  }
  // Cap at 2 KB.
  const truncated = text.length > 2048 ? text.slice(0, 2048) + '\n…(truncated)' : text;
  emitContext(`FileScopeMCP context for ${filePath}:\n\n${truncated}`);
}

function handleSessionStart(stdinPayload) {
  let payload;
  try {
    payload = JSON.parse(stdinPayload);
  } catch {
    emitContinue();
    return;
  }
  const cwd = payload?.cwd ?? process.cwd();

  const important = callMcpTool('find_important_files', { maxItems: 5 }, cwd);
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const changed = callMcpTool('list_changed_since', { since: since24h, maxItems: 10 }, cwd);

  if (!important || important.isError) {
    // Project not indexed — silent.
    emitContinue();
    return;
  }

  let digest = `FileScopeMCP session digest (${cwd}):\n\n`;
  const importantText = important.content?.[0]?.text ?? '';
  if (importantText) {
    digest += `## Top important files\n${importantText.slice(0, 600)}\n\n`;
  }
  if (changed && !changed.isError) {
    const changedText = changed.content?.[0]?.text ?? '';
    if (changedText) {
      digest += `## Recent changes (last 24h)\n${changedText.slice(0, 400)}\n`;
    }
  }
  if (digest.length > 1024) digest = digest.slice(0, 1024) + '\n…(truncated)';

  emitContext(digest);
}
