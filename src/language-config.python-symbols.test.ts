// Phase 36 MLS-01 — extractPythonSymbols top-level regression.
// Mirror of src/change-detector/ast-parser.symbols.test.ts structure with inline
// template-literal Python fixtures (D-33). Covers D-10..D-13 + Pitfall 1/2/3.
import { describe, it, expect } from 'vitest';
import { extractPythonSymbols, extractLangFileParse } from './language-config.js';

// ─── function_definition — covers sync def, async def (Pitfall 1), isExport rule (D-13) ──

describe('extractPythonSymbols — function_definition', () => {
  it('emits `def foo(): pass` as kind=function, isExport=true, 1-indexed startLine', () => {
    const src = `def foo(): pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'foo', kind: 'function', startLine: 1, isExport: true });
  });

  it('marks `_private` function as isExport=false (D-13 underscore prefix)', () => {
    const src = `def _private(): pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toContainEqual(expect.objectContaining({ name: '_private', kind: 'function', isExport: false }));
  });

  it('marks `__dunder__` as isExport=false', () => {
    const src = `def __dunder__(): pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toContainEqual(expect.objectContaining({ name: '__dunder__', kind: 'function', isExport: false }));
  });

  it('emits `async def foo()` as kind=function (Pitfall 1 / D-11 — async is a keyword child, still function_definition)', () => {
    const src = `async def foo(): pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'foo', kind: 'function', isExport: true });
  });
});

// ─── class_definition ────────────────────────────────────────────────────────

describe('extractPythonSymbols — class_definition', () => {
  it('emits `class Foo: pass` as kind=class, isExport=true', () => {
    const src = `class Foo: pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Foo', kind: 'class', startLine: 1, isExport: true });
  });

  it('marks `_PrivateClass` as isExport=false', () => {
    const src = `class _PrivateClass: pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toContainEqual(expect.objectContaining({ name: '_PrivateClass', kind: 'class', isExport: false }));
  });
});

// ─── decorated_definition — D-12 / Pitfall 2 ─────────────────────────────────

describe('extractPythonSymbols — decorated_definition', () => {
  it('startLine comes from decorated_definition (decorator line), NOT the def line (D-12)', () => {
    // Decorator on line 1, def on line 2. startLine should be 1.
    const src = `@decorator\ndef foo(): pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('foo');
    expect(syms[0].kind).toBe('function');
    expect(syms[0].startLine).toBe(1);  // decorator line (Pitfall 2)
  });

  it('decorated class uses decorator startLine + inner class name', () => {
    const src = `@cls_decorator\nclass Dec: pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Dec', kind: 'class', startLine: 1 });
  });

  it('decorated async function still emits kind=function with decorator startLine', () => {
    const src = `@decorator\nasync def qux(): pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'qux', kind: 'function', startLine: 1 });
  });
});

// ─── top-level only — D-10 / Pitfall 3 ───────────────────────────────────────

describe('extractPythonSymbols — top-level only', () => {
  it('does NOT emit nested methods inside a class (Pitfall 3)', () => {
    // Class containing three methods → exactly ONE symbol (the class).
    const src = `class Foo:\n    def a(self): pass\n    def b(self): pass\n    def c(self): pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Foo', kind: 'class' });
    // Explicitly assert no method symbols were emitted.
    expect(syms.find(s => s.name === 'a')).toBeUndefined();
    expect(syms.find(s => s.name === 'b')).toBeUndefined();
    expect(syms.find(s => s.name === 'c')).toBeUndefined();
  });

  it('does NOT emit nested classes', () => {
    const src = `class Outer:\n    class Inner: pass\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('Outer');
    expect(syms.find(s => s.name === 'Inner')).toBeUndefined();
  });

  it('does NOT emit nested functions inside a top-level function', () => {
    const src = `def outer():\n    def inner(): pass\n    return inner\n`;
    const syms = extractPythonSymbols('/p/f.py', src);
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('outer');
    expect(syms.find(s => s.name === 'inner')).toBeUndefined();
  });
});

// ─── extractLangFileParse dispatch contract (D-05) ───────────────────────────

describe('extractLangFileParse — dispatch contract (D-05)', () => {
  it('returns { edges, symbols } for .py files', async () => {
    const r = await extractLangFileParse('/p/a.py', `def foo(): pass\n`, '/p');
    expect(r).not.toBeNull();
    expect(r!.symbols).toHaveLength(1);
    expect(r!.symbols[0]).toMatchObject({ name: 'foo', kind: 'function' });
    // importMeta intentionally omitted for non-TS/JS per D-05.
    expect(r!.importMeta).toBeUndefined();
  });

  it('returns null for .ts files (they go through extractTsJsFileParse)', async () => {
    const r = await extractLangFileParse('/p/a.ts', `export function foo() {}`, '/p');
    expect(r).toBeNull();
  });

  it('returns null for unsupported extensions', async () => {
    const r = await extractLangFileParse('/p/a.rs', ``, '/p');
    expect(r).toBeNull();
  });
});
