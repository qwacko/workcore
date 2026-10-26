<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import type { Json } from '@workcore/core';
  import type { LiveState } from '@workcore/client';
  import { sessionKey, type SessionStore } from '../../../../lib/session.js';
  import { date, duration, label, text } from '../../../../lib/data.js';
  import AgentProgress from '../../../../lib/AgentProgress.svelte';
  const session = getContext<SessionStore>(sessionKey);
  let runState = $state<LiveState<Json>>({ status: 'loading', revision: 0 });
  let steps = $state<Record<string, Json>[]>([]);
  let cursor = $state<number | null>(null);
  let error = $state('');
  let traceGeneration = 0;
  const id = $derived(page.params.id ?? '');
  const run = $derived(runState.data as Record<string, Json> | undefined);
  const root = $derived(`/admin/${page.params.workspace}`);
  async function trace(append = false) {
    if (!$session) return;
    const generation = ++traceGeneration;
    try {
      const result = await $session.client.trace(id, append ? cursor ?? 0 : 0) as { rows: Record<string, Json>[]; nextCursor: number | null };
      if (generation !== traceGeneration) return;
      steps = append ? [...steps, ...result.rows] : result.rows; cursor = result.nextCursor;
    } catch (failure) { if (generation === traceGeneration) error = failure instanceof Error ? failure.message : 'Trace unavailable'; }
  }
  $effect(() => {
    if ($session) {
      const stop = $session.sources.watch({ kind: 'resource', name: `run:${id}` }, {}, next => runState = next);
      return () => { stop(); traceGeneration++; };
    }
  });
  $effect(() => { const updated = run?.updatedAt; if (updated) void trace(); });
  async function control(action: 'retry' | 'cancel') {
    if (!$session || action === 'retry' && !confirm('Create a new run? Previous external effects may be repeated.')) return;
    try { await $session.client.control('run', id, action); $session.sources.refresh(); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Control failed'; }
  }
</script>
<a class="back-link" href={`${root}/resources/runs`}>← Execution runs</a>
<div class="page-heading"><div><div class="eyebrow">{run?.kind ?? 'Execution'} / {id.slice(0, 8)}</div><h1>{run ? label(String(run.job)) : 'Execution details'}</h1><p>Persisted inputs, outcomes and step-level evidence.</p></div>{#if run}<span class="badge" data-tone={run.status === 'completed' ? 'success' : ['failed', 'interrupted'].includes(String(run.status)) ? 'error' : 'neutral'}>{text(run.status)}</span>{/if}</div>
{#if runState.error}<p class="notice error" role="alert">{runState.error.message}</p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if run}
  {#if run.progress}<AgentProgress value={run.progress} status={run.status} />{/if}
  {#if run.status === 'interrupted'}<div class="notice warning"><strong>Execution was interrupted.</strong> Inspect external effects before retrying. This runtime does not automatically resume an agent loop.</div>{/if}
  <section class="panel"><dl class="record-fields"><div><dt>Started by</dt><dd>{text((run.actor as { id: string })?.id)}</dd></div><div><dt>Created</dt><dd>{date(run.createdAt)}</dd></div><div><dt>Last update</dt><dd>{date(run.updatedAt)}</dd></div><div><dt>Elapsed</dt><dd>{duration(run.createdAt, run.updatedAt)}</dd></div><div><dt>Attempt</dt><dd>{text(run.attempt)}</dd></div>{#if run.scheduleId}<div><dt>Schedule</dt><dd><a href={`${root}/resources/schedules`}>{text(run.scheduleId)}</a></dd></div>{/if}</dl>
    {#if run.error}<p class="error">{text(run.error)}</p>{/if}
    <div class="row-actions"><button onclick={() => { $session?.sources.refresh(); void trace(); }}>Refresh</button>{#if $session?.manifest.admin}{#if run.status === 'running' || run.status === 'queued'}<button onclick={() => control('cancel')}>Request cancellation</button>{:else if ['failed', 'interrupted', 'cancelled'].includes(String(run.status))}<button onclick={() => control('retry')}>Retry as new run</button>{/if}{/if}</div>
  </section>
  <div class="page-grid"><section class="panel"><h2>Input</h2><pre>{JSON.stringify(run.input, null, 2)}</pre></section><section class="panel"><h2>Result</h2>{#if run.result !== undefined}<pre>{JSON.stringify(run.result, null, 2)}</pre>{:else}<p class="muted">No completed result.</p>{/if}</section></div>
  <section class="panel"><div class="panel-heading"><div><h2>Execution timeline</h2><p>Tool metadata and explicit external steps. A completed external effect may precede cancellation.</p></div></div>
    {#if !steps.length}<div class="empty">No recorded steps yet.</div>{/if}
    <ol class="timeline">{#each steps as step}<li><span class="timeline-marker" data-status={step.status}></span><div><div class="timeline-title"><strong>{text(step.label ?? step.operation)}</strong><span class="badge">{text(step.status)}</span><time>{date(step.at)}</time></div>{#if step.result !== undefined}<details><summary>Step result</summary><pre>{JSON.stringify(step.result, null, 2)}</pre></details>{/if}{#if step.error}<p class="error">{text(step.error)}</p>{/if}</div></li>{/each}</ol>
    {#if cursor !== null}<button onclick={() => trace(true)}>More trace entries</button>{/if}
  </section>
{/if}
