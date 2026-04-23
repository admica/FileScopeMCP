// scripts/check-find-symbol-desc-len.mjs
// Phase 34 Plan 02 Task 6: sanity-check the find_symbol tool description length.
// Fails (exit 1) if the description exceeds 2000 chars — forces planner to prune
// prose while preserving the 7 D-20 facts.
import { readFileSync } from 'node:fs';

const src = readFileSync('src/mcp-server.ts', 'utf-8');
const m = src.match(/registerTool\("find_symbol"[\s\S]*?description:\s*\[([\s\S]*?)\]\.join/);
if (!m) {
  console.error('ERROR: could not locate find_symbol description array in src/mcp-server.ts');
  process.exit(1);
}
const desc = m[1]
  .split('\n')
  .map(l => l.trim().replace(/^"|",?$/g, ''))
  .join(' ');
console.log('Description length:', desc.length);
process.exit(desc.length < 2000 ? 0 : 1);
