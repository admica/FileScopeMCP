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
import { scanDirectory, calculateImportance, setFileImportance, buildDependentMap, normalizePath, addFileNode, removeFileNode, excludeAndRemoveFile, updateFileNodeOnChange, integrityCheck } from "./file-utils.js";
import {
  createFileTreeConfig,
  saveFileTree,
  loadFileTree,
  listSavedFileTrees,
  updateFileNode,
  getFileNode,
  normalizeAndResolvePath,
  clearTreeCache
} from "./storage-utils.js";
import * as fsSync from "fs";
import { setProjectRoot, getProjectRoot, setConfig, getConfig } from './global-state.js';
import { loadConfig, saveConfig } from './config-utils.js';
import { FileWatcher, FileEventType } from './file-watcher.js';
import { log, enableFileLogging } from './logger.js';
import { openDatabase, closeDatabase } from './db/db.js';
import { runMigrationIfNeeded } from './migrate/json-to-sqlite.js';
import {
  getFile,
  upsertFile,
  deleteFile as dbDeleteFile,
  getAllFiles,
  setDependencies,
  getDependencies,
  getDependents
} from './db/repository.js';

// Enable file logging for debugging
enableFileLogging(false, 'mcp-debug.log');

// Simple async mutex to serialize all tree mutations.
// Both the file-watcher callback and the integrity sweep mutate the same
// in-memory fileTree; running them concurrently can corrupt dependency lists
// or produce interleaved saves. All tree-mutation paths must acquire this lock.
class AsyncMutex {
  private _queue: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._queue.then(() => fn());
    // Keep the chain alive regardless of whether fn throws
    this._queue = result.then(() => {}, () => {});
    return result;
  }
}

// Default file-watching config used when none exists yet
const DEFAULT_FILE_WATCHING: FileWatchingConfig = {
  enabled: false,
  ignoreDotFiles: true,
  autoRebuildTree: true,
  maxWatchedDirectories: 1000,
  watchForNewFiles: true,
  watchForDeleted: true,
  watchForChanged: true
};

// Initialize server state
let fileTree: FileNode | null = null;
let currentConfig: FileTreeConfig | null = null;
let fileWatcher: FileWatcher | null = null;
// Mutex that serializes all tree mutations (watcher events + integrity sweep)
const treeMutex = new AsyncMutex();
// Map to hold debounce timers for file events
const fileEventDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
const DEBOUNCE_DURATION_MS = 2000; // 2 seconds
let integritySweepInterval: NodeJS.Timeout | null = null;
const INTEGRITY_SWEEP_INTERVAL_MS = 30_000; // 30 seconds

/**
 * Centralized function to initialize or re-initialize the project analysis.
 * @param projectPath The absolute path to the project directory.
 * @returns A ToolResponse indicating success or failure.
 */
async function initializeProject(projectPath: string): Promise<ToolResponse> {
  const projectRoot = normalizeAndResolvePath(projectPath);
  log(`Initializing project at: ${projectRoot}`);

  try {
    await fs.access(projectRoot);
  } catch (error) {
    return createMcpResponse(`Error: Directory not found at ${projectRoot}`, true);
  }

  // Close the existing database before switching projects
  closeDatabase();

  // Set the global project root and change the current working directory
  setProjectRoot(projectRoot);
  process.chdir(projectRoot);
  log('Changed working directory to: ' + process.cwd());

  // Update the base directory in the global config
  let config = getConfig();
  if (config) {
    config.baseDirectory = projectRoot;
    setConfig(config);
  }

  // Define the configuration for the new file tree
  const newConfig: FileTreeConfig = {
    filename: `FileScopeMCP-tree-${path.basename(projectRoot)}.json`,
    baseDirectory: projectRoot,
    projectRoot: projectRoot,
    lastUpdated: new Date()
  };

  // Run JSON-to-SQLite migration if needed (handles existing JSON tree files)
  try {
    runMigrationIfNeeded(projectRoot);
  } catch (err) {
    log(`Migration failed (non-fatal): ${err}`);
  }

  // Open the SQLite database for this project
  const dbPath = path.join(projectRoot, '.filescope.db');
  openDatabase(dbPath);
  log(`Opened SQLite database at: ${dbPath}`);

  try {
    await buildFileTree(newConfig);

    // Always initialize file watcher for self-healing
    log('Initializing file watcher for self-healing...');
    await initializeFileWatcher();

    // Start periodic integrity sweep
    log('Starting periodic integrity sweep...');
    startIntegritySweep();

    return createMcpResponse(`Project path set to ${projectRoot}. File tree built and saved to SQLite.`);
  } catch (error) {
    log("Failed to build file tree: " + error);
    return createMcpResponse(`Failed to build file tree for ${projectRoot}: ${error}`, true);
  }
}

