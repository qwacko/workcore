import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../examples/workcore-demo/src/worker.js';
import type { Env } from '../examples/workcore-demo/src/app.js';
import type { TrackerWorkspace } from '../examples/workcore-demo/src/worker.js';

const bindings = env as unknown as Env;
type TestUser = { id: string; cookie: string };
let users: Record<string, TestUser>;
let initialized: Set<string>;

beforeEach(async () => {
  initialized = new Set();
  users = {};
  for (const name of ['alice', 'bob']) {
    const response = await worker.fetch(new Request('http://localhost/api/auth/sign-up/email', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' },
      body: JSON.stringify({ name, email: `${name}-${crypto.randomUUID()}@example.com`, password: 'test-password-123' }),
    }), bindings);
    expect(response.status, await response.clone().text()).toBe(200);
    const body = await response.json() as { user: { id: string } };
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    expect(cookie).toContain('session_token');
    users[name] = { id: body.user.id, cookie };
  }
});

async function request(path: string, user = 'alice', body?: unknown, headers: Record<string, string> = {}) {
  const workspace = path.match(/^\/api\/workspaces\/([^/]+)\//)?.[1];
  if (workspace && !initialized.has(workspace)) {
    initialized.add(workspace);
    // Initialize the real workspace, then map its fixture members and seeded rows
    // to the IDs issued by Better Auth. Production requests never trust these IDs.
    await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/manifest`, {
      headers: { cookie: users.alice!.cookie },
    }), bindings);
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runInDurableObject(stub, (instance: TrackerWorkspace) => {
      const sql = instance.engine.storage.sql;
      sql.exec('UPDATE tasks SET owner_id = ? WHERE owner_id = ?', users.alice!.id, 'alice');
      sql.exec('UPDATE members SET id = ? WHERE id = ?', users.alice!.id, 'alice');
      sql.exec('UPDATE members SET id = ? WHERE id = ?', users.bob!.id, 'bob');
    });
  }
  return worker.fetch(new Request(`http://localhost${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(users[user] ? { cookie: users[user]!.cookie } : {}), 'content-type': 'application/json', ...headers },
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
  it('grants configured Better Auth IDs admin access in both workspaces, but not ordinary users', async () => {
    const oldId = users.alice!.id;
    const id = 'configured-test-admin';
    // Set up a known account ID in D1, just as an operator would identify an
    // existing account before configuring the allowlist. The session is real.
    await bindings.AUTH_DB.batch([
      bindings.AUTH_DB.prepare('INSERT INTO user (id, name, email, emailVerified, image, createdAt, updatedAt) SELECT ?, name, ? || email, emailVerified, image, createdAt, updatedAt FROM user WHERE id = ?').bind(id, 'configured-', oldId),
      bindings.AUTH_DB.prepare('UPDATE session SET userId = ? WHERE userId = ?').bind(id, oldId),
      bindings.AUTH_DB.prepare('UPDATE account SET userId = ? WHERE userId = ?').bind(id, oldId),
      bindings.AUTH_DB.prepare('DELETE FROM user WHERE id = ?').bind(oldId),
    ]);
    users.alice!.id = id;
    for (const workspace of ['demo', 'notes']) {
      const manifest = async (user: string) => (await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/manifest`, { headers: { cookie: users[user]!.cookie } }), bindings)).json() as Promise<{ admin: boolean }>;
      expect((await manifest('alice')).admin).toBe(true);
      expect((await manifest('bob')).admin).toBe(false);
      const system = (user: string) => worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/system`, {
        method: 'POST', headers: { cookie: users[user]!.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'tables.list', input: {} }),
      }), bindings);
      expect((await system('alice')).status).toBe(200);
      expect((await system('bob')).status).toBe(403);
      const spoof = await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/system`, {
        method: 'POST', headers: { 'x-workcore-session': encodeURIComponent(JSON.stringify({ actor: { id }, expiresAt: Date.now() + 60_000 })), 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'tables.list', input: {} }),
      }), bindings);
      expect(spoof.status).toBe(401);
    }
  });
  it('rejects spoofed sessions and cross-origin writes', async () => {
    expect((await request('/api/workspaces/demo/manifest', '', undefined, { 'x-workcore-session': encodeURIComponent(JSON.stringify({ actor: { id: users.alice!.id }, expiresAt: Date.now() + 10000 })) })).status).toBe(401);
    expect((await request('/api/workspaces/demo/mutate', 'alice', { name: 'createTask', input: { title: 'No' }, requestId: 'one' }, { origin: 'https://attacker.test' })).status).toBe(403);
  });
  it('rejects an invalid session cookie and revokes a signed-out session', async () => {
    expect((await request('/api/workspaces/demo/manifest', '', undefined, { cookie: 'demo_user=alice' })).status).toBe(401);
    const signout = await worker.fetch(new Request('http://localhost/api/auth/sign-out', { method: 'POST', headers: { cookie: users.alice!.cookie, origin: 'http://localhost' } }), bindings);
    expect(signout.status).toBe(200);
    expect((await request('/api/workspaces/demo/manifest')).status).toBe(401);
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
    await request(`/api/workspaces/${workspace}/manifest`);
    const response = await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, {
      method: 'POST', headers: { cookie: users.alice!.cookie, origin: 'http://localhost', 'content-type': 'text/plain', 'content-length': '11', 'x-file-name': 'hello.txt' }, body: 'hello world',
    }), bindings);
    expect(response.status).toBe(201);
    const created = await response.json() as { id: string; status: string };
    expect(created.status).toBe('ready');
    const listed = await (await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, { headers: { cookie: users.alice!.cookie } }), bindings)).json() as any;
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]).toMatchObject({ filename: 'hello.txt', size: 11, status: 'ready', ownerId: users.alice!.id });
    expect(listed.rows[0]).not.toHaveProperty('objectKey');
    const bobList = await (await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, { headers: { cookie: users.bob!.cookie } }), bindings)).json() as any;
    expect(bobList.rows).toHaveLength(0);
    expect((await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { headers: { cookie: users.bob!.cookie } }), bindings)).status).toBe(403);
    expect((await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { method: 'DELETE', headers: { cookie: users.bob!.cookie } }), bindings)).status).toBe(403);
    const downloaded = await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { headers: { cookie: users.alice!.cookie } }), bindings);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe('hello world');
    expect(downloaded.headers.get('content-disposition')).toContain('hello.txt');
    expect((await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { method: 'DELETE', headers: { cookie: users.alice!.cookie } }), bindings)).status).toBe(204);
    expect((await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files/${created.id}`, { headers: { cookie: users.alice!.cookie } }), bindings)).status).toBe(404);
  });
  it('cleans up a pending metadata row and orphaned R2 object after an interrupted upload', async () => {
    const workspace = crypto.randomUUID();
    await request(`/api/workspaces/${workspace}/manifest`);
    const response = await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, {
      method: 'POST', headers: { cookie: users.alice!.cookie, 'content-type': 'text/plain', 'content-length': '7', 'x-file-name': 'orphan.txt' }, body: 'orphan!',
    }), bindings);
    expect(response.status).toBe(201);
    const { id } = await response.json() as { id: string };
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runInDurableObject(stub, (instance: TrackerWorkspace) => {
      instance.engine.storage.sql.exec('UPDATE files SET status = ?, created_at = ? WHERE id = ?', 'pending', Date.now() - 86_400_001, id);
    });
    await runDurableObjectAlarm(stub);
    expect(await bindings.FILES_BUCKET.head(`workcore/files/${id}`)).toBeNull();
    const page = await (await worker.fetch(new Request(`http://localhost/api/workspaces/${workspace}/files`, { headers: { cookie: users.alice!.cookie } }), bindings)).json() as any;
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
  it('clears an admin subscription when a member loses admin access', async () => {
    const workspace = crypto.randomUUID();
    await request(`/api/workspaces/${workspace}/manifest`);
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runInDurableObject(stub, (instance: TrackerWorkspace) => {
      instance.engine.storage.sql.exec('UPDATE members SET role = ? WHERE id = ?', 'admin', users.bob!.id);
    });
    const connection = await socket(workspace, 'bob');
    let response = next(connection);
    connection.send(JSON.stringify({ type: 'subscribe', kind: 'system', id: 'tables', name: 'tables.list', input: {} }));
    expect(await response).toMatchObject({ type: 'snapshot' });
    response = next(connection);
    await runInDurableObject(stub, (instance: TrackerWorkspace) => {
      instance.engine.storage.sql.exec('UPDATE members SET role = ? WHERE id = ?', 'member', users.bob!.id);
    });
    connection.send(JSON.stringify({ type: 'refresh' }));
    expect(await response).toMatchObject({ type: 'error', error: { code: 'FORBIDDEN' } });
    connection.close();
  });
  it('executes a queued agent using the same mutation and view paths', async () => {
    const workspace = crypto.randomUUID();
    const result = await (await api(workspace, 'enqueue', { name: 'assistant', input: {}, requestId: 'agent' })).json() as any;
    const stub = bindings.WORKSPACES.get(bindings.WORKSPACES.idFromName(workspace));
    await runDurableObjectAlarm(stub);
    const summary = await (await api(workspace, 'query', { name: 'assistantSummary', input: {} })).json() as any;
    expect(summary.data).toContain('tasks');
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
    const response = await request('/');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('/_app/');
    const admin = await request('/admin/demo/displays/tasks');
    expect(admin.status).toBe(200);
    expect(await admin.text()).toContain('/admin/_app/');
    expect((await request('/admin/demo', '')).status).toBe(303);
    const manifest = await (await request('/api/workspaces/demo/manifest', 'bob')).json() as any;
    expect(manifest.admin).toBe(false);
    expect(manifest.view.tasks.input).toMatchObject({ type: 'object' });
  });
});
