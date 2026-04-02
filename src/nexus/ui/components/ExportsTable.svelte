<script lang="ts">
  import type { ExportSnapshot, ExportedSymbol } from '../lib/api';

  const KIND_ORDER: Array<ExportedSymbol['kind']> = [
    'function', 'class', 'variable', 'type', 'interface', 'enum', 'default'
  ];
  const KIND_LABELS: Record<string, string> = {
    function: 'Functions', class: 'Classes', variable: 'Variables',
    type: 'Types', interface: 'Interfaces', enum: 'Enums', default: 'Default Export',
  };

  let { exportsSnapshot }: { exportsSnapshot: ExportSnapshot } = $props();

  let grouped = $derived.by(() => {
    const map = new Map<string, typeof exportsSnapshot.exports>();
    for (const sym of exportsSnapshot.exports) {
      const list = map.get(sym.kind) ?? [];
      list.push(sym);
      map.set(sym.kind, list);
    }
    return KIND_ORDER
      .filter(k => map.has(k))
      .map(k => ({ kind: k, label: KIND_LABELS[k], symbols: map.get(k)! }));
  });
</script>

<div>
  {#each grouped as group}
    <h4 class="text-xs text-gray-500 uppercase mt-3 mb-1">{group.label}</h4>
    {#each group.symbols as sym}
      <div class="font-mono text-xs text-gray-300 py-0.5 pl-2 border-l border-gray-700">
        {sym.signature || sym.name}
      </div>
    {/each}
  {/each}
</div>
