<script lang="ts">
  import type { Task, TaskClient } from './types';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Lock, Users } from '@lucide/svelte';
  let { task, client, userId }: { task: Task; client: TaskClient; userId: string } = $props();
  const checkboxId = $props.id();
  let busy = $state(false),
    error = $state('');
  async function toggle() {
    if (busy) return;
    const current = task;
    busy = true;
    error = '';
    try {
      await client.mutate(current.done ? 'reopenTask' : 'completeTask', {
        id: current.id,
        expectedRevision: current.version,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not update task';
    } finally {
      busy = false;
    }
  }
</script>

<div class="task-item border-b last:border-b-0" data-task-id={task.id}>
  <div class="flex min-h-10 items-center gap-2.5 px-3 py-2">
    <Checkbox
      id={checkboxId}
      checked={task.done}
      disabled={busy || task.ownerId !== userId}
      aria-label={`${task.done ? 'Reopen' : 'Complete'} ${task.title}`}
      onCheckedChange={toggle}
    />
    <label
      for={checkboxId}
      class:line-through={task.done}
      class:text-muted-foreground={task.done}
      class="min-w-0 flex-1 text-sm leading-5 break-words"
    >
      {task.title}
    </label>
    {#if task.private}<Lock
        class="size-3 shrink-0 text-muted-foreground"
        aria-label="Private task"
        role="img"
      />{:else if task.ownerId !== userId}<Users
        class="size-3 shrink-0 text-muted-foreground"
        aria-label="Shared by a teammate"
        role="img"
      />{/if}
  </div>
  {#if error}<p role="alert" class="px-3 pb-2 text-xs text-destructive">{error}</p>{/if}
</div>
