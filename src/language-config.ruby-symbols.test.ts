// Phase 36 MLS-03 — extractRubySymbols top-level regression.
// Inline Ruby source fixtures. Covers D-07/D-08/D-18..D-22 + Pitfall 5/6.
import { describe, it, expect } from 'vitest';
import { extractRubySymbols } from './language-config.js';

// ─── method + singleton_method — D-07 / D-19 / D-21 ─────────────────────────

describe('extractRubySymbols — method + singleton_method', () => {
  it('emits top-level `def instance_method; end` as kind=function, isExport=true', () => {
    const src = `def instance_method; end\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'instance_method', kind: 'function', isExport: true });
  });

  it('emits top-level `def self.class_method; end` as kind=function (D-07 singleton_method → function)', () => {
    const src = `def self.class_method; end\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'class_method', kind: 'function', isExport: true });
  });
});

// ─── class — D-22 (reopened + scope_resolution) ─────────────────────────────

describe('extractRubySymbols — class', () => {
  it('emits simple `class Foo; end` as kind=class, name=Foo', () => {
    const src = `class Foo; end\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Foo', kind: 'class', isExport: true });
  });

  it('emits `class Baz::Nested; end` with name="Baz::Nested" (scope_resolution text — D-22 note)', () => {
    const src = `class Baz::Nested; end\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Baz::Nested', kind: 'class', isExport: true });
  });

  it('emits TWO symbols for reopened class `class Foo; end\\nclass Foo; end` (Pitfall 6)', () => {
    const src = `class Foo; end\nclass Foo; end\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    const foos = syms.filter(s => s.name === 'Foo' && s.kind === 'class');
    expect(foos).toHaveLength(2);
    // Different startLines — reopened rows are distinguishable.
    expect(foos[0].startLine).not.toBe(foos[1].startLine);
  });
});

// ─── module — D-06 new kind ─────────────────────────────────────────────────

describe('extractRubySymbols — module', () => {
  it('emits `module Bar; end` as kind=module (D-06 new SymbolKind)', () => {
    const src = `module Bar; end\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'Bar', kind: 'module', isExport: true });
  });
});

// ─── constant assignment — D-08 / D-19 ──────────────────────────────────────

describe('extractRubySymbols — constant assignment', () => {
  it('emits `CONST_VALUE = 42` as kind=const (lhs type `constant`)', () => {
    const src = `CONST_VALUE = 42\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'CONST_VALUE', kind: 'const', isExport: true });
  });

  it('does NOT emit `my_var = 42` (lhs type `identifier`, not `constant`)', () => {
    const src = `my_var = 42\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(0);
  });
});

// ─── attr_accessor NOT indexed — Pitfall 5 / D-20 ───────────────────────────

describe('extractRubySymbols — attr_accessor is NOT indexed (Pitfall 5 / D-20)', () => {
  it('`class User; attr_accessor :email; end` emits exactly ONE symbol (User) — no email symbol', () => {
    const src = `class User; attr_accessor :email; end\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(1);
    expect(syms[0]).toMatchObject({ name: 'User', kind: 'class' });
    // Negative assertion — pitfall guard.
    expect(syms.find(s => s.name === 'email')).toBeUndefined();
  });

  it('`attr_accessor :a, :b, :c` inside class synthesizes zero extra symbols', () => {
    const src = `class Model\n  attr_accessor :name, :email, :age\nend\n`;
    const syms = extractRubySymbols('/p/a.rb', src);
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('Model');
    for (const attr of ['name', 'email', 'age']) {
      expect(syms.find(s => s.name === attr)).toBeUndefined();
    }
  });
});
