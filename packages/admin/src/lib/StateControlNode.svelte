<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import { useDisplayContext } from './display-context.svelte.js';
  let { block }: { block: Extract<ManifestBlock, { kind: 'state-control' }> } = $props();
  const context = useDisplayContext();
  const address = $derived(`state.${block.state}`);
  const value = $derived(context.get(address));
</script>

<label class="field state-control" for={`state-${block.id}`}>
  <span>{block.label}</span>
  <select id={`state-${block.id}`} value={value === undefined ? '' : JSON.stringify(value)} onchange={event => {
    const selected = event.currentTarget.value;
    if (selected) context.set(address, JSON.parse(selected) as Json);
  }}>
    {#each block.options as option}<option value={JSON.stringify(option.value)}>{option.label}</option>{/each}
  </select>
</label>
