<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import BlockRenderer from './BlockRenderer.svelte';
  import Modal from './Modal.svelte';
  import { useDisplayContext } from './display-context.svelte.js';
  let { block, input = {}, registry = {} }: { block: Extract<ManifestBlock, { kind: 'dialog' }>; input?: Json; registry?: RendererRegistry } = $props();
  let open = $state(false);
  const displayContext = useDisplayContext();
  $effect(() => displayContext.registerEffectHandler('dialog.close', () => open = false));
</script>

<button class="button secondary" aria-haspopup="dialog" onclick={() => open = true}>{block.triggerLabel}</button>
{#if open}
  <Modal title={block.title ?? block.triggerLabel} onclose={() => open = false}>
    {#if block.description}<p>{block.description}</p>{/if}
    <div class="dialog-children">{#each block.children as child (child.id)}<BlockRenderer block={child} {input} {registry} />{/each}</div>
  </Modal>
{/if}
