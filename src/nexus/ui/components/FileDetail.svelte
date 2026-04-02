<script lang="ts">
  import ConceptsPills from './ConceptsPills.svelte';
  import ChangeImpactBadge from './ChangeImpactBadge.svelte';
  import ExportsTable from './ExportsTable.svelte';
  import type { FileDetail as FileDetailType } from '../lib/api';

  let { detail, repoName }: {
    detail: FileDetailType;
    repoName: string;
  } = $props();

  let openSections: Record<string, boolean> = $state({
    summary: true,
    concepts: true,
    changeImpact: false,
    dependencies: false,
    dependents: false,
    packageDeps: false,
    exports: false,
    staleness: false,
  });

  function toggleSection(key: string) {
    openSections[key] = !openSections[key];
  }

  function navigateToFile(filePath: string) {
    window.location.hash = `#/project/${encodeURIComponent(repoName)}/file/${filePath}`;
  }

  function stalenessLabel(since: number | null): { text: string; fresh: boolean } {
    if (since === null) return { text: 'Fresh', fresh: true };
    const hours = Math.floor((Date.now() - since) / 3_600_000);
    if (hours < 1) return { text: 'Stale (< 1h)', fresh: false };
    if (hours < 24) return { text: `Stale (${hours}h)`, fresh: false };
    return { text: `Stale (${Math.floor(hours / 24)}d)`, fresh: false };
  }
</script>

<!-- File header -->
<div class="px-4 py-3 border-b border-gray-700">
  <h2 class="text-lg font-semibold text-gray-100 font-mono">{detail.name}</h2>
  <p class="text-xs text-gray-500 mt-0.5">{detail.path}</p>
  <span class="text-xs text-blue-400 font-semibold">Importance: {detail.importance}</span>
</div>

<!-- Summary section -->
<button
  class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
  onclick={() => toggleSection('summary')}
>
  <span>Summary</span>
  <span class="text-gray-500">{openSections.summary ? '\u25BC' : '\u25B8'}</span>
</button>
{#if openSections.summary}
  <div class="px-4 py-3 border-b border-gray-700">
    {#if detail.summary !== null}
      <p class="text-gray-300 text-sm">{detail.summary}</p>
    {:else}
      <p class="text-gray-500 italic text-sm">Awaiting LLM analysis</p>
    {/if}
  </div>
{/if}

<!-- Concepts section -->
<button
  class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
  onclick={() => toggleSection('concepts')}
>
  <span>Concepts</span>
  <span class="text-gray-500">{openSections.concepts ? '\u25BC' : '\u25B8'}</span>
</button>
{#if openSections.concepts}
  <div class="px-4 py-3 border-b border-gray-700">
    {#if detail.concepts !== null}
      <ConceptsPills concepts={detail.concepts} />
    {:else}
      <p class="text-gray-500 italic text-sm">Awaiting LLM analysis</p>
    {/if}
  </div>
{/if}

<!-- Change Impact section -->
<button
  class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
  onclick={() => toggleSection('changeImpact')}
>
  <span>Change Impact</span>
  <span class="text-gray-500">{openSections.changeImpact ? '\u25BC' : '\u25B8'}</span>
</button>
{#if openSections.changeImpact}
  <div class="px-4 py-3 border-b border-gray-700">
    {#if detail.changeImpact !== null}
      <ChangeImpactBadge changeImpact={detail.changeImpact} />
    {:else}
      <p class="text-gray-500 italic text-sm">Awaiting LLM analysis</p>
    {/if}
  </div>
{/if}

<!-- Dependencies section -->
<button
  class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
  onclick={() => toggleSection('dependencies')}
>
  <span>Dependencies ({detail.dependencies.length})</span>
  <span class="text-gray-500">{openSections.dependencies ? '\u25BC' : '\u25B8'}</span>
</button>
{#if openSections.dependencies}
  <div class="px-4 py-3 border-b border-gray-700">
    {#if detail.dependencies.length > 0}
      {#each detail.dependencies as dep}
        <button
          class="text-blue-400 hover:text-blue-300 hover:underline text-sm font-mono block py-0.5"
          onclick={() => navigateToFile(dep.path)}
        >
          {dep.path}
        </button>
      {/each}
    {:else}
      <p class="text-gray-500 text-sm">No local dependencies.</p>
    {/if}
  </div>
{/if}

<!-- Dependents section -->
<button
  class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
  onclick={() => toggleSection('dependents')}
>
  <span>Dependents ({detail.dependents.length})</span>
  <span class="text-gray-500">{openSections.dependents ? '\u25BC' : '\u25B8'}</span>
</button>
{#if openSections.dependents}
  <div class="px-4 py-3 border-b border-gray-700">
    {#if detail.dependents.length > 0}
      {#each detail.dependents as dep}
        <button
          class="text-blue-400 hover:text-blue-300 hover:underline text-sm font-mono block py-0.5"
          onclick={() => navigateToFile(dep.path)}
        >
          {dep.path}
        </button>
      {/each}
    {:else}
      <p class="text-gray-500 text-sm">No dependents.</p>
    {/if}
  </div>
{/if}

<!-- Package Deps section -->
<button
  class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
  onclick={() => toggleSection('packageDeps')}
>
  <span>Package Deps ({detail.packageDeps.length})</span>
  <span class="text-gray-500">{openSections.packageDeps ? '\u25BC' : '\u25B8'}</span>
</button>
{#if openSections.packageDeps}
  <div class="px-4 py-3 border-b border-gray-700">
    {#if detail.packageDeps.length > 0}
      {#each detail.packageDeps as dep}
        <div class="font-mono text-sm text-gray-400 py-0.5">
          {dep.name}@{dep.version}
          {#if dep.isDev}
            <span class="ml-1 text-xs bg-gray-700 text-gray-400 px-1 rounded">dev</span>
          {/if}
        </div>
      {/each}
    {:else}
      <p class="text-gray-500 text-sm">No package dependencies.</p>
    {/if}
  </div>
{/if}

<!-- Exports section -->
<button
  class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
  onclick={() => toggleSection('exports')}
>
  <span>Exports</span>
  <span class="text-gray-500">{openSections.exports ? '\u25BC' : '\u25B8'}</span>
</button>
{#if openSections.exports}
  <div class="px-4 py-3 border-b border-gray-700">
    {#if detail.exportsSnapshot !== null && detail.exportsSnapshot.exports.length > 0}
      <ExportsTable exportsSnapshot={detail.exportsSnapshot} />
    {:else}
      <p class="text-gray-500 text-sm">No exports data.</p>
    {/if}
  </div>
{/if}

<!-- Staleness section -->
<button
  class="w-full flex items-center justify-between px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
  onclick={() => toggleSection('staleness')}
>
  <span>Staleness</span>
  <span class="text-gray-500">{openSections.staleness ? '\u25BC' : '\u25B8'}</span>
</button>
{#if openSections.staleness}
  <div class="px-4 py-3">
    {#each [
      { label: 'Summary', value: stalenessLabel(detail.staleness.summary) },
      { label: 'Concepts', value: stalenessLabel(detail.staleness.concepts) },
      { label: 'Change Impact', value: stalenessLabel(detail.staleness.changeImpact) },
    ] as row}
      <div class="flex items-center justify-between py-1">
        <span class="text-sm text-gray-500">{row.label}</span>
        <span class={row.value.fresh ? 'text-sm text-green-400' : 'text-sm text-orange-400'}>
          {row.value.text}
        </span>
      </div>
    {/each}
  </div>
{/if}
