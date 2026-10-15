<script lang="ts">
  import type { WorkcoreManifest } from '@workcore/client';

  let { operations, selected, selectedKind, protocolVersion, onSelect } = $props<{
    operations: WorkcoreManifest['operations'];
    selected: string;
    selectedKind: WorkcoreManifest['operations'][number]['kind'];
    protocolVersion: number;
    onSelect: (name: string, kind: WorkcoreManifest['operations'][number]['kind']) => void;
  }>();
</script>

<section class="panel operation-panel">
  <div class="panel-heading"><div><h2>Available operations</h2><p>{operations.length} exposed operations</p></div><span class="protocol">Protocol {protocolVersion}</span></div>
  <div class="operation-list">
    {#each operations as operation}
      <button class="operation-row" class:selected={selected === operation.name && selectedKind === operation.kind} onclick={() => onSelect(operation.name, operation.kind)}>
        <span class="kind-icon" class:query={operation.kind === 'query'} class:mutation={operation.kind === 'mutation'} class:task={operation.kind === 'task'}>{operation.kind === 'query' ? '⌕' : operation.kind === 'mutation' ? '✎' : '↗'}</span>
        <span class="operation-name"><strong>{operation.ui?.variants[operation.ui.default]?.title ?? operation.name}</strong><small>{operation.name}</small></span>
        <span class="kind-tag">{operation.kind}</span>
      </button>
    {/each}
  </div>
</section>
