import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as fsSync from "fs";
import { FileNode, PackageDependency, FileTreeConfig } from "./types.js";
import { normalizeAndResolvePath } from "./storage-utils.js";
import { getProjectRoot, getConfig } from './global-state.js';
import { saveFileTree } from './storage-utils.js'; // Import saveFileTree

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
  '.jsx': /(?:import\s+(?:[^;]*?)\s+from\s+["']([^"']+)["'])|(?:import\s+["']([^"']+)["'])|(?:require\(["']([^"']+)["']\))|(?:import\s*\(["']([^"']+)["']\))/g,
  '.ts': /(?:import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?["']([^"']+)["'])|(?:require\(["']([^"']+)["']\))|(?:import\s*\(["']([^"']+)["']\))/g,
  '.tsx': /(?:import\s+(?:[^;]*?)\s+from\s+["']([^"']+)["'])|(?:import\s+["']([^"']+)["'])|(?:require\(["']([^"']+)["']\))|(?:import\s*\(["']([^"']+)["']\))/g,
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
  
  // Try to match direct imports (like import 'firebase/auth')
  const directMatch = importStatement.match(/import\s+["']([^"']+)["']/);
  if (directMatch) {
    return directMatch[1];
  }
  
  return null;
}

// Helper to extract package version from package.json if available
async function extractPackageVersion(packageName: string, baseDir: string): Promise<string | undefined> {
  try {
    // Handle scoped packages by getting the basic package name
    let basicPackageName = packageName;
    if (packageName.startsWith('@')) {
      // For scoped packages like @supabase/supabase-js, extract the scope part
      const parts = packageName.split('/');
      if (parts.length > 1) {
        // Keep the scoped name as is
        basicPackageName = packageName;
      }
    } else if (packageName.includes('/')) {
      // For imports like 'firebase/auth', extract the base package
      basicPackageName = packageName.split('/')[0];
    }
    
    const packageJsonPath = path.join(baseDir, 'package.json');
    const content = await fsPromises.readFile(packageJsonPath, 'utf-8');
    const packageData = JSON.parse(content);
    
    // Check both dependencies and devDependencies
    if (packageData.dependencies && packageData.dependencies[basicPackageName]) {
      return packageData.dependencies[basicPackageName];
    }
    
    if (packageData.devDependencies && packageData.devDependencies[basicPackageName]) {
      return packageData.devDependencies[basicPackageName];
    }
    
    return undefined;
  } catch (error) {
    console.error(`Failed to extract package version for ${packageName}:`, error);
    return undefined;
  }
}

