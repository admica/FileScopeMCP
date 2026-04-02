<script lang="ts">
  import FileTreeNode from './FileTreeNode.svelte';
  import { fetchTree, type TreeEntry } from '../lib/api';

  let {
    repoName,
    selectedPath,
    onSelectFile,
    onSelectDir,
  }: {
    repoName: string;
    selectedPath: string | null;
    onSelectFile: (path: string) => void;
    onSelectDir: (path: string) => void;
  } = $props();

  let rootEntries: TreeEntry[] = $state([]);
  let children: Record<string, TreeEntry[]> = $state({});
  let expanded: Record<string, boolean> = $state({});
  let loading: Record<string, boolean> = $state({});
  let rootLoading: boolean = $state(true);

  // Fetch root entries when repoName changes
  $effect(() => {
    // Reading repoName makes this re-run when it changes
    const repo = repoName;
    rootLoading = true;
    rootEntries = [];
    children = {};
    expanded = {};
    fetchTree(repo).then(r => {
      rootEntries = r.entries;
      rootLoading = false;
    }).catch(() => { rootLoading = false; });
  });

  async function handleToggle(entry: TreeEntry) {
    if (entry.isDir) {
      if (expanded[entry.path]) {
        // Collapse
        expanded[entry.path] = false;
      } else {
        // Expand — fetch children if not cached
        if (!children[entry.path]) {
          loading[entry.path] = true;
          try {
            const result = await fetchTree(repoName, entry.path);
            children[entry.path] = result.entries;
          } catch { /* leave empty */ }
          loading[entry.path] = false;
        }
        expanded[entry.path] = true;
      }
      // Also select the directory for detail panel
      onSelectDir(entry.path);
    } else {
      onSelectFile(entry.path);
    }
  }

  // Auto-expand to selectedPath when it changes (e.g., from dependency link click or URL hash nav)
  let lastExpandedFor: string | null = $state(null);

  $effect(() => {
    if (!selectedPath || selectedPath === lastExpandedFor) return;
    lastExpandedFor = selectedPath;
    const parts = selectedPath.split('/');
    for (let i = 1; i < parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      if (!expanded[prefix]) {
        expanded[prefix] = true;
        if (!children[prefix]) {
          fetchTree(repoName, prefix).then(r => {
            children[prefix] = r.entries;
          });
        }
      }
    }
  });
</script>

{#snippet renderEntries(entries: TreeEntry[], depth: number)}
  {#each entries as entry (entry.path)}
    <FileTreeNode
      {entry}
      {depth}
      isExpanded={!!expanded[entry.path]}
      isSelected={selectedPath === entry.path}
      isLoading={!!loading[entry.path]}
      onToggle={handleToggle}
    />
    {#if entry.isDir && expanded[entry.path] && children[entry.path]}
      {@render renderEntries(children[entry.path], depth + 1)}
    {/if}
  {/each}
{/snippet}

<div class="overflow-y-auto h-full py-1">
  {#if rootLoading}
    <p class="text-gray-500 text-sm px-4 py-2">Loading tree...</p>
  {:else if rootEntries.length === 0}
    <p class="text-gray-500 text-sm px-4 py-2">No files found.</p>
  {:else}
    {@render renderEntries(rootEntries, 0)}
  {/if}
</div>
