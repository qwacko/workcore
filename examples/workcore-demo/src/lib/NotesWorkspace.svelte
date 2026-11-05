<script lang="ts">
  import type { LiveState } from '@workcore/client';
  import type { Note, NotesClient } from './types';
  import NoteCard from './NoteCard.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Plus, Search, Star } from '@lucide/svelte';
  let {
    client,
    notes,
    archive,
  }: {
    client: NotesClient;
    notes: LiveState<Note[]>;
    archive: LiveState<Note[]>;
  } = $props();
  let searchOpen = $state(false);
  let tab = $state('notes'),
    search = $state(''),
    starred = $state(false),
    creating = $state(false);
  const current = $derived(tab === 'archive' ? archive : notes);
  const visible = $derived(
    (current.data ?? []).filter(
      (n) =>
        (!starred || n.starred) &&
        `${n.title} ${n.body}`.toLowerCase().includes(search.toLowerCase()),
    ),
  );
</script>

<section class="flex min-h-0 flex-1 flex-col" aria-label="Notes workspace">
  <h1 class="sr-only">Notes</h1>
  <div class="flex h-12 shrink-0 items-center gap-2 border-b bg-card px-3">
    <Tabs.Root bind:value={tab}>
      <Tabs.List class="h-8">
        <Tabs.Trigger value="notes" class="text-xs">Notes</Tabs.Trigger><Tabs.Trigger
          value="archive"
          class="text-xs"
        >
          Archive
        </Tabs.Trigger>
      </Tabs.List>
    </Tabs.Root>
    <span class="mr-auto text-xs tabular-nums text-muted-foreground">{visible.length}</span>
    <div class="relative hidden min-w-0 sm:block sm:w-52">
      <Search
        class="pointer-events-none absolute top-2 left-2 size-3.5 text-muted-foreground"
      /><Input
        type="search"
        class="h-8 pl-7 text-xs"
        bind:value={search}
        aria-label="Search notes"
        placeholder="Search notes…"
      />
    </div>
    <Button
      variant={searchOpen ? 'secondary' : 'ghost'}
      size="icon-sm"
      class="size-8 sm:hidden"
      aria-label="Search notes"
      aria-pressed={searchOpen}
      onclick={() => {
        searchOpen = !searchOpen;
        if (!searchOpen) search = '';
      }}
    >
      <Search class="size-4" />
    </Button>
    <Button
      size="icon-sm"
      class="size-8"
      variant={starred ? 'secondary' : 'ghost'}
      aria-label="Starred notes only"
      aria-pressed={starred}
      onclick={() => (starred = !starred)}
    >
      <Star class="size-4" />
    </Button>
    <Button size="sm" class="h-8 px-2" aria-label="New note" onclick={() => (creating = true)}>
      <Plus class="size-4" />
      <span class="hidden sm:inline">New note</span>
    </Button>
  </div>
  {#if searchOpen}<div class="shrink-0 border-b bg-card px-3 pb-2 sm:hidden">
      <Input
        type="search"
        class="h-8 text-sm"
        bind:value={search}
        aria-label="Search notes"
        placeholder="Search notes…"
      />
    </div>{/if}
  <div class="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">
    {#if current.status === 'error'}<p role="alert" class="text-destructive">
        {current.error?.message}
      </p>{:else if !current.data}<p class="text-muted-foreground">
        Loading notes…
      </p>{:else if !visible.length}<div
        class="rounded-lg border border-dashed p-10 text-center text-muted-foreground"
      >
        No notes here. Capture an idea or change your filters.
      </div>{:else}<div
        class="grid items-start gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      >
        {#each visible as note (note.id)}<NoteCard {note} {client} />{/each}
      </div>{/if}
  </div>
</section>
<NoteEditor {client} bind:open={creating} />
