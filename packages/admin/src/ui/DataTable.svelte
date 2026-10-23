<script lang="ts">
  import type { OperationViews } from '@workcore/client';
  import { displayCell } from './rich-input.js';

  type RowAction = NonNullable<OperationViews['variants'][string]['actions']>[number];
  function readOwnField(row: Record<string, unknown>, field: string): unknown { return row[field]; }
  let { rows, columns, actions = [], display = displayCell, labels = {}, displayHints = {}, onAction, onSelect, getValue = readOwnField } = $props<{
    rows: Array<Record<string, unknown>>;
    columns: readonly string[];
    actions?: readonly RowAction[] | undefined;
    display?: ((value: unknown) => string) | undefined;
    labels?: Record<string, string> | undefined;
    displayHints?: Record<string, 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'badge'> | undefined;
    onAction?: ((row: Record<string, unknown>, action: RowAction) => void) | undefined;
    onSelect?: ((row: Record<string, unknown>) => void) | undefined;
    getValue?: ((row: Record<string, unknown>, field: string) => unknown) | undefined;
  }>();
  function rowDescription(row: Record<string, unknown>): string {
    const field = columns[0];
    return field ? `${labels[field] ?? field} ${display(getValue(row, field))}` : 'record';
  }
</script>

<div class="table-scroll"><table><thead><tr>{#each columns as column}<th>{labels[column] ?? column}</th>{/each}{#if actions.length || onSelect}<th></th>{/if}</tr></thead><tbody>
  {#each rows as row}<tr>{#each columns as column}<td>{#if displayHints[column] === 'badge'}<span class="semantic-badge">{display(getValue(row, column))}</span>{:else}{display(getValue(row, column))}{/if}</td>{/each}{#if actions.length || onSelect}<td class="row-actions">{#each actions as action}<button class="text-button" aria-label={`${action.label}: ${rowDescription(row)}`} onclick={() => onAction?.(row, action)}>{action.label}</button>{/each}{#if onSelect}<button class="text-button" aria-label={`Edit ${rowDescription(row)}`} onclick={() => onSelect?.(row)}>Edit</button>{/if}</td>{/if}</tr>{/each}
</tbody></table></div>
