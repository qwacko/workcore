import './load-env.js';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createAdminHandler } from '@workcore/admin/server';
import { createAiSdkAgentEngine } from '@workcore/ai-sdk';
import { superjsonCodec } from '@workcore/codec-superjson';
import { createPlatform, type Actor, type AgentEngine, type PlatformServices } from '@workcore/core';
import { createFileAgentRuns, createFileEvents, createFileHistory, createFileKV, createFileLogger, createFileSchedules, createFileState, createFileTasks } from '@workcore/adapters/file';
import { tracker } from './app.js';
import { identity } from './identity-app.js';
import { notes } from './second-app.js';
import { auth } from './auth.js';
import { serverConfig, workcoreTrustedOrigins } from './config.js';
import { closeDatabase, db, migrateDatabase } from './db/index.js';
import { user } from './db/schema.js';
import { activityStore, seedActivityData } from './tracker-data.js';
import { conversationStore } from './conversation-data.js';
import { miloDemoEngine } from './milo-demo-engine.js';
import { migrateTrackerCompositionFile } from './migrate-composition.js';
import { roleCanUseWorkcoreCapability } from './demo-workspaces.js';
import { seedIdentityAndWorkspaces, sqliteWorkspaceAdapter, workspaceRole } from './workspace-data.js';

const statePath = resolve(process.env.WORKCORE_STATE ?? 'data/workcore-state.json');
const stateBackup = await migrateTrackerCompositionFile(statePath);
if (stateBackup) console.info(`Migrated tracker operation names for module composition; original state saved to ${stateBackup}`);
const fileState = createFileState({ path: statePath, workspaces: [] });
const modelId = process.env.WORKCORE_AGENT_MODEL ?? 'anthropic/claude-3.5-sonnet';
const openrouter = process.env.OPENROUTER_API_KEY
  ? createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })
  : undefined;
const agentModel = openrouter?.chat(modelId);
const agentEngine: AgentEngine = agentModel && process.env.WORKCORE_AGENT_MODE !== 'demo'
  ? createAiSdkAgentEngine({ model: agentModel })
  : miloDemoEngine;
const services: PlatformServices = {
  workspaces: sqliteWorkspaceAdapter,
  events: createFileEvents(fileState),
  history: createFileHistory(fileState),
  agentRuns: createFileAgentRuns(fileState),
  agentEngine,
  tasks: createFileTasks(fileState),
  schedules: createFileSchedules(fileState),
  kv: createFileKV(fileState),
  logger: createFileLogger(fileState),
};
const workcoreCodec = superjsonCodec();
const admin = createAdminHandler({ basePath: '/workcore/admin', apiBasePath: '/workcore/api', wireCodecId: workcoreCodec.id });

async function actorFromId(id: string): Promise<Actor | null> {
  const [record] = await db.select({ id: user.id, name: user.name, role: user.role }).from(user).where(eq(user.id, id)).limit(1);
  return record ? { id: record.id, name: record.name, role: record.role } : null;
}

const platform = createPlatform({
  applications: [
    tracker.registerApplication({
      createAppContext: async () => ({ activities: activityStore, conversations: conversationStore, agentRuns: services.agentRuns! }),
      resolveAuthorization: async ({ actor, scope }) => {
        const membershipRole = await workspaceRole(actor.id, scope);
        const role: 'owner' | 'viewer' = membershipRole === 'owner' ? 'owner' : 'viewer';
        return { userId: actor.id, role, isAdmin: actor.role === 'admin' };
      },
    }),
    notes.registerApplication({
      createAppContext: async () => ({ notebook: { list: async () => [{ id: 'n1', text: 'Write the second app example' }, { id: 'n2', text: 'Use a differently shaped context' }] } }),
      resolveAuthorization: async ({ actor, scope }) => ({ role: (await workspaceRole(actor.id, scope)) === 'owner' ? 'owner' as const : 'viewer' as const }),
    }),
    identity.registerApplication({
      createAppContext: () => ({ auth }),
      resolveAuthorization: async ({ actor }) => ({ isAdmin: actor.role === 'admin' }),
    }),
  ],
  auth: {
    authenticate: async (request) => {
      const session = await auth.api.getSession({ headers: request.headers });
      return session ? { id: session.user.id, name: session.user.name, role: session.user.role } : null;
    },
    resolveActor: actorFromId,
  },
  authorise: async ({ actor, scope, permission }) => {
    if (scope.applicationId === 'identity') return actor.role === 'admin';
    if (!permission.startsWith('workcore.')) return true;
    const role = await workspaceRole(actor.id, scope);
    return (role === 'owner' || role === 'viewer') && roleCanUseWorkcoreCapability(role, permission);
  },
  trustedOrigins: workcoreTrustedOrigins,
  wireCodecs: [workcoreCodec],
  services,
  liveRefreshMs: 30_000,
});

