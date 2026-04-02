<script lang="ts">
  import FileDetail from './FileDetail.svelte';
  import DirDetail from './DirDetail.svelte';
  import StatsCard from './StatsCard.svelte';
  import { fetchFileDetail, fetchDirDetail, fetchProjectStats } from '../lib/api';
  import type { FileDetail as FileDetailType, DirDetail as DirDetailType, RepoStats } from '../lib/api';

  let {
    repoName,
    selectedFile,
    selectedDir,
  }: {
    repoName: string;
    selectedFile: string | null;
    selectedDir: string | null;
  } = $props();

  let fileDetail: FileDetailType | null = $state(null);
  let dirDetail: DirDetailType | null = $state(null);
  let stats: RepoStats | null = $state(null);
  let loading = $state(false);
  let error: string | null = $state(null);

  // Fetch file detail when selectedFile changes
  $effect(() => {
    if (!selectedFile) { fileDetail = null; return; }
    loading = true; error = null;
    fetchFileDetail(repoName, selectedFile)
      .then(d => { fileDetail = d; loading = false; })
      .catch(e => { error = (e as Error).message; loading = false; });
  });

  // Fetch dir detail when selectedDir changes
  $effect(() => {
    if (!selectedDir) { dirDetail = null; return; }
    loading = true; error = null;
    fetchDirDetail(repoName, selectedDir)
      .then(d => { dirDetail = d; loading = false; })
      .catch(e => { error = (e as Error).message; loading = false; });
  });

  // Fetch stats for default view
  $effect(() => {
    fetchProjectStats(repoName)
      .then(s => { stats = s; })
      .catch(() => {});
  });

  let mode = $derived(selectedFile ? 'file' : selectedDir ? 'dir' : 'stats');
</script>

<div class="overflow-y-auto h-full">
  {#if error}
    <p class="text-red-400 p-4">{error}</p>
  {:else if loading}
    <p class="text-gray-500 italic p-4">Loading...</p>
  {:else if mode === 'file' && fileDetail}
    <FileDetail detail={fileDetail} {repoName} />
  {:else if mode === 'dir' && dirDetail}
    <DirDetail detail={dirDetail} {repoName} />
  {:else}
    <div class="p-4">
      <StatsCard {stats} {repoName} />
    </div>
  {/if}
</div>
