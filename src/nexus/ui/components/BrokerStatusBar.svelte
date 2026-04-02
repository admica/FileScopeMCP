<script lang="ts">
  import type { BrokerStatus } from '../lib/api';

  let { status, pulsing }: { status: BrokerStatus | null; pulsing: boolean } = $props();

  function getFilename(filePath: string): string {
    return filePath.split('/').pop() ?? filePath;
  }

  function getRepoName(repoPath: string): string {
    return repoPath.split('/').pop() ?? repoPath;
  }
</script>

<div class="flex items-center gap-4 px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0 flex-wrap">
  <!-- Status badge -->
  <span
    class={[
      'px-2 py-0.5 rounded-full text-xs font-semibold',
      status?.online
        ? 'bg-green-500/20 text-green-400'
        : 'bg-gray-600/20 text-gray-500',
      pulsing ? 'pulse-subtle' : '',
    ].join(' ')}
  >
    {status?.online ? 'Online' : 'Offline'}
  </span>

  <!-- Model name -->
  <span class="text-gray-400 text-sm">{status?.model ?? '--'}</span>

  <!-- Pending count -->
  <span class="text-sm text-gray-300">
    <span class="text-gray-500 text-xs mr-1">pending</span>
    {status?.online ? status.pendingCount : '--'}
  </span>

  <!-- Active job -->
  <span class={[
    'text-sm',
    status?.inProgressJob ? 'text-yellow-300' : 'text-gray-500',
  ].join(' ')}>
    {#if status?.inProgressJob}
      {getFilename(status.inProgressJob.filePath)} ({status.inProgressJob.jobType}) &mdash; {getRepoName(status.inProgressJob.repoPath)}
    {:else}
      --
    {/if}
  </span>

  <!-- Connected clients -->
  <span class="text-sm text-gray-300">
    {status?.online ? `${status.connectedClients} clients` : '--'}
  </span>
</div>

<style>
  .pulse-subtle {
    animation: pulse-fade 0.5s ease-in-out;
  }
  @keyframes pulse-fade {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.7; }
  }
</style>
