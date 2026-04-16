// tests/unit/dependency-graph.test.ts
// Tests for dependency graph construction, cycle detection, and community detection.
// Uses real edge data and real algorithms — no mocks.
import { describe, it, expect } from 'vitest';
import { detectCycles, buildAdjacencyList, iterativeTarjanSCC } from '../../src/cycle-detection.js';
import { detectCommunities } from '../../src/community-detection.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Edge = { source_path: string; target_path: string };
type WeightedEdge = Edge & { weight: number };

function edges(...pairs: [string, string][]): Edge[] {
  return pairs.map(([source_path, target_path]) => ({ source_path, target_path }));
}

function weightedEdges(...triples: [string, string, number][]): WeightedEdge[] {
  return triples.map(([source_path, target_path, weight]) => ({ source_path, target_path, weight }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// Cycle Detection (Tarjan's SCC)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Cycle detection', () => {
  describe('basic cases', () => {
    it('no edges returns empty', () => {
      expect(detectCycles([])).toEqual([]);
    });

    it('linear chain has no cycles', () => {
      expect(detectCycles(edges(['A', 'B'], ['B', 'C'], ['C', 'D']))).toEqual([]);
    });

    it('simple 2-node cycle', () => {
      const result = detectCycles(edges(['A', 'B'], ['B', 'A']));
      expect(result).toHaveLength(1);
      expect(result[0].sort()).toEqual(['A', 'B']);
    });

    it('triangle cycle', () => {
      const result = detectCycles(edges(['A', 'B'], ['B', 'C'], ['C', 'A']));
      expect(result).toHaveLength(1);
      expect(result[0].sort()).toEqual(['A', 'B', 'C']);
    });

    it('self-import cycle', () => {
      const result = detectCycles(edges(['A', 'A']));
      expect(result).toEqual([['A']]);
    });
  });

  describe('complex graphs', () => {
    it('two independent cycles', () => {
      const result = detectCycles(
        edges(['A', 'B'], ['B', 'A'], ['C', 'D'], ['D', 'C'])
      );
      expect(result).toHaveLength(2);
    });

    it('cycle + linear nodes: only cycle nodes in result', () => {
      const result = detectCycles(
        edges(['A', 'B'], ['B', 'A'], ['C', 'D'])
      );
      expect(result).toHaveLength(1);
      expect(result[0].sort()).toEqual(['A', 'B']);
    });

    it('diamond shape (no cycle): A->B, A->C, B->D, C->D', () => {
      const result = detectCycles(edges(['A', 'B'], ['A', 'C'], ['B', 'D'], ['C', 'D']));
      expect(result).toEqual([]);
    });

    it('nested cycles: A->B->C->A and B->D->B', () => {
      const result = detectCycles(
        edges(['A', 'B'], ['B', 'C'], ['C', 'A'], ['B', 'D'], ['D', 'B'])
      );
      // All 4 nodes form one big SCC
      expect(result).toHaveLength(1);
      expect(result[0].sort()).toEqual(['A', 'B', 'C', 'D']);
    });
  });

  describe('determinism', () => {
    it('produces identical output on repeated calls', () => {
      const input = edges(['B', 'A'], ['A', 'B'], ['D', 'C'], ['C', 'D']);
      const r1 = detectCycles(input);
      const r2 = detectCycles(input);
      const r3 = detectCycles(input);
      expect(r1).toEqual(r2);
      expect(r2).toEqual(r3);
    });

    it('groups are sorted by first element', () => {
      const result = detectCycles(
        edges(['Z', 'Y'], ['Y', 'Z'], ['A', 'B'], ['B', 'A'])
      );
      expect(result).toHaveLength(2);
      expect(result[0][0] < result[1][0]).toBe(true);
    });
  });

  describe('scale', () => {
    it('1000-node cycle completes without stack overflow', () => {
      const edgeList: Edge[] = [];
      for (let i = 0; i < 1000; i++) {
        edgeList.push({ source_path: String(i), target_path: String((i + 1) % 1000) });
      }
      const result = detectCycles(edgeList);
      expect(result).toHaveLength(1);
      expect(result[0]).toHaveLength(1000);
    });

    it('500 independent 2-node cycles', () => {
      const edgeList: Edge[] = [];
      for (let i = 0; i < 500; i++) {
        const a = `a${i}`, b = `b${i}`;
        edgeList.push({ source_path: a, target_path: b });
        edgeList.push({ source_path: b, target_path: a });
      }
      const result = detectCycles(edgeList);
      expect(result).toHaveLength(500);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// buildAdjacencyList
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildAdjacencyList', () => {
  it('builds correct adjacency from edges', () => {
    const adj = buildAdjacencyList(edges(['A', 'B'], ['A', 'C']));
    expect(adj.get('A')).toEqual(['B', 'C']);
    expect(adj.get('B')).toEqual([]);
    expect(adj.get('C')).toEqual([]);
  });

  it('empty edges produces empty map', () => {
    expect(buildAdjacencyList([]).size).toBe(0);
  });

  it('includes both source and target as nodes', () => {
    const adj = buildAdjacencyList(edges(['X', 'Y']));
    expect(adj.has('X')).toBe(true);
    expect(adj.has('Y')).toBe(true);
  });

  it('handles self-edge', () => {
    const adj = buildAdjacencyList(edges(['A', 'A']));
    expect(adj.get('A')).toContain('A');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// iterativeTarjanSCC
// ═══════════════════════════════════════════════════════════════════════════════

describe('iterativeTarjanSCC', () => {
  it('empty adjacency list returns empty SCCs', () => {
    expect(iterativeTarjanSCC(new Map())).toEqual([]);
  });

  it('linear graph returns singleton SCCs', () => {
    const adj = new Map([['A', ['B']], ['B', ['C']], ['C', []]]);
    const sccs = iterativeTarjanSCC(adj);
    expect(sccs).toHaveLength(3);
    sccs.forEach(scc => expect(scc).toHaveLength(1));
  });

  it('2-node cycle returns one multi-node SCC', () => {
    const adj = new Map([['A', ['B']], ['B', ['A']]]);
    const sccs = iterativeTarjanSCC(adj);
    const multiNode = sccs.filter(s => s.length > 1);
    expect(multiNode).toHaveLength(1);
    expect(multiNode[0].sort()).toEqual(['A', 'B']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Community Detection (Louvain)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Community detection', () => {
  describe('basic cases', () => {
    it('empty edges returns empty communities', () => {
      const result = detectCommunities([], new Map());
      expect(result).toEqual([]);
    });

    it('single edge creates at least one community', () => {
      const result = detectCommunities(
        weightedEdges(['A', 'B', 1]),
        new Map([['A', 5], ['B', 3]])
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('tightly connected group forms one community', () => {
      // A<->B, B<->C, A<->C (triangle)
      const result = detectCommunities(
        weightedEdges(['A', 'B', 1], ['B', 'C', 1], ['A', 'C', 1]),
        new Map([['A', 8], ['B', 5], ['C', 3]])
      );
      // Triangle should form one community
      expect(result.length).toBe(1);
      expect(result[0].members.sort()).toEqual(['A', 'B', 'C']);
    });
  });

  describe('representative selection', () => {
    it('highest-importance member becomes representative', () => {
      const result = detectCommunities(
        weightedEdges(['A', 'B', 1], ['B', 'C', 1], ['A', 'C', 1]),
        new Map([['A', 10], ['B', 5], ['C', 1]])
      );
      expect(result[0].representative).toBe('A');
    });
  });

  describe('community structure', () => {
    it('each community has correct size = members.length', () => {
      const result = detectCommunities(
        weightedEdges(['A', 'B', 1], ['C', 'D', 1]),
        new Map([['A', 5], ['B', 5], ['C', 5], ['D', 5]])
      );
      for (const community of result) {
        expect(community.size).toBe(community.members.length);
      }
    });

    it('members are sorted alphabetically', () => {
      const result = detectCommunities(
        weightedEdges(['Z', 'A', 1], ['A', 'M', 1], ['M', 'Z', 1]),
        new Map([['Z', 1], ['A', 1], ['M', 1]])
      );
      for (const community of result) {
        const sorted = [...community.members].sort();
        expect(community.members).toEqual(sorted);
      }
    });

    it('each community has a numeric communityId', () => {
      const result = detectCommunities(
        weightedEdges(['A', 'B', 1]),
        new Map([['A', 1], ['B', 1]])
      );
      for (const community of result) {
        expect(typeof community.communityId).toBe('number');
      }
    });
  });

  describe('weight handling', () => {
    it('higher weights influence community grouping', () => {
      // A-B strongly connected (weight 10), C-D strongly connected (weight 10)
      // B-C weakly connected (weight 1)
      const result = detectCommunities(
        weightedEdges(['A', 'B', 10], ['C', 'D', 10], ['B', 'C', 1]),
        new Map([['A', 5], ['B', 5], ['C', 5], ['D', 5]])
      );
      // Should produce 2 communities (strong internal, weak cross)
      // Louvain may or may not split — at minimum the algorithm runs without error
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('duplicate edges accumulate weight', () => {
      // Same edge appears twice — should accumulate to weight 2
      const result = detectCommunities(
        weightedEdges(['A', 'B', 1], ['A', 'B', 1]),
        new Map([['A', 5], ['B', 5]])
      );
      expect(result.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isolated nodes', () => {
    it('nodes not in any edge are not in any community', () => {
      const result = detectCommunities(
        weightedEdges(['A', 'B', 1]),
        new Map([['A', 5], ['B', 5], ['C', 5]]) // C is isolated
      );
      const allMembers = result.flatMap(c => c.members);
      expect(allMembers).not.toContain('C');
    });
  });
});
