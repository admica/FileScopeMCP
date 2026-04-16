// tests/unit/ast-diffing.test.ts
// Comprehensive tests for the semantic change detection system.
// Covers ExportSnapshot extraction, semantic diff classification,
// and the affectsDependents decision logic.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { extractSnapshot, isTreeSitterLanguage, extractRicherEdges } from '../../src/change-detector/ast-parser.js';
import { computeSemanticDiff } from '../../src/change-detector/semantic-diff.js';
import type { ExportSnapshot, ExportedSymbol } from '../../src/change-detector/types.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ast-diff-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isTreeSitterLanguage
// ═══════════════════════════════════════════════════════════════════════════════

describe('isTreeSitterLanguage', () => {
  it('returns true for .ts, .tsx, .js, .jsx', () => {
    expect(isTreeSitterLanguage('.ts')).toBe(true);
    expect(isTreeSitterLanguage('.tsx')).toBe(true);
    expect(isTreeSitterLanguage('.js')).toBe(true);
    expect(isTreeSitterLanguage('.jsx')).toBe(true);
  });

  it('returns false for other extensions', () => {
    expect(isTreeSitterLanguage('.py')).toBe(false);
    expect(isTreeSitterLanguage('.rs')).toBe(false);
    expect(isTreeSitterLanguage('.go')).toBe(false);
    expect(isTreeSitterLanguage('.c')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractSnapshot
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractSnapshot', () => {
  it('returns null for unsupported extension', () => {
    const result = extractSnapshot('/test.py', 'import os');
    expect(result).toBeNull();
  });

  it('extracts exported function with correct kind and signature', () => {
    const source = `export function greet(name: string): string { return 'Hello ' + name; }`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports.length).toBe(1);
    expect(snapshot!.exports[0].name).toBe('greet');
    expect(snapshot!.exports[0].kind).toBe('function');
    expect(snapshot!.exports[0].signature).toContain('greet');
  });

  it('extracts exported class', () => {
    const source = `export class MyService { doWork() {} }`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    const cls = snapshot!.exports.find(e => e.kind === 'class');
    expect(cls).toBeDefined();
    expect(cls!.name).toBe('MyService');
  });

  it('extracts exported const/variable', () => {
    const source = `export const PI = 3.14;`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    const v = snapshot!.exports.find(e => e.kind === 'variable');
    expect(v).toBeDefined();
    expect(v!.name).toBe('PI');
  });

  it('extracts exported type alias', () => {
    const source = `export type UserId = string;`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    const t = snapshot!.exports.find(e => e.kind === 'type');
    expect(t).toBeDefined();
    expect(t!.name).toBe('UserId');
  });

  it('extracts exported interface', () => {
    const source = `export interface Config { port: number; }`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    const iface = snapshot!.exports.find(e => e.kind === 'interface');
    expect(iface).toBeDefined();
    expect(iface!.name).toBe('Config');
  });

  it('extracts exported enum', () => {
    const source = `export enum Direction { Up, Down, Left, Right }`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    const enumSym = snapshot!.exports.find(e => e.kind === 'enum');
    expect(enumSym).toBeDefined();
    expect(enumSym!.name).toBe('Direction');
  });

  it('extracts default export', () => {
    const source = `export default function main() {}`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    const def = snapshot!.exports.find(e => e.kind === 'default');
    expect(def).toBeDefined();
  });

  it('extracts multiple exports', () => {
    const source = `
      export function foo() {}
      export const bar = 1;
      export class Baz {}
      export type MyType = string;
    `;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports.length).toBeGreaterThanOrEqual(4);
  });

  it('extracts import paths', () => {
    const source = `import { x } from './utils';\nimport { y } from 'lodash';`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.imports).toContain('./utils');
    expect(snapshot!.imports).toContain('lodash');
  });

  it('extracts require() as import path', () => {
    const source = `const fs = require('fs');`;
    const snapshot = extractSnapshot('/test.js', source);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.imports).toContain('fs');
  });

  it('extracts re-export source as import path', () => {
    const source = `export { Foo } from './foo';`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.imports).toContain('./foo');
  });

  it('deduplicates import paths', () => {
    const source = `import { a } from './mod';\nimport { b } from './mod';`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    const modImports = snapshot!.imports.filter(i => i === './mod');
    expect(modImports.length).toBe(1);
  });

  it('empty file produces empty exports and imports', () => {
    const snapshot = extractSnapshot('/test.ts', '');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports).toHaveLength(0);
    expect(snapshot!.imports).toHaveLength(0);
  });

  it('non-exported functions are NOT in exports', () => {
    const source = `function internal() {}\nexport function external() {}`;
    const snapshot = extractSnapshot('/test.ts', source);

    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports.length).toBe(1);
    expect(snapshot!.exports[0].name).toBe('external');
  });

  it('captures filePath and capturedAt timestamp', () => {
    const before = Date.now();
    const snapshot = extractSnapshot('/test.ts', 'export const x = 1;');
    const after = Date.now();

    expect(snapshot!.filePath).toBe('/test.ts');
    expect(snapshot!.capturedAt).toBeGreaterThanOrEqual(before);
    expect(snapshot!.capturedAt).toBeLessThanOrEqual(after);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// extractRicherEdges
// ═══════════════════════════════════════════════════════════════════════════════

describe('extractRicherEdges', () => {
  it('returns null for unsupported extension', () => {
    expect(extractRicherEdges('/test.py', 'import os')).toBeNull();
  });

  it('classifies regular imports', () => {
    const source = `import { x } from './utils';`;
    const result = extractRicherEdges('/test.ts', source);

    expect(result).not.toBeNull();
    expect(result!.regularImports).toContain('./utils');
  });

  it('classifies re-export sources', () => {
    const source = `export { Foo } from './foo';`;
    const result = extractRicherEdges('/test.ts', source);

    expect(result).not.toBeNull();
    expect(result!.reExportSources).toContain('./foo');
  });

  it('detects class extends from imported class', () => {
    const source = `import { Base } from './base';\nclass Child extends Base {}`;
    const result = extractRicherEdges('/test.ts', source);

    expect(result).not.toBeNull();
    expect(result!.inheritsFrom.length).toBe(1);
    expect(result!.inheritsFrom[0].className).toBe('Base');
    expect(result!.inheritsFrom[0].sourceSpecifier).toBe('./base');
  });

  it('does NOT detect extends from same-file class', () => {
    const source = `class Base {}\nclass Child extends Base {}`;
    const result = extractRicherEdges('/test.ts', source);

    expect(result).not.toBeNull();
    expect(result!.inheritsFrom).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeSemanticDiff
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeSemanticDiff', () => {
  function makeSnapshot(overrides: Partial<ExportSnapshot> = {}): ExportSnapshot {
    return {
      filePath: '/test.ts',
      exports: [],
      imports: [],
      capturedAt: Date.now(),
      ...overrides,
    };
  }

  function makeExport(name: string, kind: ExportedSymbol['kind'] = 'function', signature = `export ${kind} ${name}`): ExportedSymbol {
    return { name, kind, signature };
  }

  // ─── First parse (prev = null) ─────────────────────────────────────────────

  describe('first parse (prev = null)', () => {
    it('returns changeType=unknown and affectsDependents=true', () => {
      const next = makeSnapshot({ exports: [makeExport('foo')] });
      const result = computeSemanticDiff(null, next);

      expect(result.changeType).toBe('unknown');
      expect(result.affectsDependents).toBe(true);
      expect(result.confidence).toBe('ast');
    });
  });

  // ─── Body-only change ──────────────────────────────────────────────────────

  describe('body-only change', () => {
    it('same exports and imports: changeType=body-only, affectsDependents=false', () => {
      const prev = makeSnapshot({
        exports: [makeExport('foo', 'function', 'export function foo(a: number)')],
        imports: ['./utils'],
      });
      const next = makeSnapshot({
        exports: [makeExport('foo', 'function', 'export function foo(a: number)')],
        imports: ['./utils'],
      });

      const result = computeSemanticDiff(prev, next);

      expect(result.changeType).toBe('body-only');
      expect(result.affectsDependents).toBe(false);
    });
  });

  // ─── Exports changed ──────────────────────────────────────────────────────

  describe('exports changed', () => {
    it('added export: affectsDependents=true', () => {
      const prev = makeSnapshot({ exports: [makeExport('foo')] });
      const next = makeSnapshot({ exports: [makeExport('foo'), makeExport('bar')] });

      const result = computeSemanticDiff(prev, next);

      expect(result.changeType).toBe('exports-changed');
      expect(result.affectsDependents).toBe(true);
      expect(result.changedExports).toContain('bar');
    });

    it('removed export: affectsDependents=true', () => {
      const prev = makeSnapshot({ exports: [makeExport('foo'), makeExport('bar')] });
      const next = makeSnapshot({ exports: [makeExport('foo')] });

      const result = computeSemanticDiff(prev, next);

      expect(result.changeType).toBe('exports-changed');
      expect(result.affectsDependents).toBe(true);
      expect(result.changedExports).toContain('bar');
    });

    it('changed signature: affectsDependents=true', () => {
      const prev = makeSnapshot({
        exports: [makeExport('foo', 'function', 'export function foo(a: string)')],
      });
      const next = makeSnapshot({
        exports: [makeExport('foo', 'function', 'export function foo(a: string, b: number)')],
      });

      const result = computeSemanticDiff(prev, next);

      expect(result.changeType).toBe('exports-changed');
      expect(result.affectsDependents).toBe(true);
    });
  });

  // ─── Types changed ─────────────────────────────────────────────────────────

  describe('types changed', () => {
    it('only type exports changed: changeType=types-changed', () => {
      const prev = makeSnapshot({
        exports: [
          makeExport('foo', 'function', 'export function foo()'),
          makeExport('MyType', 'type', 'export type MyType = string'),
        ],
      });
      const next = makeSnapshot({
        exports: [
          makeExport('foo', 'function', 'export function foo()'),
          makeExport('MyType', 'type', 'export type MyType = number'), // changed
        ],
      });

      const result = computeSemanticDiff(prev, next);

      expect(result.changeType).toBe('types-changed');
      expect(result.affectsDependents).toBe(true);
    });

    it('only interface exports changed: changeType=types-changed', () => {
      const prev = makeSnapshot({
        exports: [makeExport('Config', 'interface', 'export interface Config { a: string }')],
      });
      const next = makeSnapshot({
        exports: [makeExport('Config', 'interface', 'export interface Config { a: string; b: number }')],
      });

      const result = computeSemanticDiff(prev, next);

      expect(result.changeType).toBe('types-changed');
      expect(result.affectsDependents).toBe(true);
    });
  });

  // ─── Imports changed ───────────────────────────────────────────────────────

  describe('imports changed', () => {
    it('new import added: affectsDependents=true', () => {
      const prev = makeSnapshot({ imports: ['./a'] });
      const next = makeSnapshot({ imports: ['./a', './b'] });

      const result = computeSemanticDiff(prev, next);

      expect(result.affectsDependents).toBe(true);
      expect(result.changeType).toBe('exports-changed');
    });

    it('import removed: affectsDependents=true', () => {
      const prev = makeSnapshot({ imports: ['./a', './b'] });
      const next = makeSnapshot({ imports: ['./a'] });

      const result = computeSemanticDiff(prev, next);

      expect(result.affectsDependents).toBe(true);
    });

    it('import order change does NOT matter (sorted comparison)', () => {
      const prev = makeSnapshot({ imports: ['./a', './b'] });
      const next = makeSnapshot({ imports: ['./b', './a'] });

      const result = computeSemanticDiff(prev, next);

      expect(result.changeType).toBe('body-only');
      expect(result.affectsDependents).toBe(false);
    });
  });

  // ─── Mixed changes ─────────────────────────────────────────────────────────

  describe('mixed type and runtime changes', () => {
    it('function + type changed: changeType=exports-changed (not types-changed)', () => {
      const prev = makeSnapshot({
        exports: [
          makeExport('foo', 'function', 'export function foo()'),
          makeExport('MyType', 'type', 'export type MyType = string'),
        ],
      });
      const next = makeSnapshot({
        exports: [
          makeExport('foo', 'function', 'export function foo(x: number)'), // changed
          makeExport('MyType', 'type', 'export type MyType = number'), // changed
        ],
      });

      const result = computeSemanticDiff(prev, next);

      expect(result.changeType).toBe('exports-changed');
      expect(result.affectsDependents).toBe(true);
    });
  });

  // ─── Output shape ──────────────────────────────────────────────────────────

  describe('output shape', () => {
    it('always has filePath, changeType, affectsDependents, confidence, timestamp', () => {
      const prev = makeSnapshot();
      const next = makeSnapshot();
      const result = computeSemanticDiff(prev, next);

      expect(result).toHaveProperty('filePath');
      expect(result).toHaveProperty('changeType');
      expect(result).toHaveProperty('affectsDependents');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('timestamp');
      expect(typeof result.timestamp).toBe('number');
    });

    it('changedExports is undefined when no exports changed', () => {
      const prev = makeSnapshot({ exports: [makeExport('foo')] });
      const next = makeSnapshot({ exports: [makeExport('foo')] });

      const result = computeSemanticDiff(prev, next);

      expect(result.changedExports).toBeUndefined();
    });

    it('changedExports lists changed names when exports differ', () => {
      const prev = makeSnapshot({ exports: [] });
      const next = makeSnapshot({ exports: [makeExport('newFn')] });

      const result = computeSemanticDiff(prev, next);

      expect(result.changedExports).toContain('newFn');
    });
  });
});
