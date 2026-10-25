<script lang="ts">
  import { getContext } from 'svelte';
  import type { Json, ManifestAction } from '@workcore/core';
  import SchemaForm from './SchemaForm.svelte';
  import { actionValues, operationFor } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  let { action, row, ondone = () => {} }: { action: ManifestAction; row?: unknown; ondone?: (result: { data: Json; revision: number }) => void } = $props();
  const session = getContext<SessionStore>(sessionKey);
  let success = $state('');
  let result = $state<Json | undefined>();
  let requestKey = '';
  let requestId = '';
  const operation = $derived($session ? operationFor($session.manifest, action) : undefined);
</script>

{#if $session && operation}
  {#if action.description}<p class="muted">{action.description}</p>{/if}
  <SchemaForm schema={operation.input} initial={actionValues(action, row, operation.input)} locked={[...Object.keys(action.bind ?? {}), ...Object.keys(action.values ?? {})]} submitLabel={action.label} onsubmit={async input => {
    if (!$session || action.confirm && !confirm(action.confirm)) return;
    success = '';
    const key = JSON.stringify(input);
    if (!requestId || requestKey !== key) { requestKey = key; requestId = crypto.randomUUID(); }
    const response = action.operation.kind === 'mutation'
      ? await $session.client.mutate(action.operation.name, input, requestId)
      : await $session.client.enqueue(action.operation.name, input, requestId);
    requestId = '';
    result = response.data;
    success = `Accepted · revision ${response.revision}`;
    $session.sources.refresh();
    ondone(response);
  }} />
  {#if success}<p class="success" role="status">{success}</p>{/if}
  {#if action.operation.kind === 'job' && typeof result === 'string'}
    <a class="button" href={`/admin/${$session.workspace}/runs/${result}`}>Inspect execution →</a>
  {/if}
{:else}<p class="muted">This action is not available with your current permissions.</p>{/if}
