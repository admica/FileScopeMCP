#!/usr/bin/env node
// scripts/inspect-symbols.mjs
// Phase 33 SYM-06 — debugging CLI: parse a single TS/JS file and emit the symbol table.
// Default output: plain text, one symbol per line.
// With `--json`: JSONL, one Symbol JSON object per line.
//
// Does NOT open the SQLite DB — exercises the parser only, so it works before a scan runs.
// Requires a prior `npm run build` — imports extractRicherEdges from dist/change-detector/ast-parser.js.

import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const PARSER_JS = path.join(REPO_ROOT, 'dist', 'change-detector', 'ast-parser.js');

if (!existsSync(PARSER_JS)) {
  console.error(`ERROR: ${PARSER_JS} not found.`);
  console.error('Run `npm run build` first — inspect-symbols imports from dist/.');
  process.exit(1);
}

const args = process.argv.slice(2);
const jsonMode = args.includes('--json');
const filePath = args.find(a => !a.startsWith('--'));

if (!filePath) {
  console.error('Usage: npm run inspect-symbols -- <path> [--json]');
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);

let source;
try {
  source = await fs.readFile(resolvedPath, 'utf-8');
} catch (err) {
  console.error(`ERROR: cannot read ${resolvedPath}: ${err?.message ?? err}`);
  process.exit(2);
}

const { extractRicherEdges } = await import(PARSER_JS);
const result = extractRicherEdges(resolvedPath, source);

if (!result) {
  console.error(`No parse result for ${resolvedPath} (unsupported extension or parse error).`);
  process.exit(1);
}

for (const sym of result.symbols) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(sym) + '\n');
  } else {
    const exp = sym.isExport ? ' [export]' : '';
    process.stdout.write(`${sym.name}  ${sym.kind}  L${sym.startLine}-L${sym.endLine}${exp}\n`);
  }
}
