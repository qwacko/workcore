<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import { useSourceNode } from './source-node.svelte.js';
  import SourceNodeFrame from './SourceNodeFrame.svelte';
  import JsonBlock from './JsonBlock.svelte';
  let { block, input = {} }: { block: Extract<ManifestBlock, { kind: 'json' }>; input?: Json } = $props();
  const node = useSourceNode(() => block, () => input);
</script>
<SourceNodeFrame {block} operation={node.operation} ready={node.ready} input={node.input} bindingFields={node.bindingFields} loader={node.loader} scope={node.scope}>
  {#snippet children(data: Json)}<JsonBlock {block} {data} />{/snippet}
</SourceNodeFrame>
