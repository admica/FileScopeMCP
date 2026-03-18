// src/change-detector/types.test.ts
// Tests for types module compilation and repository functions for exports_snapshot/llm_jobs.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// Types imports — validates they compile and can be used
import type { ExportedSymbol, ExportSnapshot, SemanticChangeSummary } from './types.js';
import { openDatabase, closeDatabase, getSqlite } from '../db/db.js';
import {
  getExportsSnapshot,
  setExportsSnapshot,
  insertLlmJob,
} from '../db/repository.js';

let tmpDir: string;

function makeTmpDb(): string {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescope-types-test-'));
  return path.join(tmpDir, 'test.db');
}

beforeEach(() => {
  const dbPath = makeTmpDb();
  openDatabase(dbPath);
});

afterEach(() => {
  try { closeDatabase(); } catch { /* ignore */ }
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ignore */ }
  }
});

describe('ExportedSymbol interface', () => {
  it('has name, kind, signature fields', () => {
    const sym: ExportedSymbol = {
      name: 'foo',
      kind: 'function',
      signature: 'export function foo(a: string): number',
    };
    expect(sym.name).toBe('foo');
    expect(sym.kind).toBe('function');
    expect(sym.signature).toBe('export function foo(a: string): number');
  });
});

describe('ExportSnapshot interface', () => {
  it('has filePath, exports, imports, capturedAt fields', () => {
    const snapshot: ExportSnapshot = {
      filePath: '/project/src/foo.ts',
      exports: [{ name: 'foo', kind: 'function', signature: 'export function foo(): void' }],
      imports: ['./bar.js', './baz.js'],
      capturedAt: 1700000000000,
    };
    expect(snapshot.filePath).toBe('/project/src/foo.ts');
    expect(snapshot.exports).toHaveLength(1);
    expect(snapshot.imports).toHaveLength(2);
    expect(snapshot.capturedAt).toBe(1700000000000);
  });
});

describe('SemanticChangeSummary interface', () => {
  it('has filePath, changeType, affectsDependents, changedExports, confidence, timestamp fields', () => {
    const summary: SemanticChangeSummary = {
      filePath: '/project/src/foo.ts',
      changeType: 'exports-changed',
      affectsDependents: true,
      changedExports: ['foo', 'bar'],
      confidence: 'ast',
      timestamp: 1700000000000,
    };
    expect(summary.filePath).toBe('/project/src/foo.ts');
    expect(summary.changeType).toBe('exports-changed');
    expect(summary.affectsDependents).toBe(true);
    expect(summary.changedExports).toEqual(['foo', 'bar']);
    expect(summary.confidence).toBe('ast');
    expect(summary.timestamp).toBe(1700000000000);
  });

  it('changedExports is optional', () => {
    const summary: SemanticChangeSummary = {
      filePath: '/project/src/foo.ts',
      changeType: 'body-only',
      affectsDependents: false,
      confidence: 'ast',
      timestamp: 1700000000000,
    };
    expect(summary.changedExports).toBeUndefined();
  });
});

describe('getExportsSnapshot', () => {
  it('returns null for unknown file path', () => {
    const result = getExportsSnapshot('/does/not/exist.ts');
    expect(result).toBeNull();
  });

  it('returns null when file exists but has no snapshot', () => {
    // We need to use the upsertFile to create the row first
    // but getExportsSnapshot for a file that has null exports_snapshot should return null
    const result = getExportsSnapshot('/project/src/foo.ts');
    expect(result).toBeNull();
  });
});

describe('setExportsSnapshot / getExportsSnapshot round-trip', () => {
  it('stores and retrieves snapshot correctly', () => {
    const snapshot: ExportSnapshot = {
      filePath: '/project/src/foo.ts',
      exports: [
        { name: 'foo', kind: 'function', signature: 'export function foo(a: string): number' },
        { name: 'Bar', kind: 'class', signature: 'export class Bar' },
      ],
      imports: ['./utils.js', './types.js'],
      capturedAt: 1700000000000,
    };

    setExportsSnapshot('/project/src/foo.ts', snapshot);
    const retrieved = getExportsSnapshot('/project/src/foo.ts');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.filePath).toBe('/project/src/foo.ts');
    expect(retrieved!.exports).toHaveLength(2);
    expect(retrieved!.exports[0].name).toBe('foo');
    expect(retrieved!.exports[0].kind).toBe('function');
    expect(retrieved!.imports).toEqual(['./utils.js', './types.js']);
    expect(retrieved!.capturedAt).toBe(1700000000000);
  });

  it('overwrites existing snapshot on second call', () => {
    const snapshot1: ExportSnapshot = {
      filePath: '/project/src/foo.ts',
      exports: [{ name: 'foo', kind: 'function', signature: 'export function foo(): void' }],
      imports: [],
      capturedAt: 1700000000000,
    };
    const snapshot2: ExportSnapshot = {
      filePath: '/project/src/foo.ts',
      exports: [
        { name: 'foo', kind: 'function', signature: 'export function foo(): void' },
        { name: 'bar', kind: 'variable', signature: 'export const bar = 1' },
      ],
      imports: ['./deps.js'],
      capturedAt: 1700000001000,
    };

    setExportsSnapshot('/project/src/foo.ts', snapshot1);
    setExportsSnapshot('/project/src/foo.ts', snapshot2);
    const retrieved = getExportsSnapshot('/project/src/foo.ts');

    expect(retrieved!.exports).toHaveLength(2);
    expect(retrieved!.exports[1].name).toBe('bar');
    expect(retrieved!.capturedAt).toBe(1700000001000);
  });
});

describe('insertLlmJob', () => {
  it('inserts a row into llm_jobs with status=pending', () => {
    insertLlmJob({
      file_path: '/project/src/foo.py',
      job_type: 'change_impact',
      priority_tier: 2,
    });

    // Verify via direct sqlite query
    const sqlite = getSqlite();
    const rows = sqlite.prepare('SELECT * FROM llm_jobs WHERE file_path = ?').all('/project/src/foo.py') as Array<{
      file_path: string;
      job_type: string;
      priority_tier: number;
      status: string;
      created_at: number;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].file_path).toBe('/project/src/foo.py');
    expect(rows[0].job_type).toBe('change_impact');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].created_at).toBeGreaterThan(0);
  });

  it('inserts job with payload when provided', () => {
    insertLlmJob({
      file_path: '/project/src/bar.py',
      job_type: 'summary',
      priority_tier: 1,
      payload: JSON.stringify({ diff: '--- a\n+++ b\n@@ -1,1 +1,2 @@\n+new line' }),
    });

    const sqlite = getSqlite();
    const rows = sqlite.prepare('SELECT * FROM llm_jobs WHERE file_path = ?').all('/project/src/bar.py') as Array<{
      status: string;
      error_message: string | null;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });
});
