// src/change-detector/semantic-diff.test.ts
// Tests for computeSemanticDiff — snapshot comparison and classification.
import { describe, it, expect } from 'vitest';
import { computeSemanticDiff } from './semantic-diff.js';
import type { ExportSnapshot, ExportedSymbol } from './types.js';

function makeSnapshot(overrides: Partial<ExportSnapshot> = {}): ExportSnapshot {
  return {
    filePath: '/project/src/foo.ts',
    exports: [],
    imports: [],
    capturedAt: 1700000000000,
    ...overrides,
  };
}

function sym(name: string, kind: ExportedSymbol['kind'], sig?: string): ExportedSymbol {
  return { name, kind, signature: sig ?? `export ${kind} ${name}` };
}

describe('computeSemanticDiff — null prev (first parse)', () => {
  it('returns changeType=unknown and affectsDependents=true when prev is null', () => {
    const next = makeSnapshot({ exports: [sym('foo', 'function')] });
    const result = computeSemanticDiff(null, next);
    expect(result.changeType).toBe('unknown');
    expect(result.affectsDependents).toBe(true);
    expect(result.confidence).toBe('ast');
    expect(result.filePath).toBe('/project/src/foo.ts');
    expect(result.timestamp).toBeGreaterThan(0);
  });
});

describe('computeSemanticDiff — identical snapshots', () => {
  it('returns changeType=body-only and affectsDependents=false for identical snapshots', () => {
    const exports = [sym('foo', 'function', 'export function foo(a: string): number')];
    const imports = ['./bar.js', './baz.js'];
    const prev = makeSnapshot({ exports, imports });
    const next = makeSnapshot({ exports, imports });
    const result = computeSemanticDiff(prev, next);
    expect(result.changeType).toBe('body-only');
    expect(result.affectsDependents).toBe(false);
    expect(result.confidence).toBe('ast');
  });
});

describe('computeSemanticDiff — added export', () => {
  it('returns changeType=exports-changed with affectsDependents=true and changedExports=[newFn]', () => {
    const prev = makeSnapshot({ exports: [sym('foo', 'function')] });
    const next = makeSnapshot({ exports: [sym('foo', 'function'), sym('newFn', 'function')] });
    const result = computeSemanticDiff(prev, next);
    expect(result.changeType).toBe('exports-changed');
    expect(result.affectsDependents).toBe(true);
    expect(result.changedExports).toContain('newFn');
  });
});

describe('computeSemanticDiff — removed export', () => {
  it('returns changeType=exports-changed with affectsDependents=true', () => {
    const prev = makeSnapshot({ exports: [sym('foo', 'function'), sym('bar', 'function')] });
    const next = makeSnapshot({ exports: [sym('foo', 'function')] });
    const result = computeSemanticDiff(prev, next);
    expect(result.changeType).toBe('exports-changed');
    expect(result.affectsDependents).toBe(true);
    expect(result.changedExports).toContain('bar');
  });
});

describe('computeSemanticDiff — changed signature', () => {
  it('returns changeType=exports-changed with affectsDependents=true', () => {
    const prev = makeSnapshot({ exports: [sym('foo', 'function', 'export function foo(): void')] });
    const next = makeSnapshot({ exports: [sym('foo', 'function', 'export function foo(a: string): number')] });
    const result = computeSemanticDiff(prev, next);
    expect(result.changeType).toBe('exports-changed');
    expect(result.affectsDependents).toBe(true);
    expect(result.changedExports).toContain('foo');
  });
});

describe('computeSemanticDiff — only type/interface changes', () => {
  it('returns changeType=types-changed for type alias change', () => {
    const prev = makeSnapshot({ exports: [sym('MyType', 'type', 'export type MyType = string')] });
    const next = makeSnapshot({ exports: [sym('MyType', 'type', 'export type MyType = string | number')] });
    const result = computeSemanticDiff(prev, next);
    expect(result.changeType).toBe('types-changed');
    expect(result.affectsDependents).toBe(true);
  });

  it('returns changeType=types-changed for interface change', () => {
    const prev = makeSnapshot({ exports: [sym('IFoo', 'interface', 'export interface IFoo { x: number }')] });
    const next = makeSnapshot({ exports: [sym('IFoo', 'interface', 'export interface IFoo { x: number; y: string }')] });
    const result = computeSemanticDiff(prev, next);
    expect(result.changeType).toBe('types-changed');
    expect(result.affectsDependents).toBe(true);
  });
});

describe('computeSemanticDiff — mixed export and type changes', () => {
  it('returns changeType=exports-changed when both function and type changed', () => {
    const prev = makeSnapshot({
      exports: [
        sym('foo', 'function', 'export function foo(): void'),
        sym('MyType', 'type', 'export type MyType = string'),
      ],
    });
    const next = makeSnapshot({
      exports: [
        sym('foo', 'function', 'export function foo(a: string): number'),
        sym('MyType', 'type', 'export type MyType = string | number'),
      ],
    });
    const result = computeSemanticDiff(prev, next);
    // At least one non-type change means exports-changed (not types-changed)
    expect(result.changeType).toBe('exports-changed');
    expect(result.affectsDependents).toBe(true);
  });
});

describe('computeSemanticDiff — import changes trigger exports-changed', () => {
  it('returns changeType=exports-changed when imports differ', () => {
    const prev = makeSnapshot({ exports: [sym('foo', 'function')], imports: ['./bar.js'] });
    const next = makeSnapshot({ exports: [sym('foo', 'function')], imports: ['./bar.js', './new.js'] });
    const result = computeSemanticDiff(prev, next);
    // Import changes count as exports-changed since dependencies changed
    expect(result.changeType).toBe('exports-changed');
    expect(result.affectsDependents).toBe(true);
  });
});

describe('computeSemanticDiff — import order does not matter', () => {
  it('treats same imports in different order as unchanged', () => {
    const prev = makeSnapshot({ exports: [sym('foo', 'function')], imports: ['./a.js', './b.js'] });
    const next = makeSnapshot({ exports: [sym('foo', 'function')], imports: ['./b.js', './a.js'] });
    const result = computeSemanticDiff(prev, next);
    expect(result.changeType).toBe('body-only');
    expect(result.affectsDependents).toBe(false);
  });
});

describe('computeSemanticDiff — result metadata', () => {
  it('always sets filePath from next snapshot', () => {
    const prev = makeSnapshot({ filePath: '/project/old.ts' });
    const next = makeSnapshot({ filePath: '/project/new.ts' });
    const result = computeSemanticDiff(prev, next);
    expect(result.filePath).toBe('/project/new.ts');
  });

  it('always sets timestamp > 0', () => {
    const result = computeSemanticDiff(null, makeSnapshot());
    expect(result.timestamp).toBeGreaterThan(0);
  });
});
