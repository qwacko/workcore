<script lang="ts">
  import { getContext } from 'svelte';
  import type { Json } from '@workcore/core';
  import { useSource } from './source.svelte.js';
  import { sessionKey, type SessionStore } from './session.js';
  import RunDetailPanel from './RunDetailPanel.svelte';
  import { useRendererHost } from './host-context.svelte.js';
  import Alert from './Alert.svelte';

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
  let tracePages = $state<{ after: number; rows: Record<string, Json>[]; nextCursor: number | null }[]>([]);
  const traceSubscriptions = new Map<number, () => void>();

  function watchTrace(after: number) {
    const currentSession = $session;
    const currentRunId = runId;
    if (!currentSession || !currentRunId || traceSubscriptions.has(after)) return;
    // Only the visible tail page needs live updates; earlier trace pages are immutable and can be released.
    for (const stop of traceSubscriptions.values()) stop();
    traceSubscriptions.clear();
    const subscription = currentSession.client.subscribeSystem('runs.trace', { runId: currentRunId, after }, state => {
      if (currentRunId !== runId) return;
      if (state.status === 'error') { traceError = state.error?.message ?? 'Could not load execution trace'; return; }
      if (!state.data || typeof state.data !== 'object' || Array.isArray(state.data)) return;
      const result = state.data as Record<string, Json>;
      const rows = Array.isArray(result.rows) ? result.rows.filter((row): row is Record<string, Json> => !!row && typeof row === 'object' && !Array.isArray(row)) : [];
      const nextCursor = typeof result.nextCursor === 'number' ? result.nextCursor : null;
      const page = { after, rows, nextCursor };
      const index = tracePages.findIndex(existing => existing.after === after);
      tracePages = index < 0 ? [...tracePages, page].sort((a, b) => a.after - b.after) : tracePages.map(existing => existing.after === after ? page : existing);
      traceRows = tracePages.flatMap(existing => existing.rows).sort((a, b) => Number(a.sequence) - Number(b.sequence));
      traceCursor = tracePages.at(-1)?.nextCursor ?? null;
      traceError = '';
    });
    traceSubscriptions.set(after, () => subscription.unsubscribe());
  }
  $effect(() => {
    const currentRunId = runId;
    const currentSession = $session;
    traceRows = []; tracePages = []; traceCursor = null; traceError = '';
    if (currentSession && currentRunId && currentSession.manifest.runs) watchTrace(0);
    return () => { for (const stop of traceSubscriptions.values()) stop(); traceSubscriptions.clear(); };
  });
  async function control(action: 'retry' | 'cancel') {
    if (!$session || !runId) return;
    if (action === 'retry' && !confirm('Create a new run? Previous external effects may already have happened.')) return;
    try { await $session.client.system(action === 'retry' ? 'runs.retry' : 'runs.cancel', { runId }); $session.sources.refresh(); }
    catch (error) { traceError = error instanceof Error ? error.message : 'Run action failed'; }
  }
</script>

{#if authorized}<RunDetailPanel state={loader.state} {run} {traceRows} {traceCursor} error={traceError} onrefresh={() => { loader.refresh(); }} onmore={() => { if (traceCursor !== null) watchTrace(traceCursor); }} oncontrol={control} />{:else}<Alert variant="destructive">Execution details are not available to your current actor.</Alert>{/if}
