import { 
  FileNode, 
  MermaidDiagram, 
  MermaidDiagramConfig, 
  MermaidDiagramStyle, 
  MermaidDiagramStats 
} from './types.js';
import path from 'path';

const DEFAULT_STYLE: MermaidDiagramStyle = {
  nodeColors: {
    highImportance: '#ff7675',    // Soft red for high importance
    mediumImportance: '#74b9ff',  // Soft blue for medium importance
    lowImportance: '#81ecec'      // Soft cyan for low importance
  },
  edgeColors: {
    dependency: '#636e72',        // Grey for dependencies
    directory: '#2d3436',        // Dark grey for directory structure
    circular: '#e17055'          // Orange for circular dependencies
  },
  nodeShapes: {
    file: 'rect',               // Rectangle for files
    directory: 'folder',        // Folder shape for directories
    important: 'hexagon'        // Hexagon for important files
  }
};

const DEFAULT_CONFIG: MermaidDiagramConfig = {
  style: 'hybrid',
  maxDepth: 5,
  minImportance: 0,
  showDependencies: true,
  showPackageDeps: false,
  layout: {
    direction: 'TB',
    rankSpacing: 50,
    nodeSpacing: 40
  }
};

export class MermaidGenerator {
  private config: MermaidDiagramConfig;
  private fileTree: FileNode;
  private nodes: Map<string, string>;  // Maps file paths to node IDs
  private edges: Set<string>;          // Tracks unique edges
  private stats: MermaidDiagramStats;
  private style: MermaidDiagramStyle;
  private circularDeps: Set<string>;   // Tracks circular dependencies

  constructor(fileTree: FileNode, config?: Partial<MermaidDiagramConfig>) {
    this.fileTree = fileTree;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.style = { ...DEFAULT_STYLE, ...(config?.customStyle || {}) };
    this.nodes = new Map();
    this.edges = new Set();
    this.circularDeps = new Set();
    this.stats = {
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      importantFiles: 0,
      circularDeps: 0
    };
  }

  /**
   * Generates a unique node ID for Mermaid diagrams
   */
  private generateNodeId(filePath: string): string {
    if (this.nodes.has(filePath)) {
      return this.nodes.get(filePath)!;
    }
    const id = `node${this.nodes.size}`;
    this.nodes.set(filePath, id);
    return id;
  }

  /**
   * Gets the display name for a node (shortened if needed)
   */
  private getNodeLabel(node: FileNode): string {
    const maxLength = 20;
    const name = node.name;
    if (name.length <= maxLength) return name;
    return name.substring(0, maxLength - 3) + '...';
  }

  /**
   * Gets the style for a node based on its type and importance
   */
  private getNodeStyle(node: FileNode): string {
    const importance = node.importance || 0;
    let color = this.style.nodeColors.lowImportance;
    let shape = node.isDirectory ? this.style.nodeShapes.directory : this.style.nodeShapes.file;

    if (importance >= 8) {
      color = this.style.nodeColors.highImportance;
      shape = this.style.nodeShapes.important;
    } else if (importance >= 5) {
      color = this.style.nodeColors.mediumImportance;
    }

    return `style ${this.generateNodeId(node.path)} fill:${color},stroke:#2d3436`;
  }

  /**
   * Checks if a dependency relationship creates a circular reference
   */
  private isCircularDependency(from: string, to: string, visited: Set<string> = new Set()): boolean {
    if (visited.has(to)) return true;
    visited.add(from);

    const toNode = this.findNode(to);
    if (!toNode || !toNode.dependencies) return false;

    for (const dep of toNode.dependencies) {
      if (this.isCircularDependency(to, dep, new Set(visited))) {
        return true;
      }
    }

    return false;
  }

  /**
   * Finds a node in the tree by path
   */
  private findNode(path: string): FileNode | null {
    const findNodeRecursive = (node: FileNode, targetPath: string): FileNode | null => {
      if (node.path === targetPath) return node;
      if (!node.children) return null;

      for (const child of node.children) {
        const found = findNodeRecursive(child, targetPath);
        if (found) return found;
      }

      return null;
    };

    return findNodeRecursive(this.fileTree, path);
  }

  /**
   * Generates the Mermaid diagram code for directory structure
   */
  private generateDirectoryStructure(node: FileNode, depth: number = 0): string[] {
    if (depth > (this.config.maxDepth || 5)) return [];
    this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);

