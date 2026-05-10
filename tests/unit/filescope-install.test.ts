import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const INSTALL = path.join(REPO_ROOT, 'scripts', 'filescope-install.mjs');

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'filescope-install-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function runInstall() {
  return spawnSync(process.execPath, [INSTALL, '--claude-code', '--yes'], {
    cwd: tmpDir,
    encoding: 'utf-8',
    timeout: 30000,
  });
}

describe('filescope-install primer', () => {
  it('creates CLAUDE.md when none exists', () => {
    runInstall();
    const out = path.join(tmpDir, 'CLAUDE.md');
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, 'utf-8')).toContain('<!-- BEGIN filescope -->');
  });

  it('appends primer block to existing CLAUDE.md without overwriting prior content', () => {
    writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# My project\n\nExisting content.\n');
    runInstall();
    const content = readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('# My project');
    expect(content).toContain('Existing content.');
    expect(content).toContain('<!-- BEGIN filescope -->');
  });

  it('replaces existing primer block on re-install', () => {
    const initialContent = '# Project\n\n<!-- BEGIN filescope -->\nold version\n<!-- END filescope -->\n';
    writeFileSync(path.join(tmpDir, 'CLAUDE.md'), initialContent);
    runInstall();
    const content = readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    expect(content).toContain('Operating Protocol'); // from real primer
    expect(content).not.toContain('old version');
    expect(content).toContain('# Project'); // existing surrounding content preserved
  });

  it('emits a summary table', () => {
    const r = runInstall();
    expect(r.stdout).toContain('=== filescope-install summary ===');
  });

  it('does NOT modify .claude/settings.json (layering rule)', () => {
    // Create a fake .claude/settings.json with content we want to preserve.
    const claudeDir = path.join(tmpDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const settingsPath = path.join(claudeDir, 'settings.json');
    const sentinel = '{"hooks":{},"sentinel":"untouched"}';
    writeFileSync(settingsPath, sentinel);
    runInstall();
    expect(readFileSync(settingsPath, 'utf-8')).toBe(sentinel);
  });
});
