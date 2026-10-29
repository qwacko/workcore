<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Json, JsonSchema, ManifestOperation, ManifestSourceBlock } from '@workcore/core';
  import type { SourceLoader } from './source.svelte.js';
  import SchemaForm from './SchemaForm.svelte';
  import DisplayCard from './DisplayCard.svelte';
  import LoadBoundary from './LoadBoundary.svelte';
  let { block, operation, ready, input, bindingFields, loader, scope, children }: {
    block: ManifestSourceBlock;
    operation: ManifestOperation | undefined;
    ready: boolean;
    input: Json;
    bindingFields: string[];
    loader: SourceLoader;
    scope: (input: Json) => void;
    children: Snippet<[Json]>;
  } = $props();
</script>

<DisplayCard title={block.title ?? block.source.name} description={block.description} wide={block.kind === 'collection' || block.kind === 'chat'}>
  <div class="source-status"><span class="status-dot" data-status={ready ? loader.state.status : 'loading'}></span><span>{!ready ? 'Waiting for selection' : loader.state.status === 'live' ? block.source.kind === 'view' ? 'Live' : 'Snapshot' : loader.state.status === 'reconnecting' ? 'Reconnecting' : loader.state.status === 'error' ? 'Unavailable' : 'Connecting…'}</span>{#if loader.state.revision}<span class="muted">revision {loader.state.revision}</span>{/if}{#if block.source.kind === 'query' && ready}<button class="text-button small" onclick={() => loader.refresh()}>Refresh query</button>{/if}</div>
  {#if operation && Object.keys(operation.input.properties ?? {}).length}
    <details class="scope"><summary>Data scope <span class="help">· server parameters</span></summary>
      <SchemaForm schema={operation.input as JsonSchema} initial={input} locked={bindingFields} submitLabel="Apply server scope" onsubmit={scope} />
      <p class="help">Changing these values loads a new server-selected dataset. Local filters below do not change what the server sends.</p>
    </details>
  {/if}
  {#if !ready}<p class="muted">Select a row in the related collection to load this result.</p>
  {:else}<LoadBoundary state={loader.state}>{#snippet children(data: Json)}{@render children(data)}{/snippet}</LoadBoundary>{/if}
</DisplayCard>
