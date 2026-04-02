<script lang="ts">
  import FileTree from '../components/FileTree.svelte';
  import DetailPanel from '../components/DetailPanel.svelte';
  import DependencyGraph from '../components/DependencyGraph.svelte';
  import GraphFilter from '../components/GraphFilter.svelte';
  import { fetchGraph, type GraphNode, type GraphEdge } from '../lib/api';

  let {
    repoName,
    filePath,
    dirPath,
    showGraph,
  }: {
    repoName: string;
    filePath: string | null;
    dirPath: string | null;
    showGraph: boolean;
  } = $props();

  let treeWidth = $state(30); // percent

  // ─── Graph state ──────────────────────────────────────────────────────────
  let graphNodes: GraphNode[] = $state([]);
  let graphEdges: GraphEdge[] = $state([]);
  let graphLoading = $state(false);
  let graphFilterDir = $state('');

  function onDividerPointerDown(e: PointerEvent) {
    const container = (e.currentTarget as HTMLElement).parentElement!;
    const startX = e.clientX;
    const startWidth = treeWidth;

    function onMove(ev: PointerEvent) {
      const delta = ev.clientX - startX;
      const containerWidth = container.getBoundingClientRect().width;
      const newPct = startWidth + (delta / containerWidth) * 100;
      treeWidth = Math.max(15, Math.min(70, newPct)); // clamp 15%–70%
    }
    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    e.preventDefault();
  }

  function handleSelectFile(path: string) {
    window.location.hash = `#/project/${encodeURIComponent(repoName)}/file/${path}`;
  }

  function handleSelectDir(path: string) {
    window.location.hash = `#/project/${encodeURIComponent(repoName)}/dir/${path}`;
  }

  function handleSelectFileFromGraph(path: string) {
    window.location.hash = `#/project/${encodeURIComponent(repoName)}/graph/file/${path}`;
  }

  // ─── Fetch graph data when showGraph is true or repoName changes ──────────
  $effect(() => {
    if (!showGraph) return;
    const repo = repoName;
    graphLoading = true;
    graphNodes = [];
    graphEdges = [];
    graphFilterDir = '';
    fetchGraph(repo).then(r => {
      graphNodes = r.nodes;
      graphEdges = r.edges;
      graphLoading = false;
      // D-12: Auto-filter large repos to largest directory
      if (r.nodes.length > 500) {
        const counts: Record<string, number> = {};
        for (const n of r.nodes) {
          const dir = n.directory || '';
          if (dir) counts[dir] = (counts[dir] || 0) + 1;
        }
        const largest = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (largest) graphFilterDir = largest[0];
      }
    }).catch(err => {
      console.error('Failed to load graph:', err);
      graphLoading = false;
    });
  });
</script>

<div class="flex flex-1 overflow-hidden" style="height: calc(100vh - 3rem)">
  <!-- Left panel: file tree or dependency graph -->
  <div class="flex flex-col overflow-hidden border-r border-gray-700" style="width: {treeWidth}%">
    <!-- Toggle: Tree | Graph -->
    <div class="flex gap-1 px-3 py-1.5 border-b border-gray-700 flex-shrink-0">
      <button
        class="px-3 py-1 text-xs rounded transition-colors {!showGraph ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}"
        onclick={() => window.location.hash = `#/project/${encodeURIComponent(repoName)}`}
      >Tree</button>
      <button
        class="px-3 py-1 text-xs rounded transition-colors {showGraph ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}"
        onclick={() => window.location.hash = `#/project/${encodeURIComponent(repoName)}/graph`}
      >Graph</button>
    </div>

    <!-- Content: tree or graph -->
    {#if showGraph}
      {#if graphLoading}
        <p class="text-gray-500 text-sm px-4 py-2">Loading graph...</p>
      {:else if graphNodes.length === 0}
        <p class="text-gray-500 text-sm px-4 py-2">No dependency data found.</p>
      {:else}
        <GraphFilter
          nodes={graphNodes}
          selectedDir={graphFilterDir}
          onSelect={(dir) => { graphFilterDir = dir; }}
        />
        <div class="flex-1 min-h-0">
          <DependencyGraph
            nodes={graphNodes}
            edges={graphEdges}
            selectedPath={filePath}
            onSelectFile={handleSelectFileFromGraph}
            filterDir={graphFilterDir}
            onFilterChange={(dir) => { graphFilterDir = dir; }}
          />
        </div>
      {/if}
    {:else}
      <div class="flex-1 overflow-y-auto">
        <FileTree
          {repoName}
          selectedPath={filePath ?? dirPath}
          onSelectFile={handleSelectFile}
          onSelectDir={handleSelectDir}
        />
      </div>
    {/if}
  </div>

  <!-- Resizable divider -->
  <div
    role="separator"
    aria-label="Resize panels"
    class="w-1 bg-gray-700 hover:bg-blue-500 cursor-col-resize flex-shrink-0 transition-colors"
    onpointerdown={onDividerPointerDown}
  ></div>

  <!-- Right panel: detail -->
  <div class="flex-1 overflow-y-auto">
    <DetailPanel
      {repoName}
      selectedFile={filePath}
      selectedDir={dirPath}
    />
  </div>
</div>
