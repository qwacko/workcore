<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import type { Json, Manifest, ManifestDocument } from '@workcore/core';
  import type { RendererRegistry } from './renderer-context.js';
  import { sessionKey, type SessionStore } from './session.js';
  import DisplayDocumentRenderer from './DisplayDocumentRenderer.svelte';
  import Alert from './Alert.svelte';
  import { Button } from './components/ui/button/index.js';
  let { definition, name = 'overview', registry = {} }: { definition: Manifest['ui']['displays'][string]; name?: string; registry?: RendererRegistry } = $props();
  const session = getContext<SessionStore>(sessionKey);
  let document = $state<ManifestDocument | undefined>(undefined);
  let error = $state('');
  const input = $derived.by(() => {
    const params = definition.metadata.route?.path.match(/:([a-zA-Z][a-zA-Z0-9_]*)/g)?.map(value => value.slice(1)) ?? [];
    return Object.fromEntries(params.flatMap(key => {
      const value = page.url.searchParams.get(key);
      if (value === null) return [];
      try { return [[key, JSON.parse(value)]]; } catch { return [[key, value]]; }
    })) as Json;
  });
  const backHref = $derived.by(() => {
    const candidate = page.url.searchParams.get('__back');
    const prefix = $session ? `/admin/${encodeURIComponent($session.workspace)}/` : '';
    return candidate && prefix && candidate.startsWith(prefix) && !candidate.startsWith('//') ? candidate : undefined;
  });
  $effect(() => {
    if (definition.document) { document = definition.document; error = ''; return; }
    if (!$session) return;
    const currentInput = input;
    document = undefined; error = '';
    const subscription = ($session.client.subscribeDisplay as (display: string, properties: Json, listener: (state: { status: string; data?: ManifestDocument; error?: { message: string } }) => void) => { unsubscribe(): void })(name, currentInput, state => {
      if (state.status === 'live' && state.data) { document = state.data; error = ''; }
      else if (state.status === 'error') { error = state.error?.message ?? 'Display unavailable'; document = undefined; }
    });
    return () => subscription.unsubscribe();
  });
</script>
{#if backHref}<Button class="mb-3" variant="ghost" size="sm" href={backHref}>← Back to results</Button>{/if}
<div class="mb-7"><div class="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{definition.metadata.classification === 'admin' ? 'Administration' : 'Workspace application'}</div><h1 class="text-3xl font-semibold tracking-tight">{definition.metadata.title}</h1>{#if definition.metadata.description}<p class="max-w-3xl">{definition.metadata.description}</p>{/if}</div>
{#if error}<Alert variant="destructive">{error}</Alert>{:else if !document}<div class="skeleton" aria-label="Loading display"></div>{:else}{#key name}<DisplayDocumentRenderer {document} {input} {registry} displayName={name} />{/key}{/if}