// Server initialization
async function initializeServer(): Promise<void> {
  log('Starting FileScopeMCP server initialization...');
  log('Initial working directory: ' + process.cwd());
  log('Command line args: ' + process.argv);

  // Load the base configuration file first
  const config = await loadConfig();
  setConfig(config);

  // Check for --base-dir argument for auto-initialization
  const baseDirArg = process.argv.find(arg => arg.startsWith('--base-dir='));
  if (baseDirArg) {
    const projectPath = baseDirArg.split('=')[1];
    if (projectPath) {
      log(`Found --base-dir argument. Initializing project at: ${projectPath}`);
      await initializeProject(projectPath);
    } else {
      log('--base-dir argument found but is empty. Server will wait for manual initialization.');
    }
  } else {
    log('No --base-dir argument found. Server initialized in a waiting state.');
    log('Call the `set_project_path` tool to analyze a directory.');
  }
}

/**
 * Initialize the file watcher
 */
async function initializeFileWatcher(): Promise<void> {
  try {
    const config = getConfig();
    if (!config || !config.fileWatching) {
      log('Cannot initialize file watcher: config or fileWatching not available');
      return;
    }

    // Stop any existing watcher
    if (fileWatcher) {
      fileWatcher.stop();
      fileWatcher = null;
    }

    // Create and start a new watcher
    fileWatcher = new FileWatcher(config.fileWatching, getProjectRoot());
    fileWatcher.addEventCallback((filePath, eventType) => handleFileEvent(filePath, eventType));
    fileWatcher.start();

    log('File watcher initialized and started successfully');
  } catch (error) {
    log('Error initializing file watcher: ' + error);
  }
}

/**
 * Handle a file event
 * @param filePath The path of the file that changed (already normalized by watcher)
 * @param eventType The type of event
 */
