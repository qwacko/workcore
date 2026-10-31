<script lang="ts">
  import { onDestroy } from 'svelte';
  import { getContext } from 'svelte';
  import type { Json, ManifestBlock } from '@workcore/core';
  import { useSource } from './source.svelte.js';
  import { sessionKey, type SessionStore } from './session.js';
  import { label, text } from './data.js';
  import DisplayCard from './DisplayCard.svelte';
  import LoadBoundary from './LoadBoundary.svelte';
  import SystemResourceTable from './SystemResourceTable.svelte';
  import Modal from './Modal.svelte';
  import { useRendererHost } from './host-context.svelte.js';

  let { block }: { block: Extract<ManifestBlock, { kind: 'system' }> & { system: 'resource' } } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const host = useRendererHost();
  const resource = $derived(block.resource! as 'runs' | 'schedules' | 'tables' | 'history');
  const table = $derived(host.location().searchParams.get('table'));
  const after = $derived(host.location().searchParams.get('after') ?? '');
  const operation = $derived(resource === 'tables' ? table ? 'tables.read' : 'tables.list' : `${resource}.list`);
  const input = $derived(JSON.stringify({ ...(resource === 'tables' && table ? { table } : {}), after }));
  const allowed = $derived(resource === 'runs' ? $session?.manifest.runs : !!$session?.manifest.admin);
  const loader = useSource(() => $session?.sources ?? null, () => allowed ? ({ kind: 'system', name: operation }) : null, () => JSON.parse(input) as Json);
  let detail = $state<Json | undefined>();
  let detailSubscription: { unsubscribe(): void } | undefined;
  let actionError = $state('');
  const value = $derived(loader.data && typeof loader.data === 'object' && !Array.isArray(loader.data) ? loader.data as Record<string, Json> : undefined);
  const rows = $derived(value && Array.isArray(value.rows) ? value.rows as Record<string, Json>[] : []);
  const columns = $derived(value && Array.isArray(value.columns) ? value.columns as { name: string; label: string; format: 'text' | 'badge' | 'date'; hidden?: boolean }[] : []);
  const nextCursor = $derived(value && typeof value.nextCursor === 'string' ? value.nextCursor : null);

  function navigate(cursor: string) {
    const url = new URL(host.location().href);
    if (cursor) url.searchParams.set('after', cursor); else url.searchParams.delete('after');
    void host.navigate(url.href);
  }
  async function control(kind: 'run' | 'schedule', id: string, action: 'retry' | 'cancel' | 'enable' | 'disable') {
    if (!$session) return;
    if (action === 'retry' && !confirm('Create a new run? Previous external effects may already have happened.')) return;
    const name = kind === 'run' ? action === 'retry' ? 'runs.retry' : 'runs.cancel' : action === 'enable' ? 'schedules.enable' : 'schedules.disable';
    actionError = '';
    try { await $session.client.system(name, kind === 'run' ? { runId: id } : { scheduleId: id }); $session.sources.refresh(); }
    catch (error) { actionError = error instanceof Error ? error.message : 'System action failed'; }
  }
  function inspect(id: string) {
    if (!$session) return;
    detailSubscription?.unsubscribe();
    detail = undefined;
    detailSubscription = $session.client.subscribeSystem('schedules.inspect', { scheduleId: id }, state => {
      if (state.status === 'error') detail = { error: state.error?.message ?? 'Unable to inspect schedule' };
      else if (state.data !== undefined) detail = state.data;
    });
  }
  function closeDetail() { detailSubscription?.unsubscribe(); detailSubscription = undefined; detail = undefined; }
  onDestroy(closeDetail);
</script>

{#if !allowed}<div class="notice error">This system display is not available to your current actor.</div>
{:else}<DisplayCard title={label(resource)} wide>
  {#if actionError}<p class="error" role="alert">{actionError}</p>{/if}
  {#if resource === 'runs'}<p class="help">Run status and trace updates arrive live. Inspect a run for full input, result, and timeline details.</p>{:else if resource === 'schedules'}<p class="help">Schedule changes arrive live.</p>{/if}
  {#if resource === 'tables' && table}<a class="text-button" href="?">← All tables</a>{/if}
  <LoadBoundary state={loader.state}>
    {#snippet children(data: Json)}
      {#if resource === 'tables' && !table && data && typeof data === 'object' && !Array.isArray(data)}
        <div class="table-cards">{#each Object.entries(data) as [name, metadata]}<a class="table-card" href={`?table=${encodeURIComponent(name)}`}><span>▤</span><strong>{metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? text(metadata.label ?? label(name)) : label(name)}</strong><small>{metadata && typeof metadata === 'object' && !Array.isArray(metadata) && Array.isArray(metadata.columns) ? metadata.columns.length : 0} columns</small><span>Browse records →</span></a>{/each}</div>
      {:else if rows.length}<SystemResourceTable {resource} {rows} {columns} runHref={host.runHref} oncontrol={control} oninspect={inspect} />
      {:else}<div class="empty">No {resource} found.</div>{/if}
    {/snippet}
  </LoadBoundary>
  {#if nextCursor}<div class="pagination"><button onclick={() => navigate(nextCursor!)}>Next page →</button></div>{/if}
</DisplayCard>{/if}
{#if detail}<Modal title="Schedule details" onclose={closeDetail}><pre>{JSON.stringify(detail, null, 2)}</pre></Modal>{/if}
