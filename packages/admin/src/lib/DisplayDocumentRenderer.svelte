<script lang="ts">
  import { getContext, setContext, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import type { Json, ManifestDocument } from '@workcore/core';
  import { rendererRegistryKey, type RendererRegistry } from './renderer-context.js';
  import BlockRenderer from './BlockRenderer.svelte';
  import { provideDisplayContext } from './display-context.svelte.js';
  import { createEmbedBudget, displayIdentity, embedContextKey, type EmbedContext } from './embed-context.svelte.js';
  import { sessionKey, type SessionStore } from './session.js';
  import { rendererHostKey, type RendererHost } from './host-context.svelte.js';
  let { document, input = {}, registry = {}, displayName, instanceId, memoryOnly = false, embedded = false }: { document: ManifestDocument; input?: Json; registry?: RendererRegistry; displayName?: string; instanceId?: string; memoryOnly?: boolean; embedded?: boolean } = $props();
  const parentEmbed = getContext<EmbedContext | undefined>(embedContextKey);
  const host = getContext<RendererHost | undefined>(rendererHostKey);
  const session = getContext<SessionStore | undefined>(sessionKey);
  const workspace = untrack(() => session ? get(session)?.workspace : parentEmbed?.workspace);
  setContext(rendererRegistryKey, () => registry);
  const captured = untrack(() => ({ displayName, instanceId, memoryOnly, embedded }));
  setContext(embedContextKey, {
    get ancestry() { return captured.displayName ? [...(parentEmbed?.ancestry ?? []), displayIdentity(workspace, captured.displayName, input)] : parentEmbed?.ancestry ?? []; },
    workspace,
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
