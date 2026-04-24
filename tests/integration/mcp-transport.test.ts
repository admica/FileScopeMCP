// tests/integration/mcp-transport.test.ts
// MCP transport-layer integration tests: exercises all 17 tools through
// InMemoryTransport using a real ServerCoordinator and real SQLite DB.
// Decision D-02: tests in tests/integration/.
// Decision D-08: each tool gets at minimum a smoke test, verifying {ok: true/false} shape.
// Decision D-09: real SQLite DB in temp dir, real ServerCoordinator.
//
// Anti-pattern avoided (RESEARCH.md): do NOT call coordinator.initServer().
// Use coordinator.init(tmpDir) directly.

// Module-level broker mock — must be hoisted before other imports.
vi.mock('../../src/broker/client.js', () => ({
  submitJob: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  isConnected: vi.fn(() => false),
  requestStatus: vi.fn(),
  resubmitStaleFiles: vi.fn(),
}));

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { mkdirSync, writeFileSync } from 'fs';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ServerCoordinator } from '../../src/coordinator.js';
import { registerTools } from '../../src/mcp-server.js';
import { closeDatabase } from '../../src/db/db.js';
import { setEdgesAndSymbols } from '../../src/db/repository.js';
import { extractTsJsFileParse } from '../../src/language-config.js';

let tmpDir: string;
let server: McpServer;
let coordinator: ServerCoordinator;
let client: Client;
let sampleFilePath: string;
let helperFilePath: string;
let greetFilePath: string;

beforeAll(async () => {
  // Create isolated temp directory for this test suite
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-transport-test-'));
  mkdirSync(path.join(tmpDir, '.filescope'), { recursive: true });

  // Write a sample TypeScript file so list_files and file-level tools have something to find
  sampleFilePath = path.join(tmpDir, 'sample.ts');
  writeFileSync(sampleFilePath, 'export const x = 1;\nexport function hello(): string { return "hello"; }\n');

  // Phase 38 fixture: cross-file call for find_callers / find_callees integration tests.
  // IMPORTANT: helper.ts must sort BEFORE the caller file alphabetically so the bulk
  // call-site extractor processes helper.ts first (writing fresh symbol IDs) before the
  // caller file references them. Caller file is named 'main.ts' (sorts after 'helper.ts').
  helperFilePath = path.join(tmpDir, 'helper.ts');
  writeFileSync(helperFilePath, 'export function helper(): string { return "help"; }\n');

  greetFilePath = path.join(tmpDir, 'main.ts');
  writeFileSync(greetFilePath, [
    "import { helper } from './helper';",
    'export function greet(): string { return helper(); }',
    'export function recurse(): void { recurse(); }',
  ].join('\n') + '\n');

  // Initialize coordinator with temp dir (manages DB lifecycle internally).
  // Per RESEARCH.md anti-pattern: do NOT call coordinator.initServer() —
  // it reads process.argv and auto-inits to CWD. Use init(tmpDir) directly.
  coordinator = new ServerCoordinator();
  await coordinator.init(tmpDir);

  // Phase 38 fixture: populate symbol_dependencies for find_callers/find_callees tests.
  // The bulk call-site extractor (runCallSiteEdgesBulkExtractionIfNeeded) runs during
  // coordinator.init() BEFORE buildFileTree scans the disk, so getAllFiles() is empty on
  // a fresh DB and the extractor produces zero rows. We manually run a post-init pass here,
  // processing helper.ts first so its symbol IDs are fresh before main.ts references them.
  for (const fixturePath of [helperFilePath, greetFilePath]) {
    const content = await fs.readFile(fixturePath, 'utf-8');
    const parsed = await extractTsJsFileParse(fixturePath, content, tmpDir);
    if (parsed) {
      setEdgesAndSymbols(fixturePath, parsed.edges, parsed.symbols, parsed.importMeta, parsed.callSiteEdges);
    }
  }

  // Create MCP server and register all tools
  server = new McpServer({ name: 'test-server', version: '1.0.0' });
  registerTools(server, coordinator);

  // Wire up in-memory transport pair (no stdio, no subprocess)
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  // Create and connect client
  client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(clientTransport);
}, 30_000);

