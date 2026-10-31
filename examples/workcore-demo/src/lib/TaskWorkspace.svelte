<script lang="ts">
  import { createClient } from '@workcore/client';
  import type { tracker } from '../app.js';
  import type { z } from 'zod';
  import type { LiveState } from '@workcore/client';
  type Task = z.output<typeof tracker.views.tasks.output>[number];
  type Props = { client: ReturnType<typeof createClient<typeof tracker>>; tasks: LiveState<Task[]>; userId: string; busy: boolean; onerror: (message: string) => void };
  let { client, tasks, userId, busy, onerror }: Props = $props();
  let scope = $state<'mine' | 'all'>('mine');
  let view = $state<'list' | 'board'>('list');
  let search = $state('');
  let saving = $state(false);
  let title = $state('');
  let privateTask = $state(false);
  let visible = $derived((tasks.data ?? []).filter(t => (scope === 'all' || t.ownerId === userId) && t.title.toLowerCase().includes(search.toLowerCase())));
  let openCount = $derived(visible.filter(t => !t.done).length);
  async function mutate(fn: () => Promise<unknown>) { saving = true; try { await fn(); } catch (e) { onerror(e instanceof Error ? e.message : 'Something went wrong'); } finally { saving = false; } }
  function add() { const value = title.trim(); if (!value) return; void mutate(async () => { await client.mutate('createTask', { title: value, private: privateTask }); title = ''; }); }
  function toggle(task: Task) { void mutate(() => client.mutate(task.done ? 'reopenTask' : 'completeTask', { id: task.id, expectedRevision: task.version })); }
</script>

<div class="workspace"><aside><div class="panel"><span class="eyebrow">QUICK CAPTURE</span><h2>New task</h2><form onsubmit={(e) => { e.preventDefault(); add(); }}><label class="sr-only" for="task-title">Task title</label><input id="task-title" bind:value={title} maxlength="200" placeholder="What needs doing?" required /><label class="check"><input type="checkbox" bind:checked={privateTask} /> Private to me</label><button class="primary" disabled={busy || saving}>Add task <span>↗</span></button></form></div><div class="aside-note">✳ <strong>Better together</strong><p>Shared tasks appear for everyone. Private tasks are only sent to you.</p></div></aside>
<section class="content"><div class="toolbar"><div><h2>{scope === 'mine' ? 'My tasks' : 'All tasks'}</h2><p>{openCount} open · {visible.length} total</p></div><div class="segmented" aria-label="Task scope"><button class:selected={scope === 'mine'} onclick={() => scope = 'mine'}>Mine</button><button class:selected={scope === 'all'} onclick={() => scope = 'all'}>Everyone</button></div></div><div class="filters"><input type="search" bind:value={search} placeholder="Search tasks" aria-label="Search tasks" /><div class="segmented"><button class:selected={view === 'list'} onclick={() => view = 'list'}>List</button><button class:selected={view === 'board'} onclick={() => view = 'board'}>Board</button></div></div>
{#if tasks.status === 'error'}<p class="empty">{tasks.error?.message}</p>{:else if !tasks.data}<p class="empty">Loading tasks…</p>{:else if !visible.length}<p class="empty">Nothing here yet. Add a task or change your filters.</p>{:else if view === 'list'}<div class="task-list">{#each visible as task (task.id)}<div class="task"><button class="toggle" disabled={busy || saving || task.ownerId !== userId} aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`} onclick={() => toggle(task)}>{task.done ? '✓' : ''}</button><div class:done={task.done}><strong>{task.title}</strong><small>{task.private ? 'Private' : 'Shared'}{task.ownerId === userId ? ' · You' : ' · Teammate'}</small></div></div>{/each}</div>
{:else}<div class="board">{#each [false, true] as done}<div class="column"><h3>{done ? 'Completed' : 'To do'} <span>{visible.filter(t => t.done === done).length}</span></h3>{#each visible.filter(t => t.done === done) as task (task.id)}<div class="board-card"><strong>{task.title}</strong><small>{task.private ? 'Private' : 'Shared'} · {task.ownerId === userId ? 'You' : 'Teammate'}</small>{#if task.ownerId === userId}<button disabled={busy || saving} onclick={() => toggle(task)}>{done ? '↶ Reopen' : '✓ Complete'}</button>{/if}</div>{/each}</div>{/each}</div>{/if}
</section></div>
