import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { FileNode, PackageDependency, FileTreeConfig } from "./types.js";
import { getProjectRoot, getConfig, addExclusionPattern, getFilescopeIgnore } from './global-state.js';
import { log } from './logger.js'; // Import the logger
import { upsertFile, deleteFile, setDependencies } from './db/repository.js';
import { extractSnapshot, isTreeSitterLanguage } from './change-detector/ast-parser.js';

/**
 * Canonical path normalization for the entire codebase.
 *
 * Cosmetic normalization (always applied):
 *  - URL-decode percent-encoded characters
 *  - Strip leading slash before Windows drive letters (/C: -> C:)
 *  - Convert backslashes to forward slashes
 *  - Remove double-quote wrappers
 *  - Collapse duplicate slashes
 *  - Remove trailing slash
 *
 * Resolution (applied only when baseDir is provided):
 *  - Relative paths are resolved against baseDir via path.resolve
 *  - '.' and './' resolve to baseDir itself
 *
 * @param filepath The path to canonicalize.
 * @param baseDir  Optional base directory for resolving relative paths.
 *                 When omitted, relative paths are left as-is (cosmetic only).
 */
export function canonicalizePath(filepath: string, baseDir?: string): string {
  if (!filepath) return '';

  try {
    // Handle special case for current directory when resolving
    if (baseDir && (filepath === '.' || filepath === './')) {
      return baseDir.replace(/\\/g, '/').replace(/\/+/g, '/');
    }

    // Handle URL-encoded paths
    const decoded = filepath.includes('%') ? decodeURIComponent(filepath) : filepath;

    // Handle Windows paths with drive letters that may start with a slash
    const cleanPath = decoded.match(/^\/[a-zA-Z]:/) ? decoded.substring(1) : decoded;

    // If baseDir is provided and path is relative, resolve it
    if (baseDir && !path.isAbsolute(cleanPath)) {
      const fullPath = path.resolve(baseDir, cleanPath);
      return fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
    }

    // Cosmetic normalization only
    const forwardSlashed = cleanPath.replace(/\\/g, '/');
    const noQuotes = forwardSlashed.replace(/"/g, '');
    const deduped = noQuotes.replace(/\/+/g, '/');
    return deduped.endsWith('/') ? deduped.slice(0, -1) : deduped;
  } catch (error) {
    log(`Failed to canonicalize path: ${filepath} - ${error}`);
    return filepath;
  }
}

/**
 * @deprecated Use canonicalizePath instead. Will be removed in v1.2.
 */
export const normalizePath = canonicalizePath;

export function toPlatformPath(normalizedPath: string): string {
  return normalizedPath.split('/').join(path.sep);
}

// Go import regexes — two-pass approach per Go Language Specification
const GO_SINGLE_IMPORT_RE = /^import\s+(?:[\w_.]+\s+)?"([^"]+)"/gm;
const GO_GROUPED_BLOCK_RE = /^import\s*\(([\s\S]*?)\)/gm;
const GO_BLOCK_LINE_RE = /^\s*(?:[\w_.]+\s+)?"([^"]+)"/gm;

// Ruby import regex — captures keyword (group 1) and path (group 2)
// Matches: require_relative 'path', require './path', require 'gem', require('path'), require_relative('path')
const RUBY_IMPORT_RE = /(require_relative|require)\s*\(?\s*['"]([^'"]+)['"]\s*\)?/g;

// Note: .ts, .tsx, .js, .jsx entries removed — those file types now use AST-based
// import extraction via extractSnapshot() from change-detector/ast-parser.ts (CHNG-04).
// All other languages continue to use the regex patterns below.
const IMPORT_PATTERNS: { [key: string]: RegExp } = {
  '.py': /(?:import\s+[\w.]+|from\s+[\w.]+\s+import\s+[\w*]+)/g,
  '.c': /#include\s+["<][^">]+[">]/g,
  '.cpp': /#include\s+["<][^">]+[">]/g,
  '.h': /#include\s+["<][^">]+[">]/g,
  '.rs': /use\s+[\w:]+|mod\s+\w+/g,
  '.lua': /require\s*\(['"][^'"]+['"]\)/g,
  '.zig': /@import\s*\(['"][^'"]+['"]\)|const\s+[\w\s,{}]+\s*=\s*@import\s*\(['"][^'"]+['"]\)/g,
  '.php': /(?:(?:require|require_once|include|include_once)\s*\(?["']([^"']+)["']\)?)|(?:use\s+([A-Za-z0-9\\]+(?:\s+as\s+[A-Za-z0-9]+)?);)/g,
  '.cs': /using\s+[\w.]+;/g,
  '.java': /import\s+[\w.]+;/g
};

/**
 * Utility function to detect unresolved template literals in strings
 * This helps prevent treating template literals like ${importPath} as actual import paths
 */
/**
 * Reads the Go module name from go.mod in the given project root.
 * Returns null if go.mod is absent or doesn't contain a valid module directive.
 */
