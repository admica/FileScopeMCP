import { 
  FileNode, 
  MermaidDiagram, 
  MermaidDiagramConfig, 
  MermaidDiagramStyle, 
  MermaidDiagramStats,
  PackageDependency
} from './types.js';
import path from 'path';

const DEFAULT_STYLE: MermaidDiagramStyle = {
  nodeColors: {
    highImportance: '#ff7675',    // Soft red for high importance
    mediumImportance: '#74b9ff',  // Soft blue for medium importance
    lowImportance: '#81ecec',     // Soft cyan for low importance
    package: '#a29bfe',           // Soft purple for packages
    packageScope: '#ffeaa7'       // Soft yellow for package scopes
  },
  edgeColors: {
    dependency: '#636e72',        // Grey for dependencies
    directory: '#dfe4ea',         // Light grey for directory structure
    circular: '#e17055',          // Orange for circular dependencies
    package: '#6c5ce7'            // Purple for package dependencies
  },
  nodeShapes: {
    file: 'rect',                 // Rectangle for files
    directory: 'folder',          // Folder shape for directories
    important: 'hexagon',         // Hexagon for important files
    package: 'ellipse',           // Ellipse for packages
    packageScope: 'stadium'       // Stadium for package scopes
  }
};

export class MermaidGenerator {
  private config: MermaidDiagramConfig;
  private fileTree: FileNode;
  private nodes: Map<string, string>; // path -> nodeId
  private nodeInfo: Map<string, { 
    label: string, 
    color: string, 
    shape: string, 
    isDefined: boolean, 
    isPackage: boolean, 
    isPackageScope: boolean,
    childNodes?: string[],
    isCollapsible?: boolean
  }>; // nodeId -> info
  private edges: Map<string, {source: string, target: string, type: string}>; // edgeKey -> edge info
  private edgeCount: number;
  private stats: MermaidDiagramStats;
  private style: MermaidDiagramStyle;
  private definedNodes: Set<string>; // Set of node IDs that have been defined
  private packageScopes: Map<string, Set<string>>; // scope -> set of package names
  private packageScopeNodes: Map<string, string>; // scope -> nodeId

