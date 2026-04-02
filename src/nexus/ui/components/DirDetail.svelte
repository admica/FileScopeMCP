<script lang="ts">
  import type { DirDetail as DirDetailType } from '../lib/api';

  let { detail, repoName }: {
    detail: DirDetailType;
    repoName: string;
  } = $props();

  function navigateToFile(filePath: string) {
    window.location.hash = `#/project/${encodeURIComponent(repoName)}/file/${filePath}`;
  }
</script>

<!-- Directory header -->
<div class="px-4 py-3 border-b border-gray-700">
  <h2 class="text-lg font-semibold text-gray-100">{detail.name}/</h2>
  <p class="text-xs text-gray-500 mt-0.5">{detail.path}</p>
</div>

<!-- Stats grid -->
<div class="grid grid-cols-2 gap-4 p-4 border-b border-gray-700">
  <div>
    <div class="text-2xl font-bold text-blue-400">{detail.totalFiles}</div>
    <div class="text-xs text-gray-500 uppercase tracking-wide">Total Files</div>
  </div>
  <div>
    <div class="text-2xl font-bold text-blue-400">{detail.avgImportance}</div>
    <div class="text-xs text-gray-500 uppercase tracking-wide">Avg Importance</div>
  </div>
  <div>
    <div class="text-2xl font-bold text-blue-400">{detail.pctWithSummary}%</div>
    <div class="text-xs text-gray-500 uppercase tracking-wide">Summarized</div>
  </div>
  <div>
    <div class="text-2xl font-bold text-blue-400">{detail.pctStale}%</div>
    <div class="text-xs text-gray-500 uppercase tracking-wide">Stale</div>
  </div>
</div>

<!-- Top files -->
<div class="px-4 pb-4 pt-3">
  <h3 class="text-sm font-semibold text-gray-300 mb-2">Top Files by Importance</h3>
  {#each detail.topFiles as file}
    <button
      class="w-full text-left flex items-center justify-between py-1 px-2 hover:bg-gray-800 rounded transition-colors"
      onclick={() => navigateToFile(file.path)}
    >
      <span class="text-sm text-blue-400 font-mono truncate">{file.path}</span>
      <span class="text-xs text-gray-500 ml-2 flex-shrink-0">{file.importance}</span>
    </button>
  {/each}
  {#if detail.topFiles.length === 0}
    <p class="text-gray-500 text-sm">No files in this directory.</p>
  {/if}
</div>