async function handleFileEvent(filePath: string, eventType: FileEventType): Promise<void> {
  log(`[MCP Server] Handling file event: ${eventType} for ${filePath}`);

  // Use the module-level active config and tree
  const activeConfig = currentConfig;
  const activeTree = fileTree;
  const projectRoot = getProjectRoot();
  const fileWatchingConfig = getConfig()?.fileWatching;

  if (!activeConfig || !activeTree || !projectRoot || !fileWatchingConfig) {
    log('[MCP Server] Ignoring file event: Active config, tree, project root, or watching config not available.');
    return;
  }

  if (!fileWatchingConfig.autoRebuildTree) {
    log('[MCP Server] Ignoring file event: Auto-rebuild is disabled.');
    return;
  }

  // --- Debounce Logic ---
  const debounceKey = `${filePath}:${eventType}`;
  const existingTimer = fileEventDebounceTimers.get(debounceKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const newTimer = setTimeout(() => {
    fileEventDebounceTimers.delete(debounceKey); // Remove timer reference once it executes
    log(`[MCP Server] Debounced processing for: ${eventType} - ${filePath}`);

    treeMutex.run(async () => {
      try {
        switch (eventType) {
          case 'add':
            if (fileWatchingConfig.watchForNewFiles) {
              log(`[MCP Server] Calling addFileNode for ${filePath}`);
              // addFileNode now persists to SQLite internally
              await addFileNode(filePath, activeTree, projectRoot);
            }
            break;

          case 'change':
            if (fileWatchingConfig.watchForChanged) {
               log(`[MCP Server] CHANGE detected for ${filePath}, performing incremental update.`);
               // updateFileNodeOnChange now persists to SQLite internally
               await updateFileNodeOnChange(filePath, activeTree, projectRoot);
            }
            break;

          case 'unlink':
            if (fileWatchingConfig.watchForDeleted) {
               log(`[MCP Server] Calling removeFileNode for ${filePath}`);
               // removeFileNode now persists to SQLite internally (deleteFile)
               await removeFileNode(filePath, activeTree, projectRoot);
            }
            break;
        }

      } catch (error) {
        log(`[MCP Server] Error processing debounced file event ${eventType} for ${filePath}: ${error}`);
      }
    });
  }, DEBOUNCE_DURATION_MS);

  fileEventDebounceTimers.set(debounceKey, newTimer);
}

/**
 * Start periodic integrity sweep for self-healing.
 * Runs every INTEGRITY_SWEEP_INTERVAL_MS to detect stale, missing, or new files.
 */
function startIntegritySweep(): void {
  if (integritySweepInterval) clearInterval(integritySweepInterval);
  integritySweepInterval = setInterval(() => {
    if (!fileTree || !currentConfig) return;

    const config = getConfig();
    if (!config?.fileWatching?.autoRebuildTree) {
      log('[Integrity Sweep] Skipping: autoRebuildTree is disabled.');
      return;
    }

    treeMutex.run(async () => {
      if (!fileTree || !currentConfig) return;
      try {
        // Load current state from SQLite for accurate integrity check
        const dbFiles = getAllFiles();
        const dbFileTree = dbFiles.length > 0 ? fileTree : fileTree;

        const result = await integrityCheck(dbFileTree, getProjectRoot());
        const totalIssues = result.staleFiles.length + result.missingFiles.length + result.newFiles.length;
        if (totalIssues === 0) return;

        log(`[Integrity Sweep] Found ${totalIssues} issues: ${result.staleFiles.length} stale, ${result.missingFiles.length} missing, ${result.newFiles.length} new`);

        // Auto-heal stale files — updateFileNodeOnChange persists to SQLite
        for (const filePath of result.staleFiles) {
          await updateFileNodeOnChange(filePath, fileTree, getProjectRoot());
        }
        // Auto-remove missing files — removeFileNode persists to SQLite
        for (const filePath of result.missingFiles) {
          await removeFileNode(filePath, fileTree, getProjectRoot());
        }
        // Auto-add new files — addFileNode persists to SQLite
        for (const filePath of result.newFiles) {
          await addFileNode(filePath, fileTree, getProjectRoot());
        }
        log(`[Integrity Sweep] Healed: ${result.staleFiles.length} stale, ${result.missingFiles.length} removed, ${result.newFiles.length} added`);
      } catch (error) {
        log(`[Integrity Sweep] Error: ${error}`);
      }
    });
  }, INTEGRITY_SWEEP_INTERVAL_MS);
}

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

// Utility functions
function findNode(node: FileNode, targetPath: string): FileNode | null {
  // Normalize both paths for comparison
  const normalizedTargetPath = normalizePath(targetPath);
  const normalizedNodePath = normalizePath(node.path);

  log('Finding node: ' + JSON.stringify({
    targetPath: normalizedTargetPath,
    currentNodePath: normalizedNodePath,
    isDirectory: node.isDirectory,
    childCount: node.children?.length
  }));

  // Try exact match first
  if (normalizedNodePath === normalizedTargetPath) {
    log('Found exact matching node');
    return node;
  }

  // Try case-insensitive match for Windows compatibility
  if (normalizedNodePath.toLowerCase() === normalizedTargetPath.toLowerCase()) {
    log('Found case-insensitive matching node');
    return node;
  }

  // Check if the path ends with our target (to handle relative vs absolute paths)
  if (normalizedTargetPath.endsWith(normalizedNodePath) || normalizedNodePath.endsWith(normalizedTargetPath)) {
    log('Found path suffix matching node');
    return node;
  }

  // Check children if this is a directory
  if (node.children) {
    for (const child of node.children) {
      const found = findNode(child, targetPath);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

// Get all file nodes as a flat array
function getAllFileNodes(node: FileNode): FileNode[] {
  const results: FileNode[] = [];

  function traverse(currentNode: FileNode) {
    if (!currentNode.isDirectory) {
      results.push(currentNode);
    }

    if (currentNode.children && currentNode.children.length > 0) {
      for (const child of currentNode.children) {
        traverse(child);
      }
    }
  }

  // Start traversal with the root node
  traverse(node);
  log(`Found ${results.length} file nodes`);
  return results;
}

// Build or load the file tree — now uses SQLite as cache
async function buildFileTree(config: FileTreeConfig): Promise<FileNode> {
  log('\n BUILD FILE TREE STARTED');
  log('==========================================');
  log('Building file tree with config: ' + JSON.stringify(config, null, 2));
  log('Current working directory: ' + process.cwd());
  log('Config in global state: ' + (getConfig() !== null ? 'YES' : 'NO'));
  if (getConfig()) {
    log('Global config exclude patterns count: ' + (getConfig()?.excludePatterns?.length || 0));
  }

  // Check if SQLite already has data — use as cache
  try {
    const dbFiles = getAllFiles();
    if (dbFiles.length > 0) {
      log(`Found ${dbFiles.length} files in SQLite — checking freshness`);

      // Spot-check freshness: sample up to 10 file nodes and compare mtimes
      const fileNodes = dbFiles.filter(f => !f.isDirectory);
      const sampleSize = Math.min(10, fileNodes.length);
      const sample = fileNodes.length <= 10
        ? fileNodes
        : fileNodes.sort(() => Math.random() - 0.5).slice(0, sampleSize);

      let isFresh = true;
      for (const node of sample) {
        if (node.mtime === undefined) {
          log('No mtime on node ' + node.path + ', forcing rescan');
          isFresh = false;
          break;
        }
        try {
          const stat = fsSync.statSync(node.path);
          if (Math.abs(stat.mtimeMs - node.mtime) > 1) {
            log('Stale mtime on ' + node.path + ': db=' + node.mtime + ' disk=' + stat.mtimeMs);
            isFresh = false;
            break;
          }
        } catch {
          log('Missing file during freshness check: ' + node.path);
          isFresh = false;
          break;
        }
      }

      if (isFresh) {
        log('Freshness check passed — using SQLite cache');
        // Reconstruct in-memory tree from flat DB rows
        const tree = reconstructTreeFromDb(dbFiles, config.baseDirectory);
        fileTree = tree;
        currentConfig = config;
        log('BUILD FILE TREE COMPLETED (loaded from SQLite, freshness verified)');
        log('==========================================\n');
        return fileTree;
      } else {
        log('Freshness check failed — rescanning from disk');
        // Fall through to full rescan
      }
    }
  } catch (error) {
    log('Failed to load from SQLite: ' + error);
    // Continue to build new tree
  }

  // Full rescan from disk
  log('Building new file tree for directory: ' + config.baseDirectory);

  if (!getConfig()) {
    log('WARNING: No config in global state, setting it now');
    const currentConfig = await loadConfig();
    setConfig(currentConfig);
  }

  const scannedTree = await scanDirectory(config.baseDirectory);

  if (!scannedTree.children || scannedTree.children.length === 0) {
    log('Failed to scan directory - no children found');
    throw new Error('Failed to scan directory');
  } else {
    log(`Successfully scanned directory, found ${scannedTree.children.length} top-level entries`);
  }

  log('Building dependency map...');
  buildDependentMap(scannedTree);
  log('Calculating importance values...');
  calculateImportance(scannedTree);

  // Persist to SQLite — bulk upsert all nodes
  log('Saving file tree to SQLite...');
  try {
    await saveFileTree(config, scannedTree);
    log('Successfully saved file tree to SQLite');
    fileTree = scannedTree;
    currentConfig = config;
  } catch (error) {
    log('Failed to save file tree to SQLite: ' + error);
    throw error;
  }

  log('BUILD FILE TREE COMPLETED (built from scratch)');
  log('==========================================\n');
  return fileTree!;
}

/**
 * Reconstructs a nested FileNode tree from a flat list of DB rows.
 * Used when loading from SQLite cache to provide backward-compat in-memory tree.
 */
function reconstructTreeFromDb(dbFiles: FileNode[], baseDirectory: string): FileNode {
  // Build a map of path -> node (with empty children arrays for dirs)
  const nodeMap = new Map<string, FileNode>();
  for (const f of dbFiles) {
    nodeMap.set(f.path, {
      ...f,
      children: f.isDirectory ? [] : undefined,
    });
  }

  // Find the root: node whose path equals baseDirectory (or shortest path)
  let root = nodeMap.get(baseDirectory) ?? nodeMap.get(normalizePath(baseDirectory));
  if (!root) {
    // Fall back to shortest path as root
    let shortest: FileNode | null = null;
    for (const node of nodeMap.values()) {
      if (!shortest || node.path.length < shortest.path.length) {
        shortest = node;
      }
    }
    root = shortest ?? {
      path: baseDirectory,
      name: path.basename(baseDirectory),
      isDirectory: true,
      children: []
    };
  }

  // Assign children to their parents
  for (const node of nodeMap.values()) {
    if (node.path === root.path) continue;
    const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
    const parent = nodeMap.get(parentPath);
    if (parent && parent.isDirectory && parent.children) {
      parent.children.push(node);
    }
  }

  return root;
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

// Guard function to check if the project path is set
function isProjectPathSet(): boolean {
  // The project is considered "set" if the file tree has been built.
  return fileTree !== null;
}

const projectPathNotSetError = createMcpResponse("Project path not set. Please call 'set_project_path' or initialize the server with --base-dir.", true);

// Register tools
server.tool("set_project_path", "Sets the project directory to analyze", {
  path: z.string().describe("The absolute path to the project directory"),
}, async (params: { path: string }) => {
  return await initializeProject(params.path);
});

server.tool("list_saved_trees", "List all saved file trees", async () => {
  if (!isProjectPathSet()) return projectPathNotSetError;
  const trees = await listSavedFileTrees();
  return createMcpResponse(trees);
});

server.tool("delete_file_tree", "Delete a file tree configuration", {
  filename: z.string().describe("Name of the JSON file to delete")
}, async (params: { filename: string }) => {
  if (!isProjectPathSet()) return projectPathNotSetError;
  try {
    const normalizedPath = normalizeAndResolvePath(params.filename);
    await fs.unlink(normalizedPath);

    // Clear from memory if it's the current tree
    if (currentConfig?.filename === normalizedPath) {
      currentConfig = null;
      fileTree = null;
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
  if (!isProjectPathSet()) return projectPathNotSetError;
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
      baseDir = getProjectRoot(); // Use the project root instead of cwd
      log('Resolved "." to project root: ' + baseDir);
    }

    // Normalize the base directory relative to project root if not absolute
    if (!path.isAbsolute(baseDir)) {
      baseDir = path.join(getProjectRoot(), baseDir);
      log('Resolved relative base directory: ' + baseDir);
    }

    const config = await createFileTreeConfig(relativeFilename, baseDir);
    log('Created config: ' + JSON.stringify(config));

    // Build the tree with the new config, not the default
    const tree = await buildFileTree(config);
    log('Built file tree with root path: ' + tree.path);

    // Update global state
    fileTree = tree;
    currentConfig = config;

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
  if (!isProjectPathSet()) return projectPathNotSetError;
  // With SQLite, we load directly from the DB
  try {
    const storage = await loadFileTree(params.filename);
    fileTree = storage.fileTree;
    currentConfig = storage.config;

    return createMcpResponse({
      message: `File tree loaded from SQLite`,
      config: currentConfig
    });
  } catch (error) {
    return createMcpResponse(`File tree not found: ${params.filename}`, true);
  }
});

server.tool("list_files", "List all files in the project with their importance rankings", async () => {
  if (!isProjectPathSet()) return projectPathNotSetError;
  // Return the in-memory tree (reconstructed from DB) for backward compat
  return createMcpResponse(fileTree);
});

server.tool("get_file_importance", "Get the importance ranking of a specific file", {
  filepath: z.string().describe("The path to the file to check")
}, async (params: { filepath: string }) => {
  if (!isProjectPathSet()) return projectPathNotSetError;
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

    return createMcpResponse({
      path: node.path,
      importance: node.importance || 0,
      dependencies: node.dependencies || [],
      dependents: node.dependents || [],
      packageDependencies: node.packageDependencies || [],
      summary: node.summary || null
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
  if (!isProjectPathSet()) return projectPathNotSetError;

  const limit = params.limit || 10;
  const minImportance = params.minImportance || 0;

  // Use repository to get all files from DB
  const allFiles = getAllFiles().filter(f => !f.isDirectory);

  // Filter by minimum importance and sort by importance (descending)
  const importantFiles = allFiles
    .filter(file => (file.importance || 0) >= minImportance)
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, limit)
    .map(file => ({
      path: file.path,
      importance: file.importance || 0,
      dependentCount: (file.dependents?.length || getDependents(file.path).length) || 0,
      dependencyCount: (file.dependencies?.length || getDependencies(file.path).length) || 0,
      hasSummary: !!file.summary
    }));

  return createMcpResponse(importantFiles);
});

// New tool to get the summary of a file
server.tool("get_file_summary", "Get the summary of a specific file", {
  filepath: z.string().describe("The path to the file to check")
}, async (params: { filepath: string }) => {
  if (!isProjectPathSet()) return projectPathNotSetError;

  const normalizedPath = normalizePath(params.filepath);
  const node = getFile(normalizedPath);

  if (!node) {
    return createMcpResponse(`File not found: ${params.filepath}`, true);
  }

  if (!node.summary) {
    return createMcpResponse(`No summary available for ${params.filepath}`);
  }

  return createMcpResponse({
    path: node.path,
    summary: node.summary
  });
});

// New tool to set the summary of a file
server.tool("set_file_summary", "Set the summary of a specific file", {
  filepath: z.string().describe("The path to the file to update"),
  summary: z.string().describe("The summary text to set")
}, async (params: { filepath: string, summary: string }) => {
  if (!isProjectPathSet()) return projectPathNotSetError;

  const normalizedPath = normalizePath(params.filepath);
  const node = getFile(normalizedPath);

  if (!node) {
    return createMcpResponse(`File not found: ${params.filepath}`, true);
  }

  // Update summary and persist to DB
  node.summary = params.summary;
  upsertFile(node);

  // Also update in-memory tree if it's there
  if (fileTree) {
    updateFileNode(fileTree, normalizedPath, { summary: params.summary });
  }

  return createMcpResponse({
    message: `Summary updated for ${params.filepath}`,
    path: normalizedPath,
    summary: params.summary
  });
});

// New tool to read a file's content
server.tool("read_file_content", "Read the content of a specific file", {
  filepath: z.string().describe("The path to the file to read")
}, async (params: { filepath: string }) => {
  if (!isProjectPathSet()) return projectPathNotSetError;
  try {
    const content = await readFileContent(params.filepath);

    return createMcpResponse(content);
  } catch (error) {
    return createMcpResponse(`Failed to read file: ${params.filepath} - ` + error, true);
  }
});

// New tool to set the importance of a file manually
server.tool("set_file_importance", "Manually set the importance ranking of a specific file", {
  filepath: z.string().describe("The path to the file to update"),
  importance: z.number().min(0).max(10).describe("The importance value to set (0-10)")
}, async (params: { filepath: string, importance: number }) => {
  if (!isProjectPathSet()) return projectPathNotSetError;
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

      // Update in-memory tree too
      if (fileTree) {
        setFileImportance(fileTree, matchedNode.path, matchedNode.importance);
      }

      return createMcpResponse({
        message: `Importance updated for ${matchedNode.path}`,
        path: matchedNode.path,
        importance: matchedNode.importance
      });
    }

    node.importance = Math.min(10, Math.max(0, params.importance));
    upsertFile(node);

    // Update in-memory tree too
    if (fileTree) {
      setFileImportance(fileTree, normalizedPath, node.importance);
    }

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

// Add a tool to recalculate importance for all files
server.tool("recalculate_importance", "Recalculate importance values for all files based on dependencies", async () => {
  if (!isProjectPathSet()) return projectPathNotSetError;

  log('Recalculating importance values...');

  // Use in-memory tree for calculation, then write back to DB
  if (fileTree) {
    buildDependentMap(fileTree);
    calculateImportance(fileTree);

    // Write recalculated importance values back to SQLite
    const allTreeNodes = getAllFileNodes(fileTree!);
    for (const node of allTreeNodes) {
      upsertFile(node);
    }
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

// File watching tools
server.tool("toggle_file_watching", "Toggle file watching on/off", async () => {
  if (!isProjectPathSet()) return projectPathNotSetError;
  const config = getConfig();
  if (!config) {
    return createMcpResponse('No configuration loaded', true);
  }

  // Create default file watching config if it doesn't exist
  if (!config.fileWatching) {
    config.fileWatching = { ...DEFAULT_FILE_WATCHING, enabled: true };
  } else {
    // Toggle the enabled status
    config.fileWatching.enabled = !config.fileWatching.enabled;
  }

  // Save the updated config
  setConfig(config);
  await saveConfig(config);

  if (config.fileWatching.enabled) {
    // Start watching
    await initializeFileWatcher();
    return createMcpResponse('File watching enabled');
  } else {
    // Stop watching
    if (fileWatcher) {
      fileWatcher.stop();
      fileWatcher = null;
    }
    return createMcpResponse('File watching disabled');
  }
});

server.tool("get_file_watching_status", "Get the current status of file watching", async () => {
  if (!isProjectPathSet()) return projectPathNotSetError;
  const config = getConfig();
  const status = {
    enabled: config?.fileWatching?.enabled || false,
    isActive: fileWatcher !== null && fileWatcher !== undefined,
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
  if (!isProjectPathSet()) return projectPathNotSetError;
  const config = getConfig();
  if (!config) {
    return createMcpResponse('No configuration loaded', true);
  }

  // Create or update file watching config
  if (!config.fileWatching) {
    config.fileWatching = { ...DEFAULT_FILE_WATCHING, ...params.config };
  } else {
    config.fileWatching = {
      ...config.fileWatching,
      ...params.config
    };
  }

  // Save the updated config
  setConfig(config);
  await saveConfig(config);

  // Restart watcher if it's enabled
  if (config.fileWatching.enabled) {
    await initializeFileWatcher();
  } else if (fileWatcher) {
    fileWatcher.stop();
    fileWatcher = null;
  }

  return createMcpResponse({
    message: 'File watching configuration updated',
    config: config.fileWatching
  });
});

server.tool("debug_list_all_files", "List all file paths in the current file tree", async () => {
  if (!isProjectPathSet()) return projectPathNotSetError;

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


// Exclude and remove a file or pattern from the file tree
server.tool("exclude_and_remove", "Exclude and remove a file or pattern from the file tree", {
  filepath: z.string().describe("The path or pattern of the file to exclude and remove")
}, async (params: { filepath: string }) => {
  try {
    if (!fileTree || !currentConfig) {
      // Attempt to initialize with a default config if possible
      const baseDirArg = process.argv.find(arg => arg.startsWith('--base-dir='));
      if (baseDirArg) {
        const projectPath = baseDirArg.split('=')[1];
        await initializeProject(projectPath);
      } else {
        return projectPathNotSetError;
      }
    }

    log('exclude_and_remove called with params: ' + JSON.stringify(params));
    log('Current file tree root: ' + fileTree?.path);

    // Use the excludeAndRemoveFile function (which calls removeFileNode → deleteFile in DB)
    await excludeAndRemoveFile(params.filepath, fileTree!, getProjectRoot());

    return createMcpResponse({
      message: `File or pattern excluded and removed: ${params.filepath}`
    });
  } catch (error) {
    log('Error in exclude_and_remove: ' + error);
    return createMcpResponse(`Failed to exclude and remove file or pattern: ` + error, true);
  }
});

// Start the server
(async () => {
  try {
    // Initialize server first
    await initializeServer();

    // Connect to transport
    const transport = new StdioTransport();
    await server.connect(transport);
  } catch (error) {
    log('Server error: ' + error);
    process.exit(1);
  }
})();
