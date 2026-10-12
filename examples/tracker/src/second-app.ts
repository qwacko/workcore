import { defineWorkspace } from '@workcore/core';
import { z } from 'zod';
import { roleCanUseWorkcoreCapability } from './demo-workspaces.js';

type NotesContext = { notebook: { list(workspaceId: string): Promise<Array<{ id: string; text: string }>> } };
const notesAuthorizationContext = z.object({ role: z.enum(['owner', 'viewer']) });
export type NotesAuthorization = z.output<typeof notesAuthorizationContext>;
const input = z.object({});
const output = z.array(z.object({ id: z.string(), text: z.string() }));
export const notes = defineWorkspace<NotesContext>()({
  id: 'notes',
  authorization: {
    context: notesAuthorizationContext,
    check: ({ auth, permission }) => permission === 'notes.read' || (permission.startsWith('workcore.') && roleCanUseWorkcoreCapability(auth.role, permission)),
  },
  queries: {
    notes: {
      input,
      output,
      api: true,
      permission: 'notes.read',
      ui: { default: 'list', variants: { list: { title: 'Notebook', renderer: 'json', subtitle: 'A second application with a different context shape' } } },
      handler: ({ ctx }) => ctx.app.notebook.list(ctx.scope.workspaceId),
    },
  },
});
