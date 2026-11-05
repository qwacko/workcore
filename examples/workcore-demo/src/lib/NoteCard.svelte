<script lang="ts">
  import type { Note, NotesClient } from './types';
  import NoteEditor from './NoteEditor.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Star, MoreHorizontal, Pencil, Archive, Trash2 } from '@lucide/svelte';
  let { note, client }: { note: Note; client: NotesClient } = $props();
  let reading = $state(false);
  let editing = $state(false),
    deleting = $state(false),
    busy = $state(false),
    error = $state('');
  async function update(changes: Partial<Pick<Note, 'starred' | 'archived'>>) {
    if (busy) return;
    busy = true;
    error = '';
    const current = note;
    try {
      await client.mutate('update', {
        id: current.id,
        expectedRevision: current.version,
        title: current.title,
        body: current.body,
        starred: current.starred,
        archived: current.archived,
        ...changes,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not update note';
    } finally {
      busy = false;
    }
  }
  async function remove() {
    busy = true;
    error = '';
    try {
      await client.mutate('remove', {
        id: note.id,
        expectedRevision: note.version,
      });
      deleting = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not delete note';
    } finally {
      busy = false;
    }
  }
</script>

<article
  class="note-card flex min-w-0 flex-col rounded-lg border bg-card p-3"
  data-note-id={note.id}
>
  <div class="flex items-start gap-2">
    <h3 class="min-w-0 flex-1 text-sm font-semibold">
      <button
        class="block w-full truncate text-left hover:text-primary"
        title={note.title}
        onclick={() => (reading = true)}
      >
        {note.title}
      </button>
    </h3>
    <Button
      variant="ghost"
      size="icon-sm"
      class="-mt-1 size-7 shrink-0"
      aria-label={note.starred ? 'Unstar note' : 'Star note'}
      disabled={busy}
      onclick={() => update({ starred: !note.starred })}
    >
      <Star
        class={`size-3.5 ${note.starred ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground'}`}
      />
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Actions for ${note.title}`}
        class="-mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent"
      >
        <MoreHorizontal class="size-4" />
      </DropdownMenu.Trigger><DropdownMenu.Content align="end">
        <DropdownMenu.Item onclick={() => (editing = true)}>
          <Pencil class="size-4" />Edit
        </DropdownMenu.Item><DropdownMenu.Item
          disabled={busy}
          onclick={() => update({ archived: !note.archived })}
        >
          <Archive class="size-4" />{note.archived ? 'Restore' : 'Archive'}
        </DropdownMenu.Item><DropdownMenu.Separator /><DropdownMenu.Item
          variant="destructive"
          onclick={() => (deleting = true)}
        >
          <Trash2 class="size-4" />Delete
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
  <button
    class="mt-1 line-clamp-2 text-left text-sm leading-5 break-words text-muted-foreground"
    aria-label={`Read ${note.title}`}
    onclick={() => (reading = true)}
  >
    {note.body.replace(/\s+/g, ' ').trim() || 'No additional text'}
  </button>
  {#if error}<p role="alert" class="mt-2 text-xs text-destructive">
      {error}
    </p>{/if}
</article>
<Dialog.Root bind:open={reading}>
  <Dialog.Content class="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{note.title}</Dialog.Title><Dialog.Description>
        {note.archived ? 'Archived · ' : ''}Updated {new Date(note.updatedAt).toLocaleDateString()}
      </Dialog.Description>
    </Dialog.Header>
    <p
      class="min-h-0 max-h-[60dvh] overflow-y-auto text-sm leading-6 whitespace-pre-wrap break-words"
    >
      {note.body || 'No additional text'}
    </p>
    <Dialog.Footer>
      <Button variant="outline" onclick={() => (reading = false)}>Close</Button><Button
        onclick={() => {
          reading = false;
          editing = true;
        }}
      >
        Edit note
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
<NoteEditor {client} {note} bind:open={editing} />
<Dialog.Root bind:open={deleting}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Delete this note?</Dialog.Title><Dialog.Description>
        “{note.title}” will be permanently deleted.
      </Dialog.Description>
    </Dialog.Header>{#if error}<p role="alert" class="text-destructive">
        {error}
      </p>{/if}<Dialog.Footer>
      <Button variant="outline" disabled={busy} onclick={() => (deleting = false)}>
        Cancel
      </Button><Button variant="destructive" disabled={busy} onclick={remove}>Delete note</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
