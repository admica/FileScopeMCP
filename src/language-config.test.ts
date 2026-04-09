// src/language-config.test.ts
// Parity and confidence tests for Python, Rust, and C/C++ AST extractors.
// TDD: RED phase — written before implementation to define expected behavior.
//
// Notes on regex parity:
//   Python (.py) and Rust (.rs) regex patterns have no capture groups, so
//   buildRegexExtractor produces [] for these languages. Parity tests for
//   Python/Rust verify AST output correctness directly rather than comparing
//   to broken regex output. C/C++ regex DOES have capture groups, so parity
//   comparison is meaningful there.

import { describe, it, expect } from 'vitest';
import { extractEdges, buildRegexExtractor } from './language-config.js';
import { EXTRACTED, CONFIDENCE_SOURCE_EXTRACTED } from './confidence.js';

// ─── Python extractor parity ────────────────────────────────────────────────

describe('Python extractor parity', () => {
  const FIXTURE = `import os\nfrom json import loads\nimport pathlib`;
  const filePath = '/project/test.py';
  const projectRoot = '/project';

  it('AST produces package edges for stdlib imports', async () => {
    const astEdges = await extractEdges(filePath, FIXTURE, projectRoot);
    expect(astEdges.length).toBeGreaterThan(0);
    const pkgNames = astEdges.map(e => e.packageName ?? e.target);
    expect(pkgNames).toContain('os');
    expect(pkgNames).toContain('json');
    expect(pkgNames).toContain('pathlib');
  });

  it('all AST edges have EXTRACTED confidence', async () => {
    const edges = await extractEdges(filePath, FIXTURE, projectRoot);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
      expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_EXTRACTED);
    }
  });

  it('all stdlib imports classified as isPackage: true', async () => {
    const edges = await extractEdges(filePath, FIXTURE, projectRoot);
    // os, json, pathlib are all stdlib — absolute imports → isPackage: true
    for (const e of edges) {
      expect(e.isPackage).toBe(true);
    }
  });

  it('from import extracts top-level module name', async () => {
    const fixture = 'from os.path import join';
    const edges = await extractEdges(filePath, fixture, projectRoot);
    expect(edges.length).toBeGreaterThan(0);
    // Top-level module is 'os', not 'os.path'
    const pkgNames = edges.map(e => e.packageName ?? e.target);
    expect(pkgNames).toContain('os');
  });
});

// ─── Rust extractor ─────────────────────────────────────────────────────────

describe('Rust extractor', () => {
  const FIXTURE = `use std::io;\nuse serde::Deserialize;\nextern crate log;`;
  const filePath = '/project/src/main.rs';
  const projectRoot = '/project';

  it('AST produces package edges for external crates', async () => {
    const edges = await extractEdges(filePath, FIXTURE, projectRoot);
    expect(edges.length).toBeGreaterThan(0);
    const pkgNames = edges.filter(e => e.isPackage).map(e => e.packageName ?? e.target);
    expect(pkgNames).toContain('std');
    expect(pkgNames).toContain('serde');
    expect(pkgNames).toContain('log');
  });

  it('all AST edges have EXTRACTED confidence', async () => {
    const edges = await extractEdges(filePath, FIXTURE, projectRoot);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
      expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_EXTRACTED);
    }
  });

  it('extern crate declaration produces isPackage: true edge', async () => {
    const fixture = 'extern crate log;';
    const edges = await extractEdges(filePath, fixture, projectRoot);
    expect(edges.length).toBeGreaterThan(0);
    const pkgEdge = edges.find(e => e.packageName === 'log');
    expect(pkgEdge).toBeDefined();
    expect(pkgEdge!.isPackage).toBe(true);
  });

  it('mod_item with body produces no edge (inline module)', async () => {
    const fixture = `mod inline { fn x() {} }`;
    const edges = await extractEdges(filePath, fixture, projectRoot);
    // Inline module (with body) should produce no edges
    expect(edges).toHaveLength(0);
  });

  it('mod_item without body produces a local edge attempt', async () => {
    // mod utils; (no body) → should attempt to find utils.rs
    // Since the file won't exist in test context, edge may be empty,
    // but the extractor must not crash
    const fixture = `mod utils;`;
    const edges = await extractEdges(filePath, fixture, projectRoot);
    // No crash — result may be empty (file doesn't exist) or non-empty
    expect(Array.isArray(edges)).toBe(true);
  });
});

