<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import BlockRenderer from './BlockRenderer.svelte';
  import Alert from './Alert.svelte';
  let { block, input = {}, registry = {} }: { block: Extract<ManifestBlock, { kind: 'custom' }>; input?: Json; registry?: RendererRegistry } = $props();
  const Renderer = $derived(registry[block.component]);
</script>

{#if Renderer}
  <Renderer props={block.props} {input}>
    {#if block.children}{#each block.children as child (child.id)}<BlockRenderer block={child} {input} {registry} />{/each}{/if}
  </Renderer>
{:else}<Alert title="Unsupported component"><p>{block.component}@{block.version} is valid for this display but no renderer is registered in this application.</p>{#if block.children}{#each block.children as child (child.id)}<BlockRenderer block={child} {input} {registry} />{/each}{/if}</Alert>{/if}
