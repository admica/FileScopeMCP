<!-- GraphFilter: directory filter dropdown for the dependency graph -->
<script lang="ts">
  import type { GraphNode } from '../lib/api';

  let { nodes, selectedDir, onSelect }: {
    nodes: GraphNode[];
    selectedDir: string;
    onSelect: (dir: string) => void;
  } = $props();

  // Derive unique directories with file counts, sorted by count descending
  let directories = $derived.by(() => {
    const counts: Record<string, number> = {};
    for (const n of nodes) {
      const dir = n.directory || '(root)';
      counts[dir] = (counts[dir] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([dir, count]) => ({ dir: dir === '(root)' ? '' : dir, label: dir || '(root)', count }));
  });
</script>

<div class="flex items-center gap-2 px-3 py-1.5 border-b border-gray-700 text-xs">
  <label for="graph-filter" class="text-gray-400 whitespace-nowrap">Filter:</label>
  <select
    id="graph-filter"
    class="bg-gray-800 text-gray-200 border border-gray-600 rounded px-2 py-0.5 text-xs flex-1 min-w-0"
    value={selectedDir}
    onchange={(e) => onSelect((e.currentTarget as HTMLSelectElement).value)}
  >
    <option value="">All ({nodes.length})</option>
    {#each directories as d (d.dir)}
      <option value={d.dir}>{d.label} ({d.count})</option>
    {/each}
  </select>
</div>
