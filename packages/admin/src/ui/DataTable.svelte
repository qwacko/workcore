<script lang="ts">
  import type { UiMetadata } from '@workcore/client';
  import { displayCell } from './rich-input.js';

  type RowAction = NonNullable<UiMetadata['variants'][string]['actions']>[number];
  let { rows, columns, actions = [], display = displayCell, onAction } = $props<{
    rows: Array<Record<string, unknown>>;
    columns: readonly string[];
    actions?: readonly RowAction[] | undefined;
    display?: ((value: unknown) => string) | undefined;
    onAction?: ((row: Record<string, unknown>, action: RowAction) => void) | undefined;
  }>();
</script>

<div class="table-scroll"><table><thead><tr>{#each columns as column}<th>{column}</th>{/each}{#if actions.length}<th></th>{/if}</tr></thead><tbody>
  {#each rows as row}<tr>{#each columns as column}<td>{display(row[column])}</td>{/each}{#if actions.length}<td class="row-actions">{#each actions as action}<button class="text-button" onclick={() => onAction?.(row, action)}>{action.label}</button>{/each}</td>{/if}</tr>{/each}
</tbody></table></div>
