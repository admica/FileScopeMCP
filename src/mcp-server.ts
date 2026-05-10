import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadBuffer, deserializeMessage, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { execFileSync } from 'node:child_process';
import * as fsSync from 'node:fs';
import { z } from "zod";
import * as path from "path";
import {
  ToolResponse,
  FileTreeConfig,
} from "./types.js";
import { normalizePath, excludeAndRemoveFile, canonicalizePath } from "./file-utils.js";
import { getConfig } from './global-state.js';
import { log, enableDaemonFileLogging } from './logger.js';
import {
  getFile,
  upsertFile,
  getAllFiles,
  getDependencies,
  getDependenciesWithEdgeMetadata,
  getDependents,
  getStaleness,
  getAllLocalImportEdges,
  markAllStale,
  getLlmProgress,
  isCommunitiesDirty,
  clearCommunitiesDirty,
  getAllLocalImportEdgesWithWeights,
  setCommunities,
  getCommunities,
  getCommunityForFile,
  searchFiles,
  findSymbols,
  getDependentsWithImports,
  getSymbolsForFile,
  getFilesChangedSince,
  getFilesByPaths,
  getCallers,
  getCallees,
  toStoredPath,
} from './db/repository.js';
import type { SymbolKind } from './db/symbol-types.js';
import { isConnected as brokerIsConnected, resubmitStaleFiles } from './broker/client.js';
import { detectCycles } from './cycle-detection.js';
import { detectCommunities } from './community-detection.js';
import { getSqlite } from './db/db.js';
import { ServerCoordinator } from './coordinator.js';

// MCP mode: log to file only, never stderr.
// Flooding stderr crashes the MCP stdio transport when Claude Code
// can't drain the pipe fast enough during heavy file-watch activity.
enableDaemonFileLogging(path.join(
  process.env.HOME || '/tmp',
  '.filescope',
  'mcp-server.log',
));

// Crash handlers. Any stray error or unhandled rejection from the broker
// client, file watcher, or coordinator would otherwise propagate up and kill
// the stdio MCP session mid-response with no log trail. Route them to the
// file-only logger and exit 1 so the parent (Claude Code) can restart.
process.on('uncaughtException', (err: Error) => {
  log(`MCP server crash (uncaughtException): ${err.message}\n${err.stack ?? ''}`);
  process.exit(1);
});
process.on('unhandledRejection', (reason: unknown) => {
  const msg = reason instanceof Error
    ? `${reason.message}\n${reason.stack ?? ''}`
    : String(reason);
  log(`MCP server crash (unhandledRejection): ${msg}`);
  process.exit(1);
});

/**
 * A simple implementation of the Transport interface for stdio
 */
class StdioTransport implements Transport {
  private readonly MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB limit
  private buffer = new ReadBuffer();
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;

  constructor() {}

  async start(): Promise<void> {
    process.stdin.on('data', (chunk) => {
      try {
        // Check buffer size before appending
        const currentSize = this.buffer.toString().length;
        if (currentSize + chunk.length > this.MAX_BUFFER_SIZE) {
          log(`Buffer overflow: size would exceed ${this.MAX_BUFFER_SIZE} bytes`);
          this.onerror?.(new Error('Buffer overflow: maximum size exceeded'));
          this.buffer = new ReadBuffer(); // Reset buffer to prevent memory issues
          return;
        }

        this.buffer.append(chunk);
        let message: JSONRPCMessage | null;
        while ((message = this.buffer.readMessage())) {
          if (this.onmessage) {
            this.onmessage(message);
          }
        }
      } catch (error) {
        log('Error processing message: ' + error);
        if (this.onerror) {
          this.onerror(error instanceof Error ? error : new Error(String(error)));
        }
        this.buffer = new ReadBuffer(); // Reset buffer on error
      }
    });

    process.stdin.on('end', () => {
      if (this.onclose) {
        this.onclose();
      }
    });

    process.stdin.resume();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // Ensure we only write valid JSON messages to stdout
    const serialized = serializeMessage(message);

    // Check message size
    if (serialized.length > this.MAX_BUFFER_SIZE) {
      log(`Message too large: ${serialized.length} bytes`);
      throw new Error('Message exceeds maximum size limit');
    }

    // Write to stdout without adding an extra newline
    process.stdout.write(serialized);
  }

  async close(): Promise<void> {
    this.buffer = new ReadBuffer(); // Reset buffer
    process.stdin.pause();
  }
}

type ErrorCode = "NOT_INITIALIZED" | "INVALID_PATH" | "BROKER_DISCONNECTED" | "NOT_FOUND" | "OPERATION_FAILED"
             | "INVALID_SINCE" | "NOT_GIT_REPO";

