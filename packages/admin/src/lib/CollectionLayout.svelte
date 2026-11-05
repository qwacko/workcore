<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import BlockRenderer from './BlockRenderer.svelte';
  import DisplayCard from './DisplayCard.svelte';
  let { block, input = {}, registry = {} }: { block: Extract<ManifestBlock, { kind: 'section' }>; input?: Json; registry?: RendererRegistry } = $props();
</script>

{#if block.appearance === 'plain'}
  <section class="min-w-0">
    {#if block.title || block.description}<header class="mb-4 flex justify-between gap-4"><div>{#if block.title}<h2>{block.title}</h2>{/if}{#if block.description}<p>{block.description}</p>{/if}</div></header>{/if}
    <div class="grid gap-4">{#each block.children as child (child.id)}<BlockRenderer block={child} {input} {registry} />{/each}</div>
  </section>
{:else}
  <DisplayCard title={block.title} description={block.description}>
    <div class="grid gap-4">{#each block.children as child (child.id)}<BlockRenderer block={child} {input} {registry} />{/each}</div>
  </DisplayCard>
{/if}
