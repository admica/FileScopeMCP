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
  private nodes: Map<string, string>; // path -> nodeId
  private nodeInfo: Map<string, { label: string, color: string, isDefined: boolean }>; // nodeId -> info
  private edges: Map<string, {source: string, target: string, type: string}>; // edgeKey -> edge info
  private edgeCount: number;
  private stats: MermaidDiagramStats;
  private style: MermaidDiagramStyle;
  private definedNodes: Set<string>; // Set of node IDs that have been defined

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
    this.nodeInfo = new Map();
    this.edges = new Map();
    this.edgeCount = 0;
    this.definedNodes = new Set();
    this.stats = {
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      importantFiles: 0,
      circularDeps: 0
    };
  }

  // Generate or retrieve a node ID for a given file path
  private getNodeId(filePath: string): string {
    // If we already have an ID for this path, return it
    if (this.nodes.has(filePath)) {
      return this.nodes.get(filePath)!;
    }
    
    // Otherwise, generate a new ID and store it
    const id = `node${this.nodes.size}`;
    this.nodes.set(filePath, id);
    
    // Initialize basic info for this node (will be refined later if it's a FileNode)
    const basename = path.basename(filePath);
    this.nodeInfo.set(id, {
      label: basename.length <= 20 ? basename : basename.substring(0, 17) + '...',
      color: this.style.nodeColors.lowImportance,
      isDefined: false // Not yet defined in output
    });
    
    return id;
  }

  // Update node information based on the actual FileNode
  private updateNodeInfo(node: FileNode): void {
    const nodeId = this.getNodeId(node.path);
    const info = this.nodeInfo.get(nodeId)!;
    
    // Update the label to the proper node label
    info.label = this.getNodeLabel(node);
    
    // Determine proper color based on importance
    if (node.isDirectory) {
      info.color = this.style.nodeColors.mediumImportance;
    } else if (node.importance && node.importance >= 8) {
      info.color = this.style.nodeColors.highImportance;
    } else if (node.importance && node.importance >= 5) {
      info.color = this.style.nodeColors.mediumImportance;
    } else {
      info.color = this.style.nodeColors.lowImportance;
    }
  }

  private getNodeLabel(node: FileNode): string {
    const maxLength = 20;
    const name = node.name;
    // Escape quotes and special characters to prevent Mermaid syntax errors
    const escapedName = name.replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    return escapedName.length <= maxLength ? escapedName : escapedName.substring(0, maxLength - 3) + '...';
  }

  // First pass: Collect all nodes that will be in the diagram
  private collectAllNodes(node: FileNode, depth: number = 0): void {
    if (depth >= (this.config.maxDepth || 3)) return;
    
    // Register this node and update its info
    const nodeId = this.getNodeId(node.path);
    this.updateNodeInfo(node);
    
    // Process children recursively to collect all nodes
    if (node.children) {
      for (const child of node.children) {
        // Skip files with low importance if minImportance is set
        if (!child.isDirectory && 
            this.config.minImportance && 
            (child.importance || 0) < this.config.minImportance) {
          continue;
        }
        
        // Add this child node and its descendants
        this.collectAllNodes(child, depth + 1);
        
        // Also add an edge from parent to child
        this.addEdge(node.path, child.path, 'directory');
      }
    }
    
    // Collect dependency nodes
    if (this.config.showDependencies && !node.isDirectory && node.dependencies) {
      for (const depPath of node.dependencies) {
        // Just register the dependency path to get a node ID
        // (even if we don't have a FileNode object for it)
        this.getNodeId(depPath);
        
        // Add a dependency edge
        this.addEdge(node.path, depPath, 'dependency');
      }
    }
  }
  
  // Add an edge between two nodes
  private addEdge(sourcePath: string, targetPath: string, type: string): void {
    const sourceId = this.getNodeId(sourcePath);
    const targetId = this.getNodeId(targetPath);
    const edgeKey = `${sourceId}-->${targetId}`;
    
    if (!this.edges.has(edgeKey)) {
      this.edges.set(edgeKey, {
        source: sourceId,
        target: targetId,
        type: type
      });
    }
  }
  
  // Generate the node definition lines for the diagram
  private generateNodeDefinition(nodeId: string): string[] {
    if (this.definedNodes.has(nodeId)) {
      return []; // Already defined
    }
    
    const info = this.nodeInfo.get(nodeId)!;
    const lines: string[] = [];
    
    // Add node definition - remove quotes that break Mermaid 9.4.3 compatibility
    lines.push(`${nodeId}[${info.label}]`);
    lines.push(`style ${nodeId} fill:${info.color},stroke:#2d3436`);
    
    // Mark as defined in output
    this.definedNodes.add(nodeId);
    info.isDefined = true;
    this.stats.nodeCount++;
    
    return lines;
  }

  public generate(): MermaidDiagram {
    // Reset state for a clean generation
    this.nodes = new Map();
    this.nodeInfo = new Map();
    this.edges = new Map();
    this.edgeCount = 0;
    this.definedNodes = new Set();
    this.stats = {
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      importantFiles: 0,
      circularDeps: 0
    };
    
    // Use a compatible Mermaid syntax format - FIXED: removed semicolon from graph declaration
    const direction = this.config.layout?.direction || 'TB';
    const lines: string[] = [
      `graph ${direction}`
    ];

    // Removed nodeSep and rankSep directives - these are not valid in Mermaid graph syntax
    // These should be handled via Mermaid initialization configuration instead
    
    // PHASE 1: Collect all nodes and edges that will be in the diagram
    this.collectAllNodes(this.fileTree);
    
    // PHASE 2: Generate all node definitions
    const allNodeIds = new Set<string>();
    
    // First, add all nodes that are sources or targets in edges
    for (const edge of this.edges.values()) {
      allNodeIds.add(edge.source);
      allNodeIds.add(edge.target);
    }
    
    // Generate definitions for all nodes
    const nodeLines: string[] = [];
    for (const nodeId of allNodeIds) {
      nodeLines.push(...this.generateNodeDefinition(nodeId));
    }
    
    lines.push(...nodeLines);
    
    // PHASE 3: Generate all edges
    this.edgeCount = 0;
    const edgeLines: string[] = [];
    
    for (const edge of this.edges.values()) {
      // Only include edges where both nodes exist
      if (this.nodeInfo.has(edge.source) && this.nodeInfo.has(edge.target)) {
        edgeLines.push(`${edge.source} --> ${edge.target}`);
        
        // Choose edge color based on type
        const color = edge.type === 'dependency' 
          ? this.style.edgeColors.dependency 
          : this.style.edgeColors.directory;
          
        edgeLines.push(`linkStyle ${this.edgeCount} stroke:${color}`);
        this.edgeCount++;
        this.stats.edgeCount++;
        
        if (edge.type === 'dependency') {
          this.stats.importantFiles++;
        }
      }
    }
    
    lines.push(...edgeLines);

    return {
      code: lines.join('\n'),
      style: this.style,
      stats: this.stats,
      timestamp: new Date()
    };
  }
} 