import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../examples/tracker/src/worker.js';
import type { Env } from '../examples/tracker/src/app.js';
import type { TrackerWorkspace } from '../examples/tracker/src/worker.js';

const bindings = env as unknown as Env;
function request(path: string, user = 'alice', body?: unknown, headers: Record<string, string> = {}) {
  return worker.fetch(new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie: `demo_user=${user}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), bindings);
}
function api(workspace: string, action: string, body: unknown, user = 'alice') {
  return request(`/api/workspaces/${workspace}/${action}`, user, body);
}
async function socket(workspace: string, user = 'alice') {
  const response = await request(`/api/workspaces/${workspace}/live`, user, undefined, { upgrade: 'websocket', origin: 'http://localhost' });
  expect(response.status).toBe(101);
  const connection = response.webSocket!;
  connection.accept();
  return connection;
}
function next(connection: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket response timed out')), 5000);
    connection.addEventListener('message', event => { clearTimeout(timeout); resolve(JSON.parse(String(event.data))); }, { once: true });
  });
}

describe('Cloudflare Worker and live protocol', () => {
  it('fails closed outside the local demo and rejects spoofed sessions and cross-origin writes', async () => {
    expect((await worker.fetch(new Request('https://example.com/'), bindings)).status).toBe(503);
    expect((await request('/api/workspaces/demo/manifest', '', undefined, { 'x-workcore-session': encodeURIComponent(JSON.stringify({ actor: { id: 'alice' }, expiresAt: Date.now() + 10000 })) })).status).toBe(401);
    expect((await request('/api/workspaces/demo/mutate', 'alice', { name: 'createTask', input: { title: 'No' }, requestId: 'one' }, { origin: 'https://attacker.test' })).status).toBe(403);
  });
  it('isolates workspaces and filters private rows before sending data', async () => {
    const workspace = crypto.randomUUID();
    const alice = await (await api(workspace, 'query', { name: 'tasks', input: {} })).json() as any;
    const bob = await (await api(workspace, 'query', { name: 'tasks', input: {} }, 'bob')).json() as any;
    expect(alice.data).toHaveLength(2);
    expect(bob.data).toHaveLength(1);
    expect((await api(workspace, 'inspect', { resource: 'table:tasks' }, 'bob')).status).toBe(403);
    await api(workspace, 'mutate', { name: 'createTask', input: { title: 'Only here' }, requestId: 'one' });
    const other = await (await api(crypto.randomUUID(), 'query', { name: 'tasks', input: {} })).json() as any;
    expect(other.data).toHaveLength(2);
  });
  it('sends full snapshots after mutation and after reconnect', async () => {
    const workspace = crypto.randomUUID();
    const connection = await socket(workspace, 'bob');
    let response = next(connection);
    connection.send(JSON.stringify({ type: 'subscribe', id: 'tasks', name: 'tasks', input: {} }));
    expect(await response).toMatchObject({ type: 'snapshot', id: 'tasks', data: [expect.objectContaining({ id: 'welcome' })] });
    response = next(connection);
    const mutation = await (await api(workspace, 'mutate', { name: 'createTask', input: { title: 'Live update' }, requestId: 'one' })).json() as any;
    expect(await response).toMatchObject({ type: 'snapshot', revision: mutation.revision, data: expect.arrayContaining([expect.objectContaining({ data: expect.objectContaining({ title: 'Live update' }) })]) });
    connection.close();
    const reconnected = await socket(workspace, 'bob');
    response = next(reconnected);
    reconnected.send(JSON.stringify({ type: 'subscribe', id: 'tasks', name: 'tasks', input: {} }));
    expect((await response).data).toHaveLength(2);
    reconnected.close();
  });
  it('clears a subscription when membership is revoked, even without a declared dependency', async () => {
    const workspace = crypto.randomUUID();
    const connection = await socket(workspace, 'bob');
    let response = next(connection);
    connection.send(JSON.stringify({ type: 'subscribe', id: 'tasks', name: 'tasks', input: {} }));
    await response;
    response = next(connection);
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runInDurableObject(stub, (instance: TrackerWorkspace) => {
      instance.engine.storage.sql.exec("DELETE FROM wc_records WHERE table_name = 'members' AND id = 'bob'");
    });
    // Explicit heartbeat performs a fresh authorization check, including after a missed broadcast.
    connection.send(JSON.stringify({ type: 'refresh' }));
    const event = await response;
    expect(event).toMatchObject({ type: 'error', error: { code: 'FORBIDDEN' } });
    connection.close();
  });
  it('executes a queued agent using the same mutation and view paths', async () => {
    const workspace = crypto.randomUUID();
    const result = await (await api(workspace, 'enqueue', { name: 'assistant', input: {}, requestId: 'agent' })).json() as any;
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runDurableObjectAlarm(stub);
    const summary = await (await api(workspace, 'query', { name: 'assistantSummary', input: {} })).json() as any;
    expect(summary.data).toContain('Demo assistant');
    const trace = await (await api(workspace, 'trace', { runId: result.data })).json() as any;
    expect(trace.rows[0]).toMatchObject({ status: 'completed' });
    expect((await api(workspace, 'trace', { runId: result.data }, 'bob')).status).toBe(403);
    const bobRuns = await (await api(workspace, 'inspect', { resource: 'runs' }, 'bob')).json() as any;
    expect(bobRuns).toEqual({ rows: [], nextCursor: null });
    await runInDurableObject(stub, async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
    });
  });
  it('serves the console without a frontend build and only shows allowed operation metadata', async () => {
    const response = await request('/workspace');
    expect(await response.text()).toContain('Workspace console');
    const manifest = await (await request('/api/workspaces/demo/manifest', 'bob')).json() as any;
    expect(manifest.admin).toBe(false);
    expect(manifest.view.tasks.input).toMatchObject({ type: 'object' });
  });
});
