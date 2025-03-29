// Define concrete classes rather than just interfaces to ensure proper compilation
export class FileNode {
  path: string = '';
  name: string = '';
  isDirectory: boolean = false;
  children?: FileNode[];
  dependencies?: string[];   // Outgoing dependencies (local files this file imports)
  packageDependencies?: string[]; // Outgoing dependencies (package files this file imports)
  dependents?: string[];     // Incoming dependencies (files that import this file)
  importance?: number;       // 0-10 scale
  summary?: string;          // Human-readable summary of the file
  mermaidDiagram?: MermaidDiagram; // Optional Mermaid diagram for this node
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
  filename: string = '';        // Name of the JSON file to store the file tree
  baseDirectory: string = '';   // Base directory to scan
  projectRoot: string = '';     // Project root directory (where files will be stored)
  lastUpdated?: Date;      // When the file tree was last updated
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
  } = {
    highImportance: '',
    mediumImportance: '',
    lowImportance: ''
  };
  edgeColors: {
    dependency: string;        // Color for dependency relationships
    directory: string;        // Color for directory relationships
    circular: string;         // Color for circular dependencies
  } = {
    dependency: '',
    directory: '',
    circular: ''
  };
  nodeShapes: {
    file: string;            // Shape for file nodes
    directory: string;       // Shape for directory nodes
    important: string;       // Shape for high-importance nodes
  } = {
    file: '',
    directory: '',
    important: ''
  };
}

export class MermaidDiagramConfig {
  style: 'default' | 'dependency' | 'directory' | 'hybrid' = 'default';
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

export class MermaidDiagramStats {
  nodeCount: number = 0;         // Total number of nodes in diagram
  edgeCount: number = 0;         // Total number of edges
  maxDepth: number = 0;         // Maximum depth in the tree
  importantFiles: number = 0;   // Number of files with importance >= minImportance
  circularDeps: number = 0;     // Number of circular dependencies
}

export class MermaidDiagram {
  code: string = '';             // The Mermaid diagram code
  style: MermaidDiagramStyle = new MermaidDiagramStyle();
  stats: MermaidDiagramStats = new MermaidDiagramStats();
  timestamp: Date = new Date();  // When the diagram was generated
}