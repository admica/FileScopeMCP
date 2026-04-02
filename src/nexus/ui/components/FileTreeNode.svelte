<script lang="ts">
  import type { TreeEntry } from '../lib/api';

  const FILE_ICONS: Record<string, string> = {
    '.ts': '\u{1F7E6}', '.tsx': '\u{1F7E6}',
    '.js': '\u{1F7E1}', '.jsx': '\u{1F7E1}', '.json': '\u{1F7E1}',
    '.svelte': '\u{1F7E0}',
    '.css': '\u{1F3A8}', '.html': '\u{1F310}',
    '.md': '\u{1F4C4}',
    '.py': '\u{1F40D}', '.rs': '\u{1F980}', '.go': '\u{1F439}',
    '.sh': '\u2699\uFE0F', '.sql': '\u{1F5C4}\uFE0F',
    '.toml': '\u2699\uFE0F', '.yaml': '\u2699\uFE0F', '.yml': '\u2699\uFE0F',
  };

  function getFileIcon(name: string): string {
    const dot = name.lastIndexOf('.');
    if (dot === -1) return '\u{1F4C4}';
    const ext = name.slice(dot).toLowerCase();
    return FILE_ICONS[ext] ?? '\u{1F4C4}';
  }

  let {
    entry,
    depth,
    isExpanded,
    isSelected,
    isLoading,
    onToggle,
  }: {
    entry: TreeEntry;
    depth: number;
    isExpanded: boolean;
    isSelected: boolean;
    isLoading: boolean;
    onToggle: (entry: TreeEntry) => void;
  } = $props();
</script>

<button
  class={[
    'w-full flex items-center gap-1.5 py-0.5 px-2 text-left transition-colors cursor-pointer',
    isSelected ? 'bg-blue-900/40 text-blue-300' : 'hover:bg-gray-800 text-gray-300',
  ].join(' ')}
  style="padding-left: {depth * 20 + 8}px"
  onclick={() => onToggle(entry)}
>
  <!-- Chevron -->
  {#if entry.isDir}
    <span class="text-gray-500 text-xs w-3 flex-shrink-0">
      {#if isLoading}
        <span class="text-gray-600">...</span>
      {:else if isExpanded}
        &#x25BC;
      {:else}
        &#x25B8;
      {/if}
    </span>
  {:else}
    <span class="w-3 flex-shrink-0"></span>
  {/if}

  <!-- Icon -->
  <span class="flex-shrink-0">
    {#if entry.isDir}
      📂
    {:else}
      {getFileIcon(entry.name)}
    {/if}
  </span>

  <!-- Name -->
  <span class="font-mono text-sm truncate">{entry.name}</span>
</button>
