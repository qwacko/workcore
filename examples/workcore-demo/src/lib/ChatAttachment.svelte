<script lang="ts">
  import { onMount } from 'svelte';
  import type { ChatPart } from '../chat-contract';
  import type { Task, Note, TaskClient, NotesClient } from './types';
  import { useLive } from './live.svelte';
  import TaskItem from './TaskItem.svelte';
  import NoteCard from './NoteCard.svelte';
  import { Input } from '$lib/components/ui/input';
  import { Badge } from '$lib/components/ui/badge';
  import * as Tabs from '$lib/components/ui/tabs';
  import { NotebookPen, CheckSquare } from '@lucide/svelte';
  let {
    part,
    taskClient,
    noteClient,
    userId,
  }: {
    part: Exclude<ChatPart, { type: 'text' }>;
    taskClient: TaskClient;
    noteClient: NotesClient;
    userId: string;
  } = $props();
  let root: HTMLElement,
    active = $state(false),
    search = $state(''),
    status = $state('');
  const isTask = $derived(part.type === 'task' || part.type === 'task-list');
  // Depend on query values, not the identity of each new message/part object.
  const taskId = $derived(part.type === 'task' ? part.taskId : null);
  const projectId = $derived(part.type === 'task-list' ? part.projectId : null);
  const noteId = $derived(part.type === 'note' ? part.noteId : null);
  const notesQuery = $derived(part.type === 'note-list' ? part.query : null);
  const starredOnly = $derived(part.type === 'note-list' && part.starredOnly);
  const taskData = useLive<Task[] | Task | null>(
    (listener) => {
      if (!active) return;
      if (taskId !== null) return taskClient.subscribe('taskDetails', { taskId }, listener);
      if (projectId !== null) return taskClient.subscribe('tasks', { projectId }, listener);
    },
    { retainWhenInactive: true },
  );
  const noteData = useLive<Note[] | Note | null>(
    (listener) => {
      if (!active) return;
      if (noteId !== null) return noteClient.subscribe('details', { noteId }, listener);
      if (notesQuery !== null)
        return noteClient.subscribe('matching', { query: notesQuery, starredOnly }, listener);
    },
    { retainWhenInactive: true },
  );
  const taskRows = $derived(
    (Array.isArray(taskData.state.data)
      ? taskData.state.data
      : taskData.state.data
        ? [taskData.state.data]
        : []
    ).filter((t) => {
      const filter = status || (part.type === 'task-list' ? part.status : 'all');
      return (
        (filter === 'all' || t.done === (filter === 'done')) &&
        t.title.toLowerCase().includes(search.toLowerCase())
      );
    }),
  );
  const noteRows = $derived(
    (Array.isArray(noteData.state.data)
      ? noteData.state.data
      : noteData.state.data
        ? [noteData.state.data]
        : []
    ).filter((n) => `${n.title} ${n.body}`.toLowerCase().includes(search.toLowerCase())),
  );
  const currentState = $derived(isTask ? taskData.state : noteData.state);
  const isList = $derived(part.type === 'task-list' || part.type === 'note-list');
  let heldHeight = $state(0);
  onMount(() => {
    const size = new ResizeObserver(() => {
      if (active) heldHeight = root.getBoundingClientRect().height;
    });
    size.observe(root);
    const observer = new IntersectionObserver(
      (entries) => {
        active = entries[0]?.isIntersecting ?? false;
      },
      { rootMargin: '300px' },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      size.disconnect();
    };
  });
</script>

<section
  bind:this={root!}
  style:min-height={!active && heldHeight ? `${heldHeight}px` : undefined}
  class="chat-attachment mt-3 min-w-0 rounded-xl border bg-card p-3 text-card-foreground shadow-xs"
  aria-label={isTask ? 'Live tasks' : 'Live notes'}
>
  <div class="mb-3 flex items-center gap-2 text-xs font-medium">
    {#if isTask}<CheckSquare class="size-3.5 text-primary" />{:else}<NotebookPen
        class="size-3.5 text-primary"
      />{/if}{isTask ? 'Tasks' : 'Notes'}<Badge
      variant="outline"
      class="ml-auto gap-1 text-[10px] font-normal"
    >
      <span
        class={`size-1 rounded-full ${active && currentState.status === 'live' ? 'bg-emerald-500' : 'bg-amber-500'}`}
      ></span>
      {!active
        ? 'Paused'
        : currentState.status === 'live'
          ? 'Live'
          : currentState.status === 'reconnecting'
            ? 'Reconnecting'
            : 'Connecting'}
    </Badge>
  </div>
  {#if isList}<div class="mb-3 flex flex-wrap items-center gap-2">
      <Input
        type="search"
        class="h-8 min-w-28 flex-1 text-xs"
        aria-label={isTask ? 'Filter attached tasks' : 'Filter attached notes'}
        placeholder={isTask ? 'Filter tasks…' : 'Filter notes…'}
        bind:value={search}
      />{#if part.type === 'task-list'}<Tabs.Root
          value={status || part.status}
          onValueChange={(value) => (status = value)}
        >
          <Tabs.List class="h-8">
            <Tabs.Trigger value="all" class="text-xs">All</Tabs.Trigger><Tabs.Trigger
              value="open"
              class="text-xs"
            >
              Open
            </Tabs.Trigger><Tabs.Trigger value="done" class="text-xs">Done</Tabs.Trigger>
          </Tabs.List>
        </Tabs.Root>{/if}
    </div>{/if}
  {#if currentState.status === 'error'}<p role="alert" class="text-xs text-destructive">
      {currentState.error?.message}
    </p>{:else if currentState.data === undefined}<p class="py-3 text-xs text-muted-foreground">
      {active ? 'Loading live data…' : 'Live preview loads when visible.'}
    </p>{:else if isTask}{#if !taskRows.length}<p class="py-3 text-xs text-muted-foreground">
        {isList ? 'No matching tasks.' : 'This task is unavailable.'}
      </p>{:else}<div class="max-h-80 overflow-y-auto rounded-md border">
        {#each taskRows as task (task.id)}<TaskItem {task} client={taskClient} {userId} />{/each}
      </div>{/if}{:else}{#if !noteRows.length}<p class="py-3 text-xs text-muted-foreground">
        {isList ? 'No matching notes.' : 'This note is unavailable.'}
      </p>{:else}<div class="grid max-h-96 items-start gap-2 overflow-y-auto">
        {#each noteRows as note (note.id)}<NoteCard {note} client={noteClient} />{/each}
      </div>{/if}{/if}
</section>
