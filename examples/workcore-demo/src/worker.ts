import { Workspace, routeWorkspace } from '@workcore/core/cloudflare';
import { serveAdmin } from '@workcore/admin/server';
import { tracker } from './app.js';
import type { Env } from './app.js';
import { notesApp } from './notes.js';
import { authFor } from './auth.js';
import { isConfiguredAdmin } from './admin.js';

export class TrackerWorkspace extends Workspace<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, { ...tracker, authorize: (context, action) => action === '$admin' && isConfiguredAdmin(env, context.actor.id) || tracker.authorize(context, action) });
  }
}
export class NotesWorkspace extends Workspace<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, { ...notesApp, authorize: (context, action) => action === '$admin' && isConfiguredAdmin(env, context.actor.id) || notesApp.authorize(context, action) });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const requestEnv = env.BETTER_AUTH_URL ? env : { ...env, BETTER_AUTH_URL: url.origin };
    if (url.pathname.startsWith('/api/auth/')) return (await authFor(requestEnv)).handler(request);
    const session = await (await authFor(requestEnv)).api.getSession({ headers: request.headers });
    if (url.pathname === '/api/admin-navigation') {
      if (!session) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401 });
      return Response.json({ homeHref: '/', workspaces: [{ id: 'demo', label: 'Tasks' }, { id: 'notes', label: 'Notes' }] }, { headers: { 'cache-control': 'no-store' } });
    }
    if (url.pathname.startsWith('/api/workspaces/')) {
      return routeWorkspace(request, {
        namespace: env.WORKSPACES,
        namespaceFor: workspaceId => workspaceId === 'notes' ? env.NOTES : env.WORKSPACES,
        authenticate: () => session ? { actor: { id: session.user.id }, expiresAt: session.session.expiresAt.getTime() } : null,
      });
    }
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      if (!session) return Response.redirect(new URL('/', request.url).href, 303);
      // Admin's build has its own SPA fallback and shares this Worker's asset binding.
      return serveAdmin(request, { fetch: req => {
        const assetUrl = new URL(req.url);
        assetUrl.pathname = `/admin-assets${assetUrl.pathname}`;
        if (!assetUrl.pathname.split('/').pop()?.includes('.')) assetUrl.pathname = '/admin-assets/';
        return env.ASSETS.fetch(new Request(assetUrl, req));
      } });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
