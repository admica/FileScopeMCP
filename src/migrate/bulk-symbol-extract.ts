// src/migrate/bulk-symbol-extract.ts
// Phase 33 SYM-05 — one-shot bulk symbol extraction at first boot after v1.6 migration.
//
// Gated by `kv_state.symbols_bulk_extracted`. Runs during coordinator.init() after
// openDatabase() has applied migration 0005 and before buildFileTree().
//
// OQ-4 resolution: per-file writes go through setEdgesAndSymbols so `file_dependencies`
// rows for existing TS/JS files also get `imported_names` + `import_line` populated —
// NOT just the symbols table. This ensures Phase 34's `get_file_summary.dependents[]`
// returns populated importedNames immediately after first boot.
//
// Per-file errors are logged + skipped (D-12); one bad file does not abort the pass.
// If the whole pass throws before the flag is set, the next boot retries from scratch.

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { getAllFiles, getKvState, setKvState, setEdgesAndSymbols } from '../db/repository.js';
import { extractTsJsFileParse } from '../language-config.js';
import { log } from '../logger.js';

const TS_JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const FLAG_KEY = 'symbols_bulk_extracted';

/**
 * One-shot bulk extraction pass.
 * No-op on subsequent boots (idempotent via kv_state flag).
 */
export async function runSymbolsBulkExtractionIfNeeded(projectRoot: string): Promise<void> {
  if (getKvState(FLAG_KEY) !== null) {
    log('[bulk-symbol-extract] flag already set — skipping bulk pass');
    return;
  }

  log('[bulk-symbol-extract] first boot detected — running bulk symbol extraction');

  const allFiles = getAllFiles();
  const tsJsFiles = allFiles.filter(f => {
    if (f.isDirectory) return false;
    const ext = path.extname(f.path).toLowerCase();
    return TS_JS_EXTS.has(ext);
  });

  log(`[bulk-symbol-extract] processing ${tsJsFiles.length} TS/JS files`);

  let success = 0;
  let failed = 0;

  for (const file of tsJsFiles) {
    try {
      const content = await fs.readFile(file.path, 'utf-8');
      const parsed = await extractTsJsFileParse(file.path, content, projectRoot);
      if (!parsed) {
        // Unsupported extension mid-flight (shouldn't happen given the filter).
        continue;
      }
      // Atomic per-file write — replaces edges AND symbols for this file.
      // This also (re)populates imported_names + import_line on the file_dependencies rows
      // that previously had NULL metadata (per OQ-4).
      setEdgesAndSymbols(file.path, parsed.edges, parsed.symbols, parsed.importMeta);
      success++;
    } catch (err) {
      failed++;
      log(`[bulk-symbol-extract] skipping ${file.path}: ${err}`);
    }
  }

  log(`[bulk-symbol-extract] done — ${success} succeeded, ${failed} skipped`);

  // Only set the flag after the loop finishes. A process crash mid-pass leaves the flag
  // unset so the next boot retries from scratch — safe because setEdgesAndSymbols is idempotent.
  setKvState(FLAG_KEY, new Date().toISOString());
}
