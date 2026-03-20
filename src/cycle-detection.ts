// src/cycle-detection.ts
// Pure iterative Tarjan's SCC algorithm for detecting circular dependency groups.
// No imports from other project modules — this is a pure function module.
//
// Entry point: detectCycles(edges) → sorted string[][] of cycle groups.
// Self-imports (A imports A) are reported as single-file cycles.
// Singletons without a self-edge are filtered out (not cycles).
// Output is deterministically sorted for stable LLM consumption.

/**
 * Builds a directed adjacency list from dependency edge rows.
 * Both source and target nodes are added to the map:
 * - source nodes get their outgoing edges appended
 * - target-only nodes get an empty array (no outgoing edges)
 * This ensures Tarjan's visits all graph nodes, including import targets.
 */
export function buildAdjacencyList(
  edges: Array<{ source_path: string; target_path: string }>
): Map<string, string[]> {
  const adj = new Map<string, string[]>();

  for (const { source_path, target_path } of edges) {
    // Ensure source exists with its neighbor list
    if (!adj.has(source_path)) {
      adj.set(source_path, []);
    }
    adj.get(source_path)!.push(target_path);

    // Ensure target exists as a node (may have no outgoing edges)
    if (!adj.has(target_path)) {
      adj.set(target_path, []);
    }
  }

  return adj;
}

/**
 * Iterative Tarjan's Strongly Connected Components algorithm.
 * Uses an explicit work stack instead of recursion to avoid call stack overflow
 * on deep dependency chains (JavaScript default stack ~10k frames).
 *
 * Each work stack frame tracks:
 * - node: the current node being processed
 * - neighborIdx: the index of the next neighbor to visit (continuation point)
 *
 * Returns ALL SCCs including singletons. Callers must filter for actual cycles.
 * Time complexity: O(V + E)
 */
export function iterativeTarjanSCC(adj: Map<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];
  let counter = 0;

  // Work stack entry: tracks current node and which neighbor to visit next
  const workStack: Array<{ node: string; neighborIdx: number }> = [];

  for (const node of adj.keys()) {
    // Skip already-visited nodes
    if (index.has(node)) continue;

    // Begin DFS from this node
    index.set(node, counter);
    lowlink.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    workStack.push({ node, neighborIdx: 0 });

    while (workStack.length > 0) {
      const frame = workStack[workStack.length - 1];
      const neighbors = adj.get(frame.node) ?? [];

      if (frame.neighborIdx < neighbors.length) {
        // Still have neighbors to process — pick next one
        const w = neighbors[frame.neighborIdx];
        frame.neighborIdx++;

        if (!index.has(w)) {
          // First visit to w — push new DFS frame
          index.set(w, counter);
          lowlink.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          workStack.push({ node: w, neighborIdx: 0 });
        } else if (onStack.has(w)) {
          // w is already on the Tarjan stack — back-edge found; update lowlink
          lowlink.set(
            frame.node,
            Math.min(lowlink.get(frame.node)!, index.get(w)!)
          );
        }
        // If w is not on stack (already fully processed) — cross-edge; ignore
      } else {
        // All neighbors processed — pop this frame
        workStack.pop();

        // Propagate lowlink to parent frame
        if (workStack.length > 0) {
          const parent = workStack[workStack.length - 1];
          lowlink.set(
            parent.node,
            Math.min(lowlink.get(parent.node)!, lowlink.get(frame.node)!)
          );
        }

        // Check if this node is the root of an SCC
        if (lowlink.get(frame.node) === index.get(frame.node)) {
          const scc: string[] = [];
          let w: string;
          do {
            w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
          } while (w !== frame.node);
          sccs.push(scc);
        }
      }
    }
  }

  return sccs;
}

/**
 * Detects circular dependency groups in a flat list of dependency edges.
 *
 * Algorithm:
 * 1. Build directed adjacency list from edges (source -> targets)
 * 2. Run iterative Tarjan's SCC on the full graph
 * 3. Filter: keep SCCs with more than one node OR single nodes with a self-edge (A -> A)
 * 4. Sort paths within each group alphabetically
 * 5. Sort groups by their first element
 *
 * Self-imports (A imports A) are reported as single-file cycles: [['A']].
 * Singletons without self-edge are not cycles and are excluded.
 * Output is deterministically sorted regardless of hash map iteration order.
 *
 * @param edges - Array of dependency edge rows from file_dependencies table
 * @returns Sorted array of cycle groups, each group is a sorted array of file paths
 */
export function detectCycles(
  edges: Array<{ source_path: string; target_path: string }>
): string[][] {
  if (edges.length === 0) return [];

  const adj = buildAdjacencyList(edges);
  const sccs = iterativeTarjanSCC(adj);

  // Filter: only keep actual cycles
  // - Multi-node SCCs are always cycles (mutual reachability)
  // - Single-node SCCs are cycles only if the node has a self-edge (A -> A)
  const cycles = sccs.filter((scc) => {
    if (scc.length > 1) return true;
    const node = scc[0];
    return (adj.get(node) ?? []).includes(node);
  });

  // Sort paths within each cycle group alphabetically for determinism
  const sorted = cycles
    .map((group) => [...group].sort())
    .sort((a, b) => a[0].localeCompare(b[0]));

  return sorted;
}
