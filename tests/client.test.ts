import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionDispatcher, createClient } from '../packages/client/src/index.js';
import type { tracker } from '../examples/workcore-demo/src/app.js';
import { randomUUID } from '../packages/client/src/uuid.js';

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  messages: any[] = [];
  constructor(readonly url: URL) {
    super();
    FakeSocket.instances.push(this);
  }
  open() {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  send(data: string) {
    this.messages.push(JSON.parse(data));
  }
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  close(code = 1000) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSocket.instances = [];
});

describe('typed browser client lifecycle', () => {
  it('supports subscriptions, writes, enqueues and stable retries without secure-context randomUUID', async () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal('crypto', { getRandomValues });
    vi.stubGlobal('WebSocket', FakeSocket);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ data: 'created', revision: 1 }));
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      fetch: fetcher,
    });
    const subscription = client.subscribe('tasks', {}, () => {});
    FakeSocket.instances[0]!.open();
    const subscriptionId = FakeSocket.instances[0]!.messages[0].id;
    await client.mutate('createTask', { title: 'LAN task' });
    await client.enqueue('assistant', {});
    const actions = createActionDispatcher(client);
    fetcher.mockResolvedValueOnce(
      Response.json({ error: { code: 'TEMPORARY', message: 'Retry' } }, { status: 503 }),
    );
    await expect(
      actions.execute('lan-form', { kind: 'mutation', name: 'createTask' }, { title: 'Retry' }),
    ).rejects.toThrow('Retry');
    await actions.execute('lan-form', { kind: 'mutation', name: 'createTask' }, { title: 'Retry' });
    const ids = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init!.body)).requestId);
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const id of [subscriptionId, ...ids]) expect(id).toMatch(uuidV4);
    expect(new Set([subscriptionId, ids[0], ids[1], ids[2]]).size).toBe(4);
    expect(ids[3]).toBe(ids[2]);
    actions.close();
    subscription.unsubscribe();
    client.close();
  });
  it('sets UUID version and variant bits when falling back to getRandomValues', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
    expect(randomUUID()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });
  it('shares stable mutation/job retry IDs across renderer implementations', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'TEMPORARY', message: 'Retry' } }, { status: 503 }),
      )
      .mockImplementation(async () => Response.json({ data: { id: 'task' }, revision: 1 }));
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      fetch: fetcher,
    });
    const actions = createActionDispatcher(client);
    const operation = { kind: 'mutation' as const, name: 'createTask' };
    const input = { title: 'Stable retry' };
    await expect(actions.execute('task-form', operation, input)).rejects.toThrow('Retry');
    await actions.execute('task-form', operation, input);
    const retryRequest = JSON.parse(String(fetcher.mock.calls[0]![1]!.body));
    const secondRequest = JSON.parse(String(fetcher.mock.calls[1]![1]!.body));
    expect(secondRequest.requestId).toBe(retryRequest.requestId);
    await actions.execute('task-form', operation, { title: 'Intentional new input' });
    const thirdRequest = JSON.parse(String(fetcher.mock.calls[2]![1]!.body));
    expect(thirdRequest.requestId).not.toBe(retryRequest.requestId);
    actions.close();
    client.close();
  });
  it('sends stable request IDs, reports server errors and rejects lossy input', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: 'created', revision: 2 }));
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      fetch: fetcher,
    });
    expect(await client.mutate('createTask', { title: 'One' }, 'stable')).toEqual({
      data: 'created',
      revision: 2,
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({
      requestId: 'stable',
    });
    await expect(client.mutate('createTask', { title: new Date() } as any)).rejects.toThrow(
      'plain JSON',
    );
    fetcher.mockResolvedValue(
      Response.json({ error: { code: 'CONFLICT', message: 'Changed' } }, { status: 409 }),
    );
    await expect(
      client.mutate('completeTask', { id: 'one', expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    fetcher.mockResolvedValue(
      Response.json({ id: 'run', status: 'failed', error: 'EXECUTION_FAILED' }),
    );
    expect(await client.inspect('run:run')).toMatchObject({ error: 'EXECUTION_FAILED' });
    client.close();
  });
  it('multiplexes subscriptions, ignores stale snapshots and waits for observed revisions', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      subscriptions: { keepAliveMs: 0 },
    });
    const listener = vi.fn();
    const tasks = client.subscribe('tasks', {}, listener);
    const summary = client.subscribe('summary', {}, () => {});
    const socket = FakeSocket.instances[0]!;
    expect(FakeSocket.instances).toHaveLength(1);
    socket.open();
    const id = socket.messages[0].id;
    socket.receive({ type: 'snapshot', id, data: [], revision: 5 });
    const observed = tasks.whenRevision(6);
    socket.receive({ type: 'snapshot', id, data: ['stale'], revision: 4 });
    expect(tasks.state).toMatchObject({ data: [], revision: 5 });
    socket.receive({ type: 'revision', id, revision: 6 });
    await observed;
    tasks.unsubscribe();
    summary.unsubscribe();
    expect(socket.readyState).toBe(3);
    client.close();
  });
  it('resubscribes after reconnect and clears sensitive data on policy errors', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
    });
    const tasks = client.subscribe('tasks', {}, () => {});
    const first = FakeSocket.instances[0]!;
    first.open();
    first.receive({ type: 'snapshot', id: first.messages[0].id, data: ['private'], revision: 3 });
    first.close(1006);
    expect(tasks.state.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(500);
    const second = FakeSocket.instances[1]!;
    second.open();
    second.receive({
      type: 'error',
      id: second.messages[0].id,
      error: { code: 'FORBIDDEN', message: 'Revoked' },
    });
    expect(tasks.state).toMatchObject({
      status: 'error',
      revision: 0,
      error: { code: 'FORBIDDEN' },
    });
    expect(tasks.state.data).toBeUndefined();
    await expect(tasks.whenRevision(4)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    client.close();
  });
});

