<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Column, Json } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import { date, label, readPath, text } from './data.js';
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

{#if !rows.length}<div class="empty">{empty}</div>
{:else}<div class="table-wrap"><table><thead><tr>
  {#each columns as column}<th aria-sort={onsort ? sorting === column.path ? 'ascending' : sorting === `-${column.path}` ? 'descending' : 'none' : undefined}>{#if onsort}<button class="column-sort" onclick={() => onsort(column.path)}>{column.label ?? label(column.path)}{sorting === column.path ? ' ↑' : sorting === `-${column.path}` ? ' ↓' : ''}</button>{:else}{column.label ?? label(column.path)}{/if}</th>{/each}
  {#if hasActions}<th>Actions</th>{/if}
</tr></thead><tbody>
  {#each rows as row}<tr>{#each columns as column}{@const Cell = column.renderer ? registry[column.renderer] : undefined}<td>{#if Cell}<Cell value={readPath(row, column.path) ?? null} {row} {column} {input} />{:else if column.renderer}<span class="help" role="status">Cell renderer “{column.renderer}” is not registered.</span>{:else if column.format === 'badge'}<span class="badge" data-tone={readPath(row, column.path) === true ? 'success' : 'neutral'}>{text(readPath(row, column.path))}</span>{:else if column.format === 'date'}{date(readPath(row, column.path))}{:else}{text(readPath(row, column.path))}{/if}</td>{/each}{#if hasActions}<td>{#if rowActions}<div class="row-actions">{@render rowActions(row)}</div>{/if}</td>{/if}</tr>{/each}
</tbody></table></div>{/if}
