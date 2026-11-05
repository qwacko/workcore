<script lang="ts">
  import { getContext } from 'svelte';
  import type { Json, ManifestAction, ManifestBlock, ManifestSourceBlock } from '@workcore/core';
  import { label } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import ActionForm from './ActionForm.svelte';
  import OperationResultPanel from './OperationResultPanel.svelte';
  import EmptyState from './EmptyState.svelte';

  let { input = {} }: { input?: Json } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const values = $derived(input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, Json> : {});
  const kind = $derived(String(values.kind ?? 'view') as 'view' | 'query' | 'mutation' | 'job');
  const name = $derived(String(values.name ?? ''));
  const operation = $derived($session && Object.hasOwn($session.manifest[kind], name) ? $session.manifest[kind][name] : undefined);
  const action = $derived({ kind: 'form', operation: { kind, name }, label: operation?.ui?.submitLabel ?? (kind === 'job' ? 'Launch run' : 'Execute') } as ManifestAction);
  const resultBlock = $derived({ id: 'operation-result', kind: operation?.ui?.presentation === 'markdown' ? 'markdown' : operation?.ui?.presentation === 'record' ? 'record' : operation?.ui?.presentation === 'json' ? 'json' : operation?.output.type === 'array' || operation?.output.properties?.rows ? 'collection' : 'json', presentation: operation?.ui?.presentation === 'list' ? 'list' : 'table', source: { kind, name } } as ManifestSourceBlock);
</script>

{#if operation}
  <h2>{operation.ui?.label ?? label(name)}</h2>
  {#if operation.ui?.description}<p>{operation.ui.description}</p>{/if}
  {#if kind === 'mutation' || kind === 'job'}<ActionForm {action} />{:else}<OperationResultPanel block={resultBlock} />{/if}
  <details class="mt-7 border-t pt-4"><summary class="cursor-pointer text-muted-foreground">Inspect schemas</summary><h3 class="mt-5">Input</h3><pre>{JSON.stringify(operation.input, null, 2)}</pre><h3 class="mt-5">Output</h3><pre>{JSON.stringify(operation.output, null, 2)}</pre></details>
{:else}<EmptyState description="Operation unavailable" />{/if}
