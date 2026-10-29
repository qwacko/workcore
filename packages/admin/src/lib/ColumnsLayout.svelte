<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import BlockRenderer from './BlockRenderer.svelte';
  let { block, input = {}, registry = {} }: { block: Extract<ManifestBlock, { kind: 'columns' }>; input?: Json; registry?: RendererRegistry } = $props();
  const gap = $derived(`gap-${block.gap ?? 'normal'}`);
</script>

<div class="display-columns {gap}" style={`--display-column-count:${block.columns.length}`}>
  {#each block.columns as column (column.id)}
    <div class="display-column" data-column={column.id}>
      {#each column.children as child (child.id)}<BlockRenderer block={child} {input} {registry} />{/each}
    </div>
  {/each}
</div>
