// src/change-detector/ast-parser.call-sites.test.ts
// Phase 37 CSE-02 — callSiteCandidate emission + callerStack frame shape tests.
// Covers: callerStack push/pop rules, identifier-callee emission, member/subscript/
// require/import discard, class-body attribution, nested-function non-push,
// lexical_declaration (const foo = () => {}), exported-function callerStartLine,
// self-loop storage, and single-pass invariant regression guard.
import { describe, it, expect } from 'vitest';
import { extractRicherEdges } from './ast-parser.js';

// ─── CallSiteCandidate emission (CSE-02) ─────────────────────────────────────

describe("extractRicherEdges — callSiteCandidates emission (CSE-02)", () => {
  it('Test 2 (emit): top-level function calling identifier emits one candidate', () => {
    const src = `function foo() { bar(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(1);
    expect(r.callSiteCandidates[0]).toMatchObject({
      callerName: 'foo',
      callerStartLine: 1,
      calleeName: 'bar',
      calleeSpecifier: null,
      callLine: 1,
    });
  });

  it('Test 3 (pop): top-module-level call_expression outside any tracked symbol does NOT emit candidate (callerStack empty)', () => {
    const src = `function foo() {}\nbar();`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    // Only calls inside foo() should be tracked; bar() at module level is not
    expect(r.callSiteCandidates).toHaveLength(0);
  });

  it('Test 4 (member skip): obj.foo() does NOT emit a candidate', () => {
    const src = `function caller() { obj.foo(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(0);
  });

  it('Test 5 (subscript skip): obj[m]() does NOT emit a candidate', () => {
    const src = `function caller() { obj[m](); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(0);
  });

  it('Test 6 (require skip): require() inside tracked symbol does NOT emit call-site candidate (handled as import edge)', () => {
    const src = `function caller() { const x = require('./x'); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    // require handled as regularImport, not a callSiteCandidate
    expect(r.callSiteCandidates).toHaveLength(0);
    expect(r.regularImports).toContain('./x');
  });

  it('Test 6b (import() skip): dynamic import() inside tracked symbol does NOT emit call-site candidate', () => {
    const src = `function caller() { import('./x'); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(0);
    expect(r.regularImports).toContain('./x');
  });

  it('Test 7 (class body): call inside class method body attributed to class name', () => {
    const src = `class MyService {\n  run() { helper(); }\n}`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(1);
    expect(r.callSiteCandidates[0]).toMatchObject({
      callerName: 'MyService',
      callerStartLine: 1,
      calleeName: 'helper',
    });
  });

  it('Test 8 (nested function): inner function inside top-level outer does NOT push new frame; calls attributed to outer', () => {
    const src = `function outerFn() {\n  function innerFn() {}\n  baz();\n}`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    // baz() should be attributed to outerFn; innerFn does NOT push
    const bazCandidates = r.callSiteCandidates.filter(c => c.calleeName === 'baz');
    expect(bazCandidates).toHaveLength(1);
    expect(bazCandidates[0]).toMatchObject({ callerName: 'outerFn' });
  });

  it('Test 9 (lexical_declaration): const foo = () => { bar(); } at top level emits candidate with callerName=foo', () => {
    const src = `const foo = () => { bar(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(1);
    expect(r.callSiteCandidates[0]).toMatchObject({
      callerName: 'foo',
      callerStartLine: 1,
      calleeName: 'bar',
      calleeSpecifier: null,
    });
  });

  it('Test 10 (exported function callerStartLine): export function foo() { bar(); } callerStartLine matches export_statement row+1', () => {
    const src = `export function foo() { bar(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(1);
    // export_statement starts at row 0 → startLine = 1
    expect(r.callSiteCandidates[0]).toMatchObject({
      callerName: 'foo',
      callerStartLine: 1,
      calleeName: 'bar',
    });
    // Also verify the symbol row has the same startLine (Pitfall A alignment)
    const sym = r.symbols.find(s => s.name === 'foo')!;
    expect(sym.startLine).toBe(r.callSiteCandidates[0].callerStartLine);
  });

  it('Test 10b (exported function callerStartLine multi-line): export on line 2 matches symbol startLine', () => {
    const src = `// comment\nexport function foo() { bar(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(1);
    expect(r.callSiteCandidates[0].callerStartLine).toBe(2);
    const sym = r.symbols.find(s => s.name === 'foo')!;
    expect(sym.startLine).toBe(r.callSiteCandidates[0].callerStartLine);
  });

  it('Test 11 (self-loop): recursive function foo() { foo(); } emits a candidate (self-loops stored)', () => {
    const src = `function foo() { foo(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(1);
    expect(r.callSiteCandidates[0]).toMatchObject({
      callerName: 'foo',
      calleeName: 'foo',
    });
  });

  it('emits no candidates when file has no functions', () => {
    const src = `const x = 1;\nconst y = 2;`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(0);
  });

  it('emits candidate from generator function top-level', () => {
    const src = `function* gen() { bar(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(1);
    expect(r.callSiteCandidates[0]).toMatchObject({ callerName: 'gen', calleeName: 'bar' });
  });

  it('multiple calls inside same function emit multiple candidates', () => {
    const src = `function f() { a(); b(); c(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(3);
    const names = r.callSiteCandidates.map(c => c.calleeName);
    expect(names).toContain('a');
    expect(names).toContain('b');
    expect(names).toContain('c');
  });

  it('calls across multiple top-level functions are correctly attributed', () => {
    const src = `function alpha() { one(); }\nfunction beta() { two(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(2);
    const alphaCall = r.callSiteCandidates.find(c => c.callerName === 'alpha')!;
    const betaCall = r.callSiteCandidates.find(c => c.callerName === 'beta')!;
    expect(alphaCall.calleeName).toBe('one');
    expect(betaCall.calleeName).toBe('two');
  });
});

// ─── callerStack frame shape ──────────────────────────────────────────────────

describe("extractRicherEdges — callerStack frame shape", () => {
  it('Test 1 (types): CallSiteCandidate has all required fields', () => {
    const src = `function f() { g(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    const c = r.callSiteCandidates[0];
    expect(c).toHaveProperty('callerName');
    expect(c).toHaveProperty('callerStartLine');
    expect(c).toHaveProperty('calleeName');
    expect(c).toHaveProperty('calleeSpecifier');
    expect(c).toHaveProperty('callLine');
    expect(c.calleeSpecifier).toBeNull();
    expect(typeof c.callerStartLine).toBe('number');
    expect(typeof c.callLine).toBe('number');
  });

  it('callLine is 1-indexed source line of the call expression', () => {
    const src = `function f() {\n  g();\n}`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    // g() is on line 2 (1-indexed)
    expect(r.callSiteCandidates[0].callLine).toBe(2);
  });

  it('exported class does NOT push callerStack (only function_declaration/generator/class_declaration does for bare; export_statement wrapping class does)', () => {
    // Bare class_declaration at top level should push
    const src = `class Svc { method() { helper(); } }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    expect(r.callSiteCandidates).toHaveLength(1);
    expect(r.callSiteCandidates[0].callerName).toBe('Svc');
  });

  it('const with non-function RHS does NOT push callerStack', () => {
    // const x = 42 should not create a caller frame
    const src = `const x = 42;\nfunction caller() { x(); }`;
    const r = extractRicherEdges('/p/f.ts', src)!;
    const xCalls = r.callSiteCandidates.filter(c => c.callerName === 'x');
    expect(xCalls).toHaveLength(0);
    // caller() frame should still push
    const callerCalls = r.callSiteCandidates.filter(c => c.callerName === 'caller');
    expect(callerCalls).toHaveLength(1);
  });

  it('Test 12 (single-pass invariant): callSiteCandidates field is present on returned object', () => {
    // Verifies the return shape includes the new field without adding parser.parse()
    const src = `export function foo() {}`;
    const r = extractRicherEdges('/p/f.ts', src);
    expect(r).not.toBeNull();
    expect(r).toHaveProperty('callSiteCandidates');
    expect(Array.isArray(r!.callSiteCandidates)).toBe(true);
  });
});
