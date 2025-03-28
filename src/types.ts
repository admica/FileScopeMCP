export interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children?: FileNode[];
  dependencies?: string[];   // Outgoing dependencies (local files this file imports)
  packageDependencies?: string[]; // Outgoing dependencies (package files this file imports)
  dependents?: string[];     // Incoming dependencies (files that import this file)
  importance?: number;       // 0-10 scale
  summary?: string;          // Human-readable summary of the file
  mermaidDiagram?: MermaidDiagram; // Optional Mermaid diagram for this node
}

export interface SimpleFileNode {
  path: string;
  isDirectory: boolean;
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

export interface FileTreeConfig {
  filename: string;        // Name of the JSON file to store the file tree
  baseDirectory: string;   // Base directory to scan
  projectRoot: string;     // Project root directory (where files will be stored)
  lastUpdated?: Date;      // When the file tree was last updated
}

export interface FileTreeStorage {
  config: FileTreeConfig;
  fileTree: FileNode;
}

export interface MermaidDiagramStyle {
  nodeColors: {
    highImportance: string;    // Color for nodes with importance >= 8
    mediumImportance: string;  // Color for nodes with importance >= 5
    lowImportance: string;     // Color for nodes with importance < 5
  };
  edgeColors: {
    dependency: string;        // Color for dependency relationships
    directory: string;        // Color for directory relationships
    circular: string;         // Color for circular dependencies
  };
  nodeShapes: {
    file: string;            // Shape for file nodes
    directory: string;       // Shape for directory nodes
    important: string;       // Shape for high-importance nodes
  };
}

export interface MermaidDiagramConfig {
  style: 'default' | 'dependency' | 'directory' | 'hybrid';
  maxDepth?: number;         // Maximum depth for directory trees
  minImportance?: number;    // Only show files above this importance (0-10)
  showDependencies?: boolean; // Whether to show dependency relationships
  showPackageDeps?: boolean; // Whether to show package dependencies
  customStyle?: Partial<MermaidDiagramStyle>;
  layout?: {
    direction?: 'TB' | 'BT' | 'LR' | 'RL'; // Graph direction
    rankSpacing?: number;    // Space between ranks
    nodeSpacing?: number;    // Space between nodes
  };
}

export interface MermaidDiagramStats {
  nodeCount: number;         // Total number of nodes in diagram
  edgeCount: number;         // Total number of edges
  maxDepth: number;         // Maximum depth in the tree
  importantFiles: number;   // Number of files with importance >= minImportance
  circularDeps: number;     // Number of circular dependencies
}

export interface MermaidDiagram {
  code: string;             // The Mermaid diagram code
  style: MermaidDiagramStyle;
  stats: MermaidDiagramStats;
  timestamp: Date;          // When the diagram was generated
}