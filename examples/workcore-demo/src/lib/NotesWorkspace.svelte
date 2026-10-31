<script lang="ts">
  import { createClient, type LiveState } from '@workcore/client';
  import type { notesApp } from '../notes.js';
  import type { z } from 'zod';
  type Note = z.output<typeof notesApp.views.list.output>[number];
  type Props = { client: ReturnType<typeof createClient<typeof notesApp>>; notes: LiveState<Note[]>; archive: LiveState<Note[]>; busy: boolean; onerror: (message: string) => void };
  let { client, notes, archive, busy, onerror }: Props = $props();
  let archived = $state(false), search = $state(''), title = $state(''), body = $state(''), editing = $state<Note | null>(null);
  let saving = $state(false);
  let current = $derived(archived ? archive : notes);
  let visible = $derived((current.data ?? []).filter(n => `${n.title} ${n.body}`.toLowerCase().includes(search.toLowerCase())));
  async function mutate(fn: () => Promise<unknown>) { saving = true; try { await fn(); } catch (e) { onerror(e instanceof Error ? e.message : 'Something went wrong'); } finally { saving = false; } }
  function save() { const value = title.trim(); if (!value) return; void mutate(async () => { if (editing) await client.mutate('update', { id: editing.id, expectedRevision: editing.version, title: value, body, starred: editing.starred, archived: editing.archived }); else await client.mutate('create', { title: value, body }); cancel(); }); }
  function cancel() { editing = null; title = ''; body = ''; }
  function edit(note: Note) { editing = note; title = note.title; body = note.body; }
  function update(note: Note, changes: Partial<Pick<Note, 'starred' | 'archived'>>) { void mutate(() => client.mutate('update', { id: note.id, expectedRevision: note.version, title: note.title, body: note.body, starred: note.starred, archived: note.archived, ...changes })); }
  function remove(note: Note) { if (confirm('Permanently delete this note?')) void mutate(async () => { await client.mutate('remove', { id: note.id, expectedRevision: note.version }); if (editing?.id === note.id) cancel(); }); }
</script>

<div class="workspace"><aside><div class="panel"><span class="eyebrow">{editing ? 'EDIT NOTE' : 'QUICK CAPTURE'}</span><h2>{editing ? 'Make a change' : 'New note'}</h2><form onsubmit={(e) => { e.preventDefault(); save(); }}><label>Title<input bind:value={title} maxlength="160" required placeholder="Give it a title" /></label><label>Note<textarea bind:value={body} maxlength="20000" rows="8" placeholder="Start writing…"></textarea></label><button class="primary" disabled={busy || saving}>{editing ? 'Save changes' : 'Save note'} <span>↗</span></button>{#if editing}<button type="button" class="link" onclick={cancel}>Cancel editing</button>{/if}</form></div><div class="aside-note">✳ <strong>Just for you</strong><p>Notes are private, synced live and kept in their own workspace.</p></div></aside>
<section class="content"><div class="toolbar"><div><h2>{archived ? 'Archive' : 'Your notes'}</h2><p>{visible.length} notes</p></div><div class="segmented"><button class:selected={!archived} onclick={() => archived = false}>Notes</button><button class:selected={archived} onclick={() => archived = true}>Archive</button></div></div><div class="filters"><input type="search" bind:value={search} placeholder="Search notes" aria-label="Search notes" /></div>
{#if current.status === 'error'}<p class="empty">{current.error?.message}</p>{:else if !current.data}<p class="empty">Loading notes…</p>{:else if !visible.length}<p class="empty">No notes here yet. Capture a thought to get started.</p>{:else}<div class="notes-grid">{#each visible as note (note.id)}<article class="note"><div class="note-head"><h3>{note.title}</h3><button aria-label={note.starred ? 'Unstar note' : 'Star note'} disabled={busy || saving} onclick={() => update(note, { starred: !note.starred })}>{note.starred ? '★' : '☆'}</button></div><p>{note.body || 'No additional text'}</p><small>Updated {new Date(note.updatedAt).toLocaleDateString()}</small><div class="note-actions"><button onclick={() => edit(note)}>Edit</button><button disabled={busy || saving} onclick={() => update(note, { archived: !note.archived })}>{note.archived ? 'Restore' : 'Archive'}</button><button disabled={busy || saving} onclick={() => remove(note)}>Delete</button></div></article>{/each}</div>{/if}
</section></div>
