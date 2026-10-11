import { defineWorkspace } from '@workcore/core';
import { z } from 'zod';

type NotesContext = { notebook: { list(workspaceId: string): Promise<Array<{ id: string; text: string }>> } };
const input = z.object({});
const output = z.array(z.object({ id: z.string(), text: z.string() }));
const defineNotes = defineWorkspace<NotesContext>();

export const notes = defineNotes({
  id: 'notes',
  queries: {
    notes: defineNotes.query({
      input,
      output,
      api: true,
      permission: 'notes.read',
      ui: { default: 'list', variants: { list: { title: 'Notebook', renderer: 'json', subtitle: 'A second application with a different context shape' } } },
      handler: ({ ctx }) => ctx.app.notebook.list(ctx.scope.workspaceId),
    }),
  },
});
