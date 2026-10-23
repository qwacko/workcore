<script lang="ts">
  import type { AgentRun, AgentRunStatus, AgentTraceEvent } from '@workcore/core';
  import { richJson } from './rich-input.js';

  let { runs, selectedRun, events, eventCursor, runCursor, status, agent, actorId, conversationId, canReadAll, loading = false, onFilter, onSelectRun, onApplyFilters, onLoadMoreRuns, onLoadMoreEvents, onRefresh } = $props<{
    runs: AgentRun[];
    selectedRun: AgentRun | null;
    events: AgentTraceEvent[];
    eventCursor: string | null;
    runCursor: string | null;
    status: AgentRunStatus | '';
    agent: string;
    actorId: string;
    conversationId: string;
    canReadAll: boolean;
    loading?: boolean;
    onFilter: (field: 'agent' | 'status' | 'actorId' | 'conversationId', value: string) => void;
    onSelectRun: (run: AgentRun) => void;
    onApplyFilters: () => void;
    onLoadMoreRuns: () => void;
    onLoadMoreEvents: () => void;
    onRefresh: () => void;
  }>();
</script>

<div class="agent-resource">
  <div class="agent-filters panel">
    <label>Agent<input value={agent} placeholder="Any agent" oninput={(event) => onFilter('agent', event.currentTarget.value)} /></label>
    <label>Status<select value={status} onchange={(event) => onFilter('status', event.currentTarget.value)}><option value="">Any status</option><option value="queued">Queued</option><option value="running">Running</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option><option value="interrupted">Interrupted</option></select></label>
    {#if canReadAll}<label>Actor ID<input value={actorId} placeholder="Any actor" oninput={(event) => onFilter('actorId', event.currentTarget.value)} /></label>{/if}
    <label>Conversation ID<input value={conversationId} placeholder="Any conversation" oninput={(event) => onFilter('conversationId', event.currentTarget.value)} /></label>
    <button class="secondary" onclick={onApplyFilters} disabled={loading}>Filter</button>
  </div>
  <div class="agent-layout">
    <section class="panel agent-run-list" aria-label="Agent run list">
      {#if runs.length}
        {#each runs as run (run.id)}
          <button class="agent-run-row" class:selected={selectedRun?.id === run.id} onclick={() => onSelectRun(run)}>
            <strong>{run.agent}</strong><span class="status" class:success={run.status === 'succeeded'}>{run.status}</span>
            <small>{run.actorId} · {new Date(run.createdAt).toLocaleString()}</small>
          </button>
        {/each}
        {#if runCursor}<button class="text-button load-more" onclick={onLoadMoreRuns} disabled={loading}>Load more runs</button>{/if}
      {:else}<div class="empty"><h2>No agent runs</h2><p>Runs visible to your account will appear here.</p></div>{/if}
    </section>
    <section class="panel agent-run-detail">
      {#if selectedRun}
        <div class="panel-heading"><div><div class="eyebrow">{selectedRun.agent}</div><h2>Run details</h2><p>{selectedRun.id}</p></div><span class="status" class:success={selectedRun.status === 'succeeded'}>{selectedRun.status}</span></div>
        <dl class="agent-metadata"><div><dt>Actor</dt><dd>{selectedRun.actorId}</dd></div><div><dt>Created</dt><dd>{new Date(selectedRun.createdAt).toLocaleString()}</dd></div><div><dt>Duration</dt><dd>{selectedRun.startedAt && selectedRun.finishedAt ? `${Date.parse(selectedRun.finishedAt) - Date.parse(selectedRun.startedAt)} ms` : '—'}</dd></div>{#if selectedRun.conversationId}<div><dt>Conversation</dt><dd>{selectedRun.conversationId}</dd></div>{/if}</dl>
        {#if selectedRun.error}<div class="alert"><p>{selectedRun.error.code}: {selectedRun.error.message}</p></div>{/if}
        {#if selectedRun.result !== undefined}<details class="run-details" open><summary>Final result</summary><pre>{richJson(selectedRun.result)}</pre></details>{/if}
        <div class="agent-trace-heading"><h3>Trace</h3><button class="text-button" onclick={onRefresh}>Refresh trace</button></div>
        {#if events.length}<ol class="agent-trace">{#each events as event (event.id)}<li><div><strong>{event.type}</strong><time>{new Date(event.createdAt).toLocaleTimeString()}</time></div>{#if event.data !== undefined}<pre>{richJson(event.data)}</pre>{/if}</li>{/each}</ol>
        {:else}<div class="empty"><p>No trace events are currently visible.</p></div>{/if}
        {#if eventCursor}<button class="text-button load-more" onclick={onLoadMoreEvents}>Load later trace events</button>{/if}
      {:else}<div class="empty"><h2>Select an agent run</h2><p>Trace fields are filtered by your assigned capabilities.</p></div>{/if}
    </section>
  </div>
</div>

<style>
  .agent-resource { display: grid; gap: 12px; }
  .agent-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
  .agent-filters label { display: grid; gap: 5px; color: var(--muted, #63716a); font-size: 12px; }
  .agent-layout { display: grid; grid-template-columns: minmax(250px, 0.8fr) minmax(0, 1.2fr); gap: 14px; }
  .agent-run-list, .agent-run-detail { min-width: 0; padding: 16px; }
  .agent-run-row { width: 100%; display: grid; grid-template-columns: 1fr auto; gap: 6px; text-align: left; padding: 12px; border: 0; border-bottom: 1px solid var(--line, #d9e0dc); background: transparent; color: inherit; cursor: pointer; }
  .agent-run-row.selected { background: var(--surface-alt, #f2f6f3); }
  .agent-run-row small { grid-column: 1 / -1; color: var(--muted, #63716a); }
  .agent-metadata { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; }
  .agent-metadata dt { color: var(--muted, #63716a); font-size: 12px; }
  .agent-metadata dd { margin: 3px 0 0; overflow-wrap: anywhere; }
  .agent-trace-heading { display: flex; justify-content: space-between; align-items: center; }
  .agent-trace { padding-left: 20px; }
  .agent-trace li { margin: 10px 0; }
  .agent-trace li > div { display: flex; justify-content: space-between; }
  .agent-trace pre, .run-details pre { overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
  @media (max-width: 760px) { .agent-layout { grid-template-columns: 1fr; } }
</style>
