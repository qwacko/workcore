<script lang="ts">
  type Leaf = { type: 'text'; text: string } | { type: 'metric'; label: string; value: unknown } | { type: 'table'; columns: string[]; rows: Record<string, unknown>[] } | { type: 'chart'; label?: string; points: Array<{ label: string; value: number }> };
  let { layout, version = 1 } = $props<{ layout: unknown; version?: number }>();
  function record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
  }
  function leaf(value: unknown): Leaf | null {
    const item = record(value);
    if (!item) return null;
    if (item.type === 'text' && typeof item.text === 'string') return item as Leaf;
    if (item.type === 'metric' && typeof item.label === 'string' && 'value' in item) return item as Leaf;
    if (item.type === 'table' && Array.isArray(item.columns) && Array.isArray(item.rows)) return item as Leaf;
    if (item.type === 'chart' && Array.isArray(item.points) && item.points.every((point) => record(point) && typeof record(point)!.label === 'string' && typeof record(point)!.value === 'number')) return item as Leaf;
    return null;
  }
  const root = $derived(record(layout));
  const children = $derived(Array.isArray(root?.children) ? root.children.map(leaf).filter((item): item is Leaf => item !== null) : []);
  function valueText(value: unknown) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value) ?? ''; } catch { return String(value); }
  }
  function points(points: Array<{ label: string; value: number }>) {
    if (!points.length) return '';
    const values = points.map((point) => point.value), min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
    return points.map((point, index) => `${points.length === 1 ? 210 : 18 + index * (384 / (points.length - 1))},${158 - ((point.value - min) / range) * 132}`).join(' ');
  }
</script>

{#if version === 1 && (root?.type === 'stack' || root?.type === 'grid')}
  <div class="chat-layout" class:grid={root.type === 'grid'}>
    {#each children as item}
      {#if item.type === 'text'}<p>{item.text}</p>
      {:else if item.type === 'metric'}<div class="chat-layout-metric"><small>{item.label}</small><strong>{valueText(item.value)}</strong></div>
      {:else if item.type === 'table'}<div class="oc-table"><table><thead><tr>{#each item.columns as column}<th>{column}</th>{/each}</tr></thead><tbody>{#each item.rows as row}<tr>{#each item.columns as column}<td>{valueText(row[column])}</td>{/each}</tr>{/each}</tbody></table></div>
      {:else if item.type === 'chart'}<div><small>{item.label ?? 'Chart'}</small><svg viewBox="0 0 420 180" role="img" aria-label={item.label ?? 'Chart'}><polyline points={points(item.points)} fill="none" stroke="var(--chart-1)" stroke-width="3" /></svg><div class="chat-layout-chart-labels">{#each item.points as point}<span>{point.label}: {point.value}</span>{/each}</div></div>{/if}
    {/each}
  </div>
{:else}
  <p class="schema-hint">Unsupported declarative layout version or structure.</p>
{/if}

<style>
  .chat-layout { display: grid; gap: .75rem; }
  .chat-layout.grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
  .chat-layout-metric { display: grid; padding: .75rem; border-radius: var(--radius); background: var(--muted); }
  .chat-layout-metric strong { font-size: 1.35em; }
  .chat-layout svg { width: 100%; max-height: 12rem; }
  .chat-layout-chart-labels { display: flex; flex-wrap: wrap; gap: .35rem .75rem; font-size: .8em; color: var(--muted-foreground); }
</style>
