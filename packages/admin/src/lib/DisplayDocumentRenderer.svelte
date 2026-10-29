<script lang="ts">
  import { getContext, setContext, untrack } from 'svelte';
  import type { Json, ManifestDocument } from '@workcore/core';
  import { rendererRegistryKey, type RendererRegistry } from './renderer-context.js';
  import BlockRenderer from './BlockRenderer.svelte';
  import { provideDisplayContext } from './display-context.svelte.js';
import { createEmbedBudget, embedContextKey, type EmbedContext } from './embed-context.svelte.js';
  import { rendererHostKey, type RendererHost } from './host-context.svelte.js';
  let { document, input = {}, registry = {}, displayName, instanceId, memoryOnly = false, embedded = false }: { document: ManifestDocument; input?: Json; registry?: RendererRegistry; displayName?: string; instanceId?: string; memoryOnly?: boolean; embedded?: boolean } = $props();
  const parentEmbed = getContext<EmbedContext | undefined>(embedContextKey);
  const host = getContext<RendererHost | undefined>(rendererHostKey);
  setContext(rendererRegistryKey, () => registry);
  const captured = untrack(() => ({ displayName, instanceId, memoryOnly, embedded }));
  setContext(embedContextKey, {
    ancestry: captured.displayName ? [...(parentEmbed?.ancestry ?? []), captured.displayName] : parentEmbed?.ancestry ?? [],
    budget: parentEmbed?.budget ?? createEmbedBudget(),
    instanceId: captured.instanceId ?? captured.displayName ?? parentEmbed?.instanceId ?? 'display',
    memoryOnly: captured.memoryOnly || parentEmbed?.memoryOnly || false,
    embedded: captured.embedded || parentEmbed?.embedded || false,
  } satisfies EmbedContext);
  const displayContext = provideDisplayContext();
  const effectiveMemoryOnly = captured.memoryOnly || parentEmbed?.memoryOnly || false;
  $effect(() => {
    const currentDocument = document;
    displayContext.configureState(currentDocument.state ?? {}, `${captured.instanceId ?? captured.displayName ?? 'display'}`, effectiveMemoryOnly ? undefined : host);
  });
</script>

<div class="page-grid">
  {#each document.blocks as block (block.id)}
    <BlockRenderer {block} {input} {registry} />
  {/each}
</div>
