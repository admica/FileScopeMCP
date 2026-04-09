// src/community-detection.ts
// Pure Louvain community detection module for FileScopeMCP dependency graphs.
// Groups connected files into communities using the graphology + Louvain algorithm.
// No imports from other project modules — this is a pure function module.
//
// Entry point: detectCommunities(edges, importances) → CommunityResult[]

import { UndirectedGraph } from 'graphology';
import louvain from 'graphology-communities-louvain';

/**
 * Result of community detection for a single community group.
 */
export interface CommunityResult {
  communityId: number;     // Raw integer community ID from Louvain
  representative: string;  // Path of highest-importance member in the community
  members: string[];       // All file paths in this community, sorted alphabetically
  size: number;            // Equal to members.length
}

/**
 * Groups connected files into communities using the Louvain modularity algorithm.
 *
 * Algorithm:
 * 1. Guard: empty edges returns empty result immediately
 * 2. Build an undirected weighted graphology graph from the edge list
 *    - Accumulates weight if the same node pair appears multiple times
 * 3. Run Louvain with edge weight attribute 'weight'
 * 4. Group nodes by integer community ID
 * 5. Map each group to CommunityResult: find representative (max importance),
 *    sort members alphabetically, set size = members.length
 *
 * Files with no local_import edges (isolated nodes) are never added to the graph
 * and will not appear in any community. getCommunityForFile() returns null for them.
 *
 * @param edges       - Array of weighted local_import edges from file_dependencies table
 * @param importances - Map of file path → importance score (0–10); missing entries default to 0
 * @returns Array of CommunityResult objects (one per detected community)
 */
export function detectCommunities(
  edges: Array<{ source_path: string; target_path: string; weight: number }>,
  importances: Map<string, number>,
): CommunityResult[] {
  if (edges.length === 0) return [];

  const graph = new UndirectedGraph();

  // Add nodes before edges to avoid "node not found" errors
  for (const { source_path, target_path } of edges) {
    if (!graph.hasNode(source_path)) graph.addNode(source_path);
    if (!graph.hasNode(target_path)) graph.addNode(target_path);
  }

  // Add edges — undirected so A→B and B→A collapse to one edge
  // If the same node pair appears twice (both directions stored in DB),
  // accumulate the weight on the existing edge rather than erroring on duplicate add.
  for (const { source_path, target_path, weight } of edges) {
    if (!graph.hasEdge(source_path, target_path)) {
      graph.addEdge(source_path, target_path, { weight });
    } else {
      const existing = graph.getEdgeAttribute(source_path, target_path, 'weight') as number;
      graph.setEdgeAttribute(source_path, target_path, 'weight', existing + weight);
    }
  }

  // Run Louvain — returns Record<nodeKey, communityId>
  // getEdgeWeight: 'weight' tells the algorithm to use our weight attribute
  const partition = louvain(graph, { getEdgeWeight: 'weight' });

  // Group nodes by integer community ID
  const groups = new Map<number, string[]>();
  for (const [filePath, communityId] of Object.entries(partition)) {
    if (!groups.has(communityId)) groups.set(communityId, []);
    groups.get(communityId)!.push(filePath);
  }

  // Map each group to a CommunityResult with representative = highest-importance member
  return Array.from(groups.entries()).map(([communityId, members]) => {
    const representative = members.reduce((best, path) => {
      return (importances.get(path) ?? 0) >= (importances.get(best) ?? 0) ? path : best;
    }, members[0]);
    return {
      communityId,
      representative,
      members: members.sort(),
      size: members.length,
    };
  });
}
