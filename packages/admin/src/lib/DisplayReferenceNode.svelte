<script lang="ts">
  import { getContext, onDestroy } from 'svelte';
  import type { Json, ManifestBlock } from '@workcore/core';
  import { displayDocumentSchema } from '@workcore/core';
  import { sessionKey, type SessionStore } from './session.js';
  import { useSource } from './source.svelte.js';
  import { displayIdentity, embedContextKey, type EmbedContext } from './embed-context.svelte.js';
  import { rendererRegistryKey, type RendererRegistryContext } from './renderer-context.js';
  import { useDisplayContext } from './display-context.svelte.js';
  import { readPath } from './data.js';
  import DisplayDocumentRenderer from './DisplayDocumentRenderer.svelte';
  import LoadBoundary from './LoadBoundary.svelte';
  import Alert from './Alert.svelte';

  let { block, input = {} }: { block: Extract<ManifestBlock, { kind: 'display' }>; input?: Json } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const parent = getContext<EmbedContext>(embedContextKey);
  const displayContext = useDisplayContext();
  const getRenderers = getContext<RendererRegistryContext>(rendererRegistryKey);
  const registry = $derived(getRenderers?.() ?? {});
  const tooDeep = $derived((parent?.ancestry.length ?? 0) >= 8);
  let admitted = $state(false);
  let budgetRevision = $state(0);
  const reservation = Symbol('display-reference');
  $effect(() => parent?.budget.subscribe(() => budgetRevision++));
  $effect(() => {
    budgetRevision;
    if (cycle || tooDeep || !parent) { parent?.budget.release(reservation); admitted = !cycle && !tooDeep && !parent; return; }
    admitted = parent.budget.reserve(reservation);
  });
  onDestroy(() => parent?.budget.release(reservation));
  const limited = $derived(tooDeep || !admitted);
  const resolved = $derived.by(() => {
    let ready = true;
    const resolve = (value: Json): Json | undefined => {
      if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && '$workcoreBinding' in value) {
        const binding = (value as { $workcoreBinding?: { kind?: string; path?: string; node?: string; name?: string } }).$workcoreBinding;
        const result = binding?.kind === 'property' && binding.path ? readPath(input, binding.path) : binding?.kind === 'selection' && binding.node ? displayContext.get(`selection.${parent?.instanceId ?? 'display'}.${binding.node}`) : binding?.kind === 'state' && binding.name ? displayContext.get(`state.${binding.name}`) : undefined;
        if (result === undefined) ready = false;
        return result;
      }
      if (Array.isArray(value)) return value.map(item => resolve(item) ?? null);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => { const result = resolve(child); return result === undefined ? [] : [[key, result]]; }));
      return value;
    };
    const resolvedInput = resolve(block.input ?? {}) ?? {};
    return { ready, input: resolvedInput };
  });
  const cycle = $derived(parent?.ancestry.includes(displayIdentity($session?.workspace, block.display, resolved.input)) ?? false);
  const loader = useSource<Json>(() => cycle || limited || !resolved.ready ? null : $session?.sources ?? null, () => cycle || limited || !resolved.ready ? null : { kind: 'display', name: block.display }, () => resolved.input, value => displayDocumentSchema.parse(value) as unknown as Json);
  const document = $derived(loader.data === undefined ? undefined : displayDocumentSchema.parse(loader.data));
</script>

<div class="display-embed" data-display={block.display}>
{#if cycle}<Alert variant="destructive">This display reference would create a cycle.</Alert>
{:else if limited}<Alert variant="destructive">The embedded display resource budget has been reached.</Alert>
{:else if !resolved.ready}<p class="muted">Select a row to load this display.</p>
  {:else}<LoadBoundary state={loader.state} label="Loading embedded display">
  {#snippet children(value: Json)}{#key `${block.display}:${parent?.instanceId ?? 'display'}/${block.id}`}<DisplayDocumentRenderer document={document ?? displayDocumentSchema.parse(value)} input={resolved.input} {registry} displayName={block.display} instanceId={`${parent?.instanceId ?? 'display'}/${block.id}`} memoryOnly={parent?.memoryOnly ?? false} embedded />{/key}{/snippet}
</LoadBoundary>{/if}
</div>
