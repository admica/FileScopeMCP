<script lang="ts">
  import type { RepoListItem } from '../lib/api';

  let { repos, hash }: { repos: RepoListItem[]; hash: string } = $props();

  function isActiveRepo(repoName: string): boolean {
    return hash.startsWith(`#/project/${repoName}`);
  }

  function isActiveSystem(): boolean {
    return hash === '#/system';
  }

  function isActiveSettings(): boolean {
    return hash === '#/settings';
  }

  function dotColor(repo: RepoListItem): string {
    if (!repo.online) return 'bg-gray-500';
    const FIVE_MIN = 5 * 60 * 1000;
    const isRecent = repo.dbMtimeMs != null && (Date.now() - repo.dbMtimeMs) < FIVE_MIN;
    if (isRecent) return 'bg-green-500';
    if (repo.staleCount > 0) return 'bg-orange-400';
    return 'bg-gray-500';
  }
</script>

<nav class="bg-gray-900 border-b border-gray-700 px-4">
  <div class="flex items-center gap-1 h-12">
    <!-- Logo -->
    <a href="#/" class="text-lg font-bold text-blue-400 mr-6 hover:text-blue-300 transition-colors">
      Nexus
    </a>

    <!-- Repo tabs -->
    {#each repos as repo}
      <a
        href={`#/project/${repo.name}`}
        class={[
          'flex items-center gap-1.5 px-3 py-2 text-sm rounded-t hover:bg-gray-800 transition-colors',
          isActiveRepo(repo.name)
            ? 'border-b-2 border-blue-500 text-blue-400'
            : 'text-gray-400 hover:text-gray-200',
          !repo.online ? 'opacity-50' : '',
        ].join(' ')}
        title={repo.online ? repo.path : `${repo.path} (offline)`}
      >
        <span class="inline-block w-2 h-2 rounded-full flex-shrink-0 {dotColor(repo)}"></span>
        {repo.name}
        {#if !repo.online}
          <span class="ml-1 text-xs text-gray-600">(offline)</span>
        {/if}
      </a>
    {/each}

    <!-- Spacer -->
    <div class="flex-1"></div>

    <!-- System tab -->
    <a
      href="#/system"
      class={[
        'px-3 py-2 text-sm rounded-t hover:bg-gray-800 transition-colors',
        isActiveSystem()
          ? 'border-b-2 border-blue-500 text-blue-400'
          : 'text-gray-400 hover:text-gray-200',
      ].join(' ')}
    >
      System
    </a>

    <!-- Settings gear -->
    <a
      href="#/settings"
      class={[
        'px-3 py-2 text-sm rounded-t hover:bg-gray-800 transition-colors',
        isActiveSettings()
          ? 'border-b-2 border-blue-500 text-blue-400'
          : 'text-gray-400 hover:text-gray-200',
      ].join(' ')}
      title="Settings"
    >
      &#x2699;
    </a>
  </div>
</nav>
