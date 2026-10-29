<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import CollectionNode from './CollectionNode.svelte';
  import RecordNode from './RecordNode.svelte';
  import JsonNode from './JsonNode.svelte';
  import MarkdownNode from './MarkdownNode.svelte';
  import ChatNode from './ChatNode.svelte';
  import SystemNodeRenderer from './SystemNodeRenderer.svelte';
  import CollectionLayout from './CollectionLayout.svelte';
  import ColumnsLayout from './ColumnsLayout.svelte';
  import DialogLayout from './DialogLayout.svelte';
  import ActionBlock from './ActionBlock.svelte';
  import ActionForm from './ActionForm.svelte';
  import DisplayCard from './DisplayCard.svelte';
  import CustomBlock from './CustomBlock.svelte';
  import DisplayReferenceNode from './DisplayReferenceNode.svelte';
  import StateControlNode from './StateControlNode.svelte';

  let { block, input = {}, registry = {} }: { block: ManifestBlock; input?: Json; registry?: RendererRegistry } = $props();
</script>

{#if block.kind === 'section'}
  <CollectionLayout {block} {input} {registry} />
{:else if block.kind === 'columns'}
  <ColumnsLayout {block} {input} {registry} />
{:else if block.kind === 'dialog'}
  <DialogLayout {block} {input} {registry} />
{:else if block.kind === 'button'}
  <ActionBlock {block} />
{:else if block.kind === 'form'}
  <DisplayCard title={block.title ?? block.action.label} description={block.description}><ActionForm action={block.action} /></DisplayCard>
{:else if block.kind === 'system'}
  <SystemNodeRenderer {block} {input} />
{:else if block.kind === 'custom'}
  <CustomBlock {block} {input} {registry} />
{:else if block.kind === 'collection'}
  <CollectionNode {block} input={input} />
{:else if block.kind === 'record'}
  <RecordNode {block} input={input} />
{:else if block.kind === 'json'}
  <JsonNode {block} input={input} />
{:else if block.kind === 'markdown'}
  <MarkdownNode {block} input={input} />
{:else if block.kind === 'display'}
  <DisplayReferenceNode {block} {input} />
{:else if block.kind === 'state-control'}
  <StateControlNode {block} />
{:else}
  <ChatNode {block} input={input} />
{/if}
