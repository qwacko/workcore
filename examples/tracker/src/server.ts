import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { createAdminHandler } from '@workcore/admin/server';
import { superjsonCodec } from '@workcore/codec-superjson';
import { createPlatform, registerApplication, type Actor } from '@workcore/core';
import type { Activity, ActivityStore, TrackerContext } from './app.js';
import { tracker } from './app.js';
import { notes } from './second-app.js';
import { actorCapabilities, createFileServices } from './file-services.js';

const databasePath = resolve(process.env.WORKCORE_DATA ?? 'data/tracker.json');
type DataFile = Record<string, Activity[]>;
type PersistedDataFile = Record<string, Array<Omit<Activity, 'updatedAt'> & { updatedAt: string }>>;
const scopeStorageKey = (applicationId: string, workspaceId: string) => JSON.stringify([applicationId, workspaceId]);
let activityWrite: Promise<void> = Promise.resolve();

async function readDatabase(): Promise<DataFile> {
  try {
    const stored = JSON.parse(await readFile(databasePath, 'utf8')) as Record<string, Array<Omit<Activity, 'updatedAt'> & { updatedAt: string }>>;
    return Object.fromEntries(Object.entries(stored).map(([key, rows]) => [key, rows.map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) }))]));
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}
async function writeDatabase(data: DataFile) {
  await mkdir(dirname(databasePath), { recursive: true });
  const temporary = `${databasePath}.${process.pid}.tmp`;
  const persisted: PersistedDataFile = Object.fromEntries(Object.entries(data).map(([key, rows]) => [
    key,
    rows.map(({ updatedAt, ...row }) => ({ ...row, updatedAt: updatedAt.toISOString() })),
  ]));
  await writeFile(temporary, JSON.stringify(persisted, null, 2));
  await rename(temporary, databasePath);
}

const activityStore: ActivityStore = {
  async list(scope, input) {
      const data = await readDatabase();
      const allRows = data[scopeStorageKey(scope.applicationId, scope.workspaceId)] ?? [];
      const search = input.search?.trim().toLocaleLowerCase();
      const rows = allRows.filter((row) => (!input.status || row.status === input.status) && (!search || row.title.toLocaleLowerCase().includes(search)));
      const start = input.cursor ? Math.max(0, Number.parseInt(input.cursor, 10) || 0) : 0;
      const page = rows.slice(start, start + input.limit);
    const next = start + page.length;
    return { rows: page, nextCursor: next < rows.length ? String(next) : null, totalCount: rows.length };
  },
  async update(scope, input) {
    let updated!: Activity;
    const operation = activityWrite.then(async () => {
      const data = await readDatabase();
      const key = scopeStorageKey(scope.applicationId, scope.workspaceId);
      const rows = data[key] ?? [];
      const index = rows.findIndex((row) => row.id === input.id);
      if (index < 0) throw new Error('Activity not found in this workspace');
      updated = { ...rows[index]!, ...input, updatedAt: new Date() };
      rows[index] = updated;
      data[key] = rows;
      await writeDatabase(data);
    });
    activityWrite = operation.catch(() => undefined);
    await operation;
    return updated;
  },
};

const workspaceRecords = [
  { applicationId: 'tracker', id: 'personal-alice', name: 'Alice · Personal', actors: ['alice'], activities: [
    { id: 'run-001', title: 'Morning interval run', status: 'planned' as const, updatedAt: new Date('2026-10-10T08:00:00.000Z') },
    { id: 'ride-002', title: 'Coastal bike ride', status: 'complete' as const, updatedAt: new Date('2026-10-09T17:30:00.000Z') },
  ] },
  { applicationId: 'tracker', id: 'team', name: 'Weekend group', actors: ['alice', 'bob'], activities: [
    { id: 'team-001', title: 'Plan group hike', status: 'planned' as const, updatedAt: new Date('2026-10-10T09:15:00.000Z') },
    { id: 'team-002', title: 'Shared trail cleanup', status: 'complete' as const, updatedAt: new Date('2026-10-08T12:30:00.000Z') },
  ] },
  { applicationId: 'tracker', id: 'personal-bob', name: 'Bob · Personal', actors: ['bob'], activities: [
    { id: 'swim-100', title: 'Pool technique session', status: 'planned' as const, updatedAt: new Date('2026-10-10T07:20:00.000Z') },
  ] },
];
const noteWorkspaces = [{ applicationId: 'notes', id: 'notebook', name: 'Demo notebook', actors: ['alice', 'bob'] }];

async function seedData() {
  const data = await readDatabase();
  let changed = false;
  for (const workspace of workspaceRecords) {
    const key = scopeStorageKey(workspace.applicationId, workspace.id);
    if (data[key]) continue;
    const legacyKey = `${workspace.applicationId}:${workspace.id}`;
    const legacyMatches = workspaceRecords.filter((candidate) => `${candidate.applicationId}:${candidate.id}` === legacyKey);
    if (legacyMatches.length === 1 && data[legacyKey]) {
      data[key] = data[legacyKey];
      delete data[legacyKey];
    } else data[key] = workspace.activities;
    changed = true;
  }
  if (changed) await writeDatabase(data);
}

