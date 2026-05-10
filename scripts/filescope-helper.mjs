#!/usr/bin/env node
// FileScopeMCP hook helper.
// Invoked by Claude Code hooks (PreToolUse, SessionStart) — see docs/claude-code-hooks.md.
// Layering: this script is invoked from user-owned hook configs. It does not modify any
// Claude Code internal state; it only reads hook payload from stdin and writes the
// hook response on stdout per Claude Code's hook protocol.

import { readFileSync } from 'node:fs';

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

function handlePreToolUse(stdinPayload) {
  // STUB — Task 7 implements.
  emitContinue();
}

function handleSessionStart(stdinPayload) {
  // STUB — Task 8 implements.
  emitContinue();
}