// Helper function to check if a path matches any exclude pattern
function isExcluded(filePath: string, baseDir: string): boolean {
  // Add a failsafe check specifically for .git directory
  if (filePath.includes('.git') || path.basename(filePath) === '.git') {
    console.error(`🔴 SPECIAL CASE: .git directory/file detected: ${filePath}`);
    return true;
  }
  
  // Add a failsafe check for node_modules
  if (filePath.includes('node_modules') || path.basename(filePath) === 'node_modules') {
    console.error(`🔴 SPECIAL CASE: node_modules directory/file detected: ${filePath}`);
    return true;
  }
  
  // Add a failsafe check for test_excluded files
  if (filePath.includes('test_excluded') || path.basename(filePath).startsWith('test_excluded')) {
    console.error(`🔴 SPECIAL CASE: test_excluded file detected: ${filePath}`);
    return true;
  }
  
  console.error(`\n===== EXCLUDE CHECK for: ${filePath} =====`);
  
  const config = getConfig();
  if (!config) {
    console.error('❌ ERROR: Config is null! Global state not initialized properly.');
    return false;
  }
  
  if (!config.excludePatterns || config.excludePatterns.length === 0) {
    console.error('❌ WARNING: No exclude patterns found in config!');
    console.error('Config object:', JSON.stringify(config, null, 2));
    return false;
  }

  // Get relative path for matching, normalize to forward slashes for cross-platform consistency
  const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  
  console.error(`📂 Path details:`);
  console.error(`  - Full path: ${filePath}`);
  console.error(`  - Base dir: ${baseDir}`);
  console.error(`  - Relative path: ${relativePath}`);
  console.error(`  - File name: ${fileName}`);
  console.error(`  - Platform: ${process.platform}, path separator: ${path.sep}`);
  
  console.error(`\n🔍 Testing against ${config.excludePatterns.length} exclude patterns...`);
  
  // Special case check for .git and node_modules
  if (relativePath.includes('/.git/') || relativePath === '.git' || 
      fileName === '.git' || relativePath.startsWith('.git/')) {
    console.error(`✅ MATCH! Special case for .git directory detected: ${relativePath}`);
    return true;
  }
  
  if (relativePath.includes('/node_modules/') || relativePath === 'node_modules' || 
      fileName === 'node_modules' || relativePath.startsWith('node_modules/')) {
    console.error(`✅ MATCH! Special case for node_modules directory detected: ${relativePath}`);
    return true;
  }
  
  // Check each exclude pattern
  for (let i = 0; i < config.excludePatterns.length; i++) {
    const pattern = config.excludePatterns[i];
    console.error(`\n  [${i+1}/${config.excludePatterns.length}] Testing pattern: "${pattern}"`);
    
    try {
      const regex = globToRegExp(pattern);
      console.error(`  - Converted to regex: ${regex}`);
      
      // Test against full relative path
      const fullPathMatch = regex.test(relativePath);
      console.error(`  - Match against relative path: ${fullPathMatch ? '✅ YES' : '❌ NO'}`);
      
      if (fullPathMatch) {
        console.error(`✅ MATCH! Path ${relativePath} matches exclude pattern ${pattern}`);
        return true;
      }
      
      // Also test against just the filename for file extension patterns
      if (pattern.startsWith('**/*.') || pattern.includes('/*.')) {
        const filenameMatch = regex.test(fileName);
        console.error(`  - Match against filename only: ${filenameMatch ? '✅ YES' : '❌ NO'}`);
        
        if (filenameMatch) {
          console.error(`✅ MATCH! Filename ${fileName} matches exclude pattern ${pattern}`);
          return true;
        }
      }
    } catch (error) {
      console.error(`  - ❌ ERROR converting pattern to regex: ${error}`);
    }
  }
  
  console.error(`❌ No pattern matches found for ${relativePath}`);
  console.error(`===== END EXCLUDE CHECK =====\n`);
  return false;
}

// Helper function to convert glob pattern to RegExp
function globToRegExp(pattern: string): RegExp {
  console.error(`  Converting glob pattern: ${pattern}`);
  
  // Escape special regex characters except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  console.error(`  - After escaping special chars: ${escaped}`);
  
  // Convert glob patterns to regex patterns
  const converted = escaped
    // Convert ** to special marker
    .replace(/\*\*/g, '__GLOBSTAR__')
    // Convert remaining * to [^/\\]*
    .replace(/\*/g, '[^/\\\\]*')
    // Convert ? to single character match
    .replace(/\?/g, '[^/\\\\]')
    // Convert globstar back to proper pattern
    .replace(/__GLOBSTAR__/g, '.*');
  
  console.error(`  - After pattern conversion: ${converted}`);
  
  // Create regex that matches entire path
  const regex = new RegExp(`^${converted}$`, 'i');
  console.error(`  - Final regex: ${regex}`);
  return regex;
}

