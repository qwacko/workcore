import { createClient } from '@workcore/client';
import { encodeJson, type Actor } from '@workcore/core';
import { externalTool } from '@workcore/ai';
import { notesApp } from './notes.js';
import type { Env } from './app.js';

/** Explicit application adapter: fixed namespace, authenticated actor, typed operations. */
export function notesAgentClient(env: Env, actor: Actor) {
  const stub = env.NOTES.get(env.NOTES.idFromName('notes'));
  return createClient<typeof notesApp>({
    baseUrl: 'https://notes.internal',
    fetch: (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set(
        'x-workcore-session',
        encodeURIComponent(
          encodeJson({
            actor: { id: actor.id },
            expiresAt: Date.now() + 60_000,
          }),
        ),
      );
      return stub.fetch(new Request(url, { ...init, headers }));
    },
  });
}

export function notesAgentTools(client: () => ReturnType<typeof notesAgentClient>) {
  return {
    listNotes: externalTool({
      description: 'Find private notes matching a query. Read IDs and revisions before editing.',
      inputSchema: notesApp.views.matching.input,
      execute: async (input) => (await client().query('matching', input)).data,
    }),
    getNote: externalTool({
      description: 'Read a private note and its current revision.',
      inputSchema: notesApp.views.details.input,
      execute: async (input) => (await client().query('details', input)).data,
    }),
    createNote: externalTool({
      description: 'Create a private note only when explicitly requested.',
      inputSchema: notesApp.mutations.create.input,
      execute: async (input) => (await client().mutate('create', input)).data,
    }),
    updateNote: externalTool({
      description:
        'Edit, star or archive a private note only when requested. Use its current revision and preserve fields the user did not ask to change.',
      inputSchema: notesApp.mutations.update.input,
      execute: async (input) => (await client().mutate('update', input)).data,
    }),
  };
}
