import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ReadBuffer, deserializeMessage, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";
import {
  FileNode,
  ToolResponse,
  FileTreeConfig,
  FileTreeStorage,
  FileWatchingConfig
} from "./types.js";
import { normalizePath, canonicalizePath, buildDependentMap, calculateImportance, excludeAndRemoveFile } from "./file-utils.js";
import {
  createFileTreeConfig,
  saveFileTree,
  loadFileTree,
  listSavedFileTrees,
  updateFileNode,
  clearTreeCache
} from "./storage-utils.js";
import * as fsSync from "fs";
import { setProjectRoot, getProjectRoot, setConfig, getConfig } from './global-state.js';
import { loadConfig, saveConfig } from './config-utils.js';
import { log, enableFileLogging, enableDaemonFileLogging } from './logger.js';
import {
  getFile,
  upsertFile,
  deleteFile as dbDeleteFile,
  getAllFiles,
  setDependencies,
  getDependencies,
  getDependents,
  getStaleness
} from './db/repository.js';
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

// Read the content of a file
async function readFileContent(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    log(`Failed to read file ${filePath}: ` + error);
    throw error;
  }
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
    "Project path not set. Please call 'set_project_path' or initialize the server with --base-dir.",
    true
  );

  server.tool("set_project_path", "Sets the project directory to analyze", {
    path: z.string().describe("The absolute path to the project directory"),
  }, async (params: { path: string }) => {
    return await coordinator.init(params.path);
  });

  server.tool("list_saved_trees", "List all saved file trees", async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    const trees = await listSavedFileTrees();
    return createMcpResponse(trees);
  });

  server.tool("delete_file_tree", "Delete a file tree configuration", {
    filename: z.string().describe("Name of the JSON file to delete")
  }, async (params: { filename: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    try {
      const normalizedPath = canonicalizePath(params.filename, getProjectRoot());
      await fs.unlink(normalizedPath);

      // Update coordinator config if it was the current tree
      if (coordinator.getCurrentConfig()?.filename === normalizedPath) {
        coordinator.setConfig(null as any);
      }

      return createMcpResponse(`Successfully deleted ${normalizedPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return createMcpResponse(`File tree ${params.filename} does not exist`);
      }
      return createMcpResponse(`Failed to delete ${params.filename}: ` + error, true);
    }
  });

  server.tool("create_file_tree", "Create or load a file tree configuration", {
    filename: z.string().describe("Name of the JSON file to store the file tree"),
    baseDirectory: z.string().describe("Base directory to scan for files")
  }, async (params: { filename: string, baseDirectory: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    log('Create file tree called with params: ' + JSON.stringify(params));
    log('Current working directory: ' + process.cwd());

    try {
      // Ensure we're using paths relative to the current directory
      const relativeFilename = path.isAbsolute(params.filename)
        ? path.relative(process.cwd(), params.filename)
        : params.filename;
      log('Relative filename: ' + relativeFilename);

      // Handle special case for current directory
      let baseDir = params.baseDirectory;
      if (baseDir === '.' || baseDir === './') {
        baseDir = coordinator.getProjectRoot()!;
        log('Resolved "." to project root: ' + baseDir);
      }

      // Normalize the base directory relative to project root if not absolute
      if (!path.isAbsolute(baseDir)) {
        baseDir = path.join(coordinator.getProjectRoot()!, baseDir);
        log('Resolved relative base directory: ' + baseDir);
      }

      const config = await createFileTreeConfig(relativeFilename, baseDir);
      log('Created config: ' + JSON.stringify(config));

      // Re-init with the new config — coordinator handles scanning + save
      await coordinator.init(baseDir);
      // Update coordinator's config to use the custom config
      coordinator.setConfig(config);

      return createMcpResponse({
        message: `File tree created and stored in SQLite`,
        config
      });
    } catch (error) {
      log('Error in create_file_tree: ' + error);
      return createMcpResponse(`Failed to create file tree: ` + error, true);
    }
  });

  server.tool("select_file_tree", "Select an existing file tree to work with", {
    filename: z.string().describe("Name of the JSON file containing the file tree")
  }, async (params: { filename: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    // With SQLite, we load directly from the DB
    try {
      const storage = await loadFileTree(params.filename);
      coordinator.setConfig(storage.config);

      return createMcpResponse({
        message: `File tree loaded from SQLite`,
        config: storage.config
      });
    } catch (error) {
      return createMcpResponse(`File tree not found: ${params.filename}`, true);
    }
  });

  server.tool("list_files", "List all files in the project with their importance rankings", async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    // Return the tree reconstructed from DB for backward compat (COMPAT-01)
    return createMcpResponse(coordinator.getFileTree());
  });

  server.tool("get_file_importance", "Get the importance ranking of a specific file", {
    filepath: z.string().describe("The path to the file to check")
  }, async (params: { filepath: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    log('Get file importance called with params: ' + JSON.stringify(params));

    try {
      const normalizedPath = normalizePath(params.filepath);
      log('Normalized path: ' + normalizedPath);

      // Use repository for direct DB lookup
      const node = getFile(normalizedPath);
      log('Found node from DB: ' + JSON.stringify(node ? {
        path: node.path,
        importance: node.importance,
        dependencies: node.dependencies?.length,
        dependents: node.dependents?.length
      } : null));

      if (!node) {
        return createMcpResponse(`File not found: ${params.filepath}`, true);
      }

      const importanceStale = getStaleness(normalizedPath);
      const llmDataImportance = getSqlite()
        .prepare('SELECT concepts, change_impact FROM files WHERE path = ?')
        .get(normalizedPath) as { concepts: string | null; change_impact: string | null } | undefined;
      return createMcpResponse({
        path: node.path,
        importance: node.importance || 0,
        dependencies: node.dependencies || [],
        dependents: node.dependents || [],
        packageDependencies: node.packageDependencies || [],
        summary: node.summary || null,
        ...(importanceStale.summaryStale !== null && { summaryStale: importanceStale.summaryStale }),
        ...(importanceStale.conceptsStale !== null && { conceptsStale: importanceStale.conceptsStale }),
        ...(importanceStale.changeImpactStale !== null && { changeImpactStale: importanceStale.changeImpactStale }),
        concepts: llmDataImportance?.concepts ? JSON.parse(llmDataImportance.concepts) : null,
        changeImpact: llmDataImportance?.change_impact ? JSON.parse(llmDataImportance.change_impact) : null,
      });
    } catch (error) {
      log('Error in get_file_importance: ' + error);
      return createMcpResponse(`Failed to get file importance: ` + error, true);
    }
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

  server.tool("get_file_summary", "Get the summary of a specific file", {
    filepath: z.string().describe("The path to the file to check")
  }, async (params: { filepath: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;

    const normalizedPath = normalizePath(params.filepath);
    const node = getFile(normalizedPath);

    if (!node) {
      return createMcpResponse(`File not found: ${params.filepath}`, true);
    }

    if (!node.summary) {
      return createMcpResponse(`No summary available for ${params.filepath}`);
    }

    const summaryStale = getStaleness(normalizedPath);
    const sqlite = getSqlite();
    const llmData = sqlite
      .prepare('SELECT concepts, change_impact FROM files WHERE path = ?')
      .get(normalizedPath) as { concepts: string | null; change_impact: string | null } | undefined;
    return createMcpResponse({
      path: node.path,
      summary: node.summary,
      ...(summaryStale.summaryStale !== null && { summaryStale: summaryStale.summaryStale }),
      ...(summaryStale.conceptsStale !== null && { conceptsStale: summaryStale.conceptsStale }),
      ...(summaryStale.changeImpactStale !== null && { changeImpactStale: summaryStale.changeImpactStale }),
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

  server.tool("read_file_content", "Read the content of a specific file", {
    filepath: z.string().describe("The path to the file to read")
  }, async (params: { filepath: string }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    try {
      const content = await readFileContent(params.filepath);
      return createMcpResponse(content);
    } catch (error) {
      return createMcpResponse(`Failed to read file: ${params.filepath} - ` + error, true);
    }
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

  server.tool("recalculate_importance", "Recalculate importance values for all files based on dependencies", async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;

    log('Recalculating importance values...');

    // Bridge: get a temporary tree from DB, run calculation algorithms, write back
    const tempTree = coordinator.getFileTree();
    buildDependentMap(tempTree);
    calculateImportance(tempTree);

    // Flatten tree and upsert all nodes back to DB
    function flattenTree(node: FileNode): FileNode[] {
      const result: FileNode[] = [];
      if (!node.isDirectory) result.push(node);
      if (node.children) {
        for (const child of node.children) {
          result.push(...flattenTree(child));
        }
      }
      return result;
    }

    const allTreeNodes = flattenTree(tempTree);
    for (const node of allTreeNodes) {
      upsertFile(node);
    }

    // Count files with non-zero importance from DB
    const allFiles = getAllFiles().filter(f => !f.isDirectory);
    const filesWithImportance = allFiles.filter(file => (file.importance || 0) > 0);

    return createMcpResponse({
      message: "Importance values recalculated",
      totalFiles: allFiles.length,
      filesWithImportance: filesWithImportance.length
    });
  });

  server.tool("toggle_file_watching", "Toggle file watching on/off", async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    const config = getConfig();
    if (!config) {
      return createMcpResponse('No configuration loaded', true);
    }

    // Create default file watching config if it doesn't exist
    if (!config.fileWatching) {
      config.fileWatching = {
        enabled: true,
        ignoreDotFiles: true,
        autoRebuildTree: true,
        maxWatchedDirectories: 1000,
        watchForNewFiles: true,
        watchForDeleted: true,
        watchForChanged: true
      };
    } else {
      // Toggle the enabled status
      config.fileWatching.enabled = !config.fileWatching.enabled;
    }

    // Save the updated config
    setConfig(config);
    await saveConfig(config);

    if (config.fileWatching.enabled) {
      await coordinator.reinitializeWatcher();
      return createMcpResponse('File watching enabled');
    } else {
      // Stop watching — coordinator owns the watcher
      await coordinator.toggleFileWatching();
      return createMcpResponse('File watching disabled');
    }
  });

  server.tool("get_file_watching_status", "Get the current status of file watching", async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    const config = getConfig();
    const status = {
      enabled: config?.fileWatching?.enabled || false,
      isActive: coordinator.getFileWatcher() !== null && coordinator.getFileWatcher() !== undefined,
      config: config?.fileWatching || null
    };

    return createMcpResponse(status);
  });

  server.tool("update_file_watching_config", "Update file watching configuration", {
    config: z.object({
      enabled: z.boolean().optional(),
      ignoreDotFiles: z.boolean().optional(),
      autoRebuildTree: z.boolean().optional(),
      maxWatchedDirectories: z.number().int().positive().optional(),
      watchForNewFiles: z.boolean().optional(),
      watchForDeleted: z.boolean().optional(),
      watchForChanged: z.boolean().optional()
    }).describe("File watching configuration options")
  }, async (params: { config: Partial<FileWatchingConfig> }) => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    const config = getConfig();
    if (!config) {
      return createMcpResponse('No configuration loaded', true);
    }

    // Create or update file watching config
    if (!config.fileWatching) {
      config.fileWatching = {
        enabled: false,
        ignoreDotFiles: true,
        autoRebuildTree: true,
        maxWatchedDirectories: 1000,
        watchForNewFiles: true,
        watchForDeleted: true,
        watchForChanged: true,
        ...params.config
      };
    } else {
      config.fileWatching = {
        ...config.fileWatching,
        ...params.config
      };
    }

    // Save the updated config
    setConfig(config);
    await saveConfig(config);

    // Restart watcher if it's enabled, otherwise stop it
    if (config.fileWatching.enabled) {
      await coordinator.reinitializeWatcher();
    } else {
      await coordinator.toggleFileWatching();
    }

    return createMcpResponse({
      message: 'File watching configuration updated',
      config: config.fileWatching
    });
  });

  server.tool("debug_list_all_files", "List all file paths in the current file tree", async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;

    // Get a flat list of all files from DB
    const allFiles = getAllFiles().filter(f => !f.isDirectory);

    // Extract just the paths and basenames
    const fileDetails = allFiles.map(file => ({
      path: file.path,
      basename: path.basename(file.path),
      importance: file.importance || 0
    }));

    return createMcpResponse({
      totalFiles: fileDetails.length,
      files: fileDetails
    });
  });

  server.tool("toggle_llm", "Enable or disable the background LLM processing pipeline", {
    enabled: z.boolean().describe("true to start LLM pipeline, false to stop it"),
  }, async ({ enabled }) => {
    if (!coordinator.isInitialized()) {
      return { content: [{ type: "text", text: "Error: Project not initialized. Call set_project_path first." }], isError: true };
    }
    try {
      const config = getConfig();
      if (enabled && (!config?.llm)) {
        // Synthesize default local-first config BEFORE calling coordinator
        // Per locked decision: openai-compatible (Ollama), qwen3-coder:14b-instruct, localhost:11434
        const defaultLlmConfig = {
          enabled: true,
          provider: 'openai-compatible' as const,
          model: 'qwen3-coder:14b-instruct',
          baseURL: 'http://localhost:11434/v1',
        };
        if (config) {
          config.llm = defaultLlmConfig;
          setConfig(config);
          await saveConfig(config);
        }
      } else if (config?.llm) {
        config.llm.enabled = enabled;
        setConfig(config);
        await saveConfig(config);
      }
      // NOW call toggleLlm — getConfig()?.llm is guaranteed to be set
      coordinator.toggleLlm(enabled);
      return { content: [{ type: "text", text: `LLM pipeline ${enabled ? 'started' : 'stopped'}. Setting persisted to config.` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error toggling LLM: ${err}` }], isError: true };
    }
  });

  server.tool("get_llm_status", "Get LLM pipeline status including budget and rate limit info", {}, async () => {
    if (!coordinator.isInitialized()) return projectPathNotSetError;
    return createMcpResponse({
      enabled: coordinator.isLlmRunning(),
      running: coordinator.isLlmRunning(),
      budgetExhausted: coordinator.isLlmBudgetExhausted(),
      lifetimeTokensUsed: coordinator.getLlmLifetimeTokensUsed(),
      tokenBudget: coordinator.getLlmTokenBudget(),
      maxTokensPerMinute: coordinator.getLlmMaxTokensPerMinute(),
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
