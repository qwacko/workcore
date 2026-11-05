<script lang="ts">
  import { getContext } from 'svelte';
  import type { Json, ManifestAction } from '@workcore/core';
  import SchemaForm from './SchemaForm.svelte';
import { actionValues, operationFor } from './data.js';
  import { sessionKey, type SessionStore } from './session.js';
  import { useRendererHost } from './host-context.svelte.js';
import { useDisplayContext } from './display-context.svelte.js';
  import { runSuccessEffects } from './success-effects.js';
  import { Button } from './components/ui/button/index.js';
  let { action, row, ondone = () => {} }: { action: ManifestAction; row?: unknown; ondone?: (result: { data: Json; revision: number }) => void } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const host = useRendererHost();
  const displayContext = useDisplayContext();
  let success = $state('');
  let result = $state<Json | undefined>();
  let resetEpoch = $state(0);
  const scope = $props.id();
  const operation = $derived($session ? operationFor($session.manifest, action) : undefined);
</script>

{#if $session && operation}
  {#if action.description}<p class="muted">{action.description}</p>{/if}
  {#key resetEpoch}<SchemaForm schema={operation.input} initial={actionValues(action, row, operation.input)} locked={[...Object.keys(action.bind ?? {}), ...Object.keys(action.values ?? {})]} submitLabel={action.label} onsubmit={async input => {
    if (!$session || action.confirm && !confirm(action.confirm)) return;
    success = '';
    const response = await $session.actions.execute(`form:${scope}`, action.operation, input);
    result = response.data;
    success = `Accepted · revision ${response.revision}`;
    await runSuccessEffects(action, response.data, {
      displayContext, host, refreshSources: () => $session?.sources.refresh(), resetForm: () => resetEpoch++,
    });
    ondone(response);
  }} />{/key}
  {#if success}<p class="success" role="status">{success}</p>{/if}
  {#if action.operation.kind === 'job' && typeof result === 'string' && host.runHref}
    <Button variant="outline" href={host.runHref(result)}>Inspect execution →</Button>
  {/if}
{:else}<p class="muted">This action is not available with your current permissions.</p>{/if}
