<script lang="ts">
  import type { Json, JsonSchema, ManifestSourceBlock } from '@workcore/core';
  import Collection from './Collection.svelte';
  import Chat from './Chat.svelte';
  import RecordBlock from './RecordBlock.svelte';
  import JsonBlock from './JsonBlock.svelte';
  import MarkdownBlock from './MarkdownBlock.svelte';

  let { block, data, schema, input = {} }: { block: ManifestSourceBlock; data: Json; schema: JsonSchema; input?: Json } = $props();
</script>

{#if block.kind === 'collection'}
  <Collection {block} {data} {schema} {input} />
{:else if block.kind === 'record'}
  <RecordBlock {block} {data} {schema} {input} />
{:else if block.kind === 'markdown'}
  <MarkdownBlock {block} {data} />
{:else if block.kind === 'chat'}
  <Chat {block} {data} />
{:else}
  <JsonBlock block={block as Extract<ManifestSourceBlock, { kind: 'json' }>} {data} />
{/if}
