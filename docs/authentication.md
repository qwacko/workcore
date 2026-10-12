# Better Auth and identity management

Workcore does not own login, sessions, passwords, or user storage. It accepts an `AuthAdapter`; the host connects that boundary to its authentication system. Better Auth can be used without a Workcore-specific package, and its native callback/session endpoints should remain ordinary host routes rather than Workcore operations.

The tracker example is the end-to-end reference: [Better Auth setup](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/auth.ts), [Hono host and adapter](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/server.ts), [SQLite schema](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/db/schema.ts), and [admin identity workspace](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/identity-app.ts).

## Configure Better Auth

Create and configure Better Auth in the host application. Your application chooses the database, schema, plugins, additional user fields, password policy, and sign-up policy. For example, the tracker uses Better Auth's username plugin and a Drizzle SQLite adapter:

```ts
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { admin, username } from 'better-auth/plugins';

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: 'sqlite', schema }),
  emailAndPassword: { enabled: true },
  plugins: [admin({ adminRoles: ['admin'] }), username({ displayUsername: false })],
});
```

Create and apply the schema required by Better Auth and its plugins using the Better Auth/Drizzle migration workflow. The Workcore tracker keeps these tables and its application tables in the same SQLite database, but that is a demo choice; use any Better Auth-supported persistence adapter in your host.

## Mount Better Auth routes in the host

Pass Better Auth the original request so its endpoints can manage their own cookies, redirects, callback parameters, and response headers. For Hono, mount the routes separately from the Workcore API:

```ts
app.on(['GET', 'POST'], '/api/auth/*', (context) => auth.handler(context.req.raw));
app.all('/workcore/*', (context) => workcoreHandler(context.req.raw));
```

Authentication routes must be reachable before a user has a Workcore session or workspace membership. Better Auth route security remains Better Auth's responsibility. If public registration is not wanted, disable it in Better Auth or block the sign-up endpoint in the host, as the tracker demo does.

## Adapt sessions to Workcore actors

Resolve the actor from the trusted server-side session. Never accept an actor ID from an operation request. Workcore's `resolveActor` hook is also used when queued or scheduled work executes, where the original browser session is no longer available:

```ts
const authAdapter = {
  authenticate: async (request: Request) => {
    const session = await auth.api.getSession({ headers: request.headers });
    return session
      ? { id: session.user.id, name: session.user.name }
      : null;
  },
  resolveActor: async (actorId: string) => {
    const account = await users.findById(actorId);
    return account && !account.disabled
      ? { id: account.id, name: account.name }
      : null;
  },
};

const platform = createPlatform({ applications, auth: authAdapter, services });
```

Adapt the lookup to your Better Auth schema and application rules. Keep actor IDs stable; include only server-trusted attributes that handlers or authorization need. Re-resolve users for background execution so deleted or disabled accounts are not treated as active based on an old request.

## Configure origins

`HOST` and `PORT` select the address the server listens on. `BETTER_AUTH_URL` is the browser-facing public URL, which can differ behind a reverse proxy. Configure exact trusted origins for the browser origin, including scheme and nonstandard port where applicable; do not trust arbitrary forwarded headers. The tracker derives Better Auth and Workcore defaults from `BETTER_AUTH_URL` and supports `BETTER_AUTH_TRUSTED_ORIGINS` and `WORKCORE_TRUSTED_ORIGINS` as separate comma-separated overrides.

The tracker loads `examples/tracker/.env` and then the repository-root `.env`; shell-exported values take precedence. Restart the server after changing them. Keep `BETTER_AUTH_SECRET` private and use secure same-origin cookies in a deployed app.

## Add user management

Authentication and user administration are separate concerns. Workcore does not automatically generate a user directory from Better Auth's schema. Define a workspace with explicitly permission-checked operations over the management APIs or repositories your host supports. This lets the application expose only the fields and actions it intends—such as listing accounts, editing display names, or changing roles—without assuming every Better Auth plugin or persistence schema is the same.

The tracker's admin-only `identity` workspace demonstrates this approach. Its `users` query and name/role mutations call Better Auth's `listUsers`, `adminUpdateUser`, and `setRole` APIs, passing the incoming request headers so Better Auth can authenticate and authorize each admin operation. The identity workspace and Better Auth Admin plugin both recognize the `admin` role. Table row actions prefill mutation forms from the selected row. The identity workspace grants access only to admin accounts; workspace membership and operation authorization are still enforced.

Synchronous Workcore operation handlers can read optional `ctx.request` metadata (`url`, `method`, and a copied `Headers` object). This is present for HTTP calls and omitted for worker/scheduled executions; request headers can contain credentials, so do not log or persist them. Forward them only to APIs that need the caller's session. This is a small general-purpose request-context facility, not a way to make background jobs inherit a user's browser session.

The demo checks the last-admin case by listing all Better Auth users before demoting an administrator. This is intentionally a simple example safeguard, not an atomic guarantee: concurrent role changes, very large user sets, custom pagination behavior, and schema/plugin changes need stronger application-specific handling in production. Likewise, its `role` field and admin-role configuration are demo choices, and the exposed user fields/actions are not a general-purpose Better Auth adapter. Password management is deliberately out of scope.

The tracker puts Better Auth directly in the identity app context, typed as `typeof auth`. A handler gets the incoming session headers from Workcore and passes them to Better Auth; it then projects the result to the small set of fields its output schema exposes. `toIdentityUser` is the small projection helper in the complete example:

```ts
import { auth } from './auth.js';

type IdentityContext = { auth: typeof auth };

// Inside the identity workspace's setUserRole mutation:
mutations: {
  setUserRole: {
    handler: async ({ ctx, input }) => {
      const headers = ctx.request?.headers;
      if (!headers) throw new Error('Identity administration requires an HTTP request');

      const { user } = await ctx.app.auth.api.setRole({
        body: { userId: input.id, role: input.role },
        headers,
      });
      return toIdentityUser(user); // project only the fields allowed by the Workcore output schema
    },
  },
}

identity.registerApplication({
  createAppContext: () => ({ auth }),
  resolveAuthorization: ({ actor }) => ({ isAdmin: actor.role === 'admin' }),
});
```

The users query and name mutation follow the same pattern, using `listUsers` and `adminUpdateUser`. The tracker keeps the calls together in [identity-app.ts](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/identity-app.ts).

The platform still checks that the actor can access the selected identity workspace, then checks the workspace authorization context and operation permission. In the tracker, the Better Auth user has a server-managed `role` field, and the identity workspace is seeded for the admin. This is intentionally explicit: making someone an admin of this identity workspace does not silently grant access to unrelated workspaces. For the complete schema, row actions, role/name mutations, and Hono composition, see the [identity workspace source](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/identity-app.ts) and [host registration](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/server.ts).

The tracker composition is a single-process example, not a production deployment recipe: its user/domain tables use SQLite, while Workcore tasks, schedules, KV, history, and events use local file adapters. See [production deployment](/production-deployment) for shared Workcore services and deployment guarantees.
