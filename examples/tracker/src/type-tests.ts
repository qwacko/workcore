import { createClient, createFetchTransport } from '@workcore/client';
import { superjsonCodec } from '@workcore/codec-superjson';
import { defineWorkspace } from '@workcore/core';
import { z } from 'zod';
import { tracker, type TrackerContext } from './app.js';

const client = createClient<typeof tracker>({ transport: createFetchTransport({ codec: superjsonCodec() }), applicationId: 'tracker', workspaceId: 'personal-alice' });
const trackerCollectionEditor: keyof typeof tracker.mutations = tracker.queries.activities.views!.variants.basic!.collection!.editor!.mutation;
void trackerCollectionEditor;
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

type SendHandlerArgs = Parameters<typeof tracker.mutations.sendAssistantMessage.handler>[0];
function verifyAgentCallTypes(operations: SendHandlerArgs['operations']) {
  void operations.enqueueAgent('milo', { conversationId: 'conversation', assistantMessageId: 'message', userMessage: 'hello' });
  // @ts-expect-error Agent enqueue inputs come from that agent's input schema.
  void operations.enqueueAgent('milo', { conversationId: 1 });
  // @ts-expect-error Agent names are checked against the workspace definition.
  void operations.enqueueAgent('missing', {});
}
void verifyAgentCallTypes;

const typedAgentDefinition = defineWorkspace<TrackerContext>()({
  id: 'typed-agent-definition',
  mutations: { finish: { input: z.object({}), output: z.object({ ok: z.boolean() }), handler: () => ({ ok: true }) } },
  agents: {
    inspect: {
      input: z.object({ question: z.string() }),
      model: 'test/model',
      instructions: 'Answer through the finish tool.',
      prompt: ({ input }) => {
        const question: string = input.question;
        // @ts-expect-error Agent callback input is inferred from the declared schema.
        input.missing;
        return question;
      },
      tools: [{ kind: 'mutation', operation: 'finish' }],
      finishWhen: { tool: 'mutation.finish' },
    },
  },
});
void typedAgentDefinition;

defineWorkspace()({
  id: 'invalid-agent-tool-type',
  mutations: { finish: { input: z.object({}), output: z.string(), handler: () => 'done' } },
  agents: {
    invalid: {
      input: z.object({}), model: 'test/model', instructions: '', prompt: () => '',
      // @ts-expect-error Agent tools must reference a declared operation of that kind.
      tools: [{ kind: 'mutation', operation: 'missing' }],
      finishWhen: { tool: 'mutation.finish' },
    },
  },
});

defineWorkspace()({
  id: 'invalid-agent-finish-type',
  mutations: { finish: { input: z.object({}), output: z.string(), handler: () => 'done' } },
  agents: {
    invalid: {
      input: z.object({}), model: 'test/model', instructions: '', prompt: () => '',
      tools: [{ kind: 'mutation', operation: 'finish' }],
      // @ts-expect-error The finishing tool must reference one of the declared operations.
      finishWhen: { tool: 'mutation.missing' },
    },
  },
});

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
      views: { default: 'basic', variants: { basic: {
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

defineWorkspace<TrackerContext>()({
  id: 'invalid-semantic-collection-operation',
  mutations: { save: { input: z.object({ id: z.string() }), output: z.string(), handler: () => 'saved' } },
  queries: { rows: {
    input: z.object({}), output: z.object({ rows: z.array(z.object({ id: z.string() })), nextCursor: z.string().nullable() }),
    views: { default: 'table', variants: { table: { title: 'Rows', renderer: 'table', rowKey: 'id', collection: {
      itemKey: 'id', columns: [],
      // @ts-expect-error Collection editor mutations are checked against this workspace's mutation catalog.
      editor: { mutation: 'missingMutation' },
    } } } },
    handler: () => ({ rows: [], nextCursor: null }),
  } },
});

defineWorkspace<TrackerContext>()({
  id: 'semantic-admin-callback-inference',
  queries: { rows: {
    input: z.object({ limit: z.number(), search: z.string().optional() }),
    output: z.object({ rows: z.array(z.object({ id: z.string() })), nextCursor: z.string().nullable() }),
    views: { default: 'compact', variants: { compact: { title: 'Compact', renderer: 'table', rowKey: 'id', collection: { itemKey: 'id', columns: [] } } } },
    handler: () => ({ rows: [], nextCursor: null }),
  } },
  mutations: { save: { input: z.object({ id: z.string() }), output: z.string(), handler: () => 'saved' } },
  admin: ({ ui, queries, mutations }) => {
    const rows = queries.rows.view('compact', { id: 'rows', input: { limit: 10 } });
    const boundRows = queries.rows.view('compact', { id: 'bound-rows', input: { limit: 10 }, inputBindings: { search: { state: 'term' } } });
    // @ts-expect-error Query handles are inferred from this definition's catalog.
    queries.missing;
    // @ts-expect-error Query callback inputs use the schema's accepted input type.
    queries.rows.view('compact', { id: 'bad-input', input: { limit: 'many' } });
    const overview = ui.page({ title: 'Overview', state: { term: { type: 'text', label: 'Search', default: '' } }, blocks: [rows, boundRows, { id: 'save', type: 'mutation-form', operation: mutations.save.name }] });
    const operationConsole = ui.page({ title: 'Catalog console', layout: 'two-column', blocks: [
      ui.operationCatalog({ id: 'catalog', selection: 'main' }),
      ui.operationExecutor({ id: 'runner', selection: 'main' }),
    ] });
    const invalidReference = ui.page({ title: 'Invalid reference', state: { term: { type: 'text', label: 'Search', default: '' } }, blocks: [
      // @ts-expect-error State references are scoped to the containing page.
      queries.rows.view('compact', { id: 'bad-reference', input: { limit: 10 }, inputBindings: { search: {
        state: 'missing',
      } } }),
    ] });
    return { pages: { overview, operationConsole, invalidReference } };
  },
});

// @ts-expect-error The context factory must match the application definition.
tracker.registerApplication({ createAppContext: async () => ({}) });

// @ts-expect-error A definition with authorization requires an authorization-context resolver.
tracker.registerApplication({ createAppContext: async () => ({ activities: undefined as unknown as TrackerContext['activities'], conversations: undefined as unknown as TrackerContext['conversations'], agentRuns: undefined as unknown as TrackerContext['agentRuns'] }) });

tracker.registerApplication({
  createAppContext: async () => ({ activities: undefined as unknown as TrackerContext['activities'], conversations: undefined as unknown as TrackerContext['conversations'], agentRuns: undefined as unknown as TrackerContext['agentRuns'] }),
  // @ts-expect-error The authorization resolver must return the definition's validated auth context.
  resolveAuthorization: async () => ({ userId: 1, role: 'viewer', isAdmin: false }),
});

// @ts-expect-error Query inputs are inferred from the schema.
void client.query('activities', { limit: 'many' });
// @ts-expect-error Unknown operation names are rejected.
void client.query('missing', {});
