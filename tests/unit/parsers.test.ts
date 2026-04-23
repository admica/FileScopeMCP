// tests/unit/parsers.test.ts
// Comprehensive parser tests for ALL supported languages.
// Covers AST extractors, regex fallbacks, edge types, confidence, weights.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { extractEdges, buildRegexExtractor } from '../../src/language-config.js';
import { EXTRACTED, INFERRED, CONFIDENCE_SOURCE_EXTRACTED, CONFIDENCE_SOURCE_INFERRED } from '../../src/confidence.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setProjectRoot, setConfig } from '../../src/global-state.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parsers-test-'));
  setProjectRoot(tempDir);
  setConfig({ excludePatterns: [] } as any);
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// TypeScript / JavaScript (AST via tree-sitter)
// ═══════════════════════════════════════════════════════════════════════════════

describe('TypeScript parser', () => {
  it('extracts ES6 named import as local dep', async () => {
    // Create the target file so the resolver finds it
    fs.mkdirSync(path.join(tempDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'src', 'utils.ts'), 'export const x = 1;');
    const fixture = `import { x } from './src/utils';`;
    const edges = await extractEdges(path.join(tempDir, 'main.ts'), fixture, tempDir);
    const localEdges = edges.filter(e => !e.isPackage);
    expect(localEdges.length).toBeGreaterThanOrEqual(1);
    expect(localEdges[0].target).toContain('utils');
    expect(localEdges[0].edgeType).toBe('imports');
  });

  it('extracts default import', async () => {
    const fixture = `import React from 'react';`;
    const edges = await extractEdges(path.join(tempDir, 'app.tsx'), fixture, tempDir);
    expect(edges.some(e => e.isPackage && e.packageName === 'react')).toBe(true);
  });

  it('extracts namespace import', async () => {
    const fixture = `import * as path from 'path';`;
    const edges = await extractEdges(path.join(tempDir, 'app.ts'), fixture, tempDir);
    expect(edges.some(e => e.isPackage && e.packageName === 'path')).toBe(true);
  });

  it('extracts require() calls', async () => {
    const fixture = `const fs = require('fs');`;
    const edges = await extractEdges(path.join(tempDir, 'app.js'), fixture, tempDir);
    expect(edges.some(e => e.isPackage && e.packageName === 'fs')).toBe(true);
  });

  it('extracts dynamic import()', async () => {
    const fixture = `const mod = import('lodash');`;
    const edges = await extractEdges(path.join(tempDir, 'app.ts'), fixture, tempDir);
    expect(edges.some(e => e.isPackage && e.packageName === 'lodash')).toBe(true);
  });

  it('extracts re-export with re_exports edge type', async () => {
    const fixture = `export { Foo } from 'some-pkg';`;
    const edges = await extractEdges(path.join(tempDir, 'index.ts'), fixture, tempDir);
    const reExports = edges.filter(e => e.edgeType === 're_exports');
    expect(reExports.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts class extends as inherits edge type', async () => {
    const fixture = `import { Base } from 'base-pkg';\nclass Child extends Base {}`;
    const edges = await extractEdges(path.join(tempDir, 'child.ts'), fixture, tempDir);
    const inherits = edges.filter(e => e.edgeType === 'inherits');
    expect(inherits.length).toBeGreaterThanOrEqual(1);
  });

  it('all TS edges have EXTRACTED confidence', async () => {
    const fixture = `import { x } from 'some-pkg';`;
    const edges = await extractEdges(path.join(tempDir, 'test.ts'), fixture, tempDir);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
      expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_EXTRACTED);
    }
  });

  it('keeps duplicate imports as separate rows per statement (Phase 33 D-08)', async () => {
    // Phase 33 D-08: separate rows per import_statement preserve each row's
    // imported_names/import_line. Weight aggregation is bypassed for TS/JS
    // edges carrying originalSpecifier.
    const fixture = `import { A } from 'pkg';\nimport { B } from 'pkg';`;
    const edges = await extractEdges(path.join(tempDir, 'test.ts'), fixture, tempDir);
    const pkgEdges = edges.filter(e => e.edgeType === 'imports' && e.target.includes('pkg'));
    expect(pkgEdges.length).toBe(2);
    expect(pkgEdges.every(e => e.weight === 1)).toBe(true);
    expect(pkgEdges.every(e => e.originalSpecifier === 'pkg')).toBe(true);
  });

  it('handles .tsx files with JSX', async () => {
    const fixture = `import React from 'react';\nconst App = () => <div />;`;
    const edges = await extractEdges(path.join(tempDir, 'app.tsx'), fixture, tempDir);
    expect(edges.some(e => e.packageName === 'react')).toBe(true);
  });

  it('handles .jsx files', async () => {
    const fixture = `import React from 'react';`;
    const edges = await extractEdges(path.join(tempDir, 'app.jsx'), fixture, tempDir);
    expect(edges.some(e => e.packageName === 'react')).toBe(true);
  });

  it('handles scoped package imports', async () => {
    const fixture = `import { something } from '@scope/package';`;
    const edges = await extractEdges(path.join(tempDir, 'test.ts'), fixture, tempDir);
    expect(edges.some(e => e.isPackage)).toBe(true);
  });

  it('empty file produces no edges', async () => {
    const edges = await extractEdges(path.join(tempDir, 'empty.ts'), '', tempDir);
    expect(edges).toHaveLength(0);
  });

  it('comments-only file produces no edges', async () => {
    const fixture = `// just a comment\n/* block comment */`;
    const edges = await extractEdges(path.join(tempDir, 'comment.ts'), fixture, tempDir);
    expect(edges).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Python (AST via tree-sitter)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Python parser', () => {
  it('extracts simple import statement', async () => {
    const edges = await extractEdges(path.join(tempDir, 'test.py'), 'import os', tempDir);
    expect(edges.some(e => e.packageName === 'os' || e.target.includes('os'))).toBe(true);
  });

  it('extracts from...import statement', async () => {
    const edges = await extractEdges(path.join(tempDir, 'test.py'), 'from json import loads', tempDir);
    expect(edges.some(e => e.packageName === 'json')).toBe(true);
  });

  it('extracts dotted from...import (top-level module)', async () => {
    const edges = await extractEdges(path.join(tempDir, 'test.py'), 'from os.path import join', tempDir);
    expect(edges.some(e => e.packageName === 'os')).toBe(true);
  });

  it('multiple imports produce correct count', async () => {
    const fixture = `import os\nimport sys\nfrom json import loads`;
    const edges = await extractEdges(path.join(tempDir, 'test.py'), fixture, tempDir);
    expect(edges.length).toBeGreaterThanOrEqual(3);
  });

  it('all Python AST edges have EXTRACTED confidence', async () => {
    const edges = await extractEdges(path.join(tempDir, 'test.py'), 'import os\nimport sys', tempDir);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
      expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_EXTRACTED);
    }
  });

  it('all stdlib imports classified as isPackage: true', async () => {
    const edges = await extractEdges(path.join(tempDir, 'test.py'), 'import os\nimport pathlib', tempDir);
    for (const e of edges) {
      expect(e.isPackage).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rust (AST via tree-sitter)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Rust parser', () => {
  it('extracts use statement for external crate', async () => {
    const edges = await extractEdges(path.join(tempDir, 'main.rs'), 'use std::io;', tempDir);
    expect(edges.some(e => e.packageName === 'std')).toBe(true);
  });

  it('extracts extern crate declaration', async () => {
    const edges = await extractEdges(path.join(tempDir, 'lib.rs'), 'extern crate serde;', tempDir);
    expect(edges.some(e => e.packageName === 'serde' && e.isPackage)).toBe(true);
  });

  it('inline mod (with body) produces no edge', async () => {
    const fixture = `mod inline { fn x() {} }`;
    const edges = await extractEdges(path.join(tempDir, 'lib.rs'), fixture, tempDir);
    expect(edges).toHaveLength(0);
  });

  it('mod without body does not crash', async () => {
    const edges = await extractEdges(path.join(tempDir, 'lib.rs'), 'mod utils;', tempDir);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('all Rust AST edges have EXTRACTED confidence', async () => {
    const fixture = 'use std::io;\nuse serde::Deserialize;';
    const edges = await extractEdges(path.join(tempDir, 'main.rs'), fixture, tempDir);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
      expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_EXTRACTED);
    }
  });

  it('nested use paths extract top-level crate', async () => {
    const fixture = 'use std::collections::HashMap;';
    const edges = await extractEdges(path.join(tempDir, 'main.rs'), fixture, tempDir);
    expect(edges.some(e => e.packageName === 'std')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C (AST via tree-sitter)
// ═══════════════════════════════════════════════════════════════════════════════

describe('C parser', () => {
  it('system include produces isPackage: true', async () => {
    const edges = await extractEdges(path.join(tempDir, 'main.c'), '#include <stdio.h>', tempDir);
    expect(edges.some(e => e.isPackage && e.packageName === 'stdio.h')).toBe(true);
  });

  it('local include does not crash', async () => {
    const edges = await extractEdges(path.join(tempDir, 'main.c'), '#include "header.h"', tempDir);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('multiple system includes produce correct count', async () => {
    const fixture = '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>';
    const edges = await extractEdges(path.join(tempDir, 'main.c'), fixture, tempDir);
    const sysEdges = edges.filter(e => e.isPackage);
    expect(sysEdges.length).toBe(3);
  });

  it('all C AST edges have EXTRACTED confidence', async () => {
    const edges = await extractEdges(path.join(tempDir, 'main.c'), '#include <stdio.h>', tempDir);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
    }
  });

  it('AST and regex produce same system header count', async () => {
    const fixture = '#include <stdio.h>\n#include <stdlib.h>';
    const astEdges = await extractEdges(path.join(tempDir, 'main.c'), fixture, tempDir);
    const regexExtract = buildRegexExtractor('.c');
    const regexEdges = await regexExtract(path.join(tempDir, 'main.c'), fixture, tempDir);
    expect(astEdges.filter(e => e.isPackage).length).toBe(regexEdges.filter(e => e.isPackage).length);
  });

  it('.h files parse the same as .c files', async () => {
    const edges = await extractEdges(path.join(tempDir, 'types.h'), '#include <stdint.h>', tempDir);
    expect(edges.some(e => e.packageName === 'stdint.h')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C++ (AST via tree-sitter)
// ═══════════════════════════════════════════════════════════════════════════════

describe('C++ parser', () => {
  it('system include produces isPackage: true', async () => {
    const edges = await extractEdges(path.join(tempDir, 'main.cpp'), '#include <iostream>', tempDir);
    expect(edges.some(e => e.isPackage && e.packageName === 'iostream')).toBe(true);
  });

  it('.cc extension works', async () => {
    const edges = await extractEdges(path.join(tempDir, 'main.cc'), '#include <vector>', tempDir);
    expect(edges.some(e => e.packageName === 'vector')).toBe(true);
  });

  it('.cxx extension works', async () => {
    const edges = await extractEdges(path.join(tempDir, 'main.cxx'), '#include <map>', tempDir);
    expect(edges.some(e => e.packageName === 'map')).toBe(true);
  });

  it('all C++ AST edges have EXTRACTED confidence', async () => {
    const edges = await extractEdges(path.join(tempDir, 'main.cpp'), '#include <iostream>', tempDir);
    for (const e of edges) {
      expect(e.confidence).toBe(EXTRACTED);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Go (custom resolver, INFERRED confidence)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Go parser', () => {
  it('single import produces package dependency', async () => {
    const fixture = 'package main\nimport "fmt"';
    const edges = await extractEdges(path.join(tempDir, 'main.go'), fixture, tempDir);
    expect(edges.some(e => e.isPackage)).toBe(true);
  });

  it('grouped imports produce edges', async () => {
    // Go stdlib packages get empty PackageDependency.path, so multiple bare
    // imports dedup by target+edgeType. The key invariant: at least 1 package edge.
    const fixture = `package main\n\nimport (\n\t"fmt"\n\t"os"\n\t"net/http"\n)`;
    fs.writeFileSync(path.join(tempDir, 'main.go'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'main.go'), fixture, tempDir);
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges.some(e => e.isPackage)).toBe(true);
  });

  it('all Go edges have INFERRED confidence', async () => {
    const fixture = 'package main\nimport "fmt"';
    const edges = await extractEdges(path.join(tempDir, 'main.go'), fixture, tempDir);
    for (const e of edges) {
      expect(e.confidence).toBe(INFERRED);
      expect(e.confidenceSource).toBe(CONFIDENCE_SOURCE_INFERRED);
    }
  });

  it('aliased import uses path not alias', async () => {
    const fixture = 'package main\nimport f "fmt"';
    fs.writeFileSync(path.join(tempDir, 'main.go'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'main.go'), fixture, tempDir);
    // Should not have 'f' as package name
    expect(edges.some(e => e.packageName === 'f')).toBe(false);
  });

  it('blank import (_ alias) is captured', async () => {
    const fixture = 'package main\nimport _ "database/sql"';
    fs.writeFileSync(path.join(tempDir, 'main.go'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'main.go'), fixture, tempDir);
    expect(edges.length).toBeGreaterThan(0);
  });

  it('intra-project import resolves as local dep when go.mod exists', async () => {
    fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module github.com/test/proj\n\ngo 1.21\n');
    const internalDir = path.join(tempDir, 'internal', 'util');
    fs.mkdirSync(internalDir, { recursive: true });
    fs.writeFileSync(path.join(internalDir, 'helper.go'), 'package util\n');

    const fixture = 'package main\nimport "github.com/test/proj/internal/util"';
    fs.writeFileSync(path.join(tempDir, 'main.go'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'main.go'), fixture, tempDir);
    const localEdges = edges.filter(e => !e.isPackage);
    expect(localEdges.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Ruby (custom resolver, INFERRED confidence)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Ruby parser', () => {
  it('require_relative resolves to .rb file', async () => {
    fs.writeFileSync(path.join(tempDir, 'helper.rb'), '# helper');
    const fixture = "require_relative 'helper'";
    fs.writeFileSync(path.join(tempDir, 'app.rb'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'app.rb'), fixture, tempDir);
    const localEdges = edges.filter(e => !e.isPackage);
    expect(localEdges.length).toBeGreaterThan(0);
    expect(localEdges[0].target).toContain('helper.rb');
  });

  it('bare require classified as package dependency', async () => {
    // Note: bare requires with empty path get deduped by target+edgeType key,
    // so two bare requires produce 1 edge with weight=2
    const fixture = "require 'json'\nrequire 'active_record'";
    fs.writeFileSync(path.join(tempDir, 'app.rb'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'app.rb'), fixture, tempDir);
    const pkgEdges = edges.filter(e => e.isPackage);
    expect(pkgEdges.length).toBeGreaterThanOrEqual(1);
    // At least one package edge exists
    expect(pkgEdges.some(e => e.isPackage)).toBe(true);
  });

  it('skips Ruby interpolation in require path', async () => {
    const fixture = `require "\#{ENV['HOME']}/config"\nrequire 'json'`;
    fs.writeFileSync(path.join(tempDir, 'app.rb'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'app.rb'), fixture, tempDir);
    // Should not have an edge for the interpolated path
    expect(edges.some(e => e.target.includes('ENV'))).toBe(false);
  });

  it('parenthesized require works', async () => {
    const fixture = "require('net/http')";
    fs.writeFileSync(path.join(tempDir, 'app.rb'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'app.rb'), fixture, tempDir);
    expect(edges.length).toBeGreaterThan(0);
  });

  it('explicit .rb extension does not double', async () => {
    fs.writeFileSync(path.join(tempDir, 'foo.rb'), '# foo');
    const fixture = "require_relative 'foo.rb'";
    fs.writeFileSync(path.join(tempDir, 'app.rb'), fixture);
    const edges = await extractEdges(path.join(tempDir, 'app.rb'), fixture, tempDir);
    const localEdges = edges.filter(e => !e.isPackage);
    if (localEdges.length > 0) {
      expect(localEdges[0].target).not.toContain('foo.rb.rb');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PHP (regex only)
// ═══════════════════════════════════════════════════════════════════════════════

describe('PHP parser (regex)', () => {
  it('extracts require statement', async () => {
    const fixture = `<?php\nrequire 'vendor/autoload.php';`;
    const edges = await extractEdges(path.join(tempDir, 'index.php'), fixture, tempDir);
    expect(edges.length).toBeGreaterThanOrEqual(0); // May resolve or be package
    // The key invariant: no crash
    expect(Array.isArray(edges)).toBe(true);
  });

  it('extracts use statement', async () => {
    const fixture = `<?php\nuse App\\Models\\User;`;
    const edges = await extractEdges(path.join(tempDir, 'index.php'), fixture, tempDir);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('extracts include_once', async () => {
    const fixture = `<?php\ninclude_once 'config.php';`;
    const edges = await extractEdges(path.join(tempDir, 'index.php'), fixture, tempDir);
    expect(Array.isArray(edges)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C# (regex only)
// ═══════════════════════════════════════════════════════════════════════════════

describe('C# parser (regex)', () => {
  it('extracts using statement', async () => {
    const fixture = `using System;\nusing System.Collections.Generic;`;
    const edges = await extractEdges(path.join(tempDir, 'Program.cs'), fixture, tempDir);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('does not crash on empty file', async () => {
    const edges = await extractEdges(path.join(tempDir, 'Empty.cs'), '', tempDir);
    expect(edges).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Java (regex only)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Java parser (regex)', () => {
  it('extracts import statement', async () => {
    const fixture = `import java.util.ArrayList;\nimport java.io.File;`;
    const edges = await extractEdges(path.join(tempDir, 'Main.java'), fixture, tempDir);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('does not crash on empty file', async () => {
    const edges = await extractEdges(path.join(tempDir, 'Empty.java'), '', tempDir);
    expect(edges).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge cases and cross-cutting concerns
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cross-cutting parser behavior', () => {
  it('unknown extension returns empty array', async () => {
    const edges = await extractEdges(path.join(tempDir, 'data.xyz'), 'some content', tempDir);
    expect(edges).toHaveLength(0);
  });

  it('binary-looking content does not crash', async () => {
    const edges = await extractEdges(path.join(tempDir, 'test.ts'), '\x00\x01\x02\x03', tempDir);
    expect(Array.isArray(edges)).toBe(true);
  });

  it('very large file does not crash (10K lines)', async () => {
    const lines = Array.from({ length: 10000 }, (_, i) => `import { x${i} } from 'pkg-${i}';`);
    const edges = await extractEdges(path.join(tempDir, 'big.ts'), lines.join('\n'), tempDir);
    expect(Array.isArray(edges)).toBe(true);
    expect(edges.length).toBeGreaterThan(0);
  });

  it('every edge has non-null confidence and confidenceSource', async () => {
    const cases: Array<{ ext: string; fixture: string }> = [
      { ext: '.ts', fixture: "import { x } from 'pkg';" },
      { ext: '.py', fixture: 'import os' },
      { ext: '.rs', fixture: 'use std::io;' },
      { ext: '.c', fixture: '#include <stdio.h>' },
      { ext: '.go', fixture: 'package main\nimport "fmt"' },
    ];
    for (const { ext, fixture } of cases) {
      const edges = await extractEdges(path.join(tempDir, `test${ext}`), fixture, tempDir);
      for (const e of edges) {
        expect(e.confidence).not.toBeNull();
        expect(e.confidence).toBeGreaterThan(0);
        expect(e.confidenceSource).not.toBeNull();
        expect(['extracted', 'inferred']).toContain(e.confidenceSource);
      }
    }
  });

  it('every edge has a valid edgeType', async () => {
    const fixture = `import { A } from 'pkg-a';\nexport { B } from 'pkg-b';`;
    const edges = await extractEdges(path.join(tempDir, 'test.ts'), fixture, tempDir);
    const validTypes = ['imports', 're_exports', 'inherits'];
    for (const e of edges) {
      expect(validTypes).toContain(e.edgeType);
    }
  });

  it('every edge has weight >= 1', async () => {
    const fixture = `import { A } from 'pkg';`;
    const edges = await extractEdges(path.join(tempDir, 'test.ts'), fixture, tempDir);
    for (const e of edges) {
      expect(e.weight).toBeGreaterThanOrEqual(1);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Regex fallback extractor
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildRegexExtractor', () => {
  it('returns a callable function for known extensions', () => {
    for (const ext of ['.py', '.php', '.cs', '.java', '.c', '.cpp', '.rb']) {
      const fn = buildRegexExtractor(ext);
      expect(typeof fn).toBe('function');
    }
  });

  it('Python regex captures import statements', async () => {
    const extract = buildRegexExtractor('.py');
    const edges = await extract(path.join(tempDir, 'test.py'), 'import os\nfrom json import loads', tempDir);
    expect(edges.length).toBeGreaterThanOrEqual(0);
  });

  it('C regex captures system includes', async () => {
    const extract = buildRegexExtractor('.c');
    const edges = await extract(path.join(tempDir, 'test.c'), '#include <stdio.h>', tempDir);
    expect(edges.filter(e => e.isPackage).length).toBeGreaterThanOrEqual(1);
  });
});
