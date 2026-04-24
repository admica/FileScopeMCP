// tests/unit/list-changed-since.test.ts
// Phase 35 CHG-01..05 unit tests. Exercises the list_changed_since handler
// dispatch (regex → SHA vs Date.parse → timestamp), envelope assembly, and
// error codes WITHOUT starting the MCP server. SHA mode uses an injected
// git-runner so tests never shell out to real git.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { openDatabase, closeDatabase } from '../../src/db/db.js';
import { getFilesChangedSince, getFilesByPaths, upsertFile } from '../../src/db/repository.js';
import { canonicalizePath } from '../../src/file-utils.js';
import type { FileNode } from '../../src/types.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'list-changed-since-test-'));
  return path.join(tmpDir, 'test.db');
}

function makeNode(overrides: Partial<FileNode> = {}): FileNode {
  return {
    path: '/project/file.ts',
    name: 'file.ts',
    isDirectory: false,
    mtime: 1000,
    importance: 0,
    dependencies: [],
    dependents: [],
    ...overrides,
  } as FileNode;
}

beforeEach(() => {
  openDatabase(makeTmpDb());
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// Discriminated union mirroring an mcpError / mcpSuccess payload.
type SimResult =
  | { ok: true; items: Array<{ path: string; mtime: number }>; total: number; truncated?: true }
  | { ok: false; code: 'NOT_INITIALIZED' | 'INVALID_SINCE' | 'NOT_GIT_REPO'; message: string };

interface SimDeps {
  projectRoot: string;
  initialized?: boolean;
  dotGitExists?: boolean;
  gitRunner?: (sha: string) => string; // returns stdout; may throw to simulate git failure
}

/**
 * Mirrors the handler dispatch in src/mcp-server.ts list_changed_since — same
 * regex, same Date.parse, same .git gate, same envelope. The only injection is
 * the gitRunner + dotGitExists flag, so tests can exercise every branch without
 * real git.
 */
function simulateListChangedSince(
  args: { since: string; maxItems?: number },
  deps: SimDeps
): SimResult {
  if (deps.initialized === false) {
    return { ok: false, code: 'NOT_INITIALIZED', message: 'Server not initialized.' };
  }
  const limit = Math.max(1, Math.min(500, args.maxItems ?? 50));
  const SHA_RE = /^[0-9a-fA-F]{7,40}$/;

  let rows: Array<{ path: string; mtime: number | null }>;

  if (SHA_RE.test(args.since)) {
    if (deps.dotGitExists === false) {
      return { ok: false, code: 'NOT_GIT_REPO', message: 'No .git directory.' };
    }
    let stdout: string;
    try {
      stdout = deps.gitRunner ? deps.gitRunner(args.since) : '';
    } catch {
      return { ok: false, code: 'INVALID_SINCE', message: 'git diff failed.' };
    }
    const repoPaths = stdout.trim().split('\n').filter(Boolean);
    const absPaths = repoPaths.map(p => canonicalizePath(path.resolve(deps.projectRoot, p)));
    rows = getFilesByPaths(absPaths);
  } else {
    const ms = Date.parse(args.since);
    if (isNaN(ms)) {
      return { ok: false, code: 'INVALID_SINCE', message: 'Unparseable since.' };
    }
    rows = getFilesChangedSince(ms);
  }

  const sorted = rows
    .map(r => ({ path: r.path, mtime: r.mtime ?? 0 }))
    .sort((a, b) => {
      if (b.mtime !== a.mtime) return b.mtime - a.mtime;
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });

  const total = sorted.length;
  const items = sorted.slice(0, limit);
  const truncated = items.length < total;
  const result: SimResult = { ok: true, items, total };
  if (truncated) result.truncated = true;
  return result;
}

describe('list_changed_since — Phase 35', () => {

  describe('timestamp mode (CHG-01, CHG-02, D-11..D-13)', () => {
    it('returns files whose mtime > since, sorted mtime DESC', () => {
      upsertFile(makeNode({ path: '/p/old.ts', mtime: 1000 }));
      upsertFile(makeNode({ path: '/p/mid.ts', mtime: 2000 }));
      upsertFile(makeNode({ path: '/p/new.ts', mtime: 3000 }));
      const r = simulateListChangedSince({ since: new Date(1500).toISOString() }, { projectRoot: '/p' });
      if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
      expect(r.total).toBe(2);
      expect(r.items.map(i => i.path)).toEqual(['/p/new.ts', '/p/mid.ts']);
    });

    it('strict > boundary — file AT the exact mtime is excluded', () => {
      upsertFile(makeNode({ path: '/p/a.ts', mtime: 1000 }));
      const r = simulateListChangedSince({ since: new Date(1000).toISOString() }, { projectRoot: '/p' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.total).toBe(0);
    });

    it('accepts ISO-8601 date-only', () => {
      const ms = Date.parse('2026-04-23');
      upsertFile(makeNode({ path: '/p/newer.ts', mtime: ms + 86400000 }));
      upsertFile(makeNode({ path: '/p/older.ts', mtime: ms - 86400000 }));
      const r = simulateListChangedSince({ since: '2026-04-23' }, { projectRoot: '/p' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.total).toBe(1);
      expect(r.items[0].path).toBe('/p/newer.ts');
    });

    it('unparseable since → INVALID_SINCE', () => {
      const r = simulateListChangedSince({ since: 'not-a-date' }, { projectRoot: '/p' });
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('expected err');
      expect(r.code).toBe('INVALID_SINCE');
    });

    it('empty result is success (D-18)', () => {
      upsertFile(makeNode({ path: '/p/a.ts', mtime: 1000 }));
      const r = simulateListChangedSince({ since: new Date(5000).toISOString() }, { projectRoot: '/p' });
      if (!r.ok) throw new Error('expected ok');
      expect(r).toEqual({ ok: true, items: [], total: 0 });
    });
  });

  describe('SHA mode (CHG-03, D-01, D-05, D-09, D-10)', () => {
    it('7-char hex triggers SHA mode and intersects git output with DB', () => {
      upsertFile(makeNode({ path: canonicalizePath('/p/src/a.ts'), mtime: 1000 }));
      upsertFile(makeNode({ path: canonicalizePath('/p/src/b.ts'), mtime: 2000 }));
      // Git lists a.ts and a path that's not in DB (deleted.ts — deliberately excluded per CHG-05)
      const r = simulateListChangedSince(
        { since: '860fe61' },
        {
          projectRoot: '/p',
          dotGitExists: true,
          gitRunner: () => 'src/a.ts\nsrc/deleted.ts\n',
        }
      );
      if (!r.ok) throw new Error(`expected ok, got ${r.code}`);
      expect(r.total).toBe(1);
      expect(r.items[0].path).toBe(canonicalizePath('/p/src/a.ts'));
    });

    it('40-char hex SHA also accepted', () => {
      const sha40 = 'a'.repeat(40);
      upsertFile(makeNode({ path: canonicalizePath('/p/f.ts'), mtime: 1000 }));
      const r = simulateListChangedSince(
        { since: sha40 },
        {
          projectRoot: '/p',
          dotGitExists: true,
          gitRunner: () => 'f.ts\n',
        }
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.total).toBe(1);
    });

    it('missing .git → NOT_GIT_REPO (D-05, CHG-04)', () => {
      const r = simulateListChangedSince(
        { since: '860fe61' },
        { projectRoot: '/p', dotGitExists: false }
      );
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('expected err');
      expect(r.code).toBe('NOT_GIT_REPO');
    });

    it('git runner throws → INVALID_SINCE (D-08)', () => {
      const r = simulateListChangedSince(
        { since: '0000000' },
        {
          projectRoot: '/p',
          dotGitExists: true,
          gitRunner: () => { throw new Error('bad object 0000000'); },
        }
      );
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('expected err');
      expect(r.code).toBe('INVALID_SINCE');
    });

    it('git output with null mtime DB row coerces mtime → 0 (D-15)', () => {
      upsertFile(makeNode({ path: canonicalizePath('/p/f.ts'), mtime: null as unknown as number }));
      const r = simulateListChangedSince(
        { since: '860fe61' },
        {
          projectRoot: '/p',
          dotGitExists: true,
          gitRunner: () => 'f.ts\n',
        }
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.total).toBe(1);
      expect(r.items[0].mtime).toBe(0);
    });

    it('empty git output → empty result (success)', () => {
      const r = simulateListChangedSince(
        { since: '860fe61' },
        {
          projectRoot: '/p',
          dotGitExists: true,
          gitRunner: () => '',
        }
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r).toEqual({ ok: true, items: [], total: 0 });
    });
  });

  describe('dispatch boundary (D-01, D-02)', () => {
    it('6-char hex is NOT a SHA — falls through to Date.parse (fails, → INVALID_SINCE)', () => {
      // Date.parse('abcdef') → NaN → INVALID_SINCE
      const r = simulateListChangedSince({ since: 'abcdef' }, { projectRoot: '/p' });
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('expected err');
      expect(r.code).toBe('INVALID_SINCE');
    });

    it('41-char hex is NOT a SHA — falls through to Date.parse', () => {
      const tooLong = 'a'.repeat(41);
      const r = simulateListChangedSince({ since: tooLong }, { projectRoot: '/p' });
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('expected err');
      expect(r.code).toBe('INVALID_SINCE');
    });

    it('non-hex chars in a 7+ length string → NOT SHA → Date.parse path', () => {
      const r = simulateListChangedSince({ since: 'z'.repeat(8) }, { projectRoot: '/p' });
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('expected err');
      expect(r.code).toBe('INVALID_SINCE');
    });

    it('mixed case hex triggers SHA mode (D-03)', () => {
      upsertFile(makeNode({ path: canonicalizePath('/p/f.ts'), mtime: 1000 }));
      const r = simulateListChangedSince(
        { since: 'AbCdEf1' },
        {
          projectRoot: '/p',
          dotGitExists: true,
          gitRunner: () => 'f.ts\n',
        }
      );
      if (!r.ok) throw new Error('expected ok');
      expect(r.total).toBe(1);
    });
  });

  describe('envelope + clamp (D-14, D-16, D-17)', () => {
    it('default maxItems = 50', () => {
      for (let i = 0; i < 60; i++) {
        upsertFile(makeNode({ path: `/p/f${String(i).padStart(2, '0')}.ts`, mtime: 1000 + i }));
      }
      const r = simulateListChangedSince({ since: new Date(500).toISOString() }, { projectRoot: '/p' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.items.length).toBe(50);
      expect(r.total).toBe(60);
      expect(r.truncated).toBe(true);
    });

    it('truncated is omitted when items.length == total', () => {
      upsertFile(makeNode({ path: '/p/only.ts', mtime: 1000 }));
      const r = simulateListChangedSince({ since: new Date(500).toISOString() }, { projectRoot: '/p' });
      if (!r.ok) throw new Error('expected ok');
      expect('truncated' in r).toBe(false);
    });

    it('maxItems clamps to [1, 500] — zero becomes 1', () => {
      for (let i = 0; i < 5; i++) {
        upsertFile(makeNode({ path: `/p/f${i}.ts`, mtime: 1000 + i }));
      }
      const r = simulateListChangedSince({ since: new Date(500).toISOString(), maxItems: 0 }, { projectRoot: '/p' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.items.length).toBe(1);
      expect(r.total).toBe(5);
      expect(r.truncated).toBe(true);
    });

    it('maxItems clamps upper bound to 500', () => {
      upsertFile(makeNode({ path: '/p/a.ts', mtime: 1000 }));
      const r = simulateListChangedSince({ since: new Date(500).toISOString(), maxItems: 99999 }, { projectRoot: '/p' });
      if (!r.ok) throw new Error('expected ok');
      // Clamps limit to 500; only 1 row exists
      expect(r.items.length).toBe(1);
    });

    it('secondary sort by path ASC when mtime ties', () => {
      upsertFile(makeNode({ path: '/p/z.ts', mtime: 1000 }));
      upsertFile(makeNode({ path: '/p/a.ts', mtime: 1000 }));
      upsertFile(makeNode({ path: '/p/m.ts', mtime: 1000 }));
      const r = simulateListChangedSince({ since: new Date(500).toISOString() }, { projectRoot: '/p' });
      if (!r.ok) throw new Error('expected ok');
      expect(r.items.map(i => i.path)).toEqual(['/p/a.ts', '/p/m.ts', '/p/z.ts']);
    });
  });

  describe('NOT_INITIALIZED gate', () => {
    it('returns NOT_INITIALIZED when coordinator not ready', () => {
      const r = simulateListChangedSince(
        { since: new Date().toISOString() },
        { projectRoot: '/p', initialized: false }
      );
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('expected err');
      expect(r.code).toBe('NOT_INITIALIZED');
    });
  });
});
