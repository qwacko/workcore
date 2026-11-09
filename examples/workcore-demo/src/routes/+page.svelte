<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { createClient, type LiveState } from '@workcore/client';
  import type { tracker } from '../app';
  import type { notesApp } from '../notes';
  import type { Task, Note, Conversation, TaskClient, NotesClient } from '$lib/types';
  import AuthForm from '$lib/AuthForm.svelte';
  import TaskWorkspace from '$lib/TaskWorkspace.svelte';
  import NotesWorkspace from '$lib/NotesWorkspace.svelte';
  import ChatWorkspace from '$lib/ChatWorkspace.svelte';
  import WorkspaceShell from '$lib/WorkspaceShell.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Layers } from '@lucide/svelte';
  type User = { id: string; name: string; email: string };
  let user = $state<User | null>(null),
    ready = $state(false),
    busy = $state(false),
    error = $state('');
  const section = $derived(
    page.url.searchParams.get('section') === 'tasks'
      ? 'tasks'
      : page.url.searchParams.get('section') === 'notes'
        ? 'notes'
        : 'chat',
  );
  let tasks = $state<LiveState<Task[]>>({ status: 'loading', revision: 0 }),
    notes = $state<LiveState<Note[]>>({ status: 'loading', revision: 0 }),
    archive = $state<LiveState<Note[]>>({ status: 'loading', revision: 0 }),
    conversation = $state<LiveState<Conversation>>({
      status: 'loading',
      revision: 0,
    });
  let taskClient = $state.raw<TaskClient | null>(null),
    noteClient = $state.raw<NotesClient | null>(null);
  function connect() {
    taskClient?.close();
    noteClient?.close();
    taskClient = createClient<typeof tracker>({
      baseUrl: '/api/workspaces/demo',
    });
    noteClient = createClient<typeof notesApp>({
      baseUrl: '/api/workspaces/notes',
    });
    taskClient.subscribe('tasks', { projectId: 'inbox' }, (state) => (tasks = state));
    taskClient.subscribe('conversation', {}, (state) => (conversation = state));
    noteClient.subscribe('list', {}, (state) => (notes = state));
    noteClient.subscribe('archived', {}, (state) => (archive = state));
  }
  onMount(() => {
    let disposed = false;
    fetch('/api/auth/get-session')
      .then((r) => r.json() as Promise<{ user?: User } | null>)
      .then((data) => {
        if (disposed) return;
        user = data?.user ?? null;
        if (user) connect();
      })
      .catch(() => (error = 'Could not load your session. Please refresh.'))
      .finally(() => {
        if (!disposed) ready = true;
      });
    return () => {
      disposed = true;
      taskClient?.close();
      noteClient?.close();
    };
  });
  async function auth({
    email,
    password,
    name,
    signup,
  }: {
    email: string;
    password: string;
    name: string;
    signup: boolean;
  }) {
    busy = true;
    error = '';
    try {
      const response = await fetch(`/api/auth/${signup ? 'sign-up' : 'sign-in'}/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(signup ? { name } : {}),
        }),
      });
      const data = (await response.json()) as { user: User; message?: string };
      if (!response.ok) throw new Error(data.message || 'Unable to sign in');
      user = data.user;
      connect();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not sign in';
    } finally {
      busy = false;
    }
  }
  async function signout() {
    try {
      const response = await fetch('/api/auth/sign-out', { method: 'POST' });
      if (!response.ok) throw new Error('Could not sign out');
      taskClient?.close();
      noteClient?.close();
      taskClient = null;
      noteClient = null;
      user = null;
      tasks = { status: 'loading', revision: 0 };
      notes = { status: 'loading', revision: 0 };
      archive = { status: 'loading', revision: 0 };
      conversation = { status: 'loading', revision: 0 };
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not sign out';
    }
  }
  function navigate(value: 'tasks' | 'notes' | 'chat') {
    void goto(`/?section=${value}`);
  }
</script>

<svelte:head>
  <title>Workcore Demo · Tasks, notes & chat</title>
  <meta
    name="description"
    content="A custom workspace built on Workcore's typed live client and shadcn-svelte."
  />
</svelte:head>
{#if !ready}<main class="flex min-h-dvh items-center justify-center text-muted-foreground">
    Opening your workspace…
  </main>
{:else if !user}<main
    class="mx-auto grid min-h-dvh max-w-5xl items-center gap-10 px-6 py-12 md:grid-cols-2"
  >
    <div>
      <div class="mb-7 flex items-center gap-2 font-semibold text-primary">
        <Layers class="size-5" />workcore
        <span class="font-normal text-muted-foreground">/ Cloudflare demo</span>
      </div>
      <h1 class="text-4xl leading-tight font-semibold tracking-tight">
        Your work.
        <br />
        A little more connected.
      </h1>
      <p class="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
        Tasks, private notes, and a helpful conversation. A custom application built with a typed
        API and live data.
      </p>
    </div>
    <AuthForm {busy} {error} onsubmit={auth} onmodechange={() => (error = '')} />
  </main>
{:else if taskClient && noteClient}
  {#key taskClient}<WorkspaceShell
      {section}
      userName={user.name}
      live={(section === 'notes' ? notes : section === 'chat' ? conversation : tasks).status ===
        'live'}
      onsectionchange={navigate}
      onsignout={signout}
    >
      {#if error}<div
          class="flex items-center justify-between border-b bg-destructive/10 px-4 py-2 text-destructive"
          role="alert"
        >
          {error}<Button variant="ghost" size="sm" onclick={() => (error = '')}>Dismiss</Button>
        </div>{/if}
      {#if section === 'tasks'}<TaskWorkspace
          client={taskClient}
          {tasks}
          userId={user.id}
        />{:else if section === 'notes'}<NotesWorkspace
          client={noteClient}
          {notes}
          {archive}
        />{:else}<ChatWorkspace {taskClient} {noteClient} {conversation} userId={user.id} />{/if}
    </WorkspaceShell>{/key}
{/if}
