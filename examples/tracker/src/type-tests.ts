import { createClient, createFetchTransport } from '@workcore/client';
import { superjsonCodec } from '@workcore/codec-superjson';
import { registerApplication } from '@workcore/core';
import { tracker } from './app.js';

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
}
void verifySiblingOperationTypes;

// @ts-expect-error The context factory must match the application definition.
registerApplication({ definition: tracker, createAppContext: async () => ({}) });

// @ts-expect-error Query inputs are inferred from the schema.
void client.query('activities', { limit: 'many' });
// @ts-expect-error Unknown operation names are rejected.
void client.query('missing', {});
