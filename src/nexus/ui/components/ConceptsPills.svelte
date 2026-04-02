<script lang="ts">
  import type { ConceptsResult } from '../lib/api';

  const PILL_GROUPS = [
    { key: 'functions' as const,  label: 'Functions',  color: 'bg-blue-900 text-blue-300' },
    { key: 'classes' as const,    label: 'Classes',    color: 'bg-purple-900 text-purple-300' },
    { key: 'interfaces' as const, label: 'Interfaces', color: 'bg-green-900 text-green-300' },
    { key: 'exports' as const,    label: 'Exports',    color: 'bg-gray-700 text-gray-300' },
  ];

  let { concepts }: { concepts: ConceptsResult } = $props();
</script>

<div>
  {#if concepts.purpose}
    <p class="text-gray-300 text-sm mb-3">{concepts.purpose}</p>
  {/if}

  {#each PILL_GROUPS as group}
    {#if concepts[group.key].length > 0}
      <div class="mb-2">
        <span class="text-xs text-gray-500 uppercase tracking-wide mr-2">{group.label}</span>
        <span class="inline-flex flex-wrap gap-1.5">
          {#each concepts[group.key] as item}
            <span class="{group.color} text-xs px-2 py-0.5 rounded-full font-mono">{item}</span>
          {/each}
        </span>
      </div>
    {/if}
  {/each}
</div>
