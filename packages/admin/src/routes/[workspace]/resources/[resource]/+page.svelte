<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import type { Json, ManifestBlock } from '@workcore/core';
  import type { LiveState } from '@workcore/client';
  import { sessionKey, type SessionStore } from '../../../../lib/session.js';
  import { date, duration, label, text } from '../../../../lib/data.js';
  import Collection from '../../../../lib/Collection.svelte';
  import Modal from '../../../../lib/Modal.svelte';
  const session = getContext<SessionStore>(sessionKey);
  let resourceState = $state<LiveState<Json>>({ status: 'loading', revision: 0 });
  let error = $state('');
  let detail = $state<unknown>();
  const resource = $derived(page.params.resource ?? 'runs');
  const table = $derived(page.url.searchParams.get('table'));
  const after = $derived(page.url.searchParams.get('after') ?? '');
  const name = $derived(resource === 'tables' && table ? `table:${table}` : resource);
  const root = $derived(`/admin/${page.params.workspace}`);
  const rows = $derived(resourceState.data && typeof resourceState.data === 'object' && !Array.isArray(resourceState.data) && Array.isArray(resourceState.data.rows) ? resourceState.data.rows as Record<string, Json>[] : []);
  const next = $derived(resourceState.data && typeof resourceState.data === 'object' && !Array.isArray(resourceState.data) ? resourceState.data.nextCursor : null);
  const authorized = $derived(resource === 'runs' ? $session?.manifest.runs : $session?.manifest.admin);
  $effect(() => {
    if ($session && authorized) return $session.sources.watch({ kind: 'resource', name }, { after }, value => resourceState = value);
  });
  async function control(id: string, action: 'retry' | 'cancel' | 'enable' | 'disable') {
    if (!$session) return;
    if (action === 'retry' && !confirm('Retry as a new run? External effects may already have happened and can be repeated.')) return;
    try { await $session.client.control(resource === 'schedules' ? 'schedule' : 'run', id, action); $session.sources.refresh(); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Action failed'; }
  }
  function navigate(cursor: string) { const url = new URL(page.url.href); if (cursor) url.searchParams.set('after', cursor); else url.searchParams.delete('after'); void goto(url); }
</script>

<div class="page-heading"><div><div class="eyebrow">Operational visibility</div><h1>{resource === 'runs' ? 'Execution runs' : table ?? label(resource)}</h1><p>{resource === 'runs' ? 'Track tasks and agents. Inspect uncertain outcomes before retrying.' : resource === 'schedules' ? 'Durable wake-ups for one-off and fixed-interval work.' : resource === 'history' ? 'Successful actions, their initiating identities and execution provenance.' : 'Read-only record inspection. All changes go through mutations.'}</p></div><button onclick={() => $session?.sources.refresh()}>Refresh</button></div>
{#if !authorized}<div class="notice error">You do not have access to this resource.</div>
{:else}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if resourceState.error}<p class="error" role="alert">{resourceState.error.message}</p>{/if}
  <section class="panel">
    {#if resource === 'tables' && !table && resourceState.data && typeof resourceState.data === 'object'}
      <div class="table-cards">{#each Object.entries(resourceState.data) as [name, version]}<a class="table-card" href={`${root}/resources/tables?table=${name}`}><span>▤</span><strong>{label(name)}</strong><small>Schema version {text(version)}</small><span>Browse records →</span></a>{/each}</div>
    {:else if resource === 'tables' && table && resourceState.data}
      <a class="text-button" href={`${root}/resources/tables`}>← All tables</a>
      <Collection block={{ id: 'inspect-table', kind: 'collection', title: table } as ManifestBlock} data={resourceState.data} schema={{ items: { properties: rows[0]?.data && typeof rows[0].data === 'object' ? { data: { properties: Object.fromEntries(Object.keys(rows[0].data).map(key => [key, {}])) } } : {} } }} />
    {:else if resource === 'runs'}
      <p class="help">Updates every 3 seconds. ID-ordered pages; completed payloads are available in run details.</p>
      {#if !rows.length}<div class="empty"><strong>No execution runs yet</strong><p>Launch a task or send a message to the assistant.</p></div>{:else}
        <div class="table-wrap"><table><thead><tr><th>Operation</th><th>Status</th><th>Started by</th><th>Created</th><th>Elapsed</th><th>Actions</th></tr></thead><tbody>
          {#each rows as run}<tr><td><a href={`${root}/runs/${run.id}`}>{label(String(run.job))}</a><div class="help"><code>{String(run.id).slice(0, 8)}</code> · {run.kind}</div></td><td><span class="badge" data-tone={run.status === 'completed' ? 'success' : ['failed', 'interrupted'].includes(String(run.status)) ? 'error' : 'neutral'}>{text(run.status)}</span>{#if run.error}<div class="help">{text(run.error)}</div>{/if}</td><td>{text((run.actor as { id: string })?.id)}</td><td>{date(run.createdAt)}</td><td>{duration(run.createdAt, run.updatedAt)}</td><td><div class="row-actions"><a class="button small" href={`${root}/runs/${run.id}`}>Inspect run</a>{#if $session?.manifest.admin}{#if run.status === 'queued' || run.status === 'running'}<button class="small" onclick={() => control(String(run.id), 'cancel')}>Cancel</button>{:else if ['failed', 'interrupted', 'cancelled'].includes(String(run.status))}<button class="small" onclick={() => control(String(run.id), 'retry')}>Retry</button>{/if}{/if}</div></td></tr>{/each}
        </tbody></table></div>
      {/if}
    {:else if resource === 'schedules'}
      <p class="help">Missed intervals coalesce. A schedule does not overlap its own queued/running work. Disabling does not cancel an existing run.</p>
      {#if !rows.length}<div class="empty"><strong>No schedules yet</strong><p>Use a task’s Schedule action to create a persisted wake-up.</p></div>{:else}
        <div class="table-wrap"><table><thead><tr><th>Job</th><th>Status</th><th>Next due</th><th>Repeat</th><th>Last run</th><th>Actions</th></tr></thead><tbody>
          {#each rows as schedule}<tr><td>{label(String(schedule.job))}<div class="help">{String(schedule.id).slice(0, 8)}</div></td><td><span class="badge" data-tone={schedule.enabled ? 'success' : 'neutral'}>{schedule.enabled ? 'Enabled' : 'Disabled'}</span>{#if schedule.lastError}<div class="error">{text(schedule.lastError)}</div>{/if}</td><td>{date(schedule.at)}</td><td>{schedule.everyMs ? `${Number(schedule.everyMs) / 1000}s` : 'Once'}</td><td>{#if schedule.lastRunId}<a href={`${root}/runs/${schedule.lastRunId}`}>Inspect run →</a>{:else}—{/if}</td><td><div class="row-actions"><button class="small" onclick={() => control(String(schedule.id), schedule.enabled ? 'disable' : 'enable')}>{schedule.enabled ? 'Disable' : 'Enable'}</button><button class="small" onclick={async () => { try { detail = await $session?.client.inspect(`schedule:${schedule.id}`); } catch (failure) { error = String(failure); } }}>Details</button></div></td></tr>{/each}
        </tbody></table></div>
      {/if}
    {:else if resource === 'history'}
      {#if !rows.length}<div class="empty">No successful actions recorded yet.</div>{:else}<div class="table-wrap"><table><thead><tr><th>Action</th><th>Actor</th><th>Time</th><th>Revision</th><th>Execution</th></tr></thead><tbody>{#each rows as entry}<tr><td><code>{text(entry.operation)}</code></td><td>{text(entry.actorId)}</td><td>{date(entry.at)}</td><td>{text(entry.revision)}</td><td>{#if entry.runId}<a href={`${root}/runs/${entry.runId}`}>Inspect run →</a>{:else}Interactive{/if}</td></tr>{/each}</tbody></table></div>{/if}
    {/if}
    <div class="pagination">{#if after}<button onclick={() => navigate('')}>First page</button>{/if}{#if typeof next === 'string'}<button onclick={() => navigate(next)}>Next page →</button>{/if}</div>
  </section>
{/if}
{#if detail}<Modal title="Schedule details" onclose={() => detail = undefined}><pre>{JSON.stringify(detail, null, 2)}</pre></Modal>{/if}
