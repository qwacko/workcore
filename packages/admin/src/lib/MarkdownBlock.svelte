<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import { readPath } from './data.js';
  import Markdown from './Markdown.svelte';
  let { block, data }: { block: Extract<ManifestBlock, { kind: 'markdown' }>; data: Json } = $props();
  const content = $derived(readPath(data, block.path ?? '') as string | undefined);
</script>
{#if content}<Markdown {content} />{:else}<p class="muted">No content yet.</p>{/if}
