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
  MermaidDiagramConfig,
  FileWatchingConfig
} from "./types.js";
import { scanDirectory, calculateImportance, setFileImportance, buildDependentMap, normalizePath, addFileNode, removeFileNode, excludeAndRemoveFile } from "./file-utils.js";
import { 
  createFileTreeConfig, 
  saveFileTree,
  loadFileTree,
  listSavedFileTrees,
  updateFileNode,
  getFileNode,
  normalizeAndResolvePath
} from "./storage-utils.js";
import * as fsSync from "fs";
import { MermaidGenerator } from "./mermaid-generator.js";
import { setProjectRoot, getProjectRoot, setConfig, getConfig } from './global-state.js';
import { loadConfig, saveConfig } from './config-utils.js';
import { FileWatcher, FileEventType } from './file-watcher.js';
import { log, enableFileLogging } from './logger.js';

// Enable file logging for debugging
enableFileLogging(true, 'mcp-debug.log');

// Initialize server state
let fileTree: FileNode | null = null;
let currentConfig: FileTreeConfig | null = null;
let DEFAULT_CONFIG: FileTreeConfig;
let fileWatcher: FileWatcher | null = null;
// Map to hold debounce timers for file events
const fileEventDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
const DEBOUNCE_DURATION_MS = 2000; // 2 seconds

// Check if we're running as an MCP server for Cursor
function isRunningAsMcpServer(): boolean {
  // Check if we were launched by Cursor's MCP client
  const isMcpServerMode = process.argv.some(arg => 
    arg.includes('mcp-server.js') || 
    arg.includes('mcp.json')
  );
  
  // Check if we're communicating over stdio
  const isStdioMode = process.stdin.isTTY === false;
  
  return isMcpServerMode || isStdioMode;
}

// Find the actual FileScopeMCP project directory
async function findFileScopeMcpDirectory(): Promise<string | null> {
  // Try to extract it from command line arguments
  const scriptPath = process.argv[1] || '';
  log('Script path: ' + scriptPath);
  
  if (scriptPath.includes('FileScopeMCP')) {
    // Extract the project directory from script path
    const match = scriptPath.match(/(.+?FileScopeMCP)/i);
    if (match && match[1]) {
      const mcpDir = match[1];
      try {
        // Verify this directory by checking for package.json
        const packageJsonPath = path.join(mcpDir, 'package.json');
        await fs.access(packageJsonPath);
        log(`Verified FileScopeMCP directory: ${mcpDir}`);
        return mcpDir;
      } catch (error) {
        log(`Could not verify directory ${mcpDir}`);
      }
    }
  }
  
  // Check environment variables (could be set by Cursor)
  const envProjectDir = process.env.MCP_PROJECT_DIR;
  if (envProjectDir) {
    try {
      await fs.access(envProjectDir);
      log(`Found project directory from env: ${envProjectDir}`);
      return envProjectDir;
    } catch (error) {
      log(`Invalid environment directory: ${envProjectDir}`);
    }
  }
  
  // Look for common development directories with FileScopeMCP in the path
  const commonDevPaths = [
    'C:/Users/Adrian/code/mcp/FileScopeMCP',
    '/Users/Adrian/code/mcp/FileScopeMCP',
    path.join(process.env.HOME || '', 'code/mcp/FileScopeMCP'),
    path.join(process.env.USERPROFILE || '', 'code/mcp/FileScopeMCP')
  ];
  
  for (const testPath of commonDevPaths) {
    try {
      await fs.access(testPath);
      log(`Found project directory in common paths: ${testPath}`);
      return testPath;
    } catch (error) {
      // Path doesn't exist, try next one
    }
  }
  
  return null;
}

