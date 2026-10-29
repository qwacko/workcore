<script lang="ts">
  import type { Json, ManifestSourceBlock } from '@workcore/core';
  import { useSourceNode } from './source-node.svelte.js';
  import SourceNodeFrame from './SourceNodeFrame.svelte';
  import SourceContent from './SourceContent.svelte';
  import { provideDisplayContext } from './display-context.svelte.js';
  let { block, displayInput = {} }: { block: ManifestSourceBlock; displayInput?: Json } = $props();
  provideDisplayContext();
  const node = useSourceNode(() => block, () => displayInput);
</script>

<SourceNodeFrame {block} operation={node.operation} ready={node.ready} input={node.input} bindingFields={node.bindingFields} loader={node.loader} scope={node.scope}>
  {#snippet children(data: Json)}<SourceContent {block} {data} schema={node.operation!.output} input={node.input} />{/snippet}
</SourceNodeFrame>
