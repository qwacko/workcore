<script lang="ts">
  import type { Column, Json, JsonSchema, ManifestAction, ManifestBlock } from '@workcore/core';
  import { condition, date, label, readPath, schemaAt, text } from './data.js';
  import type { RendererRegistry } from './renderer-context.js';
  import DataTable from './DataTable.svelte';

  let { block, rows, total, columns, itemSchema, mode, sorting, selectedKey, input, registry = {}, actorId = '', pending = false, onselect, onaction, onsort, detailHref }: {
    block: Extract<ManifestBlock, { kind: 'collection' }>;
    rows: Json[];
    total: number;
    columns: Column[];
    itemSchema: JsonSchema;
    mode: string;
    sorting: string;
    selectedKey?: Json;
    input: Json;
    registry?: RendererRegistry;
    actorId?: string;
    pending?: boolean;
    onselect: (row: Json) => void;
    onaction: (action: ManifestAction, row: Json) => void;
    onsort: (path: string) => void;
    detailHref: (row: Json) => string;
  } = $props();
  const displayColumns = $derived(columns.map(column => ({ ...column, label: column.label ?? (column.path ? schemaAt(itemSchema, column.path).title : undefined) ?? label(column.path) })));
</script>

<p class="help result-count">{rows.length} of {total} loaded records · filters apply locally to this result{block.source?.kind === 'query' ? ' / page' : ''}</p>
{#if mode === 'json'}
  <pre>{JSON.stringify(rows, null, 2)}</pre>
{:else if !rows.length}
  <div class="empty"><strong>{total ? 'No matches' : 'Nothing here yet'}</strong><p>{total ? 'Try changing the local filters.' : 'Create a record or choose a different server scope.'}</p></div>
{:else if mode === 'list'}
  <div class="record-list">
    {#each rows as row}
      <article class="list-item"><div><h3>{text(readPath(row, columns[0]?.path ?? 'id'))}</h3><dl class="inline-details">
        {#each columns.slice(1) as column}<div><dt>{column.label ?? label(column.path)}</dt><dd>{text(readPath(row, column.path))}</dd></div>{/each}
      </dl></div><div class="row-actions">{@render Actions(block, row, selectedKey, onselect, onaction, detailHref, actorId, pending)}</div></article>
    {/each}
  </div>
{:else}
  <DataTable {rows} columns={displayColumns} {sorting} onsort={onsort} registry={registry} {input} hasActions={!!(block.actions?.length || block.detail || block.selection)} empty={total ? 'No matches. Try changing the local filters.' : 'Nothing here yet. Create a record or choose a different server scope.'}>
    {#snippet rowActions(row: Json)}{@render Actions(block, row, selectedKey, onselect, onaction, detailHref, actorId, pending)}{/snippet}
  </DataTable>
{/if}

{#snippet Actions(block: Extract<ManifestBlock, { kind: 'collection' }>, row: Json, selectedKey: Json | undefined, onselect: (row: Json) => void, onaction: (action: ManifestAction, row: Json) => void, detailHref: (row: Json) => string, actorId: string, pending: boolean)}
  {#if block.selection}<button class="small" aria-pressed={JSON.stringify(selectedKey) === JSON.stringify(readPath(row, block.selection.key))} onclick={() => onselect(row)}>{JSON.stringify(selectedKey) === JSON.stringify(readPath(row, block.selection.key)) ? 'Selected' : 'Select'}</button>{/if}
  {#if block.detail}<a class="button small" href={detailHref(row)}>{block.detail.label ?? 'Open details'}</a>{/if}
  {#each block.actions ?? [] as action}{#if condition(action.visibleWhen, row, actorId)}<button class="small" disabled={pending || (action.disabledWhen ? condition(action.disabledWhen, row, '') : false)} onclick={() => onaction(action, row)}>{action.label}</button>{/if}{/each}
{/snippet}
