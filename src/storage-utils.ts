import * as fs from 'fs/promises';
import * as path from 'path';
import * as fsSync from 'fs';
import { FileNode, FileTreeConfig, FileTreeStorage } from './types.js';
import { getProjectRoot } from './global-state.js';

// Keep a map of all loaded file trees
const loadedTrees = new Map<string, FileTreeStorage>();

/**
 * Normalizes paths to use forward slashes and handles URL encoding
 * Works with both relative and absolute paths on any platform
 * @param inputPath The path to normalize
 * @param baseDirectory Optional base directory to resolve relative paths against (defaults to project root)
 */
export function normalizeAndResolvePath(inputPath: string, baseDirectory?: string): string {
  try {
    // Handle special case for current directory
    if (inputPath === '.' || inputPath === './') {
      return getProjectRoot().replace(/\\/g, '/').replace(/\/+/g, '/');
    }
    
    // Decode URL encoding if present
    const decoded = inputPath.includes('%') ? decodeURIComponent(inputPath) : inputPath;
    
    // Handle Windows paths with drive letters that may start with a slash
    const cleanPath = decoded.match(/^\/[a-zA-Z]:/) ? decoded.substring(1) : decoded;
    
    // If it's already an absolute path, normalize it directly
    if (path.isAbsolute(cleanPath)) {
      return cleanPath.replace(/\\/g, '/').replace(/\/+/g, '/');
    }
    
    // For relative paths, resolve against the base directory
    const base = baseDirectory || getProjectRoot();
    console.error(`Resolving relative path ${cleanPath} against base ${base}`);
    const fullPath = path.resolve(base, cleanPath);
    
    // Normalize to forward slashes for consistency and remove duplicate slashes
    return fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
  } catch (error) {
    console.error(`Failed to normalize path: ${inputPath}`, error);
    // Return the input as fallback
    return inputPath;
  }
}

/**
 * Ensures a directory exists, creating it if necessary
 */
async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // EEXIST is fine - directory already exists
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Creates a new file tree configuration
 */
export async function createFileTreeConfig(filename: string, baseDirectory: string): Promise<FileTreeConfig> {
  console.error('Creating file tree config...');
  console.error('Input filename:', filename);
  console.error('Input baseDirectory:', baseDirectory);
  
  // Handle special case for current directory
  if (baseDirectory === '.' || baseDirectory === './') {
    baseDirectory = getProjectRoot();
    console.error('Resolved "." to project root:', baseDirectory);
  }
  
  // Normalize paths
  const normalizedBase = normalizeAndResolvePath(baseDirectory);
  console.error('Normalized base directory:', normalizedBase);
  
  // For the filename, we only want the basename, not the full path
  const basename = path.basename(filename);
  const cleanFilename = basename.endsWith('.json') ? basename : `${basename}.json`;
  console.error('Clean filename:', cleanFilename);
  
  // Ensure the base directory exists
  console.error('Creating base directory if needed:', normalizedBase);
  await ensureDirectoryExists(normalizedBase);
  
  const config = {
    filename: cleanFilename,
    baseDirectory: normalizedBase,
    projectRoot: getProjectRoot(),  // Always use the global project root
    lastUpdated: new Date()
  };
  console.error('Created config:', config);
  
  return config;
}

/**
 * Saves a file tree to disk
 */
export async function saveFileTree(config: FileTreeConfig, fileTree: FileNode): Promise<void> {
  try {
    console.error('Save file tree called with config:', JSON.stringify(config, null, 2));
    
    // Save in the current working directory
    const filePath = path.join(process.cwd(), config.filename);
    console.error('Current working directory:', process.cwd());
    console.error('Filename:', config.filename);
    console.error('Final path:', filePath);
    
    const data = {
      config: {
        ...config,
        lastUpdated: new Date()
      },
      fileTree
    };
    
    console.error('Writing file...');
    fsSync.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    console.error('Successfully saved file tree');
  } catch (error) {
    console.error('Error saving file tree:', error);
    console.error('Error details:', error instanceof Error ? error.stack : String(error));
    throw error;
  }
}

