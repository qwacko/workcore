import { describe, expect, it, vi } from 'vitest';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { composeApplication, createMemoryState, createPlatform, defineModule, type AgentEngine } from './index.js';

function schema<I, O = I>(validate: (value: unknown) => StandardSchemaV1.Result<O>, json: Record<string, unknown> = { type: 'object' }, output = json) {
  return { '~standard': { version: 1 as const, vendor: 'composition-tests', types: undefined as unknown as { input: I; output: O }, validate, jsonSchema: { input: () => json, output: () => output } } };
}
const empty = schema<Record<string, unknown>>((value) => ({ value: value as Record<string, unknown> }));
const text = schema<string>((value) => typeof value === 'string' ? { value } : { issues: [{ message: 'Expected string' }] }, { type: 'string' });
const numericText = schema<string, number>((value) => typeof value === 'string' ? { value: Number(value) } : { issues: [{ message: 'Expected numeric text' }] }, { type: 'string' }, { type: 'number' });
const scope = { applicationId: 'composed', workspaceId: 'one' };
const state = () => createMemoryState({ workspaces: ['one', 'two'].map((id) => ({ applicationId: scope.applicationId, id, name: id, actors: ['alice', 'bob'] })) });
const auth = { authenticate: (request: Request) => ({ id: request.headers.get('x-actor') ?? 'alice' }), resolveActor: (id: string) => ({ id }) };
const request = (operation: string, input: unknown = {}, path = 'query', workspaceId = 'one', actorId = 'alice') => new Request(`http://localhost/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': actorId }, body: JSON.stringify({ ...scope, workspaceId, operation, input }) });

describe('lightweight module composition', () => {
  it('rejects missing/invalid wiring, unsafe namespaces and non-module objects at definition time', () => {
    const module = defineModule<{}, { read: () => Promise<string> }>()({ id: 'reader', requires: { read: true } });
    expect(() => composeApplication<{}>()({ id: 'composed', modules: { reader: module } } as never)).toThrow('Missing dependency binding');
    expect(() => composeApplication<{}>()({ id: 'composed', modules: { reader: module }, dependencies: { unknown: () => ({}) } } as never)).toThrow('unknown module');
    expect(() => composeApplication<{}>()({ id: 'composed', modules: { reader: module }, dependencies: { reader: 42 } } as never)).toThrow('must be a function');
    const plain = defineModule<{}>()({ id: 'plain' });
    for (const namespace of ['bad.name', 'constructor', 'prototype']) expect(() => composeApplication<{}>()({ id: 'composed', modules: { [namespace]: plain } })).toThrow('Invalid local module');
    expect(() => composeApplication<{}>()({ id: 'composed', modules: { plain: {} } } as never)).toThrow('must be created with defineModule');
    expect(() => defineModule<{}>()({ id: 'bad', queries: { 'bad.name': { input: empty, output: empty, handler: () => ({}) } } })).toThrow('Invalid local queries');
    expect(() => defineModule<{}>()({ id: 'bad', admin: { builtins: { history: false } } } as never)).toThrow('pages only');
    expect(() => defineModule<{}>()({ id: 'bad', authorization: {} } as never)).toThrow('authorization belongs');
  });

  it('checks required resolved dependencies before the handler has side effects', async () => {
    const handler = vi.fn(() => 'unreachable');
    const module = defineModule<{}, { read: () => Promise<string> }>()({ id: 'reader', requires: { read: true }, queries: { read: { input: empty, output: text, permission: [], api: true, handler } } });
    for (const resolved of [undefined, [], {}]) {
      const definition = composeApplication<{}>()({ id: 'composed', modules: { reader: module }, dependencies: { reader: () => resolved } } as never);
      const handle = createPlatform({ applications: [definition.registerApplication({ createAppContext: () => ({}) })], auth, services: state() }).httpHandler({ apiBasePath: '/api' });
      expect((await handle(request('reader.read'))).status).toBe(422);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it('allows optional callbacks to be absent and awaits them when explicitly wired', async () => {
    const callback = vi.fn(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    const module = defineModule<{}, { after?: (value: string) => Promise<void> }>()({ id: 'callbacks', mutations: {
      write: { input: text, output: text, api: true, permission: [], handler: async ({ input, dependencies }) => { await dependencies.after?.(input); return input; } },
    } });
    const app = composeApplication<{}>()({ id: 'composed', modules: { plain: module, wired: module }, dependencies: { wired: () => ({ after: callback }) } });
    const handle = createPlatform({ applications: [app.registerApplication({ createAppContext: () => ({}) })], auth, services: state() }).httpHandler({ apiBasePath: '/api' });
    expect((await handle(request('plain.write', 'plain', 'mutate'))).status).toBe(200);
    expect(callback).not.toHaveBeenCalled();
    expect((await handle(request('wired.write', 'wired', 'mutate'))).status).toBe(200);
    expect(callback).toHaveResolvedWith(undefined);
    expect(callback).toHaveBeenCalledWith('wired');
  });

  it('keeps reused module KV separate by namespace and workspace and enriches logs', async () => {
    const info = vi.fn();
    const services = state();
    services.logger = { debug() {}, info, warn() {}, error() {} };
    const module = defineModule<{}>()({ id: 'cache', queries: { read: { input: empty, output: text, permission: [], api: true, handler: async ({ ctx }) => await ctx.services.kv.get<string>('same') ?? 'empty' } }, mutations: {
      write: { input: text, output: text, permission: [], api: true, handler: async ({ ctx, input }) => { await ctx.services.kv.set('same', input); ctx.services.logger.info('write', { module: 'cannot-spoof' }); return input; } },
    } });
    const app = composeApplication<{}>()({ id: 'composed', modules: { first: module, second: module } });
    const handle = createPlatform({ applications: [app.registerApplication({ createAppContext: () => ({}) })], auth, services }).httpHandler({ apiBasePath: '/api' });
    await handle(request('first.write', 'first', 'mutate'));
    await handle(request('second.write', 'second', 'mutate'));
    expect(await (await handle(request('first.read'))).json()).toMatchObject({ result: 'first' });
    expect(await (await handle(request('second.read'))).json()).toMatchObject({ result: 'second' });
    expect(await (await handle(request('first.read', {}, 'query', 'two'))).json()).toMatchObject({ result: 'empty' });
    expect(info).toHaveBeenCalledWith('write', { module: 'first' });
    expect(info).toHaveBeenCalledWith('write', { module: 'second' });
    expect((module as unknown as { registerApplication?: unknown }).registerApplication).toBeUndefined();
  });

  it('binds dependencies per execution without leaking request, actor or scope across concurrent calls', async () => {
    const module = defineModule<{}, { identity: () => string }>()({ id: 'identity', requires: { identity: true }, queries: {
      read: { input: empty, output: text, api: true, permission: [], handler: ({ dependencies }) => dependencies.identity() },
    } });
    const app = composeApplication<{}>()({ id: 'composed', modules: { identity: module }, dependencies: {
      identity: async ({ ctx }) => {
        await new Promise((resolve) => setTimeout(resolve, ctx.actor.id === 'alice' ? 10 : 1));
        return { identity: () => `${ctx.actor.id}/${ctx.scope.workspaceId}/${ctx.request?.headers.get('x-actor')}/${ctx.signal.aborted}` };
      },
    } });
    const handle = createPlatform({ applications: [app.registerApplication({ createAppContext: () => ({}) })], auth, services: state() }).httpHandler({ apiBasePath: '/api' });
    const [alice, bob] = await Promise.all([handle(request('identity.read', {}, 'query', 'one', 'alice')), handle(request('identity.read', {}, 'query', 'two', 'bob'))]);
    expect(await alice.json()).toMatchObject({ result: 'alice/one/alice/false' });
    expect(await bob.json()).toMatchObject({ result: 'bob/two/bob/false' });
  });

  it('uses checked local calls and applies transforms once through the composed catalog', async () => {
    const module = defineModule<{}>()({ id: 'math', queries: {
      value: { input: numericText, output: numericText, api: true, permission: [], handler: ({ input }) => String(input + 1) },
      sibling: { input: empty, output: numericText, api: true, permission: [], handler: async ({ operations }) => String(await operations.query('value', '41')) },
    } });
    const app = composeApplication<{}>()({ id: 'composed', modules: { math: module } });
    const handle = createPlatform({ applications: [app.registerApplication({ createAppContext: () => ({}) })], auth, services: state() }).httpHandler({ apiBasePath: '/api' });
    expect(await (await handle(request('math.sibling'))).json()).toMatchObject({ result: 42 });
    expect((await handle(request('math.value', 41))).status).toBe(400);
  });

  it('qualifies local mutation triggers but supplies local provenance to their input mapper', async () => {
    const services = state();
    const mapper = vi.fn((event: WorkcoreEventForTest) => event.operation);
    const module = defineModule<{}>()({ id: 'workflow',
      mutations: { touch: { input: empty, output: text, api: true, permission: [], handler: () => 'done' } },
      queries: { suffix: { input: empty, output: text, permission: [], handler: () => ':checked' } },
      tasks: { followup: { input: text, output: text, version: 2, permission: [], triggers: { mutations: ['touch'], mapInput: mapper }, handler: async ({ input, operations }) => input + await operations.query('suffix', {}) } },
    });
    const app = composeApplication<{}>()({ id: 'composed', modules: { workflow: module } });
    const platform = createPlatform({ applications: [app.registerApplication({ createAppContext: () => ({}) })], auth, services });
    await platform.httpHandler({ apiBasePath: '/api' })(request('workflow.touch', {}, 'mutate'));
    expect(mapper).toHaveBeenCalledWith(expect.objectContaining({ operation: 'touch', applicationId: 'composed', workspaceId: 'one' }));
    const payload = await services.tasks.claim();
    expect(payload).toMatchObject({ operation: 'workflow.followup', operationVersion: 2, input: 'touch' });
    await services.tasks.release(payload!.id);
    const worker = platform.worker();
    worker.start();
    try { await vi.waitFor(async () => expect((await services.tasks.list(scope, 10))[0]).toMatchObject({ status: 'succeeded', result: 'touch:checked' })); }
    finally { await worker.stop(); }
  });

  it('qualifies agent tools and local enqueueAgent while resolving prompt dependencies in the worker', async () => {
    const services = state();
    const engine: AgentEngine = { run: vi.fn(async (args) => {
      expect(args.prompt).toBe('hello alice');
      expect(args.finishTool).toBe('mutation.assistant.finish');
      await args.tools['mutation.assistant.finish']!.execute('finished');
      return { finishReason: 'tool-calls', finishTool: args.finishTool };
    }) };
    services.agentEngine = engine;
    const module = defineModule<{}, { greeting: () => string }>()({ id: 'agent', requires: { greeting: true },
      mutations: {
        finish: { input: text, output: text, permission: [], handler: ({ input }) => input },
        start: { input: empty, output: schema<{ runId: string }>((value) => ({ value: value as { runId: string } })), api: true, permission: [], handler: ({ operations }) => operations.enqueueAgent('helper', {}) },
      },
      agents: { helper: { input: empty, permission: [], model: 'test', instructions: '', prompt: ({ dependencies }) => dependencies.greeting(), tools: [{ kind: 'mutation', operation: 'finish' }], finishWhen: { tool: 'mutation.finish' } } },
    });
    const app = composeApplication<{}>()({ id: 'composed', modules: { assistant: module }, dependencies: { assistant: ({ ctx }) => ({ greeting: () => `hello ${ctx.actor.id}` }) } });
    const platform = createPlatform({ applications: [app.registerApplication({ createAppContext: () => ({}) })], auth, services });
    const response = await platform.httpHandler({ apiBasePath: '/api' })(request('assistant.start', {}, 'mutate'));
    const { result } = await response.json() as { result: { runId: string } };
    const worker = platform.worker();
    worker.start();
    try { await vi.waitFor(async () => expect(await services.agentRuns!.get(scope, result.runId)).toMatchObject({ status: 'succeeded', agent: 'assistant.helper', result: 'finished' })); }
    finally { await worker.stop(); }
  });

  it('namespaces views, collection editors/actions and module page blocks without mutating reuse', () => {
    const row = { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] };
    const edit = schema<{ id: string }>((value) => ({ value: value as { id: string } }), row);
    const page = schema<{ rows: { id: string }[]; nextCursor: null }>((value) => ({ value: value as { rows: { id: string }[]; nextCursor: null } }), { type: 'object', properties: { rows: { type: 'array', items: row }, nextCursor: { type: 'null' } } });
    const filters = schema<{ limit: number; cursor?: string }>((value) => ({ value: value as { limit: number; cursor?: string } }), { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, cursor: { type: 'string' } }, required: ['limit'] });
    const module = defineModule<{}>()({ id: 'views',
      queries: { rows: { input: filters, output: page, api: true, permission: [], views: { default: 'table', variants: { table: { title: 'Rows', renderer: 'table', rowKey: 'id', columns: ['id'], actions: [{ label: 'Edit', mutation: 'edit', bind: { id: { fromRow: 'id' } } }], collection: { itemKey: 'id', columns: [{ field: 'id' }], editor: { mutation: 'edit' }, actions: [{ label: 'Edit', mutation: 'edit' }] } } } }, handler: () => ({ rows: [], nextCursor: null }) } },
      mutations: { edit: { input: edit, output: edit, api: true, permission: [], handler: ({ input }) => input } },
      admin: ({ queries }) => ({ pages: { home: { title: 'Home', blocks: [queries.rows.view('table', { id: 'rows', input: { limit: 10 } }), { id: 'edit', type: 'mutation-form', operation: 'edit' }] } } }),
    });
    const app = composeApplication<{}>()({ id: 'composed', modules: { first: module, second: module }, admin: { defaultPage: 'second.home' } });
    expect(app.queries['first.rows'].views?.variants.table?.collection?.editor?.mutation).toBe('first.edit');
    expect(app.queries['second.rows'].views?.variants.table?.actions?.[0]?.mutation).toBe('second.edit');
    expect(module.queries.rows.views?.variants.table?.actions?.[0]?.mutation).toBe('edit');
    expect(app.admin?.pages?.['first.home']?.blocks).toContainEqual(expect.objectContaining({ operation: 'first.edit' }));
    expect(() => composeApplication<{}>()({ id: 'composed', modules: { first: module }, admin: { pages: { 'first.home': { title: 'Collision', blocks: [] } } } })).toThrow('Duplicate composed admin page');
  });

  it('qualifies chat composer, action and thread-query references without rewriting custom component data', () => {
    const input = schema<Record<string, string>>((value) => ({ value: value as Record<string, string> }), { type: 'object', properties: { message: { type: 'string' }, threadId: { type: 'string' } } });
    const module = defineModule<{}>()({ id: 'chat',
      queries: { timeline: { input, output: empty, api: true, permission: [], handler: () => ({}), views: { default: 'chat', variants: { chat: {
        title: 'Chat', renderer: 'chat',
        chat: { sendMutation: 'send', messageInput: 'message', actions: { retry: { mutation: 'send' } } },
        chatActions: { retry: { mutation: 'send' } },
        chatList: { threadQuery: 'timeline', threadIdInput: 'threadId' },
      } } } } },
      mutations: { send: { input, output: empty, api: true, permission: [], handler: () => ({}) } },
      admin: { pages: { home: { title: 'Chat', blocks: [{ id: 'custom', type: 'custom', component: 'chat/widget', version: 1, props: { query: 'unchanged' } }] } } },
    });
    const app = composeApplication<{}>()({ id: 'composed', modules: { messages: module } });
    expect(app.queries['messages.timeline'].views?.variants.chat).toMatchObject({
      chat: { sendMutation: 'messages.send', actions: { retry: { mutation: 'messages.send' } } },
      chatActions: { retry: { mutation: 'messages.send' } },
      chatList: { threadQuery: 'messages.timeline' },
    });
    expect(app.admin?.pages?.['messages.home']?.blocks[0]).toMatchObject({ component: 'chat/widget', props: { query: 'unchanged' } });
  });
});

type WorkcoreEventForTest = { operation: string };
