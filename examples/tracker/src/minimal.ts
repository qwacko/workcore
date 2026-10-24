import { createPlatform, createMemoryState, defineApplication, type Scope } from '@workcore/core';
import { createClient, createFetchTransport } from '@workcore/client';
import { z } from 'zod';

/** A small, single-process integration; authentication and storage remain host-owned. */
export function createMinimalExample(token: string) {
  if (!token) throw new Error('Supply a private API token');
  const counts = new Map<string, number>();
  const key = (scope: Scope) => JSON.stringify([scope.applicationId, scope.workspaceId]);
  const repository = {
    get: (scope: Scope) => counts.get(key(scope)) ?? 0,
    add: (scope: Scope, amount: number) => {
      const value = repository.get(scope) + amount;
      counts.set(key(scope), value);
      return value;
    },
  };
  const counter = defineApplication<{ counter: typeof repository }>()({
    id: 'counter',
    queries: {
      count: {
        input: z.object({}), output: z.number().int(),
        permission: 'counter.read', api: true,
        handler: ({ ctx }) => ctx.app.counter.get(ctx.scope),
      },
    },
    mutations: {
      add: {
        input: z.object({ amount: z.number().int().min(1).max(100) }), output: z.number().int(),
        permission: 'counter.write', api: true,
        handler: ({ ctx, input }) => ctx.app.counter.add(ctx.scope, input.amount),
      },
    },
  });
  const platform = createPlatform({
    applications: [counter.registerApplication({ createAppContext: () => ({ counter: repository }) })],
    auth: { authenticate: (request) => request.headers.get('authorization') === `Bearer ${token}` ? { id: 'demo' } : null },
    services: createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'My workspace', actors: ['demo'] }] }),
    authorise: ({ actor, permission }) => actor.id === 'demo' && ['counter.read', 'counter.write'].includes(permission),
  });
  const handle = platform.httpHandler();
  const client = createClient<typeof counter>({
    applicationId: counter.id, workspaceId: 'one',
    transport: createFetchTransport({
      baseUrl: 'http://localhost/workcore/api',
      headers: { authorization: `Bearer ${token}` },
      // In-process fetch makes the example testable without starting a server.
      // For a real HTTP client, omit this and set baseUrl to the server URL.
      fetch: (url, init) => handle(new Request(url, init)),
    }),
  });
  return { counter, platform, handle, client };
}
