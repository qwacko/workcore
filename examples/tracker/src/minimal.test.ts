import { expect, it } from 'vitest';
import { createMinimalExample } from './minimal.js';
import { createMemoryState, createPlatform, defineApplication } from '@workcore/core';
import { createClient, createFetchTransport } from '@workcore/client';
import { z } from 'zod';

it('runs the documented minimal integration through the real transport and HTTP boundary', async () => {
  const { client, handle } = createMinimalExample('test-only-secret');
  expect(await client.query('count', {})).toBe(0);
  expect(await client.mutate('add', { amount: 2 })).toBe(2);
  expect(await client.queryDetailed('count', {})).toMatchObject({ result: 2, executionId: expect.any(String), correlationId: expect.any(String) });
  expect(await client.queryDetailed('count', {}, { correlationId: 'minimal-correlation' })).toMatchObject({ result: 2, correlationId: 'minimal-correlation' });
  expect((await handle(new Request('http://localhost/workcore/api/applications'))).status).toBe(401);
  await expect(client.mutate('add', { amount: 0 })).rejects.toMatchObject({ code: 'VALIDATION_FAILED', issues: [{ path: ['amount'], message: expect.any(String) }], correlationId: expect.any(String) });
});

it('runs the documented Zod transform boundary and emits its validated output schema', async () => {
  const definition = defineApplication()({ id: 'transforms', queries: { read: {
    input: z.object({ amount: z.string().transform(Number) }),
    output: z.string().transform(Number).pipe(z.number()),
    api: true, permission: [], handler: ({ input }) => String(input.amount + 1),
  } } });
  const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth: { authenticate: () => ({ id: 'demo' }) }, services: createMemoryState({ workspaces: [{ applicationId: definition.id, id: 'one', name: 'One', actors: ['demo'] }] }) });
  const handle = platform.httpHandler();
  const transport = createFetchTransport({ baseUrl: 'http://localhost/workcore/api', fetch: (url, init) => handle(new Request(url, init)) });
  const client = createClient<typeof definition>({ transport, applicationId: definition.id, workspaceId: 'one' });
  const result: number = await client.query('read', { amount: '41' });
  expect(result).toBe(42);
  expect((await transport.manifest(definition.id, 'one')).operations[0]?.output).toMatchObject({ type: 'number' });
});