const capabilities: Record<string, string[]> = {
  alice: ['activities.read', 'activities.write', 'summary.refresh', 'notes.read', 'workcore.history.read', 'workcore.tasks.read', 'workcore.schedules.read', 'workcore.schedules.manage'],
  bob: ['activities.read', 'notes.read', 'workcore.history.read', 'workcore.tasks.read', 'workcore.schedules.read'],
};
const services = createFileServices({ path: resolve(process.env.WORKCORE_STATE ?? 'data/workcore-state.json'), workspaces: [...workspaceRecords, ...noteWorkspaces] });
const workcoreCodec = superjsonCodec();
const admin = createAdminHandler({ basePath: '/workcore/admin', apiBasePath: '/workcore/api', wireCodecId: workcoreCodec.id });
const trackerApplication = registerApplication({
  definition: tracker,
  createAppContext: async (): Promise<TrackerContext> => ({ activities: activityStore }),
});
const notesApplication = registerApplication({
  definition: notes,
  createAppContext: async () => ({ notebook: { list: async () => [{ id: 'n1', text: 'Write the second app example' }, { id: 'n2', text: 'Use a differently shaped context' }] } }),
});
const platform = createPlatform({
  applications: [trackerApplication, notesApplication],
  auth: {
    authenticate: (request) => actorFromCookie(request),
    resolveActor: (actorId) => actorFromId(actorId),
  },
  authorise: ({ actor, permission }) => actorCapabilities(capabilities, actor, permission),
  trustedOrigins: (process.env.WORKCORE_TRUSTED_ORIGINS ?? 'https://workcore.dev.jmcdowall.com').split(',').map((origin) => origin.trim()).filter(Boolean),
  wireCodecs: [workcoreCodec],
  services,
  admin: { basePath: '/workcore/admin', handle: admin },
  liveRefreshMs: 30_000,
});

function actorFromCookie(request: Request): Actor | null {
  const cookie = request.headers.get('cookie') ?? '';
  const match = cookie.match(/(?:^|;\s*)workcore-demo=([^;]+)/);
  return match?.[1] ? actorFromId(decodeURIComponent(match[1])) : null;
}
function actorFromId(id: string): Actor | null {
  if (!capabilities[id]) return null;
  return { id, name: id === 'alice' ? 'Alice Example' : 'Bob Example' };
}

const apiHandler = platform.httpHandler();
const app = new Hono();
app.get('/login/:actor', (context) => {
  const actor = actorFromId(context.req.param('actor'));
  if (!actor) return context.text('Unknown demo account', 404);
  setCookie(context, 'workcore-demo', actor.id, { httpOnly: true, sameSite: 'Lax', path: '/', secure: context.req.url.startsWith('https://'), maxAge: 60 * 60 * 24 * 7 });
  return context.redirect('/workcore/admin');
});
app.get('/logout', (context) => { setCookie(context, 'workcore-demo', '', { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 0 }); return context.redirect('/'); });
app.get('/', (context) => context.html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Workcore demo</title><style>body{font:16px system-ui;background:#f5f6f2;color:#27352b;max-width:760px;margin:12vh auto;padding:0 24px}h1{font-size:40px;letter-spacing:-1px}p{color:#657066;line-height:1.6}.cards{display:flex;gap:12px;margin:30px 0}.card{background:white;border:1px solid #e2e7df;border-radius:10px;padding:18px;flex:1}.card a{color:#286045;font-weight:600}.note{font-size:13px}</style></head><body><h1>Workcore</h1><p>A workspace runtime demo: scoped operations, generated admin UI, live updates and background tasks.</p><div class="cards"><div class="card"><h2>Alice</h2><p>Full workspace capabilities, personal and shared workspaces.</p><a href="/login/alice">Continue as Alice →</a></div><div class="card"><h2>Bob</h2><p>Read-only shared access plus Bob's isolated personal workspace.</p><a href="/login/bob">Continue as Bob →</a></div></div><p class="note">Open another browser window as Alice/Bob to verify live invalidation and workspace isolation.</p></body></html>`));
app.all('/workcore/*', async (context) => apiHandler(context.req.raw));
app.notFound((context) => context.text('Not found', 404));

await seedData();
const worker = platform.worker();
worker.start();
const hostname = process.env.HOST ?? '127.100.0.10';
const port = Number(process.env.PORT ?? 3000);
const server = serve({ fetch: app.fetch, hostname, port }, (info) => console.info(`Workcore demo listening on http://${info.address}:${info.port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void worker.stop().finally(() => server.close()); });
}

export { app, platform, services };
