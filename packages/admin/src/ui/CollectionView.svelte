<script lang="ts">
  import type { OperationViews } from '@workcore/client';
  import { displayCell } from './rich-input.js';
  import { getCollectionFieldValue } from './collection-editor.js';
  import DataTable from './DataTable.svelte';

  type RowAction = NonNullable<OperationViews['variants'][string]['actions']>[number];
  let { rows, columns, actions = [], labels = {}, displayHints = {}, titleField, subtitleField, presentation = 'responsive', onAction, onSelect } = $props<{
    rows: Array<Record<string, unknown>>;
    columns: readonly string[];
    actions?: readonly RowAction[] | undefined;
    labels?: Record<string, string> | undefined;
    displayHints?: Record<string, 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'badge'> | undefined;
    titleField?: string | undefined;
    subtitleField?: string | undefined;
    presentation?: 'responsive' | 'table' | 'cards' | undefined;
    onAction?: ((row: Record<string, unknown>, action: RowAction) => void) | undefined;
    onSelect?: ((row: Record<string, unknown>) => void) | undefined;
  }>();

  function value(row: Record<string, unknown>, field: string): string {
    return displayCell(getCollectionFieldValue(row, field));
  }
  function rowDescription(row: Record<string, unknown>): string {
    const field = titleField ?? columns[0];
    return field ? `${labels[field] ?? field} ${value(row, field)}` : 'record';
  }
</script>

<!-- Both presentations consume the same rows, stable selection callback, and action contract. -->
<div class="desktop-collection" class:force-table={presentation === 'table'} class:hide-table={presentation === 'cards'}>
  <DataTable {rows} {columns} {actions} {labels} {displayHints} {onAction} {onSelect} getValue={getCollectionFieldValue} />
</div>
<section class="mobile-collection" class:force-cards={presentation === 'cards'} class:hide-cards={presentation === 'table'} aria-label="Collection cards">
{#each rows as row}
    <article class="collection-card">
      {#if titleField || subtitleField}<header class="collection-card-heading">{#if titleField}<strong>{value(row, titleField)}</strong>{/if}{#if subtitleField}<p>{value(row, subtitleField)}</p>{/if}</header>{/if}
      <dl>
        {#each columns.filter((column: string) => column !== titleField && column !== subtitleField) as column}
          <div class="collection-card-field">
            <dt>{labels[column] ?? column}</dt>
            <dd>{#if displayHints[column] === 'badge'}<span class="semantic-badge">{value(row, column)}</span>{:else}{value(row, column)}{/if}</dd>
          </div>
        {/each}
      </dl>
      {#if actions.length || onSelect}
        <div class="collection-card-actions">
          {#each actions as action}<button class="text-button" aria-label={`${action.label}: ${rowDescription(row)}`} onclick={() => onAction?.(row, action)}>{action.label}</button>{/each}
          {#if onSelect}<button class="text-button" aria-label={`Edit ${rowDescription(row)}`} onclick={() => onSelect?.(row)}>Edit</button>{/if}
        </div>
      {/if}
    </article>
  {/each}
</section>

<style>
  .mobile-collection { display: none; }
  .force-table { display: block !important; }
  .hide-table { display: none !important; }
  .force-cards { display: block !important; }
  .hide-cards { display: none !important; }
  .collection-card { border: 1px solid var(--line, #d9e0dc); border-radius: 12px; padding: 12px; margin-top: 10px; background: var(--surface, white); }
  .collection-card dl { display: grid; gap: 9px; margin: 0; }
  .collection-card-heading { margin-bottom: 10px; }
  .collection-card-heading p { margin: 3px 0 0; color: var(--muted, #63716a); }
  .collection-card-field { display: grid; grid-template-columns: minmax(88px, 35%) 1fr; gap: 10px; }
  .collection-card-field dt { color: var(--muted, #63716a); font-size: 12px; }
  .collection-card-field dd { margin: 0; overflow-wrap: anywhere; }
  .collection-card-actions { display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--line, #d9e0dc); margin-top: 10px; padding-top: 8px; }
  @media (max-width: 640px) {
    .desktop-collection:not(.force-table):not(.hide-table) { display: none; }
    .mobile-collection:not(.hide-cards) { display: block; }
  }
</style>