/**
 * Loads a file tree from disk, or returns null if it doesn't exist
 */
export async function loadFileTree(filename: string): Promise<FileTreeStorage> {
  try {
    // Check if we have a cached version
    const cached = loadedTrees.get(filename);
    if (cached) {
      console.error(`Using cached file tree for ${filename}`);
      return cached;
    }

    // Load from file
    const filePath = path.resolve(process.cwd(), filename);
    console.error(`Loading file tree from: ${filePath}`);
    
    const content = await fs.readFile(filePath, 'utf-8');
    const storage: FileTreeStorage = JSON.parse(content);
    
    // Update the cache
    loadedTrees.set(filename, storage);
    
    return storage;
  } catch (error) {
    console.error(`Failed to load file tree from ${filename}:`, error);
    throw error;
  }
}

/**
 * Gets a list of all saved file trees
 */
export async function listSavedFileTrees(): Promise<{type: "text", text: string}[]> {
  try {
    const files = await fs.readdir(process.cwd());
    const jsonFiles = files.filter(file => file.endsWith('.json'));
    return jsonFiles.map(file => ({
      type: 'text' as const,
      text: file
    }));
  } catch (error) {
    console.error('Error listing file trees:', error);
    return [];
  }
}

/**
 * Updates a specific file node in the tree
 * Returns true if the node was found and updated, false otherwise
 */
export function updateFileNode(fileTree: FileNode, filePath: string, updates: Partial<FileNode>): boolean {
  // Normalize the path for consistent comparison
  const normalizedInputPath = filePath.split(path.sep).join('/');
  
  // Function to recursively find and update the node
  function findAndUpdate(node: FileNode): boolean {
    const normalizedNodePath = node.path.split(path.sep).join('/');
    
    // Try exact match
    if (normalizedNodePath === normalizedInputPath) {
      // Found the node, apply updates
      Object.assign(node, updates);
      return true;
    }
    
    // Try case-insensitive match for Windows compatibility
    if (normalizedNodePath.toLowerCase() === normalizedInputPath.toLowerCase()) {
      // Found the node, apply updates
      Object.assign(node, updates);
      return true;
    }
    
    // Check if the path ends with our target (to handle relative vs absolute paths)
    if (normalizedInputPath.endsWith(normalizedNodePath) || normalizedNodePath.endsWith(normalizedInputPath)) {
      // Found the node, apply updates
      Object.assign(node, updates);
      return true;
    }
    
    // Check children if this is a directory
    if (node.isDirectory && node.children) {
      for (const child of node.children) {
        if (findAndUpdate(child)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  return findAndUpdate(fileTree);
}

/**
 * Retrieves a specific file node from the tree
 */
export function getFileNode(fileTree: FileNode, filePath: string): FileNode | null {
  // Normalize the path for consistent comparison
  const normalizedInputPath = filePath.split(path.sep).join('/');
  
  // Function to recursively find the node
  function findNode(node: FileNode): FileNode | null {
    const normalizedNodePath = node.path.split(path.sep).join('/');
    
    // Try exact match
    if (normalizedNodePath === normalizedInputPath) {
      return node;
    }
    
    // Try case-insensitive match for Windows compatibility
    if (normalizedNodePath.toLowerCase() === normalizedInputPath.toLowerCase()) {
      return node;
    }
    
    // Check if the path ends with our target (to handle relative vs absolute paths)
    if (normalizedInputPath.endsWith(normalizedNodePath) || normalizedNodePath.endsWith(normalizedInputPath)) {
      return node;
    }
    
    // Check children if this is a directory
    if (node.isDirectory && node.children) {
      for (const child of node.children) {
        const found = findNode(child);
        if (found) {
          return found;
        }
      }
    }
    
    return null;
  }
  
  return findNode(fileTree);
} 