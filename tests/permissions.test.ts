import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { routeWorkspace } from '../packages/core/src/cloudflare.js';
import type { PermissionsWorkspace } from './worker.js';

const bindings = env as unknown as { PERMISSIONS: DurableObjectNamespace; NOTES: DurableObjectNamespace };
const namespace = bindings.PERMISSIONS;
function call(workspace: string, actor: string, endpoint: string, body?: unknown, target = namespace) {
  // Identity is supplied by this test host, not trusted from request headers.
  return routeWorkspace(new Request(`http://localhost/api/workspaces/${workspace}/${endpoint}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }), { namespace: target, authenticate: () => ({ actor: { id: actor }, expiresAt: Date.now() + 60_000 }) });
}
function mutate(workspace: string, actor: string, name: string, input: unknown, target = namespace) {
  return call(workspace, actor, 'mutate', { name, input, requestId: crypto.randomUUID() }, target);
}
function setPermissions(workspace: string, inspectAll: boolean, revoked = false) {
  return mutate(workspace, 'alice', 'setPermissions', { actorId: 'bob', inspectAll, revoked });
}
function next(socket: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket response timeout')), 5000);
    socket.addEventListener('message', event => { clearTimeout(timer); resolve(JSON.parse(String(event.data))); }, { once: true });
  });
}
async function connect(workspace: string, actor: string) {
  const response = await routeWorkspace(new Request(`http://localhost/api/workspaces/${workspace}/live`, { headers: { upgrade: 'websocket' } }), { namespace, authenticate: () => ({ actor: { id: actor }, expiresAt: Date.now() + 60_000 }) });
  expect(response.status).toBe(101);
  const socket = response.webSocket!; socket.accept(); return socket;
}

it('keeps todo visibility, editing permissions, storage isolation and concurrent edits independent', async () => {
  const workspace = crypto.randomUUID();
  const created = await (await mutate(workspace, 'alice', 'createTask', { title: 'Private todo', private: true })).json() as any;
  const bob = await (await call(workspace, 'bob', 'query', { name: 'tasks', input: {} })).json() as any;
  expect(bob.data.some((row: any) => row.id === created.data.id)).toBe(false);
  const edit = { id: created.data.id, title: 'Shared todo', projectId: 'inbox', private: false, expectedRevision: created.data.version };
  expect((await mutate(workspace, 'bob', 'editTask', edit)).status).toBe(409);
  expect((await mutate(workspace, 'alice', 'editTask', edit)).status).toBe(200);
  expect((await mutate(workspace, 'alice', 'editTask', { ...edit, title: 'Stale tab' })).status).toBe(409);
  const shared = await (await call(workspace, 'bob', 'query', { name: 'tasks', input: {} })).json() as any;
  expect(shared.data.some((row: any) => row.id === created.data.id)).toBe(true);
  expect((await mutate(workspace, 'bob', 'editTask', { ...edit, expectedRevision: 2 })).status).toBe(409);
  const other = await (await call(crypto.randomUUID(), 'alice', 'query', { name: 'tasks', input: {} })).json() as any;
  expect(other.data.some((row: any) => row.id === created.data.id)).toBe(false);
  expect((await mutate(workspace, 'bob', 'setPermissions', { actorId: 'bob', inspectAll: true, revoked: false })).status).toBe(403);
});

it('keeps notes private and rejects cross-user and stale note edits', async () => {
  const workspace = crypto.randomUUID();
  const created = await (await mutate(workspace, 'alice', 'create', { title: 'My note', body: 'Private text' }, bindings.NOTES)).json() as any;
  const input = { id: created.data.id, expectedRevision: created.data.version, title: 'Edited note', body: 'New text', starred: false, archived: false };
  const bob = await (await call(workspace, 'bob', 'query', { name: 'list', input: {} }, bindings.NOTES)).json() as any;
  expect(bob.data).toEqual([]);
  expect((await mutate(workspace, 'bob', 'update', input, bindings.NOTES)).status).toBe(409);
  expect((await mutate(workspace, 'alice', 'update', input, bindings.NOTES)).status).toBe(200);
  expect((await mutate(workspace, 'alice', 'update', input, bindings.NOTES)).status).toBe(409);
});

it('revokes system access on an unrelated permissions commit, then closes a revoked connection', async () => {
  const workspace = crypto.randomUUID();
  await setPermissions(workspace, true);
  const socket = await connect(workspace, 'bob');
  let response = next(socket);
  socket.send(JSON.stringify({ type: 'subscribe', id: 'tables', kind: 'system', name: 'tables.list', input: {} }));
  expect(await response).toMatchObject({ type: 'snapshot' });
  response = next(socket);
  await setPermissions(workspace, false);
  expect(await response).toMatchObject({ type: 'error', error: { code: 'FORBIDDEN' } });
  response = next(socket);
  socket.send(JSON.stringify({ type: 'subscribe', id: 'tasks', name: 'tasks', input: {} }));
  expect(await response).toMatchObject({ type: 'snapshot' });
  const closed = new Promise<CloseEvent>(resolve => socket.addEventListener('close', resolve, { once: true }));
  await setPermissions(workspace, false, true);
  expect((await closed).code).toBe(1008);
  expect((await call(workspace, 'bob', 'query', { name: 'tasks', input: {} })).status).toBe(403);
  socket.close();
});

it('reprojects all-user run lists when inspection permission changes without a run trigger', async () => {
  const workspace = crypto.randomUUID();
  await setPermissions(workspace, true);
  await runInDurableObject(namespace.get(namespace.idFromName(workspace)), (instance: PermissionsWorkspace) => {
    instance.engine.storage.sql.exec("INSERT INTO wc_runs (id, status, due, data) VALUES ('other', 'completed', 0, ?)", JSON.stringify({ id: 'other', actor: { id: 'alice' }, status: 'completed' }));
  });
  const socket = await connect(workspace, 'bob');
  let response = next(socket);
  socket.send(JSON.stringify({ type: 'subscribe', id: 'runs', kind: 'system', name: 'runs.list', input: {} }));
  expect(await response).toMatchObject({ data: { rows: [{ id: 'other' }] } });
  response = next(socket);
  await setPermissions(workspace, false);
  expect(await response).toMatchObject({ type: 'snapshot', data: { rows: [] } });
  socket.close();
});

it('checks an optional host access policy before resolving a namespace', async () => {
  const response = await routeWorkspace(new Request('http://localhost/api/workspaces/unknown/manifest'), {
    namespace, authenticate: () => ({ actor: { id: 'alice' }, expiresAt: Date.now() + 1000 }), authorizeWorkspace: () => false,
    namespaceFor: () => { throw new Error('Must not contact a denied namespace'); },
  });
  expect(response.status).toBe(403);
});
