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

const MARKER_REGEX = /<!-- BEGIN filescope -->[\s\S]*?<!-- END filescope -->/;

async function promptYesNo(question, defaultYes = true) {
  if (NON_INTERACTIVE) return defaultYes;
  const rl = readline.createInterface({ input, output });
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await rl.question(`${question} ${suffix} `)).trim().toLowerCase();
  rl.close();
  if (answer === '') return defaultYes;
  return answer.startsWith('y');
}

async function stepRegister() {
  // Delegate to the existing scripts/register-mcp.mjs which already handles claude mcp add
  // with idempotency and graceful fallback when claude CLI is missing.
  const r = spawnSync(process.execPath, [REGISTER_MCP], { stdio: 'inherit' });
  if (r.status === 0) {
    record('Register MCP server (via claude mcp add)', true);
  } else {
    record('Register MCP server (via claude mcp add)', false, `register-mcp.mjs exited ${r.status}`);
  }
}

async function stepPrimer() {
  if (!existsSync(PRIMER_PATH)) {
    record('CLAUDE.md primer', false, `template not found at ${PRIMER_PATH}`);
    return;
  }
  const primer = readFileSync(PRIMER_PATH, 'utf-8').trimEnd();
  const claudeMdPath = path.join(process.cwd(), 'CLAUDE.md');

  if (!existsSync(claudeMdPath)) {
    const ok = await promptYesNo('Create CLAUDE.md with FileScope primer in current directory?');
    if (!ok) {
      record('CLAUDE.md primer', false, 'user declined to create CLAUDE.md');
      return;
    }
    writeFileSync(claudeMdPath, `${primer}\n`, 'utf-8');
    record('CLAUDE.md primer', true, 'created new CLAUDE.md with primer block');
    return;
  }

  const existing = readFileSync(claudeMdPath, 'utf-8');
  if (MARKER_REGEX.test(existing)) {
    const ok = await promptYesNo('CLAUDE.md already has a FileScope primer block. Replace it?');
    if (!ok) {
      record('CLAUDE.md primer', true, 'existing block left unchanged');
      return;
    }
    const updated = existing.replace(MARKER_REGEX, primer);
    writeFileSync(claudeMdPath, updated, 'utf-8');
    record('CLAUDE.md primer', true, 'replaced existing primer block');
    return;
  }

  const ok = await promptYesNo('Append FileScope primer block to existing CLAUDE.md?');
  if (!ok) {
    record('CLAUDE.md primer', false, 'user declined to modify existing CLAUDE.md');
    return;
  }
  const sep = existing.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(claudeMdPath, `${existing}${sep}${primer}\n`, 'utf-8');
  record('CLAUDE.md primer', true, 'appended primer block to CLAUDE.md');
}

function stepHooks() {
  const docPath = path.join(REPO_ROOT, HOOKS_DOC_REL);
  console.log('');
  console.log('  --- Hook templates (optional) ---');
  console.log('');
  console.log('  FileScopeMCP hooks are NOT auto-installed. Per the layering rule, your');
  console.log('  .claude/settings.json is yours — we never write to it. To wire up hooks,');
  console.log('  copy the snippets from:');
  console.log('');
  console.log(`    ${docPath}`);
  console.log('');
  console.log('  Disable any installed hooks at runtime with FILESCOPE_HOOKS=off.');
  console.log('');
  record('Print hook templates', true, `documented at ${HOOKS_DOC_REL}`);
}

async function stepVerify() {
  const r = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf-8' });
  if (r.error && r.error.code === 'ENOENT') {
    record('Verify with `claude mcp list`', false, 'claude CLI not found in PATH');
    return;
  }
  if (r.status !== 0) {
    record('Verify with `claude mcp list`', false, `claude mcp list exited ${r.status}`);
    return;
  }
  const present = /(^|\s)FileScopeMCP(\s|:|$)/m.test(r.stdout ?? '');
  if (present) {
    record('Verify with `claude mcp list`', true, 'FileScopeMCP found in registered servers');
  } else {
    record('Verify with `claude mcp list`', false, 'FileScopeMCP not found in `claude mcp list` output');
  }
}

function printSummary() {
  console.log('');
  console.log('  === filescope-install summary ===');
  console.log('');
  let allPassed = true;
  for (const r of results) {
    const mark = r.ok ? '✓' : '✗';
    const note = r.note ? `  (${r.note})` : '';
    console.log(`    ${mark}  ${r.step}${note}`);
    if (!r.ok) allPassed = false;
  }
  console.log('');
  process.exit(allPassed ? 0 : 1);
}

await main();
