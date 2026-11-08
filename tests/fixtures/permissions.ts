import { z } from 'zod';
import { tracker } from '../../examples/workcore-demo/src/app.js';
import type { MutationContext, ReadContext } from '../../packages/core/src/index.js';

// Test-only policy controls around the existing todo application. No teams,
// enrollment or extra application tables are required to exercise revocation.
const permissionsInput = z.object({ actorId: z.string(), inspectAll: z.boolean(), revoked: z.boolean() });
export const permissionsDefinition = {
  ...tracker,
  mutations: {
    ...tracker.mutations,
    setPermissions: {
      input: permissionsInput, output: z.null(), triggers: [],
      handler: ({ kv }: MutationContext<any>, input: z.infer<typeof permissionsInput>) => {
        kv.set(`inspectAll:${input.actorId}`, input.inspectAll);
        kv.set(`revoked:${input.actorId}`, input.revoked);
        return null;
      },
    },
  },
  authorize: (context: ReadContext<any>, action: string) => {
    if (context.kv.get(`revoked:${context.actor.id}`) === true) return false;
    if (action === 'mutation:setPermissions') return context.actor.id === 'alice';
    if (action === '$admin') return context.actor.id === 'alice' || context.kv.get(`inspectAll:${context.actor.id}`) === true;
    return tracker.authorize(context, action);
  },
};
