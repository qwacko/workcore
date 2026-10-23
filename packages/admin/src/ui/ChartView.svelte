<script lang="ts">
  import type { OperationViewVariant } from '@workcore/core';
  import { buildChartSeries, chartCategories } from './chart-data.js';

  let { rows = [], config, title = 'Chart' } = $props<{
    rows?: Array<Record<string, unknown>>;
    config: NonNullable<OperationViewVariant['chart']>;
    title?: string;
  }>();
  const series = $derived(buildChartSeries(rows, config));
  const categories = $derived(chartCategories(rows, config));
  const extent = $derived.by(() => {
    const values = series.flatMap((line) => line.points.map((point) => point.value));
    return values.length ? { min: Math.min(...values), max: Math.max(...values) } : { min: 0, max: 0 };
  });
  function x(index: number) { return categories.length <= 1 ? 210 : 24 + index * (372 / (categories.length - 1)); }
  function y(value: number) {
    const range = extent.max - extent.min || 1;
    return 158 - ((value - extent.min) / range) * 132;
  }
  function points(line: typeof series[number]) { return line.points.map((point) => `${x(point.index)},${y(point.value)}`).join(' '); }
</script>

<section class="chart-view" aria-label={title}>
  <h3>{title}</h3>
  {#if !series.length}<p class="empty">No numeric chart data returned.</p>
  {:else}
    <svg viewBox="0 0 420 180" role="img" aria-label={`${title}: ${config.yField} by ${config.xField}`}>
      <line x1="24" y1="158" x2="396" y2="158" stroke="var(--border)" />
      {#each series as line, index (line.name)}
        <polyline points={points(line)} fill="none" stroke={`var(--chart-${index % 6 + 1})`} stroke-width="3" />
        {#each line.points as point (`${line.name}:${point.index}`)}<circle cx={x(point.index)} cy={y(point.value)} r="4" fill={`var(--chart-${index % 6 + 1})`}><title>{line.name} · {point.label}: {point.value}</title></circle>{/each}
      {/each}
    </svg>
    <div class="chart-labels">{#each categories as category, index}<span>{category || `Item ${index + 1}`}</span>{/each}</div>
    {#if series.length > 1 || config.seriesField}<div class="chart-legend">{#each series as line, index (line.name)}<span><i style={`--series-color: var(--chart-${index % 6 + 1})`}></i>{line.name}</span>{/each}</div>{/if}
  {/if}
</section>

<style>
  .chart-view { min-width: 0; }
  .chart-view h3 { margin: 0 0 .5rem; }
  .chart-view svg { display: block; width: 100%; max-height: 16rem; }
  .chart-labels, .chart-legend { display: flex; justify-content: space-between; flex-wrap: wrap; gap: .35rem .75rem; color: var(--muted-foreground); font-size: .8em; }
  .chart-legend { justify-content: flex-start; margin-top: .5rem; }
  .chart-legend i { display: inline-block; width: .6em; height: .6em; margin-right: .35em; border-radius: 50%; background: var(--series-color); }
</style>