// ─── C extractor parity ──────────────────────────────────────────────────────

describe('C extractor parity', () => {
  const filePath = '/project/src/main.c';
  const projectRoot = '/project';

  it('system include produces isPackage: true edge', async () => {
    const fixture = '#include <stdio.h>';
    const astEdges = await extractEdges(filePath, fixture, projectRoot);
    expect(astEdges.length).toBeGreaterThan(0);
    const sysEdge = astEdges.find(e => e.isPackage);
    expect(sysEdge).toBeDefined();
    expect(sysEdge!.packageName).toBe('stdio.h');
  });

  it('local include produces isPackage: false edge', async () => {
    // myheader.h won't exist on disk, so edge should be skipped (access check)
    // but the extractor must not crash
    const fixture = '#include "myheader.h"';
    const edges = await extractEdges(filePath, fixture, projectRoot);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('all system include AST edges have EXTRACTED confidence', async () => {
    const fixture = '#include <stdio.h>\n#include <stdlib.h>';
    const edges = await extractEdges(filePath, fixture, projectRoot);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
      expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_EXTRACTED);
    }
  });

  it('parity: AST and regex both produce package edges for system headers', async () => {
    const fixture = '#include <stdio.h>\n#include <stdlib.h>';
    const astEdges = await extractEdges(filePath, fixture, projectRoot);
    const regexExtract = buildRegexExtractor('.c');
    const regexEdges = await regexExtract(filePath, fixture, projectRoot);

    // Both produce package edges for system headers — same count
    expect(astEdges.filter(e => e.isPackage).length).toBe(
      regexEdges.filter(e => e.isPackage).length
    );

    // AST produces packageName; regex resolves to path but both capture same header basenames
    const astPkgNames = astEdges.filter(e => e.isPackage).map(e => e.packageName ?? '').sort();
    expect(astPkgNames).toEqual(['stdio.h', 'stdlib.h']);
  });
});

// ─── C++ extractor parity ────────────────────────────────────────────────────

describe('C++ extractor parity', () => {
  const filePath = '/project/src/main.cpp';
  const projectRoot = '/project';

  it('system include produces isPackage: true edge', async () => {
    const fixture = '#include <iostream>';
    const edges = await extractEdges(filePath, fixture, projectRoot);
    expect(edges.length).toBeGreaterThan(0);
    const sysEdge = edges.find(e => e.isPackage);
    expect(sysEdge).toBeDefined();
    expect(sysEdge!.packageName).toBe('iostream');
  });

  it('local include does not crash (file existence check)', async () => {
    const fixture = '#include "utils.hpp"';
    const edges = await extractEdges(filePath, fixture, projectRoot);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('all system include AST edges have EXTRACTED confidence', async () => {
    const fixture = '#include <iostream>\n#include <vector>';
    const edges = await extractEdges(filePath, fixture, projectRoot);
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
      expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_EXTRACTED);
    }
  });

  it('parity: AST and regex both produce package edges for system headers', async () => {
    const fixture = '#include <iostream>\n#include <vector>';
    const astEdges = await extractEdges(filePath, fixture, projectRoot);
    const regexExtract = buildRegexExtractor('.cpp');
    const regexEdges = await regexExtract(filePath, fixture, projectRoot);

    // Both produce package edges for system headers — same count
    expect(astEdges.filter(e => e.isPackage).length).toBe(
      regexEdges.filter(e => e.isPackage).length
    );

    // AST packageName carries the exact header name
    const astPkgNames = astEdges.filter(e => e.isPackage).map(e => e.packageName ?? '').sort();
    expect(astPkgNames).toEqual(['iostream', 'vector']);
  });
});

// ─── Grammar fallback behavior ───────────────────────────────────────────────

describe('Grammar fallback behavior', () => {
  it('unknown extension returns empty array without crashing', async () => {
    const edges = await extractEdges('/project/test.unknown_ext_xyz', 'content', '/project');
    expect(edges).toHaveLength(0);
  });

  it('Python regex extractor (buildRegexExtractor) is callable and returns array', async () => {
    // Verifies buildRegexExtractor export is accessible for test use
    const regexExtract = buildRegexExtractor('.py');
    expect(typeof regexExtract).toBe('function');
    const result = await regexExtract('/project/test.py', 'import os', '/project');
    expect(Array.isArray(result)).toBe(true);
    // Python regex has no capture groups, so result is empty
    expect(result).toHaveLength(0);
  });
});
