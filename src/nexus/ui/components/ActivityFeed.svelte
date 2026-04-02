<script lang="ts">
  import { onDestroy } from 'svelte';
  import { tick } from 'svelte';
  import type { LogLine } from '../lib/api';

  let lines: LogLine[] = $state([]);
  let activeFilter: string = $state('All');
  let autoScroll = $state(true);
  let feedEl: HTMLDivElement;
  let es: EventSource | null = null;

  let knownPrefixes: string[] = $derived(
    ['All', ...new Set(lines.map(l => l.prefix || l.source).filter(Boolean))]
  );

  let filteredLines: LogLine[] = $derived(
    activeFilter === 'All'
      ? lines
      : lines.filter(l => l.prefix === activeFilter || (activeFilter === l.source && l.prefix === ''))
  );

  // Prefix color assignment (auto-assigned, not hardcoded)
  const COLORS = [
    'bg-blue-500/20 text-blue-400',
    'bg-green-500/20 text-green-400',
    'bg-purple-500/20 text-purple-400',
    'bg-yellow-500/20 text-yellow-400',
    'bg-red-500/20 text-red-400',
    'bg-cyan-500/20 text-cyan-400',
    'bg-pink-500/20 text-pink-400',
    'bg-orange-500/20 text-orange-400',
  ];
  const prefixColorMap = new Map<string, string>();

  function getPrefixColor(prefix: string): string {
    const key = prefix || 'default';
    if (!prefixColorMap.has(key)) {
      prefixColorMap.set(key, COLORS[prefixColorMap.size % COLORS.length]);
    }
    return prefixColorMap.get(key)!;
  }

  function connectSSE() {
    es = new EventSource('/api/stream/activity');
    es.onmessage = (event) => {
      try {
        const line = JSON.parse(event.data) as LogLine;
        lines = [...lines, line];
        // Keep client-side buffer bounded (last 2000 lines max)
        if (lines.length > 2000) lines = lines.slice(-1500);
        if (autoScroll) {
          tick().then(() => {
            if (feedEl) feedEl.scrollTop = feedEl.scrollHeight;
          });
        }
      } catch { /* ignore malformed */ }
    };
    es.onerror = () => {
      es?.close();
      setTimeout(connectSSE, 3000);
    };
  }

  $effect(() => {
    connectSSE();
    return () => { es?.close(); es = null; };
  });

  function onScroll() {
    if (!feedEl) return;
    const atBottom = feedEl.scrollHeight - feedEl.scrollTop - feedEl.clientHeight < 50;
    autoScroll = atBottom;
  }

  function jumpToLatest() {
    if (feedEl) {
      feedEl.scrollTop = feedEl.scrollHeight;
      autoScroll = true;
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- Filter bar -->
  <div class="flex items-center gap-2 px-4 py-2 border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
    <label class="text-xs text-gray-400">Filter:</label>
    <select
      class="bg-gray-700 text-gray-200 text-sm rounded px-2 py-1 border border-gray-600"
      bind:value={activeFilter}
    >
      {#each knownPrefixes as pf}
        <option value={pf}>{pf}</option>
      {/each}
    </select>
    {#if !autoScroll}
      <button
        class="ml-auto text-xs bg-blue-600 hover:bg-blue-500 text-white px-2 py-1 rounded"
        onclick={jumpToLatest}
      >
        Jump to latest
      </button>
    {/if}
  </div>

  <!-- Log lines -->
  <div
    class="flex-1 overflow-y-auto px-4 py-2"
    bind:this={feedEl}
    onscroll={onScroll}
  >
    {#each filteredLines as line}
      <div class="flex items-start gap-3 py-0.5 text-sm border-b border-gray-800/50">
        <span class="text-gray-500 text-xs font-mono w-24 flex-shrink-0 pt-0.5">
          {line.timestamp.split('T')[1]?.replace('Z', '') ?? line.timestamp}
        </span>
        <span class="px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 {getPrefixColor(line.prefix || line.source)}">
          {line.prefix || line.source}
        </span>
        <span class="text-gray-200 break-all">{line.message}</span>
      </div>
    {/each}
    {#if filteredLines.length === 0}
      <p class="text-gray-500 italic text-sm py-4">No log activity yet.</p>
    {/if}
  </div>
</div>
