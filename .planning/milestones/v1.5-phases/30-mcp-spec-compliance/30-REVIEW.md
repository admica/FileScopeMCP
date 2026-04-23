---
phase: 30-mcp-spec-compliance
reviewed: 2026-04-17T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/mcp-server.ts
  - src/mcp-server.test.ts
  - tests/unit/tool-outputs.test.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 30: Code Review Report

**Reviewed:** 2026-04-17T00:00:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Three files reviewed: the main MCP server implementation (`src/mcp-server.ts`), its co-located test suite (`src/mcp-server.test.ts`), and the contract test suite (`tests/unit/tool-outputs.test.ts`).

The server code is generally well-structured. The four warnings are real correctness risks: one buffer-size measurement bug that makes the overflow guard unreliable, one falsy-zero logic error that silently ignores `minImportance=0` and `importance=0`, one inconsistency between the response path field and the normalized path for `set_file_importance` success, and one fragile file-path URL construction in the test suite. The three info items cover an unused import, dead `as unknown as` casts, and a minor test naming discrepancy.

---

## Warnings

### WR-01: Buffer overflow guard measures decoded string length instead of raw byte count

**File:** `src/mcp-server.ts:65`

**Issue:** `this.buffer.toString()` converts the internal `ReadBuffer` state to a string and measures `.length` in UTF-16 code units, not raw bytes. `chunk.length` on a Node.js `Buffer` is byte count. Comparing a character count against a byte limit is incorrect: multi-byte UTF-8 sequences will undercount the actual byte size, allowing the buffer to silently grow well past `MAX_BUFFER_SIZE` before the guard fires — or never fire at all if `ReadBuffer.toString()` returns something other than the raw buffered bytes (e.g., an object description string like `"[object Object]"`). The guard is designed to prevent memory exhaustion but currently provides an unreliable guarantee.

**Fix:** Track accumulated byte count as a separate numeric field rather than re-measuring the buffer object.

```typescript
// In StdioTransport class:
private bufferedBytes = 0;

// In the 'data' handler:
if (this.bufferedBytes + chunk.length > this.MAX_BUFFER_SIZE) {
  log(`Buffer overflow: size would exceed ${this.MAX_BUFFER_SIZE} bytes`);
  this.onerror?.(new Error('Buffer overflow: maximum size exceeded'));
  this.buffer = new ReadBuffer();
  this.bufferedBytes = 0;
  return;
}
this.bufferedBytes += chunk.length;
this.buffer.append(chunk);
// ... readMessage loop ...

// In close() and on error reset:
this.buffer = new ReadBuffer();
this.bufferedBytes = 0;
```

---

### WR-02: `minImportance || 0` and `maxItems || 10` treat 0 as falsy, silently substituting defaults

**File:** `src/mcp-server.ts:224-225`

**Issue:** Both `maxItems || 10` and `minImportance || 0` use loose falsy coercion. For `minImportance`, the value `0` is a valid and meaningful input meaning "include all files". The expression `minImportance || 0` evaluates to `0` in that case (which happens to be the intended default), so this specific instance is harmless in output. However, `maxItems || 10` (line 224) silently replaces `maxItems=0` with `10`, which — while `0` is a degenerate case — is inconsistent with how the same parameter is handled in the `list_files` handler (line 189: `if (maxItems === undefined)`). The pattern is also a latent risk for future callers who pass `0` intending "return nothing" or who add a `maxItems=0` validation case. Prefer nullish coalescing throughout.

**Fix:**
```typescript
// line 224-225
const maxCount = maxItems ?? 10;
const minImp = minImportance ?? 0;
```

---

### WR-03: `set_file_importance` success response echoes the un-normalized `filepath` and raw `importance` rather than the stored values

**File:** `src/mcp-server.ts:383-388`

