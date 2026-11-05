<script lang="ts">
  import { untrack } from 'svelte';
  import type { Note, NotesClient } from './types';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Textarea } from '$lib/components/ui/textarea';
  import { Label } from '$lib/components/ui/label';
  import * as Dialog from '$lib/components/ui/dialog';
  let {
    client,
    note,
    open = $bindable(false),
  }: { client: NotesClient; note?: Note; open?: boolean } = $props();
  let title = $state(''),
    body = $state(''),
    busy = $state(false),
    error = $state('');
  let revision = 0,
    id: string | undefined;
  $effect(() => {
    if (open) {
      const current = untrack(() => note);
      title = current?.title ?? '';
      body = current?.body ?? '';
      revision = current?.version ?? 0;
      id = current?.id;
      error = '';
    }
  });
  async function save() {
    if (busy || !title.trim()) return;
    busy = true;
    error = '';
    try {
      if (id)
        await client.mutate('update', {
          id,
          expectedRevision: revision,
          title: title.trim(),
          body,
          starred: note?.starred ?? false,
          archived: note?.archived ?? false,
        });
      else await client.mutate('create', { title: title.trim(), body });
      open = false;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save note';
    } finally {
      busy = false;
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title>{note ? 'Edit note' : 'New note'}</Dialog.Title><Dialog.Description>
        Your changes sync live everywhere this note appears.
      </Dialog.Description>
    </Dialog.Header>
    <form
      class="grid gap-4"
      onsubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div class="grid gap-2">
        <Label for="note-title">Title</Label><Input
          id="note-title"
          bind:value={title}
          required
          maxlength={160}
          disabled={busy}
        />
      </div>
      <div class="grid gap-2">
        <Label for="note-body">Note</Label><Textarea
          id="note-body"
          bind:value={body}
          class="field-sizing-fixed h-52 min-h-32 max-h-[40dvh] resize-y"
          maxlength={20000}
          disabled={busy}
        />
      </div>
      {#if error}<p role="alert" class="text-destructive">
          {error}
        </p>{/if}<Dialog.Footer>
        <Button type="button" variant="outline" disabled={busy} onclick={() => (open = false)}>
          Cancel
        </Button><Button type="submit" disabled={busy || !title.trim()}>
          {busy ? 'Saving…' : 'Save note'}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
