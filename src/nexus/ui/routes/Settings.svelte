<script lang="ts">
  import {
    fetchRepos,
    fetchBlacklist,
    removeRepoApi,
    restoreRepoApi,
    type RepoListItem,
    type BlacklistEntry,
  } from '../lib/api';

  let {
    onRefresh,
  }: {
    onRefresh: () => void;
  } = $props();

  let repos: RepoListItem[] = $state([]);
  let blacklist: BlacklistEntry[] = $state([]);
  let loadingRepos = $state(true);
  let loadingBlacklist = $state(true);

  async function loadData() {
    loadingRepos = true;
    loadingBlacklist = true;
    try {
      repos = await fetchRepos();
    } catch (e) {
      console.error('Failed to load repos:', e);
    }
    loadingRepos = false;
    try {
      blacklist = await fetchBlacklist();
    } catch (e) {
      console.error('Failed to load blacklist:', e);
    }
    loadingBlacklist = false;
  }

  $effect(() => { loadData(); });

  async function handleRemove(repo: RepoListItem) {
    if (!confirm(`Remove ${repo.name} from Nexus? This won't delete any data.`)) return;
    try {
      await removeRepoApi(repo.name);
      await loadData();
      onRefresh();
    } catch (e) {
      console.error('Failed to remove repo:', e);
    }
  }

  async function handleRestore(entry: BlacklistEntry) {
    try {
      await restoreRepoApi(entry.name, entry.path);
      await loadData();
      onRefresh();
    } catch (e) {
      console.error('Failed to restore repo:', e);
    }
  }
</script>

<div class="max-w-5xl mx-auto p-6">
  <h1 class="text-2xl font-bold text-gray-100 mb-6">Settings</h1>

  <!-- Active Repos Table -->
  <h2 class="text-lg font-semibold text-gray-200 mb-3">Active Repositories</h2>
  {#if loadingRepos}
    <p class="text-gray-500 text-sm mb-6">Loading...</p>
  {:else if repos.length === 0}
    <p class="text-gray-500 text-sm mb-6">No active repositories. Repos appear automatically when MCP instances create .filescope/data.db.</p>
  {:else}
    <div class="overflow-x-auto mb-8">
      <table class="w-full text-sm text-left">
        <thead>
          <tr class="border-b border-gray-700 text-gray-400">
            <th class="py-2 px-3 font-medium">Name</th>
            <th class="py-2 px-3 font-medium">Path</th>
            <th class="py-2 px-3 font-medium">Status</th>
            <th class="py-2 px-3 font-medium w-24">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each repos as repo}
            <tr class="border-b border-gray-800 hover:bg-gray-800/50">
              <td class="py-2 px-3 text-gray-200 font-mono">{repo.name}</td>
              <td class="py-2 px-3 text-gray-400 font-mono text-xs">{repo.path}</td>
              <td class="py-2 px-3">
                {#if repo.online}
                  <span class="text-green-400 text-xs">Online</span>
                {:else}
                  <span class="text-gray-500 text-xs">Offline</span>
                {/if}
              </td>
              <td class="py-2 px-3">
                <button
                  class="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded transition-colors"
                  onclick={() => handleRemove(repo)}
                >Remove</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <!-- Blacklisted Repos Section (D-13: always visible) -->
  <h2 class="text-lg font-semibold text-gray-200 mb-3">Blacklisted Repositories</h2>
  {#if loadingBlacklist}
    <p class="text-gray-500 text-sm">Loading...</p>
  {:else if blacklist.length === 0}
    <p class="text-gray-500 text-sm">No blacklisted repositories. Removed repos will appear here.</p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-sm text-left">
        <thead>
          <tr class="border-b border-gray-700 text-gray-400">
            <th class="py-2 px-3 font-medium">Name</th>
            <th class="py-2 px-3 font-medium">Path</th>
            <th class="py-2 px-3 font-medium w-24">Action</th>
          </tr>
        </thead>
        <tbody>
          {#each blacklist as entry}
            <tr class="border-b border-gray-800 hover:bg-gray-800/50">
              <td class="py-2 px-3 text-gray-400 font-mono">{entry.name}</td>
              <td class="py-2 px-3 text-gray-500 font-mono text-xs">{entry.path}</td>
              <td class="py-2 px-3">
                <button
                  class="px-2 py-1 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 rounded transition-colors"
                  onclick={() => handleRestore(entry)}
                >Restore</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <!-- Info note -->
  <p class="text-gray-600 text-xs mt-8">
    Repos are auto-discovered every 60 seconds when MCP instances create .filescope/data.db.
    Removing a repo blacklists its path -- it won't reappear until restored.
  </p>
</div>
