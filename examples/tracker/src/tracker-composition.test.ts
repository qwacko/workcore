import { describe, expect, it, vi } from 'vitest';
import { createClient, createFetchTransport, validateSemanticInterface } from '@workcore/client';
import { superjsonCodec } from '@workcore/codec-superjson';
import { createMemoryState, createPlatform, type Scope } from '@workcore/core';
import { tracker } from './app.js';
import type { Activity, Conversation, ConversationMessage, TrackerContext } from './tracker-types.js';
import { miloDemoEngine } from './milo-demo-engine.js';

function fixture() {
  const activities = new Map<string, Activity[]>([
    ['team', [{ id: 'one', title: 'Team hike', status: 'planned', updatedAt: new Date() }, { id: 'two', title: 'Trail cleanup', status: 'complete', updatedAt: new Date() }]],
    ['personal', [{ id: 'private', title: 'Private run', status: 'planned', updatedAt: new Date() }]],
  ]);
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, ConversationMessage[]>();
  const key = (scope: Scope, actor: string, id: string) => JSON.stringify([scope.applicationId, scope.workspaceId, actor, id]);
  const services = createMemoryState({ workspaces: [
    { applicationId: 'tracker', id: 'team', name: 'Team', actors: ['alice', 'bob'] },
    { applicationId: 'tracker', id: 'personal', name: 'Personal', actors: ['alice'] },
  ] });
  const engine = vi.fn(miloDemoEngine.run);
  services.agentEngine = { run: engine };
  const context: TrackerContext = {
    activities: {
      async list(scope, input) {
        const rows = (activities.get(scope.workspaceId) ?? []).filter((row) => (!input.status || row.status === input.status) && (!input.search || row.title.includes(input.search)));
        const start = Number(input.cursor ?? 0);
        return { rows: rows.slice(start, start + input.limit), nextCursor: start + input.limit < rows.length ? String(start + input.limit) : null, totalCount: rows.length };
      },
      async update(scope, input) {
        const row = activities.get(scope.workspaceId)?.find((item) => item.id === input.id);
        if (!row) throw new Error('Not found');
        Object.assign(row, input, { updatedAt: new Date() });
        return row;
      },
    },
    agentRuns: services.agentRuns!,
    conversations: {
      async latest(scope, actor) { return [...conversations.entries()].find(([id]) => id.startsWith(JSON.stringify([scope.applicationId, scope.workspaceId, actor]).slice(0, -1) + ','))?.[1]; },
      async get(scope, actor, id) { return conversations.get(key(scope, actor, id)); },
      async create(scope, actor, conversation) { conversations.set(key(scope, actor, conversation.id), conversation); },
      async listMessages(scope, actor, id, limit) { return (messages.get(key(scope, actor, id)) ?? []).slice(-limit); },
      async addMessage(scope, actor, message) {
        const id = key(scope, actor, message.conversationId);
        if (!conversations.has(id)) throw new Error('Conversation not found');
        messages.set(id, [...(messages.get(id) ?? []), message]);
      },
      async linkRun(scope, actor, id, messageId, runId) { const message = messages.get(key(scope, actor, id))?.find((item) => item.id === messageId); if (message) message.runId = runId; },
      async completeAssistant(scope, actor, id, messageId, text) { const message = messages.get(key(scope, actor, id))?.find((item) => item.id === messageId); if (message) Object.assign(message, { text, status: 'complete' }); },
      async failAssistant(scope, actor, id, messageId) { const message = messages.get(key(scope, actor, id))?.find((item) => item.id === messageId); if (message) message.status = 'failed'; },
    },
  };
  const platform = createPlatform({
    applications: [tracker.registerApplication({ createAppContext: () => context, resolveAuthorization: ({ actor }) => ({ userId: actor.id, role: actor.id === 'bob' ? 'viewer' : 'owner', isAdmin: false }) })],
    auth: { authenticate: (request) => ({ id: request.headers.get('x-actor') ?? 'alice' }), resolveActor: (id) => ({ id }) },
    services, wireCodecs: [superjsonCodec()],
  });
  const handle = platform.httpHandler();
  const transport = (actor = 'alice') => createFetchTransport({ baseUrl: 'http://localhost/workcore/api', codec: superjsonCodec(), headers: { 'x-actor': actor }, fetch: (url, init) => handle(new Request(url, init)) });
  const client = (workspaceId = 'team', actor = 'alice') => createClient<typeof tracker>({ applicationId: 'tracker', workspaceId, transport: transport(actor) });
  return { platform, services, context, client, transport, engine };
}

