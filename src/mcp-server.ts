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
import { log, enableFileLogging, enableDaemonFileLogging } from './logger.js';
import {
  getFile,
  upsertFile,
  getAllFiles,
  getDependencies,
  getDependents,
  getStaleness,
  getAllLocalImportEdges,
  markAllStale,
  getLlmProgress,
} from './db/repository.js';
import { isConnected as brokerIsConnected, resubmitStaleFiles } from './broker/client.js';
import { detectCycles } from './cycle-detection.js';
import { getSqlite } from './db/db.js';
import { ServerCoordinator } from './coordinator.js';

// Enable file logging for debugging
enableFileLogging(false, 'mcp-debug.log');

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

    // Only log a summary of the message to stderr, not the full content
    const isResponse = 'result' in message;
    const msgType = isResponse ? 'response' : 'request';
    const msgId = (message as any).id || 'none';

    process.stderr.write(`Sending ${msgType} message (id: ${msgId})\n`);

    // Write to stdout without adding an extra newline
    process.stdout.write(serialized);
  }

  async close(): Promise<void> {
    this.buffer = new ReadBuffer(); // Reset buffer
    process.stdin.pause();
  }
}

// Helper function to create MCP responses
function createMcpResponse(content: any, isError = false): ToolResponse {
  let formattedContent;

  if (Array.isArray(content) && content.every(item =>
    typeof item === 'object' &&
    ('type' in item) &&
    (item.type === 'text' || item.type === 'image' || item.type === 'resource'))) {
    // Content is already in correct format
    formattedContent = content;
  } else if (Array.isArray(content)) {
    // For arrays of non-formatted items, convert each item to a proper object
    formattedContent = content.map(item => ({
      type: "text",
      text: typeof item === 'string' ? item : JSON.stringify(item, null, 2)
    }));
  } else if (typeof content === 'string') {
    formattedContent = [{
      type: "text",
      text: content
    }];
  } else {
    // Convert objects or other types to string
    formattedContent = [{
      type: "text",
      text: typeof content === 'object' ? JSON.stringify(content, null, 2) : String(content)
    }];
  }

  return {
    content: formattedContent,
    isError
  };
}

// Server implementation
const serverInfo = {
  name: "FileScopeMCP",
  version: "1.0.0",
  description: "A tool for ranking files in your codebase by importance and providing summaries with dependency tracking"
};

// Create the MCP server
const server = new McpServer(serverInfo, {
  capabilities: {
    tools: { listChanged: true }
  }
});

/**
 * Register all MCP tool handlers on `server`. Each handler delegates to
 * `coordinator` for orchestration or calls repository functions directly for
 * pure DB reads/writes.
 */
