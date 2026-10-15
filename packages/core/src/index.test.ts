import { describe, expect, it, vi } from 'vitest';
import { createMemoryState, createPlatform, defineWorkspace, jsonWireCodec, type Actor, type PlatformServices, type TaskPayload, type WireCodec } from './index.js';

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
  const app = defineWorkspace<AppContext>()({
    id: 'counter',
    queries: { value: { input: objectSchema, output: numberSchema, api: true, permission: 'read', handler: ({ ctx }) => ctx.app.value.current } },
    mutations: { increment: { input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: ({ ctx }) => ++ctx.app.value.current } },
    tasks: { update: { input: objectSchema, output: numberSchema, api: true, permission: 'write', triggers: { mutations: ['increment'] }, handler: ({ ctx }) => ctx.app.value.current } },
  });
  const platform = createPlatform({
    applications: [app.registerApplication({ createAppContext: ({ scope }) => ({ value: { current: scope.workspaceId === 'one' ? 1 : 20 } }) })],
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
    const services = createMemoryState({ workspaces: [
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

  it('forwards request metadata to HTTP operation handlers', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'request-context', id: 'one', name: 'One', actors: ['alice'] }] });
    const definition = defineWorkspace<AppContext>()({
      id: 'request-context',
      queries: {
        inspectRequest: {
          input: objectSchema,
          output: schema<{ url: string; method: string; token: string | null }>((value): value is { url: string; method: string; token: string | null } => !!value && typeof value === 'object'),
          api: true,
          permission: [],
          handler: ({ ctx }) => ({ url: ctx.request?.url ?? '', method: ctx.request?.method ?? '', token: ctx.request?.headers.get('x-request-token') ?? null }),
        },
      },
    });
    const platform = createPlatform({
      applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })],
      auth: { authenticate: () => ({ id: 'alice' }) },
      services,
    });
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    const response = await handler(new Request('https://example.test/api/query', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-token': 'session-token' },
      body: JSON.stringify({ applicationId: 'request-context', workspaceId: 'one', operation: 'inspectRequest', input: {} }),
    }));
    expect(response.status).toBe(200);
    expect((await response.json()).result).toEqual({
      url: 'https://example.test/api/query', method: 'POST', token: 'session-token',
    });
  });

  it('fails closed for named permissions when no authorizer is configured', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'closed', id: 'one', name: 'One', actors: ['alice'] }] });
    const definition = defineWorkspace<AppContext>()({
      id: 'closed',
      queries: { read: { input: objectSchema, output: numberSchema, api: true, permission: 'read', handler: () => 1 } },
    });
    const platform = createPlatform({
      applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })],
      auth: { authenticate: (request) => request.headers.get('x-actor') ? { id: 'alice' } : null },
      services,
    });
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    const query = await handler(req('/query', { applicationId: 'closed', workspaceId: 'one', operation: 'read', input: {} }));
    const manifest = await handler(req('/manifest?applicationId=closed&workspaceId=one'));
    expect(query.status).toBe(403);
    expect((await manifest.json()).operations).toEqual([]);
  });

  it('keeps dynamic capability policies and empty permission lists consistent with manifest visibility', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'policies', id: 'one', name: 'One', actors: ['alice'] }] });
    const checked: string[] = [];
    const definition = defineWorkspace<AppContext>()({
      id: 'policies',
      authorization: {
        context: objectSchema,
        check: ({ permission }) => { checked.push(permission); return permission === 'read'; },
      },
      queries: {
        dynamic: { input: objectSchema, output: numberSchema, api: true, permission: ({ access }) => access.has('read'), handler: () => 1 },
        open: { input: objectSchema, output: numberSchema, api: true, permission: [], handler: () => 2 },
      },
    });
    const platform = createPlatform({
      applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }), resolveAuthorization: () => ({}) })],
      auth: { authenticate: (request) => request.headers.get('x-actor') ? { id: 'alice' } : null },
      services,
    });
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    const manifest = await handler(req('/manifest?applicationId=policies&workspaceId=one'));
    expect((await manifest.json()).operations.map((operation: { name: string }) => operation.name)).toEqual(['dynamic', 'open']);
    expect(checked).toEqual(['workcore.tasks.read', 'workcore.schedules.read', 'workcore.schedules.manage', 'workcore.history.read', 'workcore.agents.runs.read', 'workcore.agents.runs.read.all', 'workcore.agents.results.read', 'workcore.agents.messages.read', 'workcore.agents.tools.read', 'workcore.agents.toolPayloads.read']);
    checked.length = 0;

    const dynamic = await handler(req('/query', { applicationId: 'policies', workspaceId: 'one', operation: 'dynamic', input: {} }));
    const open = await handler(req('/query', { applicationId: 'policies', workspaceId: 'one', operation: 'open', input: {} }));
    expect(dynamic.status).toBe(200);
    expect(open.status).toBe(200);
    expect(checked).toEqual(['read']);
  });

  it('returns normalized operation kinds and empty operation maps', () => {
    const definition = defineWorkspace<AppContext>()({
      id: 'normalized',
      queries: { read: { input: objectSchema, output: numberSchema, handler: () => 1 } },
    });
    expect(definition.queries.read.kind).toBe('query');
    expect(definition.mutations).toEqual({});
    expect(definition.tasks).toEqual({});
  });

  it('uses workspace authorization for built-in platform capabilities without a platform authorise callback', async () => {
    const services = createMemoryState({ workspaces: [
      { applicationId: 'counter', id: 'one', name: 'One', actors: ['alice', 'bob'] },
    ] });
    const roleSchema = schema<{ role: 'owner' | 'viewer' }>((value): value is { role: 'owner' | 'viewer' } =>
      !!value && typeof value === 'object' && 'role' in value && ((value as { role: unknown }).role === 'owner' || (value as { role: unknown }).role === 'viewer'));
    const definition = defineWorkspace<AppContext>()({
      id: 'counter',
      authorization: {
        context: roleSchema,
        check: ({ auth, permission }) => permission === 'workcore.history.read' && auth.role === 'owner',
      },
    });
    const platform = createPlatform({
      applications: [definition.registerApplication({
        createAppContext: () => ({ value: { current: 0 } }),
        resolveAuthorization: ({ actor }) => ({ role: actor.id === 'alice' ? 'owner' : 'viewer' }),
      })],
      auth: { authenticate: (request) => { const id = request.headers.get('x-actor'); return id ? { id } : null; }, resolveActor: (id) => ({ id }) },
      services,
    });
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    const allowed = await handler(req('/history?applicationId=counter&workspaceId=one', undefined, 'alice'));
    const denied = await handler(req('/history?applicationId=counter&workspaceId=one', undefined, 'bob'));
    expect(allowed.status).toBe(200);
    expect(denied.status).toBe(403);
  });

  it('publishes success, enqueues task triggers, and records history', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
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

  it('queues internal agents, executes only checked tools, records traces, and filters inspection data', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'agent-app', id: 'one', name: 'One', actors: ['alice'] }] });
    let toolCalls = 0;
    let failNextRun = false;
    let retainedTool: ((input: unknown, signal?: AbortSignal) => Promise<unknown>) | undefined;
    services.agentEngine = {
      run: async ({ tools, finishTool, onEvent }) => {
        await onEvent({ type: 'step.started', data: { prompt: 'private prompt' } });
        if (failNextRun) {
          retainedTool = tools[finishTool]!.execute;
          throw new Error('engine failed');
        }
        const output = await tools[finishTool]!.execute({ value: 'done' });
        return { output: 'model-generated text is not the result', finishReason: 'tool-calls', finishTool: output ? finishTool : undefined };
      },
    };
    const app = defineWorkspace<AppContext>()({
      id: 'agent-app',
      mutations: {
        finish: { input: objectSchema, output: objectSchema, permission: 'write', handler: () => { toolCalls++; return { ok: true }; } },
        start: { input: objectSchema, output: objectSchema, permission: 'write', api: true, handler: async ({ operations, input }) => operations.enqueueAgent('organize', input, { conversationId: 'conversation-1' }) },
      },
      agents: {
        organize: {
          input: objectSchema,
          permission: 'agent.invoke',
          tools: [{ kind: 'mutation', operation: 'finish', description: 'Finish the work' }],
          model: 'test/model',
          instructions: 'Do the requested work',
          prompt: ({ input }) => JSON.stringify(input),
          finishWhen: { tool: 'mutation.finish' },
        },
      },
    });
    const platform = createPlatform({
      applications: [app.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })],
      auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) },
      authorise: ({ permission }) => !['workcore.agents.runs.read.all', 'workcore.agents.toolPayloads.read', 'workcore.agents.results.read', 'workcore.agents.messages.read'].includes(permission),
      services,
    });
    const observedLiveEvents: string[] = [];
    const unsubscribeLiveEvents = services.events.subscribe({ applicationId: 'agent-app', workspaceId: 'one' }, (event) => observedLiveEvents.push(event.type));
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    const queued = await handler(req('/mutate', { applicationId: 'agent-app', workspaceId: 'one', operation: 'start', input: { request: 'organize' } }));
    expect(queued.status).toBe(200);
    const { runId } = (await queued.json() as { result: { runId: string } }).result;
    expect(await services.agentRuns!.get({ applicationId: 'agent-app', workspaceId: 'one' }, runId)).toMatchObject({ status: 'queued', agent: 'organize', conversationId: 'conversation-1' });
    const worker = platform.worker(); worker.start();
    let run;
    for (let attempt = 0; attempt < 40; attempt++) {
      run = await services.agentRuns!.get({ applicationId: 'agent-app', workspaceId: 'one' }, runId);
      if (run?.status === 'succeeded' || run?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await worker.stop();
    expect(run).toMatchObject({ status: 'succeeded', finishReason: 'tool:mutation.finish' });
    expect(run?.result).toEqual({ ok: true });
    expect(observedLiveEvents).toContain('workspace.invalidated');
    const details = await handler(new Request(`http://localhost/api/agent-runs/${runId}?applicationId=agent-app&workspaceId=one`, { headers: { 'x-actor': 'alice' } }));
    expect((await details.json() as { run: object }).run).not.toHaveProperty('result');
    const listing = await handler(new Request('http://localhost/api/agent-runs?applicationId=agent-app&workspaceId=one', { headers: { 'x-actor': 'alice' } }));
    expect((await listing.json() as { runs: Array<{ id: string; result?: unknown }> }).runs).toEqual([expect.objectContaining({ id: runId, status: 'succeeded' })]);
    expect(toolCalls).toBe(1);
    const events = await handler(new Request(`http://localhost/api/agent-runs/${runId}/events?applicationId=agent-app&workspaceId=one`, { headers: { 'x-actor': 'alice' } }));
    expect(events.status).toBe(200);
    const rows = (await events.json() as { events: Array<{ type: string; data?: unknown }> }).events;
    expect(rows.map((event) => event.type)).toEqual(expect.arrayContaining(['run.started', 'tool.started', 'tool.completed', 'run.completed']));
    expect(rows.find((event) => event.type === 'tool.started')?.data).toEqual({ name: 'mutation.finish' });
    expect(rows.find((event) => event.type === 'step.started')?.data).toEqual({ redacted: true });

    const invalidationsBeforeFailure = observedLiveEvents.filter((type) => type === 'workspace.invalidated').length;
    failNextRun = true;
    const failedQueue = await handler(req('/mutate', { applicationId: 'agent-app', workspaceId: 'one', operation: 'start', input: { request: 'organize again' } }));
    const { runId: failedRunId } = (await failedQueue.json() as { result: { runId: string } }).result;
    const failedWorker = platform.worker(); failedWorker.start();
    let failedRun;
    for (let attempt = 0; attempt < 40; attempt++) {
      failedRun = await services.agentRuns!.get({ applicationId: 'agent-app', workspaceId: 'one' }, failedRunId);
      if (failedRun?.status === 'failed') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await failedWorker.stop();
    unsubscribeLiveEvents();
    expect(failedRun).toMatchObject({ status: 'failed', error: { code: 'AGENT_FAILED' } });
    await expect(retainedTool?.({ value: 'late side effect' })).rejects.toMatchObject({ code: 'EXECUTION_ABORTED' });
    expect(toolCalls).toBe(1);
    expect(observedLiveEvents.filter((type) => type === 'workspace.invalidated')).toHaveLength(invalidationsBeforeFailure + 1);
  });

  it('keeps memory agent-run pagination cursors stable when a filtered run changes status', async () => {
    const services = createMemoryState();
    const scope = { applicationId: 'cursor-test', workspaceId: 'one' };
    const base = { scope, actorId: 'alice', agent: 'test', status: 'queued' as const, correlationId: 'corr' };
    await services.agentRuns!.create({ ...base, id: 'new', createdAt: '2026-10-14T10:01:00.000Z' });
    await services.agentRuns!.create({ ...base, id: 'old', createdAt: '2026-10-14T10:00:00.000Z' });
    const first = await services.agentRuns!.list(scope, { status: 'queued', limit: 1 });
    await services.agentRuns!.update({ ...base, id: 'new', status: 'succeeded', createdAt: '2026-10-14T10:01:00.000Z' });
    const second = await services.agentRuns!.list(scope, { status: 'queued', limit: 1, cursor: first.nextCursor! });
    expect(first.runs.map((run) => run.id)).toEqual(['new']);
    expect(second.runs.map((run) => run.id)).toEqual(['old']);
  });

  it('removes truncated trace previews when tool payload access is denied', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'trace-redaction', id: 'one', name: 'One', actors: ['alice'] }] });
    const scope = { applicationId: 'trace-redaction', workspaceId: 'one' };
    const app = defineWorkspace()({ id: scope.applicationId });
    const platform = createPlatform({
      applications: [app.registerApplication({ createAppContext: () => ({}) })],
      auth: { authenticate: () => ({ id: 'alice' }) },
      authorise: ({ permission }) => permission !== 'workcore.agents.toolPayloads.read',
      services,
    });
    await services.agentRuns!.create({ id: 'trace-1', scope, actorId: 'alice', agent: 'test', status: 'succeeded', createdAt: new Date().toISOString(), correlationId: 'corr' });
    await services.agentRuns!.appendEvent({
      id: 'trace-event-1', runId: 'trace-1', sequence: 1, createdAt: new Date().toISOString(), type: 'step.completed',
      data: { toolCalls: { truncated: true, preview: '[{"toolName":"private","input":{"secret":"DO_NOT_EXPOSE"}}]' } },
    });
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/agent-runs/trace-1/events?applicationId=trace-redaction&workspaceId=one', { headers: { 'x-actor': 'alice' } }));
    const body = await response.json() as { events: Array<{ data?: Record<string, unknown> }> };
    expect(JSON.stringify(body)).not.toContain('DO_NOT_EXPOSE');
    expect(body.events[0]?.data?.toolCalls).toBeUndefined();
  });

  it('prevents agent tools from starting after the run deadline', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'agent-deadline', id: 'one', name: 'One', actors: ['alice'] }] });
    let sideEffects = 0;
    services.agentEngine = {
      run: async ({ tools, finishTool }) => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        await tools[finishTool]!.execute({});
        return { finishReason: 'tool-calls', finishTool };
      },
    };
    const app = defineWorkspace()({
      id: 'agent-deadline',
      mutations: {
        start: { input: objectSchema, output: objectSchema, permission: [], api: true, handler: ({ operations }) => operations.enqueueAgent('slow', {}) },
        finish: { input: objectSchema, output: objectSchema, permission: [], handler: () => { sideEffects++; return {}; } },
      },
      agents: {
        slow: { input: objectSchema, permission: [], model: 'test/model', instructions: '', prompt: () => '', tools: [{ kind: 'mutation', operation: 'finish' }], finishWhen: { tool: 'mutation.finish' } },
      },
    });
    const platform = createPlatform({
      applications: [app.registerApplication({ createAppContext: () => ({}) })],
      auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) },
      services,
      operationTimeoutMs: 20,
    });
    const queued = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/mutate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: 'agent-deadline', workspaceId: 'one', operation: 'start', input: {} }),
    }));
    const { result: { runId } } = await queued.json() as { result: { runId: string } };
    const worker = platform.worker(); worker.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await worker.stop();
    expect(await services.agentRuns!.get({ applicationId: 'agent-deadline', workspaceId: 'one' }, runId)).toMatchObject({ status: 'failed', error: { code: 'OPERATION_TIMEOUT' } });
    expect(sideEffects).toBe(0);
  });

  it.each(['authorization', 'persistence'] as const)('does not enqueue an agent if its parent times out during %s', async (stage) => {
    const scope = { applicationId: 'enqueue-deadline', workspaceId: 'one' };
    const services = createMemoryState({ workspaces: [{ ...scope, id: 'one', name: 'One', actors: ['alice'] }] });
    let release!: () => void;
    let entered!: () => void;
    let finished!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const completed = new Promise<void>((resolve) => { finished = resolve; });
    const pause = async () => { entered(); await gate; };
    const create = services.agentRuns!.create;
    if (stage === 'persistence') services.agentRuns!.create = async (run) => { await create(run); await pause(); };
    const app = defineWorkspace()({
      id: scope.applicationId,
      mutations: {
        start: { input: objectSchema, output: objectSchema, api: true, permission: [], handler: async ({ operations }) => {
          try { return await operations.enqueueAgent('child', {}); }
          finally { finished(); }
        } },
        finish: { input: objectSchema, output: objectSchema, permission: [], handler: () => ({}) },
      },
      agents: { child: {
        input: objectSchema,
        permission: async () => { if (stage === 'authorization') await pause(); return true; },
        model: 'test', instructions: '', prompt: () => '',
        tools: [{ kind: 'mutation', operation: 'finish' }], finishWhen: { tool: 'mutation.finish' },
      } },
    });
    const platform = createPlatform({
      applications: [app.registerApplication({ createAppContext: () => ({}) })],
      auth: { authenticate: () => ({ id: 'alice' }) }, services, operationTimeoutMs: 20,
    });
    const response = platform.httpHandler({ apiBasePath: '/api' })(req('/mutate', { ...scope, operation: 'start', input: {} }));
    try {
      await started;
      expect((await response).status).toBe(504);
    } finally { release(); }
    await completed;
    expect(await services.tasks.list(scope, 10)).toEqual([]);
    const { runs } = await services.agentRuns!.list(scope, { limit: 10 });
    if (stage === 'authorization') expect(runs).toEqual([]);
    else expect(runs).toEqual([expect.objectContaining({ status: 'failed' })]);
  });

  it('exposes only api-enabled operations in a versioned manifest', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { handler } = fixture(services);
    const response = await handler(new Request('http://localhost/api/manifest?applicationId=counter&workspaceId=one', { headers: { 'x-actor': 'alice' } }));
    expect(response.status).toBe(200);
    const manifest = await response.json() as { protocolVersion: number; schemaDialect: string; operations: Array<{ name: string }> };
    expect(manifest.protocolVersion).toBe(1);
    expect(manifest.schemaDialect).toContain('2020-12');
    expect(manifest.operations.map(({ name }) => name)).toEqual(['value', 'increment', 'update']);
  });

  it('publishes configured admin pages and filters built-ins by system capability', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'dash', id: 'one', name: 'One', actors: ['alice'] }] });
    const app = defineWorkspace<AppContext>()({
      id: 'dash',
      admin: {
        defaultPage: 'overview',
        builtins: { schedules: false, agents: false },
        pages: { overview: { title: 'Overview', layout: 'two-column', blocks: [{ id: 'count', type: 'query', operation: 'value', input: {} }, { id: 'edit', type: 'mutation-form', operation: 'increment' }, { id: 'schedule-resource', type: 'resource', resource: 'schedules' }] } },
      },
      queries: { value: { input: objectSchema, output: numberSchema, api: true, permission: 'read', handler: ({ ctx }) => ctx.app.value.current } },
      mutations: { increment: { input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: ({ ctx }) => ++ctx.app.value.current } },
    });
    const platform = createPlatform({
      applications: [app.registerApplication({ createAppContext: () => ({ value: { current: 1 } }) })],
      auth: { authenticate: () => ({ id: 'alice' }) },
      authorise: ({ permission }) => permission !== 'workcore.history.read',
      services,
    });
    const manifest = await (await platform.httpHandler({ apiBasePath: '/api' })(req('/manifest?applicationId=dash&workspaceId=one'))).json();
    expect(manifest.defaultPage).toBe('overview');
    expect(manifest.pages.map((page: { id: string }) => page.id)).toEqual(['operations', 'tasks', 'overview']);
    expect(manifest.pages.at(-1).blocks.map((block: { id: string }) => block.id)).toEqual(['count', 'edit', 'schedule-resource']);
    expect(manifest.capabilities).toMatchObject({ tasksRead: true, schedulesRead: true, schedulesManage: true, historyRead: false });
  });

  it('publishes agent observability capabilities and strips unauthorized chat send metadata', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'chat-app', id: 'one', name: 'One', actors: ['alice'] }] });
    const chatQueryInput = schema<Record<string, unknown>>((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value));
    chatQueryInput['~standard'].jsonSchema.input = () => ({ type: 'object', properties: { conversationId: { type: 'string' } } });
    const sendInput = schema<Record<string, unknown>>((value): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value));
    sendInput['~standard'].jsonSchema.input = () => ({ type: 'object', properties: { message: { type: 'string' }, conversationId: { type: 'string' } }, required: ['message'] });
    const app = defineWorkspace<AppContext>()({
      id: 'chat-app',
      queries: {
        conversation: {
          input: chatQueryInput, output: objectSchema, api: true, permission: 'chat.read', handler: () => ({ conversation: { id: 'thread-1' }, messages: [] }),
          ui: { default: 'chat', variants: { chat: { title: 'Conversation', renderer: 'chat', chat: { sendMutation: 'sendMessage', messageInput: 'message', conversationIdInput: 'conversationId', conversationQueryInput: 'conversationId' } } } },
        },
      },
      mutations: { sendMessage: { input: sendInput, output: objectSchema, api: true, permission: 'chat.send', handler: () => ({ runId: 'run-1' }) } },
    });
    const platform = createPlatform({
      applications: [app.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })],
      auth: { authenticate: () => ({ id: 'alice' }) },
      authorise: ({ permission }) => permission !== 'chat.send' && permission !== 'workcore.agents.toolPayloads.read',
      services,
    });
    const response = await platform.httpHandler({ apiBasePath: '/api' })(req('/manifest?applicationId=chat-app&workspaceId=one'));
    const manifest = await response.json() as { pages: Array<{ id: string }>; capabilities: Record<string, boolean>; operations: Array<{ name: string; ui: { variants: Record<string, { renderer: string; chat?: unknown }> } | null }> };
    expect(manifest.pages.map((page) => page.id)).toContain('agents');
    expect(manifest.capabilities.agentRunsRead).toBe(true);
    expect(manifest.capabilities.agentToolPayloadsRead).toBe(false);
    expect(manifest.operations.map((operation) => operation.name)).toEqual(['conversation']);
    expect(manifest.operations[0]?.ui?.variants.chat).toMatchObject({ renderer: 'chat' });
    expect(manifest.operations[0]?.ui?.variants.chat).not.toHaveProperty('chat');
  });

  it('rejects unknown admin operation references at definition time', () => {
    expect(() => defineWorkspace<AppContext>()({
      id: 'invalid-admin',
      admin: { pages: { overview: { title: 'Overview', blocks: [{ id: 'bad', type: 'query', operation: 'missing' }] } } },
    })).toThrow(/unknown query operation 'missing'/);
  });

  it('distinguishes event delivery failure from a committed mutation and does not trigger work', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    services.events.publish = async () => { throw new Error('private redis connection details'); };
    let sideEffects = 0;
    const definition = defineWorkspace<AppContext>()({
      id: 'counter',
      mutations: { write: { input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: () => ++sideEffects } },
      tasks: { followUp: { input: objectSchema, output: numberSchema, api: true, permission: 'write', triggers: { mutations: ['write'] }, handler: () => 1 } },
    });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })], auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) }, authorise: () => true, services });
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/mutate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'write', input: {} }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).deliveryWarning).toBe('EVENT_DELIVERY_FAILED');
    expect(sideEffects).toBe(1);
    expect(await services.tasks.list({ applicationId: 'counter', workspaceId: 'one' }, 10)).toEqual([]);
    expect((await services.history.list({ applicationId: 'counter', workspaceId: 'one' }, 10))[0]?.status).toBe('delivery_failed');
  });

  it('rechecks workspace access when a queued actor reaches the worker', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
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
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
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
    const services = createMemoryState({ workspaces: [{ applicationId: 'transform', id: 'one', name: 'One', actors: ['alice'] }] });
    const definition = defineWorkspace<AppContext>()({ id: 'transform', mutations: {
      trigger: { input: objectSchema, output: numberSchema, api: true, permission: 'run', handler: () => 1 },
    }, tasks: {
      convert: { input: numericStringSchema, output: numberSchema, api: true, permission: 'run', triggers: { mutations: ['trigger'], mapInput: () => '43' }, handler: ({ input }) => input },
    } });
    const platform = createPlatform({
      applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })],
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
    const services = createMemoryState({ workspaces: [{ applicationId: 'slow-schedule', id: 'one', name: 'One', actors: ['alice'] }] });
    const definition = defineWorkspace<AppContext>()({ id: 'slow-schedule', tasks: {
      run: { input: objectSchema, output: numberSchema, api: true, permission: 'run', handler: () => 1 },
    } });
    const platform = createPlatform({
      applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })],
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
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    let access = true;
    let writes = 0;
    const definition = defineWorkspace<AppContext>()({ id: 'counter', mutations: {
      parent: { input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: async ({ operations }) => {
        access = false;
        return await operations.mutate('child', {} as never) as number;
      } },
      child: { input: objectSchema, output: numberSchema, api: true, permission: 'write', handler: () => ++writes },
    } });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })], auth: { authenticate: () => ({ id: 'alice' }) }, authorise: () => true, services });
    services.workspaces.canAccess = async (actor, scope) => access && scope.applicationId === 'counter' && scope.workspaceId === 'one' && actor.id === 'alice';
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/mutate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'parent', input: {} }) }));
    expect(response.status).toBe(403);
    expect(writes).toBe(0);
  });

  it('preserves provenance and stops chains created with internal task enqueue', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'chain', id: 'one', name: 'One', actors: ['alice'] }] });
    const observedPayloads: TaskPayload[] = [];
    const enqueue = services.tasks.enqueue;
    services.tasks.enqueue = async (payload) => { observedPayloads.push(payload); await enqueue(payload); };
    const definition = defineWorkspace<AppContext>()({ id: 'chain', tasks: {
      chain: { input: objectSchema, output: objectSchema, api: true, permission: 'run', handler: async ({ operations }) => { await operations.enqueue('chain', {}); return {}; } },
    } });
    const platform = createPlatform({
      applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })],
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
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
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
    const services = createMemoryState({ workspaces: [
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
    const services = createMemoryState({ workspaces: [{ ...scope, id: 'one', name: 'One', actors: ['alice'] }] });
    const { app } = fixture(services);
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    let resolving!: () => void;
    const started = new Promise<void>((resolve) => { resolving = resolve; });
    const platform = createPlatform({ applications: [app.registerApplication({ createAppContext: () => ({ value: { current: 1 } }) })],
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
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
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
    const services = createMemoryState();
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
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { platform } = fixture(services);
    let access = true;
    services.workspaces.canAccess = async () => access;
    const controller = new AbortController();
    const response = await platform.httpHandler({ apiBasePath: '/api' })(new Request('http://localhost/api/events?applicationId=counter&workspaceId=one', { headers: { 'x-actor': 'alice' }, signal: controller.signal }));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('ready');
    await services.events.publish({ id: 'invalidate', type: 'workspace.invalidated', applicationId: 'counter', workspaceId: 'one', executionId: 'e1', actorId: 'alice', correlationId: 'c1', createdAt: new Date().toISOString() });
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('invalidate');
    access = false;
    await services.events.publish({ id: 'revoke', type: 'mutation.succeeded', applicationId: 'counter', workspaceId: 'one', executionId: 'e2', actorId: 'alice', correlationId: 'c1', createdAt: new Date().toISOString() });
    const closed = await reader.read();
    expect(closed.done).toBe(true);
    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  it('negotiates a registered wire codec per request and preserves rich values', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'dates', id: 'one', name: 'One', actors: ['alice'] }] });
    const requested = new Date('2026-10-12T12:00:00.000Z');
    const definition = defineWorkspace<AppContext>()({ id: 'dates', queries: {
      echo: { input: dateSchema, output: dateSchema, api: true, permission: 'read', handler: ({ input }) => input },
      now: { input: objectSchema, output: dateSchema, api: true, permission: 'read', handler: () => requested },
    }, tasks: {
      later: { input: dateSchema, output: dateSchema, api: true, permission: 'run', handler: ({ input }) => input },
    } });
    const platform = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({ value: { current: 0 } }) })], auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) }, authorise: () => true, services, wireCodecs: [dateCodec] });
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
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
    const { handler } = fixture(services, () => false);
    const manifestResponse = await handler(new Request('http://localhost/api/manifest?applicationId=counter&workspaceId=one', { headers: { 'x-actor': 'alice' } }));
    expect((await manifestResponse.json()).operations).toEqual([]);
    const response = await handler(new Request('http://localhost/api/query', { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': 'alice' }, body: JSON.stringify({ applicationId: 'counter', workspaceId: 'one', operation: 'value', input: {} }) }));
    expect(response.status).toBe(403);
  });

  it('requires JSON Schema conversion before exposing schemas in the manifest', () => {
    const validationOnly = { '~standard': { validate: (value: unknown) => ({ value }) } } as never;
    expect(() => defineWorkspace<AppContext>()({ id: 'bad', queries: { read: { input: validationOnly, output: validationOnly, api: true, permission: 'read', handler: () => 1 } } }))
      .toThrow(/Standard JSON Schema/);
  });

  it('accepts only explicitly trusted reverse-proxy origins for state-changing calls', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'counter', id: 'one', name: 'One', actors: ['alice'] }] });
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

  it('distinguishes invalid handler output and reports history delivery failure without hiding committed results', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'outcomes', id: 'one', name: 'One', actors: ['alice'] }] });
    const app = defineWorkspace()({ id: 'outcomes', mutations: {
      invalid: { input: objectSchema, output: numberSchema, permission: [], api: true, handler: () => 'not a number' as never },
      valid: { input: objectSchema, output: numberSchema, permission: [], api: true, handler: () => 42 },
    } });
    const handler = createPlatform({
      applications: [app.registerApplication({ createAppContext: async () => ({}) })],
      auth: { authenticate: () => ({ id: 'alice' }) }, services,
    }).httpHandler({ apiBasePath: '/api' });
    const invoke = (operation: string) => handler(new Request(`http://localhost/api/mutate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: 'outcomes', workspaceId: 'one', operation, input: {} }),
    }));
    const invalid = await invoke('invalid');
    expect(invalid.status).toBe(500);
    expect(await invalid.json()).toMatchObject({ error: { code: 'OUTPUT_VALIDATION_FAILED', message: expect.stringContaining('side effects may already have occurred') } });
    services.history.append = async () => { throw new Error('private storage detail'); };
    const valid = await invoke('valid');
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ result: 42, deliveryWarning: 'HISTORY_PERSISTENCE_FAILED', deliveryWarnings: ['HISTORY_PERSISTENCE_FAILED'] });
  });

  it('aborts timed-out handlers and lets worker shutdown finish promptly', async () => {
    const services = createMemoryState({ workspaces: [{ applicationId: 'deadlines', id: 'one', name: 'One', actors: ['alice'] }] });
    const app = defineWorkspace()({ id: 'deadlines', queries: {
      tooLong: { input: objectSchema, output: numberSchema, permission: [], api: true, handler: () => new Promise<number>(() => {}) },
    }, tasks: {
      stuck: { input: objectSchema, output: numberSchema, permission: [], api: true, handler: ({ ctx }) => new Promise<number>((_resolve, reject) => ctx.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) },
    } });
    const platform = createPlatform({
      applications: [app.registerApplication({ createAppContext: async () => ({}) })],
      auth: { authenticate: () => ({ id: 'alice' }), resolveActor: (id) => ({ id }) },
      services, operationTimeoutMs: 50, shutdownTimeoutMs: 25,
    });
    const handler = platform.httpHandler({ apiBasePath: '/api' });
    const timedOut = await handler(new Request('http://localhost/api/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: 'deadlines', workspaceId: 'one', operation: 'tooLong', input: {} }),
    }));
    expect(timedOut.status).toBe(504);
    expect(await timedOut.json()).toMatchObject({ error: { code: 'OPERATION_TIMEOUT' } });
    const queued = await handler(new Request('http://localhost/api/enqueue', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ applicationId: 'deadlines', workspaceId: 'one', operation: 'stuck', input: {} }),
    }));
    expect(queued.status).toBe(202);
    const worker = platform.worker();
    worker.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const started = Date.now();
    await worker.stop();
    expect(Date.now() - started).toBeLessThan(250);
  });
});
