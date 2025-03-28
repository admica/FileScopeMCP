export interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children?: FileNode[];
  dependencies?: string[];   // Outgoing dependencies (local files this file imports)
  packageDependencies?: string[]; // Outgoing dependencies (package files this file imports)
  dependents?: string[];     // Incoming dependencies (files that import this file)
  importance?: number; // 0-10 scale
  summary?: string;    // Human-readable summary of the file
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
  lastUpdated?: Date;      // When the file tree was last updated
}

export interface FileTreeStorage {
  config: FileTreeConfig;
  fileTree: FileNode;
}