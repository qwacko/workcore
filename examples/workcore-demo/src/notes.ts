import { and, desc, eq } from 'drizzle-orm';
import { field, workspace, WorkcoreError } from '@workcore/core';
import { z } from 'zod';
import { defineSchema, idColumn, timestampColumns, versionColumn } from '@workcore/core';
import { notes } from './schema.js';
import baseMigrations from './migrations.js';
import type { Env } from './app.js';

const schema = defineSchema({ notes });
const migrations = {
  migrations: { ...baseMigrations.migrations,
    [`m${baseMigrations.journal.entries.length.toString().padStart(4, '0')}`]: 'CREATE TABLE IF NOT EXISTS notes (id text PRIMARY KEY NOT NULL, version integer DEFAULT 1 NOT NULL, created_at integer NOT NULL, updated_at integer NOT NULL, title text NOT NULL, body text NOT NULL, owner_id text NOT NULL);--> statement-breakpoint\nCREATE INDEX IF NOT EXISTS notes_owner_updated ON notes(owner_id, updated_at, id);',
    [`m${(baseMigrations.journal.entries.length + 1).toString().padStart(4, '0')}`]: 'ALTER TABLE notes ADD COLUMN starred integer NOT NULL DEFAULT false;--> statement-breakpoint\nALTER TABLE notes ADD COLUMN archived integer NOT NULL DEFAULT false;'
  },
  journal: { ...baseMigrations.journal, entries: [...baseMigrations.journal.entries,
    { idx: baseMigrations.journal.entries.length, when: Math.max(...baseMigrations.journal.entries.map(entry => entry.when)) + 1, tag: 'notes_workspace', breakpoints: true },
    { idx: baseMigrations.journal.entries.length + 1, when: Math.max(...baseMigrations.journal.entries.map(entry => entry.when)) + 2, tag: 'notes_features', breakpoints: true },
  ] },
};
const app = workspace<typeof schema, Env, readonly ['notes']>(schema, migrations, { triggerKeys: ['notes'] });
const note = z.object({ id: z.string(), version: z.number(), title: z.string(), body: z.string(), ownerId: z.string(), createdAt: z.number(), updatedAt: z.number(), starred: z.boolean(), archived: z.boolean() });
const list = app.view({ input: z.object({}), output: z.array(note), dependsOn: ['notes'], maxRows: 200,
  handler: ({ db, actor }) => db.select().from(notes).where(and(eq(notes.ownerId, actor.id), eq(notes.archived, false))).orderBy(desc(notes.starred), desc(notes.updatedAt), desc(notes.id)).limit(200).all(),
  ui: { label: 'My notes', presentation: 'table' },
});
const archived = app.view({ input: z.object({}), output: z.array(note), dependsOn: ['notes'], maxRows: 200,
  handler: ({ db, actor }) => db.select().from(notes).where(and(eq(notes.ownerId, actor.id), eq(notes.archived, true))).orderBy(desc(notes.updatedAt), desc(notes.id)).limit(200).all(),
  ui: { label: 'Archived notes', presentation: 'table' },
});
const create = app.mutation({ input: z.object({ title: field(z.string().min(1).max(160), { label: 'Title' }), body: field(z.string().max(20_000), { label: 'Note', control: 'textarea' }) }), output: note,
  triggers: ['notes'], ui: { label: 'Write a note', submitLabel: 'Save note' },
  handler: ({ db, actor, now }, input) => db.insert(notes).values({ id: crypto.randomUUID(), ...input, ownerId: actor.id, starred: false, archived: false, version: 1, createdAt: now, updatedAt: now }).returning().get(),
});
const update = app.mutation({ input: z.object({ id: z.string(), expectedRevision: z.number().int(), title: z.string().min(1).max(160), body: z.string().max(20_000), starred: z.boolean(), archived: z.boolean() }), output: note,
  triggers: ['notes'], ui: { label: 'Update note', submitLabel: 'Save note' },
  handler: ({ db, actor, now }, input) => {
    const { id, expectedRevision, ...values } = input;
    const row = db.update(notes).set({ ...values, version: expectedRevision + 1, updatedAt: now }).where(and(eq(notes.id, id), eq(notes.ownerId, actor.id), eq(notes.version, expectedRevision))).returning().get();
    if (!row) throw new WorkcoreError('CONFLICT', 'Note changed or not found', 409);
    return row;
  },
});
const remove = app.mutation({ input: z.object({ id: z.string(), expectedRevision: z.number().int() }), output: z.null(), triggers: ['notes'], ui: { label: 'Delete note' },
  handler: ({ db, actor }, input) => { const row = db.delete(notes).where(and(eq(notes.id, input.id), eq(notes.ownerId, actor.id), eq(notes.version, input.expectedRevision))).returning().get(); if (!row) throw new WorkcoreError('NOT_FOUND', 'Note changed or not found', 404); return null; },
});
export const notesApp = app.define({ views: { list, archived }, queries: {}, mutations: { create, update, remove }, jobs: {}, authorize: (_ctx, action) => action !== '$admin' });
