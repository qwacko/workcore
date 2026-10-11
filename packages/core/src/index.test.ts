import { describe, expect, it, vi } from 'vitest';
import { createMemoryServices, createPlatform, defineWorkspace, jsonWireCodec, registerApplication, type Actor, type PlatformServices, type TaskPayload, type WireCodec } from './index.js';

type AppContext = { value: { current: number } };
type Schema<T> = {
  '~standard': {
    version: 1;
    vendor: string;
    types: { input: T; output: T };
    validate(value: unknown): { value: T } | { issues: readonly { message: string }[] };
    jsonSchema: { input(): Record<string, unknown>; output(): Record<string, unknown> };
  };
};
type TransformSchema<I, O> = { '~standard': { version: 1; vendor: string; types: { input: I; output: O }; validate(value: unknown): { value: O } | { issues: readonly { message: string }[] }; jsonSchema: { input(): Record<string, unknown>; output(): Record<string, unknown> } } };
function schema<T>(valid: (value: unknown) => value is T): Schema<T> {
  return { '~standard': {
    version: 1, vendor: 'test', types: undefined as unknown as { input: T; output: T },
    validate(value) { return valid(value) ? { value } : { issues: [{ message: 'Invalid input' }] }; },
    jsonSchema: { input: () => ({ type: 'object' }), output: () => ({ type: 'object' }) },
  } };
}
const objectSchema = schema<Record<string, unknown>>((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value));
const numberSchema = schema<number>((value): value is number => typeof value === 'number');
const numericStringSchema: TransformSchema<string, number> = { '~standard': {
  version: 1, vendor: 'test-transform', types: undefined as unknown as { input: string; output: number },
  validate(value) { return typeof value === 'string' && Number.isFinite(Number(value)) ? { value: Number(value) } : { issues: [{ message: 'Expected numeric text' }] }; },
  jsonSchema: { input: () => ({ type: 'string' }), output: () => ({ type: 'number' }) },
} };

const dateCodec: WireCodec = {
  id: 'test-date-v1',
  encode(value) {
    const prepare = (item: unknown): unknown => item instanceof Date ? { __workcoreDate: item.toISOString() }
      : Array.isArray(item) ? item.map(prepare)
        : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, prepare(child)])) : item;
    return { serialized: JSON.stringify(prepare(value)) };
  },
  decode(value) {
    const revive = (item: unknown): unknown => item && typeof item === 'object' && !Array.isArray(item) && typeof (item as { __workcoreDate?: unknown }).__workcoreDate === 'string'
      ? new Date((item as { __workcoreDate: string }).__workcoreDate)
      : Array.isArray(item) ? item.map(revive)
        : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).map(([key, child]) => [key, revive(child)])) : item;
    return revive(JSON.parse((value as { serialized: string }).serialized));
  },
};
const dateSchema: Schema<Date> = { '~standard': {
  version: 1, vendor: 'test-date', types: undefined as unknown as { input: Date; output: Date },
  validate(value) { return value instanceof Date && Number.isFinite(value.getTime()) ? { value } : { issues: [{ message: 'Expected a Date' }] }; },
  jsonSchema: { input: () => ({ type: 'string', format: 'date-time' }), output: () => ({ type: 'string', format: 'date-time' }) },
} };

function fixture(services: PlatformServices, access?: (actor: Actor, scope: { applicationId: string; workspaceId: string }, permission: string) => boolean, trustedOrigins?: readonly string[], workerRetryDelayMs?: number) {
  const define = defineWorkspace<AppContext>();
  const app = define({
    id: 'counter',
    queries: { value: define.query({ input: objectSchema, output: numberSchema, api: true, permission: 'read', handler: ({ ctx }) => ctx.app.value.current }) },
    mutations: { increment: define.mutation({ input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: ({ ctx }) => ++ctx.app.value.current }) },
    tasks: { update: define.task({ input: objectSchema, output: numberSchema, api: true, permission: 'write', triggers: { mutations: ['increment'] }, handler: ({ ctx }) => ctx.app.value.current }) },
  });
  const platform = createPlatform({
    applications: [registerApplication({ definition: app, createAppContext: ({ scope }) => ({ value: { current: scope.workspaceId === 'one' ? 1 : 20 } }) })],
    auth: { authenticate: (request) => { const id = request.headers.get('x-actor'); return id ? { id } : null; }, resolveActor: (id) => ({ id }) },
    authorise: ({ actor, scope, permission }) => access?.(actor, scope, permission) ?? true,
    ...(trustedOrigins ? { trustedOrigins } : {}),
    ...(workerRetryDelayMs === undefined ? {} : { workerRetryDelayMs }),
    services,
  });
  return { handler: platform.httpHandler({ apiBasePath: '/api' }), platform, app };
}

