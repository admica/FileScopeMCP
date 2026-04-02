<script lang="ts">
  import * as d3 from 'd3';
  import type { TokenEntry } from '../lib/api';

  let { entries }: { entries: TokenEntry[] } = $props();

  let svgEl: SVGSVGElement;

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
  }

  $effect(() => {
    if (!svgEl || entries.length === 0) return;

    // Clear previous render
    d3.select(svgEl).selectAll('*').remove();

    const margin = { top: 8, right: 100, bottom: 8, left: 140 };
    const barHeight = 24;
    const barGap = 8;
    const innerH = entries.length * (barHeight + barGap);
    const totalH = innerH + margin.top + margin.bottom;
    const totalW = svgEl.parentElement?.clientWidth ?? 600;
    const innerW = totalW - margin.left - margin.right;

    d3.select(svgEl)
      .attr('width', totalW)
      .attr('height', totalH);

    const xScale = d3.scaleLinear()
      .domain([0, d3.max(entries, d => d.total) ?? 1])
      .range([0, innerW]);

    const yScale = d3.scaleBand()
      .domain(entries.map(d => d.repo))
      .range([0, innerH])
      .padding(0.25);

    const g = d3.select(svgEl)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // Bars
    g.selectAll('rect.bar')
      .data(entries)
      .join('rect')
      .attr('class', 'bar')
      .attr('x', 0)
      .attr('y', d => yScale(d.repo) ?? 0)
      .attr('width', d => xScale(d.total))
      .attr('height', yScale.bandwidth())
      .attr('fill', '#3b82f6')
      .attr('rx', 3)
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(`${d.total.toLocaleString()} tokens`);
      });

    // Repo name labels (left of bar)
    g.selectAll('text.label')
      .data(entries)
      .join('text')
      .attr('class', 'label')
      .attr('x', -8)
      .attr('y', d => (yScale(d.repo) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', 'end')
      .attr('fill', '#9ca3af')
      .attr('font-size', 12)
      .text(d => d.repo.split('/').pop() ?? d.repo);

    // Value labels (right of bar)
    g.selectAll('text.value')
      .data(entries)
      .join('text')
      .attr('class', 'value')
      .attr('x', d => xScale(d.total) + 6)
      .attr('y', d => (yScale(d.repo) ?? 0) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('fill', '#d1d5db')
      .attr('font-size', 12)
      .text(d => formatTokens(d.total));

    // Session delta labels
    g.selectAll('text.delta')
      .data(entries.filter(d => d.sessionDelta > 0))
      .join('text')
      .attr('class', 'delta')
      .attr('x', d => xScale(d.total) + 6)
      .attr('y', d => (yScale(d.repo) ?? 0) + yScale.bandwidth() / 2 + 14)
      .attr('dy', '0.35em')
      .attr('fill', '#22c55e')
      .attr('font-size', 11)
      .text(d => `+${formatTokens(d.sessionDelta)}`);
  });
</script>

{#if entries.length === 0}
  <p class="text-gray-500 text-sm italic">No token data available.</p>
{:else}
  <div class="w-full">
    <svg bind:this={svgEl}></svg>
  </div>
{/if}
