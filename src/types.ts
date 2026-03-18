import { getProjectRoot } from './global-state.js';
import type { LLMConfig } from './llm/types.js';

// File watching configuration
export interface FileWatchingConfig {
  enabled: boolean;               // Master switch for file watching
  ignoreDotFiles: boolean;        // Whether to ignore files/dirs starting with a dot
  autoRebuildTree: boolean;       // Whether to auto-rebuild the tree on file changes
  maxWatchedDirectories: number;  // Limit to prevent watching too many directories
  watchForNewFiles: boolean;      // Watch for file additions
  watchForDeleted: boolean;       // Watch for file deletions
  watchForChanged: boolean;       // Watch for file modifications
}

// Configuration type for the application
export interface Config {
  baseDirectory: string;
  excludePatterns: string[];
  fileWatching?: FileWatchingConfig;
  version: string;
  llm?: LLMConfig;
}

// Define concrete classes rather than just interfaces to ensure proper compilation
export class FileNode {
  path: string = '';
  name: string = '';
  isDirectory: boolean = false;
  children?: FileNode[];
  dependencies?: string[];   // Outgoing dependencies (local files this file imports)
  packageDependencies?: PackageDependency[]; // Outgoing dependencies (package files this file imports)
  dependents?: string[];     // Incoming dependencies (files that import this file)
  importance?: number;       // 0-10 scale
  summary?: string;          // Human-readable summary of the file
  mtime?: number;            // File modification time (ms since epoch) for freshness tracking
}

// New type for package dependencies with version information
export class PackageDependency {
  name: string = '';         // Package name (e.g., 'react' or '@types/node')
  version?: string;          // Version if available (e.g., '^17.0.2')
  path: string = '';         // Full resolved path
  scope?: string;            // Package scope (e.g., '@types' for '@types/node')
  isDevDependency?: boolean; // Whether this is a dev dependency
  
  // Helper to check for unresolved template literals
  private static isUnresolvedTemplateLiteral(str: string): boolean {
    return typeof str === 'string' && 
           str.includes('${') && 
           str.includes('}');
  }
  
  // Create a PackageDependency from a path string
  static fromPath(path: string): PackageDependency {
    const pkg = new PackageDependency();
    pkg.path = path;
    
    // Skip processing if the path contains an unresolved template literal
    if (this.isUnresolvedTemplateLiteral(path)) {
      return pkg; // Return empty package dependency without setting name
    }
    
    // Extract package name from path
    if (path.includes('node_modules')) {
      const parts = path.split('node_modules/');
      if (parts.length > 1) {
        const pkgPart = parts[1].split('/')[0];
        
        // Skip setting name if pkgPart is a template literal
        if (this.isUnresolvedTemplateLiteral(pkgPart)) {
          return pkg;
        }
        
        // Handle scoped packages like @types/node
        if (pkgPart.startsWith('@')) {
          const scopedParts = parts[1].split('/');
          if (scopedParts.length > 1) {
            pkg.scope = scopedParts[0];
            pkg.name = `${scopedParts[0]}/${scopedParts[1]}`;
          }
        } else {
          pkg.name = pkgPart;
        }
        
        // For paths like node_modules/firebase/app, use firebase as the package name
        if (parts[1].includes('/') && !pkgPart.startsWith('@')) {
          const subparts = parts[1].split('/');
          if (subparts.length > 1) {
            pkg.name = subparts[0];
          }
        }
      }
    } else {
      // For directly specified package imports
      const parts = path.split('/');
      if (parts.length > 0) {
        const lastPart = parts[parts.length - 1];
        
        if (path.includes('@supabase') || path.includes('@types') || path.includes('@firebase')) {
          // Handle scoped package references in the path
          for (const part of parts) {
            if (part.startsWith('@')) {
              const scopeName = part;
              const nextIndex = parts.indexOf(part) + 1;
              if (nextIndex < parts.length) {
                const scopedPackage = parts[nextIndex];
                pkg.scope = scopeName;
                pkg.name = `${scopeName}/${scopedPackage}`;
                break;
              }
            }
          }
        } else if (parts[0].startsWith('@')) {
          // Scoped package
          if (parts.length > 1) {
            pkg.scope = parts[0];
            pkg.name = `${parts[0]}/${parts[1]}`;
          }
        } else {
          // Extract package name from the path
          // Check for common package names in the path
          const commonPkgs = ['react', 'axios', 'uuid', 'yup', 'express', 'firebase', 'date-fns'];
          
          for (const commonPkg of commonPkgs) {
            if (path.includes(`/${commonPkg}`) || path.includes(`\\${commonPkg}`)) {
              pkg.name = commonPkg;
              break;
            }
          }
          
          // If no common package was found, use the last part of the path
          if (!pkg.name && lastPart) {
            // Avoid using lastPart if it's a template literal
            if (!this.isUnresolvedTemplateLiteral(lastPart)) {
              pkg.name = lastPart;
            }
          }
        }
      }
    }
    
    // Final sanity check on the name
    if (this.isUnresolvedTemplateLiteral(pkg.name)) {
      pkg.name = ''; // Clear the name if it's a template literal
    }
    
    return pkg;
  }
}

export class SimpleFileNode {
  path: string = '';
  isDirectory: boolean = false;
  children?: SimpleFileNode[];
}

export interface ToolResponse {
  content: Array<
    | { type: "text"; text: string; [key: string]: unknown }
    | { type: "image"; mimeType: string; data: string; [key: string]: unknown }
    | { type: "resource"; resource: { uri: string; text: string; mimeType?: string; [key: string]: unknown }; [key: string]: unknown }
  >;
  _meta?: { [key: string]: unknown };
  isError?: boolean;
  [key: string]: unknown;
}

export class FileTreeConfig {
  filename: string = 'default-tree.json';  // Safe default filename
  baseDirectory: string = getProjectRoot();  // Use project root as fallback
  projectRoot: string = getProjectRoot();    // Always use project root
  lastUpdated?: Date = new Date();         // Current time as default
}

export class FileTreeStorage {
  config: FileTreeConfig = new FileTreeConfig();
  fileTree: FileNode = new FileNode();
}