// Server initialization
async function initializeServer(): Promise<void> {
  log('Starting FileScopeMCP server initialization');
  log('Initial working directory: ' + process.cwd());
  log('Command line args: ' + process.argv);
  
  // First try to get base directory from command line
  const baseDirArg = process.argv.find(arg => arg.startsWith('--base-dir='));
  let projectRoot: string;
  let config = await loadConfig();
  
  log('========== CONFIG DEBUGGING ==========');
  log('Loaded config: ' + JSON.stringify(config, null, 2));
  log('Exclude patterns count: ' + (config.excludePatterns?.length || 0));
  log('=====================================');
  
  if (baseDirArg) {
    // Use command line argument if provided
    projectRoot = normalizeAndResolvePath(baseDirArg.split('=')[1]);
    log(`Using base directory from command line: ${projectRoot}`);
    // Update config with command line base directory
    config.baseDirectory = projectRoot;
  } else {
    // Check if baseDirectory is set in config
    if (!config.baseDirectory) {
      log('Error: baseDirectory must be set in either config.json or via --base-dir parameter');
      process.exit(1);
    }
    
    projectRoot = normalizeAndResolvePath(config.baseDirectory);
    log(`Using base directory from config: ${projectRoot}`);
  }
  
  // Set the global project root and config
  setProjectRoot(projectRoot);
  setConfig(config);
  
  log('Global state after initialization:');
  log('- Project root: ' + getProjectRoot());
  log('- Config loaded: ' + (getConfig() !== null));
  if (getConfig()) {
    log('- Exclude patterns count: ' + (getConfig()?.excludePatterns?.length || 0));
    if (getConfig()?.excludePatterns?.length) {
      log('- First few exclude patterns: ' + getConfig()?.excludePatterns?.slice(0, 5));
    }
  }
  
  // Verify the directory exists
  try {
    await fs.access(projectRoot);
  } catch (error) {
    log(`Error: Base directory ${projectRoot} does not exist`);
    process.exit(1);
  }
  
  process.chdir(projectRoot);
  log('Changed working directory to: ' + process.cwd());
  
  // Now we can safely set the default config
  DEFAULT_CONFIG = {
    filename: "FileScopeMCP-tree.json",
    baseDirectory: projectRoot,
    projectRoot: projectRoot,
    lastUpdated: new Date()
  };
  
  // Try to load the default file tree
  try {
    await buildFileTree(DEFAULT_CONFIG);
  } catch (error) {
    log("Failed to build default file tree: " + error);
  }
  
  // Initialize file watcher if enabled in config
  const fileWatchingConfig = getConfig()?.fileWatching;
  if (fileWatchingConfig?.enabled) {
    log('File watching is enabled in config, initializing watcher...');
    await initializeFileWatcher();
  } else {
    log('File watching is disabled in config');
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

  const newTimer = setTimeout(async () => {
    fileEventDebounceTimers.delete(debounceKey); // Remove timer reference once it executes
    log(`[MCP Server] Debounced processing for: ${eventType} - ${filePath}`);

    try {
      let updated = false;
      switch (eventType) {
        case 'add':
          if (fileWatchingConfig.watchForNewFiles) {
            log(`[MCP Server] Calling addFileNode for ${filePath}`);
            await addFileNode(filePath, activeTree, projectRoot);
            updated = true;
          }
          break;
          
        case 'change':
          // TODO: Implement incremental update for changed files if needed
          if (fileWatchingConfig.watchForChanged) {
             log(`[MCP Server] CHANGE detected for ${filePath}, incremental handling not implemented. Triggering full rebuild as fallback.`);
             // Fallback to full rebuild for now
             await buildFileTree(activeConfig);
             updated = true; // Assume tree changed
          }
          break;
          
        case 'unlink':
          if (fileWatchingConfig.watchForDeleted) {
             log(`[MCP Server] Calling removeFileNode for ${filePath}`);
             await removeFileNode(filePath, activeTree, projectRoot);
             updated = true;
          }
          break;
      }

      // Save the potentially modified tree if an add/remove/rebuild happened
      if (updated) {
        // We need the latest references in case buildFileTree was called
        const latestActiveConfig = currentConfig;
        const latestActiveTree = fileTree;
        if(latestActiveConfig && latestActiveTree){
            log(`[MCP Server] Saving updated file tree after ${eventType} event.`);
            await saveFileTree(latestActiveConfig, latestActiveTree);
        } else {
            log(`[MCP Server] Error saving tree after ${eventType} event: active config or tree became null.`);
        }
      }

    } catch (error) {
      log(`[MCP Server] Error processing debounced file event ${eventType} for ${filePath}: ${error}`);
    }
  }, DEBOUNCE_DURATION_MS);

  fileEventDebounceTimers.set(debounceKey, newTimer);
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

// Build or load the file tree
async function buildFileTree(config: FileTreeConfig): Promise<FileNode> {
  log('\n🌲 BUILD FILE TREE STARTED');
  log('==========================================');
  log('Building file tree with config: ' + JSON.stringify(config, null, 2));
  log('Current working directory: ' + process.cwd());
  log('Config in global state: ' + (getConfig() !== null ? '✅ YES' : '❌ NO'));
  if (getConfig()) {
    log('Global config exclude patterns count: ' + (getConfig()?.excludePatterns?.length || 0));
  }
  
  // First try to load from file
  try {
    const savedTree = await loadFileTree(config.filename);
    if (savedTree) {
      // Use the saved tree
      if (!savedTree.fileTree) {
        log('❌ Invalid file tree structure in saved file');
        throw new Error('Invalid file tree structure');
      }
      log('✅ Using existing file tree from: ' + config.filename);
      log('Tree root path: ' + savedTree.fileTree.path);
      log('Tree has children: ' + (savedTree.fileTree.children?.length || 0));
      fileTree = savedTree.fileTree;
      currentConfig = savedTree.config;
      
      log('🌲 BUILD FILE TREE COMPLETED (loaded from file)');
      log('==========================================\n');
      return fileTree;
    }
  } catch (error) {
    log('❌ Failed to load existing file tree: ' + error);
    // Continue to build new tree
  }

  // If not found or failed to load, build from scratch
  log('🔍 Building new file tree for directory: ' + config.baseDirectory);
  
  // Verify config is in global state before scanning
  if (!getConfig()) {
    log('⚠️ WARNING: No config in global state, setting it now');
    // Get the current config
    const currentConfig = await loadConfig();
    // Set the global config
    setConfig(currentConfig);
    log('Config set in global state: ' + (getConfig() !== null ? '✅ YES' : '❌ NO'));
    if (getConfig()) {
      log('Global config exclude patterns count: ' + (getConfig()?.excludePatterns?.length || 0));
    }
  }
  
  fileTree = await scanDirectory(config.baseDirectory);
  
  if (!fileTree.children || fileTree.children.length === 0) {
    log('❌ Failed to scan directory - no children found');
    throw new Error('Failed to scan directory');
  } else {
    log(`✅ Successfully scanned directory, found ${fileTree.children.length} top-level entries`);
  }
  
  log('📊 Building dependency map...');
  buildDependentMap(fileTree);
  log('📈 Calculating importance values...');
  calculateImportance(fileTree);
  
  // Save to disk
  log('💾 Saving file tree to: ' + config.filename);
  try {
    await saveFileTree(config, fileTree);
    log('✅ Successfully saved file tree');
    currentConfig = config;
  } catch (error) {
    log('❌ Failed to save file tree: ' + error);
    throw error;
  }
  
  log('🌲 BUILD FILE TREE COMPLETED (built from scratch)');
  log('==========================================\n');
  return fileTree;
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

// Register tools
server.tool("list_saved_trees", "List all saved file trees", async () => {
  const trees = await listSavedFileTrees();
  return createMcpResponse(trees);
});

server.tool("delete_file_tree", "Delete a file tree configuration", {
  filename: z.string().describe("Name of the JSON file to delete")
}, async (params: { filename: string }) => {
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
      message: `File tree created and stored in ${config.filename}`,
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
  const storage = await loadFileTree(params.filename);
  if (!storage) {
    return createMcpResponse(`File tree not found: ${params.filename}`, true);
  }
  
  fileTree = storage.fileTree;
  currentConfig = storage.config;
  
  return createMcpResponse({
    message: `File tree loaded from ${params.filename}`,
    config: currentConfig
  });
});

server.tool("list_files", "List all files in the project with their importance rankings", async () => {
  if (!fileTree) {
    await buildFileTree(DEFAULT_CONFIG);
  }
  return createMcpResponse(fileTree);
});

server.tool("get_file_importance", "Get the importance ranking of a specific file", {
  filepath: z.string().describe("The path to the file to check")
}, async (params: { filepath: string }) => {
  log('Get file importance called with params: ' + JSON.stringify(params));
  log('Current config: ' + JSON.stringify(currentConfig));
  log('File tree root path: ' + fileTree?.path);
  
  try {
    if (!fileTree || !currentConfig) {
      log('No file tree loaded, building default tree');
      await buildFileTree(DEFAULT_CONFIG);
    }
    
    const normalizedPath = normalizePath(params.filepath);
    log('Normalized path: ' + normalizedPath);
    
    const node = findNode(fileTree!, normalizedPath);
    log('Found node: ' + JSON.stringify(node ? {
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
  if (!fileTree) {
    await buildFileTree(DEFAULT_CONFIG);
  }
  
  const limit = params.limit || 10;
  const minImportance = params.minImportance || 0;
  
  // Get all files as a flat array
  const allFiles = getAllFileNodes(fileTree!);
  
  // Filter by minimum importance and sort by importance (descending)
  const importantFiles = allFiles
    .filter(file => (file.importance || 0) >= minImportance)
    .sort((a, b) => (b.importance || 0) - (a.importance || 0))
    .slice(0, limit)
    .map(file => ({
      path: file.path,
      importance: file.importance || 0,
      dependentCount: file.dependents?.length || 0,
      dependencyCount: file.dependencies?.length || 0,
      hasSummary: !!file.summary
    }));
  
  return createMcpResponse(importantFiles);
});

// New tool to get the summary of a file
server.tool("get_file_summary", "Get the summary of a specific file", {
  filepath: z.string().describe("The path to the file to check")
}, async (params: { filepath: string }) => {
  if (!fileTree) {
    await buildFileTree(DEFAULT_CONFIG);
  }
  
  const normalizedPath = normalizePath(params.filepath);
  const node = getFileNode(fileTree!, normalizedPath);
  
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
  if (!fileTree || !currentConfig) {
    await buildFileTree(DEFAULT_CONFIG);
  }
  
  const normalizedPath = normalizePath(params.filepath);
  const updated = updateFileNode(fileTree!, normalizedPath, {
    summary: params.summary
  });
  
  if (!updated) {
    return createMcpResponse(`File not found: ${params.filepath}`, true);
  }
  
  // Save the updated tree
  await saveFileTree(currentConfig!, fileTree!);
  
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
  try {
    if (!fileTree || !currentConfig) {
      await buildFileTree(DEFAULT_CONFIG);
    }
    
    log('set_file_importance called with params: ' + JSON.stringify(params));
    log('Current file tree root: ' + fileTree?.path);
    
    // Get a list of all files
    const allFiles = getAllFileNodes(fileTree!);
    log(`Total files in tree: ${allFiles.length}`);
    
    // First try the findAndSetImportance method
    const wasUpdated = setFileImportance(fileTree!, params.filepath, params.importance);
    
    // If that didn't work, try matching by basename
    if (!wasUpdated) {
      const basename = path.basename(params.filepath);
      log(`Looking for file with basename: ${basename}`);
      
      let foundFile = false;
      for (const file of allFiles) {
        const fileBasename = path.basename(file.path);
        log(`Checking file: ${file.path} with basename: ${fileBasename}`);
        
        if (fileBasename === basename) {
          log(`Found match: ${file.path}`);
          file.importance = Math.min(10, Math.max(0, params.importance));
          foundFile = true;
          break;
        }
      }
      
      if (!foundFile) {
        log('File not found by any method');
        return createMcpResponse(`File not found: ${params.filepath}`, true);
      }
    }
    
    // Save the updated tree
    await saveFileTree(currentConfig!, fileTree!);
    
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
  if (!fileTree || !currentConfig) {
    await buildFileTree(DEFAULT_CONFIG);
  }

  log('Recalculating importance values...');
  buildDependentMap(fileTree!);
  calculateImportance(fileTree!);
  
  // Save the updated tree
  if (currentConfig) {
    await saveFileTree(currentConfig, fileTree!);
  }
  
  // Count files with non-zero importance
  const allFiles = getAllFileNodes(fileTree!);
  const filesWithImportance = allFiles.filter(file => (file.importance || 0) > 0);
  
  return createMcpResponse({
    message: "Importance values recalculated",
    totalFiles: allFiles.length,
    filesWithImportance: filesWithImportance.length
  });
});

// File watching tools
server.tool("toggle_file_watching", "Toggle file watching on/off", async () => {
  const config = getConfig();
  if (!config) {
    return createMcpResponse('No configuration loaded', true);
  }
  
  // Create default file watching config if it doesn't exist
  if (!config.fileWatching) {
    config.fileWatching = {
      enabled: true,
      debounceMs: 300,
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
    debounceMs: z.number().int().positive().optional(),
    ignoreDotFiles: z.boolean().optional(),
    autoRebuildTree: z.boolean().optional(),
    maxWatchedDirectories: z.number().int().positive().optional(),
    watchForNewFiles: z.boolean().optional(),
    watchForDeleted: z.boolean().optional(),
    watchForChanged: z.boolean().optional()
  }).describe("File watching configuration options")
}, async (params: { config: Partial<FileWatchingConfig> }) => {
  const config = getConfig();
  if (!config) {
    return createMcpResponse('No configuration loaded', true);
  }
  
  // Create or update file watching config
  if (!config.fileWatching) {
    config.fileWatching = {
      enabled: false,
      debounceMs: 300,
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
  if (!fileTree) {
    await buildFileTree(DEFAULT_CONFIG);
  }
  
  // Get a flat list of all files
  const allFiles = getAllFileNodes(fileTree!);
  
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

// Add a function to create the HTML wrapper for a Mermaid diagram
function createMermaidHtml(mermaidCode: string, title: string): string {
  const now = new Date();
  const timestamp = `${now.toDateString()} ${now.toLocaleTimeString()}`;
  
  // Re-add escaping for backticks and dollar signs
  const escapedMermaidCode = mermaidCode.replace(/`/g, '\\`').replace(/\$/g, '\\$');
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <!-- Load Mermaid from CDN -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js"></script>
  <style>
    body {
      font-family: 'Inter', sans-serif;
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      transition: background 0.5s ease;
    }
    .dark-mode {
      background: linear-gradient(135deg, #1e1e2f 0%, #1d2426 100%);
    }
    .light-mode {
      background: linear-gradient(135deg, #f5f6fa 0%, #dcdde1 100%);
    }
    header {
      position: absolute;
      top: 20px;
      left: 20px;
      text-align: left;
    }
    #theme-toggle {
      position: absolute;
      top: 20px;
      right: 20px;
      padding: 10px 20px;
      border: none;
      border-radius: 50px;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.3s ease;
    }
    #diagram-container {
      width: 90%;
      max-width: 1200px;
      margin: 75px 0;
      padding: 25px;
      border-radius: 15px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      transition: all 0.5s ease;
      position: relative;
    }
    #mermaid-graph {
      overflow: auto;
      max-height: 70vh;
    }
    #error-message {
      position: absolute;
      bottom: 10px;
      left: 10px;
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      display: none;
    }
    /* Styles for collapsed nodes */
    .collapsed-node text {
      font-weight: bold;
    }
    .collapsed-node rect, .collapsed-node circle, .collapsed-node polygon {
      stroke-width: 3px !important;
    }
    .collapsed-indicator {
      fill: #4cd137;
      font-weight: bold;
    }
    /* Add + symbol to collapsed nodes */
    .collapsed-node .collapsed-icon {
      fill: #4cd137;
      font-size: 16px;
      font-weight: bold;
    }
  </style>
</head>
<body class="light-mode">
  <!-- Header -->
  <header style="color: #2d3436;">
    <h1 style="margin: 0; font-size: 28px;">${title}</h1>
    <div style="font-size: 14px; margin-top: 5px;">Generated on ${timestamp}</div>
  </header>

  <!-- Theme Toggle Button - Initial state for light mode -->
  <button id="theme-toggle" style="background: #dcdde1; color: #2d3436;">Switch to Dark Mode</button>

  <!-- Diagram Container - Initial state for light mode -->
  <div id="diagram-container" style="background: rgba(255, 255, 255, 0.8); border: 1px solid rgba(0, 0, 0, 0.1);">
    <div id="mermaid-graph"></div>
    <div id="error-message" style="background: rgba(45, 52, 54, 0.9); color: #ff7675;"></div>
    <!-- Mermaid Code -->
    <pre id="raw-code" style="display: none;">
${escapedMermaidCode}
    </pre>
  </div>

  <script>
    // Unique render ID counter
    let renderCount = 0;

    // Track collapsible groups
    const collapsibleGroups = {};
    let expandedGroups = new Set();
    let collapsedGroups = new Set();

    // Initialize Mermaid with light theme by default
    mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      flowchart: {
        htmlLabels: true,
        curve: 'basis',
        nodeSpacing: 42,
        rankSpacing: 60,
        useMaxWidth: true
      },
      themeVariables: {
        // Default light theme variables (adjust if needed)
        nodeBorder: "#2d3436",
        mainBkg: "#f8f9fa",    // Light background
        nodeTextColor: "#333333", // Dark text
        fontSize: "16px"
      }
    });

    // Render on DOM load
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof mermaid === 'undefined') {
        log('Mermaid library failed to load. Check network or CDN URL.');
        document.getElementById('error-message').style.display = 'block';
        document.getElementById('error-message').textContent = 'Error: Mermaid library not loaded';
        return;
      }
      renderMermaid();
    });

    // Handle node click events
    window.toggleGroup = function(nodeId) {
      if (expandedGroups.has(nodeId)) {
        // Collapse the group
        expandedGroups.delete(nodeId);
        collapsedGroups.add(nodeId);
      } else {
        // Expand the group
        collapsedGroups.delete(nodeId);
        expandedGroups.add(nodeId);
      }
      renderMermaid();
    };

    // Re-add processMermaidSvg function
    function processMermaidSvg(svgElement) {
      // Process click events on nodes
      const clickables = svgElement.querySelectorAll('[id^="flowchart-"]');
      
      clickables.forEach(node => {
        const nodeId = node.id.replace('flowchart-', '');
        
        // Is this a collapsible group?
        if (Object.keys(collapsibleGroups).includes(nodeId)) {
          // Add visual indicator for collapsed/expanded state
          const textElement = node.querySelector('text');
          
          if (textElement && collapsedGroups.has(nodeId)) {
            // Add a + sign for collapsed groups
            const currentText = textElement.textContent || '';
            if (!currentText.includes('[+]')) {
              textElement.textContent = currentText + ' [+]';
            }
            
            // Add a class for styling
            node.classList.add('collapsed-node');
          }
          
          // Make nodes clickable visually
          node.style.cursor = 'pointer';
          
          // Add the children count to the label
          const childCount = collapsibleGroups[nodeId].length;
          const childLabel = '(' + childCount + ' items)';
          const label = node.querySelector('text');
          
          if (label && !label.textContent.includes(childLabel)) {
            label.textContent += ' ' + childLabel;
          }
        }
      });
      
      // Hide children of collapsed groups
      collapsedGroups.forEach(groupId => {
        const children = collapsibleGroups[groupId] || [];
        children.forEach(childId => {
          const childElement = svgElement.querySelector('#flowchart-' + childId);
          if (childElement) {
            childElement.style.display = 'none';
            
            // Also hide edges to/from this element
            const edges = svgElement.querySelectorAll('path.flowchart-link');
            edges.forEach(edge => {
              const edgeId = edge.id;
              if (edgeId.includes(childId)) {
                edge.style.display = 'none';
              }
            });
          }
        });
      });
    }

    // Re-add detectCollapsibleGroups function
    function detectCollapsibleGroups(mermaidCode) {
      // Reset the collapsible groups
      Object.keys(collapsibleGroups).forEach(key => delete collapsibleGroups[key]);

      // Look for click handler definitions like 'click node1 toggleGroup "node1"'
      // Ensure backslashes for regex characters and quotes are properly escaped for the final HTML
      const clickHandlerRegex = /click\\s+(\\w+)\\s+toggleGroup\\s+\"([^\"]+)\"/g;
      let match;
      
      while ((match = clickHandlerRegex.exec(mermaidCode)) !== null) {
        const nodeId = match[1];
        
        // Now find children of this group in the subgraph definition
        // Ensure backslashes for regex characters are properly escaped for the final HTML
        const subgraphRegex = new RegExp('subgraph\\s+' + nodeId + '.*?\\n([\\s\\S]*?)\\nend', 'g');
        const subgraphMatch = subgraphRegex.exec(mermaidCode);
        
        if (subgraphMatch) {
          const subgraphContent = subgraphMatch[1];
          // Extract node IDs from the subgraph
          // Ensure backslashes for regex characters are properly escaped for the final HTML
          const nodeRegex = /\\s+(\\w+)/g;
          const children = [];
          let nodeMatch;
          
          while ((nodeMatch = nodeRegex.exec(subgraphContent)) !== null) {
            const childId = nodeMatch[1].trim();
            if (childId !== nodeId) {
              children.push(childId);
            }
          }
          
          if (children.length > 0) {
            collapsibleGroups[nodeId] = children;
            // By default, all groups start expanded
            expandedGroups.add(nodeId);
          }
        }
      }
      
      log('Detected collapsible groups: ' + JSON.stringify(collapsibleGroups));
    }

    // Render Mermaid diagram
    function renderMermaid() {
      const mermaidDiv = document.getElementById('mermaid-graph');
      const errorDiv = document.getElementById('error-message');
      const rawCode = document.getElementById('raw-code').textContent.trim();
      const uniqueId = 'mermaid-svg-' + Date.now() + '-' + renderCount++;

      // Detect collapsible groups in the diagram
      detectCollapsibleGroups(rawCode);

      // Clear previous content
      mermaidDiv.innerHTML = '';
      errorDiv.style.display = 'none';

      // Render using promise
      mermaid.render(uniqueId, rawCode)
        .then(({ svg }) => {
          mermaidDiv.innerHTML = svg;
          
          // Process the SVG after it's been inserted into the DOM
          const svgElement = mermaidDiv.querySelector('svg');
          if (svgElement) {
            processMermaidSvg(svgElement);
          }
        })
        .catch(error => {
          log('Mermaid rendering failed: ' + error);
          errorDiv.style.display = 'block';
          errorDiv.textContent = error.message;
          
          // Create a <pre> element and set its text content safely
          const preElement = document.createElement('pre');
          preElement.style.color = '#ff7675'; // Apply style directly
          preElement.textContent = rawCode; // Use textContent for safety
          
          // Clear mermaidDiv and append the new <pre> element
          mermaidDiv.innerHTML = ''; // Clear previous attempts
          mermaidDiv.appendChild(preElement);
        });
    }

    // Theme toggle function
    function toggleTheme() {
      const body = document.body;
      const toggleBtn = document.getElementById('theme-toggle');
      const diagramContainer = document.getElementById('diagram-container');
      const header = document.querySelector('header');
      const isDarkMode = body.classList.contains('dark-mode');

      if (isDarkMode) {
        // Switch to Light Mode
        body.classList.remove('dark-mode');
        body.classList.add('light-mode');
        toggleBtn.textContent = 'Switch to Dark Mode';
        toggleBtn.style.background = '#dcdde1';
        toggleBtn.style.color = '#2d3436';
        diagramContainer.style.background = 'rgba(255, 255, 255, 0.8)';
        diagramContainer.style.border = '1px solid rgba(0, 0, 0, 0.1)';
        header.style.color = '#2d3436';
        
        // Update Mermaid theme to light with dark text
        mermaid.initialize({
          theme: 'default',
          themeVariables: {
            nodeBorder: "#2d3436",
            mainBkg: "#f8f9fa",
            nodeTextColor: "#333333",
            fontSize: "16px"
          }
        });
      } else {
        // Switch to Dark Mode
        body.classList.remove('light-mode');
        body.classList.add('dark-mode');
        toggleBtn.textContent = 'Switch to Light Mode';
        toggleBtn.style.background = '#2d3436';
        toggleBtn.style.color = '#ffffff';
        diagramContainer.style.background = 'rgba(255, 255, 255, 0.05)';
        diagramContainer.style.border = '1px solid rgba(255, 255, 255, 0.1)';
        header.style.color = '#ffffff';
        
        // Update Mermaid theme to dark with bright white text
        mermaid.initialize({
          theme: 'dark',
          themeVariables: {
            nodeBorder: "#2d3436",
            mainBkg: "#1e272e",
            nodeTextColor: "#ffffff",
            fontSize: "16px"
          }
        });
      }

      // Re-render diagram after theme change
      renderMermaid();
    }

    // Attach theme toggle event
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  </script>
</body>
</html>`;
}

// Update the generate_diagram tool
server.tool("generate_diagram", "Generate a Mermaid diagram for the current file tree", {
  style: z.enum(['default', 'dependency', 'directory', 'hybrid', 'package-deps']).describe('Diagram style'),
  maxDepth: z.number().optional().describe('Maximum depth for directory trees (1-10)'),
  minImportance: z.number().optional().describe('Only show files above this importance (0-10)'),
  showDependencies: z.boolean().optional().describe('Whether to show dependency relationships'),
  showPackageDeps: z.boolean().optional().describe('Whether to show package dependencies'),
  packageGrouping: z.boolean().optional().describe('Whether to group packages by scope'),
  autoGroupThreshold: z.number().optional().describe("Auto-group nodes when parent has more than this many direct children (default: 8)"),
  excludePackages: z.array(z.string()).optional().describe('Packages to exclude from diagram'),
  includeOnlyPackages: z.array(z.string()).optional().describe('Only include these packages (if specified)'),
  outputPath: z.string().optional().describe('Full path or relative path where to save the diagram file (.mmd or .html)'),
  outputFormat: z.enum(['mmd', 'html']).optional().describe('Output format (mmd or html)'),
  layout: z.object({
    direction: z.enum(['TB', 'BT', 'LR', 'RL']).optional().describe("Graph direction"),
    rankSpacing: z.number().min(10).max(100).optional().describe("Space between ranks"),
    nodeSpacing: z.number().min(10).max(100).optional().describe("Space between nodes")
  }).optional()
}, async (params) => {
  try {
    if (!fileTree) {
      return createMcpResponse("No file tree loaded. Please create or select a file tree first.", true);
    }

    // Use specialized config for package-deps style
    if (params.style === 'package-deps') {
      // Package-deps style should show package dependencies by default
      params.showPackageDeps = params.showPackageDeps ?? true;
      // Default to left-to-right layout for better readability of packages
      if (!params.layout) {
        params.layout = { direction: 'LR' };
      } else if (!params.layout.direction) {
        params.layout.direction = 'LR';
      }
    }

    // Generate the diagram with added autoGroupThreshold parameter
    const generator = new MermaidGenerator(fileTree, {
      style: params.style,
      maxDepth: params.maxDepth,
      minImportance: params.minImportance,
      showDependencies: params.showDependencies,
      showPackageDeps: params.showPackageDeps,
      packageGrouping: params.packageGrouping,
      autoGroupThreshold: params.autoGroupThreshold,
      excludePackages: params.excludePackages,
      includeOnlyPackages: params.includeOnlyPackages,
      layout: params.layout
    });
    const diagram = generator.generate();
    const mermaidContent = diagram.code;

    // Enhanced title based on diagram type
    let titlePrefix = "File Scope Diagram";
    switch (params.style) {
      case 'package-deps':
        titlePrefix = "Package Dependencies";
        break;
      case 'dependency':
        titlePrefix = "Code Dependencies";
        break;
      case 'directory':
        titlePrefix = "Directory Structure";
        break;
      case 'hybrid':
        titlePrefix = "Hybrid View";
        break;
    }

    // Save diagram to file if requested
    if (params.outputPath) {
      const outputFormat = params.outputFormat || 'mmd';
      const baseOutputPath = path.resolve(process.cwd(), params.outputPath);
      const outputDir = path.dirname(baseOutputPath);
      
      log(`[${new Date().toISOString()}] Attempting to save diagram file(s):`);
      log(`[${new Date().toISOString()}] - Base output path: ${baseOutputPath}`);
      log(`[${new Date().toISOString()}] - Output directory: ${outputDir}`);
      log(`[${new Date().toISOString()}] - Output format: ${outputFormat}`);
      
      // Ensure output directory exists
      try {
        await fs.mkdir(outputDir, { recursive: true });
        log(`[${new Date().toISOString()}] Created output directory: ${outputDir}`);
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          log(`[${new Date().toISOString()}] Error creating output directory: ` + err);
          return createMcpResponse(`Failed to create output directory: ${err.message}`, true);
        }
      }

      // Save the appropriate file based on format
      if (outputFormat === 'mmd') {
        // Save Mermaid file
        const mmdPath = baseOutputPath.endsWith('.mmd') ? baseOutputPath : baseOutputPath + '.mmd';
        try {
          await fs.writeFile(mmdPath, mermaidContent, 'utf8');
          log(`[${new Date().toISOString()}] Successfully saved Mermaid file to: ${mmdPath}`);
          
          return createMcpResponse({
            message: `Successfully generated diagram in mmd format`,
            filePath: mmdPath,
            stats: diagram.stats
          });
        } catch (err: any) {
          log(`[${new Date().toISOString()}] Error saving Mermaid file: ` + err);
          return createMcpResponse(`Failed to save Mermaid file: ${err.message}`, true);
        }
      } else if (outputFormat === 'html') {
        // Generate HTML with embedded Mermaid
        const title = `${titlePrefix} - ${path.basename(baseOutputPath)}`;
        const htmlContent = createMermaidHtml(mermaidContent, title);
        
        // Save HTML file
        const htmlPath = baseOutputPath.endsWith('.html') ? baseOutputPath : baseOutputPath + '.html';
        try {
          await fs.writeFile(htmlPath, htmlContent, 'utf8');
          log(`[${new Date().toISOString()}] Successfully saved HTML file to: ${htmlPath}`);
          
          return createMcpResponse({
            message: `Successfully generated diagram in html format`,
            filePath: htmlPath,
            stats: diagram.stats
          });
        } catch (err: any) {
          log(`[${new Date().toISOString()}] Error saving HTML file: ` + err);
          return createMcpResponse(`Failed to save HTML file: ${err.message}`, true);
        }
      }
    }

    // Return both the diagram content and file information
    return createMcpResponse([
      {
        type: "text",
        text: JSON.stringify({
          stats: diagram.stats,
          style: diagram.style,
          generated: diagram.timestamp
        }, null, 2)
      },
      {
        type: "resource" as const,
        resource: {
          uri: 'data:text/x-mermaid;base64,' + Buffer.from(mermaidContent).toString('base64'),
          text: mermaidContent,
          mimeType: "text/x-mermaid"
        }
      }
    ]);
  } catch (error) {
    log('Error generating diagram: ' + error);
    return createMcpResponse(`Failed to generate diagram: ` + error, true);
  }
});

// Register a new tool to exclude and remove a file or pattern
server.tool("exclude_and_remove", "Exclude and remove a file or pattern from the file tree", {
  filepath: z.string().describe("The path or pattern of the file to exclude and remove")
}, async (params: { filepath: string }) => {
  try {
    if (!fileTree || !currentConfig) {
      await buildFileTree(DEFAULT_CONFIG);
    }

    log('exclude_and_remove called with params: ' + JSON.stringify(params));
    log('Current file tree root: ' + fileTree?.path);

    // Use the excludeAndRemoveFile function
    await excludeAndRemoveFile(params.filepath, fileTree!, getProjectRoot());

    // Save the updated tree
    if (currentConfig) {
      await saveFileTree(currentConfig, fileTree!);
    }

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