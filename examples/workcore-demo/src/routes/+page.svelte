<script lang="ts">
  import { onMount } from 'svelte';
  import AuthForm from '../lib/AuthForm.svelte';
  import TaskWorkspace from '../lib/TaskWorkspace.svelte';
  import NotesWorkspace from '../lib/NotesWorkspace.svelte';
  import WorkspaceShell from '../lib/WorkspaceShell.svelte';
  import { createClient, type LiveState } from '@workcore/client';
  import type { tracker } from '../app.js';
  import type { notesApp } from '../notes.js';
  import type { z } from 'zod';

  type Task = z.output<typeof tracker.views.tasks.output>[number];
  type Note = z.output<typeof notesApp.views.list.output>[number];
  let user = $state<{ id: string; name: string; email: string } | null>(null);
  let ready = $state(false), busy = $state(false), error = $state('');
  let section = $state<'tasks' | 'notes'>('tasks');

  let tasks = $state<LiveState<Task[]>>({ status: 'loading', revision: 0 });
  let notes = $state<LiveState<Note[]>>({ status: 'loading', revision: 0 });
  let archive = $state<LiveState<Note[]>>({ status: 'loading', revision: 0 });
  let taskClient = $state.raw<ReturnType<typeof createClient<typeof tracker>> | null>(null);
  let noteClient = $state.raw<ReturnType<typeof createClient<typeof notesApp>> | null>(null);


  function connect() {
    taskClient = createClient<typeof tracker>({ baseUrl: '/api/workspaces/demo' });
    noteClient = createClient<typeof notesApp>({ baseUrl: '/api/workspaces/notes' });
    taskClient.subscribe('tasks', { projectId: 'inbox' }, state => tasks = state);
    noteClient.subscribe('list', {}, state => notes = state);
    noteClient.subscribe('archived', {}, state => archive = state);
  }
  onMount(() => {
    let disposed = false;
    fetch('/api/auth/get-session').then(r => r.json() as Promise<{ user?: typeof user } | null>).then(data => {
      if (disposed) return;
      user = data?.user ?? null;
      if (user) connect();
    }).catch(() => error = 'Could not load your session. Please refresh.').finally(() => ready = true);
    return () => { disposed = true; taskClient?.close(); noteClient?.close(); };
  });
  async function auth({ email, password, name, signup }: { email: string; password: string; name: string; signup: boolean }) {
    busy = true; error = '';
    try {
      const response = await fetch(`/api/auth/${signup ? 'sign-up' : 'sign-in'}/email`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, ...(signup ? { name } : {}) }) });
      const data = await response.json() as { message?: string; user: NonNullable<typeof user> };
      if (!response.ok) throw new Error(data.message || 'Unable to sign in');
      user = data.user; connect();
    } catch (e) { error = e instanceof Error ? e.message : 'Something went wrong'; }
    finally { busy = false; }
  }
  async function signout() {
    try { const response = await fetch('/api/auth/sign-out', { method: 'POST' }); if (!response.ok) throw new Error('Could not sign out'); taskClient!.close(); noteClient!.close(); user = null; tasks = { status: 'loading', revision: 0 }; notes = { status: 'loading', revision: 0 }; archive = { status: 'loading', revision: 0 }; }
    catch (e) { error = e instanceof Error ? e.message : 'Could not sign out'; }
  }
</script>

<svelte:head><title>Workcore Demo · A little more room to think</title><meta name="description" content="A live workspace for tasks and notes, powered by Workcore." /></svelte:head>
{#if !ready}<main class="loading">Opening your workspace…</main>
{:else if !user}
  <main class="auth-shell"><div><span class="eyebrow">WORKCORE DEMO / YOUR WORKSPACE</span><h1>A little more room<br />to think.</h1><p>Keep work moving and good ideas close. A live workspace built with Workcore.</p></div>
    <AuthForm {busy} {error} onsubmit={auth} onmodechange={() => error = ''} />
  </main>
{:else}
  {@const liveState = section === 'tasks' ? tasks : notes}
  <WorkspaceShell {section} liveStatus={liveState.status} live={liveState.status === 'live'} onsectionchange={(value) => section = value} onsignout={signout}>
    {#snippet children()}
      {#if error}<div class="alert" role="alert">{error} <button onclick={() => error = ''}>Dismiss</button></div>{/if}
      {#if section === 'tasks'}
        <TaskWorkspace client={taskClient!} {tasks} userId={user!.id} {busy} onerror={(message) => error = message} />
      {:else}
        <NotesWorkspace client={noteClient!} {notes} {archive} {busy} onerror={(message) => error = message} />
      {/if}
    {/snippet}
  </WorkspaceShell>
{/if}


