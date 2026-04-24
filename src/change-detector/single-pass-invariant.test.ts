// src/change-detector/single-pass-invariant.test.ts
// Phase 36 D-31/D-32 — static source-read regex test guarding the single-pass AST walk
// invariant. Reads source files via fs.readFileSync; no runtime wiring (D-32: no
// Parser.prototype.parse monkey-patch). Ensures every `extract*` function in
// language-config.ts + ast-parser.ts contains ≤ 1 `parser.parse(` call site.
//
// Regex is DELIBERATELY loose (D-31): `/parser\.parse\(/g` matches `parser.parse(` on
// any identifier suffix that ends in lowercase `parser` (e.g. `tsparser.parse` or a
// local `const parser = ...; parser.parse(content)`). Tree-sitter grammar singletons
// (pythonParser, goParser, rubyParser) are typically called via `(xxxParser as any)
// .parse(content)` — these do NOT match the lowercase regex. The guard here catches
// the most common regression pattern: a contributor adds `const parser = getParser();
// parser.parse(x); parser.parse(y);` inside an extractor body.
//
// Permanent suite resident — ships in Phase 36, enforces for every future language
// extractor (D-31). Failing this test means either (a) someone added a second parse
// call inside an extract* function body (the regression we're guarding against), or
// (b) the brace-walker hit a false positive on a brace-heavy string/template literal
// inside an extractor. Fix (a); if (b), upgrade the walker to a tokenizer — do NOT
// weaken the test.
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SOURCE_FILES = [
  path.resolve(__dirname, '../language-config.ts'),
  path.resolve(__dirname, './ast-parser.ts'),
];

// Match `function name(...)`, `export function name(...)`, `async function name(...)`,
// `export async function name(...)`, and `function name<T>(...)`.
const FN_HEADER_RE = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*[<(]/g;

function findFunctionBodies(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  FN_HEADER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FN_HEADER_RE.exec(source)) !== null) {
    const name = m[1];
    // Find the opening brace of the function body.
    let i = m.index + m[0].length;
    while (i < source.length && source[i] !== '{') i++;
    if (i >= source.length) continue;
    // Brace-walk to find the matching closing brace. Tracks lexical context so braces
    // inside string literals, template literals, regex literals, and comments do NOT
    // count toward depth. Without this, utility functions like `extractSignature`
    // that contain `indexOf('{')` produce false positives — the `'{'` string literal
    // unbalances the naive counter and sweeps in the entire rest of the file.
    let depth = 0;
    const start = i;
    type Ctx = 'code' | 'single' | 'double' | 'template' | 'regex' | 'line-comment' | 'block-comment';
    let ctx: Ctx = 'code';
    // Template-literal expression nesting: each `${` increments, each matching `}` decrements.
    // When depth hits zero we return to the enclosing template-literal context.
    const templateStack: Array<'template'> = [];
    for (; i < source.length; i++) {
      const ch = source[i];
      const next = source[i + 1];
      const prev = i > 0 ? source[i - 1] : '';
      if (ctx === 'line-comment') {
        if (ch === '\n') ctx = 'code';
        continue;
      }
      if (ctx === 'block-comment') {
        if (ch === '*' && next === '/') { ctx = 'code'; i++; }
        continue;
      }
      if (ctx === 'single') {
        if (ch === '\\') { i++; continue; }
        if (ch === "'") ctx = 'code';
        continue;
      }
      if (ctx === 'double') {
        if (ch === '\\') { i++; continue; }
        if (ch === '"') ctx = 'code';
        continue;
      }
      if (ctx === 'template') {
        if (ch === '\\') { i++; continue; }
        if (ch === '`') ctx = 'code';
        else if (ch === '$' && next === '{') { templateStack.push('template'); ctx = 'code'; i++; }
        continue;
      }
      if (ctx === 'regex') {
        if (ch === '\\') { i++; continue; }
        if (ch === '/') ctx = 'code';
        continue;
      }
      // ctx === 'code'
      if (ch === '/' && next === '/') { ctx = 'line-comment'; i++; continue; }
      if (ch === '/' && next === '*') { ctx = 'block-comment'; i++; continue; }
      if (ch === "'") { ctx = 'single'; continue; }
      if (ch === '"') { ctx = 'double'; continue; }
      if (ch === '`') { ctx = 'template'; continue; }
      // Detect regex literal: `/` that is NOT a divide operator. Heuristic — preceded by
      // `=` `(` `,` `:` `;` `!` `&` `|` `?` `{` `}` `[` or whitespace / newline.
      if (ch === '/') {
        const p = prev;
        if (p === '' || /[=(,:;!&|?{}[\s\n]/.test(p)) { ctx = 'regex'; continue; }
      }
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        if (templateStack.length > 0) {
          // Closes a `${...}` expression — return to enclosing template-literal context.
          templateStack.pop();
          ctx = 'template';
        } else {
          depth--;
          if (depth === 0) { i++; break; }
        }
      }
    }
    out.push({ name, body: source.slice(start, i) });
  }
  return out;
}

describe('single-pass invariant — parser.parse count per extractor', () => {
  for (const filePath of SOURCE_FILES) {
    const basename = path.basename(filePath);
    it(`${basename}: every extract* function has ≤ 1 parser.parse() call`, () => {
      const src = fs.readFileSync(filePath, 'utf-8');
      const fns = findFunctionBodies(src);
      const extractors = fns.filter(f => /^extract/.test(f.name));
      // Sanity: the source file must contain at least one `extract*` function — if the
      // filter returns zero, the brace-walker or header regex is broken (regression
      // vector in its own right).
      expect(extractors.length, `no extract* functions found in ${basename} — regex or walker broken`).toBeGreaterThan(0);
      for (const fn of extractors) {
        const matches = fn.body.match(/parser\.parse\(/g);
        const count = matches ? matches.length : 0;
        expect(count, `${fn.name} in ${basename} has ${count} parser.parse() calls (expected ≤ 1)`).toBeLessThanOrEqual(1);
      }
    });
  }
});
