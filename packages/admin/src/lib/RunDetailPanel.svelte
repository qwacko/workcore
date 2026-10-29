<script lang="ts">
  import type { Json } from '@workcore/core';
  import type { LiveState } from '@workcore/client';
  import { date, duration, text } from './data.js';
  import { getContext } from 'svelte';
  import { sessionKey, type SessionStore } from './session.js';
  import AgentProgress from './AgentProgress.svelte';
  let { state, run, traceRows, traceCursor, error, onrefresh, onmore, oncontrol }: {
    state: LiveState<Json>;
    run?: Record<string, Json>;
    traceRows: Record<string, Json>[];
    traceCursor: number | null;
    error: string;
    onrefresh: () => void;
    onmore: () => void;
    oncontrol: (action: 'retry' | 'cancel') => void;
  } = $props();
  const session = getContext<SessionStore>(sessionKey);
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if state.error}<p class="notice error">{state.error.message}</p>{/if}
{#if run}
  {#if run.progress}<AgentProgress value={run.progress} status={run.status} />{/if}
  {#if run.status === 'interrupted'}<div class="notice warning">Execution was interrupted. Inspect external effects before retrying.</div>{/if}
  <section class="panel"><dl class="record-fields"><div><dt>Started by</dt><dd>{text((run.actor as { id: string })?.id)}</dd></div><div><dt>Created</dt><dd>{date(run.createdAt)}</dd></div><div><dt>Last update</dt><dd>{date(run.updatedAt)}</dd></div><div><dt>Elapsed</dt><dd>{duration(run.createdAt, run.updatedAt)}</dd></div><div><dt>Attempt</dt><dd>{text(run.attempt)}</dd></div></dl>
    {#if run.error}<p class="error">{text(run.error)}</p>{/if}
    <div class="row-actions"><button onclick={onrefresh}>Refresh</button>{#if $session?.manifest.admin}{#if run.status === 'running' || run.status === 'queued'}<button onclick={() => oncontrol('cancel')}>Request cancellation</button>{:else if ['failed', 'interrupted', 'cancelled'].includes(String(run.status))}<button onclick={() => oncontrol('retry')}>Retry as new run</button>{/if}{/if}</div>
  </section>
  <div class="page-grid"><section class="panel"><h2>Input</h2><pre>{JSON.stringify(run.input, null, 2)}</pre></section><section class="panel"><h2>Result</h2><pre>{JSON.stringify(run.result ?? null, null, 2)}</pre></section></div>
  <section class="panel"><h2>Execution timeline</h2>{#if !traceRows.length}<div class="empty">No recorded steps yet.</div>{/if}<ol class="timeline">{#each traceRows as step}<li><span class="timeline-marker" data-status={step.status}></span><div><div class="timeline-title"><strong>{text(step.label ?? step.operation)}</strong><span class="badge">{text(step.status)}</span><time>{date(step.at)}</time></div>{#if step.result !== undefined}<details><summary>Step result</summary><pre>{JSON.stringify(step.result, null, 2)}</pre></details>{/if}{#if step.error}<p class="error">{text(step.error)}</p>{/if}</div></li>{/each}</ol>{#if traceCursor !== null}<button onclick={onmore}>More trace entries</button>{/if}</section>
{:else}<div class="skeleton" aria-label="Loading execution"></div>{/if}
