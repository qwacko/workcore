<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import { useDisplayContext } from './display-context.svelte.js';
  import { getContext } from 'svelte';
  import { embedContextKey, type EmbedContext } from './embed-context.svelte.js';
  let { block }: { block: Extract<ManifestBlock, { kind: 'state-control' }> } = $props();
  const context = useDisplayContext();
  const address = $derived(`state.${block.state}`);
  const value = $derived(context.get(address));
  const embed = getContext<EmbedContext | undefined>(embedContextKey);
  const controlId = $derived(`state-${embed?.instanceId ?? 'display'}-${block.id}`);
  import Select from './components/ui/select/select.svelte';
</script>

<div class="mb-4 grid gap-2 text-sm">
  <label for={controlId}>{block.label}</label>
  <Select id={controlId} value={value === undefined ? '' : JSON.stringify(value)} options={block.options.map(option => ({ value: JSON.stringify(option.value), label: option.label }))} onchange={selected => {
    if (selected) context.set(address, JSON.parse(selected) as Json);
  }} />
</div>
