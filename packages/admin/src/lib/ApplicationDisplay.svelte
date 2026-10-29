<script lang="ts">
  import { getContext, onDestroy, setContext, untrack } from 'svelte';
  import { writable } from 'svelte/store';
  import { displayDocumentSchema, type Json, type Manifest, type ManifestDocument } from '@workcore/core';
  import type { RuntimeClient } from '@workcore/client';
  import { createSources, createActionDispatcher } from '@workcore/client';
  import { sessionKey, type Session } from './session.js';
  import type { RendererRegistry } from './renderer-context.js';
  import DisplayDocumentRenderer from './DisplayDocumentRenderer.svelte';
  import { useSource } from './source.svelte.js';
  import LoadBoundary from './LoadBoundary.svelte';
  import { rendererHostKey, type RendererHost } from './host-context.svelte.js';

  let { client, manifest, workspace, display, input = {}, registry = {}, host }: {
    client: RuntimeClient; manifest: Manifest; workspace: string; display: string; input?: Json; registry?: RendererRegistry; host?: RendererHost;
  } = $props();
  const inheritedHost = getContext<RendererHost | undefined>(rendererHostKey);
  const rendererHost = untrack(() => host ?? inheritedHost);
  if (!rendererHost) throw new Error('ApplicationDisplay requires a host navigation adapter');
  setContext(rendererHostKey, rendererHost);
  const sources = untrack(() => createSources(client));
  const actions = untrack(() => createActionDispatcher(client));
  const session = writable<Session>(untrack(() => ({ workspace, client, manifest, sources, actions, close: () => { actions.close(); sources.close(); client.close(); } })));
  setContext(sessionKey, session);
  const descriptor = $derived(manifest.ui.displays[display]);
  const source = $derived(descriptor && !descriptor.document ? { kind: 'display' as const, name: display } : null);
  const loader = useSource(() => sources, () => source, () => input, value => displayDocumentSchema.parse(value));
  const unavailable = $derived(!descriptor ? 'Display is not available to this actor.' : '');
  onDestroy(() => { actions.close(); sources.close(); });
</script>

{#if unavailable}<section class="panel notice error" role="alert">{unavailable}</section>
{:else if descriptor?.document}{#key display}<DisplayDocumentRenderer document={descriptor.document} {input} {registry} displayName={display} />{/key}
{:else}<LoadBoundary state={loader.state} label="Loading display">
  {#snippet children(resolvedDocument)}{#key display}<DisplayDocumentRenderer document={resolvedDocument} {input} {registry} displayName={display} />{/key}{/snippet}
</LoadBoundary>{/if}
