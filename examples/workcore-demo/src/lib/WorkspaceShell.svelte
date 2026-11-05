<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import {
    MessageSquare,
    CheckSquare,
    NotebookPen,
    ArrowUpRight,
    LogOut,
    MoreHorizontal,
    Layers,
  } from '@lucide/svelte';
  let {
    section,
    live,
    userName,
    onsectionchange,
    onsignout,
    children,
  }: {
    section: 'tasks' | 'notes' | 'chat';
    live: boolean;
    userName: string;
    onsectionchange: (value: 'tasks' | 'notes' | 'chat') => void;
    onsignout: () => void;
    children: Snippet;
  } = $props();
  const sections = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare },
    { id: 'notes', label: 'Notes', icon: NotebookPen },
  ] as const;
</script>

<div class="flex h-dvh min-h-0 flex-col overflow-hidden md:flex-row">
  <aside
    class="flex h-12 shrink-0 items-center gap-1 border-b bg-card px-2 md:h-auto md:w-44 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3"
  >
    <div class="flex shrink-0 items-center gap-2 px-1 md:h-14 md:px-2">
      <Layers class="size-5 text-primary" />
      <span class="hidden font-semibold tracking-tight md:inline">workcore</span>
      <span
        role="status"
        class={`size-1.5 rounded-full ${live ? 'bg-emerald-500' : 'bg-amber-500'}`}
        title={live ? 'Live' : 'Connecting'}
      >
        <span class="sr-only">{live ? 'Live' : 'Connecting'}</span>
      </span>
    </div>
    <nav aria-label="Main navigation" class="flex min-w-0 flex-1 gap-1 md:flex-none md:flex-col">
      {#each sections as item}
        <Button
          size="sm"
          variant={section === item.id ? 'secondary' : 'ghost'}
          class="h-8 flex-1 gap-1.5 px-3 md:justify-start"
          aria-current={section === item.id ? 'page' : undefined}
          onclick={() => onsectionchange(item.id)}
        >
          <item.icon class="hidden size-3.5 sm:block" />{item.label}
        </Button>
      {/each}
    </nav>
    <div class="md:mt-auto md:border-t md:py-3">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class="inline-flex size-8 items-center justify-center rounded-md hover:bg-accent md:w-full md:justify-between md:px-2"
          aria-label="Workspace menu"
        >
          <span class="hidden truncate text-xs text-muted-foreground md:block">{userName}</span>
          <MoreHorizontal class="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end">
          <DropdownMenu.Item
            onSelect={() => location.assign(`/admin/${section === 'notes' ? 'notes' : 'demo'}`)}
          >
            <ArrowUpRight class="size-4" />Admin
          </DropdownMenu.Item>
          <DropdownMenu.Item onclick={onsignout}>
            <LogOut class="size-4" />Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>
  </aside>
  <main class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{@render children()}</main>
</div>
