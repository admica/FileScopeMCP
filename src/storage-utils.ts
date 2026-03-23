import * as fs from "fs/promises";
import * as path from "path";
import * as fsSync from "fs";
import { FileNode, FileTreeConfig, FileTreeStorage } from "./types.js";
import { getProjectRoot } from "./global-state.js";
import {
  getFile,
  upsertFile,
  getAllFiles,
} from "./db/repository.js";
import { error as logError, info as logInfo, debug as logDebug } from "./logger.js";
import { canonicalizePath } from './file-utils.js';

// Re-export canonicalizePath for direct usage
export { canonicalizePath } from './file-utils.js';

// Re-export for backward compatibility — callers should migrate to canonicalizePath
export { canonicalizePath as normalizeAndResolvePath } from './file-utils.js';

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
  logDebug('Creating file tree config...');
  logDebug('Input filename:', filename);
  logDebug('Input baseDirectory:', baseDirectory);

  // Handle special case for current directory
  if (baseDirectory === '.' || baseDirectory === './') {
    baseDirectory = getProjectRoot();
    logDebug('Resolved "." to project root:', baseDirectory);
  }

  // Normalize paths (resolve against project root for relative paths)
  const normalizedBase = canonicalizePath(baseDirectory, getProjectRoot());
  logDebug('Normalized base directory:', normalizedBase);

  // For the filename, we only want the basename, not the full path
  const basename = path.basename(filename);
  const cleanFilename = basename.endsWith('.json') ? basename : `${basename}.json`;
  logDebug('Clean filename:', cleanFilename);

  // Ensure the base directory exists
  logDebug('Creating base directory if needed:', normalizedBase);
  await ensureDirectoryExists(normalizedBase);

  const config = {
    filename: cleanFilename,
    baseDirectory: normalizedBase,
    projectRoot: getProjectRoot(),
    lastUpdated: new Date()
  };
  logDebug('Created config:', config);

  return config;
}

/**
 * Saves a file tree to SQLite (replaces JSON write).
 * Bulk-upserts all nodes from the in-memory tree.
 * Signature kept for backward compatibility.
 */
export async function saveFileTree(config: FileTreeConfig, fileTree: FileNode): Promise<void> {
  try {
    logInfo('Saving file tree to SQLite...');
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
    logInfo(`Successfully saved ${allNodes.length} nodes to SQLite`);
  } catch (err) {
    logError('Error saving file tree to SQLite:', err);
    logError('Error details:', err instanceof Error ? err.stack : String(err));
    throw err;
  }
}

/**
 * Loads a file tree from SQLite (replaces JSON read).
 * Reconstructs a FileTreeStorage with a nested FileNode tree.
 * Signature kept for backward compatibility.
 */
export async function loadFileTree(filename: string): Promise<FileTreeStorage> {
  try {
    logDebug(`Loading file tree from SQLite (filename param ignored: ${filename})`);
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
  } catch (err) {
    logError(`Failed to load file tree from SQLite:`, err);
    throw err;
  }
}

/**
 * Gets a list of all saved file trees.
 * Now returns a single entry representing the SQLite database.
 */
export async function listSavedFileTrees(): Promise<{type: "text", text: string}[]> {
  try {
    const projectRoot = getProjectRoot();
    const dbPath = path.join(projectRoot, '.filescope', 'data.db');
    if (fsSync.existsSync(dbPath)) {
      return [{ type: 'text' as const, text: '.filescope/data.db' }];
    }
    return [];
  } catch (err) {
    logError('Error listing file trees:', err);
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
  logDebug('clearTreeCache: no-op (SQLite is source of truth)');
}
