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
  MermaidDiagramConfig
} from "./types.js";
import { scanDirectory, calculateImportance, setFileImportance, buildDependentMap, normalizePath } from "./file-utils.js";
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

const PROJECT_ROOT_MARKERS = [
  '.cursor/mcp.json',  // Most reliable for Cursor projects
  '.git',              // VCS marker
  'package.json',      // Node.js
  'Cargo.toml',        // Rust
  'go.mod',           // Go
  'build.gradle',     // Java/Android
  'setup.py',         // Python
  'build.zig',        // Zig
  'Makefile',         // Make
  'Gemfile',          // Ruby
  'src'               // Source dir
];

async function detectProjectRoot(startDir: string): Promise<string> {
  let currentDir = startDir;
  let levelsUp = 0;
  const maxLevels = 3;
  
  console.error(`Starting project root detection from: ${currentDir}`);
  
  while (currentDir !== path.parse(currentDir).root && levelsUp <= maxLevels) {
    console.error(`\nChecking directory (level ${levelsUp}): ${currentDir}`);
    
    for (const marker of PROJECT_ROOT_MARKERS) {
      const markerPath = path.join(currentDir, marker);
      try {
        await fs.access(markerPath);
        console.error(`✓ Found project marker: ${marker}`);
        console.error(`✓ Project root identified: ${currentDir}`);
        return currentDir;
      } catch {
        console.error(`✗ No ${marker} found`);
      }
    }
    
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      console.error('! Reached root directory, using start directory');
      return startDir;
    }
    
    currentDir = parentDir;
    levelsUp++;
  }
  
  console.error(`! No project markers found within ${maxLevels} levels, using start directory`);
  return startDir;
}

// Initialize server state
let projectRoot: string;
let fileTree: FileNode | null = null;
let currentConfig: FileTreeConfig | null = null;
let DEFAULT_CONFIG: FileTreeConfig;

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
  console.error('Script path:', scriptPath);
  
  if (scriptPath.includes('FileScopeMCP')) {
    // Extract the project directory from script path
    const match = scriptPath.match(/(.+?FileScopeMCP)/i);
    if (match && match[1]) {
      const mcpDir = match[1];
      try {
        // Verify this directory by checking for package.json
        const packageJsonPath = path.join(mcpDir, 'package.json');
        await fs.access(packageJsonPath);
        console.error(`Verified FileScopeMCP directory: ${mcpDir}`);
        return mcpDir;
      } catch (error) {
        console.error(`Could not verify directory ${mcpDir}`);
      }
    }
  }
  
  // Check environment variables (could be set by Cursor)
  const envProjectDir = process.env.MCP_PROJECT_DIR;
  if (envProjectDir) {
    try {
      await fs.access(envProjectDir);
      console.error(`Found project directory from env: ${envProjectDir}`);
      return envProjectDir;
    } catch (error) {
      console.error(`Invalid environment directory: ${envProjectDir}`);
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
      console.error(`Found project directory in common paths: ${testPath}`);
      return testPath;
    } catch (error) {
      // Path doesn't exist, try next one
    }
  }
  
  return null;
}

// Server initialization
async function initializeServer(): Promise<void> {
  console.error('Starting FileScopeMCP server initialization');
  console.error('Initial working directory:', process.cwd());
  console.error('Command line args:', process.argv);
  
  // Check if we're running as an MCP server for Cursor
  const isMcpServer = isRunningAsMcpServer();
  console.error(`Running as MCP server for Cursor: ${isMcpServer}`);
  
  // Check for command line override first
  const rootArg = process.argv.find(arg => arg.startsWith('--project-root='));
  if (rootArg) {
    projectRoot = rootArg.split('=')[1];
    console.error(`Using provided project root: ${projectRoot}`);
  } else if (isMcpServer) {
    // We're running as an MCP server, so try to find the FileScopeMCP directory
    const mcpDir = await findFileScopeMcpDirectory();
    if (mcpDir) {
      projectRoot = mcpDir;
      console.error(`Using FileScopeMCP directory: ${projectRoot}`);
    } else {
      // Fall back to auto-detection
      projectRoot = await detectProjectRoot(process.cwd());
      console.error(`Falling back to auto-detected project root: ${projectRoot}`);
    }
  } else {
    // Running directly, use current directory
    projectRoot = process.cwd();
    console.error(`Running directly, using current directory: ${projectRoot}`);
  }
  
  console.error(`Final project root set to: ${projectRoot}`);
  
  // Special handling for Cursor IDE integration
  // If we detect we're in Cursor's directory but want to operate on the FileScopeMCP project
  if (projectRoot.includes('Cursor') || projectRoot.includes('cursor')) {
    console.error('Detected we may be running from Cursor IDE directory');
    
    // Try to find the actual FileScopeMCP project directory
    const mcpDir = await findFileScopeMcpDirectory();
    if (mcpDir) {
      projectRoot = mcpDir;
      console.error(`Overriding with FileScopeMCP directory: ${projectRoot}`);
    }
  }
  
  process.chdir(projectRoot);
  console.error(`Changed working directory to: ${process.cwd()}`);
  
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
    console.error("Failed to build default file tree:", error);
  }
}