**Issue:** When the exact-path lookup succeeds (the `node` is found), the success response at line 383 uses `filepath` (the raw caller-supplied string) for the `path` field and `importance` (the raw param) for the `importance` field, instead of `node.path` (normalized) and `node.importance` (the clamped value). This can return a path that does not match what was actually stored, and returns the unclamped importance even though the clamp `Math.min(10, Math.max(0, importance))` at line 380 ran correctly. In the basename-fallback branch (lines 373-377) the code correctly uses `matchedNode.path` and `matchedNode.importance`, so the two branches are inconsistent.

**Fix:**
```typescript
// Replace lines 380-388:
node.importance = Math.min(10, Math.max(0, importance));
upsertFile(node);

return mcpSuccess({
  message: `Importance updated for ${node.path}`,
  path: node.path,          // normalized path, not raw filepath
  importance: node.importance,  // clamped value, not raw param
});
```

---

### WR-04: Fragile URL-based path construction in COMPAT-01 test may resolve incorrectly

**File:** `src/mcp-server.test.ts:514`

**Issue:** The path resolution in the COMPAT-01 test constructs a URL with `import.meta.url`, then uses `.pathname.replace('/src/mcp-server.ts', '/src/mcp-server.ts')` — which is a no-op replace. The intent appears to be reaching the source file from the test file's location, but the replace does nothing and the resulting path depends entirely on whether `import.meta.url` resolves to the source file (which it does in this case since this test file lives in `src/`). However, the path would silently break if the test file were ever moved out of `src/` or renamed. The `tests/unit/tool-outputs.test.ts` version of the same test (line 422) uses the far more robust `path.join(process.cwd(), 'src/mcp-server.ts')` pattern. The co-located test file should match that pattern.

**Fix:**
```typescript
// Replace lines 513-518 with:
const src = await import('node:fs/promises').then(fsp =>
  fsp.readFile(
    path.join(process.cwd(), 'src/mcp-server.ts'),
    'utf-8',
  )
);
```

---

## Info

### IN-01: `deserializeMessage` is imported but never used

**File:** `src/mcp-server.ts:4`

**Issue:** `deserializeMessage` is destructured from `@modelcontextprotocol/sdk/shared/stdio.js` but does not appear anywhere in the file. The `StdioTransport` class uses only `ReadBuffer` and `serializeMessage`.

**Fix:** Remove `deserializeMessage` from the import line:
```typescript
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
```

---

### IN-02: `FileTreeConfig` is imported but not referenced in `mcp-server.ts`

**File:** `src/mcp-server.ts:9`

**Issue:** `FileTreeConfig` is imported from `"./types.js"` but is never used in `mcp-server.ts`. The coordinator abstracts away config construction. TypeScript `strict` mode or `noUnusedLocals` would flag this.

**Fix:** Remove `FileTreeConfig` from the import:
```typescript
import {
  ToolResponse,
} from "./types.js";
```

---

### IN-03: Redundant `as unknown as Record<string, unknown>` double-casts indicate missing return type alignment

**File:** `src/mcp-server.ts:182`, `src/mcp-server.ts:433`

**Issue:** Two handlers apply `as unknown as Record<string, unknown>` casts to pass values to `mcpSuccess`. At line 182, `coordinator.getFileTree()` returns a typed `FileNode` tree that must be double-cast. At line 433, `searchFiles()` returns a typed result object that must also be double-cast. These casts bypass type checking at the boundary. A cleaner approach is to type `mcpSuccess` to accept a broader input (e.g., `unknown`) and let it cast internally, or to widen the return type of the called functions so callers do not need to suppress types.

**Fix (option A — widen mcpSuccess):**
```typescript
function mcpSuccess(data: unknown): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, ...(data as Record<string, unknown>) }) }],
  };
}
```

This removes the need for call-site casts. If the current strict `Record<string, unknown>` signature is intentional for other call sites, keep it and address individually at the two call sites with a comment explaining the cast reason.

---

_Reviewed: 2026-04-17T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
