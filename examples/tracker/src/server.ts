import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { createAdminHandler } from '@workcore/admin/server';
import { superjsonCodec } from '@workcore/codec-superjson';
import { createPlatform, type Actor, type PlatformServices } from '@workcore/core';
import { createFileEvents, createFileHistory, createFileKV, createFileLogger, createFileSchedules, createFileState, createFileTasks, createFileWorkspaces } from '@workcore/adapters/file';
import { tracker } from './app.js';
import { notes } from './second-app.js';
import { activityStore, seedData } from './tracker-data.js';
import { isKnownActor, workspaceRole, workspaceServiceConfig } from './demo-workspaces.js';

const fileState = createFileState({ path: resolve(process.env.WORKCORE_STATE ?? 'data/workcore-state.json'), workspaces: workspaceServiceConfig() });
const services: PlatformServices = {
  workspaces: createFileWorkspaces(fileState),
  events: createFileEvents(fileState),
  history: createFileHistory(fileState),
  tasks: createFileTasks(fileState),
  schedules: createFileSchedules(fileState),
  kv: createFileKV(fileState),
  logger: createFileLogger(fileState),
};
const workcoreCodec = superjsonCodec();
const admin = createAdminHandler({ basePath: '/workcore/admin', apiBasePath: '/workcore/api', wireCodecId: workcoreCodec.id });
const trackerApplication = tracker.registerApplication({
  createAppContext: async () => ({ activities: activityStore }),
  resolveAuthorization: async ({ actor, scope }) => {
    return { userId: actor.id, role: workspaceRole(actor.id, scope.applicationId, scope.workspaceId) ?? 'viewer', isAdmin: false };
  },
});
const notesApplication = notes.registerApplication({
  createAppContext: async () => ({ notebook: { list: async () => [{ id: 'n1', text: 'Write the second app example' }, { id: 'n2', text: 'Use a differently shaped context' }] } }),
  resolveAuthorization: async ({ actor, scope }) => ({ role: workspaceRole(actor.id, scope.applicationId, scope.workspaceId) ?? 'viewer' }),
});

const platform = createPlatform({
  applications: [trackerApplication, notesApplication],
  auth: {
    authenticate: (request) => actorFromCookie(request),
    resolveActor: (actorId) => actorFromId(actorId),
  },
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
  if (!isKnownActor(id)) return null;
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

export { app, platform};
