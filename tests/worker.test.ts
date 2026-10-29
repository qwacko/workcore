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
  it('permits explicitly configured proxy hosts only in demo mode', async () => {
    const configured = { ...bindings, DEMO_ALLOWED_HOSTS: 'workcore.dev.jmcdowall.com' };
    expect((await worker.fetch(new Request('https://workcore.dev.jmcdowall.com/'), configured)).status).toBe(200);
    expect((await worker.fetch(new Request('https://unlisted.example/'), configured)).status).toBe(503);
    expect((await worker.fetch(new Request('https://workcore.dev.jmcdowall.com/'), { ...configured, DEMO_MODE: 'false' })).status).toBe(503);
    const response = await worker.fetch(new Request('https://workcore.dev.jmcdowall.com/demo/login', {
      method: 'POST', headers: { origin: 'https://workcore.dev.jmcdowall.com', 'content-type': 'application/x-www-form-urlencoded' }, body: 'user=alice',
    }), configured);
    expect(response.status).toBe(303);
    expect(response.headers.get('set-cookie')).toContain('; Secure');
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
  it('does not disclose project names found only in another actor’s private tasks', async () => {
    const workspace = crypto.randomUUID();
    const projectId = `alice-private-${crypto.randomUUID()}`;
    await api(workspace, 'mutate', { name: 'createTask', input: { title: 'Private project', projectId, private: true }, requestId: 'private-project' }, 'alice');
    const bob = await (await api(workspace, 'query', { name: 'projectOptions', input: {} }, 'bob')).json() as any;
    expect(bob.data.rows.map((row: { id: string }) => row.id)).not.toContain(projectId);
    const alice = await (await api(workspace, 'query', { name: 'projectOptions', input: {} }, 'alice')).json() as any;
    expect(alice.data.rows.map((row: { id: string }) => row.id)).toContain(projectId);
  });
  it('discovers dynamic displays without resolving them and validates resolution inputs', async () => {
    const workspace = crypto.randomUUID();
    const manifest = await (await request(`/api/workspaces/${workspace}/manifest`)).json() as any;
    expect(manifest.protocol).toBe(3);
    expect(manifest.ui.displays.project.document).toBeUndefined();
    expect(manifest.ui.displays.project.input).toMatchObject({ required: ['projectId'] });
    const resolved = await api(workspace, 'display', { name: 'project', input: { projectId: 'inbox' } });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ blocks: [{ id: 'project-summary' }, { id: 'project-tasks', source: { kind: 'view', name: 'tasks' } }] });
    expect((await api(workspace, 'display', { name: 'project', input: { projectId: '' } })).status).toBe(400);
  });
  it('publishes synthetic admin operations and dispatches them through their existing authorization checks', async () => {
    const workspace = crypto.randomUUID();
    const alice = await (await request(`/api/workspaces/${workspace}/manifest`)).json() as any;
    const bob = await (await request(`/api/workspaces/${workspace}/manifest`, 'bob')).json() as any;
    expect(alice.system['tables.list']).toBeDefined();
    expect(alice.system['runs.list']).toBeDefined();
    expect(bob.system['tables.list']).toBeUndefined();
    expect(bob.system['runs.list']).toBeDefined();
    expect((await api(workspace, 'system', { name: 'tables.list', input: {} })).status).toBe(200);
    expect((await api(workspace, 'system', { name: 'tables.list', input: {} }, 'bob')).status).toBe(403);
    expect((await api(workspace, 'system', { name: 'tables.list', input: { unexpected: true } })).status).toBe(200);
  });
  it('does not arm alarms for read-only system polling', async () => {
    const workspace = crypto.randomUUID();
    expect((await api(workspace, 'system', { name: 'tables.list', input: {} })).status).toBe(200);
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runInDurableObject(stub, async (_instance, state) => expect(await state.storage.getAlarm()).toBeNull());
  });
  it('streams files to R2, scopes metadata and bytes by owner, and deletes both stores', async () => {
    const workspace = crypto.randomUUID();
    const response = await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, {
      method: 'POST', headers: { cookie: 'demo_user=alice', origin: 'http://localhost', 'content-type': 'text/plain', 'content-length': '11', 'x-file-name': 'hello.txt' }, body: 'hello world',
    }), bindings);
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string; status: string };
    expect(created.status).toBe('ready');
    const listed = await (await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, { headers: { cookie: 'demo_user=alice' } }), bindings)).json() as any;
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]).toMatchObject({ filename: 'hello.txt', size: 11, status: 'ready', ownerId: 'alice' });
    expect(listed.rows[0]).not.toHaveProperty('objectKey');
    const bobList = await (await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, { headers: { cookie: 'demo_user=bob' } }), bindings)).json() as any;
    expect(bobList.rows).toHaveLength(0);
    expect((await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { headers: { cookie: 'demo_user=bob' } }), bindings)).status).toBe(403);
    expect((await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { method: 'DELETE', headers: { cookie: 'demo_user=bob' } }), bindings)).status).toBe(403);
    const downloaded = await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { headers: { cookie: 'demo_user=alice' } }), bindings);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe('hello world');
    expect(downloaded.headers.get('content-disposition')).toContain('hello.txt');
    expect((await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { method: 'DELETE', headers: { cookie: 'demo_user=alice' } }), bindings)).status).toBe(204);
    expect((await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { headers: { cookie: 'demo_user=alice' } }), bindings)).status).toBe(404);
  });
  it('cleans up a pending metadata row and orphaned R2 object after an interrupted upload', async () => {
    const workspace = crypto.randomUUID();
    const response = await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, {
      method: 'POST', headers: { cookie: 'demo_user=alice', 'content-type': 'text/plain', 'content-length': '7', 'x-file-name': 'orphan.txt' }, body: 'orphan!',
    }), bindings);
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runInDurableObject(stub, (instance: TrackerWorkspace) => {
      instance.engine.storage.sql.exec('UPDATE files SET status = ?, created_at = ? WHERE id = ?', 'pending', Date.now() - 86_400_001, id);
    });
    await runDurableObjectAlarm(stub);
    expect(await bindings.FILES_BUCKET.head(`workcore/files/${id}`)).toBeNull();
    const page = await (await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, { headers: { cookie: 'demo_user=alice' } }), bindings)).json() as any;
    expect(page.rows).toHaveLength(0);
  });
  it('selectively snapshots matching views, acknowledges unrelated revisions, and refreshes after reconnect', async () => {
    const workspace = crypto.randomUUID();
    const connection = await socket(workspace, 'bob');
    let response = next(connection);
    connection.send(JSON.stringify({ type: 'subscribe', id: 'tasks', name: 'tasks', input: {} }));
    expect(await response).toMatchObject({ type: 'snapshot', id: 'tasks', data: [expect.objectContaining({ id: 'welcome' })] });
    response = next(connection);
    const mutation = await (await api(workspace, 'mutate', { name: 'createTask', input: { title: 'Live update' }, requestId: 'one' })).json() as any;
    expect(await response).toMatchObject({ type: 'snapshot', revision: mutation.revision, data: expect.arrayContaining([expect.objectContaining({ title: 'Live update' })]) });
    response = next(connection);
    const unrelated = await (await api(workspace, 'mutate', { name: 'saveSummary', input: { text: 'Not a task change' }, requestId: 'summary' }, 'bob')).json() as any;
    expect(await response).toMatchObject({ type: 'revision', revision: unrelated.revision });
    connection.close();
    const reconnected = await socket(workspace, 'bob');
    response = next(reconnected);
    reconnected.send(JSON.stringify({ type: 'subscribe', id: 'tasks', name: 'tasks', input: {} }));
    expect((await response).data).toHaveLength(2);
    reconnected.close();
  });
  it('subscribes to authorized dynamic display documents and re-resolves them after commits', async () => {
    const workspace = crypto.randomUUID();
    const document = {
      state: { count: { schema: { type: 'integer', minimum: 0 }, default: 0, persistence: 'url' } },
      blocks: [{ id: 'saved-tasks', kind: 'collection', title: 'Initial tasks', source: { kind: 'view', name: 'tasks' }, input: { projectId: 'inbox' }, columns: [{ path: 'title' }] }],
    };
    const saveResponse = await api(workspace, 'mutate', { name: 'createSavedDisplayDraft', input: { title: 'Initial', document }, requestId: 'save-initial' }, 'alice');
    const saved = await saveResponse.json() as any;
    expect(saveResponse.status, JSON.stringify(saved)).toBe(200);
    const resolved = await (await api(workspace, 'display', { name: 'savedDisplay', input: { savedDisplayId: saved.data.id } }, 'alice')).json() as any;
    expect(resolved.state).toEqual(document.state);
    const connection = await socket(workspace, 'alice');
    let response = next(connection);
    connection.send(JSON.stringify({ type: 'subscribe', kind: 'display', id: 'saved', name: 'savedDisplay', input: { savedDisplayId: saved.data.id } }));
    expect(await response).toMatchObject({ type: 'snapshot', id: 'saved', data: { blocks: expect.arrayContaining([expect.objectContaining({ id: 'saved-tasks', title: 'Initial tasks' })]) } });
    response = next(connection);
    const updatedDocument = {
      ...document,
      state: { count: { schema: { type: 'integer', minimum: 0 }, default: 1, persistence: 'url' } },
      blocks: [{ ...document.blocks[0], title: 'Updated tasks' }],
    };
    await api(workspace, 'mutate', { name: 'updateSavedDisplayDraft', input: { id: saved.data.id, expectedVersion: 1, document: updatedDocument }, requestId: 'save-update' }, 'alice');
    expect(await response).toMatchObject({ type: 'snapshot', id: 'saved', data: { blocks: expect.arrayContaining([expect.objectContaining({ id: 'saved-tasks', title: 'Updated tasks' })]) } });
    const resolvedAfterUpdate = await (await api(workspace, 'display', { name: 'savedDisplay', input: { savedDisplayId: saved.data.id } }, 'alice')).json() as any;
    expect(resolvedAfterUpdate.state).toEqual(updatedDocument.state);
    connection.close();
  });
  it('keeps saved documents private, denies publishing, rejects unsafe sources, and uses optimistic concurrency', async () => {
    const workspace = crypto.randomUUID();
    const document = { blocks: [{ id: 'safe-tasks', kind: 'collection', source: { kind: 'view', name: 'tasks' }, input: { projectId: 'inbox' }, columns: [{ path: 'title' }] }] };
    const saveResponse = await api(workspace, 'mutate', { name: 'createSavedDisplayDraft', input: { title: 'Private', document }, requestId: 'private-draft' });
    const saved = await saveResponse.json() as any;
    expect(saveResponse.status, JSON.stringify(saved)).toBe(200);
    const forbiddenResolve = await api(workspace, 'display', { name: 'savedDisplay', input: { savedDisplayId: saved.data.id } }, 'bob');
    expect(forbiddenResolve.status).toBe(404);

    const publish = await api(workspace, 'mutate', { name: 'publishSavedDisplay', input: { id: saved.data.id, expectedVersion: 1 }, requestId: 'publish-denied' });
    expect(publish.status).toBe(403);

    const invalid = await api(workspace, 'mutate', { name: 'createSavedDisplayDraft', input: { title: 'Unsafe', document: { blocks: [{ id: 'unsafe', kind: 'collection', source: { kind: 'view', name: 'members' }, columns: [{ path: 'id' }] }] } }, requestId: 'unsafe-draft' });
    expect(invalid.status).toBe(400);

    const update = { name: 'updateSavedDisplayDraft', input: { id: saved.data.id, expectedVersion: 1, title: 'Updated', document: { blocks: [{ ...document.blocks[0], title: 'Updated tasks' }] } } };
    expect((await api(workspace, 'mutate', { ...update, requestId: 'update-one' })).status).toBe(200);
    const stale = await api(workspace, 'mutate', { ...update, requestId: 'update-stale' });
    expect(stale.status).toBe(409);
  });
  it('refreshes the connected manifest discovery subscription after commits', async () => {
    const workspace = crypto.randomUUID();
    const connection = await socket(workspace, 'alice');
    let response = next(connection);
    connection.send(JSON.stringify({ type: 'subscribe', kind: 'manifest', id: 'catalogue', name: '', input: {} }));
    expect(await response).toMatchObject({ type: 'snapshot', id: 'catalogue', data: { ui: { displays: { overview: expect.any(Object) } } } });
    response = next(connection);
    await api(workspace, 'mutate', { name: 'createTask', input: { title: 'Discovery refresh' }, requestId: 'discovery-refresh' });
    expect(await response).toMatchObject({ type: 'snapshot', id: 'catalogue', data: { ui: { displays: { overview: expect.any(Object) } } } });
    connection.close();
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
      instance.engine.storage.sql.exec("DELETE FROM members WHERE id = 'bob'");
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
  it('arms an idle durable workspace before a system retry queues new work', async () => {
    const workspace = crypto.randomUUID();
    const queued = await (await api(workspace, 'enqueue', { name: 'assistant', input: {}, requestId: 'initial-run' })).json() as any;
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, async (_instance, state) => expect(await state.storage.getAlarm()).toBeNull());
    await runInDurableObject(stub, (_instance, state) => {
      const row = state.storage.sql.exec<{ data: string }>('SELECT data FROM wc_runs WHERE id = ?', queued.data).toArray()[0]!;
      const run = JSON.parse(row.data); run.status = 'failed';
      state.storage.sql.exec("UPDATE wc_runs SET status = 'failed', data = ? WHERE id = ?", JSON.stringify(run), queued.data);
    });
    const retry = await api(workspace, 'system', { name: 'runs.retry', input: { runId: queued.data } });
    expect(retry.status).toBe(200);
    await runInDurableObject(stub, async (_instance, state) => expect(await state.storage.getAlarm()).not.toBeNull());
    await runDurableObjectAlarm(stub);
  });
  it('serves the compiled SPA and only shows allowed operation metadata', async () => {
    const response = await request('/workspace');
    expect(response.status).toBe(303);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/admin/demo');
    const admin = await request('/admin/demo/displays/tasks');
    expect(admin.status).toBe(200);
    expect(await admin.text()).toContain('/admin/_app/');
    expect((await request('/admin/demo', '')).status).toBe(303);
    const manifest = await (await request('/api/workspaces/demo/manifest', 'bob')).json() as any;
    expect(manifest.admin).toBe(false);
    expect(manifest.view.tasks.input).toMatchObject({ type: 'object' });
  });
});