describe('the composed tracker reference application', () => {
  it('exposes module and cross-module pages while keeping shared capabilities internal', async () => {
    const { transport } = fixture();
    const manifest = await transport().manifest('tracker', 'team');
    expect(() => validateSemanticInterface(manifest)).not.toThrow();
    expect(manifest.interface.pages.map((page) => page.id)).toEqual(expect.arrayContaining(['activities.search', 'assistant.campfire', 'activityDashboard', 'workspaceOverview']));
    expect(manifest.interface.pages.find((page) => page.id === 'workspaceOverview')?.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation: 'activities.list' }), expect.objectContaining({ operation: 'assistant.conversation' }),
    ]));
    const operations = manifest.operations.map((operation) => operation.name);
    expect(operations).toContain('activities.edit');
    expect(operations).toContain('assistant.sendMessage');
    for (const internal of ['activities.summary', 'assistant.activitySummary', 'assistant.activityUpdated', 'assistant.saveReply']) expect(operations).not.toContain(internal);
    await expect(transport().request({ path: 'mutate', applicationId: 'tracker', workspaceId: 'team', operation: 'assistant.activityUpdated', input: {} })).rejects.toMatchObject({ code: 'OPERATION_NOT_FOUND' });
    const viewer = await transport('bob').manifest('tracker', 'team');
    expect(viewer.operations.some((operation) => operation.name === 'activities.edit')).toBe(false);
    expect(viewer.interface.operationViews.find((view) => view.operation === 'activities.list')?.variants.basic?.collection?.editor).toBeUndefined();
  });

  it('awaits the optional assistant update callback and keeps its KV in the same workspace', async () => {
    const { client, services } = fixture();
    const updated = await client().mutate('activities.edit', { id: 'one', title: 'New trail plan', status: 'complete' });
    expect(updated.updatedAt).toBeInstanceOf(Date);
    const noteKey = '@workcore/module/["assistant","latest-activity-update"]';
    expect(await services.kv.get({ applicationId: 'tracker', workspaceId: 'team' }, noteKey)).toEqual({ ...updated, updatedAt: updated.updatedAt.toISOString() });
    expect(await services.kv.get({ applicationId: 'tracker', workspaceId: 'personal' }, noteKey)).toBeUndefined();
    await expect(client('team', 'bob').mutate('activities.edit', { id: 'one', title: 'Denied', status: 'planned' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await client().query('activities.list', { limit: 10 })).rows[0]?.title).toBe('New trail plan');
  });

  it('refreshes summaries through local checked calls and gives Milo required cross-module context', async () => {
    const { client, services, platform, engine } = fixture();
    await client().mutate('activities.edit', { id: 'one', title: 'Finished hike', status: 'complete' });
    const turn = await client().mutate('assistant.sendMessage', { message: 'How are my activities looking?' });
    const worker = platform.worker();
    worker.start();
    try {
      await vi.waitFor(async () => expect(await services.agentRuns!.get({ applicationId: 'tracker', workspaceId: 'team' }, turn.runId)).toMatchObject({ agent: 'assistant.milo', status: 'succeeded' }), { timeout: 4000 });
      expect(await services.kv.get({ applicationId: 'tracker', workspaceId: 'team' }, '@workcore/module/["activities","activity-summary"]')).toEqual({ total: 2, complete: 2, planned: 0 });
      const prompt = JSON.parse(engine.mock.calls[0]![0].prompt);
      expect(prompt).toMatchObject({ activitySummary: { total: 2, complete: 2, planned: 0 }, latestActivityUpdate: { title: 'Finished hike', status: 'complete' } });
      expect(engine.mock.calls[0]![0].finishTool).toBe('mutation.assistant.saveReply');
      const page = await client().query('assistant.conversation', { conversationId: turn.conversationId });
      expect(page.items[1]).toMatchObject({ role: 'assistant', parts: [{ type: 'text', text: expect.stringContaining('2 activities: 2 complete and 0 planned') }] });
      const unrelated = await client('personal').query('assistant.conversation', { conversationId: turn.conversationId });
      expect(unrelated.conversation).toBeNull();
      const otherActor = await client('team', 'bob').query('assistant.conversation', { conversationId: turn.conversationId });
      expect(otherActor.conversation).toBeNull();
    } finally { await worker.stop(); }
  });
});