export async function readGoModuleName(projectRoot: string): Promise<string | null> {
  try {
    const goModPath = path.join(projectRoot, 'go.mod');
    const content = await fsPromises.readFile(goModPath, 'utf-8');
    const m = content.match(/^module\s+(\S+)/m);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Parses Go import statements from file content and resolves them to either
 * local filesystem dependencies (intra-project) or external package dependencies.
 *
 * Go imports reference packages (directories), not individual files.
 * Intra-project imports are identified by matching the go.mod module name prefix.
 */
async function resolveGoImports(
  content: string,
  currentFile: string,
  projectRoot: string,
  moduleName: string | null
): Promise<{ dependencies: string[]; packageDependencies: PackageDependency[] }> {
  const dependencies: string[] = [];
  const packageDependencies: PackageDependency[] = [];
  const importPaths: string[] = [];

  // Pass 1: Single-line imports
  let match;
  const singleRe = new RegExp(GO_SINGLE_IMPORT_RE.source, GO_SINGLE_IMPORT_RE.flags);
  while ((match = singleRe.exec(content)) !== null) {
    importPaths.push(match[1]);
  }

  // Pass 2: Grouped import blocks
  const blockRe = new RegExp(GO_GROUPED_BLOCK_RE.source, GO_GROUPED_BLOCK_RE.flags);
  while ((match = blockRe.exec(content)) !== null) {
    const blockContent = match[1];
    const lineRe = new RegExp(GO_BLOCK_LINE_RE.source, GO_BLOCK_LINE_RE.flags);
    let lineMatch;
    while ((lineMatch = lineRe.exec(blockContent)) !== null) {
      importPaths.push(lineMatch[1]);
    }
  }

  // Classify and resolve each import path
  for (const importPath of importPaths) {
    if (moduleName && importPath.startsWith(moduleName + '/')) {
      // Intra-project import: strip module prefix, resolve to filesystem
      const relPath = importPath.slice(moduleName.length + 1);
      const absPath = path.join(projectRoot, relPath);
      const normalizedAbsPath = canonicalizePath(absPath);
      // Go imports reference packages (directories), not individual files.
      // Check if the directory exists.
      try {
        await fsPromises.access(normalizedAbsPath);
        dependencies.push(normalizedAbsPath);
      } catch {
        // Directory doesn't exist — skip silently
      }
    } else {
      // External package dependency
      const pkgDep = new PackageDependency();
      pkgDep.name = importPath;
      packageDependencies.push(pkgDep);
    }
  }

  return { dependencies, packageDependencies };
}

function isUnresolvedTemplateLiteral(str: string): boolean {
  // Check for ${...} pattern which indicates an unresolved template literal
  return typeof str === 'string' &&
         str.includes('${') &&
         str.includes('}');
}

function isRubyInterpolation(str: string): boolean {
  return typeof str === 'string' && str.includes('#{');
}

/**
 * Parses Ruby require/require_relative statements and resolves them to either
 * local filesystem dependencies (with .rb extension probing) or gem/stdlib package dependencies.
 *
 * require_relative and require with ./ or ../ prefix resolve relative to the calling file.
 * Bare require (no relative prefix) is classified as a gem/stdlib package dependency.
 */
async function resolveRubyImports(
  content: string,
  currentFile: string,
  projectRoot: string
): Promise<{ dependencies: string[]; packageDependencies: PackageDependency[] }> {
  const dependencies: string[] = [];
  const packageDependencies: PackageDependency[] = [];

  const re = new RegExp(RUBY_IMPORT_RE.source, RUBY_IMPORT_RE.flags);
  let match;
  while ((match = re.exec(content)) !== null) {
    const keyword = match[1]; // 'require_relative' or 'require'
    const importPath = match[2];

    if (!importPath) continue;

    // Skip Ruby string interpolation
    if (isRubyInterpolation(importPath)) {
      log(`Skipping Ruby import with interpolation: ${importPath}`);
      continue;
    }

    // Also skip JS-style template literals
    if (isUnresolvedTemplateLiteral(importPath)) {
      log(`Skipping unresolved template literal in Ruby import: ${importPath}`);
      continue;
    }

    // require_relative is always relative to the current file
    if (keyword === 'require_relative' || importPath.startsWith('./') || importPath.startsWith('../')) {
      const base = path.dirname(currentFile);
      const resolved = path.resolve(base, importPath);
      const normalizedResolved = canonicalizePath(resolved);

      // Probe .rb extension (Ruby conventionally omits it)
      // Try '' first so explicit .rb doesn't get doubled to .rb.rb
      const rubyExtensions = ['', '.rb'];
      let found = false;
      for (const ext of rubyExtensions) {
        const pathToCheck = normalizedResolved + ext;
        try {
          await fsPromises.access(pathToCheck);
          dependencies.push(canonicalizePath(pathToCheck));
          found = true;
          break;
        } catch { /* try next */ }
      }
      if (!found) {
        log(`Ruby import not found on disk: ${importPath} (from ${currentFile})`);
      }
    } else {
      // Bare require: gem/stdlib dependency
      const pkgDep = new PackageDependency();
      pkgDep.name = importPath.includes('/') ? importPath.split('/')[0] : importPath;
      packageDependencies.push(pkgDep);
    }
  }

  return { dependencies, packageDependencies };
}

// Helper to resolve TypeScript/JavaScript import paths
function resolveImportPath(importPath: string, currentFilePath: string, baseDir: string): string {
  log(`Resolving import path: ${importPath} from file: ${currentFilePath}`);
  
  // Check if the importPath is an unresolved template literal
  if (isUnresolvedTemplateLiteral(importPath)) {
    log(`Warning: Attempting to resolve unresolved template literal: ${importPath}`);
    // We'll return a special path that's unlikely to exist or cause issues
    return path.join(baseDir, '_UNRESOLVED_TEMPLATE_PATH_');
  }
  
  // For TypeScript files, if the import ends with .js, convert it to .ts
  if (currentFilePath.endsWith('.ts') || currentFilePath.endsWith('.tsx')) {
    if (importPath.endsWith('.js')) {
      importPath = importPath.replace(/\.js$/, '.ts');
    }
  }
  
  // Handle relative imports
  if (importPath.startsWith('.')) {
    const resolvedPath = path.resolve(path.dirname(currentFilePath), importPath);
    log(`Resolved relative import to: ${resolvedPath}`);
    return path.normalize(resolvedPath);
  }

  // Handle absolute imports (from project root)
  if (importPath.startsWith('/')) {
    const resolvedPath = path.join(baseDir, importPath);
    log(`Resolved absolute import to: ${resolvedPath}`);
    return path.normalize(resolvedPath);
  }

  // Handle package imports
  const nodeModulesPath = path.join(baseDir, 'node_modules', importPath);
  log(`Resolved package import to: ${nodeModulesPath}`);
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
    case '.php':
      importance += 2;
      break;
    case '.json':
      if (fileName === 'package' || fileName === 'tsconfig' || fileName === 'composer') {
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
    case '.go':
      importance += 2;
      break;
    case '.mod':
      if (fileName === 'go') importance += 3;
      else importance += 1;
      break;
    case '.rb':
      importance += 2;
      break;
    default:
      importance += 0;
  }

  // Ruby project manifest — explicit importance like go.mod
  if (fileName === 'Gemfile') {
    importance += 3;
  }

  // Importance by location
  if (parts[0] === 'src' || parts[0] === 'app') {
    importance += 2;
  } else if (parts[0] === 'test' || parts[0] === 'tests') {
    importance += 1;
  }

  // Importance by name significance
  const significantNames = [
    'index', 'main', 'server', 'app', 'config', 'types', 'utils',
    'kernel', 'provider', 'middleware', 'service', 'repository',
    'controller', 'model', 'layout', 'master'
  ];
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
    log(`Failed to extract package version for ${packageName}: ${error}`);
    return undefined;
  }
}

// Helper function to check if a path matches any exclude pattern
export function isExcluded(filePath: string, baseDir: string, isDir?: boolean): boolean {
  // Add a failsafe check specifically for .git directory
  if (filePath.includes('.git') || path.basename(filePath) === '.git') {
    log(`🔴 SPECIAL CASE: .git directory/file detected: ${filePath}`);
    return true;
  }
  
  // Add a failsafe check for node_modules
  if (filePath.includes('node_modules') || path.basename(filePath) === 'node_modules') {
    log(`🔴 SPECIAL CASE: node_modules directory/file detected: ${filePath}`);
    return true;
  }
  
  // Add a failsafe check for test_excluded files
  if (filePath.includes('test_excluded') || path.basename(filePath).startsWith('test_excluded')) {
    log(`🔴 SPECIAL CASE: test_excluded file detected: ${filePath}`);
    return true;
  }
  
  log(`\n===== EXCLUDE CHECK for: ${filePath} =====`);
  
  const config = getConfig();
  if (!config) {
    log('❌ ERROR: Config is null! Global state not initialized properly.');
    return false;
  }
  
  if (!config.excludePatterns || config.excludePatterns.length === 0) {
    log('⚠️ NOTE: No excludePatterns in config — only .filescopeignore rules apply.');
  }

  // Get relative path for matching, normalize to forward slashes for cross-platform consistency
  const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');
  const fileName = path.basename(filePath);
  
  log(`📂 Path details:`);
  log(`  - Full path: ${filePath}`);
  log(`  - Base dir: ${baseDir}`);
  log(`  - Relative path: ${relativePath}`);
  log(`  - File name: ${fileName}`);
  log(`  - Platform: ${process.platform}, path separator: ${path.sep}`);
  
  log(`\n🔍 Testing against ${config.excludePatterns?.length ?? 0} exclude patterns...`);
  
  // Special case check for .git and node_modules
  if (relativePath.includes('/.git/') || relativePath === '.git' || 
      fileName === '.git' || relativePath.startsWith('.git/')) {
    log(`✅ MATCH! Special case for .git directory detected: ${relativePath}`);
    return true;
  }
  
  if (relativePath.includes('/node_modules/') || relativePath === 'node_modules' || 
      fileName === 'node_modules' || relativePath.startsWith('node_modules/')) {
    log(`✅ MATCH! Special case for node_modules directory detected: ${relativePath}`);
    return true;
  }
  
  // Check each exclude pattern
  for (let i = 0; i < (config.excludePatterns?.length ?? 0); i++) {
    const pattern = config.excludePatterns[i];
    log(`\n  [${i+1}/${config.excludePatterns.length}] Testing pattern: "${pattern}"`);
    
    try {
      const regex = globToRegExp(pattern);
      //log(`  - Converted to regex: ${regex}`); // Uncomment for debugging
      
      // Test against full relative path
      const fullPathMatch = regex.test(relativePath);
      //log(`  - Match against relative path: ${fullPathMatch ? '✅ YES' : '❌ NO'}`); // Uncomment for debugging
      
      if (fullPathMatch) {
        log(`✅ MATCH! Path ${relativePath} matches exclude pattern ${pattern}`);
        return true;
      }
      
      // Also test against just the filename for file extension patterns
      if (pattern.startsWith('**/*.') || pattern.includes('/*.')) {
        const filenameMatch = regex.test(fileName);
        //log(`  - Match against filename only: ${filenameMatch ? '✅ YES' : '❌ NO'}`); // Uncomment for debugging
        
        if (filenameMatch) {
          log(`✅ MATCH! Filename ${fileName} matches exclude pattern ${pattern}`);
          return true;
        }
      }
    } catch (error) {
      log(`  - ❌ ERROR converting pattern to regex: ${error}`);
    }
  }
  
  // Check .filescopeignore rules (gitignore syntax via 'ignore' package)
  const ig = getFilescopeIgnore();
  if (ig) {
    const rel = path.relative(baseDir, filePath).replace(/\\/g, '/');
    if (rel && !rel.startsWith('..')) {
      if (ig.ignores(rel)) {
        log(`MATCH! Path ${rel} matches .filescopeignore rule`);
        return true;
      }
      // For directories, also test with trailing slash (gitignore: "dist/" means directory-only)
      if (isDir && ig.ignores(rel + '/')) {
        log(`MATCH! Directory ${rel}/ matches .filescopeignore rule`);
        return true;
      }
    }
  }

  log(`❌ No pattern matches found for ${relativePath}`);
  log(`===== END EXCLUDE CHECK =====\n`);
  return false;
}

// Helper function to convert glob pattern to RegExp
export function globToRegExp(pattern: string): RegExp {
  //log(`  Converting glob pattern: ${pattern}`); // Uncomment for debugging

  // Escape special regex characters except * and ?
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  //log(`  - After escaping special chars: ${escaped}`); // Uncomment for debugging

  // Handle patterns starting with **/
  let prefix = '';
  if (escaped.startsWith('**/')) {
    // Make the initial part optional to match root level
    prefix = '(?:.*/)?';
    // Remove the leading **/ from the pattern being converted
    pattern = escaped.substring(3);
  } else {
    // Make the initial part optional for patterns not starting with **/
    prefix = '(?:.*/)?';
    pattern = escaped;
  }

  // Convert glob patterns to regex patterns (applied to the potentially shortened pattern)
  const converted = pattern
    // Convert ** to special marker (use a different marker to avoid conflict)
    .replace(/\*\*/g, '__GLOBSTAR__')
    // Convert remaining * to [^/\\]*
    .replace(/\*/g, '[^/\\\\]*')
    // Convert ? to single character match
    .replace(/\?/g, '[^/\\\\]')
    // Convert globstar back to proper pattern
    .replace(/__GLOBSTAR__/g, '.*');

  //log(`  - After pattern conversion: ${converted}`); // Uncomment for debugging

  // Create regex that matches entire path, adding the optional prefix
  // Ensure the pattern is anchored correctly
  const finalPattern = `^${prefix}${converted}$`;
  const regex = new RegExp(finalPattern, 'i');
  //log(`  - Final regex: ${regex}`); // Uncomment for debugging
  return regex;
}

export async function* scanDirectory(baseDir: string, currentDir: string = baseDir): AsyncGenerator<FileNode> {
  log(`\n📁 SCAN DIRECTORY: ${currentDir}`);
  log(`  - Base dir: ${baseDir}`);

  // Handle special case for current directory
  const normalizedBaseDir = path.normalize(baseDir);
  const normalizedDirPath = path.normalize(currentDir);

  log(`  - Normalized base dir: ${normalizedBaseDir}`);
  log(`  - Normalized current dir: ${normalizedDirPath}`);

  // ==================== CRITICAL CODE ====================
  // Log the global config status before processing entries
  log(`\n🔍 BEFORE PROCESSING: Is config loaded? ${getConfig() !== null ? 'YES ✅' : 'NO ❌'}`);
  if (getConfig()) {
    const excludePatternsLength = getConfig()?.excludePatterns?.length || 0;
    log(`  - Exclude patterns count: ${excludePatternsLength}`);
    if (excludePatternsLength > 0) {
      log(`  - First few patterns: ${getConfig()?.excludePatterns?.slice(0, 3).join(', ')}`);
    }
  }
  // ======================================================

  // Open directory for streaming iteration — no buffering of full listing
  let dir: fs.Dir;
  try {
    dir = await fsPromises.opendir(normalizedDirPath);
  } catch (error) {
    log(`  - ❌ Error opening directory ${normalizedDirPath}:`, error);
    return;
  }

  for await (const entry of dir) {
    const fullPath = path.join(normalizedDirPath, entry.name);
    const normalizedFullPath = path.normalize(fullPath);

    log(`\n  Entry: ${entry.name} (${entry.isDirectory() ? 'directory' : 'file'})`);
    log(`  - Full path: ${normalizedFullPath}`);

    // Pre-recursion exclusion gate — excluded directories are never entered
    log(`  🔍 Checking if path should be excluded: ${normalizedFullPath}`);
    const shouldExclude = isExcluded(normalizedFullPath, normalizedBaseDir, entry.isDirectory());
    log(`  🔍 Exclusion check result: ${shouldExclude ? 'EXCLUDE ✅' : 'INCLUDE ❌'}`);

    if (shouldExclude) {
      log(`  - ✅ Skipping excluded path: ${normalizedFullPath}`);
      continue;
    }

    log(`  - ✅ Including path: ${normalizedFullPath}`);

    if (entry.isDirectory()) {
      log(`  - Processing directory: ${normalizedFullPath}`);
      yield* scanDirectory(normalizedBaseDir, fullPath);
    } else {
      log(`  - Processing file: ${normalizedFullPath}`);

      // Capture file modification time for freshness tracking
      let fileMtime: number | undefined;
      try {
        const stat = await fsPromises.stat(normalizedFullPath);
        fileMtime = stat.mtimeMs;
      } catch { /* ignore stat errors */ }

      // Yield metadata-only FileNode — dependency extraction deferred to coordinator Pass 2
      yield {
        path: normalizedFullPath,
        name: entry.name,
        isDirectory: false,
        importance: calculateInitialImportance(normalizedFullPath, normalizedBaseDir),
        mtime: fileMtime,
        // dependencies, packageDependencies, dependents are NOT set here
        // They are populated in Pass 2 by the coordinator
      } as FileNode;
    }
  }

  log(`  📁 END SCAN DIRECTORY: ${currentDir}\n`);
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
    // Always recalculate from scratch using the canonical formula.
    // Do NOT start from node.importance — that makes repeated calls non-idempotent.
    node.importance = calculateNodeImportance(node, process.cwd());
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
  log(`Setting importance for file: ${normalizedInputPath}`);
  log(`Current tree root: ${fileTree.path}`);
  
  function findAndSetImportance(node: FileNode): boolean {
    const normalizedNodePath = normalizePath(node.path);
    log(`Checking node: ${normalizedNodePath}`);
    
    // Try exact match
    if (normalizedNodePath === normalizedInputPath) {
      log(`Found exact match for: ${normalizedInputPath}`);
      node.importance = Math.min(10, Math.max(0, importance));
      return true;
    }
    
    // Try case-insensitive match for Windows compatibility
    if (normalizedNodePath.toLowerCase() === normalizedInputPath.toLowerCase()) {
      log(`Found case-insensitive match for: ${normalizedInputPath}`);
      node.importance = Math.min(10, Math.max(0, importance));
      return true;
    }
    
    // Check if the path ends with our target (to handle relative vs absolute paths)
    if (normalizedInputPath.endsWith(normalizedNodePath) || normalizedNodePath.endsWith(normalizedInputPath)) {
      log(`Found path suffix match for: ${normalizedInputPath}`);
      node.importance = Math.min(10, Math.max(0, importance));
      return true;
    }
    
    // Try with basename
    const inputBasename = normalizedInputPath.split('/').pop() || '';
    const nodeBasename = normalizedNodePath.split('/').pop() || '';
    if (nodeBasename === inputBasename && nodeBasename !== '') {
      log(`Found basename match for: ${inputBasename}`);
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

async function createFileTree(baseDir: string): Promise<FileNode> {
  const normalizedBaseDir = path.normalize(baseDir);

  // Collect flat list from generator, then build a synthetic root node
  const fileNodes: FileNode[] = [];
  for await (const node of scanDirectory(normalizedBaseDir)) {
    fileNodes.push(node);
  }

  const rootNode: FileNode = {
    path: normalizedBaseDir,
    name: path.basename(normalizedBaseDir),
    isDirectory: true,
    children: fileNodes,
  };

  return rootNode;
}

export function getFileImportance(fileTree: FileNode, targetPath: string): FileNode | null {
  const normalizedInputPath = normalizePath(targetPath);
  log(`Looking for file: ${normalizedInputPath}`);
  
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
  log(`[analyzeNewFile] Analyzing ${filePath}`);
  const dependencies: string[] = [];
  const packageDependencies: PackageDependency[] = [];
  const ext = path.extname(filePath).toLowerCase();

  // AST-based import extraction for TS/JS (CHNG-04)
  if (isTreeSitterLanguage(ext)) {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const snapshot = extractSnapshot(filePath, content);
      if (snapshot) {
        log(`[analyzeNewFile] [AST] Found ${snapshot.imports.length} imports in ${filePath}`);
        for (const importPath of snapshot.imports) {
          if (isUnresolvedTemplateLiteral(importPath)) {
            log(`[analyzeNewFile] Skipping unresolved template literal: ${importPath}`);
            continue;
          }
          try {
            const resolvedPath = resolveImportPath(importPath, filePath, projectRoot);
            const normalizedResolvedPath = normalizePath(resolvedPath);
            if (normalizedResolvedPath.includes('node_modules') || (!importPath.startsWith('.') && !importPath.startsWith('/'))) {
              const pkgDep = PackageDependency.fromPath(normalizedResolvedPath);
              if (!pkgDep.name) {
                if (importPath.startsWith('@')) {
                  const parts = importPath.split('/');
                  if (parts.length >= 2) { pkgDep.scope = parts[0]; pkgDep.name = `${parts[0]}/${parts[1]}`; }
                } else if (importPath.includes('/')) {
                  pkgDep.name = importPath.split('/')[0];
                } else {
                  pkgDep.name = importPath;
                }
              }
              if (isUnresolvedTemplateLiteral(pkgDep.name)) continue;
              const version = await extractPackageVersion(pkgDep.name, projectRoot);
              if (version) pkgDep.version = version;
              packageDependencies.push(pkgDep);
            } else {
              try {
                await fsPromises.access(normalizedResolvedPath);
                dependencies.push(normalizedResolvedPath);
              } catch { /* file not found with this path */ }
            }
          } catch (resolveError) {
            log(`[analyzeNewFile] Error resolving import '${importPath}' in ${filePath}: ${resolveError}`);
          }
        }
      }
    } catch (readError) {
      log(`[analyzeNewFile] Error reading file ${filePath} (AST path): ${readError}`);
    }
  } else if (ext === '.go') {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const moduleName = await readGoModuleName(projectRoot);
      const goResult = await resolveGoImports(content, filePath, projectRoot, moduleName);
      dependencies.push(...goResult.dependencies);
      packageDependencies.push(...goResult.packageDependencies);
    } catch (readError) {
      log(`[analyzeNewFile] Error reading Go file ${filePath}: ${readError}`);
    }
  } else if (ext === '.rb') {
    try {
      const content = await fsPromises.readFile(filePath, 'utf-8');
      const rbResult = await resolveRubyImports(content, filePath, projectRoot);
      dependencies.push(...rbResult.dependencies);
      packageDependencies.push(...rbResult.packageDependencies);
    } catch (readError) {
      log(`[analyzeNewFile] Error reading Ruby file ${filePath}: ${readError}`);
    }
  } else {
    const pattern = IMPORT_PATTERNS[ext];
    if (pattern) {
       try {
         const content = await fsPromises.readFile(filePath, 'utf-8');
         let match;
         while ((match = pattern.exec(content)) !== null) {
           const importPath = match[1] || match[2] || match[3]; // Adjust indices based on specific regex
           if (importPath) {
              // Skip if the importPath looks like an unresolved template literal
              if (isUnresolvedTemplateLiteral(importPath)) {
                log(`[analyzeNewFile] Skipping unresolved template literal: ${importPath}`);
                continue;
              }

              try {
                  const resolvedPath = path.resolve(path.dirname(filePath), importPath);
                  const normalizedResolvedPath = normalizePath(resolvedPath);

                  // Check if it's a package dependency (heuristic: includes node_modules or doesn't start with . or /)
                  if (normalizedResolvedPath.includes('node_modules') || (!importPath.startsWith('.') && !importPath.startsWith('/'))) {
                      const pkgDep = PackageDependency.fromPath(normalizedResolvedPath);

                      // Skip if the package name is a template literal
                      if (isUnresolvedTemplateLiteral(pkgDep.name)) {
                        log(`[analyzeNewFile] Skipping package with template literal name: ${pkgDep.name}`);
                        continue;
                      }

                      const version = await extractPackageVersion(pkgDep.name, projectRoot);
                      if (version) {
                        pkgDep.version = version;
                      }
                      packageDependencies.push(pkgDep);
                  } else {
                      // Attempt to confirm local file exists
                      try {
                        await fsPromises.access(normalizedResolvedPath);
                        dependencies.push(normalizedResolvedPath);
                      } catch {
                      }
                  }
              } catch (resolveError) {
                   log(`[analyzeNewFile] Error resolving import '${importPath}' in ${filePath}: ${resolveError}`);
              }
           }
         }
       } catch (readError) {
         log(`[analyzeNewFile] Error reading file ${filePath}: ${readError}`);
       }
    }
  }
  log(`[analyzeNewFile] Found deps for ${filePath}: ${JSON.stringify({ dependencies, packageDependencies })}`);
  return { dependencies, packageDependencies };
}


/**
 * Incrementally updates an existing file node when a file's content changes.
 * Re-parses imports, diffs dependencies, updates reverse dependency map, recalculates importance.
 * @param filePath The absolute path of the changed file.
 * @param activeFileTree The currently active FileNode tree.
 * @param activeProjectRoot The project root directory.
 * @returns true if the tree was modified, false otherwise.
 */
export async function updateFileNodeOnChange(
    filePath: string,
    activeFileTree: FileNode,
    activeProjectRoot: string
): Promise<boolean> {
  const normalizedFilePath = normalizePath(filePath);
  log(`[updateFileNodeOnChange] Updating ${normalizedFilePath}`);

  // Find existing node
  const existingNode = findNodeByPath(activeFileTree, normalizedFilePath);
  if (!existingNode) {
    // File not in tree — treat as a new file
    log(`[updateFileNodeOnChange] Node not found, delegating to addFileNode`);
    await addFileNode(filePath, activeFileTree, activeProjectRoot);
    return true;
  }

  if (existingNode.isDirectory) {
    log(`[updateFileNodeOnChange] Skipping directory node`);
    return false;
  }

  // Save old dependencies for diffing
  const oldDeps = new Set(existingNode.dependencies || []);

  // Re-analyze file content
  const { dependencies: newDeps, packageDependencies: newPkgDeps } = await analyzeNewFile(normalizedFilePath, activeProjectRoot);
  const newDepsSet = new Set(newDeps);

  // Update mtime
  try {
    const stat = fs.statSync(normalizedFilePath);
    existingNode.mtime = stat.mtimeMs;
  } catch { /* ignore stat errors */ }

  // Check if anything actually changed
  const depsChanged = oldDeps.size !== newDepsSet.size ||
    [...oldDeps].some(d => !newDepsSet.has(d)) ||
    [...newDepsSet].some(d => !oldDeps.has(d));

  const pkgDepsChanged = JSON.stringify(existingNode.packageDependencies) !== JSON.stringify(newPkgDeps);

  if (!depsChanged && !pkgDepsChanged) {
    log(`[updateFileNodeOnChange] No dependency changes detected for ${normalizedFilePath}`);
    return false;
  }

  // Update the node's dependencies
  existingNode.dependencies = newDeps;
  existingNode.packageDependencies = newPkgDeps;

  // Diff old vs new deps and update reverse dependency map
  // Removed deps: remove this file from those nodes' dependents[]
  for (const removedDep of oldDeps) {
    if (!newDepsSet.has(removedDep)) {
      const depNode = findNodeByPath(activeFileTree, removedDep);
      if (depNode && depNode.dependents) {
        const idx = depNode.dependents.findIndex(d => normalizePath(d) === normalizedFilePath);
        if (idx > -1) {
          depNode.dependents.splice(idx, 1);
          log(`[updateFileNodeOnChange] Removed ${normalizedFilePath} from dependents of ${removedDep}`);
        }
      }
    }
  }

  // Added deps: add this file to those nodes' dependents[]
  for (const addedDep of newDepsSet) {
    if (!oldDeps.has(addedDep)) {
      const depNode = findNodeByPath(activeFileTree, addedDep);
      if (depNode) {
        if (!depNode.dependents) depNode.dependents = [];
        if (!depNode.dependents.some(d => normalizePath(d) === normalizedFilePath)) {
          depNode.dependents.push(normalizedFilePath);
          log(`[updateFileNodeOnChange] Added ${normalizedFilePath} to dependents of ${addedDep}`);
        }
      }
    }
  }

  // Recalculate importance for this node and all affected nodes
  const affectedPaths = [normalizedFilePath, ...oldDeps, ...newDepsSet];
  await recalculateImportanceForAffected([...new Set(affectedPaths)], activeFileTree, activeProjectRoot);

  // Persist to SQLite
  upsertFile(existingNode);
  setDependencies(existingNode.path, existingNode.dependencies ?? [], existingNode.packageDependencies ?? []);
  log(`[updateFileNodeOnChange] Persisted updated node to SQLite: ${normalizedFilePath}`);

  log(`[updateFileNodeOnChange] Updated ${normalizedFilePath}: ${newDeps.length} deps, ${newPkgDeps.length} pkg deps`);
  return true;
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

  log(`[addFileNode] Attempting to add file: ${normalizedFilePath} to tree rooted at ${activeFileTree.path}`);

  // 1. Find the parent directory node within the provided active tree
  const parentDir = path.dirname(normalizedFilePath);
  const parentNode = findNodeByPath(activeFileTree, parentDir);

  if (!parentNode || !parentNode.isDirectory) {
    log(`[addFileNode] Could not find parent directory node for: ${normalizedFilePath}`);
    // Optionally: Handle cases where intermediate directories might also need creation
    return;
  }

  // 2. Check if node already exists (should not happen if watcher is correct, but good practice)
  if (parentNode.children?.some(child => normalizePath(child.path) === normalizedFilePath)) {
    log(`[addFileNode] Node already exists: ${normalizedFilePath}`);
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

    // Capture file modification time for freshness tracking
    try {
      const stat = fs.statSync(normalizedFilePath);
      newNode.mtime = stat.mtimeMs;
    } catch { /* ignore stat errors */ }

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

    // 9. Persist to SQLite
    upsertFile(newNode);
    setDependencies(newNode.path, newNode.dependencies ?? [], newNode.packageDependencies ?? []);
    log(`[addFileNode] Persisted node to SQLite: ${normalizedFilePath}`);

    log(`[addFileNode] Successfully added node: ${normalizedFilePath}`);

  } catch (error: any) {
    if (error.code === 'ENOENT') {
       log(`[addFileNode] File not found during add operation (might have been deleted quickly): ${normalizedFilePath}`);
    } else {
       log(`[addFileNode] Error adding file node ${normalizedFilePath}:`, error);
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
  // Check if filePath is a relative path, and if so, resolve it to an absolute path
  let absoluteFilePath = filePath;
  if (!path.isAbsolute(filePath)) {
    absoluteFilePath = path.join(activeProjectRoot, filePath);
    log(`[removeFileNode] Converted relative path "${filePath}" to absolute path "${absoluteFilePath}"`);
  }
  
  const normalizedFilePath = normalizePath(absoluteFilePath);
  log(`[removeFileNode] Attempting to remove file: ${normalizedFilePath} from tree rooted at ${activeFileTree.path}`);

  // Log the current state of the file tree - fix this by converting to string
  // log(`Current file tree state before removal: ${JSON.stringify(activeFileTree, null, 2)}`);

  // 1. Find the node to remove within the provided active tree
  const nodeToRemove = findNodeByPath(activeFileTree, normalizedFilePath);
  
  // If node not found, try looking it up by basename as a fallback
  if (!nodeToRemove || nodeToRemove.isDirectory) {
    log(`[removeFileNode] Initial search failed for: ${normalizedFilePath}`);
    
    // Fallback: Find by basename in case of relative path issues
    const basename = path.basename(normalizedFilePath);
    log(`[removeFileNode] Trying fallback search by basename: ${basename}`);
    
    // Get all file nodes and search by basename
    const allFileNodes = getAllFileNodes(activeFileTree);
    const nodeByName = allFileNodes.find(node => 
      !node.isDirectory && path.basename(node.path) === basename
    );
    
    if (nodeByName) {
      log(`[removeFileNode] Found node by basename: ${nodeByName.path}`);
      // Call removeFileNode recursively with the found absolute path
      return removeFileNode(nodeByName.path, activeFileTree, activeProjectRoot);
    }
    
    // If still not found, report an error
    log(`[removeFileNode] File node not found or is a directory: ${normalizedFilePath}`);
    return;
  }

  log(`[removeFileNode] Found node to remove: ${nodeToRemove.path}`);

  // 2. Find the parent directory node within the provided active tree
  const parentDir = path.dirname(normalizedFilePath);
  const parentNode = findNodeByPath(activeFileTree, parentDir);
  if (!parentNode || !parentNode.isDirectory || !parentNode.children) {
    log(`[removeFileNode] Could not find parent directory node for: ${normalizedFilePath}`);
    return;
  }

  log(`[removeFileNode] Found parent node: ${parentNode.path}`);

  // 3. Store necessary info before removal (Ensure arrays exist)
  const dependenciesToRemoveFrom = [...(nodeToRemove.dependencies ?? [])];
  const dependentsToUpdate = [...(nodeToRemove.dependents ?? [])]; // Files that depended on this node

  // 4. Remove the node from its parent's children array
  const index = parentNode.children.findIndex(child => normalizePath(child.path) === normalizedFilePath);
  if (index > -1) {
    parentNode.children.splice(index, 1);
    log(`[removeFileNode] Node removed from parent's children: ${normalizedFilePath}`);
  } else {
     log(`[removeFileNode] Node not found in parent's children: ${normalizedFilePath}`);
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

  // 8. Delete from SQLite
  deleteFile(normalizedFilePath);
  log(`[removeFileNode] Deleted node from SQLite: ${normalizedFilePath}`);

  log(`[removeFileNode] Successfully removed node: ${normalizedFilePath}`);
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
       importance += Math.min(pkgDeps.length, 1);
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
   log(`[updateDependentsForNewNode] Updating dependents for new node ${newNode.path}`);
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
               log(`[updateDependentsForNewNode] Added ${newNode.path} as dependent for ${depNode.path}`);
           }
       } else {
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
   log(`[updateDependentsAfterRemoval] Updating dependents after removing ${removedNode.path}`);
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
                    log(`[updateDependentsAfterRemoval] Removed ${removedNode.path} from dependents of ${depNode.path}`);
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
   log(`[updateDependersAfterRemoval] Updating dependers after removing ${removedNode.path}`);
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
                   log(`[updateDependersAfterRemoval] Removed dependency on ${removedNode.path} from ${dependerNode.path}`);
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
  log(`[recalculateImportanceForAffected] Recalculating importance for paths: ${JSON.stringify(affectedPaths)}`);

  // Collect all transitively affected nodes using BFS with a visited set
  const visited = new Set<string>();
  const queue = [...new Set(affectedPaths)];

  while (queue.length > 0) {
    const filePath = queue.shift()!;
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    const node = findNodeByPath(activeFileTree, filePath);
    if (node && !node.isDirectory) {
      const oldImportance = node.importance;
      node.importance = calculateNodeImportance(node, activeProjectRoot);
      if (oldImportance !== node.importance) {
        log(`[recalculateImportanceForAffected] Importance for ${node.path} changed from ${oldImportance} to ${node.importance}`);
        // Enqueue this node's dependents for recalculation (transitive propagation)
        for (const depPath of (node.dependents ?? [])) {
          if (!visited.has(depPath)) {
            queue.push(depPath);
          }
        }
      }
    }
  }
}


// --- End of New Functions ---

/**
 * Performs an integrity check comparing the in-memory tree against the live filesystem.
 * Detects stale files (mtime changed), missing files (deleted), and new files (not in tree).
 * @param fileTree The current in-memory file tree.
 * @param projectRoot The project root directory.
 * @returns Lists of stale, missing, and new file paths.
 */
export async function integrityCheck(
    fileTree: FileNode,
    projectRoot: string
): Promise<{ staleFiles: string[], missingFiles: string[], newFiles: string[] }> {
  const staleFiles: string[] = [];
  const missingFiles: string[] = [];
  const newFiles: string[] = [];

  // 1. Collect all file paths and mtimes from the in-memory tree
  const treeFiles = getAllFileNodes(fileTree);
  const treePathSet = new Set<string>();

  for (const node of treeFiles) {
    const normalizedPath = normalizePath(node.path);
    treePathSet.add(normalizedPath);

    try {
      const stat = fs.statSync(node.path);
      // Check if mtime has changed (with 1ms tolerance for float precision)
      if (node.mtime !== undefined && Math.abs(stat.mtimeMs - node.mtime) > 1) {
        staleFiles.push(normalizedPath);
      }
    } catch {
      // File doesn't exist on disk anymore
      missingFiles.push(normalizedPath);
    }
  }

  // 2. Walk the filesystem to find new files not in the tree
  // Use a lightweight recursive readdir (not full scanDirectory)
  async function walkDir(dir: string): Promise<void> {
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const normalizedFullPath = normalizePath(fullPath);

        // Skip excluded paths
        if (isExcluded(fullPath, projectRoot, entry.isDirectory())) continue;

        if (entry.isDirectory()) {
          await walkDir(fullPath);
        } else {
          if (!treePathSet.has(normalizedFullPath)) {
            newFiles.push(normalizedFullPath);
          }
        }
      }
    } catch {
      // Ignore directories we can't read
    }
  }

  await walkDir(projectRoot);

  if (staleFiles.length + missingFiles.length + newFiles.length > 0) {
    log(`[integrityCheck] Found: ${staleFiles.length} stale, ${missingFiles.length} missing, ${newFiles.length} new files`);
  }

  return { staleFiles, missingFiles, newFiles };
}

/**
 * Recursively calculates importance scores for all file nodes in the tree.
 * Uses calculateNodeImportance for individual node calculation.
 */

export async function excludeAndRemoveFile(filePath: string, activeFileTree: FileNode, activeProjectRoot: string): Promise<void> {
  // Normalize the file path
  let absoluteFilePath = filePath;
  if (!path.isAbsolute(filePath)) {
    absoluteFilePath = path.join(activeProjectRoot, filePath);
    log(`[excludeAndRemoveFile] Converted relative path "${filePath}" to absolute path "${absoluteFilePath}"`);
  }
  
  const normalizedFilePath = normalizePath(absoluteFilePath);
  log(`[excludeAndRemoveFile] Excluding and removing file: ${normalizedFilePath}`);

  // Add the file path to the exclusion patterns - use basename pattern to exclude anywhere it appears
  const basenamePattern = `**/${path.basename(normalizedFilePath)}`;
  log(`[excludeAndRemoveFile] Adding exclusion pattern: ${basenamePattern}`);
  addExclusionPattern(basenamePattern);

  // Remove the file node from the file tree
  await removeFileNode(normalizedFilePath, activeFileTree, activeProjectRoot);
  log(`[excludeAndRemoveFile] File removed from tree and added to exclusion patterns: ${normalizedFilePath}`);
}
