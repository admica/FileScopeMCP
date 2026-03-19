import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We import from the module under test after setting up mocks
import { setProjectRoot, setConfig, getConfig, getFilescopeIgnore } from './global-state.js';

describe('getFilescopeIgnore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescopemcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns null when no .filescopeignore exists in project root', () => {
    setProjectRoot(tempDir);
    setConfig({ excludePatterns: [] } as any);

    const result = getFilescopeIgnore();
    expect(result).toBeNull();
  });

  it('returns an Ignore instance when .filescopeignore exists with content', () => {
    fs.writeFileSync(path.join(tempDir, '.filescopeignore'), 'node_modules\ndist/\n');
    setProjectRoot(tempDir);
    setConfig({ excludePatterns: [] } as any);

    const result = getFilescopeIgnore();
    expect(result).not.toBeNull();
    expect(typeof result!.ignores).toBe('function');
  });

  it('returns null after setProjectRoot() is called (cache cleared)', () => {
    fs.writeFileSync(path.join(tempDir, '.filescopeignore'), 'node_modules\n');
    setProjectRoot(tempDir);
    setConfig({ excludePatterns: [] } as any);

    // Populate cache
    const before = getFilescopeIgnore();
    expect(before).not.toBeNull();

    // Now reset project root to a dir without .filescopeignore
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filescopemcp-empty-'));
    try {
      setProjectRoot(emptyDir);
      setConfig({ excludePatterns: [] } as any);
      const result = getFilescopeIgnore();
      expect(result).toBeNull();
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('returns null after setConfig() is called (cache cleared)', () => {
    fs.writeFileSync(path.join(tempDir, '.filescopeignore'), 'node_modules\n');
    setProjectRoot(tempDir);
    setConfig({ excludePatterns: [] } as any);

    // Populate cache
    const before = getFilescopeIgnore();
    expect(before).not.toBeNull();

    // Remove the .filescopeignore file, then call setConfig to force reload
    fs.unlinkSync(path.join(tempDir, '.filescopeignore'));
    setConfig({ excludePatterns: [] } as any);
    const result = getFilescopeIgnore();
    expect(result).toBeNull();
  });

  it('is idempotent — calling it twice returns the same instance', () => {
    fs.writeFileSync(path.join(tempDir, '.filescopeignore'), 'dist/\n');
    setProjectRoot(tempDir);
    setConfig({ excludePatterns: [] } as any);

    const first = getFilescopeIgnore();
    const second = getFilescopeIgnore();
    expect(first).toBe(second);
  });

  it('the Ignore instance correctly ignores patterns from .filescopeignore', () => {
    fs.writeFileSync(path.join(tempDir, '.filescopeignore'), 'node_modules\ndist/\n');
    setProjectRoot(tempDir);
    setConfig({ excludePatterns: [] } as any);

    const ig = getFilescopeIgnore();
    expect(ig).not.toBeNull();
    expect(ig!.ignores('node_modules')).toBe(true);
    expect(ig!.ignores('src/index.ts')).toBe(false);
  });
});