function registerTools(server: McpServer, coordinator: ServerCoordinator): void {
  const projectPathNotSetError = createMcpResponse(
    "Project path not set. Please call 'set_base_directory' to point at a different directory, or restart with --base-dir.",
    true
  );

  server.tool("set_base_directory", "Override the base directory to analyze a subdirectory or different project path", {
    path: z.string().describe("The absolute path to the project directory"),
  }, async (params: { path: string }) => {
    return await coordinator.init(params.path);
  });

  server.tool("list_files", "List all files in the project with their importance rankings", async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    // Return the tree reconstructed from DB for backward compat (COMPAT-01)
    return createMcpResponse(coordinator.getFileTree());
  });

  server.tool("find_important_files", "Find the most important files in the project", {
    limit: z.number().optional().describe("Number of files to return (default: 10)"),
    minImportance: z.number().optional().describe("Minimum importance score (0-10)")
  }, async (params: { limit?: number, minImportance?: number }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;

    const limit = params.limit || 10;
    const minImportance = params.minImportance || 0;

    // Use repository to get all files from DB
    const allFiles = getAllFiles().filter(f => !f.isDirectory);

    // Filter by minimum importance and sort by importance (descending)
    const importantFiles = allFiles
      .filter(file => (file.importance || 0) >= minImportance)
      .sort((a, b) => (b.importance || 0) - (a.importance || 0))
      .slice(0, limit)
      .map(file => {
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

    return createMcpResponse(importantFiles);
  });

  server.tool("get_file_summary", "Get full file intel: summary, importance, dependencies, concepts, change impact, and staleness", {
    filepath: z.string().describe("The path to the file to check")
  }, async (params: { filepath: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;

    const normalizedPath = normalizePath(params.filepath);
    const node = getFile(normalizedPath);

    if (!node) {
      return createMcpResponse(`File not found: ${params.filepath}`, true);
    }

    const isStale = coordinator.checkFileFreshness(normalizedPath);
    const staleness = getStaleness(normalizedPath);
    const sqlite = getSqlite();
    const llmData = sqlite
      .prepare('SELECT concepts, change_impact FROM files WHERE path = ?')
      .get(normalizedPath) as { concepts: string | null; change_impact: string | null } | undefined;
    return createMcpResponse({
      path: node.path,
      ...(isStale && { stale: true }),
      importance: node.importance || 0,
      dependencies: node.dependencies || [],
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

  server.tool("set_file_summary", "Set the summary of a specific file", {
    filepath: z.string().describe("The path to the file to update"),
    summary: z.string().describe("The summary text to set")
  }, async (params: { filepath: string, summary: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;

    const normalizedPath = normalizePath(params.filepath);
    const node = getFile(normalizedPath);

    if (!node) {
      return createMcpResponse(`File not found: ${params.filepath}`, true);
    }

    // Update summary and persist to DB
    node.summary = params.summary;
    upsertFile(node);

    return createMcpResponse({
      message: `Summary updated for ${params.filepath}`,
      path: normalizedPath,
      summary: params.summary
    });
  });

  server.tool("set_file_importance", "Manually set the importance ranking of a specific file", {
    filepath: z.string().describe("The path to the file to update"),
    importance: z.number().min(0).max(10).describe("The importance value to set (0-10)")
  }, async (params: { filepath: string, importance: number }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    try {
      log('set_file_importance called with params: ' + JSON.stringify(params));

      const normalizedPath = normalizePath(params.filepath);
      const node = getFile(normalizedPath);

      if (!node) {
        // Try basename match in all DB files
        const allFiles = getAllFiles().filter(f => !f.isDirectory);
        const basename = path.basename(params.filepath);
        const matchedNode = allFiles.find(f => path.basename(f.path) === basename);

        if (!matchedNode) {
          log('File not found by any method');
          return createMcpResponse(`File not found: ${params.filepath}`, true);
        }

        matchedNode.importance = Math.min(10, Math.max(0, params.importance));
        upsertFile(matchedNode);

        return createMcpResponse({
          message: `Importance updated for ${matchedNode.path}`,
          path: matchedNode.path,
          importance: matchedNode.importance
        });
      }

      node.importance = Math.min(10, Math.max(0, params.importance));
      upsertFile(node);

      return createMcpResponse({
        message: `Importance updated for ${params.filepath}`,
        path: params.filepath,
        importance: params.importance
      });
    } catch (error) {
      log('Error in set_file_importance: ' + error);
      return createMcpResponse(`Failed to set file importance: ` + error, true);
    }
  });

  server.tool("scan_all", "Queue all files for LLM summarization. Intensive — use when you need full codebase intelligence.", {
    min_importance: z.number().optional().default(1).describe("Minimum importance threshold (default 1, skips zero-importance files)"),
  }, async ({ min_importance }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    if (!brokerIsConnected()) {
      return { content: [{ type: "text", text: "Error: Broker not connected. Check LLM config in .filescope/config.json (llm.enabled must be true)." }], isError: true };
    }
    const marked = markAllStale(Date.now(), min_importance);
    resubmitStaleFiles();
    return createMcpResponse({ queued: marked, min_importance, message: marked > 0 ? `Queued ${marked} files for LLM processing.` : "All files already queued or processed." });
  });

  server.tool("status", "System health: broker connection, queue depth, LLM processing progress, file watching, and project info", {}, async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    const broker = await coordinator.getBrokerStatus();
    const config = coordinator.getCurrentConfig();
    const appConfig = getConfig();
    const fileCount = getAllFiles().length;
    const llmProgress = getLlmProgress();
    return createMcpResponse({
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

  server.tool("exclude_and_remove", "Exclude and remove a file or pattern from the file tree", {
    filepath: z.string().describe("The path or pattern of the file to exclude and remove")
  }, async (params: { filepath: string }) => {
    try {
      if (!coordinator.isInitialized()) {
        // Attempt to initialize with a default config if possible
        const baseDirArg = process.argv.find(arg => arg.startsWith('--base-dir='));
        if (baseDirArg) {
          const projectPath = baseDirArg.split('=')[1];
          await coordinator.init(projectPath);
        } else {
          return projectPathNotSetError;
        }
      }

      log('exclude_and_remove called with params: ' + JSON.stringify(params));

      // Bridge: get a temporary tree from DB, pass to excludeAndRemoveFile (which persists to DB)
      const tempTree = coordinator.getFileTree();
      log('Current file tree root: ' + tempTree.path);

      await excludeAndRemoveFile(params.filepath, tempTree, coordinator.getProjectRoot()!);

      return createMcpResponse({
        message: `File or pattern excluded and removed: ${params.filepath}`
      });
    } catch (error) {
      log('Error in exclude_and_remove: ' + error);
      return createMcpResponse(`Failed to exclude and remove file or pattern: ` + error, true);
    }
  });

  server.tool("detect_cycles", "Detect all circular dependency groups in the project's file graph", {}, async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;

    const edges = getAllLocalImportEdges();
    const cycles = detectCycles(edges);
    const totalFilesInCycles = cycles.reduce((sum, group) => sum + group.length, 0);

    return createMcpResponse({
      cycles,
      totalCycles: cycles.length,
      totalFilesInCycles,
    });
  });

  server.tool("get_cycles_for_file", "Get cycle groups containing a specific file", {
    filepath: z.string().describe("Absolute path to the file"),
  }, async (params: { filepath: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;

    const normalizedPath = normalizePath(params.filepath);
    const node = getFile(normalizedPath);
    if (!node) {
      return createMcpResponse(`File not found: ${params.filepath}`, true);
    }

    const edges = getAllLocalImportEdges();
    const allCycles = detectCycles(edges);
    const filtered = allCycles.filter(group => group.includes(normalizedPath));
    const totalFilesInCycles = filtered.reduce((sum, group) => sum + group.length, 0);

    return createMcpResponse({
      cycles: filtered,
      totalCycles: filtered.length,
      totalFilesInCycles,
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
(async () => {
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
