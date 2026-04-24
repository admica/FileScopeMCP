// src/migrate/bulk-call-site-extract.ts
// Phase 37 CSE-06 — one-shot bulk call-site edge extraction for all TS/JS files.
// Gate: call_site_edges_bulk_extracted (written AFTER loop completes).
// Precondition: all three Phase 36 per-language symbol gates must be set
//   (symbols_py_bulk_extracted, symbols_go_bulk_extracted, symbols_rb_bulk_extracted).
//   Phase 36 does NOT set a unified gate (verified 37-RESEARCH §Item 7).
// Per-file errors: try/catch/log/continue. One bad file never aborts the pass.
// Gate write AFTER loop (D-26 / Pitfall 17): a crash mid-pass leaves the gate unset
// so the next boot retries — safe because setEdgesAndSymbols is idempotent per-path.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getAllFiles, getKvState, setKvState, setEdgesAndSymbols } from '../db/repository.js';
import { extractTsJsFileParse } from '../language-config.js';
import { log } from '../logger.js';

const FLAG_KEY = 'call_site_edges_bulk_extracted';

// D-27 option (b): check all three per-language keys individually.
// Phase 36 sets NO unified 'multilang_symbols_bulk_extracted' key (RESEARCH §Item 7).
const PRECONDITION_KEYS = [
  'symbols_py_bulk_extracted',
  'symbols_go_bulk_extracted',
  'symbols_rb_bulk_extracted',
] as const;

const TS_JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/**
 * Phase 37 CSE-06 entry point. Populates symbol_dependencies for every TS/JS
 * file on first boot AFTER Phase 36 multi-language symbols are available.
 *
 * No-op on subsequent boots (idempotent via kv_state flag). Hard-aborts if any
 * Phase 36 per-language gate is unset (next boot retries once Phase 36 completes).
 */
export async function runCallSiteEdgesBulkExtractionIfNeeded(projectRoot: string): Promise<void> {
  // Gate: already ran → no-op.
  if (getKvState(FLAG_KEY) !== null) {
    log('[bulk-call-site-extract] gate already set — skipping');
    return;
  }

  // Hard-abort precondition: all three Phase 36 gates must be set.
  // If any is missing, log WARN and return WITHOUT setting the gate.
  // Next boot retries automatically once Phase 36 backfill has run.
  for (const key of PRECONDITION_KEYS) {
    if (getKvState(key) === null) {
      log(`[bulk-call-site-extract] WARN: precondition key '${key}' not set — aborting. Re-run after Phase 36 multilang symbols backfill completes.`);
      return;
    }
  }

  log('[bulk-call-site-extract] first boot — running bulk call-site edge extraction');

  const allFiles = getAllFiles();
  const tsJsFiles = allFiles.filter(f => {
    if (f.isDirectory) return false;
    return TS_JS_EXTS.has(path.extname(f.path).toLowerCase());
  });

  log(`[bulk-call-site-extract] processing ${tsJsFiles.length} TS/JS files`);

  let success = 0;
  let failed = 0;

  for (const file of tsJsFiles) {
    try {
      const content = await fs.readFile(file.path, 'utf-8');
      const parsed = await extractTsJsFileParse(file.path, content, projectRoot);
      if (!parsed) continue;
      setEdgesAndSymbols(file.path, parsed.edges, parsed.symbols, parsed.importMeta, parsed.callSiteEdges);
      success++;
    } catch (err) {
      failed++;
      log(`[bulk-call-site-extract] skipping ${file.path}: ${err}`);
    }
  }

  log(`[bulk-call-site-extract] done — ${success} succeeded, ${failed} skipped`);

  // Gate written AFTER loop (D-26 / Pitfall 17).
  // A crash mid-pass leaves the gate unset so the next boot retries from scratch.
  setKvState(FLAG_KEY, new Date().toISOString());
}
