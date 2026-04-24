// Phase 36 MLS-02 — extractGoSymbols top-level regression.
// Inline Go source fixtures. Covers D-07/D-15/D-16/D-17 + Pitfall 4 (field_identifier).
import { describe, it, expect } from 'vitest';
import { extractGoSymbols } from './language-config.js';

// ─── function_declaration — D-17 isExport ───────────────────────────────────

describe('extractGoSymbols — function_declaration', () => {
  it('emits `func Hello()` as kind=function, isExport=true (first char uppercase)', () => {
    const src = `package main\nfunc Hello() {}\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Hello', kind: 'function', isExport: true });
  });

  it('emits `func unexported()` with isExport=false (first char lowercase)', () => {
    const src = `package main\nfunc unexported() {}\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toContainEqual(expect.objectContaining({ name: 'unexported', kind: 'function', isExport: false }));
  });
});

// ─── method_declaration — D-07 + Pitfall 4 (field_identifier) ───────────────

describe('extractGoSymbols — method_declaration', () => {
  it('emits `func (r *T) Method()` with name=Method, kind=function (Pitfall 4 — name is field_identifier)', () => {
    const src = `package main\nfunc (r *T) Method() {}\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Method', kind: 'function', isExport: true });
  });

  it('emits generic receiver method `func (s S[K, V]) Generic() K` with name=Generic', () => {
    const src = `package main\nfunc (s S[K, V]) Generic() K { return *new(K) }\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    const m = syms.find(s => s.name === 'Generic');
    expect(m).toBeDefined();
    expect(m!.kind).toBe('function');
    expect(m!.isExport).toBe(true);
  });

  it('marks lowercase method as isExport=false', () => {
    const src = `package main\nfunc (r *T) privateMethod() {}\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toContainEqual(expect.objectContaining({ name: 'privateMethod', kind: 'function', isExport: false }));
  });
});

// ─── type_declaration — D-15 inner-kind dispatch ────────────────────────────

describe('extractGoSymbols — type_declaration', () => {
  it('emits `type Foo struct {...}` as kind=struct (D-15 + D-06)', () => {
    const src = `package main\ntype Foo struct { X int }\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Foo', kind: 'struct', isExport: true });
  });

  it('emits `type Bar interface {...}` as kind=interface', () => {
    const src = `package main\ntype Bar interface { Do() }\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Bar', kind: 'interface', isExport: true });
  });

  it('emits `type Baz int` as kind=type', () => {
    const src = `package main\ntype Baz int\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Baz', kind: 'type', isExport: true });
  });

  it('emits `type MyAlias = int` (type_alias branch) as kind=type', () => {
    const src = `package main\ntype MyAlias = int\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'MyAlias', kind: 'type', isExport: true });
  });
});

// ─── const_declaration — D-16 one symbol per const_spec ─────────────────────

describe('extractGoSymbols — const_declaration', () => {
  it('emits `const MaxSize = 100` as one symbol, kind=const', () => {
    const src = `package main\nconst MaxSize = 100\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'MaxSize', kind: 'const', isExport: true });
  });

  it('emits `const ( FirstConst = 1; SecondConst = 2 )` as TWO symbols (D-16 one per const_spec)', () => {
    const src = `package main\nconst ( FirstConst = 1; SecondConst = 2 )\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    const names = syms.map(s => s.name).sort();
    expect(names).toEqual(['FirstConst', 'SecondConst']);
    for (const s of syms) {
      expect(s.kind).toBe('const');
      expect(s.isExport).toBe(true);
    }
  });

  it('marks lowercase const as isExport=false', () => {
    const src = `package main\nconst lowerCase = 1\n`;
    const syms = extractGoSymbols('/p/a.go', src);
    expect(syms).toContainEqual(expect.objectContaining({ name: 'lowerCase', kind: 'const', isExport: false }));
  });
});
