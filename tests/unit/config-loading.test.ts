// tests/unit/config-loading.test.ts
// Tests for the loadConfig() function in src/config-utils.ts.
// Covers all code paths: missing file, malformed JSON, invalid schema, valid config.
// Uses a temp directory for config files; cleaned up in afterAll.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { loadConfig } from '../../src/config-utils.js';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'config-loading-test-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('loadConfig', () => {

  it('returns DEFAULT_CONFIG when file does not exist', async () => {
    const config = await loadConfig(path.join(tmpDir, 'nonexistent', 'config.json'));
    expect(config.version).toBe('1.0.0');
    expect(config.excludePatterns).toBeInstanceOf(Array);
    expect(config.fileWatching).toBeDefined();
    expect(config.fileWatching!.enabled).toBeDefined();
  });

  it('returns DEFAULT_CONFIG when file contains malformed JSON', async () => {
    const configPath = path.join(tmpDir, 'malformed.json');
    await fs.writeFile(configPath, '{not valid json!!!}');
    const config = await loadConfig(configPath);
    expect(config.version).toBe('1.0.0');
    expect(config.excludePatterns).toBeInstanceOf(Array);
  });

  it('returns DEFAULT_CONFIG when JSON is valid but fails Zod schema', async () => {
    const configPath = path.join(tmpDir, 'wrong-schema.json');
    await fs.writeFile(configPath, JSON.stringify({ notAValidField: 42, anotherBad: 'value' }));
    const config = await loadConfig(configPath);
    expect(config.version).toBe('1.0.0');
  });

  it('returns parsed config when JSON matches ConfigSchema', async () => {
    const configPath = path.join(tmpDir, 'valid.json');
    const validConfig = {
      baseDirectory: '/my/test/project',
      excludePatterns: ['**/node_modules', '**/dist'],
      fileWatching: {
        enabled: false,
        autoRebuildTree: false,
        maxWatchedDirectories: 500,
        watchForNewFiles: true,
        watchForDeleted: true,
        watchForChanged: true,
      },
      version: '1.0.0',
      llm: { enabled: false },
    };
    await fs.writeFile(configPath, JSON.stringify(validConfig));
    const config = await loadConfig(configPath);
    expect(config.baseDirectory).toBe('/my/test/project');
    // Original patterns preserved (loadConfig auto-merges with DEFAULT_EXCLUDES,
    // so the array also contains current defaults — assertion is on inclusion).
    expect(config.excludePatterns).toContain('**/node_modules');
    expect(config.excludePatterns).toContain('**/dist');
    expect(config.fileWatching!.enabled).toBe(false);
    expect(config.fileWatching!.maxWatchedDirectories).toBe(500);
    expect(config.version).toBe('1.0.0');
  });

  it('augments excludePatterns with missing DEFAULT_EXCLUDES entries on load', async () => {
    // Regression: configs created before a pattern was added to defaults would
    // silently miss it (loadConfig used to read excludePatterns verbatim).
    const configPath = path.join(tmpDir, 'sparse-excludes.json');
    const sparseConfig = {
      baseDirectory: '/my/sparse/project',
      excludePatterns: ['**/custom-only-pattern'],
      fileWatching: {
        enabled: true,
        autoRebuildTree: true,
        maxWatchedDirectories: 1000,
        watchForNewFiles: true,
        watchForDeleted: true,
        watchForChanged: true,
      },
      version: '1.0.0',
    };
    await fs.writeFile(configPath, JSON.stringify(sparseConfig));
    const config = await loadConfig(configPath);

    // Custom pattern preserved
    expect(config.excludePatterns).toContain('**/custom-only-pattern');
    // A representative sample of defaults that were missing from the sparse input
    expect(config.excludePatterns).toContain('**/.git');
    expect(config.excludePatterns).toContain('**/node_modules');
    expect(config.excludePatterns).toContain('**/*.db-wal');
    // No duplicates introduced
    const counts = new Map<string, number>();
    for (const p of config.excludePatterns) counts.set(p, (counts.get(p) ?? 0) + 1);
    for (const [p, c] of counts) expect(c, `pattern "${p}" appears ${c} times`).toBe(1);
  });

  it('returns DEFAULT_CONFIG when file is empty', async () => {
    const configPath = path.join(tmpDir, 'empty.json');
    await fs.writeFile(configPath, '');
    const config = await loadConfig(configPath);
    expect(config.version).toBe('1.0.0');
  });

});
