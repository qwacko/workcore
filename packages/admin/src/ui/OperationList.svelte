<script lang="ts">
  import type { WorkcoreManifest } from '@workcore/client';
  import type { CompiledOperationPresentation } from '@workcore/core';

  let { operations, operationViews = [], selected, selectedKind, onSelect } = $props<{
    operations: WorkcoreManifest['operations'];
    operationViews?: readonly CompiledOperationPresentation[] | undefined;
    selected: string;
    selectedKind: WorkcoreManifest['operations'][number]['kind'];
    onSelect: (name: string, kind: WorkcoreManifest['operations'][number]['kind']) => void;
  }>();
</script>

<section class="panel operation-panel">
  <div class="panel-heading"><div><h2>Available operations</h2><p>{operations.length} exposed operations</p></div><span class="protocol">Semantic UI</span></div>
  <div class="operation-list">
    {#each operations as operation}
      {@const presentation = operationViews.find((view: CompiledOperationPresentation) => view.kind === operation.kind && view.operation === operation.name)}
      <button class="operation-row" class:selected={selected === operation.name && selectedKind === operation.kind} onclick={() => onSelect(operation.name, operation.kind)}>
        <span class="kind-icon" class:query={operation.kind === 'query'} class:mutation={operation.kind === 'mutation'} class:task={operation.kind === 'task'}>{operation.kind === 'query' ? '⌕' : operation.kind === 'mutation' ? '✎' : '↗'}</span>
        <span class="operation-name"><strong>{presentation?.variants[presentation.default]?.title ?? operation.name}</strong><small>{operation.name}</small></span>
        <span class="kind-tag">{operation.kind}</span>
      </button>
    {/each}
  </div>
</section>
