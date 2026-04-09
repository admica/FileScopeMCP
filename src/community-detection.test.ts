// src/community-detection.test.ts
// Unit tests for the pure Louvain community detection module.
// Tests use plain array inputs — no SQLite needed for pure function tests.
import { describe, it, expect } from 'vitest';
import { detectCommunities, CommunityResult } from './community-detection.js';

// Helper: weighted edge array constructor
function weightedEdges(...triples: [string, string, number][]): Array<{ source_path: string; target_path: string; weight: number }> {
  return triples.map(([source_path, target_path, weight]) => ({ source_path, target_path, weight }));
}

describe('detectCommunities', () => {
  it('Test 1: empty edges array returns empty CommunityResult array', () => {
    const result = detectCommunities([], new Map());
    expect(result).toEqual([]);
  });

  it('Test 2: two disconnected pairs (A-B, C-D) produce two separate communities', () => {
    const edges = weightedEdges(['A', 'B', 1], ['C', 'D', 1]);
    const result = detectCommunities(edges, new Map());
    expect(result).toHaveLength(2);
    // Verify all four files are covered
    const allMembers = result.flatMap(c => c.members).sort();
    expect(allMembers).toEqual(['A', 'B', 'C', 'D']);
    // Each community should have exactly 2 members
    result.forEach(c => expect(c.members).toHaveLength(2));
    // One community has A+B, the other has C+D
    const communityContents = result.map(c => c.members.sort());
    expect(communityContents).toContainEqual(['A', 'B']);
    expect(communityContents).toContainEqual(['C', 'D']);
  });

  it('Test 3: single connected component (A-B, B-C, C-A) produces one community', () => {
    const edges = weightedEdges(['A', 'B', 1], ['B', 'C', 1], ['C', 'A', 1]);
    const result = detectCommunities(edges, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].members.sort()).toEqual(['A', 'B', 'C']);
  });

  it('Test 4: representative is the member with highest importance score', () => {
    const edges = weightedEdges(['A', 'B', 1], ['B', 'C', 1]);
    const importances = new Map([['A', 3], ['B', 7], ['C', 1]]);
    const result = detectCommunities(edges, importances);
    // All three form one community — B should be the representative
    expect(result).toHaveLength(1);
    expect(result[0].representative).toBe('B');
  });

  it('Test 5: when importance is tied, representative selection is stable (not random)', () => {
    const edges = weightedEdges(['A', 'B', 1], ['B', 'C', 1]);
    const importances = new Map([['A', 5], ['B', 5], ['C', 5]]);
    // Run multiple times — representative should be the same each time
    const results = Array.from({ length: 5 }, () => detectCommunities(edges, importances));
    const reps = results.map(r => r[0]?.representative);
    expect(new Set(reps).size).toBe(1); // All the same value
  });

  it('Test 6: edge weights influence clustering (heavier edges keep nodes together)', () => {
    // Two dense subgraphs (A-B-C and D-E-F) connected by a weak bridge (C-D weight 1)
    // Heavy internal edges should keep subgraphs separate
    const edges = weightedEdges(
      ['A', 'B', 5],
      ['B', 'C', 5],
      ['D', 'E', 5],
      ['E', 'F', 5],
      ['C', 'D', 1],
    );
    const result = detectCommunities(edges, new Map());
    // Should produce 2 communities — A,B,C in one and D,E,F in another
    expect(result).toHaveLength(2);
    const allMembers = result.flatMap(c => c.members).sort();
    expect(allMembers).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('Test 7: every file appears in exactly one community (no duplicates, no omissions)', () => {
    const edges = weightedEdges(
      ['src/a.ts', 'src/b.ts', 2],
      ['src/b.ts', 'src/c.ts', 3],
      ['src/d.ts', 'src/e.ts', 1],
    );
    const result = detectCommunities(edges, new Map());
    const allMembers = result.flatMap(c => c.members);
    // No duplicates
    expect(new Set(allMembers).size).toBe(allMembers.length);
    // All 5 files covered
    expect(allMembers.sort()).toEqual([
      'src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts',
    ]);
  });

  it('Test 8: members array within each community is sorted alphabetically', () => {
    // Use names that would be out-of-order without sorting
    const edges = weightedEdges(['zebra.ts', 'apple.ts', 1], ['mango.ts', 'apple.ts', 1]);
    const result = detectCommunities(edges, new Map());
    expect(result).toHaveLength(1);
    const members = result[0].members;
    const sorted = [...members].sort();
    expect(members).toEqual(sorted);
  });

  it('Test 9: CommunityResult has correct size field matching members.length', () => {
    const edges = weightedEdges(['A', 'B', 1], ['B', 'C', 1], ['X', 'Y', 1]);
    const result = detectCommunities(edges, new Map());
    result.forEach(c => {
      expect(c.size).toBe(c.members.length);
    });
  });
});
