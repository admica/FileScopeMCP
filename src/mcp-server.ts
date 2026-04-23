import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadBuffer, deserializeMessage, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { z } from "zod";
import * as path from "path";
import {
  ToolResponse,
  FileTreeConfig,
} from "./types.js";
import { normalizePath, excludeAndRemoveFile } from "./file-utils.js";
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
} from './db/repository.js';
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

type ErrorCode = "NOT_INITIALIZED" | "INVALID_PATH" | "BROKER_DISCONNECTED" | "NOT_FOUND" | "OPERATION_FAILED";

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
    description: "Override the base directory for analysis. Initializes the file watcher, database, and broker connection for the specified path. Call this first if --base-dir was not passed at startup. Subsequent calls re-initialize to a new directory.",
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
    description: "List all tracked files with importance rankings. Without maxItems: returns a nested directory tree structure. With maxItems: returns a flat list of the N most important files sorted by importance descending, with truncation metadata. Call status first to verify initialization.",
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
    description: "Find the highest-importance files in the project. Returns files sorted by importance descending with dependency counts and staleness flags. Use this over list_files when you need the top N files by importance with relationship metadata. Precondition: server must be initialized.",
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
    description: "Get full intelligence for a single file: LLM-generated summary, importance score (0-10), dependency list with edge types (imports/inherits/re_exports) and confidence scores, dependents, package dependencies, concepts, change impact analysis, and staleness flags. Use this before editing a file to understand its role and relationships. Returns NOT_FOUND if the file is not in the scan database.",
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
    const llmData = sqlite
      .prepare('SELECT concepts, change_impact FROM files WHERE path = ?')
      .get(normalizedPath) as { concepts: string | null; change_impact: string | null } | undefined;
    return mcpSuccess({
      path: node.path,
      ...(isStale && { stale: true }),
      importance: node.importance || 0,
      dependencies: getDependenciesWithEdgeMetadata(normalizedPath).map(d => ({
        path: d.target_path,
        edgeType: d.edge_type,
        confidence: d.confidence,
      })),
      dependents: node.dependents || [],
      packageDependencies: node.packageDependencies || [],
      summary: node.summary || null,
      ...(staleness.summaryStale !== null && { summaryStale: staleness.summaryStale }),
      ...(staleness.conceptsStale !== null && { conceptsStale: staleness.conceptsStale }),
      ...(staleness.changeImpactStale !== null && { changeImpactStale: staleness.changeImpactStale }),
      concepts: llmData?.concepts ? JSON.parse(llmData.concepts) : null,
      changeImpact: llmData?.change_impact ? JSON.parse(llmData.change_impact) : null,
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
    description: "Search file metadata across symbols (function/class/interface names), purpose descriptions, LLM summaries, and file paths. Returns results ranked: symbol match (100) > purpose match (50) > summary match (20) > path match (10). Use this to find files by what they do, not just their name.",
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
    description: "Permanently exclude a file or glob pattern from tracking and remove it from the database. DESTRUCTIVE: this deletes metadata and cannot be undone without a re-scan. Adds the pattern to .filescopeignore. Use for generated files, build artifacts, or false positives.",
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
    description: "Detect all circular dependency groups in the project's local import graph. Returns an array of cycle groups (each group is an array of file paths forming a cycle), total cycle count, and total files involved. Use to identify tightly-coupled modules that may need refactoring.",
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
    description: "Get file communities detected by Louvain clustering on the local import graph. Returns groups of tightly-coupled files identified by their highest-importance representative. Optionally filter to the community containing a specific file. Communities are lazily recomputed only when the dependency graph changes.",
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
