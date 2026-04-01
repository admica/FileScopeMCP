<script lang="ts">
  import { fetchProjectStats, type RepoStats } from '../lib/api';
  import StatsCard from '../components/StatsCard.svelte';

  let { repoName }: { repoName: string } = $props();

  let stats: RepoStats | null = $state(null);
  let error: string | null = $state(null);

  $effect(() => {
    // Re-fetch when repoName changes
    stats = null;
    error = null;
    if (!repoName) return;
    fetchProjectStats(repoName)
      .then(s => { stats = s; })
      .catch(e => { error = (e as Error).message; });
  });
</script>

<div class="max-w-6xl mx-auto p-6">
  {#if error}
    <p class="text-red-400">{error}</p>
  {:else}
    <StatsCard {stats} {repoName} />
    <div class="mt-6 text-gray-600 italic text-sm">
      File tree and detail panel coming in Phase 21.
    </div>
  {/if}
</div>