const authPage = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Workcore sign in</title><style>
  body{font:16px system-ui;background:#f5f6f2;color:#27352b;max-width:760px;margin:9vh auto;padding:0 24px}h1{font-size:40px;letter-spacing:-1px}p{color:#657066;line-height:1.6}.card{background:white;border:1px solid #e2e7df;border-radius:10px;padding:24px;max-width:440px}label{display:block;margin:14px 0 5px}input{box-sizing:border-box;width:100%;padding:11px;border:1px solid #cdd5cb;border-radius:7px;font:inherit}button{margin-top:18px;padding:11px 16px;border:0;border-radius:7px;background:#286045;color:white;font:inherit;font-weight:600;cursor:pointer}.error{color:#a22}.demo{margin-top:22px;font-size:14px;color:#657066}.demo code{color:#27352b}.links{display:flex;gap:16px;margin-top:18px}.links a{color:#286045}
  </style></head><body><h1>Workcore</h1><p>A workspace runtime demo with database-backed accounts, roles, and workspace membership.</p><section class="card"><h2>Sign in</h2><form id="login"><label for="username">Username</label><input id="username" name="username" autocomplete="username" required><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button><p id="error" class="error" role="alert"></p></form><div class="demo"><strong>Local demo accounts</strong><br>Alice: <code>alice / alice-demo-pass</code><br>Bob: <code>bob / bob-demo-pass</code><br>Admin: <code>admin / admin-demo-pass</code></div></section><div class="links"><a href="/workcore/admin">Open console</a><a href="/logout">Sign out</a></div><script>
  document.querySelector('#login').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const error = document.querySelector('#error'); error.textContent = ''; try { const response = await fetch('/api/auth/sign-in/username', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Sign in failed'); location.assign('/workcore/admin'); } catch (cause) { error.textContent = cause.message || 'Sign in failed'; } });
  </script></body></html>`;

const apiHandler = platform.httpHandler({ admin: { basePath: '/workcore/admin', handle: admin } });
const app = new Hono();
app.get('/', (context) => context.html(authPage));
app.get('/login', (context) => context.html(authPage));
app.get('/logout', (context) => context.html(`<!doctype html><html><body><p>Signing out…</p><script>fetch('/api/auth/sign-out',{method:'POST'}).finally(()=>location.assign('/'))</script></body></html>`));
// This demo provisions fixed accounts locally; never allow public self-registration.
app.on('POST', '/api/auth/sign-up/email', (context) => context.json({ message: 'Sign-up is disabled in this demo' }, 403));
app.on(['GET', 'POST'], '/api/auth/*', (context) => auth.handler(context.req.raw));
app.all('/workcore/*', async (context) => apiHandler(context.req.raw));
app.notFound((context) => context.text('Not found', 404));

migrateDatabase();
await seedIdentityAndWorkspaces();
await seedActivityData();
const worker = platform.worker();
worker.start();
const server = serve({ fetch: app.fetch, hostname: serverConfig.host, port: serverConfig.port }, (info) => console.info(`Workcore demo listening on http://${info.address}:${info.port}`));
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void worker.stop().finally(() => { server.close(); closeDatabase(); }); });
}

export { app, platform };
