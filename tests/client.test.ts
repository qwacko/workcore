import { afterEach, describe, expect, it, vi } from 'vitest';
import { createActionDispatcher, createClient } from '../packages/client/src/index.js';
import type { tracker } from '../examples/workcore-demo/src/app.js';

class FakeSocket extends EventTarget {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  messages: any[] = [];
  constructor(readonly url: URL) { super(); FakeSocket.instances.push(this); }
  open() { this.readyState = 1; this.dispatchEvent(new Event('open')); }
  send(data: string) { this.messages.push(JSON.parse(data)); }
  receive(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  close(code = 1000) { this.readyState = 3; this.dispatchEvent(Object.assign(new Event('close'), { code })); }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeSocket.instances = []; });

describe('typed browser client lifecycle', () => {
  it('shares stable mutation/job retry IDs across renderer implementations', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { code: 'TEMPORARY', message: 'Retry' } }, { status: 503 }))
      .mockImplementation(async () => Response.json({ data: { id: 'task' }, revision: 1 }));
    const client = createClient<typeof tracker>({ baseUrl: 'http://localhost/api/workspaces/demo', fetch: fetcher });
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
    actions.close(); client.close();
  });
  it('sends stable request IDs, reports server errors and rejects lossy input', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: 'created', revision: 2 }));
    const client = createClient<typeof tracker>({ baseUrl: 'http://localhost/api/workspaces/demo', fetch: fetcher });
    expect(await client.mutate('createTask', { title: 'One' }, 'stable')).toEqual({ data: 'created', revision: 2 });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body))).toMatchObject({ requestId: 'stable' });
    await expect(client.mutate('createTask', { title: new Date() } as any)).rejects.toThrow('plain JSON');
    fetcher.mockResolvedValue(Response.json({ error: { code: 'CONFLICT', message: 'Changed' } }, { status: 409 }));
    await expect(client.mutate('completeTask', { id: 'one', expectedRevision: 1 })).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    fetcher.mockResolvedValue(Response.json({ id: 'run', status: 'failed', error: 'EXECUTION_FAILED' }));
    expect(await client.inspect('run:run')).toMatchObject({ error: 'EXECUTION_FAILED' });
    client.close();
  });
  it('multiplexes subscriptions, ignores stale snapshots and waits for observed revisions', async () => {
    vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({ baseUrl: 'http://localhost/api/workspaces/demo' });
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
    tasks.unsubscribe(); summary.unsubscribe();
    expect(socket.readyState).toBe(3);
    client.close();
  });
  it('resubscribes after reconnect and clears sensitive data on policy errors', async () => {
    vi.useFakeTimers(); vi.stubGlobal('WebSocket', FakeSocket);
    const client = createClient<typeof tracker>({ baseUrl: 'http://localhost/api/workspaces/demo' });
    const tasks = client.subscribe('tasks', {}, () => {});
    const first = FakeSocket.instances[0]!;
    first.open();
    first.receive({ type: 'snapshot', id: first.messages[0].id, data: ['private'], revision: 3 });
    first.close(1006);
    expect(tasks.state.status).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(500);
    const second = FakeSocket.instances[1]!;
    second.open();
    second.receive({ type: 'error', id: second.messages[0].id, error: { code: 'FORBIDDEN', message: 'Revoked' } });
    expect(tasks.state).toMatchObject({ status: 'error', revision: 0, error: { code: 'FORBIDDEN' } });
    expect(tasks.state.data).toBeUndefined();
    await expect(tasks.whenRevision(4)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    client.close();
  });
});
