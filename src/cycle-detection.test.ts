// src/cycle-detection.test.ts
// Unit tests for the pure iterative Tarjan's SCC cycle detection module.
// Tests use plain array inputs — no SQLite needed for pure function tests.
import { describe, it, expect } from 'vitest';
import { detectCycles, buildAdjacencyList, iterativeTarjanSCC } from './cycle-detection.js';

// Helper: edge array constructor
function edges(...pairs: [string, string][]): Array<{ source_path: string; target_path: string }> {
  return pairs.map(([source_path, target_path]) => ({ source_path, target_path }));
}

describe('detectCycles', () => {
  it('Test 1: no edges returns empty array', () => {
    expect(detectCycles([])).toEqual([]);
  });

  it('Test 2: linear chain A->B->C has no cycles', () => {
    const result = detectCycles(edges(['A', 'B'], ['B', 'C']));
    expect(result).toEqual([]);
  });

  it('Test 3: simple cycle A->B->A returns [[A, B]]', () => {
    const result = detectCycles(edges(['A', 'B'], ['B', 'A']));
    expect(result).toEqual([['A', 'B']]);
  });

  it('Test 4: triangle A->B->C->A returns [[A, B, C]]', () => {
    const result = detectCycles(edges(['A', 'B'], ['B', 'C'], ['C', 'A']));
    expect(result).toEqual([['A', 'B', 'C']]);
  });

  it('Test 5: self-import A->A returns [[A]]', () => {
    const result = detectCycles(edges(['A', 'A']));
    expect(result).toEqual([['A']]);
  });

  it('Test 6: two independent cycles sorted by first element', () => {
    const result = detectCycles(
      edges(['A', 'B'], ['B', 'A'], ['C', 'D'], ['D', 'C'])
    );
    // Groups sorted by first element: A < C
    expect(result).toEqual([['A', 'B'], ['C', 'D']]);
  });

  it('Test 7: mixed cycle + non-cycle nodes — only cycle nodes in result', () => {
    // A->B->A is a cycle; E->F is linear (no cycle)
    const result = detectCycles(
      edges(['A', 'B'], ['B', 'A'], ['E', 'F'])
    );
    expect(result).toEqual([['A', 'B']]);
    // E and F should not appear in any group
    const flat = result.flat();
    expect(flat).not.toContain('E');
    expect(flat).not.toContain('F');
  });

  it('Test 8: singleton SCC without self-edge is NOT a cycle', () => {
    // A->B: A and B are reachable but NOT mutually dependent — singleton SCCs
    const result = detectCycles(edges(['A', 'B']));
    expect(result).toEqual([]);
  });

  it('Test 9: large cycle of 1000 nodes completes without stack overflow', () => {
    // Build a chain 0->1->2->...->999->0 (one big cycle)
    const edgeList: Array<{ source_path: string; target_path: string }> = [];
    for (let i = 0; i < 1000; i++) {
      edgeList.push({ source_path: String(i), target_path: String((i + 1) % 1000) });
    }
    const result = detectCycles(edgeList);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1000);
  });

  it('Test 10: deterministic output — same input produces identical sorted output across multiple calls', () => {
    const input = edges(['B', 'A'], ['A', 'B'], ['D', 'C'], ['C', 'D']);
    const result1 = detectCycles(input);
    const result2 = detectCycles(input);
    const result3 = detectCycles(input);
    expect(result1).toEqual(result2);
    expect(result2).toEqual(result3);
    // Verify the results are sorted
    expect(result1[0][0] <= result1[1][0]).toBe(true);
  });
});

describe('buildAdjacencyList', () => {
  it('builds adjacency list from edges including target-only nodes', () => {
    const adj = buildAdjacencyList(edges(['A', 'B'], ['A', 'C']));
    expect(adj.has('A')).toBe(true);
    expect(adj.get('A')).toEqual(['B', 'C']);
    // B and C are target-only — they should exist as nodes with empty arrays
    expect(adj.has('B')).toBe(true);
    expect(adj.get('B')).toEqual([]);
    expect(adj.has('C')).toBe(true);
    expect(adj.get('C')).toEqual([]);
  });

  it('returns empty map for empty edge list', () => {
    const adj = buildAdjacencyList([]);
    expect(adj.size).toBe(0);
  });

  it('handles self-edge correctly', () => {
    const adj = buildAdjacencyList(edges(['A', 'A']));
    expect(adj.has('A')).toBe(true);
    expect(adj.get('A')).toContain('A');
  });
});

describe('iterativeTarjanSCC', () => {
  it('returns empty array for empty adjacency list', () => {
    const sccs = iterativeTarjanSCC(new Map());
    expect(sccs).toEqual([]);
  });

  it('returns singleton SCCs for nodes with no cycles', () => {
    const adj = new Map([
      ['A', ['B']],
      ['B', ['C']],
      ['C', []],
    ]);
    const sccs = iterativeTarjanSCC(adj);
    // Each node is its own SCC (no cycles)
    expect(sccs).toHaveLength(3);
    sccs.forEach(scc => expect(scc).toHaveLength(1));
  });

  it('returns one multi-node SCC for a cycle', () => {
    const adj = new Map([
      ['A', ['B']],
      ['B', ['A']],
    ]);
    const sccs = iterativeTarjanSCC(adj);
    const multiNode = sccs.filter(s => s.length > 1);
    expect(multiNode).toHaveLength(1);
    expect(multiNode[0].sort()).toEqual(['A', 'B']);
  });
});
