import { describe, expect, it, vi } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createMemoryState, createPlatform, defineApplication, type WorkcoreEvent } from './index.js';

function schema<I, O = I>(validate: (value: unknown) => StandardSchemaV1.Result<O>, json: Record<string, unknown> = { type: 'object' }) {
  return { '~standard': { version: 1 as const, vendor: 'runtime-test', types: undefined as unknown as { input: I; output: O }, validate,
    jsonSchema: { input: vi.fn(() => json), output: vi.fn(() => json) },
  } };
}
const object = schema<Record<string, unknown>>((value) => ({ value: value as Record<string, unknown> }));
const scope = { applicationId: 'runtime', workspaceId: 'one' };
const auth = { authenticate: () => ({ id: 'alice' }), resolveActor: () => ({ id: 'alice' }) };
const state = () => createMemoryState({ workspaces: [{ applicationId: scope.applicationId, id: scope.workspaceId, name: 'One', actors: ['alice'] }] });
const post = (path: string, operation: string, input: unknown = {}) => new Request(`http://localhost/api/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...scope, operation, input }),
});

describe('shared execution boundary', () => {
  it.each(['http', 'sibling', 'task'] as const)('validates transformed values once and disposes after output validation: %s', async (entry) => {
    const services = state();
    const inputValidation = vi.fn((value: unknown) => typeof value === 'string' ? { value: Number(value) } : { issues: [{ message: 'Expected raw string' }] });
    const outputValidation = vi.fn((value: unknown) => typeof value === 'string' ? { value: Number(value) } : { issues: [{ message: 'Expected raw output string' }] });
    const input = schema<string, number>(inputValidation, { type: 'string' });
    const output = schema<string, number>(outputValidation, { type: 'string' });
    const dispose = vi.fn();
    const handler = vi.fn(({ input: value }: { input: number }) => String(value + 1));
    const definition = defineApplication<{ dispose(): void }>()({ id: scope.applicationId,
      queries: {
        value: { input, output, api: true, permission: [], handler },
        sibling: { input: object, output: object, api: true, permission: [], handler: async ({ operations }) => ({ value: await operations.query('value', '41') }) },
      },
      tasks: { value: { input, output, api: true, permission: [], handler } },
    });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({ dispose }) })], auth, services });
    const http = platform.httpHandler({ apiBasePath: '/api' });
    if (entry === 'task') {
      const response = await http(post('enqueue', 'value', '41'));
      expect(response.status).toBe(202);
      expect(inputValidation).toHaveBeenCalledTimes(1);
      expect(dispose).not.toHaveBeenCalled();
      const worker = platform.worker();
      worker.start();
      try { await vi.waitFor(async () => expect((await services.tasks.list(scope, 10))[0]).toMatchObject({ status: 'succeeded', result: 42 })); }
      finally { await worker.stop(); }
    } else {
      const response = await http(post('query', entry === 'http' ? 'value' : 'sibling', entry === 'http' ? '41' : {}));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ result: entry === 'http' ? 42 : { value: 42 } });
    }
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ input: 41 }));
    expect(inputValidation).toHaveBeenCalledTimes(1);
    expect(outputValidation).toHaveBeenCalledTimes(1);
    expect(outputValidation.mock.invocationCallOrder[0]).toBeLessThan(dispose.mock.invocationCallOrder[0]!);
    expect(dispose).toHaveBeenCalledTimes(entry === 'sibling' ? 2 : 1);
  });

  it.each(['http', 'sibling'] as const)('keeps committed mutations successful after event delivery fails: %s', async (entry) => {
    const services = state();
    services.events.publish = vi.fn(async () => { throw new Error('Event service offline'); });
    const changed = vi.fn(() => ({ saved: true }));
    const definition = defineApplication()({ id: scope.applicationId,
      queries: { sibling: { input: object, output: object, api: true, permission: [], handler: async ({ operations }) => operations.mutate('save', {}) } },
      mutations: { save: { input: object, output: object, api: true, permission: [], handler: changed } },
      tasks: { followup: { input: object, output: object, permission: [], triggers: { mutations: ['save'] }, handler: () => ({}) } },
    });
    const enqueue = vi.spyOn(services.tasks, 'enqueue');
    const http = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth, services }).httpHandler({ apiBasePath: '/api' });
    const response = await http(post(entry === 'http' ? 'mutate' : 'query', entry === 'http' ? 'save' : 'sibling'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { saved: true }, ...(entry === 'http' ? { deliveryWarnings: ['EVENT_DELIVERY_FAILED'] } : {}) });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(enqueue).not.toHaveBeenCalled();
    expect((await services.history.list(scope, 10)).find((item) => item.operation === 'save')).toMatchObject({ status: 'delivery_failed' });
  });

  it('records sibling context-creation failures without exposing their details', async () => {
    const services = state();
    const definition = defineApplication()({ id: scope.applicationId, queries: {
      child: { input: object, output: object, permission: [], handler: () => ({}) },
      parent: { input: object, output: object, permission: [], api: true, handler: ({ operations }) => operations.query('child', {}) },
    } });
    const factory = vi.fn().mockReturnValueOnce({}).mockRejectedValueOnce(new Error('private connection details'));
    const http = createPlatform({ applications: [definition.registerApplication({ createAppContext: factory })], auth, services }).httpHandler({ apiBasePath: '/api' });
    const response = await http(post('query', 'parent'));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'EXECUTION_FAILED', message: 'Operation failed' } });
    expect(await services.history.list(scope, 10)).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'child', status: 'failed', error: { code: 'EXECUTION_FAILED', message: 'Operation failed' } }),
      expect.objectContaining({ operation: 'parent', status: 'failed' }),
    ]));
  });

  it.each(['http', 'sibling', 'task'] as const)('records invalid handler output and still disposes the context: %s', async (entry) => {
    const services = state();
    const output = schema<Record<string, unknown>>(() => ({ issues: [{ message: 'Invalid handler output' }] }));
    const dispose = vi.fn();
    const effect = vi.fn(() => ({}));
    const publish = vi.spyOn(services.events, 'publish');
    const definition = defineApplication<{ dispose(): void }>()({ id: scope.applicationId,
      queries: { sibling: { input: object, output: object, api: true, permission: [], handler: ({ operations }) => operations.mutate('invalid', {}) } },
      mutations: { invalid: { input: object, output, api: true, permission: [], handler: effect } },
      tasks: { invalid: { input: object, output, api: true, permission: [], handler: effect } },
    });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({ dispose }) })], auth, services });
    const http = platform.httpHandler({ apiBasePath: '/api' });
    if (entry === 'task') {
      expect((await http(post('enqueue', 'invalid'))).status).toBe(202);
      const worker = platform.worker();
      worker.start();
      try { await vi.waitFor(async () => expect((await services.tasks.list(scope, 10))[0]).toMatchObject({ status: 'failed', error: { code: 'OUTPUT_VALIDATION_FAILED' } })); }
      finally { await worker.stop(); }
    } else {
      const response = await http(post(entry === 'http' ? 'mutate' : 'query', entry === 'http' ? 'invalid' : 'sibling'));
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: 'OUTPUT_VALIDATION_FAILED', message: expect.stringContaining('side effects may already have occurred') } });
    }
    expect(effect).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(entry === 'sibling' ? 2 : 1);
    expect(publish.mock.calls.some(([event]) => event.type === 'mutation.succeeded' || event.type === 'task.succeeded')).toBe(false);
    expect((await services.history.list(scope, 10)).find((item) => item.operation === 'invalid')).toMatchObject({ status: 'failed', error: { code: 'OUTPUT_VALIDATION_FAILED' } });
  });

  it('preserves background provenance through nested synchronous calls without assigning task progress to them', async () => {
    const services = state();
    const events: WorkcoreEvent[] = [];
    services.events.subscribe(scope, (event) => events.push(event));
    const progress = vi.spyOn(services.tasks, 'progress');
    const definition = defineApplication()({ id: scope.applicationId,
      queries: { middle: { input: object, output: object, permission: [], handler: ({ operations }) => operations.mutate('save', {}) } },
      mutations: { save: { input: object, output: object, permission: [], handler: async ({ ctx }) => { await ctx.services.tasks.reportProgress(50); return {}; } } },
      tasks: { parent: { input: object, output: object, permission: [], api: true, handler: async ({ ctx, operations }) => { await ctx.services.tasks.reportProgress(10); return operations.query('middle', {}); } } },
    });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth, services });
    const queued = await (await platform.httpHandler({ apiBasePath: '/api' })(post('enqueue', 'parent'))).json() as { runId: string };
    const worker = platform.worker();
    worker.start();
    try { await vi.waitFor(async () => expect((await services.tasks.list(scope, 10))[0]).toMatchObject({ status: 'succeeded' })); }
    finally { await worker.stop(); }
    expect(events.find((event) => event.type === 'mutation.succeeded')).toMatchObject({ operation: 'save', causationId: queued.runId });
    expect(progress).toHaveBeenCalledExactlyOnceWith(queued.runId, 10);
  });

  it('does not impose the wire codec on internal-only rich results', async () => {
    const date = schema<Date>((value) => ({ value: value as Date }));
    const definition = defineApplication()({ id: scope.applicationId, queries: {
      internal: { input: object, output: date, permission: [], handler: () => new Date('2026-01-01T00:00:00Z') },
      public: { input: object, output: object, permission: [], api: true, handler: async ({ operations }) => ({ year: (await operations.query('internal', {})).getUTCFullYear() }) },
    } });
    const http = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth, services: state() }).httpHandler({ apiBasePath: '/api' });
    expect(await (await http(post('query', 'public'))).json()).toMatchObject({ result: { year: 2026 } });
  });
});

describe('compiled manifest projection', () => {
  it('converts schemas only at setup and takes one fresh authorization snapshot per request', async () => {
    const input = schema<Record<string, unknown>>((value) => ({ value: value as Record<string, unknown> }));
    const authValidation = vi.fn((value: unknown) => ({ value: Number(value) }));
    const authSchema = schema<string, number>(authValidation);
    let allowed = true;
    const check = vi.fn(({ auth: value }: { auth: number }) => value === 1);
    const definition = defineApplication()({ id: scope.applicationId,
      authorization: { context: authSchema, check },
      queries: { one: { input, output: input, permission: 'read', api: true, handler: () => ({}) }, two: { input, output: input, permission: 'read', api: true, handler: () => ({}) } },
    });
    const resolveAuthorization = vi.fn(async () => allowed ? '1' : '0');
    const http = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}), resolveAuthorization })], auth, services: state() }).httpHandler({ apiBasePath: '/api' });
    input['~standard'].jsonSchema.input.mockClear();
    input['~standard'].jsonSchema.output.mockClear();
    const manifest = () => http(new Request('http://localhost/api/manifest?applicationId=runtime&workspaceId=one'));
    expect(await (await manifest()).json()).toMatchObject({ operations: [{ name: 'one' }, { name: 'two' }] });
    expect(resolveAuthorization).toHaveBeenCalledTimes(1);
    expect(authValidation).toHaveBeenCalledTimes(1);
    expect(check.mock.calls).toHaveLength(11); // shared 'read' plus ten built-in capabilities
    allowed = false;
    expect(await (await manifest()).json()).toMatchObject({ operations: [] });
    expect(resolveAuthorization).toHaveBeenCalledTimes(2);
    expect(authValidation).toHaveBeenCalledTimes(2);
    expect(input['~standard'].jsonSchema.input).not.toHaveBeenCalled();
    expect(input['~standard'].jsonSchema.output).not.toHaveBeenCalled();
    expect((await http(post('query', 'one'))).status).toBe(403);
    expect(resolveAuthorization).toHaveBeenCalledTimes(3); // execution never reuses the manifest snapshot
  });
});
