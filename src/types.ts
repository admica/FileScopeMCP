import { getProjectRoot } from './global-state.js';

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
  mermaidDiagram?: MermaidDiagram; // Optional Mermaid diagram for this node
}

// New type for package dependencies with version information
export class PackageDependency {
  name: string = '';         // Package name (e.g., 'react' or '@types/node')
  version?: string;          // Version if available (e.g., '^17.0.2')
  path: string = '';         // Full resolved path
  scope?: string;            // Package scope (e.g., '@types' for '@types/node')
  isDevDependency?: boolean; // Whether this is a dev dependency
  
  // Create a PackageDependency from a path string
  static fromPath(path: string): PackageDependency {
    const pkg = new PackageDependency();
    pkg.path = path;
    
    // Extract package name from path
    if (path.includes('node_modules')) {
      const parts = path.split('node_modules/');
      if (parts.length > 1) {
        const pkgPart = parts[1].split('/')[0];
        
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
            pkg.name = lastPart;
          }
        }
      }
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

export class MermaidDiagramStyle {
  nodeColors: {
    highImportance: string;    // Color for nodes with importance >= 8
    mediumImportance: string;  // Color for nodes with importance >= 5
    lowImportance: string;     // Color for nodes with importance < 5
    package: string;           // Color for package dependencies
    packageScope: string;      // Color for package scope groups
  } = {
    highImportance: '',
    mediumImportance: '',
    lowImportance: '',
    package: '',
    packageScope: ''
  };
  edgeColors: {
    dependency: string;        // Color for dependency relationships
    directory: string;        // Color for directory relationships
    circular: string;         // Color for circular dependencies
    package: string;          // Color for package dependency relationships
  } = {
    dependency: '',
    directory: '',
    circular: '',
    package: ''
  };
  nodeShapes: {
    file: string;            // Shape for file nodes
    directory: string;       // Shape for directory nodes
    important: string;       // Shape for high-importance nodes
    package: string;         // Shape for package nodes
    packageScope: string;    // Shape for package scope nodes
  } = {
    file: '',
    directory: '',
    important: '',
    package: '',
    packageScope: ''
  };
}

export class MermaidDiagramConfig {
  style: 'default' | 'dependency' | 'directory' | 'hybrid' | 'package-deps' = 'default';
  maxDepth?: number;         // Maximum depth for directory trees
  minImportance?: number;    // Only show files above this importance (0-10)
  showDependencies?: boolean; // Whether to show dependency relationships
  showPackageDeps?: boolean; // Whether to show package dependencies
  packageGrouping?: boolean; // Whether to group packages by scope
  excludePackages?: string[]; // Packages to exclude from diagram
  includeOnlyPackages?: string[]; // Only include these packages (if specified)
  autoGroupThreshold?: number; // Auto-group nodes when parent has more than this many direct children (default: 8)
  customStyle?: Partial<MermaidDiagramStyle>;
  layout?: {
    direction?: 'TB' | 'BT' | 'LR' | 'RL'; // Graph direction
    rankSpacing?: number;    // Space between ranks
    nodeSpacing?: number;    // Space between nodes
  };
}

export class MermaidDiagramStats {
  nodeCount: number = 0;         // Total number of nodes in diagram
  edgeCount: number = 0;         // Total number of edges
  maxDepth: number = 0;         // Maximum depth in the tree
  importantFiles: number = 0;   // Number of files with importance >= minImportance
  circularDeps: number = 0;     // Number of circular dependencies
  packageCount: number = 0;     // Number of package dependencies
  packageScopeCount: number = 0; // Number of package scopes
}

export class MermaidDiagram {
  code: string = '';             // The Mermaid diagram code
  style: MermaidDiagramStyle = new MermaidDiagramStyle();
  stats: MermaidDiagramStats = new MermaidDiagramStats();
  timestamp: Date = new Date();  // When the diagram was generated
}

export type GroupingRuleType = 'directory' | 'package' | 'dependency' | 'custom';

export interface GroupingRule {
  type: GroupingRuleType;
  condition: (nodes: FileNode[]) => boolean;
  groupBy: (nodes: FileNode[]) => Map<string, FileNode[]>;
  threshold: number;
  description: string;  // For debugging and logging
}