/**
 * A simple implementation of the Transport interface for stdio
 */
class StdioTransport implements Transport {
  private buffer = new ReadBuffer();
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;

  constructor() {}

  async start(): Promise<void> {
    // Set up stdin to handle messages
    process.stdin.on('data', (chunk) => {
      try {
        this.buffer.append(chunk);
        let message: JSONRPCMessage | null;
        while ((message = this.buffer.readMessage())) {
          if (this.onmessage) {
            this.onmessage(message);
          }
        }
      } catch (error) {
        if (this.onerror) {
          this.onerror(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });

    process.stdin.on('end', () => {
      if (this.onclose) {
        this.onclose();
      }
    });

    // Keep stdin open
    process.stdin.resume();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    // Ensure we only write valid JSON messages to stdout
    const serialized = serializeMessage(message);
    
    // Only log a summary of the message to stderr, not the full content
    // which could interfere with parsing or expose sensitive data
    const isResponse = 'result' in message;
    const msgType = isResponse ? 'response' : 'request';
    const msgId = (message as any).id || 'none';
    
    process.stderr.write(`Sending ${msgType} message (id: ${msgId})\n`);
    
    // Write to stdout without adding an extra newline - the SDK's serializeMessage
    // function handles proper formatting
    process.stdout.write(serialized);
  }

  async close(): Promise<void> {
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
  
  console.error('Finding node:', {
    targetPath: normalizedTargetPath,
    currentNodePath: normalizedNodePath,
    isDirectory: node.isDirectory,
    childCount: node.children?.length
  });
  
  // Try exact match first
  if (normalizedNodePath === normalizedTargetPath) {
    console.error('Found exact matching node');
    return node;
  }
  
  // Try case-insensitive match for Windows compatibility
  if (normalizedNodePath.toLowerCase() === normalizedTargetPath.toLowerCase()) {
    console.error('Found case-insensitive matching node');
    return node;
  }
  
  // Check if the path ends with our target (to handle relative vs absolute paths)
  if (normalizedTargetPath.endsWith(normalizedNodePath) || normalizedNodePath.endsWith(normalizedTargetPath)) {
    console.error('Found path suffix matching node');
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
  console.error(`Found ${results.length} file nodes`);
  return results;
}

// Build or load the file tree
async function buildFileTree(config: FileTreeConfig): Promise<FileNode> {
  console.error('Building file tree with config:', config);
  console.error('Current working directory:', process.cwd());
  
  // First try to load from file
  try {
    const savedTree = await loadFileTree(config.filename);
    if (savedTree) {
      // Use the saved tree
      if (!savedTree.fileTree) {
        console.error('Invalid file tree structure in saved file');
        throw new Error('Invalid file tree structure');
      }
      console.error('Using existing file tree from:', config.filename);
      console.error('Tree root path:', savedTree.fileTree.path);
      fileTree = savedTree.fileTree;
      currentConfig = savedTree.config;
      return fileTree;
    }
  } catch (error) {
    console.error('Failed to load existing file tree:', error);
    // Continue to build new tree
  }

  // If not found or failed to load, build from scratch
  console.error('Building new file tree for directory:', config.baseDirectory);
  fileTree = await scanDirectory(config.baseDirectory);
  if (!fileTree.children || fileTree.children.length === 0) {
    console.error('Failed to scan directory - no children found');
    throw new Error('Failed to scan directory');
  }
  
  console.error('Building dependency map...');
  buildDependentMap(fileTree);
  console.error('Calculating importance values...');
  calculateImportance(fileTree);
  
  // Save to disk
  console.error('Saving file tree to:', config.filename);
  try {
    await saveFileTree(config, fileTree);
    console.error('Successfully saved file tree');
    currentConfig = config;
  } catch (error) {
    console.error('Failed to save file tree:', error);
    throw error;
  }
  
  return fileTree;
}

// Read the content of a file
async function readFileContent(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    console.error(`Failed to read file ${filePath}:`, error);
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
    return createMcpResponse(`Failed to delete ${params.filename}: ${error}`, true);
  }
});

server.tool("create_file_tree", "Create or load a file tree configuration", {
  filename: z.string().describe("Name of the JSON file to store the file tree"),
  baseDirectory: z.string().describe("Base directory to scan for files")
}, async (params: { filename: string, baseDirectory: string }) => {
  console.error('Create file tree called with params:', params);
  console.error('Current working directory:', process.cwd());
  
  try {
    // Ensure we're using paths relative to the current directory
    const relativeFilename = path.isAbsolute(params.filename) 
      ? path.relative(process.cwd(), params.filename) 
      : params.filename;
    console.error('Relative filename:', relativeFilename);
    
    // Handle special case for current directory
    let baseDir = params.baseDirectory;
    if (baseDir === '.' || baseDir === './') {
      baseDir = process.cwd();
      console.error('Resolved "." to current directory:', baseDir);
    }
    
    // Check if the baseDir might be pointing to Cursor IDE directory
    if (baseDir.includes('Cursor') || baseDir.includes('cursor')) {
      console.error('Detected potential Cursor directory in baseDir, trying to find FileScopeMCP project');
      const mcpDir = await findFileScopeMcpDirectory();
      if (mcpDir) {
        console.error(`Overriding baseDir to FileScopeMCP directory: ${mcpDir}`);
        baseDir = mcpDir;
      }
    }
    
    const config = await createFileTreeConfig(relativeFilename, baseDir);
    console.error('Created config:', config);
    
    // Build the tree with the new config, not the default
    const tree = await buildFileTree(config);
    console.error('Built file tree with root path:', tree.path);
    
    // Update global state
    fileTree = tree;
    currentConfig = config;
    
    return createMcpResponse({
      message: `File tree created and stored in ${config.filename}`,
      config
    });
  } catch (error) {
    console.error('Error in create_file_tree:', error);
    return createMcpResponse(`Failed to create file tree: ${error}`, true);
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
  console.error('Get file importance called with params:', params);
  console.error('Current config:', currentConfig);
  console.error('File tree root path:', fileTree?.path);
  
  try {
    if (!fileTree || !currentConfig) {
      console.error('No file tree loaded, building default tree');
      await buildFileTree(DEFAULT_CONFIG);
    }
    
    const normalizedPath = normalizePath(params.filepath);
    console.error('Normalized path:', normalizedPath);
    
    const node = findNode(fileTree!, normalizedPath);
    console.error('Found node:', node ? {
      path: node.path,
      importance: node.importance,
      dependencies: node.dependencies?.length,
      dependents: node.dependents?.length
    } : null);
    
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
    console.error('Error in get_file_importance:', error);
    return createMcpResponse(`Failed to get file importance: ${error}`, true);
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
    return createMcpResponse(`Failed to read file: ${params.filepath} - ${error}`, true);
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
    
    console.error('set_file_importance called with params:', params);
    console.error('Current file tree root:', fileTree?.path);
    
    // Get a list of all files
    const allFiles = getAllFileNodes(fileTree!);
    console.error(`Total files in tree: ${allFiles.length}`);
    
    // First try the findAndSetImportance method
    const wasUpdated = setFileImportance(fileTree!, params.filepath, params.importance);
    
    // If that didn't work, try matching by basename
    if (!wasUpdated) {
      const basename = path.basename(params.filepath);
      console.error(`Looking for file with basename: ${basename}`);
      
      let foundFile = false;
      for (const file of allFiles) {
        const fileBasename = path.basename(file.path);
        console.error(`Checking file: ${file.path} with basename: ${fileBasename}`);
        
        if (fileBasename === basename) {
          console.error(`Found match: ${file.path}`);
          file.importance = Math.min(10, Math.max(0, params.importance));
          foundFile = true;
          break;
        }
      }
      
      if (!foundFile) {
        console.error('File not found by any method');
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
    console.error('Error in set_file_importance:', error);
    return createMcpResponse(`Failed to set file importance: ${error}`, true);
  }
});

// Add a tool to recalculate importance for all files
server.tool("recalculate_importance", "Recalculate importance values for all files based on dependencies", async () => {
  if (!fileTree || !currentConfig) {
    await buildFileTree(DEFAULT_CONFIG);
  }
  
  // Recalculate importance values
  calculateImportance(fileTree!);
  
  // Save the updated tree
  await saveFileTree(currentConfig!, fileTree!);
  
  // Count files with non-zero importance
  const allFiles = getAllFileNodes(fileTree!);
  const filesWithImportance = allFiles.filter(file => (file.importance || 0) > 0);
  
  return createMcpResponse({
    message: "Importance values recalculated",
    totalFiles: allFiles.length,
    filesWithImportance: filesWithImportance.length
  });
});

// Add a debug tool to list all file paths
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

// Add diagram generation tool
server.tool("generate_diagram", "Generate a Mermaid diagram for the current file tree", {
  style: z.enum(['default', 'dependency', 'directory', 'hybrid']).describe('Diagram style'),
  maxDepth: z.number().optional().describe('Maximum depth for directory trees (1-10)'),
  minImportance: z.number().optional().describe('Only show files above this importance (0-10)'),
  showDependencies: z.boolean().optional().describe('Whether to show dependency relationships'),
  outputPath: z.string().optional().describe('Full path or relative path where to save the diagram files (.mmd and/or .png)'),
  outputFormat: z.enum(['mmd', 'png']).optional().describe('Output format (mmd or png)'),
  layout: z.object({
    direction: z.enum(['TB', 'BT', 'LR', 'RL']).optional(),
    rankSpacing: z.number().min(10).max(100).optional(),
    nodeSpacing: z.number().min(10).max(100).optional()
  }).optional()
}, async (params) => {
  try {
    if (!fileTree) {
      return createMcpResponse("No file tree loaded. Please create or select a file tree first.", true);
    }

    // Generate the diagram
    const generator = new MermaidGenerator(fileTree, params);
    const diagram = generator.generate();
    const mermaidContent = diagram.code;

    // Save diagram to file if requested
    if (params.outputPath) {
      const outputFormat = params.outputFormat || 'mmd';
      const baseOutputPath = path.resolve(process.cwd(), params.outputPath);
      const outputDir = path.dirname(baseOutputPath);
      
      process.stderr.write('Attempting to save diagram files:\n');
      process.stderr.write(`- Base output path: ${baseOutputPath}\n`);
      process.stderr.write(`- Output directory: ${outputDir}\n`);
      
      // Ensure output directory exists
      try {
        await fs.mkdir(outputDir, { recursive: true });
        console.error('Created output directory:', outputDir);
      } catch (err: any) {
        if (err.code !== 'EEXIST') {
          console.error('Error creating output directory:', err);
          return createMcpResponse(`Failed to create output directory: ${err.message}`, true);
        }
      }

      // Save the Mermaid file
      const mmdPath = baseOutputPath.endsWith('.mmd') ? baseOutputPath : baseOutputPath + '.mmd';
      try {
        await fs.writeFile(mmdPath, mermaidContent, 'utf8');
        console.error('Successfully saved Mermaid file to:', mmdPath);
      } catch (err: any) {
        console.error('Error saving Mermaid file:', err);
        return createMcpResponse(`Failed to save Mermaid file: ${err.message}`, true);
      }

      // If PNG output is requested, generate using Puppeteer
      if (outputFormat === 'png') {
        const pngPath = baseOutputPath.endsWith('.png') ? baseOutputPath : baseOutputPath + '.png';
        console.error('Attempting to generate PNG:', pngPath);
        
        try {
          // Replace require with dynamic import for ES module compatibility
          const puppeteerModule = await import('puppeteer');
          const puppeteer = puppeteerModule.default;
          process.stderr.write('Successfully imported puppeteer\n');

          // Launch browser with more explicit error handling
          process.stderr.write('Launching browser with custom config...\n');
          const browser = await puppeteer.launch({
            headless: 'new' as any,
            args: [
              '--no-sandbox',
              '--disable-web-security',
              '--disable-setuid-sandbox',
              '--disable-gpu',
              '--disable-dev-shm-usage'
            ],
            ignoreDefaultArgs: ['--disable-extensions'],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            timeout: 30000
          }).catch((err: Error) => {
            process.stderr.write(`Failed to launch browser: ${err}\n`);
            throw err;
          });
          process.stderr.write('Browser launched successfully\n');

          const page = await browser.newPage().catch((err: Error) => {
            process.stderr.write(`Failed to create new page: ${err}\n`);
            throw err;
          });
          process.stderr.write('New page created\n');

          // Set viewport size
          await page.setViewport({
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1
          });
          process.stderr.write('Viewport set\n');

          // Create a simpler, more reliable HTML content
          const html = `
            <!DOCTYPE html>
            <html>
              <head>
                <script src="https://cdn.jsdelivr.net/npm/mermaid@10.9.3/dist/mermaid.min.js"></script>
                <style>
                  body { 
                    background: white;
                    margin: 20px;
                  }
                </style>
              </head>
              <body>
                <div class="mermaid">
${diagram.code}
                </div>
                <script>
                  mermaid.initialize({
                    startOnLoad: true,
                    theme: 'default'
                  });
                </script>
              </body>
            </html>
          `;

          process.stderr.write('Setting page content...\n');
          await page.setContent(html);
          process.stderr.write('Page content set, waiting for rendering...\n');

          // Give the page some time to render
          process.stderr.write('Waiting for rendering to complete...\n');
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Try a different approach to find the SVG - more permissive
          process.stderr.write('Waiting for SVG element using evaluate...\n');
          const svgElement = await page.evaluate(() => {
            const svg = document.querySelector('svg');
            return !!svg;
          });
          
          if (!svgElement) {
            process.stderr.write('No SVG found in page after waiting\n');
            throw new Error('No SVG element found after rendering');
          }
          
          process.stderr.write('SVG element found, taking screenshot of entire page\n');

          // Get the SVG element
          const element = await page.$('svg');
          if (!element) {
            process.stderr.write('Failed to find SVG element after waiting\n');
            throw new Error('Could not find SVG element');
          }
          process.stderr.write('Got SVG element handle\n');

          // Get the bounding box
          const box = await element.boundingBox();
          if (!box) {
            process.stderr.write('Failed to get SVG bounding box\n');
            throw new Error('Could not get SVG bounding box');
          }
          process.stderr.write(`Got bounding box: ${JSON.stringify(box)}\n`);

          // Take screenshot with padding
          process.stderr.write(`Taking screenshot and saving to: ${pngPath}\n`);
          const padding = 20;
          await element.screenshot({
            path: pngPath,
            clip: {
              x: box.x - padding,
              y: box.y - padding,
              width: box.width + (padding * 2),
              height: box.height + (padding * 2)
            },
            omitBackground: true
          });
          process.stderr.write('Screenshot saved successfully\n');

          await browser.close();
          process.stderr.write('Browser closed\n');
        } catch (err) {
          process.stderr.write(`Error generating PNG: ${err}\n`);
          if (err instanceof Error) {
            return createMcpResponse(`Failed to generate PNG: ${err.message}`, true);
          } else {
            return createMcpResponse(`Failed to generate PNG: ${String(err)}`, true);
          }
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
          uri: `data:text/x-mermaid;base64,${Buffer.from(mermaidContent).toString('base64')}`,
          text: mermaidContent,
          mimeType: "text/x-mermaid"
        }
      }
    ]);
  } catch (error) {
    console.error('Error generating diagram:', error);
    return createMcpResponse(`Failed to generate diagram: ${error}`, true);
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
    console.error("Server error:", error);
    process.exit(1);
  }
})();
