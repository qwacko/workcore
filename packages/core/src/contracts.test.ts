import { describe, expect, it, vi } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { createMemoryState, createPlatform, defineApplication, defineWorkspace, type PlatformOptions, type TaskPayload } from './index.js';

function schema<I, O = I>(validate: (value: unknown) => StandardSchemaV1.Result<O>, input: Record<string, unknown> = {}, output = input) {
  return { '~standard': { version: 1 as const, vendor: 'contracts-test', types: undefined as unknown as { input: I; output: O }, validate, jsonSchema: { input: () => input, output: () => output } } };
}
const object = schema<Record<string, unknown>>((value) => ({ value: value as Record<string, unknown> }), { type: 'object' });
const numericText = schema<string, number>((value) => typeof value === 'string' ? { value: Number(value) } : { issues: [{ message: 'Expected numeric text' }] }, { type: 'string' }, { type: 'number' });
const scope = { applicationId: 'contracts', workspaceId: 'one' };
const state = () => createMemoryState({ workspaces: [{ ...scope, id: scope.workspaceId, name: 'One', actors: ['alice'] }] });
const auth = { authenticate: () => ({ id: 'alice' }), resolveActor: () => ({ id: 'alice' }) };
const post = (path: string, operation: string, input: unknown = {}, headers: Record<string, string> = {}) => new Request(`http://localhost/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ ...scope, operation, input }) });

describe('public configuration contracts', () => {
  it('keeps defineWorkspace as a compatible alias', () => {
    expect(defineApplication).toBe(defineWorkspace);
  });

  it('validates limits at setup and requires actor resolution when creating a worker', () => {
    const options: PlatformOptions = { applications: [], auth: { authenticate: () => null }, services: state() };
    for (const key of ['maxRequestBytes', 'maxResultBytes', 'operationTimeoutMs', 'interactiveTimeoutMs', 'backgroundTimeoutMs', 'liveRefreshMs', 'workerRetryDelayMs', 'shutdownTimeoutMs'] as const) {
      for (const value of [-1, NaN, Infinity, 0.5]) expect(() => createPlatform({ ...options, [key]: value })).toThrow(key);
    }
    expect(() => createPlatform({ ...options, shutdownTimeoutMs: 0 })).not.toThrow();
    expect(() => createPlatform(options).worker()).toThrow('auth.resolveActor');
  });

  it('uses a complete mount override, normalizes paths, and retains the legacy fallback', async () => {
    const platform = createPlatform({ applications: [], auth, services: state(), admin: { basePath: '/old', handle: () => new Response('old') } });
    expect(await (await platform.httpHandler()(new Request('http://localhost/old'))).text()).toBe('old');
    const handler = platform.httpHandler({ admin: { basePath: '/new/', handle: () => new Response('new') } });
    expect(await (await handler(new Request('http://localhost/new'))).text()).toBe('new');
    expect((await handler(new Request('http://localhost/old'))).status).toBe(404);
    expect((await platform.httpHandler({ admin: { basePath: '/new' } })(new Request('http://localhost/new'))).status).toBe(501);
  });

  it('transforms outputs once for HTTP, sibling calls, and worker execution', async () => {
    const services = state();
    const dispose = vi.fn();
    const createAppContext = vi.fn(() => ({ dispose }));
    const definition = defineApplication()({ id: scope.applicationId,
      queries: {
        transformed: { input: object, output: numericText, permission: [], api: true, handler: () => '41' },
        sibling: { input: object, output: numericText, permission: [], api: true, handler: async ({ operations }) => String((await operations.query('transformed', {})) + 1) },
      },
      mutations: { transformed: { input: object, output: numericText, permission: [], api: true, handler: () => '43' } },
      tasks: { transformed: { input: object, output: numericText, permission: [], api: true, handler: () => '44' } },
    });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext })], auth, services });
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    expect(await (await handler(post('query', 'transformed'))).json()).toMatchObject({ result: 41 });
    expect(await (await handler(post('query', 'sibling'))).json()).toMatchObject({ result: 42 });
    expect(await (await handler(post('mutate', 'transformed'))).json()).toMatchObject({ result: 43 });
    const queued = await (await handler(post('enqueue', 'transformed'))).json() as { runId: string };
    const worker = platform.worker();
    worker.start();
    try { await vi.waitFor(async () => expect((await services.tasks.list(scope, 10)).find((run) => run.runId === queued.runId)).toMatchObject({ status: 'succeeded', result: 44 })); }
    finally { await worker.stop(); }
    expect(createAppContext).toHaveBeenCalledTimes(5);
    expect(dispose).toHaveBeenCalledTimes(5);
  });

  it('lets specific interactive and background deadlines override the legacy common deadline', async () => {
    const services = state();
    const slow = async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return {}; };
    const definition = defineApplication()({ id: scope.applicationId,
      queries: { slow: { input: object, output: object, api: true, permission: [], handler: slow } },
      tasks: { slow: { input: object, output: object, api: true, permission: [], handler: slow } },
    });
    const options = { applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth, services, operationTimeoutMs: 1 };
    const platform = createPlatform({ ...options, interactiveTimeoutMs: 1000, backgroundTimeoutMs: 1000 });
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    expect((await handler(post('query', 'slow'))).status).toBe(200);
    await handler(post('enqueue', 'slow'));
    const worker = platform.worker();
    worker.start();
    try { await vi.waitFor(async () => expect((await services.tasks.list(scope, 10))[0]).toMatchObject({ status: 'succeeded' })); }
    finally { await worker.stop(); }
    expect((await createPlatform(options).httpHandler({ apiBasePath: '/api' })(post('query', 'slow'))).status).toBe(504);
  });

  it('returns structured issue paths and correlates errors and successes', async () => {
    const invalid = schema<object>(() => ({ issues: [{ message: 'Required', path: [{ key: 'items' }, 0, 'name'] }] }), { type: 'object' });
    const definition = defineApplication()({ id: scope.applicationId, queries: {
      invalid: { input: invalid, output: object, permission: [], api: true, handler: () => ({}) },
      valid: { input: object, output: object, permission: [], api: true, handler: () => ({ ok: true }) },
    } });
    const handler = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth, services: state() }).httpHandler({ apiBasePath: '/api' });
    const response = await handler(post('query', 'invalid', {}, { 'x-correlation-id': 'review-1' }));
    expect(response.status).toBe(400);
    expect(response.headers.get('x-correlation-id')).toBe('review-1');
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED', correlationId: 'review-1', issues: [{ message: 'Required', path: ['items', 0, 'name'] }] } });
    const success = await handler(post('query', 'valid'));
    expect(await success.json()).toMatchObject({ correlationId: success.headers.get('x-correlation-id'), result: { ok: true } });
  });

  it('validates the raw authorization resolver value and gives the checker its transformed value', async () => {
    const check = vi.fn(({ auth: authorization }: { auth: number }) => authorization === 42);
    const definition = defineApplication()({ id: scope.applicationId,
      authorization: { context: numericText, check },
      queries: { read: { input: object, output: object, api: true, permission: 'read', handler: () => ({}) } },
    });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}), resolveAuthorization: () => '42' })], auth, services: state() });
    expect((await platform.httpHandler({ apiBasePath: '/api' })(post('query', 'read'))).status).toBe(200);
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ auth: 42 }));
  });

  it('rejects incompatible queued task/agent inputs and disables incompatible schedules', async () => {
    const services = state();
    const execute = vi.fn(() => ({}));
    const definition = defineApplication()({ id: scope.applicationId,
      mutations: { finish: { input: object, output: object, permission: [], handler: execute } },
      tasks: { current: { input: object, output: object, version: 2, api: true, permission: [], handler: execute } },
      agents: { current: { input: object, version: 2, permission: [], model: 'test', instructions: '', prompt: () => '', tools: [{ kind: 'mutation', operation: 'finish' }], finishWhen: { tool: 'mutation.finish' } } },
    });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth, services });
    const enqueue = vi.spyOn(services.tasks, 'enqueue');
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    const currentRun = await (await handler(post('enqueue', 'current'))).json() as { runId: string };
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: currentRun.runId, operationVersion: 2 }));
    const scheduleResponse = await handler(new Request('http://localhost/api/schedules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...scope, operation: 'current', input: {}, kind: 'once', runAt: new Date(Date.now() + 60_000).toISOString() }) }));
    // Schedule management is a distinct capability from the operation's explicit empty policy.
    expect(scheduleResponse.status).toBe(403);
    const manage = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth, services, authorise: ({ permission }) => permission === 'workcore.schedules.manage' }).httpHandler({ apiBasePath: '/api' });
    const created = await manage(new Request('http://localhost/api/schedules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...scope, operation: 'current', input: {}, kind: 'once', runAt: new Date(Date.now() + 60_000).toISOString() }) }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ schedule: { operationVersion: 2 } });
    const payload: TaskPayload = { id: 'old-task', ...scope, operation: 'current', input: {}, actorId: 'alice', correlationId: 'old', createdAt: new Date().toISOString() };
    await services.tasks.enqueue(payload);
    await services.agentRuns!.create({ id: 'old-agent', scope, actorId: 'alice', agent: 'current', status: 'queued', createdAt: payload.createdAt, correlationId: 'old' });
    await services.tasks.enqueue({ ...payload, id: 'old-agent', operation: '@workcore/agent/current' });
    await services.schedules.create({ id: 'old-schedule', scope, operation: 'current', input: {}, actorId: 'alice', timezone: 'UTC', kind: 'once', enabled: true, runAt: payload.createdAt, nextRunAt: payload.createdAt, createdAt: payload.createdAt });
    const worker = platform.worker();
    worker.start();
    try {
      await vi.waitFor(async () => expect((await services.tasks.list(scope, 10)).filter((run) => run.error?.code === 'OPERATION_VERSION_MISMATCH')).toHaveLength(2));
      await vi.waitFor(async () => expect(await services.schedules.get('old-schedule')).toMatchObject({ enabled: false, lastSkipReason: expect.stringContaining('OPERATION_VERSION_MISMATCH') }), { timeout: 2500 });
      expect(await services.agentRuns!.get(scope, 'old-agent')).toMatchObject({ status: 'failed', error: { code: 'OPERATION_VERSION_MISMATCH' } });
      expect((await services.tasks.list(scope, 10)).find((run) => run.runId === currentRun.runId)).toMatchObject({ status: 'succeeded' });
      expect(execute).toHaveBeenCalledTimes(1);
    } finally { await worker.stop(); }
  });
});
