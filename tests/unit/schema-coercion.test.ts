// tests/unit/schema-coercion.test.ts
// Verifies MCP tool input schemas coerce string numeric args to numbers.
// Some MCP clients serialize all tool args as JSON strings; plain z.number()
// rejects these with "Expected number, received string".
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

describe('MCP schema numeric coercion', () => {
  it('find_important_files uses z.coerce.number() for maxItems and minImportance', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/mcp-server.ts'),
      'utf-8'
    );

    // Locate the find_important_files registerTool block
    const match = src.match(/registerTool\("find_important_files"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
    expect(match, 'find_important_files registerTool block not found').toBeTruthy();

    const block = match![1];
    expect(block, 'maxItems should use coerce').toMatch(/maxItems:\s*z\.coerce\.number\(\)/);
    expect(block, 'minImportance should use coerce').toMatch(/minImportance:\s*z\.coerce\.number\(\)/);
  });

  it('list_files uses z.coerce.number() for maxItems', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/mcp-server.ts'),
      'utf-8'
    );
    const match = src.match(/registerTool\("list_files"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
    expect(match).toBeTruthy();
    expect(match![1]).toMatch(/maxItems:\s*z\.coerce\.number\(\)/);
  });

  it('set_file_importance uses z.coerce.number() for importance', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/mcp-server.ts'),
      'utf-8'
    );
    const match = src.match(/registerTool\("set_file_importance"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
    expect(match).toBeTruthy();
    expect(match![1]).toMatch(/importance:\s*z\.coerce\.number\(\)/);
  });

  it('scan_all uses z.coerce.number() for min_importance', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/mcp-server.ts'),
      'utf-8'
    );
    const match = src.match(/registerTool\("scan_all"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
    expect(match).toBeTruthy();
    expect(match![1]).toMatch(/min_importance:\s*z\.coerce\.number\(\)/);
  });

  it('search uses z.coerce.number() for maxItems', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/mcp-server.ts'),
      'utf-8'
    );
    const match = src.match(/registerTool\("search"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
    expect(match).toBeTruthy();
    expect(match![1]).toMatch(/maxItems:\s*z\.coerce\.number\(\)/);
  });

  it('find_symbol uses z.coerce.boolean().default(true) for exportedOnly and z.coerce.number().int() for maxItems', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/mcp-server.ts'),
      'utf-8'
    );
    const match = src.match(/registerTool\("find_symbol"[\s\S]*?inputSchema:\s*\{([\s\S]*?)\}/);
    expect(match, 'find_symbol registerTool block not found').toBeTruthy();
    const block = match![1];
    expect(block, 'exportedOnly should use z.coerce.boolean().default(true)').toMatch(/exportedOnly:\s*z\.coerce\.boolean\(\)\.default\(true\)/);
    expect(block, 'maxItems should use z.coerce.number().int()').toMatch(/maxItems:\s*z\.coerce\.number\(\)\.int\(\)/);
  });

  it('coerce schema parses string numeric args', async () => {
    const { z } = await import('zod');
    const schema = z.object({
      minImportance: z.coerce.number().optional(),
    });
    const result = schema.parse({ minImportance: '7' });
    expect(result.minImportance).toBe(7);
    expect(typeof result.minImportance).toBe('number');
  });
});
