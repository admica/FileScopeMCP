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

// Define and set the project root directory
// This helps ensure we're working from the correct directory
let projectRoot = process.cwd();

// If we're in the dist or src directory, go up one level
if (projectRoot.endsWith('dist') || projectRoot.endsWith('src')) {
  projectRoot = path.resolve(projectRoot, '..');
}

// Handle common patterns to detect we're in the wrong directory
// Check if package.json exists to validate project root
if (!fsSync.existsSync(path.join(projectRoot, 'package.json'))) {
  // Try going up one level
  const potentialRoot = path.resolve(projectRoot, '..');
  if (fsSync.existsSync(path.join(potentialRoot, 'package.json'))) {
    projectRoot = potentialRoot;
  }
}

console.error(`Setting project root to: ${projectRoot}`);
process.chdir(projectRoot);

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
    process.stdout.write(serializeMessage(message));
  }

  async close(): Promise<void> {
    process.stdin.pause();
  }
}

// State
let fileTree: FileNode | null = null;
let currentConfig: FileTreeConfig | null = null;

// Default config
const DEFAULT_CONFIG: FileTreeConfig = {
  filename: "FileScopeMCP-tree.json",
  baseDirectory: process.cwd(),
  lastUpdated: new Date()
};

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
  return {
    content: [{
      type: "text",
      text: JSON.stringify(trees, null, 2)
    }]
  };
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
    
    return {
      content: [{
        type: "text",
        text: `Successfully deleted ${normalizedPath}`
      }]
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        content: [{
          type: "text",
          text: `File tree ${params.filename} does not exist`
        }]
      };
    }
    return {
      content: [{
        type: "text",
        text: `Failed to delete ${params.filename}: ${error}`
      }]
    };
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
      
    const config = await createFileTreeConfig(relativeFilename, params.baseDirectory);
    console.error('Created config:', config);
    
    // Build the tree with the new config, not the default
    const tree = await buildFileTree(config);
    console.error('Built file tree with root path:', tree.path);
    
    // Update global state
    fileTree = tree;
    currentConfig = config;
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `File tree created and stored in ${config.filename}`,
          config
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error('Error in create_file_tree:', error);
    return {
      content: [{
        type: "text",
        text: `Failed to create file tree: ${error}`
      }],
      isError: true
    };
  }
});

server.tool("select_file_tree", "Select an existing file tree to work with", {
  filename: z.string().describe("Name of the JSON file containing the file tree")
}, async (params: { filename: string }) => {
  const storage = await loadFileTree(params.filename);
  if (!storage) {
    return {
      content: [{
        type: "text",
        text: `File tree not found: ${params.filename}`
      }],
      isError: true
    };
  }
  
  fileTree = storage.fileTree;
  currentConfig = storage.config;
  
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        message: `File tree loaded from ${params.filename}`,
        config: currentConfig
      }, null, 2)
    }]
  };
});

server.tool("list_files", "List all files in the project with their importance rankings", async () => {
  if (!fileTree) {
    await buildFileTree(DEFAULT_CONFIG);
  }
  return {
    content: [{
      type: "text",
      text: JSON.stringify(fileTree, null, 2)
    }]
  };
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
      return {
        content: [{
          type: "text",
          text: `File not found: ${params.filepath}`
        }],
        isError: true
      };
    }
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          path: node.path,
          importance: node.importance || 0,
          dependencies: node.dependencies || [],
          dependents: node.dependents || [],
          summary: node.summary || null
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error('Error in get_file_importance:', error);
    return {
      content: [{
        type: "text",
        text: `Failed to get file importance: ${error}`
      }],
      isError: true
    };
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
  
  return {
    content: [{
      type: "text",
      text: JSON.stringify(importantFiles, null, 2)
    }]
  };
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
    return {
      content: [{
        type: "text",
        text: `File not found: ${params.filepath}`
      }],
      isError: true
    };
  }
  
  if (!node.summary) {
    return {
      content: [{
        type: "text",
        text: `No summary available for ${params.filepath}`
      }]
    };
  }
  
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        path: node.path,
        summary: node.summary
      }, null, 2)
    }]
  };
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
    return {
      content: [{
        type: "text",
        text: `File not found: ${params.filepath}`
      }],
      isError: true
    };
  }
  
  // Save the updated tree
  await saveFileTree(currentConfig!, fileTree!);
  
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        message: `Summary updated for ${params.filepath}`,
        path: normalizedPath,
        summary: params.summary
      }, null, 2)
    }]
  };
});