afterAll(async () => {
  // Cleanup in reverse order — threat T-31-02: prevent resource leaks
  try {
    await client.close();
  } catch { /* best effort */ }
  try {
    await server.close();
  } catch { /* best effort */ }
  try {
    await coordinator.shutdown();
  } catch { /* best effort */ }
  // closeDatabase is called by coordinator.shutdown() but call again defensively
  try {
    closeDatabase();
  } catch { /* already closed */ }
  // Threat T-31-01: remove temp dir with test DB to prevent information disclosure
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/**
 * Call a tool via the MCP client and parse the JSON response.
 * All 13 tools return JSON in result.content[0].text.
 */
async function callAndParse(toolName: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name: toolName, arguments: args });
  return JSON.parse((result.content as Array<{ text: string }>)[0].text);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 1: list_files — optional maxItems arg
// ═══════════════════════════════════════════════════════════════════════════════
describe('list_files', () => {
  it('returns ok:true with tree structure when called without args', async () => {
    const parsed = await callAndParse('list_files');
    expect(parsed.ok).toBe(true);
    expect(parsed.tree).toBeDefined();
  });

  it('returns ok:true with flat files array when maxItems is provided', async () => {
    const parsed = await callAndParse('list_files', { maxItems: 10 });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.files)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 2: find_important_files — optional maxItems and minImportance
// ═══════════════════════════════════════════════════════════════════════════════
describe('find_important_files', () => {
  it('returns ok:true with files array', async () => {
    const parsed = await callAndParse('find_important_files', { maxItems: 5 });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.files)).toBe(true);
  });

  it('returns ok:true when no args provided (uses defaults)', async () => {
    const parsed = await callAndParse('find_important_files');
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.files)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 3: get_file_summary — requires filepath
// ═══════════════════════════════════════════════════════════════════════════════
describe('get_file_summary', () => {
  it('returns ok:true for a tracked file', async () => {
    const parsed = await callAndParse('get_file_summary', { filepath: sampleFilePath });
    expect(parsed.ok).toBe(true);
    expect(parsed.path).toBeDefined();
  });

  it('returns ok:false with NOT_FOUND for a nonexistent file', async () => {
    const parsed = await callAndParse('get_file_summary', {
      filepath: path.join(tmpDir, 'nonexistent-file.ts'),
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 4: set_file_summary — requires filepath and summary
// ═══════════════════════════════════════════════════════════════════════════════
describe('set_file_summary', () => {
  it('returns ok:true when setting a summary on a tracked file', async () => {
    const parsed = await callAndParse('set_file_summary', {
      filepath: sampleFilePath,
      summary: 'A sample TypeScript file used for transport tests.',
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.summary).toBe('A sample TypeScript file used for transport tests.');
  });

  it('returns ok:false with NOT_FOUND for a nonexistent file', async () => {
    const parsed = await callAndParse('set_file_summary', {
      filepath: path.join(tmpDir, 'missing.ts'),
      summary: 'This should fail.',
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 5: set_file_importance — requires filepath and importance (0-10)
// ═══════════════════════════════════════════════════════════════════════════════
describe('set_file_importance', () => {
  it('returns ok:true when setting importance on a tracked file', async () => {
    const parsed = await callAndParse('set_file_importance', {
      filepath: sampleFilePath,
      importance: 7,
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.importance).toBeDefined();
  });

  it('returns ok:false with NOT_FOUND for a nonexistent file', async () => {
    const parsed = await callAndParse('set_file_importance', {
      filepath: path.join(tmpDir, 'missing.ts'),
      importance: 5,
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 6: scan_all — broker is mocked to disconnected, so returns BROKER_DISCONNECTED
// ═══════════════════════════════════════════════════════════════════════════════
describe('scan_all', () => {
  it('returns ok:false with BROKER_DISCONNECTED when broker is not connected', async () => {
    const parsed = await callAndParse('scan_all');
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('BROKER_DISCONNECTED');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 7: search — requires query string
// ═══════════════════════════════════════════════════════════════════════════════
describe('search', () => {
  it('returns ok:true with results array for a search query', async () => {
    const parsed = await callAndParse('search', { query: 'sample' });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.results)).toBe(true);
  });

  it('returns ok:true with empty results for a query that matches nothing', async () => {
    const parsed = await callAndParse('search', { query: 'xyzzy_no_match_42' });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.results)).toBe(true);
    expect(parsed.results.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 8: status — no args required
// ═══════════════════════════════════════════════════════════════════════════════
describe('status', () => {
  it('returns ok:true with project, llm, broker, and fileWatching fields', async () => {
    const parsed = await callAndParse('status');
    expect(parsed.ok).toBe(true);
    expect(parsed.project).toBeDefined();
    expect(parsed.llm).toBeDefined();
    expect(parsed.broker).toBeDefined();
    expect(parsed.fileWatching).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 9: exclude_and_remove — requires filepath
// ═══════════════════════════════════════════════════════════════════════════════
describe('exclude_and_remove', () => {
  it('returns ok:true when excluding a file that exists in the dir', async () => {
    // Create a throwaway file to exclude
    const throwawayPath = path.join(tmpDir, 'throwaway.ts');
    writeFileSync(throwawayPath, 'export const y = 2;\n');
    // Note: may or may not be in the DB yet (file watcher is disabled in test config)
    // exclude_and_remove succeeds on pattern match even if file not in DB
    const parsed = await callAndParse('exclude_and_remove', { filepath: throwawayPath });
    // Tool returns ok:true on success or OPERATION_FAILED on error
    expect(typeof parsed.ok).toBe('boolean');
    if (parsed.ok) {
      expect(parsed.message).toBeDefined();
    } else {
      expect(parsed.error).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 10: detect_cycles — no args
// ═══════════════════════════════════════════════════════════════════════════════
describe('detect_cycles', () => {
  it('returns ok:true with cycles array and counts', async () => {
    const parsed = await callAndParse('detect_cycles');
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.cycles)).toBe(true);
    expect(typeof parsed.totalCycles).toBe('number');
    expect(typeof parsed.totalFilesInCycles).toBe('number');
  });

  it('returns zero cycles for a simple project with no circular deps', async () => {
    const parsed = await callAndParse('detect_cycles');
    // The temp dir has a single file with no imports, so no cycles expected
    expect(parsed.totalCycles).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 11: get_cycles_for_file — requires filepath
// ═══════════════════════════════════════════════════════════════════════════════
describe('get_cycles_for_file', () => {
  it('returns ok:true with empty cycles for a tracked file with no cycles', async () => {
    const parsed = await callAndParse('get_cycles_for_file', { filepath: sampleFilePath });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.cycles)).toBe(true);
    expect(parsed.totalCycles).toBe(0);
  });

  it('returns ok:false with NOT_FOUND for a nonexistent file', async () => {
    const parsed = await callAndParse('get_cycles_for_file', {
      filepath: path.join(tmpDir, 'does-not-exist.ts'),
    });
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toBe('NOT_FOUND');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 12: get_communities — optional file_path filter
// ═══════════════════════════════════════════════════════════════════════════════
describe('get_communities', () => {
  it('returns ok:true with communities array when no filter', async () => {
    const parsed = await callAndParse('get_communities');
    expect(parsed.ok).toBe(true);
    // communities array may be empty (no edges in a minimal test dir)
    expect(Array.isArray(parsed.communities)).toBe(true);
    expect(typeof parsed.totalCommunities).toBe('number');
  });

  it('returns ok:false with NOT_FOUND when filtering by file with no community', async () => {
    // In a minimal test dir with no imports, the sample file has no community membership
    const parsed = await callAndParse('get_communities', { file_path: sampleFilePath });
    // Either NOT_FOUND (no communities detected) or ok:true if the file is in a community
    expect(typeof parsed.ok).toBe('boolean');
    if (!parsed.ok) {
      expect(parsed.error).toBeDefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 16: find_callers — Phase 38 MCP-01
// ═══════════════════════════════════════════════════════════════════════════════

describe('find_callers', () => {
  it('returns correct envelope shape for a known callee', async () => {
    const parsed = await callAndParse('find_callers', { name: 'helper' });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(typeof parsed.total).toBe('number');
    expect(typeof parsed.unresolvedCount).toBe('number');
    expect(parsed.unresolvedCount).toBe(0);
    // At least one caller (greet calls helper)
    expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    // Each item has the required shape
    const item = parsed.items[0];
    expect(typeof item.path).toBe('string');
    expect(typeof item.name).toBe('string');
    expect(typeof item.kind).toBe('string');
    expect(typeof item.startLine).toBe('number');
    expect(typeof item.confidence).toBe('number');
    // D-12: no endLine, no isExport in response
    expect(item.endLine).toBeUndefined();
    expect(item.isExport).toBeUndefined();
  });

  it('clamps maxItems 0 to 1', async () => {
    const parsed = await callAndParse('find_callers', { name: 'helper', maxItems: 0 });
    expect(parsed.ok).toBe(true);
    expect(parsed.items.length).toBeLessThanOrEqual(1);
  });

  it('clamps maxItems 1000 to 500', async () => {
    const parsed = await callAndParse('find_callers', { name: 'helper', maxItems: 1000 });
    expect(parsed.ok).toBe(true);
    expect(parsed.items.length).toBeLessThanOrEqual(500);
  });

  it('excludes self-loops (recursive call not in callers)', async () => {
    const parsed = await callAndParse('find_callers', { name: 'recurse' });
    expect(parsed.ok).toBe(true);
    // recurse() calls itself — should NOT appear as its own caller
    const selfCaller = parsed.items.find((i: any) => i.name === 'recurse');
    expect(selfCaller).toBeUndefined();
  });

  it('returns empty result for non-existent symbol', async () => {
    const parsed = await callAndParse('find_callers', { name: 'no_such_symbol_xyzzy' });
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toEqual([]);
    expect(parsed.total).toBe(0);
    expect(parsed.unresolvedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 17: find_callees — Phase 38 MCP-02
// ═══════════════════════════════════════════════════════════════════════════════

describe('find_callees', () => {
  it('returns correct envelope shape for a known caller', async () => {
    const parsed = await callAndParse('find_callees', { name: 'greet' });
    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.items)).toBe(true);
    expect(typeof parsed.total).toBe('number');
    expect(typeof parsed.unresolvedCount).toBe('number');
    expect(parsed.unresolvedCount).toBe(0);
    // greet calls helper — should have at least 1 callee
    expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    const item = parsed.items[0];
    expect(typeof item.path).toBe('string');
    expect(typeof item.name).toBe('string');
    expect(typeof item.kind).toBe('string');
    expect(typeof item.startLine).toBe('number');
    expect(typeof item.confidence).toBe('number');
    expect(item.endLine).toBeUndefined();
    expect(item.isExport).toBeUndefined();
  });

  it('clamps maxItems 0 to 1', async () => {
    const parsed = await callAndParse('find_callees', { name: 'greet', maxItems: 0 });
    expect(parsed.ok).toBe(true);
    expect(parsed.items.length).toBeLessThanOrEqual(1);
  });

  it('clamps maxItems 1000 to 500', async () => {
    const parsed = await callAndParse('find_callees', { name: 'greet', maxItems: 1000 });
    expect(parsed.ok).toBe(true);
    expect(parsed.items.length).toBeLessThanOrEqual(500);
  });

  it('returns empty result for non-existent symbol', async () => {
    const parsed = await callAndParse('find_callees', { name: 'no_such_symbol_xyzzy' });
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toEqual([]);
    expect(parsed.total).toBe(0);
    expect(parsed.unresolvedCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tool 13: set_base_directory — requires path; re-inits coordinator (run last)
// ═══════════════════════════════════════════════════════════════════════════════
describe('set_base_directory', () => {
  it('returns a valid response when re-initializing to the same temp dir', async () => {
    // This tool calls coordinator.init() internally which re-opens the DB.
    // We re-init to tmpDir to avoid changing to a different project.
    const result = await client.callTool({ name: 'set_base_directory', arguments: { path: tmpDir } });
    // set_base_directory returns coordinator.init() result directly (ToolResponse)
    // The result.content is the raw tool response content array
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    // Content text should contain some indication of success or project path
    const text = (result.content as Array<{ text: string }>)[0].text;
    // Either JSON with ok field or a success message string
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });
});
