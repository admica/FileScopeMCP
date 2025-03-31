import * as path from 'path';
import { FileNode, GroupingRule } from './types.js';

/**
 * Groups files by their parent directory
 */
function groupByDirectory(nodes: FileNode[]): Map<string, FileNode[]> {
  const groups = new Map<string, FileNode[]>();
  
  for (const node of nodes) {
    const parentDir = path.dirname(node.path);
    if (!groups.has(parentDir)) {
      groups.set(parentDir, []);
    }
    groups.get(parentDir)!.push(node);
  }
  
  return groups;
}

/**
 * Checks if nodes belong to multiple packages by looking for package.json files
 */
function hasMultiplePackages(nodes: FileNode[]): boolean {
  const packageJsonCount = nodes.filter(node => 
    path.basename(node.path) === 'package.json'
  ).length;
  return packageJsonCount > 1;
}

/**
 * Groups files by their nearest package.json directory
 */
function groupByPackage(nodes: FileNode[]): Map<string, FileNode[]> {
  const groups = new Map<string, FileNode[]>();
  
  // First find all package.json files
  const packageDirs = nodes
    .filter(node => path.basename(node.path) === 'package.json')
    .map(node => path.dirname(node.path));
  
  // Group files by their closest package directory
  for (const node of nodes) {
    const nodeDir = path.dirname(node.path);
    let closestPackageDir = packageDirs.find(pkgDir => 
      nodeDir.startsWith(pkgDir)
    ) || 'root';
    
    if (!groups.has(closestPackageDir)) {
      groups.set(closestPackageDir, []);
    }
    groups.get(closestPackageDir)!.push(node);
  }
  
  return groups;
}

/**
 * Checks if the nodes have complex dependencies (more than threshold interconnections)
 */
function hasComplexDependencies(nodes: FileNode[]): boolean {
  const dependencyCount = nodes.reduce((count, node) => {
    return count + (node.dependencies?.length || 0);
  }, 0);
  
  return dependencyCount > (nodes.length * 2); // Arbitrary threshold
}

/**
 * Groups files by their dependency relationships
 * Uses a simple clustering approach based on mutual dependencies
 */
function groupByDependencyCluster(nodes: FileNode[]): Map<string, FileNode[]> {
  const groups = new Map<string, FileNode[]>();
  const visited = new Set<string>();
  let clusterIndex = 0;
  
  function findCluster(node: FileNode, currentCluster: FileNode[]) {
    if (visited.has(node.path)) return;
    visited.add(node.path);
    currentCluster.push(node);
    
    // Add dependencies to the same cluster
    const deps = node.dependencies || [];
    for (const dep of deps) {
      const depNode = nodes.find(n => n.path === dep);
      if (depNode && !visited.has(depNode.path)) {
        findCluster(depNode, currentCluster);
      }
    }
    
    // Add dependents to the same cluster
    const dependents = nodes.filter(n => 
      n.dependencies?.includes(node.path)
    );
    for (const dependent of dependents) {
      if (!visited.has(dependent.path)) {
        findCluster(dependent, currentCluster);
      }
    }
  }
  
  // Find clusters starting from each unvisited node
  for (const node of nodes) {
    if (!visited.has(node.path)) {
      const cluster: FileNode[] = [];
      findCluster(node, cluster);
      if (cluster.length > 0) {
        groups.set(`cluster_${clusterIndex++}`, cluster);
      }
    }
  }
  
  return groups;
}

// Export the default grouping rules
export const defaultGroupingRules: GroupingRule[] = [
  {
    type: 'directory',
    condition: (nodes) => nodes.length > 8,
    groupBy: groupByDirectory,
    threshold: 8,
    description: 'Groups files by their parent directory when directory has more than 8 files'
  },
  {
    type: 'package',
    condition: hasMultiplePackages,
    groupBy: groupByPackage,
    threshold: 5,
    description: 'Groups files by their nearest package.json when multiple packages exist'
  },
  {
    type: 'dependency',
    condition: hasComplexDependencies,
    groupBy: groupByDependencyCluster,
    threshold: 6,
    description: 'Groups files by their dependency relationships when dependencies are complex'
  }
];

// Export individual functions for testing and custom rule creation
export const groupingFunctions = {
  groupByDirectory,
  groupByPackage,
  groupByDependencyCluster,
  hasMultiplePackages,
  hasComplexDependencies
}; 