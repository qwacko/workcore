<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import BlockRenderer from './BlockRenderer.svelte';
  let { block, input = {}, registry = {} }: { block: Extract<ManifestBlock, { kind: 'columns' }>; input?: Json; registry?: RendererRegistry } = $props();
  const gap = $derived(block.gap === 'compact' ? 'gap-2.5' : block.gap === 'spacious' ? 'gap-7' : 'gap-4');
</script>

<div class={`grid grid-cols-[repeat(var(--column-count),minmax(0,1fr))] items-start max-[760px]:grid-cols-1 ${gap}`} style={`--column-count:${block.columns.length}`}>
  {#each block.columns as column (column.id)}
    <div class="grid min-w-0 gap-4" data-column={column.id}>
      {#each column.children as child (child.id)}<BlockRenderer block={child} {input} {registry} />{/each}
    </div>
  {/each}
</div>
