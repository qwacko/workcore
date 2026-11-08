<script lang="ts">
  import type { Json } from '@workcore/core';
  import type { LiveState } from '@workcore/client';
  import { date, duration, text } from './data.js';
  import { getContext } from 'svelte';
  import { sessionKey, type SessionStore } from './session.js';
  import AgentProgress from './AgentProgress.svelte';
  import { Button } from './components/ui/button/index.js';
  import DisplayCard from './DisplayCard.svelte';
  import { Badge } from './components/ui/badge/index.js';
  import EmptyState from './EmptyState.svelte';
  import Alert from './Alert.svelte';
  import { useRendererHost } from './host-context.svelte.js';
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
  const host = useRendererHost();
</script>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if state.error}<Alert variant="destructive">{state.error.message}</Alert>{/if}
{#if run}
  {#if run.progress}<AgentProgress value={run.progress} status={run.status} />{/if}
  {#if run.status === 'interrupted'}<Alert title="Execution was interrupted">Inspect external effects before retrying.</Alert>{/if}
  {#if typeof run.retryOf === 'string' && host.runHref}<Button variant="outline" href={host.runHref(run.retryOf)}>Original run →</Button>{/if}
  <DisplayCard><dl class="grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-6 py-2"><div><dt class="text-sm text-muted-foreground">Started by</dt><dd class="mt-2 break-words text-2xl font-semibold">{text((run.actor as { id: string })?.id)}</dd></div><div><dt class="text-sm text-muted-foreground">Created</dt><dd class="mt-2 break-words text-2xl font-semibold">{date(run.createdAt)}</dd></div><div><dt class="text-sm text-muted-foreground">Last update</dt><dd class="mt-2 break-words text-2xl font-semibold">{date(run.updatedAt)}</dd></div><div><dt class="text-sm text-muted-foreground">Elapsed</dt><dd class="mt-2 break-words text-2xl font-semibold">{duration(run.createdAt, run.updatedAt)}</dd></div><div><dt class="text-sm text-muted-foreground">Attempt</dt><dd class="mt-2 break-words text-2xl font-semibold">{text(run.attempt)}</dd></div></dl>
    {#if run.error}<p class="error">{text(run.error)}</p>{/if}
    <div class="row-actions"><Button variant="outline" onclick={onrefresh}>Refresh</Button>{#if $session?.manifest.admin}{#if run.status === 'running' || run.status === 'queued'}<Button variant="destructive" onclick={() => oncontrol('cancel')}>Request cancellation</Button>{:else if ['failed', 'interrupted', 'cancelled'].includes(String(run.status))}<Button variant="outline" onclick={() => oncontrol('retry')}>Retry as new run</Button>{/if}{/if}</div>
  </DisplayCard>
  <div class="grid grid-cols-2 items-start gap-5 max-[1000px]:grid-cols-1"><DisplayCard title="Input"><pre>{JSON.stringify(run.input, null, 2)}</pre></DisplayCard><DisplayCard title="Result"><pre>{JSON.stringify(run.result ?? null, null, 2)}</pre></DisplayCard></div>
  <DisplayCard title="Execution timeline">{#if !traceRows.length}<EmptyState description="No recorded steps yet." />{/if}<ol class="grid list-none gap-3 p-0">{#each traceRows as step}<li><DisplayCard><div class="flex flex-wrap items-center gap-3"><strong>{text(step.label ?? step.operation)}</strong><Badge variant={step.status === 'failed' ? 'destructive' : 'secondary'}>{text(step.status)}</Badge><time class="ml-auto text-xs text-muted-foreground">{date(step.at)}</time></div>{#if step.result !== undefined}<details class="mt-3"><summary>Step result</summary><pre>{JSON.stringify(step.result, null, 2)}</pre></details>{/if}{#if step.error}<p class="error">{text(step.error)}</p>{/if}</DisplayCard></li>{/each}</ol>{#if traceCursor !== null}<Button variant="outline" onclick={onmore}>More trace entries</Button>{/if}</DisplayCard>
{:else}<div class="skeleton" aria-label="Loading execution"></div>{/if}
