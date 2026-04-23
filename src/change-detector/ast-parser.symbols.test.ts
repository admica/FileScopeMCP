// src/change-detector/ast-parser.symbols.test.ts
// Phase 33 SYM-01/02/07/08, IMP-01/02 — symbol extraction + per-import metadata
// from the widened extractRicherEdges() single-pass AST walk.
import { describe, it, expect } from 'vitest';
import { extractRicherEdges } from './ast-parser.js';

// ─── Six kinds (exported, bare top-level) ────────────────────────────────

describe('extractRicherEdges — function kind', () => {
  it('emits exported function with kind=function, isExport=true, 1-indexed lines', () => {
    const src = `export function foo(a: string): number { return 1; }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.symbols).toHaveLength(1);
    expect(r.symbols[0]).toMatchObject({ name: 'foo', kind: 'function', isExport: true, startLine: 1 });
  });

  it('emits non-exported function with isExport=false', () => {
    const src = `function helper(): void {}`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'helper', kind: 'function', isExport: false }));
  });

  it('emits generator function as kind=function', () => {
    const src = `export function* gen() { yield 1; }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'gen', kind: 'function', isExport: true }));
  });
});

describe('extractRicherEdges — class kind', () => {
  it('emits exported class with multi-line startLine/endLine', () => {
    const src = `export class Foo {\n  a = 1;\n  b() {}\n}`;
    const r = extractRicherEdges('/p/c.ts', src)!;
    const sym = r.symbols.find(s => s.name === 'Foo')!;
    expect(sym.kind).toBe('class');
    expect(sym.isExport).toBe(true);
    expect(sym.startLine).toBe(1);
    expect(sym.endLine).toBeGreaterThanOrEqual(4);
  });

  it('emits non-exported class with isExport=false', () => {
    const src = `class Private {}`;
    const r = extractRicherEdges('/p/c.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'Private', kind: 'class', isExport: false }));
  });

  it('decorator-wrapped class captures decorator startLine', () => {
    const src = `@Decorator()\nexport class Dec {}`;
    const r = extractRicherEdges('/p/c.ts', src)!;
    const sym = r.symbols.find(s => s.name === 'Dec')!;
    expect(sym.kind).toBe('class');
    expect(sym.startLine).toBe(1);  // decorator line
  });
});

describe('extractRicherEdges — interface kind', () => {
  it('emits exported interface', () => {
    const src = `export interface IFoo { a: number; }`;
    const r = extractRicherEdges('/p/i.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'IFoo', kind: 'interface', isExport: true }));
  });
});

describe('extractRicherEdges — type alias kind', () => {
  it('emits exported type alias', () => {
    const src = `export type T = string | number;`;
    const r = extractRicherEdges('/p/t.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'T', kind: 'type', isExport: true }));
  });
});

describe('extractRicherEdges — enum kind', () => {
  it('emits exported enum', () => {
    const src = `export enum Color { Red, Blue }`;
    const r = extractRicherEdges('/p/e.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'Color', kind: 'enum', isExport: true }));
  });
});

describe('extractRicherEdges — const kind + arrow classification', () => {
  it('emits exported const with kind=const', () => {
    const src = `export const X = 42;`;
    const r = extractRicherEdges('/p/k.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'X', kind: 'const', isExport: true }));
  });

  it('classifies `const foo = () => {}` as kind=function (SYM-07 JSX philosophy)', () => {
    const src = `export const Foo = () => <div />;`;
    const r = extractRicherEdges('/p/k.tsx', src)!;
    const sym = r.symbols.find(s => s.name === 'Foo')!;
    expect(sym.kind).toBe('function');
    expect(sym.isExport).toBe(true);
  });

  it('emits one symbol per declarator in `const a = 1, b = 2;`', () => {
    const src = `export const a = 1, b = 2;`;
    const r = extractRicherEdges('/p/k.ts', src)!;
    const names = r.symbols.map(s => s.name).sort();
    expect(names).toEqual(['a', 'b']);
  });

  it('skips `export let` declarations (Pitfall 2)', () => {
    const src = `export let mutable = 1;`;
    const r = extractRicherEdges('/p/k.ts', src)!;
    expect(r.symbols.find(s => s.name === 'mutable')).toBeUndefined();
  });

  it('skips `export var` declarations', () => {
    const src = `export var legacy = 1;`;
    const r = extractRicherEdges('/p/k.ts', src)!;
    expect(r.symbols.find(s => s.name === 'legacy')).toBeUndefined();
  });
});

// ─── Default exports (D-06) ───────────────────────────────────────────────

describe('extractRicherEdges — default exports', () => {
  it('emits named default function', () => {
    const src = `export default function foo() {}`;
    const r = extractRicherEdges('/p/d.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'foo', kind: 'function', isExport: true }));
  });

  it('emits named default class', () => {
    const src = `export default class Foo {}`;
    const r = extractRicherEdges('/p/d.ts', src)!;
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'Foo', kind: 'class', isExport: true }));
  });

  it('skips anonymous default function (no useful name)', () => {
    const src = `export default function() {}`;
    const r = extractRicherEdges('/p/d.ts', src)!;
    expect(r.symbols).toHaveLength(0);
  });

  it('skips anonymous default object expression', () => {
    const src = `export default { a: 1 };`;
    const r = extractRicherEdges('/p/d.ts', src)!;
    expect(r.symbols).toHaveLength(0);
  });
});

// ─── Re-exports (SYM-08) ──────────────────────────────────────────────────

describe('extractRicherEdges — re-exports NOT populated', () => {
  it('skips `export * from` statements', () => {
    const src = `export * from './foo.js';`;
    const r = extractRicherEdges('/p/r.ts', src)!;
    expect(r.symbols).toHaveLength(0);
  });

  it('skips `export { x } from` statements', () => {
    const src = `export { x } from './foo.js';`;
    const r = extractRicherEdges('/p/r.ts', src)!;
    expect(r.symbols).toHaveLength(0);
  });

  it('skips `export type { X } from` statements', () => {
    const src = `export type { X } from './types.js';`;
    const r = extractRicherEdges('/p/r.ts', src)!;
    expect(r.symbols).toHaveLength(0);
  });
});

// ─── Ambient declarations (Pitfall 1) ──────────────────────────────────

describe('extractRicherEdges — ambient declarations', () => {
  it('skips `declare function` at top level', () => {
    const src = `declare function foo(): void;`;
    const r = extractRicherEdges('/p/a.ts', src)!;
    expect(r.symbols.find(s => s.name === 'foo')).toBeUndefined();
  });

  it('skips `declare class` at top level', () => {
    const src = `declare class Bar {}`;
    const r = extractRicherEdges('/p/a.ts', src)!;
    expect(r.symbols.find(s => s.name === 'Bar')).toBeUndefined();
  });
});

// ─── Import metadata (IMP-01, IMP-02) ─────────────────────────────────

describe('extractRicherEdges — importMeta', () => {
  it('captures named imports with specifier and 1-indexed line', () => {
    const src = `\nimport { useState, useEffect } from 'react';`;  // blank line 1, import on line 2
    const r = extractRicherEdges('/p/h.ts', src)!;
    expect(r.importMeta).toHaveLength(1);
    expect(r.importMeta[0].specifier).toBe('react');
    expect(r.importMeta[0].line).toBe(2);
    expect(r.importMeta[0].importedNames).toEqual(expect.arrayContaining(['useState', 'useEffect']));
  });

  it('captures default import as ["default"]', () => {
    const src = `import React from 'react';`;
    const r = extractRicherEdges('/p/h.ts', src)!;
    expect(r.importMeta).toHaveLength(1);
    const m = r.importMeta.find(x => x.specifier === 'react')!;
    expect(m.importedNames).toEqual(['default']);
    expect(m.line).toBe(1);
  });

  it('captures namespace import as ["*"] (IMP-02)', () => {
    const src = `import * as ns from './ns.js';`;
    const r = extractRicherEdges('/p/h.ts', src)!;
    const m = r.importMeta.find(x => x.specifier === './ns.js')!;
    expect(m.importedNames).toEqual(['*']);
  });

  it('captures mixed default + named import', () => {
    const src = `import React, { useState } from 'react';`;
    const r = extractRicherEdges('/p/h.ts', src)!;
    const m = r.importMeta.find(x => x.specifier === 'react')!;
    expect(m.importedNames).toEqual(expect.arrayContaining(['default', 'useState']));
  });

  it('captures aliased named import as the ORIGINAL exported name', () => {
    const src = `import { foo as bar } from './mod.js';`;
    const r = extractRicherEdges('/p/h.ts', src)!;
    const m = r.importMeta.find(x => x.specifier === './mod.js')!;
    expect(m.importedNames).toEqual(['foo']);
    expect(m.importedNames).not.toContain('bar');
  });

  it('produces separate importMeta entries for two import statements targeting the same module', () => {
    const src = `import { a } from './mod.js';\nimport { b } from './mod.js';`;
    const r = extractRicherEdges('/p/h.ts', src)!;
    const metas = r.importMeta.filter(x => x.specifier === './mod.js');
    expect(metas).toHaveLength(2);
    expect(metas.map(m => m.line).sort((x, y) => x - y)).toEqual([1, 2]);
  });
});

// ─── No regression on existing return fields ────────────────────────────

describe('extractRicherEdges — existing fields still populated', () => {
  it('still returns regularImports + reExportSources alongside new fields', () => {
    const src = `import './side.js';\nexport * from './re.js';\nexport function f(){}`;
    const r = extractRicherEdges('/p/x.ts', src)!;
    expect(r.regularImports).toContain('./side.js');
    expect(r.reExportSources).toContain('./re.js');
    expect(r.symbols).toContainEqual(expect.objectContaining({ name: 'f', kind: 'function', isExport: true }));
  });
});
