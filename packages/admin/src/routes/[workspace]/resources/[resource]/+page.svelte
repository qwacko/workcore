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
  let filePage = $state<{ rows: { id: string; revision: number; data: { ownerId: string; filename: string; contentType: string; size: number; status: string; createdAt: number; uploadedAt: number | null } }[]; nextCursor: string | null } | null>(null);
  let fileBusy = $state(false);
  const resource = $derived(page.params.resource ?? 'runs');
  const table = $derived(page.url.searchParams.get('table'));
  const after = $derived(page.url.searchParams.get('after') ?? '');
  const name = $derived(resource === 'tables' && table ? `table:${table}` : resource);
  const root = $derived(`/admin/${page.params.workspace}`);
  const rows = $derived(resourceState.data && typeof resourceState.data === 'object' && !Array.isArray(resourceState.data) && Array.isArray(resourceState.data.rows) ? resourceState.data.rows as Record<string, Json>[] : []);
  const next = $derived(resourceState.data && typeof resourceState.data === 'object' && !Array.isArray(resourceState.data) ? resourceState.data.nextCursor : null);
  const authorized = $derived(resource === 'runs' ? $session?.manifest.runs : resource === 'files' ? $session?.manifest.files.list : $session?.manifest.admin);
  $effect(() => {
    if ($session && authorized && resource !== 'files') return $session.sources.watch({ kind: 'resource', name }, { after }, value => resourceState = value);
  });
  $effect(() => {
    if (resource !== 'files' || !$session || !authorized) return;
    const client = $session.client;
    void client.files.list(after || undefined).then(value => filePage = value).catch(failure => error = failure instanceof Error ? failure.message : 'Unable to load files');
  });
  async function control(id: string, action: 'retry' | 'cancel' | 'enable' | 'disable') {
    if (!$session) return;
    if (action === 'retry' && !confirm('Retry as a new run? External effects may already have happened and can be repeated.')) return;
    try { await $session.client.control(resource === 'schedules' ? 'schedule' : 'run', id, action); $session.sources.refresh(); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Action failed'; }
  }
  function navigate(cursor: string) { const url = new URL(page.url.href); if (cursor) url.searchParams.set('after', cursor); else url.searchParams.delete('after'); void goto(url); }
  async function uploadFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; if (!file || !$session) return;
    fileBusy = true; error = '';
    try { await $session.client.files.upload(file); filePage = await $session.client.files.list(after || undefined); input.value = ''; }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Upload failed'; }
    finally { fileBusy = false; }
  }
  async function downloadFile(id: string, filename: string) {
    if (!$session) return;
    try { const blob = await $session.client.files.download(id); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Download failed'; }
  }
  async function deleteFile(id: string) {
    if (!$session || !confirm('Permanently delete this file and its stored bytes?')) return;
    fileBusy = true; error = '';
    try { await $session.client.files.remove(id); filePage = await $session.client.files.list(after || undefined); }
    catch (failure) { error = failure instanceof Error ? failure.message : 'Delete failed'; }
    finally { fileBusy = false; }
  }
</script>

<div class="page-heading"><div><div class="eyebrow">Operational visibility</div><h1>{resource === 'runs' ? 'Execution runs' : resource === 'files' ? 'Files' : table ?? label(resource)}</h1><p>{resource === 'runs' ? 'Track tasks and agents. Inspect uncertain outcomes before retrying.' : resource === 'files' ? 'Inspect stored file metadata and manage file bytes through authorized routes.' : resource === 'schedules' ? 'Durable wake-ups for one-off and fixed-interval work.' : resource === 'history' ? 'Successful actions, their initiating identities and execution provenance.' : 'Read-only record inspection. All changes go through mutations.'}</p></div>{#if resource !== 'files'}<button onclick={() => $session?.sources.refresh()}>Refresh</button>{/if}</div>
{#if !authorized}<div class="notice error">You do not have access to this resource.</div>
{:else}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if resourceState.error}<p class="error" role="alert">{resourceState.error.message}</p>{/if}
  <section class="panel">
    {#if resource === 'files'}
      {#if $session?.manifest.files.upload}<label class="button primary">Upload a file<input aria-label="Upload a file" type="file" hidden disabled={fileBusy} onchange={uploadFile} /></label><p class="help">Files are streamed to R2. The configured maximum size is enforced by the server.</p>{/if}
      {#if !filePage?.rows.length}<div class="empty"><strong>No files found</strong><p>Upload a file to this workspace to get started.</p></div>{:else}
        <div class="table-wrap"><table><thead><tr><th>File</th><th>Status</th><th>Owner</th><th>Size</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>
          {#each filePage.rows as file}<tr><td><strong>{file.data.filename}</strong><div class="help">{file.data.contentType} · <code>{file.id.slice(0, 8)}</code></div></td><td><span class="badge" data-tone={file.data.status === 'ready' ? 'success' : 'neutral'}>{file.data.status}</span></td><td>{file.data.ownerId}</td><td>{file.data.size.toLocaleString()} bytes</td><td>{date(file.data.uploadedAt ?? file.data.createdAt)}</td><td><div class="row-actions">{#if file.data.status === 'ready' && $session?.manifest.files.download}<button class="small" onclick={() => downloadFile(file.id, file.data.filename)}>Download</button>{/if}{#if $session?.manifest.files.delete}<button class="small" disabled={fileBusy} onclick={() => deleteFile(file.id)}>Delete</button>{/if}</div></td></tr>{/each}
        </tbody></table></div>
      {/if}
      <div class="pagination">{#if after}<button onclick={() => navigate('')}>First page</button>{/if}{#if filePage?.nextCursor}<button onclick={() => navigate(filePage!.nextCursor!)}>Next page →</button>{/if}</div>
    {:else if resource === 'tables' && !table && resourceState.data && typeof resourceState.data === 'object'}
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
