#!/usr/bin/env node
// filescope-install — opinionated installer for FileScopeMCP into agent runtimes.
// Currently supports --claude-code; --hermes is reserved for Phase 4.
// Layering rules:
//   - Never auto-write to .claude/settings.json or any internal Claude Code config.
//   - CLAUDE.md primer install is opt-in, prompts user, uses BEGIN/END markers.
//   - Hook configs are PRINTED (with doc URL); user pastes them into their own settings.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const PRIMER_PATH = path.join(REPO_ROOT, 'templates', 'CLAUDE-md-primer.md');
const HOOKS_DOC_REL = 'docs/claude-code-hooks.md';
const REGISTER_MCP = path.join(REPO_ROOT, 'scripts', 'register-mcp.mjs');

const args = new Set(process.argv.slice(2));
const TARGET_CLAUDE_CODE = args.has('--claude-code') || args.size === 0; // default
const NON_INTERACTIVE = args.has('--yes') || args.has('-y');
const PRINT_HOOKS = !args.has('--no-hooks');

if (!TARGET_CLAUDE_CODE) {
  console.error('Unknown target. Pass --claude-code (default) or wait for --hermes (Phase 4).');
  process.exit(1);
}

const results = []; // { step: string, ok: boolean, note?: string }

function record(step, ok, note) {
  results.push({ step, ok, note });
}

async function main() {
  await stepRegister();
  await stepPrimer();
  if (PRINT_HOOKS) stepHooks();
  await stepVerify();
  printSummary();
}

async function stepRegister() {
  // Stub — Task 15.
  record('Register MCP server', false, 'TODO');
}

async function stepPrimer() {
  // Stub — Task 16.
  record('CLAUDE.md primer', false, 'TODO');
}

function stepHooks() {
  // Stub — Task 17.
  record('Print hook templates', false, 'TODO');
}

async function stepVerify() {
  // Stub — Task 18.
  record('Verify registration', false, 'TODO');
}

function printSummary() {
  // Stub — Task 19.
  console.log('Summary placeholder');
}

await main();