    const lines: string[] = [];
    const nodeId = this.generateNodeId(node.path);
    const label = this.getNodeLabel(node);
    
    // Add node
    lines.push(`${nodeId}["${label}"]`);
    lines.push(this.getNodeStyle(node));
    this.stats.nodeCount++;

    // Process children
    if (node.children) {
      for (const child of node.children) {
        const childId = this.generateNodeId(child.path);
        // Add directory edge
        const edgeKey = `${nodeId}-->${childId}`;
        if (!this.edges.has(edgeKey)) {
          lines.push(`${nodeId} --> ${childId}`);
          lines.push(`linkStyle ${this.edges.size} stroke:${this.style.edgeColors.directory}`);
          this.edges.add(edgeKey);
          this.stats.edgeCount++;
        }
        lines.push(...this.generateDirectoryStructure(child, depth + 1));
      }
    }

    return lines;
  }

  /**
   * Generates the Mermaid diagram code for dependencies
   */
  private generateDependencyRelationships(node: FileNode): string[] {
    const lines: string[] = [];
    const nodeId = this.generateNodeId(node.path);

    // Process dependencies if showing them and node meets importance threshold
    if (this.config.showDependencies && 
        (!this.config.minImportance || (node.importance || 0) >= this.config.minImportance)) {
      
      // Local dependencies
      if (node.dependencies) {
        for (const dep of node.dependencies) {
          const depNode = this.findNode(dep);
          if (depNode) {
            const depId = this.generateNodeId(dep);
            const edgeKey = `${nodeId}-->${depId}`;
            
            // Check for circular dependency
            if (this.isCircularDependency(node.path, dep)) {
              this.circularDeps.add(edgeKey);
              this.stats.circularDeps++;
            }

            if (!this.edges.has(edgeKey)) {
              lines.push(`${nodeId} --> ${depId}`);
              lines.push(`linkStyle ${this.edges.size} stroke:${
                this.circularDeps.has(edgeKey) 
                  ? this.style.edgeColors.circular 
                  : this.style.edgeColors.dependency
              }`);
              this.edges.add(edgeKey);
              this.stats.edgeCount++;
            }
          }
        }
      }

      // Package dependencies if enabled
      if (this.config.showPackageDeps && node.packageDependencies) {
        for (const pkg of node.packageDependencies) {
          const pkgId = this.generateNodeId(pkg);
          const edgeKey = `${nodeId}-->${pkgId}`;
          if (!this.edges.has(edgeKey)) {
            lines.push(`${pkgId}["📦 ${path.basename(pkg)}"]`);
            lines.push(`style ${pkgId} fill:#dfe6e9,stroke:#b2bec3`);
            lines.push(`${nodeId} --> ${pkgId}`);
            lines.push(`linkStyle ${this.edges.size} stroke:${this.style.edgeColors.dependency},stroke-dasharray: 5 5`);
            this.edges.add(edgeKey);
            this.stats.edgeCount++;
            this.stats.nodeCount++;
          }
        }
      }
    }

    // Process children recursively
    if (node.children) {
      for (const child of node.children) {
        lines.push(...this.generateDependencyRelationships(child));
      }
    }

    return lines;
  }

  /**
   * Generates a complete Mermaid diagram
   */
  public generate(): MermaidDiagram {
    const lines: string[] = [
      'graph ' + (this.config.layout?.direction || 'TB'),
      '  %% Node definitions and directory structure'
    ];

    // Generate directory structure first
    lines.push(...this.generateDirectoryStructure(this.fileTree));

    // Add dependencies if enabled
    if (this.config.showDependencies) {
      lines.push('  %% Dependency relationships');
      lines.push(...this.generateDependencyRelationships(this.fileTree));
    }

    // Add layout settings
    if (this.config.layout) {
      const { rankSpacing, nodeSpacing } = this.config.layout;
      if (rankSpacing) lines.unshift(`  rankSep ${rankSpacing}`);
      if (nodeSpacing) lines.unshift(`  nodeSep ${nodeSpacing}`);
    }

    return {
      code: lines.join('\n'),
      style: this.style,
      stats: this.stats,
      timestamp: new Date()
    };
  }
} 