const req = (path: string, body?: unknown, actor = 'alice') => new Request(`http://localhost/api${path}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { 'x-actor': actor, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('Workcore HTTP runtime', () => {
  it('validates, scopes and authorises requests', async () => {
    const services = createMemoryServices({ workspaces: [
      { applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] },
      { applicationId: 'counter', id: 'two', name: 'Two', actors: ['bob'] },
    ] });
    const { handler } = fixture(services);
    const one = await handler(new Request('http://localhost/api/query', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'alice' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'value', input: {} }) }));
    expect(one.status).toBe(200);
    expect((await one.json()).result).toBe(1);
    const denied = await handler(new Request('http://localhost/api/query', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'alice' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'two', operation: 'value', input: {} }) }));
    expect(denied.status).toBe(403);
    const noAuth = await handler(new Request('http://localhost/api/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'value', input: {} }) }));
    expect(noAuth.status).toBe(401);
    const forbiddenOperation = fixture(services, (_actor, _scope, permission) => permission !== 'write').handler;
    const mutationResponse = await forbiddenOperation(new Request('http://localhost/api/mutate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'alice' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'increment', input: {} }) }));
    expect(mutationResponse.status).toBe(403);
  });

  it('publishes success, enqueues task triggers, and records history', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { handler, platform } = fixture(services);
    const response = await handler(new Request('http://localhost/api/mutate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'alice' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'increment', input: {} }) }));
    expect(response.status).toBe(200);
    let runs = await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.operation).toBe('update');
    const worker = platform.worker();
    worker.start();
    for (let attempt = 0; attempt < 40; attempt++) {
      runs = await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10);
      if (runs[0]?.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    expect(runs[0]?.status).toBe('succeeded');
    expect(await services.history.list({ applicationId: 'counter', workspaceId: 'one' }, 10)).toEqual(expect.arrayContaining([expect.objectContaining({ operation: 'increment', status: 'succeeded' })]));
  });

  it('exposes only api-enabled operations in a versioned manifest', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { handler } = fixture(services);
    const response = await handler(new Request('http://localhost/api/manifest?applicationId=counter&workspaceId=one', { headers: { 'x-actor': 'alice' } }));
    expect(response.status).toBe(200);
    const manifest = await response.json() as { protocolVersion: number; schemaDialect: string; operations: Array<{ name: string }> };
    expect(manifest.protocolVersion).toBe(1);
    expect(manifest.schemaDialect).toContain('2020-12');
    expect(manifest.operations.map(({ name }) => name)).toEqual(['value', 'increment', 'update']);
  });

  it('distinguishes event delivery failure from a committed mutation and does not trigger work', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    services.events.publish = async () => { throw new Error('private redis connection details'); };
    let sideEffects = 0;
    const define = defineWorkspace<AppContext>();
    const definition = define({
      id: 'counter',
      mutations: { write: define.mutation({ input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: () => ++sideEffects }) },
      tasks: { followUp: define.task({ input: objectSchema, output: numberSchema, api: true, permission: 'write', triggers: { mutations: ['write'] }, handler: () => 1 }) },
    });
    const platform = createPlatform({ applications: [registerApplication({ definition, createAppContext: () => ({ value: { current: 0 } }) })], auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) }, authorise: () => true, services });
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/mutate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'write', input: {} }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).deliveryWarning).toBe('EVENT_DELIVERY_FAILED');
    expect(sideEffects).toBe(1);
    expect(await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10)).toEqual([]);
    expect((await services.history.list({ applicationId: 'counter', workspaceId: 'one' }, 10))[0]?.status).toBe('delivery_failed');
  });

  it('rechecks workspace access when a queued actor reaches the worker', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { handler, platform } = fixture(services);
    await handler(new Request('http://localhost/api/enqueue', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'alice' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'update', input: {} }) }));
    services.workspaces.canAccess = () => false;
    const worker = platform.worker();
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await worker.stop();
    expect((await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10))[0]).toMatchObject({ status: 'failed', error: { code: 'ACCESS_REVOKED' } });
  });

  it('releases a claimed task and keeps the worker alive after a transient adapter error', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { handler, platform } = fixture(services, undefined, undefined, 1);
    await handler(new Request('http://localhost/api/enqueue', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'alice' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'update', input: {} }) }));
    const canAccess = services.workspaces.canAccess.bind(services.workspaces);
    let failuresRemaining = 1;
    services.workspaces.canAccess = async (actor, scope) => {
      if (failuresRemaining-- > 0) throw new Error('temporary workspace adapter failure');
      return canAccess(actor, scope);
    };
    const worker = platform.worker();
    worker.start();
    let runs = await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10);
    for (let attempt = 0; attempt < 100; attempt++) {
      runs = await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10);
      if (runs[0]?.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    expect(runs[0]?.status).toBe('succeeded');
  });

  it('persists validated task input without applying schema transforms a second time', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'transform', id: 'one', name: 'One', actors: ['alice'] }] });
    const define = defineWorkspace<AppContext>();
    const definition = define({ id: 'transform', mutations: {
      trigger: define.mutation({ input: objectSchema, output: numberSchema, api: true, permission: 'run', handler: () => 1 }),
    }, tasks: {
      convert: define.task({ input: numericStringSchema, output: numberSchema, api: true, permission: 'run', triggers: { mutations: ['trigger'], mapInput: () => '43' }, handler: ({ input }) => input }),
    } });
    const platform = createPlatform({
      applications: [registerApplication({ definition, createAppContext: () => ({ value: { current: 0 } }) })],
      auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) }, authorise: () => true, services, workerRetryDelayMs: 1,
    });
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    const queued = await handler(new Request('http://localhost/api/enqueue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'transform', workspaceId: 'one', operation: 'convert', input: '42' }) }));
    expect(queued.status).toBe(202);
    const payload = await services.tasks.claim();
    expect(payload?.input).toBe(42);
    if (payload) await services.tasks.release(payload.id);

    const mutationResponse = await handler(new Request('http://localhost/api/mutate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'transform', workspaceId: 'one', operation: 'trigger', input: {} }) }));
    expect(mutationResponse.status).toBe(200);
    const scheduleResponse = await handler(new Request('http://localhost/api/schedules', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'transform', workspaceId: 'one', operation: 'convert', input: '44', kind: 'once', runAt: new Date(Date.now() + 60_000).toISOString(), timezone: 'UTC' }) }));
    expect(scheduleResponse.status).toBe(201);
    const [schedule] = await services.schedules.list({ applicationId: 'transform', workspaceId: 'one' });
    expect(schedule?.input).toBe(44);
    if (schedule) { schedule.nextRunAt = new Date(Date.now() - 1_000).toISOString(); await services.schedules.update(schedule); }

    const worker = platform.worker();
    worker.start();
    let runs = await services.tasks.list({ applicationId: 'transform', workspaceId: 'one' }, 10);
    for (let attempt = 0; attempt < 500; attempt++) {
      runs = await services.tasks.list({ applicationId: 'transform', workspaceId: 'one' }, 10);
      if (runs.length === 3 && runs.every((run) => run.status === 'succeeded')) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    expect(runs).toHaveLength(3);
    expect(runs.map((run) => run.result).sort()).toEqual([42, 43, 44]);
    expect(runs.every((run) => run.status === 'succeeded')).toBe(true);
  });

  it('keeps a recurring schedule reserved while slow actor resolution is in progress', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'slow-schedule', id: 'one', name: 'One', actors: ['alice'] }] });
    const define = defineWorkspace<AppContext>();
    const definition = define({ id: 'slow-schedule', tasks: {
      run: define.task({ input: objectSchema, output: numberSchema, api: true, permission: 'run', handler: () => 1 }),
    } });
    const platform = createPlatform({
      applications: [registerApplication({ definition, createAppContext: () => ({ value: { current: 0 } }) })],
      auth: {
        authenticate: () => ({ id: 'alice' }),
        resolveActor: async (id) => { await new Promise((resolve) => setTimeout(resolve, 1_300)); return { id }; },
      }, authorise: () => true, services,
    });
    const now = Date.now();
    await services.schedules.create({
      id: 'slow-recurring', scope: { applicationId: 'slow-schedule', workspaceId: 'one' }, operation: 'run', input: {}, actorId: 'alice',
      timezone: 'UTC', kind: 'recurring', cron: '0 9 * * *', enabled: true, nextRunAt: new Date(now - 1_000).toISOString(), createdAt: new Date(now).toISOString(),
    });
    const firstWorker = platform.worker();
    const secondWorker = platform.worker();
    firstWorker.start();
    secondWorker.start();
    await new Promise((resolve) => setTimeout(resolve, 1_800));
    await Promise.all([firstWorker.stop(), secondWorker.stop()]);
    const runs = await services.tasks.list({ applicationId: 'slow-schedule', workspaceId: 'one' }, 20);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.operation).toBe('run');
  });

  it('rechecks workspace access on every internal sibling call', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    let access = true;
    let writes = 0;
    const define = defineWorkspace<AppContext>();
    const definition = define({ id: 'counter', mutations: {
      parent: define.mutation({ input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: async ({ operations }) => {
        access = false;
        return await operations.mutate('child', {} as never) as number;
      } }),
      child: define.mutation({ input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: () => ++writes }),
    } });
    const platform = createPlatform({ applications: [registerApplication({ definition, createAppContext: () => ({ value: { current: 0 } }) })], auth: { authenticate: () => ({ id: 'alice' }) }, authorise: () => true, services });
    services.workspaces.canAccess = async (actor, scope) => access && scope.applicationId === 'counter' && scope.workspaceId === 'one' && actor.id === 'alice';
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/mutate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'parent', input: {} }) }));
    expect(response.status).toBe(403);
    expect(writes).toBe(0);
  });

  it('preserves provenance and stops chains created with internal task enqueue', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'chain', id: 'one', name: 'One', actors: ['alice'] }] });
    const observedPayloads: TaskPayload[] = [];
    const enqueue = services.tasks.enqueue;
    services.tasks.enqueue = async (payload) => { observedPayloads.push(payload); await enqueue(payload); };
    const define = defineWorkspace<AppContext>();
    const definition = define({ id: 'chain', tasks: {
      chain: define.task({ input: objectSchema, output: objectSchema, api: true, permission: 'run', handler: async ({ operations }) => { await operations.enqueue('chain', {}); return {}; } }),
    } });
    const platform = createPlatform({
      applications: [registerApplication({ definition, createAppContext: () => ({ value: { current: 0 } }) })],
      auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) }, authorise: () => true, services,
    });
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/enqueue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'chain', workspaceId: 'one', operation: 'chain', input: {} }) }));
    expect(response.status).toBe(202);
    const worker = platform.worker();
    worker.start();
    let runs = await services.tasks.list({ applicationId: 'chain', workspaceId: 'one' }, 20);
    for (let attempt = 0; attempt < 300; attempt++) {
      runs = await services.tasks.list({ applicationId: 'chain', workspaceId: 'one' }, 20);
      if (runs.length === 9 && runs.every((run) => run.status === 'succeeded' || run.status === 'failed')) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    expect(runs).toHaveLength(9);
    expect(observedPayloads.map((payload) => payload.triggerDepth)).toEqual([undefined, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(observedPayloads.slice(1).every((payload) => typeof payload.causationId === 'string')).toBe(true);
    expect(runs.filter((run) => run.status === 'failed')).toHaveLength(1);
  });

  it('does not turn a completed task into a failure when schedule cleanup fails', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { platform } = fixture(services);
    await services.tasks.enqueue({ id: 'scheduled-run', applicationId: 'counter', workspaceId: 'one', operation: 'update', input: {}, actorId: 'alice', correlationId: 'c1', createdAt: new Date().toISOString(), scheduleId: 'broken-schedule' });
    services.schedules.clearActiveRun = async () => { throw new Error('schedule store unavailable after task completion'); };
    const worker = platform.worker();
    worker.start();
    let runs = await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10);
    for (let attempt = 0; attempt < 100; attempt++) {
      runs = await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10);
      if (runs[0]?.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    expect(runs[0]).toMatchObject({ status: 'succeeded', result: 1 });
  });

  it('keeps delimiter-containing scopes isolated for KV and event delivery', async () => {
    const services = createMemoryServices({ workspaces: [
      { applicationId: 'a:b', id: 'c', name: 'First', actors: ['alice'] },
      { applicationId: 'a', id: 'b:c', name: 'Second', actors: ['alice'] },
    ] });
    const first = { applicationId: 'a:b', workspaceId: 'c' };
    const second = { applicationId: 'a', workspaceId: 'b:c' };
    await services.kv.set(first, 'value', 'first-scope');
    expect(await services.kv.get(second, 'value')).toBeUndefined();
    let secondScopeEvents = 0;
    services.events.subscribe(second, () => { secondScopeEvents++; });
    await services.events.publish({ id: 'e1', type: 'mutation.succeeded', applicationId: first.applicationId, workspaceId: first.workspaceId, executionId: 'x', actorId: 'alice', correlationId: 'c', createdAt: new Date().toISOString() });
    expect(secondScopeEvents).toBe(0);
  });

  it.each(['disable', 'edit'] as const)('preserves a concurrent schedule %s before dispatch', async (change) => {
    vi.useFakeTimers();
    const scope = { applicationId: 'counter', workspaceId: 'one' };
    const services = createMemoryServices({ workspaces: [{ ...scope, id: 'one', name: 'One', actors: ['alice'] }] });
    const { app } = fixture(services);
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let resolving!: () => void;
    const started = new Promise<void>((resolve) => { resolving = resolve; });
    const platform = createPlatform({ applications: [registerApplication({ definition: app, createAppContext: () => ({ value: { current: 1 } }) })],
      auth: { authenticate: () => ({ id: 'alice' }), resolveActor: async () => { resolving(); await gate; return { id: 'alice' }; } }, authorise: () => true, services });
    await services.schedules.create({ id: 'concurrent', scope, operation: 'update', input: {}, actorId: 'alice', timezone: 'UTC', kind: 'recurring', cron: '* * * * *', enabled: true, createdAt: new Date().toISOString(), nextRunAt: new Date().toISOString() });
    const worker = platform.worker();
    try {
      worker.start();
      await vi.advanceTimersByTimeAsync(1_000);
      await started;
      const body = change === 'disable' ? { enabled: false } : { cron: '0 9 * * *', timezone: 'Europe/London' };
      const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/schedules/concurrent?applicationId=counter&workspaceId=one', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
      expect(response.status).toBe(200);
      resume();
      await worker.stop();
      expect(await services.tasks.list(scope, 10)).toHaveLength(0);
      expect(await services.schedules.get('concurrent')).toMatchObject(body);
    } finally { resume(); await worker.stop(); vi.useRealTimers(); }
  });

  it.each(['enqueue', 'bookkeeping'] as const)('recovers uncertain schedule %s using the same occurrence ID', async (failure) => {
    vi.useFakeTimers();
    const scope = { applicationId: 'counter', workspaceId: 'one' };
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { platform } = fixture(services);
    const enqueue = services.tasks.enqueue;
    const attemptedIds: string[] = [];
    services.tasks.enqueue = async (payload) => {
      attemptedIds.push(payload.id);
      await enqueue(payload);
      if (failure === 'enqueue' && attemptedIds.length === 1) throw new Error('Lost enqueue acknowledgement');
    };
    const removeClaimed = services.schedules.removeClaimed;
    let removals = 0;
    services.schedules.removeClaimed = async (...args) => {
      if (failure === 'bookkeeping' && removals++ === 0) throw new Error('Schedule store unavailable after enqueue');
      return removeClaimed(...args);
    };
    await services.schedules.create({ id: 'recover', scope, operation: 'update', input: {}, actorId: 'alice', timezone: 'UTC', kind: 'once', enabled: true, createdAt: new Date().toISOString(), nextRunAt: new Date().toISOString() });
    const worker = platform.worker();
    try {
      worker.start();
      await vi.advanceTimersByTimeAsync(1_000);
      expect((await services.schedules.get('recover'))?.pendingRunId).toBe(attemptedIds[0]);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(attemptedIds).toHaveLength(2);
      expect(attemptedIds[1]).toBe(attemptedIds[0]);
      const runs = await services.tasks.list(scope, 10);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe('succeeded');
      expect(await services.schedules.get('recover')).toBeUndefined();
    } finally { await worker.stop(); vi.useRealTimers(); }
  });

  it('rejects stale schedule edits and clears active runs without overwriting edits', async () => {
    const services = createMemoryServices();
    await services.schedules.create({ id: 'revision', scope: { applicationId: 'counter', workspaceId: 'one' }, operation: 'update', input: {}, actorId: 'alice', timezone: 'UTC', kind: 'recurring', cron: '* * * * *', enabled: true, activeRunId: 'run', createdAt: new Date().toISOString() });
    const original = (await services.schedules.get('revision'))!;
    expect(await services.schedules.update({ ...original, enabled: false })).toBe(true);
    expect(await services.schedules.update({ ...original, timezone: 'Europe/London' })).toBe(false);
    await services.schedules.clearActiveRun('revision', 'run');
    const updated = (await services.schedules.get('revision'))!;
    expect(updated.enabled).toBe(false);
    expect(updated.activeRunId).toBeUndefined();
    original.enabled = true;
    expect((await services.schedules.get('revision'))?.enabled).toBe(false);
  });

  it('closes a revoked SSE stream once without leaking async listener errors', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { platform } = fixture(services);
    let access = true;
    services.workspaces.canAccess = async () => access;
    const controller = new AbortController();
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/events?applicationId=counter&workspaceId=one', { headers: { 'x-actor': 'alice' }, signal: controller.signal }));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
    access = false;
    await services.events.publish({ id: 'revoke', type: 'mutation.succeeded', applicationId: 'counter', workspaceId: 'one', executionId: 'e1', actorId: 'alice', correlationId: 'c1', createdAt: new Date().toISOString() });
    const closed = await reader.read();
    expect(closed.done).toBe(true);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it('negotiates a registered wire codec per request and preserves rich values', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'dates', id: 'one', name: 'One', actors: ['alice'] }] });
    const define = defineWorkspace<AppContext>();
    const requested = new Date('2026-10-12T12:00:00.000Z');
    const definition = define({ id: 'dates', queries: {
      echo: define.query({ input: dateSchema, output: dateSchema, api: true, permission: 'read', handler: ({ input }) => input }),
      now: define.query({ input: objectSchema, output: dateSchema, api: true, permission: 'read', handler: () => requested }),
    }, tasks: {
      later: define.task({ input: dateSchema, output: dateSchema, api: true, permission: 'run', handler: ({ input }) => input }),
    } });
    const platform = createPlatform({ applications: [registerApplication({ definition, createAppContext: () => ({ value: { current: 0 } }) })], auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) }, authorise: () => true, services, wireCodecs: [dateCodec] });
    const payload = dateCodec.encode({ applicationId: 'dates', workspaceId: 'one', operation: 'echo', input: requested });
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/query', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workcore-codec': dateCodec.id },
      body: JSON.stringify({ workcoreCodec: dateCodec.id, payload }),
    }));
    expect(response.status).toBe(200);
    const wrapper = await response.json() as { workcoreCodec: string; payload: JsonValue };
    const decoded = dateCodec.decode(wrapper.payload) as { result: Date };
    expect(wrapper.workcoreCodec).toBe(dateCodec.id);
    expect(decoded.result).toBeInstanceOf(Date);
    expect(decoded.result.toISOString()).toBe(requested.toISOString());

    const plainJson = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: 'dates', workspaceId: 'one', operation: 'now', input: {} }),
    }));
    expect(plainJson.status).toBe(422);
    expect(await plainJson.json()).toMatchObject({ error: { code: 'WIRE_ENCODING_FAILED' } });

    const taskInput = dateCodec.encode({ applicationId: 'dates', workspaceId: 'one', operation: 'later', input: requested });
    const queued = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/enqueue', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-workcore-codec': dateCodec.id },
      body: JSON.stringify({ workcoreCodec: dateCodec.id, payload: taskInput }),
    }));
    expect(queued.status).toBe(202);
    const taskResponse = dateCodec.decode((await queued.json() as { payload: JsonValue }).payload) as { runId: string };
    const worker = platform.worker();
    worker.start();
    let runs = await services.tasks.list({ applicationId: 'dates', workspaceId: 'one' }, 10);
    for (let attempt = 0; attempt < 100; attempt++) {
      runs = await services.tasks.list({ applicationId: 'dates', workspaceId: 'one' }, 10);
      if (runs[0]?.status === 'succeeded') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    expect(runs[0]?.runId).toBe(taskResponse.runId);
    const taskList = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/tasks?applicationId=dates&workspaceId=one', { headers: { 'x-workcore-codec': dateCodec.id } }));
    expect(taskList.status).toBe(200);
    const taskListBody = await taskList.json() as { payload: JsonValue };
    const listed = dateCodec.decode(taskListBody.payload) as { runs: Array<{ result: Date }> };
    expect(listed.runs[0]?.result).toBeInstanceOf(Date);
    expect(listed.runs[0]?.result.toISOString()).toBe(requested.toISOString());

    expect(() => jsonWireCodec.encode(requested)).toThrow(/plain objects/);

    const unsupported = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/query', { headers: { 'x-workcore-codec': 'not-installed' } }));
    expect(unsupported.status).toBe(406);
    expect(await unsupported.json()).toMatchObject({ error: { code: 'WIRE_CODEC_UNSUPPORTED' } });
  });

  it('defaults missing permissions to deny and omits statically denied manifest entries', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { handler } = fixture(services, () => false);
    const manifestResponse = await handler(new Request('http://localhost/api/manifest?applicationId=counter&workspaceId=one', { headers: { 'x-actor': 'alice' } }));
    expect((await manifestResponse.json()).operations).toEqual([]);
    const response = await handler(new Request('http://localhost/api/query', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'alice' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'value', input: {} }) }));
    expect(response.status).toBe(403);
  });

  it('requires JSON Schema conversion before exposing schemas in the manifest', () => {
    const validationOnly = { '~standard': { validate: (value: unknown) => ({ value }) } } as never;
    const define = defineWorkspace<AppContext>();
    expect(() => define({ id: 'bad', queries: { read: define.query({ input: validationOnly, output: validationOnly, api: true, permission: 'read', handler: () => 1 }) } }))
      .toThrow(/Standard JSON Schema/);
  });

  it('accepts only explicitly trusted reverse-proxy origins for state-changing calls', async () => {
    const services = createMemoryServices({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const origin = 'https://workcore.dev.jmcdowall.com';
    const unconfigured = fixture(services).handler;
    const blocked = await unconfigured(new Request('http://127.100.0.10:3000/api/query', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-actor': 'alice' },
      body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'value', input: {} }),
    }));
    expect(blocked.status).toBe(403);

    const trusted = fixture(services, undefined, [origin]).handler;
    const accepted = await trusted(new Request('http://127.100.0.10:3000/api/query', {
      method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-actor': 'alice' },
      body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'value', input: {} }),
    }));
    expect(accepted.status).toBe(200);
    const preflight = await trusted(new Request('http://127.100.0.10:3000/api/query', { method: 'OPTIONS', headers: { origin } }));
    expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('x-workcore-codec');
    const untrustedPreflight = await trusted(new Request('http://127.100.0.10:3000/api/query', { method: 'OPTIONS', headers: { origin: 'https://attacker.invalid' } }));
    expect(untrustedPreflight.headers.get('access-control-allow-origin')).toBeNull();
  });
});
