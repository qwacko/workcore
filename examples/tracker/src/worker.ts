import { Workspace, routeWorkspace } from '@workcore/core/cloudflare';
import { serveAdmin } from '@workcore/admin/server';
import { tracker } from './app.js';
import type { Env } from './app.js';

export class TrackerWorkspace extends Workspace<Env> {
  constructor(ctx: DurableObjectState, env: Env) { super(ctx, env, tracker); }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Deliberately not production authentication. Extra dev hosts require explicit configuration.
    const allowedHosts = ['localhost', '127.0.0.1', '[::1]', ...(env.DEMO_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)];
    const local = env.DEMO_MODE === 'true' && allowedHosts.includes(url.hostname);
    if (!local) return new Response('This example has no production authentication. Install a real session verifier before exposing it.', { status: 503 });
    if (url.pathname === '/demo/login' && request.method === 'POST') {
      if (request.headers.get('origin') !== url.origin) return new Response('Origin denied', { status: 403 });
      const form = await request.formData();
      const user = form.get('user');
      if (user !== 'alice' && user !== 'bob') return new Response('Unknown demo user', { status: 400 });
      return new Response(null, { status: 303, headers: { location: '/workspace', 'set-cookie': `demo_user=${user}; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600${url.protocol === 'https:' ? '; Secure' : ''}` } });
    }
    const user = /(?:^|;\s*)demo_user=(alice|bob)(?:;|$)/.exec(request.headers.get('cookie') ?? '')?.[1];
    if (url.pathname.startsWith('/api/workspaces/')) {
      return routeWorkspace(request, {
        namespace: env.WORKSPACES,
        authenticate: () => user ? { actor: { id: user }, expiresAt: Date.now() + 300_000 } : null,
      });
    }
    if (url.pathname === '/workspace') {
      if (!user) return Response.redirect(new URL('/', request.url).href, 303);
      return Response.redirect(new URL('/admin/demo', request.url).href, 303);
    }
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      if (!user) return Response.redirect(new URL('/', request.url).href, 303);
      return serveAdmin(request, env.ASSETS);
    }
    if (url.pathname !== '/') return new Response('Not found', { status: 404 });
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Workcore tracker</title>
      <style>body{font:16px/1.6 system-ui;background:#111318;color:#e8eaf0;max-width:620px;margin:12vh auto;padding:24px}h1{font-size:40px;letter-spacing:-1.5px}p{color:#a0a9bb}button{font:inherit;background:#30271f;color:#ffb673;border:1px solid #735338;border-radius:8px;padding:12px 24px;margin:8px 8px 8px 0;cursor:pointer}code{color:#ffb673}</style>
      <p>WORKCORE / CLOUDFLARE-FIRST</p><h1>A live workspace.<br>One durable home.</h1><p>JSON records, typed mutations, private live views, schedules and agent runs—backed by one SQLite Durable Object.</p>
      <form method="post" action="/demo/login"><button name="user" value="alice">Open as Alice · admin</button><button name="user" value="bob">Open as Bob · member</button></form>
      <p>Local demo only. Use separate browser profiles to compare Alice and Bob. Open <code>tasks</code> and subscribe with <code>{}</code>; create a task in another window to see live updates.</p></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  },
} satisfies ExportedHandler<Env>;