function mcpError(code: ErrorCode, message: string): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: false, error: code, message }) }],
    isError: true,
  };
}

function mcpSuccess(data: Record<string, unknown>): ToolResponse {
  return {
    content: [{ type: "text", text: JSON.stringify({ ok: true, ...data }) }],
  };
}

// Server implementation
const serverInfo = {
  name: "FileScopeMCP",
  version: "1.0.0",
  description: "A tool for ranking files in your codebase by importance and providing summaries with dependency tracking"
};

// Create the MCP server
const server = new McpServer(serverInfo);

/**
 * Register all MCP tool handlers on `server`. Each handler delegates to
 * `coordinator` for orchestration or calls repository functions directly for
 * pure DB reads/writes.
 */
export function registerTools(server: McpServer, coordinator: ServerCoordinator): void {
  server.registerTool("set_base_directory", {
    title: "Set Base Directory",
    description: "**When to call:** when status() returns NOT_INITIALIZED, or when switching projects in one session. Override the base directory for analysis. Initializes the file watcher, database, and broker connection for the specified path. Call this first if --base-dir was not passed at startup. Subsequent calls re-initialize to a new directory.",
    inputSchema: {
      path: z.string().describe("The absolute path to the project directory"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ path: dirPath }) => {
    return await coordinator.init(dirPath);
  });

  server.registerTool("list_files", {
    title: "List Files",
    description: "**When to call:** only when you need the full file tree. Prefer find_important_files for top-N navigation — it's cheaper and more relevant. List all tracked files with importance rankings. Without maxItems: returns a nested directory tree structure. With maxItems: returns a flat list of the N most important files sorted by importance descending, with truncation metadata. Call status first to verify initialization.",
    inputSchema: {
      maxItems: z.coerce.number().optional().describe("Cap response to N files sorted by importance. Omit for full tree."),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ maxItems }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");

    // no maxItems = tree structure (current behavior preserved)
    if (maxItems === undefined) {
      return mcpSuccess({ tree: coordinator.getFileTree() as unknown as Record<string, unknown> });
    }

    // flat list sorted by importance descending
    const allFiles = getAllFiles().filter(f => !f.isDirectory);
    const sorted = allFiles.sort((a, b) => (b.importance || 0) - (a.importance || 0));
    const isTruncated = sorted.length > maxItems;
    const results = isTruncated ? sorted.slice(0, maxItems) : sorted;

    return mcpSuccess({
      files: results.map(file => {
        const fileStale = getStaleness(file.path);
        return {
          path: file.path,
          importance: file.importance || 0,
          hasSummary: !!file.summary,
          ...(fileStale.summaryStale !== null && { summaryStale: fileStale.summaryStale }),
          ...(fileStale.conceptsStale !== null && { conceptsStale: fileStale.conceptsStale }),
          ...(fileStale.changeImpactStale !== null && { changeImpactStale: fileStale.changeImpactStale }),
        };
      }),
      ...(isTruncated && { truncated: true }),
      ...(isTruncated && { totalCount: sorted.length }),
    });
  });

  server.registerTool("find_important_files", {
    title: "Find Important Files",
    description: "**When to call:** when orienting to a new codebase, or when the user asks 'what's important in this project'. Find the highest-importance files in the project. Returns files sorted by importance descending with dependency counts and staleness flags. Use this over list_files when you need the top N files by importance with relationship metadata. Precondition: server must be initialized.",
    inputSchema: {
      maxItems: z.coerce.number().optional().describe("Maximum number of files to return (default: 10)"),
      minImportance: z.coerce.number().optional().describe("Minimum importance score (0-10)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ maxItems, minImportance }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");

    const maxCount = maxItems || 10;
    const minImp = minImportance || 0;

    const allFiles = getAllFiles().filter(f => !f.isDirectory);

    const allMatching = allFiles
      .filter(file => (file.importance || 0) >= minImp)
      .sort((a, b) => (b.importance || 0) - (a.importance || 0));

    const isTruncated = allMatching.length > maxCount;
    const results = isTruncated ? allMatching.slice(0, maxCount) : allMatching;

    const items = results.map(file => {
      const fileStale = getStaleness(file.path);
      return {
        path: file.path,
        importance: file.importance || 0,
        dependentCount: (file.dependents?.length || getDependents(file.path).length) || 0,
        dependencyCount: (file.dependencies?.length || getDependencies(file.path).length) || 0,
        hasSummary: !!file.summary,
        ...(fileStale.summaryStale !== null && { summaryStale: fileStale.summaryStale }),
        ...(fileStale.conceptsStale !== null && { conceptsStale: fileStale.conceptsStale }),
        ...(fileStale.changeImpactStale !== null && { changeImpactStale: fileStale.changeImpactStale }),
      };
    });

    return mcpSuccess({
      files: items,
      ...(isTruncated && { truncated: true }),
      ...(isTruncated && { totalCount: allMatching.length }),
    });
  });

  server.registerTool("get_file_summary", {
    title: "Get File Summary",
    description: "**When to call:** before editing any file in this project that you have not previously summarized in this session. Source tells you what the file is; this tells you who uses it and what would break — you need both. Skip only if the file is brand-new and not yet in .filescope/data.db. Get full intelligence for a single file: LLM-generated summary, importance score (0-10), dependency list with edge types (imports/inherits/re_exports) and confidence scores, dependents with the imported names + line numbers each dependent uses (use importLines to jump directly to the import statement), exported top-level symbols (exports[] with name/kind/startLine/endLine — Phase 34), package dependencies, concepts, change impact analysis, and staleness flags. Use this before editing a file to understand its role and relationships. Returns NOT_FOUND if the file is not in the scan database.",
    inputSchema: {
      filepath: z.string().describe("The path to the file to check"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ filepath }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");

    const normalizedPath = normalizePath(filepath);
    const node = getFile(normalizedPath);

    if (!node) {
      return mcpError("NOT_FOUND", `File not found in database: ${filepath}`);
    }

    const isStale = coordinator.checkFileFreshness(normalizedPath);
    const staleness = getStaleness(normalizedPath);
    const sqlite = getSqlite();
    // Raw SQL bypasses repository.ts; translate to the DB-stored path form.
    const llmData = sqlite
      .prepare('SELECT concepts, change_impact FROM files WHERE path = ?')
      .get(toStoredPath(normalizedPath)) as { concepts: string | null; change_impact: string | null } | undefined;
    return mcpSuccess({
      path: node.path,
      ...(isStale && { stale: true }),
      importance: node.importance || 0,
      dependencies: getDependenciesWithEdgeMetadata(normalizedPath).map(d => ({
        path: d.target_path,
        edgeType: d.edge_type,
        confidence: d.confidence,
      })),
      // D-12 through D-16 (Phase 34 SUM-02): dependents upgraded from string[] to {path, importedNames, importLines}[]
      dependents: getDependentsWithImports(normalizedPath),
      // D-09 through D-11 (Phase 34 SUM-01/SUM-04): exports from symbols table, isExport=true only, sorted by startLine
      exports: getSymbolsForFile(normalizedPath)
        .filter(s => s.isExport)
        .sort((a, b) => a.startLine - b.startLine)
        .map(s => ({ name: s.name, kind: s.kind, startLine: s.startLine, endLine: s.endLine })),
      packageDependencies: node.packageDependencies || [],
      summary: node.summary || null,
      ...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
      ...(staleness.conceptsStale !== null && { conceptsStale: staleness.conceptsStale }),
      ...(staleness.changeImpactStale !== null && { changeImpactStale: staleness.changeImpactStale }),
      concepts: llmData?.concepts ? JSON.parse(llmData.concepts) : null,
      changeImpact: llmData?.change_impact ? JSON.parse(llmData.change_impact) : null,
    });
  });

  server.registerTool("find_symbol", {
    title: "Find Symbol",
    description: [
      "**When to call:** when you know a function/class/type name and need its file location. Try this before falling back to grep.",
      "Resolve a symbol name (function/class/interface/type/enum/const/module/struct) to its defining file + line range in a single call — no need to grep source.",
      "Exact case-sensitive match; trailing `*` switches to prefix match (e.g. `React*` matches `React`, `ReactDOM`, `Reactive`). Any other `*` in the name is treated as a literal character.",
      "`kind` accepts: \"function\" | \"class\" | \"interface\" | \"type\" | \"enum\" | \"const\" | \"module\" | \"struct\". Unknown kind returns an empty result, never an error.",
      "`exportedOnly` defaults to `true` — private helpers only appear when you pass `exportedOnly: false`.",
      "`maxItems` defaults to 50, clamped to [1, 500].",
      "Response: `{items: [{path, name, kind, startLine, endLine, isExport}], total, truncated?: true}`. `total` is the pre-truncation count; `truncated` is present only when items were dropped.",
      "Use `find_symbol` when you know a symbol name; use `get_file_summary` when you have a path and want its exports + dependents.",
      "Returns `NOT_INITIALIZED` if the server hasn't been set up. All other outcomes (no match, unknown kind, empty prefix) return `{items: [], total: 0}` — never an error.",
      "Ruby `attr_accessor` / `attr_reader` / `attr_writer` are not indexed (synthesized at runtime, not in AST).",
      "Reopened Ruby classes produce multiple symbol rows with the same name — filter by `filePath` if disambiguation is needed.",
      "Example: `find_symbol(\"useState*\")` returns every symbol whose name starts with `useState`."
    ].join(' '),
    inputSchema: {
      name: z.string().min(1).describe("Symbol name; trailing `*` triggers prefix match"),
      kind: z.string().optional().describe("function | class | interface | type | enum | const | module | struct (unknown kind returns empty)"),
      exportedOnly: z.coerce.boolean().default(true).describe("Default true — pass false to include private helpers"),
      maxItems: z.coerce.number().int().optional().describe("Max items to return, clamped to [1, 500], default 50"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ name, kind, exportedOnly, maxItems }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");

    // D-04: clamp maxItems to [1, 500], default 50. Zero/negative silently clamped to 1.
    const limit = Math.max(1, Math.min(500, maxItems ?? 50));
    // D-06: unknown kind is NOT an error — pass through to SQL, which returns 0 rows.
    const kindFilter = kind as SymbolKind | undefined;
    const { items, total } = findSymbols({ name, kind: kindFilter, exportedOnly, limit });
    const truncated = items.length < total;

    return mcpSuccess({
      items: items.map(s => ({
        path: s.path,
        name: s.name,
        kind: s.kind,
        startLine: s.startLine,
        endLine: s.endLine,
        isExport: s.isExport,
      })),
      total,
      ...(truncated && { truncated: true }),
    });
  });

  server.registerTool("find_callers", {
    title: "Find Callers",
    description: [
      "**When to call:** before renaming, deleting, or changing the signature of a TS/JS function. Try this before falling back to grep — it's structural, not text-based.",
      "Find all symbols that call the named symbol.",
      "Exact case-sensitive name match. If multiple symbols share the name, callers of all matching symbols are returned.",
      "Call graph is TS/JS-only — symbols defined in Python, Go, Ruby, or other languages resolve by name but have no caller/callee edges (always returns `{items: [], total: 0}`). For those languages, fall back to grep.",
      "`filePath` restricts which symbol definition is the target — use it when a name is defined in multiple files.",
      "`maxItems` defaults to 50, clamped to [1, 500].",
      "Response: `{items: [{path, name, kind, startLine, confidence}], total, truncated?: true, unresolvedCount}`.",
      "`unresolvedCount` reports how many caller edges reference a symbol that no longer exists — trigger `scan_all` to refresh stale edges.",
      "Self-calls (recursive functions) are excluded from results.",
      "Returns `NOT_INITIALIZED` if the server hasn't been set up. Zero matches returns `{items: [], total: 0, unresolvedCount: 0}` — never an error.",
      "Example: `find_callers(\"processFile\")` returns every symbol that calls `processFile`.",
    ].join(' '),
    inputSchema: {
      name: z.string().min(1).describe("Symbol name — exact case-sensitive match"),
      filePath: z.string().optional().describe("Restrict target lookup to this file path"),
      maxItems: z.coerce.number().int().optional().describe("Max items to return, clamped to [1, 500], default 50"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ name, filePath, maxItems }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
    const limit = Math.max(1, Math.min(500, maxItems ?? 50));
    const { items, total, unresolvedCount } = getCallers(name, filePath, limit);
    const truncated = items.length < total;
    return mcpSuccess({
      items,
      total,
      ...(truncated && { truncated: true }),
      unresolvedCount,
    });
  });

  server.registerTool("find_callees", {
    title: "Find Callees",
    description: [
      "**When to call:** when you need to understand what a function depends on internally, before modifying its body. TS/JS only — for other languages, fall back to grep.",
      "Find all symbols that the named symbol calls.",
      "Exact case-sensitive name match. If multiple symbols share the name, callees of all matching symbols are returned.",
      "Call graph is TS/JS-only — symbols defined in Python, Go, Ruby, or other languages resolve by name but have no caller/callee edges (always returns `{items: [], total: 0}`).",
      "`filePath` restricts which symbol definition is the caller — use it when a name is defined in multiple files.",
      "`maxItems` defaults to 50, clamped to [1, 500].",
      "Response: `{items: [{path, name, kind, startLine, confidence}], total, truncated?: true, unresolvedCount}`.",
      "`unresolvedCount` reports how many callee edges reference a symbol that no longer exists — trigger `scan_all` to refresh stale edges.",
      "Self-calls (recursive functions) are excluded from results.",
      "Returns `NOT_INITIALIZED` if the server hasn't been set up. Zero matches returns `{items: [], total: 0, unresolvedCount: 0}` — never an error.",
      "Example: `find_callees(\"processFile\")` returns every symbol that `processFile` calls.",
    ].join(' '),
    inputSchema: {
      name: z.string().min(1).describe("Symbol name — exact case-sensitive match"),
      filePath: z.string().optional().describe("Restrict caller lookup to this file path"),
      maxItems: z.coerce.number().int().optional().describe("Max items to return, clamped to [1, 500], default 50"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ name, filePath, maxItems }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
    const limit = Math.max(1, Math.min(500, maxItems ?? 50));
    const { items, total, unresolvedCount } = getCallees(name, filePath, limit);
    const truncated = items.length < total;
    return mcpSuccess({
      items,
      total,
      ...(truncated && { truncated: true }),
      unresolvedCount,
    });
  });

  server.registerTool("list_changed_since", {
    title: "List Changed Since",
    description: [
      "**When to call:** at the start of a session, or after a long absence, to see what files moved since a known timestamp or commit SHA.",
      "Re-orient after multi-file edits — returns every tracked file whose mtime (or git history) is newer than a given reference point.",
      "Two modes, auto-detected: an ISO-8601 timestamp (e.g. `2026-04-23T10:00:00Z`) OR a git commit SHA of 7–40 hex characters (e.g. `860fe61`). Any 7–40 char hex string is treated as a SHA; everything else is parsed as a date.",
      "SHA mode invokes `git diff --name-only <sha> HEAD`, canonicalizes the paths, and intersects with the DB — returning only files currently tracked. If `git diff` fails for any reason (unknown SHA, corrupt repo, git not installed, etc.) the call returns `INVALID_SINCE` — no SHA is ever assumed valid without git's confirmation.",
      "No deletion tracking: only files currently in the DB appear. Deleted files are NOT listed.",
      "Response shape: `{items: [{path, mtime}], total, truncated?: true}`. `mtime` is a ms-epoch number; in SHA mode, files whose DB mtime is NULL coerce to `0`. Default `maxItems` is 50, clamped to `[1, 500]`. Results are sorted `mtime DESC, path ASC`.",
      "Error codes: `NOT_INITIALIZED` (server not set up), `INVALID_SINCE` (unparseable input or failed git), `NOT_GIT_REPO` (SHA mode without `.git` at project root).",
      "Empty result is success: `{items: [], total: 0}` — never an error.",
      "Example (timestamp): `list_changed_since(\"2026-04-23T10:00:00Z\")`. Example (SHA): `list_changed_since(\"860fe61\")`."
    ].join(' '),
    inputSchema: {
      since: z.string().min(1).describe("ISO-8601 timestamp or 7–40 char git SHA"),
      maxItems: z.coerce.number().int().optional().describe("Max items to return, clamped to [1, 500], default 50"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ since, maxItems }) => {
    if (!coordinator.isInitialized()) {
      return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
    }

    // D-17: clamp maxItems to [1, 500], default 50
    const limit = Math.max(1, Math.min(500, maxItems ?? 50));

    // D-01: SHA regex dispatch first, then Date.parse
    const SHA_RE = /^[0-9a-fA-F]{7,40}$/;

    let rows: Array<{ path: string; mtime: number | null }>;

    if (SHA_RE.test(since)) {
      // SHA mode (D-05 through D-10)
      const projectRoot = coordinator.getProjectRoot()!;
      if (!fsSync.existsSync(path.join(projectRoot, '.git'))) {
        return mcpError("NOT_GIT_REPO", "Current project root has no .git directory. SHA mode requires a git repository.");
      }
      let stdout: string;
      try {
        stdout = execFileSync('git', ['diff', '--name-only', since, 'HEAD'], {
          cwd: projectRoot,
          timeout: 5000,
          encoding: 'utf-8',
        });
      } catch (err) {
        // D-08: any git failure after the .git gate → INVALID_SINCE. Log, do not leak stderr.
        log('[list_changed_since] git diff failed: ' + (err instanceof Error ? err.message : String(err)));
        return mcpError("INVALID_SINCE", "git diff failed for the given SHA. The SHA may be unknown, or git may not be available.");
      }
      const repoPaths = stdout.trim().split('\n').filter(Boolean);
      const absPaths = repoPaths.map(p => canonicalizePath(path.resolve(projectRoot, p)));
      rows = getFilesByPaths(absPaths);
    } else {
      // Timestamp mode (D-11 through D-13)
      const ms = Date.parse(since);
      if (isNaN(ms)) {
        return mcpError("INVALID_SINCE", "Unparseable `since` value. Expect ISO-8601 timestamp (e.g. 2026-04-23T10:00:00Z) or a 7–40 character git SHA.");
      }
      rows = getFilesChangedSince(ms);
    }

    // D-16: sort mtime DESC, path ASC; D-15: null mtime → 0
    const sorted = rows
      .map(r => ({ path: r.path, mtime: r.mtime ?? 0 }))
      .sort((a, b) => {
        if (b.mtime !== a.mtime) return b.mtime - a.mtime;
        return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
      });

    const total = sorted.length;
    const items = sorted.slice(0, limit);
    const truncated = items.length < total;

    return mcpSuccess({
      items,
      total,
      ...(truncated && { truncated: true }),
    });
  });

  server.registerTool("set_file_summary", {
    title: "Set File Summary",
    description: "Manually set or override the LLM-generated summary for a file. Use when the auto-generated summary is inaccurate or you want to annotate a file with custom context. Idempotent: repeated calls with the same summary are safe. Returns NOT_FOUND if the file is not tracked.",
    inputSchema: {
      filepath: z.string().describe("The path to the file to update"),
      summary: z.string().describe("The summary text to set"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ filepath, summary }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");

    const normalizedPath = normalizePath(filepath);
    const node = getFile(normalizedPath);

    if (!node) {
      return mcpError("NOT_FOUND", `File not found in database: ${filepath}`);
    }

    node.summary = summary;
    upsertFile(node);

    return mcpSuccess({
      message: `Summary updated for ${filepath}`,
      path: normalizedPath,
      summary,
    });
  });

  server.registerTool("set_file_importance", {
    title: "Set File Importance",
    description: "Manually set the importance ranking (0-10) for a file. Overrides the auto-calculated importance. Falls back to basename matching if the exact path is not found. Idempotent: repeated calls with the same value are safe.",
    inputSchema: {
      filepath: z.string().describe("The path to the file to update"),
      importance: z.coerce.number().min(0).max(10).describe("The importance value to set (0-10)"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ filepath, importance }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
    try {
      log('set_file_importance called with params: ' + JSON.stringify({ filepath, importance }));

      const normalizedPath = normalizePath(filepath);
      const node = getFile(normalizedPath);

      if (!node) {
        // Try basename match in all DB files
        const allFiles = getAllFiles().filter(f => !f.isDirectory);
        const basename = path.basename(filepath);
        const matchedNode = allFiles.find(f => path.basename(f.path) === basename);

        if (!matchedNode) {
          log('File not found by any method');
          return mcpError("NOT_FOUND", `File not found in database: ${filepath}`);
        }

        matchedNode.importance = Math.min(10, Math.max(0, importance));
        upsertFile(matchedNode);

        return mcpSuccess({
          message: `Importance updated for ${matchedNode.path}`,
          path: matchedNode.path,
          importance: matchedNode.importance,
        });
      }

      node.importance = Math.min(10, Math.max(0, importance));
      upsertFile(node);

      return mcpSuccess({
        message: `Importance updated for ${filepath}`,
        path: filepath,
        importance,
      });
    } catch (error) {
      log('Error in set_file_importance: ' + error);
      return mcpError("OPERATION_FAILED", `Failed to set file importance: ${error}`);
    }
  });

  server.registerTool("scan_all", {
    title: "Scan All",
    description: "Queue files for LLM summarization via the broker. Uses min_importance to filter low-value files (default 1, skips zero-importance). Set remaining_only=true to skip already-summarized files. Requires an active broker connection (llm.enabled=true in config). Returns BROKER_DISCONNECTED if the broker is unreachable.",
    inputSchema: {
      min_importance: z.coerce.number().optional().default(1).describe("Minimum importance threshold (default 1, skips zero-importance files)"),
      remaining_only: z.boolean().optional().default(false).describe("When true, only queue files that have never been summarized"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  }, async ({ min_importance, remaining_only }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
    if (!brokerIsConnected()) {
      return mcpError("BROKER_DISCONNECTED", "Broker not connected. Check LLM config in .filescope/config.json (llm.enabled must be true).");
    }
    const marked = markAllStale(Date.now(), min_importance, remaining_only);
    resubmitStaleFiles();
    return mcpSuccess({ queued: marked, min_importance, remaining_only, message: marked > 0 ? `Queued ${marked} files for LLM processing.` : "All files already queued or processed." });
  });

  server.registerTool("search", {
    title: "Search",
    description: "**When to call:** when the user asks 'where is X handled' with a concept noun (auth, config, caching, error handling, etc.). Searches LLM-generated summaries, not just text — understands intent, not strings. Prefer find_symbol when looking for a specific named entity. Search file metadata across symbols (function/class/interface names), purpose descriptions, LLM summaries, and file paths. Multi-word queries are tokenized: each word is matched independently and per-row scores are summed, so 'file watcher debounce' correctly surfaces a file whose summary mentions debounce and whose path contains 'file-watcher' even if no field contains the literal phrase. Quote a phrase to require it as a unit: '\"change impact\"'. Per-token column ranks: symbol=100, purpose/affectedAreas=50, summary=20, path=10. Use this to find files by what they do, not just their name. Tokens shorter than 2 chars are dropped.",
    inputSchema: {
      query: z.string().describe("Search term to match against symbols, purpose, summaries, and paths"),
      maxItems: z.coerce.number().optional().describe("Max results (default 10)"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ query, maxItems }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
    const response = searchFiles(query, maxItems ?? 10);
    return mcpSuccess(response as unknown as Record<string, unknown>);
  });

  server.registerTool("status", {
    title: "Status",
    description: "Get system health: broker connection state, LLM processing queue depth and progress, file watching status, and project info (root path, file count, last update time). Call this to verify initialization state and diagnose issues.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
    const broker = await coordinator.getBrokerStatus();
    const config = coordinator.getCurrentConfig();
    const appConfig = getConfig();
    const fileCount = getAllFiles().length;
    const llmProgress = getLlmProgress();
    return mcpSuccess({
      project: {
        root: coordinator.getProjectRoot(),
        baseDirectory: config?.baseDirectory ?? null,
        totalFiles: fileCount,
        lastUpdated: config?.lastUpdated ?? null,
      },
      llm: {
        summarized: `${llmProgress.withSummary}/${llmProgress.totalFiles}`,
        conceptsExtracted: `${llmProgress.withConcepts}/${llmProgress.totalFiles}`,
        pendingSummary: llmProgress.pendingSummary,
        pendingConcepts: llmProgress.pendingConcepts,
      },
      broker,
      fileWatching: {
        enabled: appConfig?.fileWatching?.enabled || false,
        isActive: coordinator.getFileWatcher() !== null && coordinator.getFileWatcher() !== undefined,
      },
    });
  });

  server.registerTool("exclude_and_remove", {
    title: "Exclude and Remove",
    description: "Permanently exclude a file or glob pattern from tracking and remove it from the database. DESTRUCTIVE: this deletes metadata and cannot be undone without a re-scan. Persists the pattern to .filescope/config.json (excludePatterns) so it survives restarts. Use for generated files, build artifacts, or false positives.",
    inputSchema: {
      filepath: z.string().describe("The path or pattern of the file to exclude and remove"),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async ({ filepath }) => {
    try {
      if (!coordinator.isInitialized()) {
        // Attempt to initialize with a default config if possible
        const baseDirArg = process.argv.find(arg => arg.startsWith('--base-dir='));
        if (baseDirArg) {
          const projectPath = baseDirArg.split('=')[1];
          await coordinator.init(projectPath);
        } else {
          return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");
        }
      }

      log('exclude_and_remove called with params: ' + JSON.stringify({ filepath }));

      const tempTree = coordinator.getFileTree();
      log('Current file tree root: ' + tempTree.path);

      await excludeAndRemoveFile(filepath, tempTree, coordinator.getProjectRoot()!);

      return mcpSuccess({
        message: `File or pattern excluded and removed: ${filepath}`,
      });
    } catch (error) {
      log('Error in exclude_and_remove: ' + error);
      return mcpError("OPERATION_FAILED", `Failed to exclude and remove: ${error}`);
    }
  });

  server.registerTool("detect_cycles", {
    title: "Detect Cycles",
    description: "**When to call:** when the user asks about circular dependencies, tightly-coupled modules, or import cycles, before any large refactor. Detect all circular dependency groups in the project's local import graph. Returns an array of cycle groups (each group is an array of file paths forming a cycle), total cycle count, and total files involved. Use to identify tightly-coupled modules that may need refactoring.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");

    const edges = getAllLocalImportEdges();
    const cycles = detectCycles(edges);
    const totalFilesInCycles = cycles.reduce((sum, group) => sum + group.length, 0);

    return mcpSuccess({
      cycles,
      totalCycles: cycles.length,
      totalFilesInCycles,
    });
  });

  server.registerTool("get_cycles_for_file", {
    title: "Get Cycles For File",
    description: "Get all dependency cycle groups that include a specific file. Returns only the cycles containing the specified file path, useful for understanding a single file's circular dependency involvement. Returns NOT_FOUND if the file is not tracked.",
    inputSchema: {
      filepath: z.string().describe("Absolute path to the file"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ filepath }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");

    const normalizedPath = normalizePath(filepath);
    const node = getFile(normalizedPath);
    if (!node) {
      return mcpError("NOT_FOUND", `File not found in database: ${filepath}`);
    }

    const edges = getAllLocalImportEdges();
    const allCycles = detectCycles(edges);
    const filtered = allCycles.filter(group => group.includes(normalizedPath));
    const totalFilesInCycles = filtered.reduce((sum, group) => sum + group.length, 0);

    return mcpSuccess({
      cycles: filtered,
      totalCycles: filtered.length,
      totalFilesInCycles,
    });
  });

  server.registerTool("get_communities", {
    title: "Get Communities",
    description: "**When to call:** when the user asks about module structure, file groupings, or which files change together. Get file communities detected by Louvain clustering on the local import graph. Returns groups of tightly-coupled files identified by their highest-importance representative. Optionally filter to the community containing a specific file. Communities are lazily recomputed only when the dependency graph changes.",
    inputSchema: {
      file_path: z.string().optional().describe("Optional: filter to the community containing this file path"),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async ({ file_path }) => {
    if (!coordinator.isInitialized()) return mcpError("NOT_INITIALIZED", "Server not initialized. Call set_base_directory first or restart with --base-dir.");

    // Lazy recomputation: only run Louvain when edges have changed
    if (isCommunitiesDirty()) {
      const edges = getAllLocalImportEdgesWithWeights();
      if (edges.length === 0) {
        clearCommunitiesDirty();
        if (file_path) {
          return mcpError("NOT_FOUND", "No communities detected (no local import edges).");
        }
        return mcpSuccess({ communities: [], totalCommunities: 0 });
      }
      const allFiles = getAllFiles();
      const importances = new Map(allFiles.map(f => [f.path, f.importance ?? 0]));
      const communities = detectCommunities(edges, importances);
      setCommunities(communities);
      clearCommunitiesDirty();
    }

    if (file_path) {
      const normalizedPath = normalizePath(file_path);
      const community = getCommunityForFile(normalizedPath);
      if (!community) {
        return mcpError("NOT_FOUND", `File not found in any community: ${file_path}`);
      }
      return mcpSuccess({
        representative: community.representative,
        members: community.members,
        size: community.size,
      });
    }

    const allCommunities = getCommunities();
    const sorted = allCommunities.sort((a, b) => b.size - a.size);
    return mcpSuccess({
      communities: sorted.map(c => ({
        representative: c.representative,
        members: c.members,
        size: c.size,
      })),
      totalCommunities: sorted.length,
    });
  });
}

/**
 * Graceful shutdown: wait for coordinator to shut down cleanly, or force-exit
 * after 5 seconds. Used for both daemon mode and MCP mode.
 */
async function gracefulShutdown(coordinator: ServerCoordinator, signal: string): Promise<void> {
  log(`Received ${signal}. Shutting down...`);
  const forceExit = setTimeout(() => {
    log('Force exit: shutdown timed out after 5s');
    process.exit(1);
  }, 5000);
  forceExit.unref(); // Don't keep the event loop alive for this timer

  try {
    await coordinator.shutdown();
    log('Shutdown complete.');
    process.exit(0);
  } catch (err) {
    log(`Shutdown error: ${err}`);
    process.exit(1);
  }
}

// Entry point: daemon mode or MCP mode
// Guard: skip when imported as a module (e.g., vitest importing registerTools)
const isDirectExecution = process.argv[1]?.endsWith('mcp-server.js') || process.argv[1]?.endsWith('mcp-server.ts');
if (isDirectExecution) (async () => {
  const isDaemon = process.argv.includes('--daemon');
  const baseDirArg = process.argv.find(a => a.startsWith('--base-dir='));

  if (isDaemon) {
    // Daemon mode: --base-dir is required
    if (!baseDirArg) {
      process.stderr.write('Error: --daemon requires --base-dir=<path>\n');
      process.exit(1);
    }
    const projectPath = baseDirArg.split('=')[1];
    if (!projectPath) {
      process.stderr.write('Error: --base-dir value is empty\n');
      process.exit(1);
    }

    // Enable daemon file-only logging BEFORE any log calls
    const logPath = path.join(projectPath, '.filescope-daemon.log');
    enableDaemonFileLogging(logPath);

    try {
      const coordinator = new ServerCoordinator();
      await coordinator.init(projectPath);

      // Startup banner (stdout only, then silent)
      process.stdout.write(
        `FileScopeMCP daemon started \u2014 watching ${projectPath} (PID ${process.pid})\n`
      );

      // Register signal handlers
      process.on('SIGTERM', () => gracefulShutdown(coordinator, 'SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown(coordinator, 'SIGINT'));

      // chokidar persistent:true keeps the event loop alive — no setInterval needed
    } catch (error) {
      log('Daemon startup error: ' + error);
      process.exit(1);
    }
  } else {
    // MCP mode: standard MCP server with stdio transport
    try {
      const coordinator = new ServerCoordinator();
      await coordinator.initServer();
      registerTools(server, coordinator);

      // Register signal handlers for MCP mode too (consistent lifecycle)
      process.on('SIGTERM', () => gracefulShutdown(coordinator, 'SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown(coordinator, 'SIGINT'));

      const transport = new StdioTransport();
      await server.connect(transport);
    } catch (error) {
      log('Server error: ' + error);
      process.exit(1);
    }
  }
})();
