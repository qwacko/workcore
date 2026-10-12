import { createClient, createFetchTransport } from '@workcore/client';
import { superjsonCodec } from '@workcore/codec-superjson';
import { defineWorkspace } from '@workcore/core';
import { z } from 'zod';
import { tracker, type TrackerContext } from './app.js';

const client = createClient<typeof tracker>({ transport: createFetchTransport({ codec: superjsonCodec() }), applicationId: 'tracker', workspaceId: 'personal-alice' });
void client.query('activities', { limit: 10 });
void client.query('activities', { limit: 10 }).then((page) => {
  const firstId: string | undefined = page.rows[0]?.id;
  const updatedAt: Date | undefined = page.rows[0]?.updatedAt;
  void firstId;
  void updatedAt;
  // @ts-expect-error Result types come from the declared output schema.
  const invalidId: number | undefined = page.rows[0]?.id;
  void invalidId;
});
void client.mutate('editActivity', { id: 'run-001', title: 'Run', status: 'complete' });
void client.enqueue('refreshSummary', {});
void client.query('dateRoundTrip', { at: new Date() }).then((value) => {
  const result: Date = value;
  void result;
  // @ts-expect-error A Zod date remains a Date in the typed client, not an ISO string.
  const invalid: string = value;
  void invalid;
});

type RefreshHandlerArgs = Parameters<typeof tracker.tasks.refreshSummary.handler>[0];
function verifySiblingOperationTypes(operations: RefreshHandlerArgs['operations']) {
  // @ts-expect-error Internal sibling operation names are inferred from the definition.
  void operations.query('missing', {});
  // @ts-expect-error Internal sibling operation inputs are schema checked.
  void operations.query('activities', { limit: 'many' });
  void operations.enqueue('refreshSummary', {});
  // @ts-expect-error Task-to-task calls are inferred from the same definition.
  void operations.enqueue('missingTask', {});
}
void verifySiblingOperationTypes;

const peerTasks = defineWorkspace<TrackerContext>()({
  id: 'peer-task-types',
  mutations: {
    adjust: {
      input: z.object({ count: z.number() }),
      output: z.string(),
      handler: ({ input }) => String(input.count),
    },
  },
  tasks: {
    launch: {
      input: z.object({}),
      output: z.string(),
      triggers: {
        mutations: ['adjust'],
        mapInput: (event) => {
          const mutationName: 'adjust' = event.operation;
          void mutationName;
          return {};
        },
      },
      handler: async ({ operations }) => {
        await operations.mutate('adjust', { count: 1 });
        await operations.enqueue('rebuild', { count: 1 });
        // @ts-expect-error Peer task inputs are inferred from their schema.
        await operations.enqueue('rebuild', { count: 'one' });
        // @ts-expect-error Unknown task names are rejected.
        await operations.enqueue('missing', {});
        return 'queued';
      },
    },
    rebuild: {
      input: z.object({ count: z.number() }),
      output: z.string(),
      handler: ({ input }) => `rebuilt ${input.count}`,
    },
  },
});
void peerTasks;

const inferredAuthorization = defineWorkspace<TrackerContext>()({
  id: 'inferred-authorization',
  authorization: {
    context: z.object({ role: z.enum(['owner', 'viewer']) }),
    check: ({ auth }) => {
      const role: 'owner' | 'viewer' = auth.role;
      void role;
      // @ts-expect-error The checker auth type comes from the context schema output.
      auth.isAdmin;
      return auth.role === 'owner';
    },
  },
});
void inferredAuthorization;

defineWorkspace<TrackerContext>()({
  id: 'invalid-trigger-type',
  mutations: {
    adjust: { input: z.object({}), output: z.string(), handler: () => 'ok' },
  },
  tasks: {
    task: {
      input: z.object({}),
      output: z.string(),
      triggers: {
        // @ts-expect-error Trigger names must be declared mutations.
        mutations: ['notAMutation'],
      },
      handler: () => 'ok',
    },
  },
});

defineWorkspace<TrackerContext>()({
  id: 'invalid-ui-action-type',
  mutations: {
    edit: { input: z.object({ id: z.string() }), output: z.string(), handler: () => 'ok' },
  },
  queries: {
    read: {
      input: z.object({}),
      output: z.string(),
      ui: { default: 'basic', variants: { basic: {
        title: 'Read', renderer: 'json',
        actions: [
          { label: 'Bad action',
            // @ts-expect-error UI action targets must be declared mutations.
            mutation: 'missingMutation',
          },
          { label: 'Bad binding', mutation: 'edit', bind: {
            // @ts-expect-error Binding keys must exist on the target mutation input.
            missingField: { fromRow: 'id' },
          } },
        ],
      } } },
      handler: () => 'ok',
    },
  },
});

// @ts-expect-error The context factory must match the application definition.
tracker.registerApplication({ createAppContext: async () => ({}) });

// @ts-expect-error A definition with authorization requires an authorization-context resolver.
tracker.registerApplication({ createAppContext: async () => ({ activities: undefined as unknown as TrackerContext['activities'] }) });

tracker.registerApplication({
  createAppContext: async () => ({ activities: undefined as unknown as TrackerContext['activities'] }),
  // @ts-expect-error The authorization resolver must return the definition's validated auth context.
  resolveAuthorization: async () => ({ userId: 1, role: 'viewer', isAdmin: false }),
});

// @ts-expect-error Query inputs are inferred from the schema.
void client.query('activities', { limit: 'many' });
// @ts-expect-error Unknown operation names are rejected.
void client.query('missing', {});
