<script lang="ts">
  import { getContext } from 'svelte';
  import type { Json } from '@workcore/core';
  import { useSource } from './source.svelte.js';
  import { sessionKey, type SessionStore } from './session.js';
  import RunDetailPanel from './RunDetailPanel.svelte';
  import { useRendererHost } from './host-context.svelte.js';

  let { input = {} }: { input?: Json } = $props();
  const session = getContext<SessionStore>(sessionKey);
  const host = useRendererHost();
  const authorized = $derived($session?.manifest.runs ?? false);
  const inputObject = $derived(input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, Json> : {});
  const runId = $derived(String(host.location().searchParams.get('runId') ?? inputObject.runId ?? ''));
  const loader = useSource(() => $session?.sources ?? null, () => runId && $session?.manifest.runs ? { kind: 'system', name: 'runs.inspect' } : null, () => ({ runId }));
  const run = $derived(loader.data && typeof loader.data === 'object' && !Array.isArray(loader.data) ? loader.data as Record<string, Json> : undefined);
  let traceRows = $state<Record<string, Json>[]>([]);
  let traceCursor = $state<number | null>(null);
  let traceError = $state('');
  let traceGeneration = 0;

  async function loadTrace(append: boolean) {
    if (!$session || !runId) return;
    const generation = ++traceGeneration;
    try {
      const result = await $session.client.system('runs.trace', { runId, after: append ? traceCursor ?? 0 : 0 }) as unknown as { rows: Record<string, Json>[]; nextCursor: number | null };
      if (generation !== traceGeneration) return;
      traceRows = append ? [...traceRows, ...result.rows] : result.rows;
      traceCursor = result.nextCursor;
      traceError = '';
    } catch (error) { if (generation === traceGeneration) traceError = error instanceof Error ? error.message : 'Could not load execution trace'; }
  }
  $effect(() => { const updated = run?.updatedAt; if (updated && runId) void loadTrace(false); });
  async function control(action: 'retry' | 'cancel') {
    if (!$session || !runId) return;
    if (action === 'retry' && !confirm('Create a new run? Previous external effects may already have happened.')) return;
    try { await $session.client.system(action === 'retry' ? 'runs.retry' : 'runs.cancel', { runId }); $session.sources.refresh(); }
    catch (error) { traceError = error instanceof Error ? error.message : 'Run action failed'; }
  }
</script>

{#if authorized}<RunDetailPanel state={loader.state} {run} {traceRows} {traceCursor} error={traceError} onrefresh={() => { loader.refresh(); void loadTrace(false); }} onmore={() => loadTrace(true)} oncontrol={control} />{:else}<div class="notice error">Execution details are not available to your current actor.</div>{/if}
