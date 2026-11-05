<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import BlockRenderer from './BlockRenderer.svelte';
  import Modal from './Modal.svelte';
  import { useDisplayContext } from './display-context.svelte.js';
  import { Button } from './components/ui/button/index.js';
  let { block, input = {}, registry = {} }: { block: Extract<ManifestBlock, { kind: 'dialog' }>; input?: Json; registry?: RendererRegistry } = $props();
  let open = $state(false);
  const displayContext = useDisplayContext();
  $effect(() => displayContext.registerEffectHandler('dialog.close', () => open = false));
</script>

<Button variant="outline" aria-haspopup="dialog" onclick={() => open = true}>{block.triggerLabel}</Button>
{#if open}
  <Modal title={block.title ?? block.triggerLabel} onclose={() => open = false}>
    {#if block.description}<p>{block.description}</p>{/if}
    <div class="grid min-w-0 gap-4">{#each block.children as child (child.id)}<BlockRenderer block={child} {input} {registry} />{/each}</div>
  </Modal>
{/if}