// New tool to read a file's content
server.tool("read_file_content", "Read the content of a specific file", {
  filepath: z.string().describe("The path to the file to read")
}, async (params: { filepath: string }) => {
  try {
    const content = await readFileContent(params.filepath);
    
    return {
      content: [{
        type: "text",
        text: content
      }]
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed to read file: ${params.filepath} - ${error}`
      }],
      isError: true
    };
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
        return {
          content: [{
            type: "text",
            text: `File not found: ${params.filepath}`
          }],
          isError: true
        };
      }
    }
    
    // Save the updated tree
    await saveFileTree(currentConfig!, fileTree!);
    
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          message: `Importance updated for ${params.filepath}`,
          path: params.filepath,
          importance: params.importance
        }, null, 2)
      }]
    };
  } catch (error) {
    console.error('Error in set_file_importance:', error);
    return {
      content: [{
        type: "text",
        text: `Failed to set file importance: ${error}`
      }],
      isError: true
    };
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
  
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        message: "Importance values recalculated",
        totalFiles: allFiles.length,
        filesWithImportance: filesWithImportance.length
      }, null, 2)
    }]
  };
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
  
  return {
    content: [{
      type: "text",
      text: JSON.stringify({
        totalFiles: fileDetails.length,
        files: fileDetails
      }, null, 2)
    }]
  };
});

// Add diagram generation tool
server.tool("generate_diagram", "Generate a Mermaid diagram for the current file tree", {
  maxDepth: z.number().min(1).max(10).optional().describe("Maximum depth for directory trees (1-10)"),
  minImportance: z.number().min(0).max(10).optional().describe("Only show files above this importance (0-10)"),
  showDependencies: z.boolean().optional().describe("Whether to show dependency relationships"),
  style: z.enum(['default', 'dependency', 'directory', 'hybrid']).optional().describe("Diagram style"),
  layout: z.object({
    direction: z.enum(['TB', 'BT', 'LR', 'RL']).optional(),
    rankSpacing: z.number().min(10).max(100).optional(),
    nodeSpacing: z.number().min(10).max(100).optional()
  }).optional().describe("Layout configuration"),
  outputFile: z.string().optional().describe("Optional output file name for the diagram")
}, async (params) => {
  try {
    if (!fileTree) {
      return {
        content: [{
          type: "text",
          text: "No file tree loaded. Please create or select a file tree first."
        }],
        isError: true
      };
    }

    // Validate and normalize parameters
    const config: MermaidDiagramConfig = {
      style: params.style || 'hybrid',
      maxDepth: Math.min(Math.max(params.maxDepth || 5, 1), 10),
      minImportance: Math.min(Math.max(params.minImportance || 0, 0), 10),
      showDependencies: params.showDependencies ?? true,
      layout: params.layout || {
        direction: 'TB',
        rankSpacing: 50,
        nodeSpacing: 40
      }
    };

    const generator = new MermaidGenerator(fileTree, config);
    const diagram = generator.generate();

    // Format the Mermaid content
    const mermaidContent = `---
title: File Scope Diagram
---
%%{init: {'theme': 'default'}}%%
${diagram.code}`;

    // Add validation warnings if any limits were adjusted
    const warnings = [];
    if (params.maxDepth && params.maxDepth !== config.maxDepth) {
      warnings.push(`maxDepth adjusted to ${config.maxDepth} (valid range: 1-10)`);
    }
    if (params.minImportance && params.minImportance !== config.minImportance) {
      warnings.push(`minImportance adjusted to ${config.minImportance} (valid range: 0-10)`);
    }

    // Return the diagram content as a data URI resource
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            stats: diagram.stats,
            style: diagram.style,
            generated: diagram.timestamp,
            warnings: warnings.length > 0 ? warnings : undefined
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
      ]
    };
  } catch (error) {
    console.error('Error generating diagram:', error);
    return {
      content: [{
        type: "text",
        text: `Failed to generate diagram: ${error}`
      }],
      isError: true
    };
  }
});

// Start the server
(async () => {
  try {
    // Try to load the default file tree in the background
    buildFileTree(DEFAULT_CONFIG).catch(error => {
      console.error("Failed to build default file tree:", error);
    });

    // Connect to transport
    const transport = new StdioTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Server error:", error);
    process.exit(1);
  }
})();
