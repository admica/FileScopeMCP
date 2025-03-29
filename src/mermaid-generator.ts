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
    directory: '#dfe4ea',        // Light grey for directory structure
    circular: '#e17055'          // Orange for circular dependencies
  },
  nodeShapes: {
    file: 'rect',               // Rectangle for files
    directory: 'folder',        // Folder shape for directories
    important: 'hexagon'        // Hexagon for important files
  }
};

export class MermaidGenerator {
  private config: MermaidDiagramConfig;
  private fileTree: FileNode;
  private nodes: Map<string, string>;
  private edges: Set<string>;
  private stats: MermaidDiagramStats;
  private style: MermaidDiagramStyle;

  constructor(fileTree: FileNode, config?: Partial<MermaidDiagramConfig>) {
    this.fileTree = fileTree;
    this.config = {
      style: config?.style || 'hybrid',
      maxDepth: config?.maxDepth || 3,
      minImportance: config?.minImportance || 0,
      showDependencies: config?.showDependencies ?? true,
      showPackageDeps: config?.showPackageDeps ?? false,
      layout: {
        direction: config?.layout?.direction || 'TB',
        rankSpacing: config?.layout?.rankSpacing || 50,
        nodeSpacing: config?.layout?.nodeSpacing || 40
      }
    };
    this.style = DEFAULT_STYLE;
    this.nodes = new Map();
    this.edges = new Set();
    this.stats = {
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      importantFiles: 0,
      circularDeps: 0
    };
  }

  private generateNodeId(filePath: string): string {
    if (this.nodes.has(filePath)) {
      return this.nodes.get(filePath)!;
    }
    const id = `node${this.nodes.size}`;
    this.nodes.set(filePath, id);
    return id;
  }

  private getNodeLabel(node: FileNode): string {
    const maxLength = 20;
    const name = node.name;
    return name.length <= maxLength ? name : name.substring(0, maxLength - 3) + '...';
  }

  private getNodeStyle(node: FileNode): string {
    // Determine node color based on importance or directory status
    let color = this.style.nodeColors.lowImportance; // Default for files
    
    if (node.isDirectory) {
      color = this.style.nodeColors.mediumImportance;
    } else if (node.importance && node.importance >= 8) {
      color = this.style.nodeColors.highImportance;
    } else if (node.importance && node.importance >= 5) {
      color = this.style.nodeColors.mediumImportance;
    }
    
    return `style ${this.generateNodeId(node.path)} fill:${color},stroke:#2d3436`;
  }
  
  private generateAllNodes(node: FileNode, depth: number = 0): string[] {
    if (depth >= (this.config.maxDepth || 3)) return [];
    this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);

    const lines: string[] = [];
    const nodeId = this.generateNodeId(node.path);
    
    // Add node definition
    lines.push(`${nodeId}["${this.getNodeLabel(node)}"]`);
    lines.push(this.getNodeStyle(node));
    this.stats.nodeCount++;

    // Process children recursively
    if (node.children) {
      for (const child of node.children) {
        // Skip files with low importance if minImportance is set
        if (!child.isDirectory && 
            this.config.minImportance && 
            (child.importance || 0) < this.config.minImportance) {
          continue;
        }
        
        // Generate node for child
        lines.push(...this.generateAllNodes(child, depth + 1));
      }
    }

    return lines;
  }
  
  private generateAllEdges(node: FileNode, depth: number = 0): string[] {
    if (depth >= (this.config.maxDepth || 3)) return [];

    const lines: string[] = [];
    const nodeId = this.generateNodeId(node.path);
    
    // Process children
    if (node.children) {
      for (const child of node.children) {
        // Skip files with low importance if minImportance is set
        if (!child.isDirectory && 
            this.config.minImportance && 
            (child.importance || 0) < this.config.minImportance) {
          continue;
        }

        const childId = this.generateNodeId(child.path);
        const edgeKey = `${nodeId}-->${childId}`;
        
        if (!this.edges.has(edgeKey)) {
          // Create edge from parent to child
          lines.push(`${nodeId} --> ${childId}`);
          lines.push(`linkStyle ${this.edges.size} stroke:${this.style.edgeColors.directory}`);
          this.edges.add(edgeKey);
          this.stats.edgeCount++;
          
          // Generate edges for child recursively
          lines.push(...this.generateAllEdges(child, depth + 1));
        }
      }
    }
    
    // Add dependency relationships if requested
    if (this.config.showDependencies && !node.isDirectory && node.dependencies) {
      for (const depPath of node.dependencies) {
        if (this.nodes.has(depPath)) {
          const depId = this.generateNodeId(depPath);
          const edgeKey = `${nodeId}-->${depId}`;
          
          if (!this.edges.has(edgeKey)) {
            lines.push(`${nodeId} --> ${depId}`);
            lines.push(`linkStyle ${this.edges.size} stroke:${this.style.edgeColors.dependency}`);
            this.edges.add(edgeKey);
            this.stats.edgeCount++;
            this.stats.importantFiles++;
          }
        }
      }
    }

    return lines;
  }

  public generate(): MermaidDiagram {
    // Reset counters
    this.nodes = new Map();
    this.edges = new Set();
    this.stats = {
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      importantFiles: 0,
      circularDeps: 0
    };
    
    const lines: string[] = [
      // Add graph direction and spacing
      `graph ${this.config.layout?.direction || 'TB'}`,
      `  nodeSep ${this.config.layout?.nodeSpacing || 40}`,
      `  rankSep ${this.config.layout?.rankSpacing || 50}`,
      ''
    ];

    // Phase 1: Generate all node definitions first
    lines.push(...this.generateAllNodes(this.fileTree));
    
    // Phase 2: Then create all edges
    lines.push(...this.generateAllEdges(this.fileTree));

    return {
      code: lines.join('\n'),
      style: this.style,
      stats: this.stats,
      timestamp: new Date()
    };
  }
} 