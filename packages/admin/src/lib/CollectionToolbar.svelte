<script lang="ts">
  import type { ManifestBlock } from '@workcore/core';
  import { label } from './data.js';
  import { Input } from './components/ui/input/index.js';
  import { Button } from './components/ui/button/index.js';
  import Select from './components/ui/select/select.svelte';
  let { block, search, mode, filterValues, onfilter }: {
    block: Extract<ManifestBlock, { kind: 'collection' }>;
    search: string;
    mode: string;
    filterValues: Record<string, string>;
    onfilter: (key: string, value: string) => void;
  } = $props();
</script>

<div class="flex flex-wrap items-end gap-3 max-[700px]:items-stretch">
  <label class="min-w-[10rem] flex-1 max-[700px]:basis-full"><span class="sr-only">Search {block.title ?? 'results'}</span><Input type="search" aria-label={`Search ${block.title ?? 'results'}`} value={search} placeholder="Filter this result…" oninput={event => onfilter('search', event.currentTarget.value)} /></label>
  {#each block.filters ?? [] as filter}
    <label class="grid min-w-[125px] flex-1 gap-1 text-xs text-muted-foreground"><span>{filter.label}</span><Select options={[{ value: '', label: 'All' }, ...filter.options.map(option => ({ value: JSON.stringify(option.value), label: option.label }))]} value={filterValues[filter.path] ?? ''} onchange={value => onfilter(filter.path, value)} /></label>
  {/each}
  <div class="inline-flex items-center gap-1 rounded-lg border bg-muted/50 p-1" aria-label="Result presentation">
    {#each ['table', 'list', 'json'] as presentation}<Button type="button" variant={mode === presentation ? 'secondary' : 'ghost'} size="sm" aria-pressed={mode === presentation} onclick={() => onfilter('mode', presentation)}>{label(presentation)}</Button>{/each}
  </div>
</div>