export async function scanDirectory(baseDir: string, currentDir: string = baseDir): Promise<FileNode> {
  console.error(`\n📁 SCAN DIRECTORY: ${currentDir}`);
  console.error(`  - Base dir: ${baseDir}`);

  // Handle special case for current directory
  const normalizedBaseDir = path.normalize(baseDir);
  const normalizedDirPath = path.normalize(currentDir);
  
  console.error(`  - Normalized base dir: ${normalizedBaseDir}`);
  console.error(`  - Normalized current dir: ${normalizedDirPath}`);

  // Create root node for this directory
  const rootNode: FileNode = {
    path: normalizedDirPath,
    name: path.basename(normalizedDirPath),
    isDirectory: true,
    children: []
  };

  // Read directory entries
  let entries: fs.Dirent[];
  try {
    entries = await fsPromises.readdir(normalizedDirPath, { withFileTypes: true });
    console.error(`  - Read ${entries.length} entries in directory`);
  } catch (error) {
    console.error(`  - ❌ Error reading directory ${normalizedDirPath}:`, error);
    return rootNode;
  }

  // Process each entry
  let excluded = 0;
  let included = 0;
  let dirProcessed = 0;
  let fileProcessed = 0;
  
  console.error(`\n  Processing ${entries.length} entries in ${normalizedDirPath}...`);
  
  // ==================== CRITICAL CODE ====================
  // Log the global config status before processing entries
  console.error(`\n🔍 BEFORE PROCESSING: Is config loaded? ${getConfig() !== null ? 'YES ✅' : 'NO ❌'}`);
  if (getConfig()) {
    const excludePatternsLength = getConfig()?.excludePatterns?.length || 0;
    console.error(`  - Exclude patterns count: ${excludePatternsLength}`);
    if (excludePatternsLength > 0) {
      console.error(`  - First few patterns: ${getConfig()?.excludePatterns?.slice(0, 3).join(', ')}`);
    }
  }
  // ======================================================
  
  for (const entry of entries) {
    const fullPath = path.join(normalizedDirPath, entry.name);
    const normalizedFullPath = path.normalize(fullPath);
    
    console.error(`\n  Entry: ${entry.name} (${entry.isDirectory() ? 'directory' : 'file'})`);
    console.error(`  - Full path: ${normalizedFullPath}`);

    // Here's the critical exclusion check
    console.error(`  🔍 Checking if path should be excluded: ${normalizedFullPath}`);
    const shouldExclude = isExcluded(normalizedFullPath, normalizedBaseDir);
    console.error(`  🔍 Exclusion check result: ${shouldExclude ? 'EXCLUDE ✅' : 'INCLUDE ❌'}`);
    
    if (shouldExclude) {
      console.error(`  - ✅ Skipping excluded path: ${normalizedFullPath}`);
      excluded++;
      continue;
    }
    
    console.error(`  - ✅ Including path: ${normalizedFullPath}`);
    included++;

    if (entry.isDirectory()) {
      console.error(`  - Processing directory: ${normalizedFullPath}`);
      const childNode = await scanDirectory(normalizedBaseDir, fullPath);
      rootNode.children?.push(childNode);
      dirProcessed++;
    } else {
      console.error(`  - Processing file: ${normalizedFullPath}`);
      fileProcessed++;
      const ext = path.extname(entry.name);
      const importPattern = IMPORT_PATTERNS[ext];
      const dependencies: string[] = [];
      const packageDependencies: PackageDependency[] = [];

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
                    // Create a package dependency object with more information
                    const pkgDep = PackageDependency.fromPath(resolvedPath);
                    
                    // Set the package name directly from the import path if it's empty
                    if (!pkgDep.name) {
                      // For imports like '@scope/package'
                      if (importPath.startsWith('@')) {
                        const parts = importPath.split('/');
                        if (parts.length >= 2) {
                          pkgDep.scope = parts[0];
                          pkgDep.name = `${parts[0]}/${parts[1]}`;
                        }
                      } 
                      // For imports like 'package'
                      else if (importPath.includes('/')) {
                        pkgDep.name = importPath.split('/')[0];
                      } else {
                        pkgDep.name = importPath;
                      }
                    }
                    
                    // Try to extract version information
                    if (pkgDep.name) {
                      const version = await extractPackageVersion(pkgDep.name, normalizedBaseDir);
                      if (version) {
                        pkgDep.version = version;
                      }
                      
                      // Check if it's a dev dependency
                      try {
                        const packageJsonPath = path.join(normalizedBaseDir, 'package.json');
                        const content = await fsPromises.readFile(packageJsonPath, 'utf-8');
                        const packageData = JSON.parse(content);
                        
                        if (packageData.devDependencies && packageData.devDependencies[pkgDep.name]) {
                          pkgDep.isDevDependency = true;
                        }
                      } catch (error) {
                        // Ignore package.json errors
                      }
                    }
                    
                    packageDependencies.push(pkgDep);
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
  
  // Log summary for this directory
  console.error(`\n  📊 DIRECTORY SCAN SUMMARY for ${normalizedDirPath}:`);
  console.error(`    - Total entries: ${entries.length}`);
  console.error(`    - Excluded: ${excluded}`);
  console.error(`    - Included: ${included}`);
  console.error(`    - Directories processed: ${dirProcessed}`);
  console.error(`    - Files processed: ${fileProcessed}`);
  console.error(`  📁 END SCAN DIRECTORY: ${currentDir}\n`);
  
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
      const sdkDeps = node.packageDependencies.filter(dep => dep.name && dep.name.includes('@modelcontextprotocol/sdk'));
      const otherDeps = node.packageDependencies.filter(dep => dep.name && !dep.name.includes('@modelcontextprotocol/sdk'));
      
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
  
  function findNode(node: FileNode, targetPath: string): FileNode | null {
    // Normalize paths to handle both forward and backward slashes
    const normalizedTargetPath = path.normalize(targetPath).toLowerCase();
    const normalizedNodePath = path.normalize(node.path).toLowerCase();

    if (normalizedNodePath === normalizedTargetPath) {
      return node;
    }

    if (node.children) {
      for (const child of node.children) {
        const found = findNode(child, targetPath);
        if (found) return found;
      }
    }

    return null;
  }
  
  return findNode(fileTree, normalizedInputPath);
}

/**
 * Finds a node in the file tree by its absolute path.
 * @param tree The file tree node to search within.
 * @param targetPath The absolute path of the node to find.
 * @returns The found FileNode or null if not found.
 */
export function findNodeByPath(tree: FileNode | null, targetPath: string): FileNode | null {
  if (!tree) return null;

  const normalizedTargetPath = normalizePath(targetPath);
  const normalizedNodePath = normalizePath(tree.path);

  // Check the current node
  if (normalizedNodePath === normalizedTargetPath) {
    return tree;
  }

  // If it's a directory, search its children
  if (tree.isDirectory && tree.children) {
    for (const child of tree.children) {
      const found = findNodeByPath(child, targetPath);
      if (found) {
        return found;
      }
    }
  }

  // Node not found in this subtree
  return null;
}

// --- New Functions for Incremental Updates ---

// Placeholder for dependency analysis of a single new file
// This needs to replicate the relevant logic from scanDirectory
async function analyzeNewFile(filePath: string, projectRoot: string): Promise<{ dependencies: string[]; packageDependencies: PackageDependency[] }> {
  console.error(`[analyzeNewFile] Analyzing ${filePath}`);
  const dependencies: string[] = [];
  const packageDependencies: PackageDependency[] = [];
  const ext = path.extname(filePath);
  const pattern = IMPORT_PATTERNS[ext];

  if (pattern) {
     try {
       const content = await fsPromises.readFile(filePath, 'utf-8');
       let match;
       while ((match = pattern.exec(content)) !== null) {
         const importPath = match[1] || match[2] || match[3]; // Adjust indices based on specific regex
         if (importPath) {
            try {
                const resolvedPath = resolveImportPath(importPath, filePath, projectRoot);
                const normalizedResolvedPath = normalizePath(resolvedPath);

                // Check if it's a package dependency (heuristic: includes node_modules or doesn't start with . or /)
                if (normalizedResolvedPath.includes('node_modules') || (!importPath.startsWith('.') && !importPath.startsWith('/'))) {
                    const pkgDep = PackageDependency.fromPath(normalizedResolvedPath);
                     const version = await extractPackageVersion(pkgDep.name, projectRoot);
                      if (version) {
                        pkgDep.version = version;
                      }
                    packageDependencies.push(pkgDep);
                } else {
                    // Attempt to confirm local file exists (you might need more robust checking like in scanDirectory)
                    try {
                      await fsPromises.access(normalizedResolvedPath);
                      dependencies.push(normalizedResolvedPath);
                    } catch {
                      //console.warn(`[analyzeNewFile] Referenced local file not found: ${normalizedResolvedPath}`);
                    }
                }
            } catch (resolveError) {
                 console.error(`[analyzeNewFile] Error resolving import '${importPath}' in ${filePath}:`, resolveError);
            }
         }
       }
     } catch (readError) {
       console.error(`[analyzeNewFile] Error reading file ${filePath}:`, readError);
     }
  }
  console.error(`[analyzeNewFile] Found deps for ${filePath}:`, { dependencies, packageDependencies });
  return { dependencies, packageDependencies };
}


/**
 * Incrementally adds a new file node to the global file tree.
 * Analyzes the new file, calculates its importance, and updates relevant dependents.
 * Must be called with the currently active file tree and its config.
 * @param filePath The absolute path of the file to add.
 * @param activeFileTree The currently active FileNode tree.
 * @param activeProjectRoot The project root directory.
 */
export async function addFileNode(
    filePath: string,
    activeFileTree: FileNode,
    activeProjectRoot: string
): Promise<void> {
  const normalizedFilePath = normalizePath(filePath);
  // Removed reliance on getConfig() here

  console.error(`[addFileNode] Attempting to add file: ${normalizedFilePath} to tree rooted at ${activeFileTree.path}`);

  // 1. Find the parent directory node within the provided active tree
  const parentDir = path.dirname(normalizedFilePath);
  const parentNode = findNodeByPath(activeFileTree, parentDir);

  if (!parentNode || !parentNode.isDirectory) {
    console.error(`[addFileNode] Could not find parent directory node for: ${normalizedFilePath}`);
    // Optionally: Handle cases where intermediate directories might also need creation
    return;
  }

  // 2. Check if node already exists (should not happen if watcher is correct, but good practice)
  if (parentNode.children?.some(child => normalizePath(child.path) === normalizedFilePath)) {
    console.error(`[addFileNode] Node already exists: ${normalizedFilePath}`);
    return;
  }

  try {
    // 3. Create the new FileNode (Removed size, createdAt, modifiedAt)
    const newNode = new FileNode(); // Use class constructor
    newNode.path = normalizedFilePath;
    newNode.name = path.basename(normalizedFilePath);
    newNode.isDirectory = false;
    newNode.dependencies = []; // Initialize as empty arrays
    newNode.packageDependencies = [];
    newNode.dependents = [];
    newNode.summary = '';

    // 4. Analyze the new file's content for dependencies
    // Use the placeholder analysis function
    const { dependencies, packageDependencies } = await analyzeNewFile(normalizedFilePath, activeProjectRoot);
    newNode.dependencies = dependencies;
    newNode.packageDependencies = packageDependencies;


    // 5. Calculate initial importance for the new node
    // Use the existing calculateInitialImportance function
    newNode.importance = calculateInitialImportance(newNode.path, activeProjectRoot);

    // 6. Add the new node to the parent's children
    if (!parentNode.children) {
      parentNode.children = [];
    }
    parentNode.children.push(newNode);
    parentNode.children.sort((a, b) => a.name.localeCompare(b.name)); // Keep sorted

    // 7. Update dependents lists of the files imported by the new node
    await updateDependentsForNewNode(newNode, activeFileTree); // Pass active tree


    // 8. Recalculate importance for affected nodes (new node and its dependencies)
    // Ensure dependencies is an array before mapping
    const depPaths = (newNode.dependencies ?? []).map(d => normalizePath(d));
    await recalculateImportanceForAffected([newNode.path, ...depPaths], activeFileTree, activeProjectRoot); // Pass active tree & root

    // 9. Global state update is handled by the caller (mcp-server) after saving

    console.error(`[addFileNode] Successfully added node: ${normalizedFilePath}`);

  } catch (error: any) {
    if (error.code === 'ENOENT') {
       console.error(`[addFileNode] File not found during add operation (might have been deleted quickly): ${normalizedFilePath}`);
    } else {
       console.error(`[addFileNode] Error adding file node ${normalizedFilePath}:`, error);
    }
  }
}

/**
 * Incrementally removes a file node from the global file tree.
 * Updates dependents of the removed file and the files it depended on.
 * Must be called with the currently active file tree.
 * @param filePath The absolute path of the file to remove.
 * @param activeFileTree The currently active FileNode tree.
 * @param activeProjectRoot The project root directory.
 */
export async function removeFileNode(
    filePath: string,
    activeFileTree: FileNode,
    activeProjectRoot: string
): Promise<void> {
  const normalizedFilePath = normalizePath(filePath);
  // Removed reliance on getConfig() here

  console.error(`[removeFileNode] Attempting to remove file: ${normalizedFilePath} from tree rooted at ${activeFileTree.path}`);

  // 1. Find the node to remove within the provided active tree
  const nodeToRemove = findNodeByPath(activeFileTree, normalizedFilePath);
  if (!nodeToRemove || nodeToRemove.isDirectory) {
    // Handle case where node not found or it's unexpectedly a directory
    console.error(`[removeFileNode] File node not found or is a directory: ${normalizedFilePath}`);
    return;
  }

  // 2. Find the parent directory node within the provided active tree
  const parentDir = path.dirname(normalizedFilePath);
  const parentNode = findNodeByPath(activeFileTree, parentDir);
  if (!parentNode || !parentNode.isDirectory || !parentNode.children) {
    console.error(`[removeFileNode] Could not find parent directory node for: ${normalizedFilePath}`);
    return;
  }

  // 3. Store necessary info before removal (Ensure arrays exist)
  const dependenciesToRemoveFrom = [...(nodeToRemove.dependencies ?? [])];
  const dependentsToUpdate = [...(nodeToRemove.dependents ?? [])]; // Files that depended on this node

  // 4. Remove the node from its parent's children array
  const index = parentNode.children.findIndex(child => normalizePath(child.path) === normalizedFilePath);
  if (index > -1) {
    parentNode.children.splice(index, 1);
  } else {
     console.error(`[removeFileNode] Node not found in parent's children: ${normalizedFilePath}`);
     // Continue removal process anyway, as the node might be detached elsewhere
  }

  // 5. Update the 'dependents' list of files the removed node imported
  await updateDependentsAfterRemoval(nodeToRemove, activeFileTree); // Pass active tree


  // 6. Update the 'dependencies' list of files that imported the removed node
  await updateDependersAfterRemoval(nodeToRemove, activeFileTree); // Pass active tree


  // 7. Recalculate importance for affected nodes (dependents and dependencies)
  const affectedPaths = [
      ...(dependenciesToRemoveFrom ?? []).map(d => normalizePath(d)),
      ...(dependentsToUpdate ?? []).map(depPath => normalizePath(depPath))
  ];
  await recalculateImportanceForAffected(affectedPaths, activeFileTree, activeProjectRoot); // Pass active tree & root

  // 8. Global state update is handled by the caller (mcp-server) after saving

  console.error(`[removeFileNode] Successfully removed node: ${normalizedFilePath}`);
}


// --- Helper / Placeholder Functions for Incremental Updates ---

/**
 * Calculates the importance of a node, considering dependents and dependencies.
 * This adapts the existing `calculateImportance` logic for targeted recalculation.
 */
function calculateNodeImportance(node: FileNode, projectRoot: string): number {
   // Use existing initial calculation
   let importance = calculateInitialImportance(node.path, projectRoot);

   // Add importance based on number of dependents (files that import this file)
   const dependentsCount = node.dependents?.length ?? 0;
   if (dependentsCount > 0) {
       importance += Math.min(dependentsCount, 3);
   }

   // Add importance based on number of local dependencies (files this file imports)
   const localDepsCount = node.dependencies?.length ?? 0;
   if (localDepsCount > 0) {
       importance += Math.min(localDepsCount, 2);
   }

   // Add importance based on number of package dependencies
   const pkgDeps = node.packageDependencies ?? [];
   if (pkgDeps.length > 0) {
       const sdkDeps = pkgDeps.filter(dep => dep.name?.includes('@modelcontextprotocol/sdk'));
       const otherDeps = pkgDeps.filter(dep => !dep.name?.includes('@modelcontextprotocol/sdk'));
       importance += Math.min(sdkDeps.length, 2); // SDK dependencies are more important
       importance += Math.min(otherDeps.length, 1); // Other package dependencies
   }

   // Cap importance at 10
   return Math.min(10, Math.max(0, Math.round(importance)));
}

/**
 * Updates the 'dependents' list of nodes that the new node imports.
 * @param newNode The node that was just added.
 * @param activeFileTree The tree to search within.
 */
async function updateDependentsForNewNode(newNode: FileNode, activeFileTree: FileNode): Promise<void> {
   console.error(`[updateDependentsForNewNode] Updating dependents for new node ${newNode.path}`);
   // Removed reliance on getConfig()

   // Ensure dependencies is an array
   for (const depPath of (newNode.dependencies ?? [])) {
       const depNode = findNodeByPath(activeFileTree, depPath); // depPath is already string
       if (depNode && !depNode.isDirectory) {
           // Ensure dependents is an array
           if (!depNode.dependents) {
              depNode.dependents = [];
           }
           if (!depNode.dependents.includes(newNode.path)) {
               depNode.dependents.push(newNode.path);
               console.error(`[updateDependentsForNewNode] Added ${newNode.path} as dependent for ${depNode.path}`);
           }
       } else {
          // console.warn(`[updateDependentsForNewNode] Dependency node not found or is directory: ${depPath}`);
       }
   }
   // Package dependencies don't have dependents lists in our model
}

/**
 * Updates the 'dependents' list of nodes that the removed node imported.
 * @param removedNode The node that was removed.
 * @param activeFileTree The tree to search within.
 */
async function updateDependentsAfterRemoval(removedNode: FileNode, activeFileTree: FileNode): Promise<void> {
   console.error(`[updateDependentsAfterRemoval] Updating dependents after removing ${removedNode.path}`);
    // Removed reliance on getConfig()

    // Ensure dependencies is an array
    for (const depPath of (removedNode.dependencies ?? [])) {
        const depNode = findNodeByPath(activeFileTree, depPath); // depPath is string
        if (depNode && !depNode.isDirectory) {
            // Ensure dependents is an array before searching/splicing
            if (depNode.dependents) {
                const index = depNode.dependents.indexOf(removedNode.path);
                if (index > -1) {
                    depNode.dependents.splice(index, 1);
                    console.error(`[updateDependentsAfterRemoval] Removed ${removedNode.path} from dependents of ${depNode.path}`);
                }
            }
        }
    }
}

/**
 * Updates the 'dependencies' list of nodes that imported the removed node.
 * @param removedNode The node that was removed.
 * @param activeFileTree The tree to search within.
 */
async function updateDependersAfterRemoval(removedNode: FileNode, activeFileTree: FileNode): Promise<void> {
   console.error(`[updateDependersAfterRemoval] Updating dependers after removing ${removedNode.path}`);
   // Removed reliance on getConfig()

   // Ensure dependents is an array
   for (const dependentPath of (removedNode.dependents ?? [])) {
       const dependerNode = findNodeByPath(activeFileTree, dependentPath);
       if (dependerNode && !dependerNode.isDirectory) {
           // Ensure dependencies is an array before searching/splicing
           if (dependerNode.dependencies) {
               const normalizedRemovedPath = normalizePath(removedNode.path);
               const index = dependerNode.dependencies.findIndex(d => normalizePath(d) === normalizedRemovedPath);
               if (index > -1) {
                   dependerNode.dependencies.splice(index, 1);
                   console.error(`[updateDependersAfterRemoval] Removed dependency on ${removedNode.path} from ${dependerNode.path}`);
               }
           }
       }
   }
}


/**
 * Recalculates importance for a specific set of affected nodes.
 * @param affectedPaths Array of absolute paths for nodes needing recalculation.
 * @param activeFileTree The tree to search/update within.
 * @param activeProjectRoot The project root directory.
 */
async function recalculateImportanceForAffected(
    affectedPaths: string[],
    activeFileTree: FileNode,
    activeProjectRoot: string
): Promise<void> {
  console.error(`[recalculateImportanceForAffected] Recalculating importance for paths:`, affectedPaths);
  // Removed reliance on getConfig()

  const uniquePaths = [...new Set(affectedPaths)]; // Ensure uniqueness

  for (const filePath of uniquePaths) {
    const node = findNodeByPath(activeFileTree, filePath);
    if (node && !node.isDirectory) {
       const oldImportance = node.importance;
       // Use the corrected importance calculation function
       node.importance = calculateNodeImportance(node, activeProjectRoot);
       if(oldImportance !== node.importance) {
          console.error(`[recalculateImportanceForAffected] Importance for ${node.path} changed from ${oldImportance} to ${node.importance}`);
          // Potential future enhancement: trigger recursive recalculation if importance changed significantly
       }
    } else {
       // console.warn(`[recalculateImportanceForAffected] Node not found or is directory during recalculation: ${filePath}`);
    }
  }
}


// --- End of New Functions ---

/**
 * Recursively calculates importance scores for all file nodes in the tree.
 * Uses calculateNodeImportance for individual node calculation.
 */