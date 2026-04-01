<script lang="ts">
  import type { RepoStats } from '../lib/api';

  let { stats, repoName }: { stats: RepoStats | null; repoName: string } = $props();

  function pct(numerator: number, denominator: number): string {
    if (!denominator) return '0%';
    return Math.round((numerator / denominator) * 100) + '%';
  }
</script>

<div class="bg-gray-900 rounded-lg border border-gray-700 p-6">
  <h2 class="text-xl font-semibold text-gray-100 mb-4">{repoName}</h2>

  {#if stats === null}
    <p class="text-gray-500 italic">Loading stats...</p>
  {:else}
    <div class="grid grid-cols-2 md:grid-cols-5 gap-4">
      <div>
        <div class="text-2xl font-bold text-blue-400">{stats.totalFiles}</div>
        <div class="text-xs text-gray-500 uppercase tracking-wide">Total Files</div>
      </div>
      <div>
        <div class="text-2xl font-bold text-blue-400">{pct(stats.withSummary, stats.totalFiles)}</div>
        <div class="text-xs text-gray-500 uppercase tracking-wide">Summarized</div>
      </div>
      <div>
        <div class="text-2xl font-bold text-blue-400">{pct(stats.withConcepts, stats.totalFiles)}</div>
        <div class="text-xs text-gray-500 uppercase tracking-wide">With Concepts</div>
      </div>
      <div>
        <div class="text-2xl font-bold text-blue-400">{stats.staleCount}</div>
        <div class="text-xs text-gray-500 uppercase tracking-wide">Stale Files</div>
      </div>
      <div>
        <div class="text-2xl font-bold text-blue-400">{stats.totalDeps}</div>
        <div class="text-xs text-gray-500 uppercase tracking-wide">Local Deps</div>
      </div>
    </div>
  {/if}
</div>
