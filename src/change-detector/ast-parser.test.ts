// src/change-detector/ast-parser.test.ts
// Tests for the tree-sitter AST parser — export extraction and import extraction.
import { describe, it, expect } from 'vitest';
import { extractSnapshot, isTreeSitterLanguage } from './ast-parser.js';
import type { ExportSnapshot } from './types.js';

// ─── isTreeSitterLanguage ───────────────────────────────────────────────────

describe('isTreeSitterLanguage', () => {
  it('returns true for .ts', () => {
    expect(isTreeSitterLanguage('.ts')).toBe(true);
  });

  it('returns true for .tsx', () => {
    expect(isTreeSitterLanguage('.tsx')).toBe(true);
  });

  it('returns true for .js', () => {
    expect(isTreeSitterLanguage('.js')).toBe(true);
  });

  it('returns true for .jsx', () => {
    expect(isTreeSitterLanguage('.jsx')).toBe(true);
  });

  it('returns false for .py', () => {
    expect(isTreeSitterLanguage('.py')).toBe(false);
  });

  it('returns false for .rs', () => {
    expect(isTreeSitterLanguage('.rs')).toBe(false);
  });

  it('returns false for .go', () => {
    expect(isTreeSitterLanguage('.go')).toBe(false);
  });
});

// ─── extractSnapshot — export kinds ────────────────────────────────────────

describe('extractSnapshot — named export function', () => {
  it('extracts function export with correct name and kind', () => {
    const source = `export function foo(a: string): number { return 1; }`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    const exports = snapshot!.exports;
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('foo');
    expect(exports[0].kind).toBe('function');
    expect(exports[0].signature).toContain('foo');
  });
});

describe('extractSnapshot — export default class', () => {
  it('extracts default class export with kind=default', () => {
    const source = `export default class Bar { constructor() {} }`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    const exports = snapshot!.exports;
    expect(exports).toHaveLength(1);
    expect(exports[0].kind).toBe('default');
  });
});

describe('extractSnapshot — export type', () => {
  it('extracts type alias with kind=type', () => {
    const source = `export type MyType = string | number;`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    const exports = snapshot!.exports;
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('MyType');
    expect(exports[0].kind).toBe('type');
  });
});

describe('extractSnapshot — export interface', () => {
  it('extracts interface with kind=interface', () => {
    const source = `export interface IFoo { x: number; y: string; }`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    const exports = snapshot!.exports;
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('IFoo');
    expect(exports[0].kind).toBe('interface');
  });
});

describe('extractSnapshot — export enum', () => {
  it('extracts enum with kind=enum', () => {
    const source = `export enum Color { Red, Blue, Green }`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    const exports = snapshot!.exports;
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('Color');
    expect(exports[0].kind).toBe('enum');
  });
});

describe('extractSnapshot — export const', () => {
  it('extracts const variable with kind=variable', () => {
    const source = `export const X = 1;`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    const exports = snapshot!.exports;
    expect(exports).toHaveLength(1);
    expect(exports[0].name).toBe('X');
    expect(exports[0].kind).toBe('variable');
  });
});

describe('extractSnapshot — multiple exports', () => {
  it('extracts all exports from a file with multiple declarations', () => {
    const source = `
export function foo(): void {}
export class Bar {}
export const X = 1;
export type MyType = string;
export interface IFoo { x: number; }
export enum Color { Red }
`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports).toHaveLength(6);
    const names = snapshot!.exports.map(e => e.name).sort();
    expect(names).toEqual(['Bar', 'Color', 'IFoo', 'MyType', 'X', 'foo']);
  });
});

// ─── extractSnapshot — import extraction ───────────────────────────────────

describe('extractSnapshot — import path extraction', () => {
  it('extracts named import paths from import statements', () => {
    const source = `import { X } from './other.js';\nimport type { Foo } from './types.js';`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.imports).toContain('./other.js');
    expect(snapshot!.imports).toContain('./types.js');
  });

  it('extracts require() call paths', () => {
    const source = `const fs = require('./other.js');`;
    const snapshot = extractSnapshot('/project/foo.js', source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.imports).toContain('./other.js');
  });

  it('does NOT extract import paths from string literals', () => {
    const source = `
const msg = "import { X } from './fake.js'";
export function foo() { return msg; }
`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    // Should not find './fake.js' from the string literal
    expect(snapshot!.imports).not.toContain('./fake.js');
  });

  it('does NOT extract import paths from comments', () => {
    const source = `
// import { X } from './commented.js'
/* import { Y } from './block.js' */
export function foo() {}
`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.imports).not.toContain('./commented.js');
    expect(snapshot!.imports).not.toContain('./block.js');
  });
});

// ─── extractSnapshot — grammar dispatch ─────────────────────────────────────

describe('extractSnapshot — grammar dispatch', () => {
  it('parses .ts files using TypeScript grammar', () => {
    const source = `export const x: number = 1;`;
    const snapshot = extractSnapshot('/project/foo.ts', source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports).toHaveLength(1);
  });

  it('parses .tsx files using TSX grammar', () => {
    const source = `
import React from 'react';
export function Component() { return <div>Hello</div>; }
`;
    const snapshot = extractSnapshot('/project/comp.tsx', source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports.some(e => e.name === 'Component')).toBe(true);
  });

  it('parses .js files using JavaScript grammar', () => {
    const source = `export const X = 1;`;
    const snapshot = extractSnapshot('/project/foo.js', source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports).toHaveLength(1);
  });

  it('parses .jsx files using JavaScript grammar', () => {
    const source = `export function Comp() { return <div/>; }`;
    const snapshot = extractSnapshot('/project/comp.jsx', source);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.exports.some(e => e.name === 'Comp')).toBe(true);
  });
});

// ─── extractSnapshot — metadata ────────────────────────────────────────────

describe('extractSnapshot — result metadata', () => {
  it('sets filePath and capturedAt on the snapshot', () => {
    const before = Date.now();
    const snapshot = extractSnapshot('/project/foo.ts', 'export const x = 1;');
    const after = Date.now();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.filePath).toBe('/project/foo.ts');
    expect(snapshot!.capturedAt).toBeGreaterThanOrEqual(before);
    expect(snapshot!.capturedAt).toBeLessThanOrEqual(after);
  });
});
