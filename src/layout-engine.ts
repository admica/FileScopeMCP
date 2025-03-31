import { FileNode, MermaidDiagramConfig } from './types.js';

export interface LayoutMetrics {
  width: number;      // Estimated diagram width in nodes
  depth: number;      // Maximum depth of the tree
  density: number;    // Connection density (edges per node)
  clusters: number;   // Number of distinct clusters
}

export interface LayoutStrategy {
  direction: 'TB' | 'LR' | 'RL' | 'BT';
  nodeSpacing: number;
  rankSeparation: number;
  autoRotate: boolean;
}

/**
 * Calculates the width of the graph (maximum nodes at any level)
 */
function calculateGraphWidth(nodes: FileNode[], groups: Map<string, FileNode[]>): number {
  // For grouped nodes, count groups as single nodes plus their internal max width
  const groupWidths = Array.from(groups.values()).map(groupNodes => {
    const internalWidth = Math.max(
      1,  // Minimum width is 1 (the group itself)
      ...findLevels(groupNodes).map(level => level.length)
    );
    return internalWidth;
  });

  // Also consider ungrouped nodes
  const ungroupedNodes = nodes.filter(node => 
    !Array.from(groups.values()).some(group => group.includes(node))
  );
  
  return Math.max(
    ...groupWidths,
    ungroupedNodes.length
  );
}

/**
 * Calculates the maximum depth of the graph
 */
function calculateGraphDepth(nodes: FileNode[], groups: Map<string, FileNode[]>): number {
  // For grouped nodes, count group as one level plus maximum internal depth
  const groupDepths = Array.from(groups.values()).map(groupNodes => {
    return 1 + findLevels(groupNodes).length;  // 1 for the group itself
  });

  // Also consider paths through ungrouped nodes
  const ungroupedNodes = nodes.filter(node => 
    !Array.from(groups.values()).some(group => group.includes(node))
  );
  
  return Math.max(
    ...groupDepths,
    findLevels(ungroupedNodes).length
  );
}

/**
 * Organizes nodes into levels based on dependencies
 */
function findLevels(nodes: FileNode[]): FileNode[][] {
  const levels: FileNode[][] = [];
  const visited = new Set<string>();
  
  function getNodeLevel(node: FileNode): number {
    if (visited.has(node.path)) {
      // Return the existing level for this node
      return levels.findIndex(level => level.includes(node));
    }
    
    visited.add(node.path);
    
    // If no dependencies, this is a root node (level 0)
    if (!node.dependencies || node.dependencies.length === 0) {
      if (!levels[0]) levels[0] = [];
      levels[0].push(node);
      return 0;
    }
    
    // Find the maximum level of dependencies
    let maxDepLevel = -1;
    for (const dep of node.dependencies) {
      const depNode = nodes.find(n => n.path === dep);
      if (depNode) {
        maxDepLevel = Math.max(maxDepLevel, getNodeLevel(depNode));
      }
    }
    
    // This node's level is one more than its highest dependency
    const nodeLevel = maxDepLevel + 1;
    if (!levels[nodeLevel]) levels[nodeLevel] = [];
    levels[nodeLevel].push(node);
    return nodeLevel;
  }
  
  // Process all nodes
  nodes.forEach(node => getNodeLevel(node));
  
  return levels;
}

/**
 * Calculates connection density (edges per node)
 */
function calculateDensity(nodes: FileNode[]): number {
  const totalEdges = nodes.reduce((count, node) => {
    return count + (node.dependencies?.length || 0);
  }, 0);
  
  return totalEdges / nodes.length;
}

/**
 * Determines the optimal layout strategy based on graph metrics
 */
export function determineOptimalLayout(
  nodes: FileNode[],
  groups: Map<string, FileNode[]>,
  config?: Partial<MermaidDiagramConfig>
): LayoutStrategy {
  // Calculate graph metrics
  const metrics: LayoutMetrics = {
    width: calculateGraphWidth(nodes, groups),
    depth: calculateGraphDepth(nodes, groups),
    density: calculateDensity(nodes),
    clusters: groups.size
  };
  
  // Start with default values
  const strategy: LayoutStrategy = {
    direction: 'TB',
    nodeSpacing: 50,
    rankSeparation: 50,
    autoRotate: true
  };
  
  // Adjust based on metrics
  if (metrics.width > metrics.depth * 2) {
    // Wide graph: use top-to-bottom layout
    strategy.direction = 'TB';
    strategy.nodeSpacing = Math.max(30, Math.min(80, 150 / metrics.width));
    strategy.rankSeparation = Math.max(40, Math.min(100, 200 / metrics.depth));
  } else if (metrics.depth > metrics.width * 1.5) {
    // Deep graph: use left-to-right layout
    strategy.direction = 'LR';
    strategy.nodeSpacing = Math.max(40, Math.min(100, 200 / metrics.depth));
    strategy.rankSeparation = Math.max(30, Math.min(80, 150 / metrics.width));
  } else {
    // Balanced graph: use density to decide
    if (metrics.density > 2) {
      // Dense connections: use more space
      strategy.nodeSpacing = 70;
      strategy.rankSeparation = 70;
    }
  }
  
  // Override with any user-specified config
  if (config?.layout) {
    if (config.layout.direction) strategy.direction = config.layout.direction;
    if (config.layout.nodeSpacing) strategy.nodeSpacing = config.layout.nodeSpacing;
    if (config.layout.rankSpacing) strategy.rankSeparation = config.layout.rankSpacing;
  }
  
  return strategy;
}

// Export helper functions for testing
export const layoutUtils = {
  calculateGraphWidth,
  calculateGraphDepth,
  calculateDensity,
  findLevels
}; 