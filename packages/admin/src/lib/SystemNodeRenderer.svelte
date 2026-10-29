<script lang="ts">
  import type { Json, ManifestBlock } from '@workcore/core';
  import SystemOperationIndex from './SystemOperationIndex.svelte';
  import SystemOperationNode from './SystemOperationNode.svelte';
  import SystemResourceNode from './SystemResourceNode.svelte';
  import SystemFilesNode from './SystemFilesNode.svelte';
  import SystemRunDetailNode from './SystemRunDetailNode.svelte';
  let { block, input = {} }: { block: Extract<ManifestBlock, { kind: 'system' }>; input?: Json } = $props();
</script>

{#if block.system === 'operation-index'}<SystemOperationIndex />
{:else if block.system === 'operation'}<SystemOperationNode {input} />
{:else if block.system === 'run-detail'}<SystemRunDetailNode {input} />
{:else if block.system === 'resource' && block.resource === 'files'}<SystemFilesNode {input} />
{:else if block.system === 'resource' && block.resource}<SystemResourceNode block={block as Extract<ManifestBlock, { kind: 'system' }> & { system: 'resource' }} />
{:else}<div class="notice error">This system display is incomplete.</div>{/if}
