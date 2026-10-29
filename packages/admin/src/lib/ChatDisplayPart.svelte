<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
  import { displayDocumentSchema, type Json } from '@workcore/core';
  import { sessionKey, type SessionStore } from './session.js';
  import DisplayDocumentRenderer from './DisplayDocumentRenderer.svelte';
  import { useSource } from './source.svelte.js';
  import { embedContextKey, type EmbedContext } from './embed-context.svelte.js';
  import { rendererRegistryKey, type RendererRegistryContext } from './renderer-context.js';
  let { part, instanceId }: { part: { mode: 'live' | 'snapshot'; display: string; input?: Json }; instanceId: string } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const parent = getContext<EmbedContext>(embedContextKey);
  const getRenderers = getContext<RendererRegistryContext>(rendererRegistryKey);
  const registry = $derived(getRenderers?.() ?? {});
  const recursive = $derived(parent?.ancestry.includes(part.display) ?? false);
  const tooDeep = $derived((parent?.ancestry.length ?? 0) >= 8);
  let admitted = $state(false);
  let budgetRevision = $state(0);
  const reservation = Symbol('chat-display-reference');
  $effect(() => parent?.budget.subscribe(() => budgetRevision++));
  $effect(() => {
    budgetRevision;
    if (recursive || tooDeep || !parent) { parent?.budget.release(reservation); admitted = !recursive && !tooDeep && !parent; return; }
    admitted = parent.budget.reserve(reservation);
  });
  onDestroy(() => parent?.budget.release(reservation));
  const exhausted = $derived(tooDeep || !admitted);
  const loader = useSource(() => recursive || exhausted ? null : $session?.sources ?? null,
    () => recursive || exhausted ? null : { kind: 'display', name: part.display },
    () => part.input ?? {}, value => displayDocumentSchema.parse(value));
  const document = $derived(loader.data);
  const error = $derived(recursive ? 'This embedded display would create a cycle.' : exhausted ? 'The embedded display resource budget has been reached.' : loader.state.status === 'error' ? loader.state.error?.message ?? 'Embedded display is unavailable' : '');
</script>

<aside class="chat-display-embed" aria-label={part.mode === 'live' ? 'Live display' : 'Saved display reference'}>
  <div class="message-meta"><strong>{part.mode === 'live' ? 'Live display' : 'Saved display reference'}</strong><span class="badge">Access checked now</span></div>
  {#if error}<p class="notice error" role="alert">{error}</p>{:else if document}{#key `${part.display}:${instanceId}`}<DisplayDocumentRenderer {document} input={part.input ?? {}} {registry} displayName={part.display} {instanceId} memoryOnly embedded />{/key}{:else}<div class="skeleton" aria-label="Loading embedded display"></div>{/if}
  {#if part.mode === 'snapshot'}<p class="help">The message stores this display name and input. The current document is resolved again when reopened; this is not a historical source-data snapshot.</p>{/if}
</aside>
