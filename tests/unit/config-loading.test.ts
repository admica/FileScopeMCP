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
        ignoreDotFiles: true,
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
    expect(config.excludePatterns).toEqual(['**/node_modules', '**/dist']);
    expect(config.fileWatching!.enabled).toBe(false);
    expect(config.fileWatching!.maxWatchedDirectories).toBe(500);
    expect(config.version).toBe('1.0.0');
  });

  it('returns DEFAULT_CONFIG when file is empty', async () => {
    const configPath = path.join(tmpDir, 'empty.json');
    await fs.writeFile(configPath, '');
    const config = await loadConfig(configPath);
    expect(config.version).toBe('1.0.0');
  });

});
