<script lang="ts">
  import type { ChangeImpactResult } from '../lib/api';

  const RISK_COLORS: Record<string, string> = {
    low:    'bg-green-900 text-green-300 border border-green-700',
    medium: 'bg-yellow-900 text-yellow-300 border border-yellow-700',
    high:   'bg-red-900 text-red-300 border border-red-700',
  };

  let { changeImpact }: { changeImpact: ChangeImpactResult } = $props();
</script>

<div>
  <span class="{RISK_COLORS[changeImpact.riskLevel]} text-xs px-2 py-0.5 rounded uppercase font-semibold">
    {changeImpact.riskLevel}
  </span>

  <p class="text-gray-300 text-sm mt-2">{changeImpact.summary}</p>

  {#if changeImpact.affectedAreas.length > 0}
    <h4 class="text-xs text-gray-500 uppercase mt-3 mb-1">Affected Areas</h4>
    <ul class="list-disc list-inside text-sm text-gray-400">
      {#each changeImpact.affectedAreas as area}
        <li>{area}</li>
      {/each}
    </ul>
  {/if}

  {#if changeImpact.breakingChanges.length > 0}
    <h4 class="text-xs text-red-400 uppercase mt-3 mb-1">Breaking Changes</h4>
    <ul class="list-disc list-inside text-sm text-red-400">
      {#each changeImpact.breakingChanges as change}
        <li>{change}</li>
      {/each}
    </ul>
  {/if}
</div>
