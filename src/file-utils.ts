import fs from 'fs';
import * as fsPromises from 'fs/promises';
import path from 'path';
import * as fsSync from "fs";
import { FileNode } from "./types.js";
import { normalizeAndResolvePath } from "./storage-utils.js";

/**
 * Normalizes a file path for consistent comparison across platforms
 * Handles Windows and Unix paths, relative and absolute paths
 */
export function normalizePath(filepath: string): string {
  if (!filepath) return '';
  
  try {
    // Handle URL-encoded paths
    const decoded = filepath.includes('%') ? decodeURIComponent(filepath) : filepath;
    
    // Handle Windows paths with drive letters that may start with a slash
    const cleanPath = decoded.match(/^\/[a-zA-Z]:/) ? decoded.substring(1) : decoded;
    
    // Handle Windows backslashes by converting to forward slashes
    // Note: we need to escape the backslash in regex since it's a special character
    const forwardSlashed = cleanPath.replace(/\\/g, '/');
    
    // Remove any double quotes that might be present
    const noQuotes = forwardSlashed.replace(/"/g, '');
    
    // Remove duplicate slashes
    const deduped = noQuotes.replace(/\/+/g, '/');
    
    // Remove trailing slash
    return deduped.endsWith('/') ? deduped.slice(0, -1) : deduped;
  } catch (error) {
    console.error(`Failed to normalize path: ${filepath}`, error);
    // Return original as fallback
    return filepath;
  }
}

export function toPlatformPath(normalizedPath: string): string {
  return normalizedPath.split('/').join(path.sep);
}

const SUPPORTED_EXTENSIONS = [".py", ".c", ".cpp", ".h", ".rs", ".lua", ".js", ".jsx", ".ts", ".tsx", ".zig"];
const IMPORT_PATTERNS: { [key: string]: RegExp } = {
  '.js': /(?:import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?["']([^"']+)["'])|(?:require\(["']([^"']+)["']\))|(?:import\s*\(["']([^"']+)["']\))/g,
  '.jsx': /(?:import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?["']([^"']+)["'])|(?:require\(["']([^"']+)["']\))|(?:import\s*\(["']([^"']+)["']\))/g,
  '.ts': /(?:import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?["']([^"']+)["'])|(?:require\(["']([^"']+)["']\))|(?:import\s*\(["']([^"']+)["']\))/g,
  '.tsx': /(?:import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?["']([^"']+)["'])|(?:require\(["']([^"']+)["']\))|(?:import\s*\(["']([^"']+)["']\))/g,
  '.py': /(?:import\s+[\w.]+|from\s+[\w.]+\s+import\s+[\w*]+)/g,
  '.c': /#include\s+["<][^">]+[">]/g,
  '.cpp': /#include\s+["<][^">]+[">]/g,
  '.h': /#include\s+["<][^">]+[">]/g,
  '.rs': /use\s+[\w:]+|mod\s+\w+/g,
  '.lua': /require\s*\(['"][^'"]+['"]\)/g,
  '.zig': /@import\s*\(['"][^'"]+['"]\)|const\s+[\w\s,{}]+\s*=\s*@import\s*\(['"][^'"]+['"]\)/g,
};

// Helper to resolve TypeScript/JavaScript import paths
function resolveImportPath(importPath: string, currentFilePath: string, baseDir: string): string {
  console.error(`Resolving import path: ${importPath} from file: ${currentFilePath}`);
  
  // For TypeScript files, if the import ends with .js, convert it to .ts
  if (currentFilePath.endsWith('.ts') || currentFilePath.endsWith('.tsx')) {
    if (importPath.endsWith('.js')) {
      importPath = importPath.replace(/\.js$/, '.ts');
    }
  }
  
  // Handle relative imports
  if (importPath.startsWith('.')) {
    const resolvedPath = path.resolve(path.dirname(currentFilePath), importPath);
    console.error(`Resolved relative import to: ${resolvedPath}`);
    return path.normalize(resolvedPath);
  }

  // Handle absolute imports (from project root)
  if (importPath.startsWith('/')) {
    const resolvedPath = path.join(baseDir, importPath);
    console.error(`Resolved absolute import to: ${resolvedPath}`);
    return path.normalize(resolvedPath);
  }

  // Handle package imports
  const nodeModulesPath = path.join(baseDir, 'node_modules', importPath);
  console.error(`Resolved package import to: ${nodeModulesPath}`);
  return path.normalize(nodeModulesPath);
}

function calculateInitialImportance(filePath: string, baseDir: string): number {
  let importance = 0;
  const ext = path.extname(filePath);
  const relativePath = path.relative(baseDir, filePath);
  const parts = relativePath.split(path.sep);
  const fileName = path.basename(filePath, ext);

  // Base importance by file type
  switch (ext) {
    case '.ts':
    case '.tsx':
      importance += 3;
      break;
    case '.js':
    case '.jsx':
      importance += 2;
      break;
    case '.json':
      if (fileName === 'package' || fileName === 'tsconfig') {
        importance += 3;
      } else {
        importance += 1;
      }
      break;
    case '.md':
      if (fileName.toLowerCase() === 'readme') {
        importance += 2;
      } else {
        importance += 1;
      }
      break;
    default:
      importance += 0;
  }

  // Importance by location
  if (parts[0] === 'src') {
    importance += 2;
  } else if (parts[0] === 'test' || parts[0] === 'tests') {
    importance += 1;
  }

  // Importance by name significance
  const significantNames = ['index', 'main', 'server', 'app', 'config', 'types', 'utils'];
  if (significantNames.includes(fileName.toLowerCase())) {
    importance += 2;
  }

  // Cap importance at 10
  return Math.min(importance, 10);
}

// Helper to extract import path from different import styles
function extractImportPath(importStatement: string): string | null {
  // Try to match dynamic imports first
  const dynamicMatch = importStatement.match(/import\s*\(["']([^"']+)["']\)/);
  if (dynamicMatch) {
    return dynamicMatch[1];
  }
  
  // Try to match require statements
  const requireMatch = importStatement.match(/require\(["']([^"']+)["']\)/);
  if (requireMatch) {
    return requireMatch[1];
  }
  
  // Try to match regular imports
  const importMatch = importStatement.match(/from\s+["']([^"']+)["']/);
  if (importMatch) {
    return importMatch[1];
  }
  
  // Try to match direct imports
  const directMatch = importStatement.match(/import\s+["']([^"']+)["']/);
  if (directMatch) {
    return directMatch[1];
  }
  
  return null;
}

export async function scanDirectory(baseDir: string, currentDir: string = baseDir): Promise<FileNode> {
  console.error(`Scanning directory: ${currentDir}`);
  const normalizedBaseDir = path.normalize(baseDir);
  const normalizedDirPath = path.normalize(currentDir);

  // Create the root directory node
  const rootNode: FileNode = {
    path: normalizedDirPath,
    name: path.basename(normalizedDirPath),
    isDirectory: true,
    children: []
  };

  // Check if directory exists
  try {
    await fsPromises.stat(normalizedDirPath);
  } catch (e) {
    console.error(`Directory ${normalizedDirPath} does not exist`, e);
    return rootNode;
  }

  const entries = await fsPromises.readdir(normalizedDirPath, { withFileTypes: true });
  
  // Process each entry
  for (const entry of entries) {
    const fullPath = path.join(normalizedDirPath, entry.name);
    const normalizedFullPath = path.normalize(fullPath);

    if (entry.isDirectory()) {
      // Skip node_modules and .git directories
      if (entry.name === 'node_modules' || entry.name === '.git') {
        console.error(`Skipping directory: ${entry.name}`);
        continue;
      }
      const childNode = await scanDirectory(normalizedBaseDir, fullPath);
      rootNode.children?.push(childNode);
    } else {
      console.error(`Processing file: ${normalizedFullPath}`);
      const ext = path.extname(entry.name);
      const importPattern = IMPORT_PATTERNS[ext];
      const dependencies: string[] = [];
      const packageDependencies: string[] = [];

      if (importPattern) {
        try {
          const content = await fsPromises.readFile(fullPath, 'utf-8');
          const matches = content.match(importPattern);
          console.error(`Found ${matches?.length || 0} potential imports in ${normalizedFullPath}`);

          if (matches) {
            for (const match of matches) {
              const importPath = extractImportPath(match);
              if (importPath) {
                try {
                  let resolvedPath;
                  if (['.js', '.jsx', '.ts', '.tsx'].includes(ext)) {
                    resolvedPath = resolveImportPath(importPath, normalizedFullPath, normalizedBaseDir);
                  } else {
                    resolvedPath = path.resolve(path.dirname(fullPath), importPath);
                  }
                  console.error(`Resolved path: ${resolvedPath}`);
                  
                  // Handle package imports
                  if (resolvedPath.includes('node_modules') || importPath.startsWith('@') || (!importPath.startsWith('.') && !importPath.startsWith('/'))) {
                    packageDependencies.push(resolvedPath);
                    continue;
                  }
                  
                  // Try with different extensions for TypeScript/JavaScript files
                  const possibleExtensions = ['.ts', '.tsx', '.js', '.jsx', ''];
                  for (const extension of possibleExtensions) {
                    const pathToCheck = resolvedPath + extension;
                    try {
                      await fsPromises.access(pathToCheck);
                      console.error(`Found existing path: ${pathToCheck}`);
                      dependencies.push(pathToCheck);
                      break;
                    } catch {
                      // File doesn't exist with this extension, try next one
                    }
                  }
                } catch (error) {
                  console.error(`Failed to resolve path for ${importPath}:`, error);
                }
              }
            }
          }
        } catch (error) {
          console.error(`Failed to read or process file ${fullPath}:`, error);
        }
      }

      const fileNode: FileNode = {
        path: normalizedFullPath,
        name: entry.name,
        isDirectory: false,
        importance: calculateInitialImportance(normalizedFullPath, normalizedBaseDir),
        dependencies: dependencies,
        packageDependencies: packageDependencies,
        dependents: [],
        summary: undefined
      };
      rootNode.children?.push(fileNode);
    }
  }

  return rootNode;
}

// Find all file nodes in the tree
function getAllFileNodes(root: FileNode): FileNode[] {
  const results: FileNode[] = [];
  
  function traverse(node: FileNode) {
    if (!node.isDirectory) {
      results.push(node);
    }
    if (node.children) {
      node.children.forEach(traverse);
    }
  }
  
  traverse(root);
  return results;
}

// Build the reverse dependency map (dependents)
export function buildDependentMap(root: FileNode) {
  const allFiles = getAllFileNodes(root);
  const pathToNodeMap = new Map<string, FileNode>();
  
  // First, create a map of all file paths to their nodes
  allFiles.forEach(file => {
    pathToNodeMap.set(file.path, file);
  });
  
  // Then, process dependencies to create the reverse mapping
  allFiles.forEach(file => {
    if (file.dependencies && file.dependencies.length > 0) {
      file.dependencies.forEach(depPath => {
        const depNode = pathToNodeMap.get(depPath);
        if (depNode) {
          if (!depNode.dependents) {
            depNode.dependents = [];
          }
          if (!depNode.dependents.includes(file.path)) {
            depNode.dependents.push(file.path);
          }
        }
      });
    }
  });
}

export function calculateImportance(node: FileNode): void {
  if (!node.isDirectory) {
    // Start with initial importance
    let importance = node.importance || calculateInitialImportance(node.path, process.cwd());
    
    // Add importance based on number of dependents (files that import this file)
    if (node.dependents && node.dependents.length > 0) {
      importance += Math.min(node.dependents.length, 3);
    }
    
    // Add importance based on number of local dependencies (files this file imports)
    if (node.dependencies && node.dependencies.length > 0) {
      importance += Math.min(node.dependencies.length, 2);
    }
    
    // Add importance based on number of package dependencies
    if (node.packageDependencies && node.packageDependencies.length > 0) {
      // Add more importance for SDK dependencies
      const sdkDeps = node.packageDependencies.filter(dep => dep.includes('@modelcontextprotocol/sdk'));
      const otherDeps = node.packageDependencies.filter(dep => !dep.includes('@modelcontextprotocol/sdk'));
      
      importance += Math.min(sdkDeps.length, 2); // SDK dependencies are more important
      importance += Math.min(otherDeps.length, 1); // Other package dependencies
    }
    
    // Cap importance at 10
    node.importance = Math.min(importance, 10);
  }
  
  // Recursively calculate importance for children
  if (node.children) {
    for (const child of node.children) {
      calculateImportance(child);
    }
  }
}

// Add a function to manually set importance
export function setFileImportance(fileTree: FileNode, filePath: string, importance: number): boolean {
  const normalizedInputPath = normalizePath(filePath);
  console.error(`Setting importance for file: ${normalizedInputPath}`);
  console.error(`Current tree root: ${fileTree.path}`);
  
  function findAndSetImportance(node: FileNode): boolean {
    const normalizedNodePath = normalizePath(node.path);
    console.error(`Checking node: ${normalizedNodePath}`);
    
    // Try exact match
    if (normalizedNodePath === normalizedInputPath) {
      console.error(`Found exact match for: ${normalizedInputPath}`);
      node.importance = Math.min(10, Math.max(0, importance));
      return true;
    }
    
    // Try case-insensitive match for Windows compatibility
    if (normalizedNodePath.toLowerCase() === normalizedInputPath.toLowerCase()) {
      console.error(`Found case-insensitive match for: ${normalizedInputPath}`);
      node.importance = Math.min(10, Math.max(0, importance));
      return true;
    }
    
    // Check if the path ends with our target (to handle relative vs absolute paths)
    if (normalizedInputPath.endsWith(normalizedNodePath) || normalizedNodePath.endsWith(normalizedInputPath)) {
      console.error(`Found path suffix match for: ${normalizedInputPath}`);
      node.importance = Math.min(10, Math.max(0, importance));
      return true;
    }
    
    // Try with basename
    const inputBasename = normalizedInputPath.split('/').pop() || '';
    const nodeBasename = normalizedNodePath.split('/').pop() || '';
    if (nodeBasename === inputBasename && nodeBasename !== '') {
      console.error(`Found basename match for: ${inputBasename}`);
      node.importance = Math.min(10, Math.max(0, importance));
      return true;
    }
    
    if (node.isDirectory && node.children) {
      for (const child of node.children) {
        if (findAndSetImportance(child)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  return findAndSetImportance(fileTree);
}

export async function createFileTree(baseDir: string): Promise<FileNode> {
  const normalizedBaseDir = path.normalize(baseDir);
  const nodes = await scanDirectory(normalizedBaseDir);
  
  // The first node should be the root directory
  if (nodes.isDirectory && nodes.path === normalizedBaseDir) {
    return nodes;
  }
  
  // If for some reason we didn't get a root node, create one
  const rootNode: FileNode = {
    path: normalizedBaseDir,
    name: path.basename(normalizedBaseDir),
    isDirectory: true,
    children: []
  };
  
  // Add all nodes that don't have a parent
  for (const node of nodes.children || []) {
    if (path.dirname(node.path) === normalizedBaseDir) {
      rootNode.children?.push(node);
    }
  }
  
  return rootNode;
}

export function getFileImportance(fileTree: FileNode, targetPath: string): FileNode | null {
  const normalizedInputPath = normalizePath(targetPath);
  console.error(`Looking for file: ${normalizedInputPath}`);
  
  function findNode(node: FileNode): FileNode | null {
    const normalizedNodePath = normalizePath(node.path);
    console.error(`Checking node: ${normalizedNodePath}`);
    
    // Try exact match
    if (normalizedNodePath === normalizedInputPath) {
      console.error(`Found exact match for: ${normalizedInputPath}`);
      if (node.importance === undefined) {
        calculateImportance(node);
      }
      return node;
    }
    
    // Try case-insensitive match for Windows compatibility
    if (normalizedNodePath.toLowerCase() === normalizedInputPath.toLowerCase()) {
      console.error(`Found case-insensitive match for: ${normalizedInputPath}`);
      if (node.importance === undefined) {
        calculateImportance(node);
      }
      return node;
    }
    
    // Check if the path ends with our target (to handle relative vs absolute paths)
    if (normalizedInputPath.endsWith(normalizedNodePath) || normalizedNodePath.endsWith(normalizedInputPath)) {
      console.error(`Found path suffix match for: ${normalizedInputPath}`);
      if (node.importance === undefined) {
        calculateImportance(node);
      }
      return node;
    }
    
    // Try with basename
    const inputBasename = normalizedInputPath.split('/').pop() || '';
    const nodeBasename = normalizedNodePath.split('/').pop() || '';
    if (nodeBasename === inputBasename && nodeBasename !== '') {
      console.error(`Found basename match for: ${inputBasename}`);
      if (node.importance === undefined) {
        calculateImportance(node);
      }
      return node;
    }
    
    // If this is a directory, check children
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