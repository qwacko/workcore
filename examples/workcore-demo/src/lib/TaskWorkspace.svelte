<script lang="ts">
  import type { LiveState } from '@workcore/client';
  import type { Task, TaskClient } from './types';
  import TaskItem from './TaskItem.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Plus, Search, List, Columns2, Lock, Users, User } from '@lucide/svelte';
  let { client, tasks, userId }: { client: TaskClient; tasks: LiveState<Task[]>; userId: string } =
    $props();
  let searchOpen = $state(false);
  let title = $state(''),
    search = $state(''),
    status = $state('open'),
    own = $state(false),
    privateTask = $state(true),
    board = $state(false),
    saving = $state(false),
    error = $state('');
  const visible = $derived(
    (tasks.data ?? []).filter(
      (t) =>
        (!own || t.ownerId === userId) &&
        (status === 'all' || t.done === (status === 'done')) &&
        t.title.toLowerCase().includes(search.toLowerCase()),
    ),
  );
  async function create() {
    if (!title.trim() || saving) return;
    saving = true;
    error = '';
    try {
      await client.mutate('createTask', {
        title: title.trim(),
        private: privateTask,
      });
      title = '';
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not create task';
    } finally {
      saving = false;
    }
  }
</script>

<section class="flex min-h-0 flex-1 flex-col" aria-label="Task workspace">
  <h1 class="sr-only">Tasks</h1>
  <div class="flex h-12 shrink-0 items-center gap-1.5 border-b bg-card px-3">
    <Tabs.Root bind:value={status}>
      <Tabs.List class="h-8">
        <Tabs.Trigger value="open" class="text-xs">Open</Tabs.Trigger><Tabs.Trigger
          value="done"
          class="text-xs"
        >
          Completed
        </Tabs.Trigger><Tabs.Trigger value="all" class="text-xs">All</Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
    <div class="relative ml-auto hidden min-w-0 flex-1 sm:block sm:max-w-60">
      <Search
        class="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground"
      /><Input
        type="search"
        class="h-8 pl-7 text-xs"
        bind:value={search}
        aria-label="Search tasks"
        placeholder="Search tasks…"
      />
    </div>
    <Button
      variant={searchOpen ? 'secondary' : 'ghost'}
      size="icon-sm"
      class="ml-auto size-8 sm:hidden"
      aria-label="Search tasks"
      aria-pressed={searchOpen}
      onclick={() => {
        searchOpen = !searchOpen;
        if (!searchOpen) search = '';
      }}
    >
      <Search class="size-4" />
    </Button>
    <Button
      variant={own ? 'secondary' : 'ghost'}
      size="sm"
      class="h-8 gap-1.5 px-2"
      aria-label={own ? 'My tasks' : 'Everyone'}
      title={own ? 'Showing my tasks' : 'Showing everyone’s tasks'}
      aria-pressed={own}
      onclick={() => (own = !own)}
    >
      {#if own}<User class="size-4" />{:else}<Users class="size-4" />{/if}
      <span class="hidden sm:inline">{own ? 'My tasks' : 'Everyone'}</span>
    </Button>
    <Button
      variant="ghost"
      size="icon-sm"
      class="size-8"
      aria-label={board ? 'List view' : 'Board view'}
      onclick={() => (board = !board)}
    >
      {#if board}<List class="size-4" />{:else}<Columns2 class="size-4" />{/if}
    </Button>
  </div>
  {#if searchOpen}<div class="shrink-0 border-b bg-card px-3 pb-2 sm:hidden">
      <Input
        type="search"
        class="h-8 text-sm"
        bind:value={search}
        aria-label="Search tasks"
        placeholder="Search tasks…"
      />
    </div>{/if}
  <div class="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
    {#if tasks.status === 'error'}<p role="alert" class="text-destructive">
        {tasks.error?.message}
      </p>{:else if !tasks.data}<p class="text-muted-foreground">
        Loading tasks…
      </p>{:else if !visible.length}<div
        class="rounded-lg border border-dashed p-10 text-center text-muted-foreground"
      >
        No tasks here. Add one below or change your filters.
      </div>{:else if board}<div class="grid gap-4 sm:grid-cols-2">
        {#each [false, true] as done}<section class="rounded-lg border bg-muted/40 p-3">
            <h2 class="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {done ? 'Completed' : 'To do'} · {visible.filter((t) => t.done === done).length}
            </h2>
            <div class="overflow-hidden rounded-md border bg-card">
              {#each visible.filter((t) => t.done === done) as task (task.id)}<TaskItem
                  {task}
                  {client}
                  {userId}
                />{/each}
            </div>
          </section>{/each}
      </div>{:else}<div class="overflow-hidden rounded-lg border bg-card">
        {#each visible as task (task.id)}<TaskItem {task} {client} {userId} />{/each}
      </div>{/if}
  </div>
  <form
    class="shrink-0 border-t bg-card p-3"
    onsubmit={(e) => {
      e.preventDefault();
      void create();
    }}
  >
    <div class="flex items-center gap-2">
      <Input
        class="h-9 min-w-0 flex-1"
        aria-label="Task title"
        bind:value={title}
        placeholder="Add a task…"
        maxlength={200}
        required
      />
      <Button
        type="button"
        role="checkbox"
        aria-label="Private task"
        aria-checked={privateTask}
        variant="ghost"
        size="icon-sm"
        class={`size-8 ${privateTask ? 'text-primary' : 'text-muted-foreground'}`}
        title={privateTask ? 'Private task — only you' : 'Shared task — visible to teammates'}
        onclick={() => (privateTask = !privateTask)}
      >
        {#if privateTask}<Lock class="size-4" />{:else}<Users class="size-4" />{/if}
      </Button>
      <Button
        type="submit"
        aria-label="Add task"
        size="icon-sm"
        class="size-9"
        disabled={saving || !title.trim()}
      >
        <Plus class="size-4" />
      </Button>
    </div>
    {#if error}<p role="alert" class="mt-2 text-xs text-destructive">{error}</p>{/if}
  </form>
</section>
