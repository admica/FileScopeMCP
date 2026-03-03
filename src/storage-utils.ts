import * as fs from "fs/promises";
import * as path from "path";
import * as fsSync from "fs";
import { FileNode, FileTreeConfig, FileTreeStorage } from "./types.js";
import { getProjectRoot } from "./global-state.js";
import {
  getFile,
  upsertFile,
  getAllFiles,
  getChildren,
} from "./db/repository.js";

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
    projectRoot: getProjectRoot(),
    lastUpdated: new Date()
  };
  console.error('Created config:', config);

  return config;
}

/**
 * Saves a file tree to SQLite (replaces JSON write).
 * Bulk-upserts all nodes from the in-memory tree.
 * Signature kept for backward compatibility.
 */
export async function saveFileTree(config: FileTreeConfig, fileTree: FileNode): Promise<void> {
  try {
    console.error('Saving file tree to SQLite...');
    // Flatten the tree and upsert all nodes
    function collectNodes(node: FileNode): FileNode[] {
      const results: FileNode[] = [node];
      for (const child of node.children ?? []) {
        results.push(...collectNodes(child));
      }
      return results;
    }
    const allNodes = collectNodes(fileTree);
    for (const node of allNodes) {
      upsertFile(node);
    }
    console.error(`Successfully saved ${allNodes.length} nodes to SQLite`);
  } catch (error) {
    console.error('Error saving file tree to SQLite:', error);
    console.error('Error details:', error instanceof Error ? error.stack : String(error));
    throw error;
  }
}

/**
 * Loads a file tree from SQLite (replaces JSON read).
 * Reconstructs a FileTreeStorage with a nested FileNode tree.
 * Signature kept for backward compatibility.
 */
export async function loadFileTree(filename: string): Promise<FileTreeStorage> {
  try {
    console.error(`Loading file tree from SQLite (filename param ignored: ${filename})`);
    const allNodes = getAllFiles();
    if (allNodes.length === 0) {
      throw new Error('No files in SQLite database');
    }

    // Build a map for O(1) lookup by path
    const nodeMap = new Map<string, FileNode>();
    for (const node of allNodes) {
      nodeMap.set(node.path, { ...node, children: node.isDirectory ? [] : undefined });
    }

    // Reconstruct tree: assign each node to its parent
    let root: FileNode | null = null;
    for (const node of nodeMap.values()) {
      const parentPath = node.path.substring(0, node.path.lastIndexOf('/'));
      const parentNode = nodeMap.get(parentPath);
      if (parentNode && parentNode.isDirectory) {
        if (!parentNode.children) parentNode.children = [];
        parentNode.children.push(node);
      } else {
        // No parent found — this is (or is a candidate for) the root
        if (!root || node.path.length < root.path.length) {
          root = node;
        }
      }
    }

    if (!root) {
      throw new Error('Could not determine root node from SQLite data');
    }

    const config = new (await import('./types.js')).FileTreeConfig();
    config.filename = filename;
    config.baseDirectory = root.path;
    config.projectRoot = getProjectRoot();
    config.lastUpdated = new Date();

    return { config, fileTree: root };
  } catch (error) {
    console.error(`Failed to load file tree from SQLite:`, error);
    throw error;
  }
}

/**
 * Gets a list of all saved file trees.
 * Now returns a single entry representing the SQLite database.
 */
export async function listSavedFileTrees(): Promise<{type: "text", text: string}[]> {
  try {
    const projectRoot = getProjectRoot();
    const dbPath = path.join(projectRoot, '.filescope.db');
    if (fsSync.existsSync(dbPath)) {
      return [{ type: 'text' as const, text: '.filescope.db' }];
    }
    return [];
  } catch (error) {
    console.error('Error listing file trees:', error);
    return [];
  }
}

/**
 * Updates a specific file node in the tree AND persists to SQLite.
 * Returns true if the node was found and updated, false otherwise.
 */
export function updateFileNode(fileTree: FileNode, filePath: string, updates: Partial<FileNode>): boolean {
  // Normalize the path for consistent comparison
  const normalizedInputPath = filePath.split(path.sep).join('/');

  // Function to recursively find and update the node
  function findAndUpdate(node: FileNode): boolean {
    const normalizedNodePath = node.path.split(path.sep).join('/');

    // Try exact match
    if (normalizedNodePath === normalizedInputPath) {
      Object.assign(node, updates);
      // Persist to SQLite
      upsertFile(node);
      return true;
    }

    // Try case-insensitive match for Windows compatibility
    if (normalizedNodePath.toLowerCase() === normalizedInputPath.toLowerCase()) {
      Object.assign(node, updates);
      upsertFile(node);
      return true;
    }

    // Check if the path ends with our target (to handle relative vs absolute paths)
    if (normalizedInputPath.endsWith(normalizedNodePath) || normalizedNodePath.endsWith(normalizedInputPath)) {
      Object.assign(node, updates);
      upsertFile(node);
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
 * Retrieves a specific file node from SQLite by path.
 * Falls back to in-memory tree traversal for directories (not stored with children).
 */
export function getFileNode(fileTree: FileNode, filePath: string): FileNode | null {
  // Try SQLite first for file nodes
  const dbNode = getFile(filePath);
  if (dbNode) return dbNode;

  // Normalize the path for consistent comparison
  const normalizedInputPath = filePath.split(path.sep).join('/');

  // Function to recursively find the node in-memory (for directories)
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

/**
 * No-op: cache has been removed. SQLite is the single source of truth.
 * Kept for backward compatibility.
 */
export function clearTreeCache(): void {
  console.error('clearTreeCache: no-op (SQLite is source of truth)');
}
