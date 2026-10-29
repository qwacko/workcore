<script lang="ts">
  import type { ManifestBlock } from '@workcore/core';
  import { label } from './data.js';
  let { block, search, mode, filterValues, onfilter }: {
    block: Extract<ManifestBlock, { kind: 'collection' }>;
    search: string;
    mode: string;
    filterValues: Record<string, string>;
    onfilter: (key: string, value: string) => void;
  } = $props();
</script>

<div class="collection-toolbar">
  <label class="search-field"><span class="sr-only">Search {block.title ?? 'results'}</span><input type="search" aria-label={`Search ${block.title ?? 'results'}`} value={search} placeholder="Filter this result…" oninput={event => onfilter('search', event.currentTarget.value)} /></label>
  {#each block.filters ?? [] as filter}
    <label class="filter-field"><span>{filter.label}</span><select aria-label={filter.label} value={filterValues[filter.path] ?? ''} onchange={event => onfilter(filter.path, event.currentTarget.value)}><option value="">All</option>{#each filter.options as option}<option value={JSON.stringify(option.value)}>{option.label}</option>{/each}</select></label>
  {/each}
  <div class="segments" aria-label="Result presentation">
    {#each ['table', 'list', 'json'] as presentation}<button type="button" aria-pressed={mode === presentation} onclick={() => onfilter('mode', presentation)}>{label(presentation)}</button>{/each}
  </div>
</div>
