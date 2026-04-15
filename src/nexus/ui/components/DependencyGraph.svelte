<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import cytoscape from 'cytoscape';
  import fcose from 'cytoscape-fcose';
  import type { GraphNode, GraphEdge } from '../lib/api';

  // Register fcose once at module level (NOT inside onMount — causes duplicate registration errors)
  cytoscape.use(fcose);

  let {
    nodes,
    edges,
    selectedPath,
    onSelectFile,
    filterDir,
    onFilterChange,
  }: {
    nodes: GraphNode[];
    edges: GraphEdge[];
    selectedPath: string | null;
    onSelectFile: (path: string) => void;
    filterDir: string;
    onFilterChange: (dir: string) => void;
  } = $props();

  // ─── Directory color palette (dark-mode friendly) ─────────────────────────
  const DIRECTORY_COLORS = [
    '#60a5fa', // blue-400
    '#34d399', // emerald-400
    '#f472b6', // pink-400
    '#fb923c', // orange-400
    '#a78bfa', // violet-400
    '#facc15', // yellow-400
    '#22d3ee', // cyan-400
    '#f87171', // red-400
  ];
  const ROOT_COLOR = '#9ca3af'; // gray-400 for root-level files

  // ─── Helpers ──────────────────────────────────────────────────────────────

  // Color map is keyed by community id (as string).
  // 'none' = files with no community assignment.
  function buildColorMap(nodeList: GraphNode[]): Record<string, string> {
    const ids = [...new Set(
      nodeList.map(n => n.communityId).filter((id): id is number => id !== null)
    )].sort((a, b) => a - b);
    const map: Record<string, string> = { none: ROOT_COLOR };
    ids.forEach((id, i) => {
      map[String(id)] = DIRECTORY_COLORS[i % DIRECTORY_COLORS.length];
    });
    return map;
  }

  function buildElements(
    nodeList: GraphNode[],
    edgeList: GraphEdge[],
    colorMap: Record<string, string>
  ): cytoscape.ElementDefinition[] {
    // Live communities = those with at least one child in the (filtered) node set.
    // Empty communities (no surviving children after filter) are not emitted.
    const liveCommunities = new Set<number>();
    for (const n of nodeList) {
      if (n.communityId !== null) liveCommunities.add(n.communityId);
    }

    // Compound parent nodes — one per live community.
    // IDs use prefix `community_` to avoid collision with file paths (which contain `/`).
    const parentEls: cytoscape.ElementDefinition[] = Array.from(liveCommunities)
      .sort((a, b) => a - b)
      .map(id => ({
        data: {
          id: `community_${id}`,
          name: `Community ${id}`,
          color: colorMap[String(id)] ?? ROOT_COLOR,
        },
      }));

    // Child nodes — `parent` data ref groups them inside their community bubble.
    // Files with no community render as free nodes (no parent ref, ROOT_COLOR).
    const nodeEls: cytoscape.ElementDefinition[] = nodeList.map(n => {
      const data: Record<string, unknown> = {
        id: n.path,
        name: n.name,
        importance: n.importance,
        degree: n.degree,
        color: n.communityId !== null
          ? (colorMap[String(n.communityId)] ?? ROOT_COLOR)
          : ROOT_COLOR,
        directory: n.directory,
        hasSummary: n.hasSummary,
        isStale: n.isStale,
      };
      if (n.communityId !== null) data.parent = `community_${n.communityId}`;
      return { data };
    });

    const edgeEls: cytoscape.ElementDefinition[] = edgeList.map((e, i) => ({
      data: { id: `e${i}`, source: e.source, target: e.target },
    }));
    return [...parentEls, ...nodeEls, ...edgeEls];
  }

  function filterGraph(
    allNodes: GraphNode[],
    allEdges: GraphEdge[],
    selectedDir: string
  ): { nodes: GraphNode[]; edges: GraphEdge[] } {
    if (!selectedDir) return { nodes: allNodes, edges: allEdges };
    const inSubtree = (p: string) => p.startsWith(selectedDir + '/');
    const filteredEdges = allEdges.filter(e => inSubtree(e.source) || inSubtree(e.target));
    const keepPaths = new Set<string>();
    filteredEdges.forEach(e => { keepPaths.add(e.source); keepPaths.add(e.target); });
    const filteredNodes = allNodes.filter(n => keepPaths.has(n.path));
    return { nodes: filteredNodes, edges: filteredEdges };
  }

  // ─── State ────────────────────────────────────────────────────────────────

  let container: HTMLDivElement;
  let cy: ReturnType<typeof cytoscape> | null = $state(null);
  let resizeObserver: ResizeObserver | null = null;
  let tooltipEl: HTMLDivElement;
  let tooltipVisible = $state(false);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let tooltipText = $state('');

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  onMount(() => {
    const filtered = filterGraph(nodes, edges, filterDir);
    const colorMap = buildColorMap(filtered.nodes);

    cy = cytoscape({
      container,
      elements: buildElements(filtered.nodes, filtered.edges, colorMap),
      style: [
        {
          // node:childless = file nodes only (excludes compound parents).
          // Size scales with degree (in+out edge count) — hubs become visibly larger.
          selector: 'node:childless',
          style: {
            'width': (ele: cytoscape.NodeSingular) => 14 + Math.sqrt(ele.data('degree') ?? 0) * 6,
            'height': (ele: cytoscape.NodeSingular) => 14 + Math.sqrt(ele.data('degree') ?? 0) * 6,
            'background-color': 'data(color)',
            'label': 'data(name)',
            'font-size': 10,
            'color': '#e5e7eb',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            'min-zoomed-font-size': 8,
          },
        },
        {
          // node:parent = community bubble. No width/height set → auto-fits children + padding.
          selector: 'node:parent',
          style: {
            'background-color': 'data(color)',
            'background-opacity': 0.08,
            'border-width': 1,
            'border-style': 'dashed',
            'border-color': '#4b5563',
            'shape': 'round-rectangle',
            'padding': 20,
            'label': 'data(name)',
            'font-size': 11,
            'color': '#9ca3af',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': -6,
            'min-zoomed-font-size': 6,
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1,
            'line-color': '#4b5563',
            'target-arrow-color': '#4b5563',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'opacity': 0.6,
          },
        },
        {
          selector: '.dimmed',
          style: {
            opacity: 0.08,
          },
        },
        {
          selector: '.highlighted',
          style: {
            opacity: 1,
          },
        },
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#60a5fa',
            'opacity': 0.8,
          },
        },
        {
          selector: '.selected-node',
          style: {
            'border-width': 3,
            'border-color': '#60a5fa',
          },
        },
      ],
      layout: {
        name: 'fcose',
        animate: true,
        randomize: true,                 // breaks the deterministic staircase seed
        quality: 'proof',
        nodeRepulsion: 4500,
        idealEdgeLength: 60,
        gravity: 0.25,
        gravityRangeCompound: 1.5,       // pulls communities toward each other
        gravityCompound: 1.0,            // pulls children inside their community bubble
        numIter: 2500,
        packComponents: true,
        tilingPaddingVertical: 10,
        tilingPaddingHorizontal: 10,
        nodeSeparation: 75,
      } as cytoscape.LayoutOptions,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    // ─── Track mouse position for tooltip ─────────────────────────────────
    cy.on('mousemove', (e) => {
      const oe = e.originalEvent as MouseEvent;
      tooltipX = oe.clientX;
      tooltipY = oe.clientY;
    });

    // ─── Node hover: highlight neighborhood, dim others ────────────────────
    cy.on('mouseover', 'node', (e) => {
      const node = e.target;
      if (node.isParent()) return; // skip community bubbles
      const neighborhood = node.closedNeighborhood();
      // Keep parent bubbles of the highlighted set visible (not dimmed)
      const keep = neighborhood.union(neighborhood.parents());
      cy!.elements().difference(keep).addClass('dimmed');
      neighborhood.addClass('highlighted');
      tooltipText = `${node.data('name')} (deg ${node.data('degree')})`;
      tooltipVisible = true;
    });

    cy.on('mouseout', 'node', () => {
      cy!.elements().removeClass('dimmed highlighted');
      tooltipVisible = false;
    });

    // ─── Edge hover: show source → target tooltip ─────────────────────────
    cy.on('mouseover', 'edge', (e) => {
      const edge = e.target;
      tooltipText = `${edge.source().data('name')} → ${edge.target().data('name')}`;
      tooltipVisible = true;
    });

    cy.on('mouseout', 'edge', () => {
      tooltipVisible = false;
    });

    // ─── Node click: navigate to file detail ──────────────────────────────
    cy.on('tap', 'node', (e) => {
      if (e.target.isParent()) return; // ignore community bubble clicks
      onSelectFile(e.target.id());
    });

    // ─── Resize observer: recalculate viewport ────────────────────────────
    resizeObserver = new ResizeObserver(() => {
      cy?.resize();
    });
    resizeObserver.observe(container);

    // ─── Highlight selected path on mount ─────────────────────────────────
    if (selectedPath) {
      cy.$id(selectedPath).addClass('selected-node');
    }

    // ─── D-12: Auto-filter large repos to largest directory ───────────────
    if (nodes.length > 500 && filterDir === '') {
      const counts: Record<string, number> = {};
      for (const n of nodes) {
        const dir = n.directory || '';
        if (dir) counts[dir] = (counts[dir] || 0) + 1;
      }
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (entries.length > 0) {
        onFilterChange(entries[0][0]);
      }
    }
  });

  onDestroy(() => {
    resizeObserver?.disconnect();
    cy?.destroy();
    cy = null;
  });

  // ─── Effect: re-render when data or filter changes ────────────────────────
  $effect(() => {
    if (!cy) return;
    const filtered = filterGraph(nodes, edges, filterDir);
    const colorMap = buildColorMap(filtered.nodes);
    cy.elements().remove();
    cy.add(buildElements(filtered.nodes, filtered.edges, colorMap));
    cy.layout({
      name: 'fcose',
      animate: true,
      randomize: true,
      quality: 'proof',
      nodeRepulsion: 4500,
      idealEdgeLength: 60,
      gravity: 0.25,
      gravityRangeCompound: 1.5,
      gravityCompound: 1.0,
      numIter: 2500,
      packComponents: true,
      tilingPaddingVertical: 10,
      tilingPaddingHorizontal: 10,
      nodeSeparation: 75,
    } as cytoscape.LayoutOptions).run();
    // Highlight selected node if any
    if (selectedPath) {
      const sel = cy.$id(selectedPath);
      if (sel.length) sel.addClass('selected-node');
    }
  });

  // ─── Effect: highlight selected node without re-layout ────────────────────
  $effect(() => {
    if (!cy) return;
    cy.elements().removeClass('selected-node');
    if (selectedPath) {
      const sel = cy.$id(selectedPath);
      if (sel.length) sel.addClass('selected-node');
    }
  });
</script>

<div class="relative w-full h-full">
  <div bind:this={container} class="w-full h-full"></div>
  <!-- Tooltip -->
  {#if tooltipVisible}
    <div
      bind:this={tooltipEl}
      class="fixed z-50 px-2 py-1 text-xs bg-gray-800 text-gray-200 border border-gray-600 rounded shadow-lg pointer-events-none max-w-xs truncate"
      style="left: {tooltipX + 12}px; top: {tooltipY - 8}px;"
    >
      {tooltipText}
    </div>
  {/if}
</div>