  constructor(fileTree: FileNode, config?: Partial<MermaidDiagramConfig>) {
    this.fileTree = fileTree;
    this.config = {
      style: config?.style || 'hybrid',
      maxDepth: config?.maxDepth || 3,
      minImportance: config?.minImportance || 0,
      showDependencies: config?.showDependencies ?? true,
      showPackageDeps: config?.showPackageDeps ?? false,
      packageGrouping: config?.packageGrouping ?? true,
      excludePackages: config?.excludePackages || [],
      includeOnlyPackages: config?.includeOnlyPackages || [],
      autoGroupThreshold: config?.autoGroupThreshold || 8,
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
    this.packageScopes = new Map();
    this.packageScopeNodes = new Map();
    this.stats = {
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      importantFiles: 0,
      circularDeps: 0,
      packageCount: 0,
      packageScopeCount: 0
    };
  }

  // Generate or retrieve a node ID for a given file path
  private getNodeId(filePath: string, isPackage: boolean = false, isPackageScope: boolean = false): string {
    // If we already have an ID for this path, return it
    if (this.nodes.has(filePath)) {
      return this.nodes.get(filePath)!;
    }
    
    // Otherwise, generate a new ID and store it
    const id = `node${this.nodes.size}`;
    this.nodes.set(filePath, id);
    
    // Initialize basic info for this node (will be refined later if it's a FileNode)
    const basename = path.basename(filePath);
    const label = basename.length <= 20 ? basename : basename.substring(0, 17) + '...';
    
    // Set different styling based on node type
    let color = this.style.nodeColors.lowImportance;
    let shape = this.style.nodeShapes.file;
    
    if (isPackage) {
      color = this.style.nodeColors.package;
      shape = this.style.nodeShapes.package;
    } else if (isPackageScope) {
      color = this.style.nodeColors.packageScope;
      shape = this.style.nodeShapes.packageScope;
    }
    
    this.nodeInfo.set(id, {
      label,
      color,
      shape,
      isDefined: false, // Not yet defined in output
      isPackage,
      isPackageScope
    });
    
    return id;
  }

  // Get or create a package scope node
  private getPackageScopeNodeId(scope: string): string {
    if (this.packageScopeNodes.has(scope)) {
      return this.packageScopeNodes.get(scope)!;
    }
    
    const nodeId = this.getNodeId(`scope:${scope}`, false, true);
    this.packageScopeNodes.set(scope, nodeId);
    
    // Update node info for the scope node
    const info = this.nodeInfo.get(nodeId)!;
    info.label = scope;
    info.color = this.style.nodeColors.packageScope;
    info.shape = this.style.nodeShapes.packageScope;
    info.isPackageScope = true;
    
    return nodeId;
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
      info.shape = this.style.nodeShapes.directory;
    } else if (node.importance && node.importance >= 8) {
      info.color = this.style.nodeColors.highImportance;
      info.shape = this.style.nodeShapes.important;
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

  // Create node for a package dependency
  private addPackageNode(pkg: PackageDependency): string {
    // Skip excluded packages
    if (this.config.excludePackages && this.config.excludePackages.includes(pkg.name)) {
      return '';
    }
    
    // Only include specific packages if the filter is set
    if (this.config.includeOnlyPackages && 
        this.config.includeOnlyPackages.length > 0 && 
        !this.config.includeOnlyPackages.includes(pkg.name)) {
      return '';
    }
    
    // Generate or get node id for this package
    const nodeId = this.getNodeId(pkg.path, true);
    const info = this.nodeInfo.get(nodeId)!;
    
    // Enhance the label with version if available
    let label = pkg.name;
    if (pkg.version) {
      // Escape caret and parentheses in version strings
      const escapedVersion = pkg.version.replace(/\^/g, '\\^').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
      label += ` v${escapedVersion}`;
    }
    if (pkg.isDevDependency) {
      label += ' [dev]';
    }
    
    // Escape special characters
    label = label.replace(/"/g, '\\"').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
    info.label = label.length <= 30 ? label : label.substring(0, 27) + '...';
    
    // Track package in scope if it has one and grouping is enabled
    if (pkg.scope && this.config.packageGrouping) {
      if (!this.packageScopes.has(pkg.scope)) {
        this.packageScopes.set(pkg.scope, new Set());
        this.stats.packageScopeCount++;
      }
      this.packageScopes.get(pkg.scope)!.add(pkg.name);
      
      // Create edge from scope to package
      const scopeNodeId = this.getPackageScopeNodeId(pkg.scope);
      this.addEdge(scopeNodeId, nodeId, 'directory');
    }
    
    this.stats.packageCount++;
    return nodeId;
  }

  // First pass: Collect all nodes that will be in the diagram
  private collectAllNodes(node: FileNode, depth: number = 0): void {
    if (depth >= (this.config.maxDepth || 3)) return;
    
    // Skip this node if it's for package dependencies diagram and not a file
    if (this.config.style === 'package-deps' && node.isDirectory) {
      // Still process children
      if (node.children) {
        for (const child of node.children) {
          this.collectAllNodes(child, depth + 1);
        }
      }
      return;
    }
    
    // Register this node and update its info
    const nodeId = this.getNodeId(node.path);
    this.updateNodeInfo(node);
    
    // Skip files with low importance if minImportance is set (except in package-deps mode)
    if (!node.isDirectory && 
        this.config.style !== 'package-deps' && 
        this.config.minImportance && 
        (node.importance || 0) < this.config.minImportance) {
      return;
    }
    
    // Process children recursively to collect all nodes
    if (node.children) {
      // Check if we need to create subgroups for better layout
      const threshold = this.config.autoGroupThreshold || 8;
      let needsSubgrouping = node.children.length > threshold && 
                            (this.config.style === 'directory' || this.config.style === 'default');
      
      // If we have too many children, group them by directory or file type
      if (needsSubgrouping) {
        // Group children by directory structure or type
        const groups: Map<string, FileNode[]> = new Map();
        
        // First, collect all the children that pass the filter
        const validChildren: FileNode[] = [];
        for (const child of node.children) {
          if (!child.isDirectory && 
              this.config.style !== 'package-deps' && 
              this.config.minImportance && 
              (child.importance || 0) < this.config.minImportance) {
            continue;
          }
          validChildren.push(child);
        }
        
        // Process directories first
        const directories: FileNode[] = validChildren.filter(child => child.isDirectory);
        if (directories.length > 0 && directories.length <= threshold / 2) {
          // If we have a reasonable number of directories, don't group them
          for (const dir of directories) {
            this.collectAllNodes(dir, depth + 1);
            this.addEdge(node.path, dir.path, 'directory');
          }
        } else if (directories.length > 0) {
          // Group directories if there are many
          groups.set('Directories', directories);
        }
        
        // Then process files by their purpose/type
        const files: FileNode[] = validChildren.filter(child => !child.isDirectory);
        
        // Group files by their purpose or type
        for (const file of files) {
          const ext = path.extname(file.path).toLowerCase();
          let groupKey = '';
          
          // Check file name and extension to determine purpose
          const fileName = path.basename(file.path).toLowerCase();
          
          // Config files
          if (fileName.includes('config') || fileName.includes('.json') || 
              fileName.includes('.yml') || fileName.includes('.yaml') ||
              fileName.includes('.ini') || fileName.includes('.env')) {
            groupKey = 'Configuration';
          } 
          // Source code
          else if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
            // Further categorize source files
            if (fileName.includes('utils') || fileName.includes('helper') || fileName.includes('common')) {
              groupKey = 'Utilities';
            } else if (fileName.includes('test') || fileName.includes('spec')) {
              groupKey = 'Tests';
            } else if (fileName.includes('types') || fileName.includes('interface') || fileName.includes('model')) {
              groupKey = 'Types';
            } else if (fileName.includes('component') || fileName.includes('view') || fileName.includes('page')) {
              groupKey = 'UI Components';
            } else if (fileName.includes('server') || fileName.includes('api') || fileName.includes('service')) {
              groupKey = 'Services';
            } else {
              groupKey = ext.substring(1).toUpperCase() + ' Files'; // e.g., "TS Files"
            }
          }
          // Documentation
          else if (['.md', '.txt', '.pdf', '.doc'].includes(ext)) {
            groupKey = 'Documentation';
          }
          // Default: group by extension
          else {
            groupKey = ext ? ext.substring(1).toUpperCase() + ' Files' : 'Other Files';
          }
          
          if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
          }
          groups.get(groupKey)!.push(file);
        }
        
        // Now process each group separately
        for (const [groupKey, groupChildren] of groups.entries()) {
          // Skip empty groups
          if (groupChildren.length === 0) continue;
          
          // If a group only has one item, don't create a subgroup
          if (groupChildren.length === 1) {
            const child = groupChildren[0];
            this.collectAllNodes(child, depth + 1);
            this.addEdge(node.path, child.path, 'directory');
            continue;
          }
          
          // Create a subgraph for this group
          const groupNodeId = this.getNodeId(`${node.path}_group_${groupKey}`, false, false);
          const groupNode: FileNode = {
            path: `${node.path}_group_${groupKey}`,
            name: groupKey,
            isDirectory: true,
            children: groupChildren
          };
          
          // Update node info for the group
          const info = this.nodeInfo.get(groupNodeId)!;
          info.label = groupKey;
          
          // Connect parent to this group
          this.addEdge(node.path, groupNode.path, 'directory');
          
          // Process children within this group
          for (const child of groupChildren) {
            this.collectAllNodes(child, depth + 1);
            this.addEdge(groupNode.path, child.path, 'directory');
          }
        }
      } else {
        // Standard processing when no grouping is needed
        for (const child of node.children) {
          // Skip files with low importance if minImportance is set
          if (!child.isDirectory && 
              this.config.style !== 'package-deps' && 
              this.config.minImportance && 
              (child.importance || 0) < this.config.minImportance) {
            continue;
          }
          
          // Add this child node and its descendants
          this.collectAllNodes(child, depth + 1);
          
          // Add an edge from parent to child (except in package-deps mode)
          if (this.config.style !== 'package-deps') {
            this.addEdge(node.path, child.path, 'directory');
          }
        }
      }
    }
    
    // Collect dependency nodes
    if (this.config.showDependencies && !node.isDirectory && node.dependencies) {
      for (const depPath of node.dependencies) {
        // Just register the dependency path to get a node ID
        // (even if we don't have a FileNode object for it)
        this.getNodeId(depPath);
        
        // Add a dependency edge (except in package-deps mode)
        if (this.config.style !== 'package-deps') {
          this.addEdge(node.path, depPath, 'dependency');
        }
      }
    }
    
    // Collect package dependencies
    if (this.config.showPackageDeps && !node.isDirectory && node.packageDependencies) {
      for (const pkgDep of node.packageDependencies) {
        // Skip if package has no name
        if (!pkgDep.name) continue;
        
        const packageNodeId = this.addPackageNode(pkgDep);
        if (packageNodeId) {
          // Add edge from file to package
          this.addEdge(node.path, pkgDep.path, 'package');
        }
      }
    }
  }
  
  // Add an edge between two nodes
  private addEdge(sourcePath: string, targetPath: string, type: string): void {
    const sourceId = this.getNodeId(sourcePath);
    let targetId;
    
    // Handle package nodes specially
    if (type === 'package') {
      targetId = this.nodes.get(targetPath);
      if (!targetId) return; // Skip if package node doesn't exist (might be filtered)
    } else {
      targetId = this.getNodeId(targetPath);
    }
    
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
    
    // Add node definition with specified shape based on node type
    lines.push(`${nodeId}[${info.label}]`);
    
    // Add styling based on node type
    lines.push(`style ${nodeId} fill:${info.color},stroke:#2d3436`);
    
    // If the node is a package or package scope, apply special shape
    if (info.isPackage || info.isPackageScope) {
      lines.push(`class ${nodeId} ${info.isPackage ? 'package-node' : 'package-scope-node'}`);
    }
    
    // Mark as defined in output
    this.definedNodes.add(nodeId);
    info.isDefined = true;
    this.stats.nodeCount++;
    
    return lines;
  }

  // Generate package dependency diagram
  private generatePackageDepsView(): string[] {
    const lines: string[] = [];
    
    // Add package scope subgraphs if grouping is enabled
    if (this.config.packageGrouping) {
      for (const [scope, nodeId] of this.packageScopeNodes.entries()) {
        // Only include the scope if it has at least one package
        const packagesInScope = this.packageScopes.get(scope);
        if (packagesInScope && packagesInScope.size > 0) {
          lines.push(`subgraph ${nodeId}[${scope}]`);
          
          // Add each package in this scope
          for (const pkg of packagesInScope) {
            for (const [path, id] of this.nodes.entries()) {
              const info = this.nodeInfo.get(id);
              if (info && info.isPackage && info.label.startsWith(pkg)) {
                lines.push(`  ${id}`);
              }
            }
          }
          
          lines.push(`end`);
          lines.push(`style ${nodeId} fill:${this.style.nodeColors.packageScope},stroke:#2d3436,stroke-dasharray: 5 5`);
        }
      }
    }
    
    return lines;
  }

  public generate(): MermaidDiagram {
    // Reset state for a clean generation
    this.nodes = new Map();
    this.nodeInfo = new Map();
    this.edges = new Map();
    this.edgeCount = 0;
    this.definedNodes = new Set();
    this.packageScopes = new Map();
    this.packageScopeNodes = new Map();
    this.stats = {
      nodeCount: 0,
      edgeCount: 0,
      maxDepth: 0,
      importantFiles: 0,
      circularDeps: 0,
      packageCount: 0,
      packageScopeCount: 0
    };
    
    // PHASE 1: Collect all nodes and edges that will be in the diagram
    this.collectAllNodes(this.fileTree);
    
    // Auto-select layout direction based on diagram structure
    let direction = this.config.layout?.direction || 'TB';
    
    // Check if we should auto-switch to LR based on tree structure
    // For directory style diagrams with many top-level nodes, LR is often better
    const rootNodeId = this.nodes.get(this.fileTree.path);
    if (rootNodeId && !this.config.layout?.direction) {
      let directChildCount = 0;
      
      // Count direct children of root
      for (const edge of this.edges.values()) {
        if (edge.source === rootNodeId && edge.type === 'directory') {
          directChildCount++;
        }
      }
      
      // If many direct children or many grouped nodes, switch to LR layout
      const groupNodeCount = Array.from(this.nodes.keys()).filter(path => path.includes('_group_')).length;
      if (directChildCount > 6 || groupNodeCount > 2) {
        direction = 'LR';
        
        // Also increase node spacing for better readability
        if (!this.config.layout?.nodeSpacing) {
          this.config.layout = this.config.layout || {};
          this.config.layout.nodeSpacing = 60;
        }
      }
    }
    
    // Use a compatible Mermaid syntax format
    const lines: string[] = [
      `graph ${direction}`
    ];
    
    // Add CSS classes for package nodes
    lines.push(`classDef package-node fill:${this.style.nodeColors.package},stroke:#2d3436,shape:${this.style.nodeShapes.package}`);
    lines.push(`classDef package-scope-node fill:${this.style.nodeColors.packageScope},stroke:#2d3436,shape:${this.style.nodeShapes.packageScope}`);
    lines.push(`classDef group-node fill:#f8f9fa30,stroke:#2d3436,stroke-width:2px,stroke-dasharray:5 5,color:#333,rx:5,ry:5`);
    lines.push(`classDef collapsible-node cursor:pointer,stroke:#2d3436,stroke-width:3px`);
    lines.push(`classDef collapsed-group fill:#a8e063,stroke:#2d3436,stroke-width:2px,color:#333,rx:5,ry:5,cursor:pointer`);
    
    // PHASE 2: Generate any package-specific subgraphs and groupings
    if (this.config.style === 'package-deps' || this.config.showPackageDeps) {
      lines.push(...this.generatePackageDepsView());
    }
    
    // PHASE 2.5: Generate file group subgraphs
    const groupSubgraphs = this.generateGroupSubgraphs();
    lines.push(...groupSubgraphs);
    
    // PHASE 3: Generate all node definitions
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
    
    // PHASE 4: Generate all edges
    this.edgeCount = 0;
    const edgeLines: string[] = [];
    
    for (const edge of this.edges.values()) {
      // Only include edges where both nodes exist
      if (this.nodeInfo.has(edge.source) && this.nodeInfo.has(edge.target)) {
        edgeLines.push(`${edge.source} --> ${edge.target}`);
        
        // Choose edge color based on type
        let color = this.style.edgeColors.dependency;
        let strokeWidth = '1px';
        
        switch (edge.type) {
          case 'dependency':
            color = this.style.edgeColors.dependency;
            strokeWidth = '2px';
            break;
          case 'directory':
            color = this.style.edgeColors.directory;
            strokeWidth = '2px';
            break;
          case 'circular':
            color = this.style.edgeColors.circular;
            strokeWidth = '2px';
            break;
          case 'package':
            color = this.style.edgeColors.package;
            strokeWidth = '1.5px';
            break;
        }
          
        edgeLines.push(`linkStyle ${this.edgeCount} stroke:${color},stroke-width:${strokeWidth}`);
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
  
  // Generate subgraphs for file type groups
  private generateGroupSubgraphs(): string[] {
    const lines: string[] = [];
    const groupNodeIds = new Set<string>();
    
    // Find all group nodes
    for (const [path, nodeId] of this.nodes.entries()) {
      if (path.includes('_group_')) {
        groupNodeIds.add(nodeId);
      }
    }
    
    // Generate subgraph for each group
    for (const nodeId of groupNodeIds) {
      const info = this.nodeInfo.get(nodeId);
      if (info) {
        // Create subgraph with styling
        lines.push(`subgraph ${nodeId}["${info.label} Group"]`);
        
        // Find all nodes connected to this group
        const childNodes: string[] = [];
        for (const edge of this.edges.values()) {
          if (edge.source === nodeId) {
            childNodes.push(edge.target);
            lines.push(`  ${edge.target}`);
          }
        }
        
        lines.push(`end`);
        lines.push(`style ${nodeId} fill:#f8f9fa30,stroke:#2d3436,stroke-width:2px,stroke-dasharray:5 5`);
        lines.push(`class ${nodeId} group-node`);
        
        // Add click handler for interactivity in HTML output
        const childCount = childNodes.length;
        if (childCount > 0) {
          // Store the list of children for this group
          this.nodeInfo.set(nodeId, {
            ...info,
            childNodes: childNodes,
            isCollapsible: true
          });
          
          // Add a click handler to toggle expansion
          lines.push(`click ${nodeId} toggleGroup "${nodeId}"`);
        }
      }
    }
    
    return lines;
  }
} 