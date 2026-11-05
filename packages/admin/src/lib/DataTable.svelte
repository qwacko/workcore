<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Column, Json } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import { date, label, readPath, text } from './data.js';
  import * as Table from './components/ui/table/index.js';
  import { Button } from './components/ui/button/index.js';
  import { Badge } from './components/ui/badge/index.js';
  import EmptyState from './EmptyState.svelte';
  let { rows, columns, sorting = '', onsort, rowActions, hasActions = false, registry = {}, input = {}, empty = 'No records found.' }: {
    rows: Json[];
    columns: Column[];
    sorting?: string;
    onsort?: (path: string) => void;
    rowActions?: Snippet<[Json]>;
    hasActions?: boolean;
    registry?: RendererRegistry;
    input?: Json;
    empty?: string;
  } = $props();
</script>

{#if !rows.length}<EmptyState description={empty} />
{:else}<div class="max-w-full overflow-x-auto rounded-lg border"><Table.Root><Table.Header><Table.Row>
  {#each columns as column}<Table.Head class={column.path === 'description' ? 'whitespace-normal' : ''} aria-sort={onsort ? sorting === column.path ? 'ascending' : sorting === `-${column.path}` ? 'descending' : 'none' : undefined}>{#if onsort}<Button variant="ghost" size="sm" onclick={() => onsort(column.path)}>{column.label ?? label(column.path)}{sorting === column.path ? ' ↑' : sorting === `-${column.path}` ? ' ↓' : ''}</Button>{:else}{column.label ?? label(column.path)}{/if}</Table.Head>{/each}
  {#if hasActions}<Table.Head>Actions</Table.Head>{/if}
</Table.Row></Table.Header><Table.Body>
  {#each rows as row}<Table.Row>{#each columns as column}{@const Cell = column.renderer ? registry[column.renderer] : undefined}<Table.Cell class={column.path === 'description' ? 'max-w-[48rem] whitespace-normal' : ''}>{#if Cell}<Cell value={readPath(row, column.path) ?? null} {row} {column} {input} />{:else if column.renderer}<span class="help" role="status">Cell renderer “{column.renderer}” is not registered.</span>{:else if column.format === 'badge'}<Badge variant={readPath(row, column.path) === true ? 'default' : 'secondary'}>{text(readPath(row, column.path))}</Badge>{:else if column.format === 'date'}{date(readPath(row, column.path))}{:else}{text(readPath(row, column.path))}{/if}</Table.Cell>{/each}{#if hasActions}<Table.Cell>{#if rowActions}<div class="row-actions">{@render rowActions(row)}</div>{/if}</Table.Cell>{/if}</Table.Row>{/each}
</Table.Body></Table.Root></div>{/if}
