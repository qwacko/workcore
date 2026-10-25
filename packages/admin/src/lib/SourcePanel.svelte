<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { LiveState } from '@workcore/client';
  import { defaults, date, label, readPath, text } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import SchemaForm from './SchemaForm.svelte';
  import Collection from './Collection.svelte';
  import Markdown from './Markdown.svelte';
  import Chat from './Chat.svelte';
  let { block }: { block: ManifestBlock } = $props();
  const session = getContext<SessionStore>(sessionKey);
  let state = $state<LiveState<Json>>({ status: 'loading', revision: 0 });
  const operation = $derived(block.source && $session ? $session.manifest[block.source.kind][block.source.name] : undefined);
  const scopePrefix = $derived(`scope.${block.id}.`);
  const inputKey = $derived.by(() => {
    const input = { ...(defaults(operation?.input ?? { type: 'object' }) as object), ...(block.input as object ?? {}) } as Record<string, Json>;
    for (const key of Object.keys(operation?.input.properties ?? {})) {
      const value = page.url.searchParams.get(scopePrefix + key);
      if (value !== null) { try { input[key] = JSON.parse(value) as Json; } catch { input[key] = value; } }
    }
    return JSON.stringify(input);
  });
  $effect(() => {
    if ($session && block.source) {
      state = { status: 'loading', revision: 0 };
      return $session.sources.watch(block.source, JSON.parse(inputKey), next => state = next);
    }
  });
  function scope(input: Json) {
    const url = new URL(page.url.href);
    for (const key of Object.keys(operation?.input.properties ?? {})) url.searchParams.delete(scopePrefix + key);
    for (const [key, value] of Object.entries(input as object)) url.searchParams.set(scopePrefix + key, JSON.stringify(value));
    void goto(url, { replace: true, reset: false });
  }
</script>

<div class="source-status"><span class="status-dot" data-status={state.status}></span><span>{state.status === 'live' ? block.source?.kind === 'view' ? 'Live' : 'Snapshot' : state.status === 'reconnecting' ? 'Reconnecting · data may be stale' : state.status === 'error' ? 'Unavailable' : 'Connecting…'}</span>{#if state.revision}<span class="muted">revision {state.revision}</span>{/if}{#if block.source?.kind === 'query'}<button class="text-button small" onclick={() => $session?.sources.refresh()}>Refresh query</button>{/if}</div>
{#if operation && Object.keys(operation.input.properties ?? {}).length}
  <details class="scope"><summary>Data scope <span class="help">· server parameters</span></summary>
    {#key inputKey}<SchemaForm schema={operation.input} initial={JSON.parse(inputKey)} submitLabel="Apply server scope" onsubmit={scope} />{/key}
    <p class="help">Changing these values loads a new server-selected dataset. Local filters below do not change what the server sends.</p>
  </details>
{/if}
{#if state.status === 'error'}<div class="notice error" role="alert"><strong>{state.error?.code}</strong><p>{state.error?.message}</p></div>{/if}
{#if state.data !== undefined && operation}
  {#if block.kind === 'collection'}
    <Collection {block} data={state.data} schema={operation.output} />
  {:else if block.kind === 'markdown'}
    {#if readPath(state.data, block.path ?? '')}<Markdown content={readPath(state.data, block.path ?? '')} />{:else}<p class="muted">No content yet.</p>{/if}
  {:else if block.kind === 'record'}
    {#if state.data === null || typeof state.data !== 'object'}<dl class="record-fields"><div><dt>Value</dt><dd>{text(state.data)}</dd></div></dl>{:else}
    <dl class="record-fields">{#each block.fields ?? Object.keys(operation.output.properties ?? {}).filter(path => !operation.output.properties?.[path]?.['x-workcore']?.hidden).map(path => ({ path, label: operation.output.properties?.[path]?.title ?? label(path), format: undefined })) as field}<div><dt>{field.label ?? label(field.path)}</dt><dd>{field.format === 'date' ? date(readPath(state.data, field.path)) : text(readPath(state.data, field.path))}</dd></div>{/each}</dl>
    {/if}
  {:else if block.kind === 'chat'}
    <Chat {block} data={state.data} />
  {:else}<pre>{JSON.stringify(state.data, null, 2)}</pre>{/if}
  {#if state.data && !Array.isArray(state.data) && typeof state.data === 'object' && state.data.nextCursor && operation.input.properties?.after}
    <button class="button" onclick={() => scope({ ...JSON.parse(inputKey), after: state.data && !Array.isArray(state.data) && typeof state.data === 'object' ? state.data.nextCursor : null })}>Next page →</button>
  {/if}
{:else if state.status === 'loading'}<div class="skeleton" aria-label="Loading result"></div>{/if}