describe('client-scoped shared reads', () => {
  it('shares a live resource by canonical input while observers keep independent lifecycles', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
    });
    const aListener = vi.fn(),
      bListener = vi.fn();
    const a = client.subscribe(
      'stateScopedTasks',
      { projectId: 'inbox', status: 'open' },
      aListener,
    );
    const socket = FakeSocket.instances[0]!;
    socket.open();
    const id = socket.messages[0].id;
    socket.receive({ type: 'snapshot', id, data: [{ id: 'one' }], revision: 3 });
    const b = client.subscribe(
      'stateScopedTasks',
      { status: 'open', projectId: 'inbox' },
      bListener,
    );
    expect(socket.messages.filter((m) => m.type === 'subscribe')).toHaveLength(1);
    expect(bListener).toHaveBeenCalledExactlyOnceWith({
      status: 'live',
      data: [{ id: 'one' }],
      revision: 3,
    });
    const ended = a.whenRevision(4);
    a.unsubscribe();
    await expect(ended).rejects.toMatchObject({ code: 'UNSUBSCRIBED' });
    socket.receive({ type: 'snapshot', id, data: [{ id: 'two' }], revision: 4 });
    expect(a.state.status).toBe('error');
    expect(aListener).toHaveBeenCalledTimes(2);
    expect(b.state.data).toEqual([{ id: 'two' }]);
    await b.whenRevision(4);
    await vi.advanceTimersByTimeAsync(2000);
    expect(socket.messages.filter((m) => m.type === 'unsubscribe')).toHaveLength(0);
    b.unsubscribe();
    client.close();
    expect(b.state).toMatchObject({ status: 'error' });
  });
  it('hands off subscriptions without churn, then reuses an inactive preview while revalidating', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
    });
    const a = client.subscribe('tasks', {}, () => {});
    const first = FakeSocket.instances[0]!;
    first.open();
    first.receive({ type: 'snapshot', id: first.messages[0].id, data: ['current'], revision: 5 });
    a.unsubscribe();
    await vi.advanceTimersByTimeAsync(500);
    const b = client.subscribe('tasks', {}, () => {});
    expect(b.state).toEqual({ status: 'live', data: ['current'], revision: 5 });
    expect(first.messages).toHaveLength(1);
    b.unsubscribe();
    await vi.advanceTimersByTimeAsync(1000);
    expect(first.messages.filter((m) => m.type === 'unsubscribe')).toHaveLength(1);
    expect(first.readyState).toBe(3);
    const cached = vi.fn();
    const c = client.subscribe('tasks', {}, cached);
    expect(cached).toHaveBeenCalledExactlyOnceWith({
      status: 'reconnecting',
      data: ['current'],
      revision: 0,
    });
    const second = FakeSocket.instances[1]!;
    second.open();
    second.receive({ type: 'snapshot', id: second.messages[0].id, data: ['fresh'], revision: 6 });
    expect(c.state).toEqual({ status: 'live', data: ['fresh'], revision: 6 });
    c.unsubscribe();
    client.close();
  });
  it('bounds inactive cache entries and expires them', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      subscriptions: { keepAliveMs: 0, cacheTimeMs: 50, maxCached: 1 },
    });
    for (const taskId of ['one', 'two']) {
      const sub = client.subscribe('taskDetails', { taskId }, () => {});
      const socket = FakeSocket.instances.at(-1)!;
      socket.open();
      socket.receive({
        type: 'snapshot',
        id: socket.messages[0].id,
        data: { id: taskId },
        revision: 1,
      });
      sub.unsubscribe();
    }
    const evicted = client.subscribe('taskDetails', { taskId: 'one' }, () => {});
    expect(evicted.state.data).toBeUndefined();
    await vi.advanceTimersByTimeAsync(50);
    const expired = client.subscribe('taskDetails', { taskId: 'two' }, () => {});
    expect(expired.state.data).toBeUndefined();
    client.close();
  });
  it('clears active and inactive private data when access expires', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      subscriptions: { keepAliveMs: 0 },
    });
    const active = client.subscribe('tasks', {}, () => {});
    const privateView = client.subscribe('taskDetails', { taskId: 'private' }, () => {});
    const socket = FakeSocket.instances[0]!;
    socket.open();
    for (const message of socket.messages)
      socket.receive({ type: 'snapshot', id: message.id, data: ['private data'], revision: 2 });
    privateView.unsubscribe();
    socket.close(1008);
    expect(active.state).toMatchObject({ status: 'error', error: { code: 'ACCESS_EXPIRED' } });
    expect(active.state.data).toBeUndefined();
    const next = client.subscribe('taskDetails', { taskId: 'private' }, () => {});
    expect(next.state.data).toBeUndefined();
    client.close();
  });
  it('isolates clients and keeps captured inputs stable on reconnect', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const a = createClient<typeof tracker>({ baseUrl: 'http://localhost/api/workspaces/demo' });
    const b = createClient<typeof tracker>({ baseUrl: 'http://localhost/api/workspaces/demo' });
    const input = { projectId: 'original' };
    a.subscribe('tasks', input, () => {});
    const first = FakeSocket.instances[0]!;
    first.open();
    first.receive({ type: 'snapshot', id: first.messages[0].id, data: ['actor a'], revision: 1 });
    const other = b.subscribe('tasks', { projectId: 'original' }, () => {});
    expect(other.state.data).toBeUndefined();
    input.projectId = 'changed';
    first.close(1006);
    await vi.advanceTimersByTimeAsync(500);
    const reconnected = FakeSocket.instances.at(-1)!;
    reconnected.open();
    expect(reconnected.messages[0].input).toEqual({ projectId: 'original' });
    a.close();
    expect(other.state.status).not.toBe('error');
    b.close();
  });
  it('coalesces concurrent queries but starts a fresh read across writes and after completion', async () => {
    const resolve: ((response: Response) => void)[] = [];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith('/query')
          ? new Promise<Response>((complete) => resolve.push(complete))
          : Response.json({ data: {}, revision: 2 }),
      );
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      fetch: fetcher,
    });
    const a = client.query('stateScopedTasks', { status: 'open', projectId: 'inbox' });
    const b = client.query('stateScopedTasks', { projectId: 'inbox', status: 'open' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await client.mutate('createTask', { title: 'New' });
    const c = client.query('stateScopedTasks', { status: 'open', projectId: 'inbox' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    resolve[0]!(Response.json({ data: ['old'], revision: 1 }));
    expect((await a).data).toEqual(['old']);
    expect((await b).data).toEqual(['old']);
    const d = client.query('stateScopedTasks', { status: 'open', projectId: 'inbox' });
    expect(fetcher).toHaveBeenCalledTimes(3);
    resolve[1]!(Response.json({ data: ['new'], revision: 2 }));
    expect((await c).data).toEqual(['new']);
    expect((await d).data).toEqual(['new']);
    const fresh = client.query('stateScopedTasks', { status: 'open', projectId: 'inbox' });
    expect(fetcher).toHaveBeenCalledTimes(4);
    resolve[2]!(Response.json({ data: ['fresh'], revision: 3 }));
    await fresh;
    client.close();
  });
});

