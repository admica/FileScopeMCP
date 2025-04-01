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

  // --- Sanitization Helper ---
  private sanitizeLabel(label: string): string {
    if (!label || typeof label !== 'string') return '_(empty)';
    // Replace ${...} placeholders FIRST
    let sanitized = label.replace(/\$\{[^}]+\}/g, '_invalid_import_');
    // Remove potentially problematic characters for Mermaid IDs/labels
    // Allow letters, numbers, underscores, hyphens, periods
    // Replace others with underscore
    sanitized = sanitized.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    // Ensure it doesn't start or end with chars invalid for IDs if used as ID
    sanitized = sanitized.replace(/^[^a-zA-Z0-9_]+|[^a-zA-Z0-9_]+$/g, '');
    // If empty after sanitization, provide a default
    if (!sanitized) return 'sanitized_empty';
    // Limit length
    const maxLength = 40; // Increased max length slightly
    return sanitized.length <= maxLength ? sanitized : sanitized.substring(0, maxLength - 3) + '...';
  }
  // --- End Sanitization Helper ---

  // Generate or retrieve a node ID for a given file path
  private getNodeId(filePath: string, isPackage: boolean = false, isPackageScope: boolean = false): string {
    // If we already have an ID for this path, return it
    if (this.nodes.has(filePath)) {
      console.error(`[MermaidGenerator] Reusing existing node ID for path: ${filePath} -> ${this.nodes.get(filePath)}`);
      return this.nodes.get(filePath)!;
    }
    
    // Otherwise, generate a new ID and store it
    const id = `node${this.nodes.size}`;
    this.nodes.set(filePath, id);
    
    // Initialize basic info for this node (will be refined later if it's a FileNode)
    const basename = path.basename(filePath);
    const label = this.sanitizeLabel(basename);
    
    // Set different styling based on node type
    let color = this.style.nodeColors.lowImportance;
    let shape = this.style.nodeShapes.file;
    
    if (isPackage) {
      color = this.style.nodeColors.package;
      shape = this.style.nodeShapes.package;
      console.error(`[MermaidGenerator] Created package node ID: ${id} for ${filePath} (${label})`);
    } else if (isPackageScope) {
      color = this.style.nodeColors.packageScope;
      shape = this.style.nodeShapes.packageScope;
      console.error(`[MermaidGenerator] Created package scope node ID: ${id} for ${filePath} (${label})`);
    } else {
      console.error(`[MermaidGenerator] Created file node ID: ${id} for ${filePath} (${label})`);
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
    // Sanitize the scope name before using it as part of the path key
    const sanitizedScope = this.sanitizeLabel(scope);
    const scopePathKey = `scope:${sanitizedScope}`;

    if (this.packageScopeNodes.has(scopePathKey)) {
      return this.packageScopeNodes.get(scopePathKey)!;
    }
    
    // Use the sanitized scope for the node ID path key
    const nodeId = this.getNodeId(scopePathKey, false, true);
    this.packageScopeNodes.set(scopePathKey, nodeId);
    
    // Update node info for the scope node
    const info = this.nodeInfo.get(nodeId)!;
    // Use the sanitized scope for the label as well
    info.label = sanitizedScope; 
    info.color = this.style.nodeColors.packageScope;
    info.shape = this.style.nodeShapes.packageScope;
    info.isPackageScope = true;
    
    return nodeId;
  }

  // Update node information based on the actual FileNode
  private updateNodeInfo(node: FileNode): void {
    const nodeId = this.getNodeId(node.path);
    const info = this.nodeInfo.get(nodeId)!;
    
    // Update the label to the proper node label, using sanitization
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
    // Use sanitizeLabel
    return this.sanitizeLabel(node.name);
  }

  // Create node for a package dependency
  private addPackageNode(pkg: PackageDependency): string {
    // Ensure pkg.name is a string before processing
    const packageName = typeof pkg.name === 'string' ? pkg.name : '';
    const packagePath = typeof pkg.path === 'string' ? pkg.path : ''; // Use path as unique key

    console.error(`[MermaidGenerator] Processing package dependency: ${packageName} (${packagePath})`);

     // Skip if path is missing (likely indicates bad data)
    if (!packagePath) {
       console.error(`[MermaidGenerator] Skipping package dependency with missing path.`);
       return '';
    }
    
    // Skip excluded packages (using sanitized name)
    const sanitizedPackageName = this.sanitizeLabel(packageName || path.basename(packagePath));
    if (this.config.excludePackages && this.config.excludePackages.includes(sanitizedPackageName)) {
      console.error(`[MermaidGenerator] Skipping excluded package: ${sanitizedPackageName}`);
      return '';
    }
    
    // Only include specific packages if the filter is set (using sanitized name)
    if (this.config.includeOnlyPackages && 
        this.config.includeOnlyPackages.length > 0 && 
        !this.config.includeOnlyPackages.includes(sanitizedPackageName)) {
      console.error(`[MermaidGenerator] Skipping non-included package: ${sanitizedPackageName}`);
      return '';
    }
    
    // Get or create node ID using package PATH (more unique than name)
    const nodeId = this.getNodeId(packagePath, true);
    
    // Update node info using the sanitized package NAME
    const info = this.nodeInfo.get(nodeId)!;
    info.label = this.getPackageLabel(pkg); // This now uses sanitizeLabel
    info.color = this.style.nodeColors.package;
    info.shape = this.style.nodeShapes.package;
    info.isPackage = true;
    
    // Enhance the label with version if available
    let label = sanitizedPackageName;
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
      console.error(`[MermaidGenerator] Adding package ${sanitizedPackageName} to scope ${pkg.scope}`);
      if (!this.packageScopes.has(pkg.scope)) {
        this.packageScopes.set(pkg.scope, new Set());
        this.stats.packageScopeCount++;
      }
      this.packageScopes.get(pkg.scope)!.add(sanitizedPackageName);
      
      // Create edge from scope to package
      const scopeNodeId = this.getPackageScopeNodeId(pkg.scope);
      this.addEdge(scopeNodeId, nodeId, 'directory');
    }
    
    this.stats.packageCount++;
    return nodeId;
  }

  // Get the label for a package dependency node
  private getPackageLabel(pkg: PackageDependency): string {
    // Ensure name and path are strings before using them
    const name = typeof pkg.name === 'string' ? pkg.name : '';
    const pkgPath = typeof pkg.path === 'string' ? pkg.path : '';
    // Use sanitizeLabel on the package name or fallback to basename of path
    const labelBase = name || path.basename(pkgPath);
    return this.sanitizeLabel(labelBase);
  }

  // First pass: Collect all nodes and relationships based on style and filters
  private collectNodesAndEdges(node: FileNode, depth: number = 0): void {
      // --- DEPTH CHECK ---
      const maxDepth = this.config.maxDepth ?? 5; // Use a default if undefined
      if (depth >= maxDepth) { // Stop if max depth is reached
           console.error(`[MermaidGenerator] Max depth ${maxDepth} reached at node: ${node.path}, stopping recursion.`);
           return;
      }
      this.stats.maxDepth = Math.max(this.stats.maxDepth, depth);


      const isPackageDepsMode = this.config.style === 'package-deps';
      const isDirectoryStyle = this.config.style === 'directory';
      const isDependencyStyle = this.config.style === 'dependency';
      const isHybridStyle = this.config.style === 'hybrid';

      // --- NODE FILTERING ---
      // Skip low importance files (unless it's a directory or package-deps mode)
      if (!node.isDirectory && !isPackageDepsMode && this.config.minImportance && (node.importance || 0) < this.config.minImportance) {
          console.error(`[MermaidGenerator] Filtering node: Skipping low importance file ${node.path} (${node.importance})`);
          return; // Skip this node entirely
      }

      // Skip directories in dependency-only style
      if (node.isDirectory && isDependencyStyle) {
           console.error(`[MermaidGenerator] Filtering node: Skipping directory ${node.path} in dependency style.`);
           // Still need to process children for their dependencies
          if (node.children) {
              for (const child of node.children) {
                  this.collectNodesAndEdges(child, depth + 1);
              }
          }
           return; // Don't register the directory node itself or its containment edges
      }

      // Skip files in directory-only style (unless showDependencies is true)
      if (!node.isDirectory && isDirectoryStyle && !this.config.showDependencies) {
           console.error(`[MermaidGenerator] Filtering node: Skipping file ${node.path} in directory style.`);
           return;
      }


      // --- NODE REGISTRATION --- (Get ID and update info, but don't add to definedNodes yet)
      console.error(`[MermaidGenerator] Registering node: ${node.path} (Depth: ${depth}, Importance: ${node.importance || 'N/A'})`);
      const nodeId = this.getNodeId(node.path);
      this.updateNodeInfo(node);
      // Node will be added to definedNodes within addEdge if it connects to anything


      // --- RELATIONSHIP PROCESSING ---

      // 1. Directory Containment Edges (for 'directory' and 'hybrid' styles)
      if (node.isDirectory && (isDirectoryStyle || isHybridStyle)) {
          if (node.children) {
              for (const child of node.children) {
                   const childImportance = child.importance || 0;
                   const childIsDir = child.isDirectory;
                   const childDepth = depth + 1;

                   // Conditions for child to be included in diagram:
                   const passesDepth = childDepth < maxDepth;
                   const passesImportance = childIsDir || isPackageDepsMode || !this.config.minImportance || childImportance >= this.config.minImportance;
                   const passesStyleFilter = !(childIsDir && isDependencyStyle) && !(!childIsDir && isDirectoryStyle && !this.config.showDependencies);

                   if(passesDepth && passesImportance && passesStyleFilter) {
                       const childNodeId = this.getNodeId(child.path); // Ensure child node ID exists in node map
                       this.addEdge(node.path, child.path, 'directory');
                   } else {
                        console.error(`[MermaidGenerator] Skipping directory edge: Child ${child.path} is filtered out (Depth: ${childDepth}, Imp: ${childImportance}, Style: ${this.config.style}).`);
                   }
              }
          }
      }

      // 2. Dependency Edges (for 'dependency' and 'hybrid' styles)
      if (!node.isDirectory && (isDependencyStyle || isHybridStyle)) {
           // Local file dependencies
          if (this.config.showDependencies && node.dependencies) {
              for (const depPath of node.dependencies) {
                  // addEdge will handle checks if target node exists and is defined
                  this.addEdge(node.path, depPath, 'dependency');
              }
          }
           // Package dependencies
          if (this.config.showPackageDeps && node.packageDependencies) {
              for (const pkgDep of node.packageDependencies) {
                  if (!pkgDep.name || !pkgDep.path) continue;
                  const packageNodeId = this.addPackageNode(pkgDep);
                  if (packageNodeId) {
                      this.addEdge(node.path, pkgDep.path, 'package');
                  }
              }
          }
      }

       // 3. Package Dependency Edges (ONLY for 'package-deps' style)
       if (!node.isDirectory && isPackageDepsMode && node.packageDependencies) {
           if (this.config.showPackageDeps) {
                for (const pkgDep of node.packageDependencies) {
                     if (!pkgDep.name || !pkgDep.path) continue;
                     const packageNodeId = this.addPackageNode(pkgDep);
                     if (packageNodeId) {
                          // Ensure the source file node is also marked for definition in this mode
                          this.definedNodes.add(nodeId);
                          this.addEdge(node.path, pkgDep.path, 'package');
                     }
                }
           }
       }


      // --- RECURSION ---
      // Recurse into children for all styles
      // Filtering happens at the start of the call for the child
      if (node.isDirectory && node.children) {
          for (const child of node.children) {
               this.collectNodesAndEdges(child, depth + 1);
          }
      }
  }

  // Add an edge between two nodes
  private addEdge(sourcePath: string, targetPath: string, type: string): void {
    const sourceId = this.getNodeId(sourcePath); // Ensures source node exists in map
    let targetId;

    // Ensure target node also exists before adding edge
    if (type === 'package') {
        targetId = this.nodes.get(targetPath); // Package nodes use path as key
    } else {
        targetId = this.nodes.get(targetPath); // File/Dir nodes use path as key
    }

    // Only add edge if both source and target nodes were actually created/registered
    // Use this.nodes.has() for existence check is slightly better than relying on getNodeInfo
    if (!targetId || !this.nodes.has(sourcePath) || !this.nodes.has(targetPath)) {
         console.error(`[MermaidGenerator] Skipping edge from ${sourcePath} to ${targetPath}: Source or Target node path not found in nodes map.`);
         return;
    }

    // Ensure the nodeInfo map also has entries if needed elsewhere, though nodes map is primary for existence
    if (!this.nodeInfo.has(sourceId) || !this.nodeInfo.has(targetId)) {
         console.error(`[MermaidGenerator] Skipping edge from ${sourcePath} to ${targetPath}: Source or Target node info missing.`);
         return;
    }

    const edgeKey = `${sourceId}-->${targetId}`; // Use node IDs for edge key

    if (!this.edges.has(edgeKey)) {
        console.error(`[MermaidGenerator] Adding edge (${type}): ${sourceId} --> ${targetId}`);
        this.edges.set(edgeKey, {
            source: sourceId,
            target: targetId,
            type: type
        });
         // Mark both nodes involved in an edge as defined
         this.definedNodes.add(sourceId);
         this.definedNodes.add(targetId);
    }
  }
    
  public generate(): MermaidDiagram {
    // Reset state for a clean generation
    this.nodes = new Map();
    this.nodeInfo = new Map();
    this.edges = new Map();
    this.edgeCount = 0;
    this.definedNodes = new Set(); // Reset defined nodes
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
    console.error(`[MermaidGenerator] Starting Phase 1: Collecting nodes and edges for style '${this.config.style}'...`);
    this.collectNodesAndEdges(this.fileTree, 0); // Use the refactored collection function
    console.error(`[MermaidGenerator] Finished Phase 1: Collected ${this.nodes.size} potential nodes, ${this.edges.size} potential edges.`);
    console.error(`[MermaidGenerator] Nodes marked for definition (involved in edges): ${this.definedNodes.size}`);
    
    // Auto-select layout direction based on diagram structure (optional)
    let direction = this.config.layout?.direction || 'TB';
    // ... (layout logic can remain or be simplified) ...
    
    const output: string[] = [
      `graph ${direction}`
    ];

    // Add class definitions
    output.push(`classDef package-node fill:${this.style.nodeColors.package},stroke:#2d3436,shape:${this.style.nodeShapes.package}`);
    output.push(`classDef package-scope-node fill:${this.style.nodeColors.packageScope},stroke:#2d3436,shape:${this.style.nodeShapes.packageScope}`);
    // ... (other classDefs)

    // Add package scope subgraphs if needed
    // ... (subgraph logic can remain the same, relies on collected data) ...
    if (this.config.packageGrouping) { // Simplified check
      output.push('');
      output.push('  %% Package Scopes');
      for (const [scope, packages] of this.packageScopes.entries()) {
         const sanitizedScope = this.sanitizeLabel(scope);
         const scopePathKey = `scope:${sanitizedScope}`;
         const scopeNodeId = this.packageScopeNodes.get(scopePathKey);
         // Only add subgraph if the scope node itself is needed (i.e., part of an edge)
         if (scopeNodeId && this.definedNodes.has(scopeNodeId)) {
           output.push(`  subgraph ${scopeNodeId}["${sanitizedScope}"]`);
           // Add nodes belonging to this scope that are defined
           packages.forEach(pkgName => {
                // Find the node ID for this package name/path more reliably
                let pkgNodeId: string | undefined;
                for (const [pathKey, nodeId] of this.nodes.entries()) {
                    const info = this.nodeInfo.get(nodeId);
                    if (info?.isPackage && (this.sanitizeLabel(info.label) === pkgName || path.basename(pathKey) === pkgName)) {
                        pkgNodeId = nodeId;
                        break;
                    }
                }
                if(pkgNodeId && this.definedNodes.has(pkgNodeId)) {
                    output.push(`    ${pkgNodeId};`);
                }
           });
           output.push('  end');
           output.push(`  style ${scopeNodeId} fill:${this.style.nodeColors.packageScope},stroke:#2d3436,stroke-dasharray: 5 5`);
         }
      }
      output.push('');
    }

    // --- Node Definitions and Styles (Phase 2) ---
    output.push('  %% Node Definitions & Styles');
    console.error(`[MermaidGenerator Phase 2] Number of nodes to define (involved in edges): ${this.definedNodes.size}`); 
    let definedCount = 0;
    for (const [nodeId, info] of this.nodeInfo.entries()) {
       // Only define nodes that are actually marked in the definedNodes set
       if (this.definedNodes.has(nodeId)) {
           const labelText = info.label; // Already sanitized
           output.push(`  ${nodeId}["${labelText}"];`);
           // Apply style
           output.push(`  style ${nodeId} fill:${info.color},stroke:#333,stroke-width:1px`);
            // Apply class if package/scope
           if (info.isPackage || info.isPackageScope) {
               output.push(`  class ${nodeId} ${info.isPackage ? 'package-node' : 'package-scope-node'}`);
           }
           definedCount++;
       }
    }
    console.error(`[MermaidGenerator Phase 2] Actually defined ${definedCount} nodes.`);
    output.push('');

    // --- Edge Definitions (Phase 3) ---
    output.push('  %% Edge Definitions');
    const edgeLines: string[] = [];
    this.edgeCount = 0; // Reset edge count for linkStyle indexing
    let edgeOutputCount = 0;
    for (const edge of this.edges.values()) {
      // Double-check both nodes exist in definedNodes before creating edge link
      if (this.definedNodes.has(edge.source) && this.definedNodes.has(edge.target)) {
        edgeLines.push(`  ${edge.source} --> ${edge.target}`);
        
        // Choose edge color/style based on type
        let color = this.style.edgeColors.dependency; // Default
        let strokeWidth = '1px';
        let strokeDasharray = 'solid'; // Default

        switch (edge.type) {
            case 'directory':
                color = this.style.edgeColors.directory;
                strokeWidth = '2px';
                strokeDasharray = '5,5'; // Dashed line for directory containment
                break;
            case 'package':
                color = this.style.edgeColors.package;
                strokeWidth = '1.5px';
                break;
            case 'dependency':
                color = this.style.edgeColors.dependency;
                break;
            // Add case for 'circular' if detected
        }

        edgeLines.push(`  linkStyle ${this.edgeCount} stroke:${color},stroke-width:${strokeWidth}${strokeDasharray !== 'solid' ? `,stroke-dasharray:${strokeDasharray}` : ''}`);
        this.edgeCount++; // Increment index for linkStyle
        edgeOutputCount++;
        this.stats.edgeCount++;
         // Add logic to update other stats like circularDeps, importantFiles if needed
      } else {
          console.error(`[MermaidGenerator Phase 3] Skipping edge ${edge.source} --> ${edge.target} because one or both nodes were not defined.`);
      }
    }
    console.error(`[MermaidGenerator Phase 3] Added ${edgeOutputCount} edges to the output.`);
    output.push(...edgeLines);

    // Update stats
    this.stats.nodeCount = this.definedNodes.size;

    return {
      code: output.join('\n'),
      style: this.style,
      stats: this.stats,
      timestamp: new Date()
    };
  }
} 