// src/migrate/bulk-multilang-symbol-extract.ts
// Phase 36 MLS-05 — one-shot bulk symbol extraction for Python / Go / Ruby files,
// gated per-language via kv_state. Runs during coordinator.init() after
// runSymbolsBulkExtractionIfNeeded() and before buildFileTree().
//
// Three independent sub-passes, each with its OWN kv_state gate (D-26). Never reuses
// v1.6's `symbols_bulk_extracted` key — that would skip every language on a v1.6→v1.7
// upgrade (Pitfall 17 / D-28b).
//
// Per-file errors: try/catch, log, increment failed count, continue (D-27). Gate write
// happens AFTER each language's loop finishes (D-28), so a mid-pass crash leaves the
// gate unset and the next boot retries that language from scratch — safe because
// setEdgesAndSymbols is idempotent per-path.
//
// No importMeta for Py/Go/Rb: v1.7 carries `imported_names` only for TS/JS (D-05).
// `setEdgesAndSymbols` is called with three args so the fourth (optional) param is
// undefined and edge rows get NULL imported_names / import_line columns.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getAllFiles, getKvState, setKvState, setEdgesAndSymbols } from '../db/repository.js';
import { extractLangFileParse } from '../language-config.js';
import { log } from '../logger.js';

type Lang = { ext: string; flag: string; label: string };

// D-28b: three FRESH kv_state keys — NEVER reuse v1.6's `symbols_bulk_extracted`.
const LANGS: Lang[] = [
  { ext: '.py', flag: 'symbols_py_bulk_extracted', label: 'python' },
  { ext: '.go', flag: 'symbols_go_bulk_extracted', label: 'go' },
  { ext: '.rb', flag: 'symbols_rb_bulk_extracted', label: 'ruby' },
];

async function runSubPass(projectRoot: string, lang: Lang): Promise<void> {
  if (getKvState(lang.flag) !== null) {
    log(`[bulk-multilang-symbol-extract] ${lang.label} flag already set — skipping`);
    return;
  }

  const allFiles = getAllFiles();
  const files = allFiles.filter(f => {
    if (f.isDirectory) return false;
    return path.extname(f.path).toLowerCase() === lang.ext;
  });

  log(`[bulk-multilang-symbol-extract] ${lang.label}: processing ${files.length} files`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    try {
      const content = await fs.readFile(file.path, 'utf-8');
      const parsed = await extractLangFileParse(file.path, content, projectRoot);
      if (!parsed) continue;
      // Three args — no importMeta for Py/Go/Rb (D-05).
      setEdgesAndSymbols(file.path, parsed.edges, parsed.symbols);
      success++;
    } catch (err) {
      failed++;
      log(`[bulk-multilang-symbol-extract] ${lang.label}: skipping ${file.path}: ${err}`);
    }
  }

  log(`[bulk-multilang-symbol-extract] ${lang.label}: ${success} succeeded, ${failed} skipped`);

  // D-28: gate write happens ONLY after the language's loop finishes. Process crash
  // mid-pass leaves this language's gate unset; next boot retries that language.
  setKvState(lang.flag, new Date().toISOString());
}

/**
 * Phase 36 MLS-05 entry point. Runs Python / Go / Ruby sub-passes in sequence.
 * No-op on subsequent boots (three idempotent per-language gates).
 *
 * Running with all three gates set is a no-op. Partial rollout (e.g. Python gate set
 * on a repo that later adds Ruby files) is handled naturally — each language's first-
 * seen-files trigger its own backfill without re-running the others.
 */
export async function runMultilangSymbolsBulkExtractionIfNeeded(projectRoot: string): Promise<void> {
  for (const lang of LANGS) {
    await runSubPass(projectRoot, lang);
  }
}