describe('closed client ownership', () => {
  it('clears retained data and rejects further reads and writes', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const fetcher = vi.fn<typeof fetch>();
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      fetch: fetcher,
    });
    const sub = client.subscribe('tasks', {}, () => {});
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'snapshot', id: socket.messages[0].id, data: ['private'], revision: 1 });
    client.close();
    expect(sub.state).toMatchObject({ status: 'error', error: { code: 'CLIENT_CLOSED' } });
    expect(sub.state.data).toBeUndefined();
    expect(() => client.subscribe('tasks', {}, () => {})).toThrow('Create a new client');
    await expect(client.query('tasks', {})).rejects.toMatchObject({ code: 'CLIENT_CLOSED' });
    await expect(client.mutate('createTask', { title: 'Too late' })).rejects.toMatchObject({
      code: 'CLIENT_CLOSED',
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('inactive snapshot expiry', () => {
  it('checks expiry on access even if a background timer has not run', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({
      baseUrl: 'http://localhost/api/workspaces/demo',
      subscriptions: { keepAliveMs: 0, cacheTimeMs: 50 },
    });
    const sub = client.subscribe('tasks', {}, () => {});
    const socket = FakeSocket.instances[0]!;
    socket.open();
    socket.receive({ type: 'snapshot', id: socket.messages[0].id, data: ['old'], revision: 1 });
    sub.unsubscribe();
    vi.setSystemTime(Date.now() + 100);
    expect(client.subscribe('tasks', {}, () => {}).state.data).toBeUndefined();
    client.close();
    client.close();
  });
});
