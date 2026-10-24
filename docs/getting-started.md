# Getting started

## Try the local example

Requirements: Node.js 22+ and pnpm 10+.

```sh
pnpm install
pnpm build
pnpm dev
```

Open <http://127.100.0.10:3000> and sign in as `alice / alice-demo-pass`, `bob / bob-demo-pass`, or `admin / admin-demo-pass`. The tracker demonstrates Better Auth username/password authentication, an admin-only identity workspace for listing users and changing names/roles, and Drizzle-backed SQLite for accounts, workspace memberships, and activity data. Tasks, schedules, history, KV, logging, and events remain file-backed. These credentials and this single-process composition are for local development only; change the passwords and `BETTER_AUTH_SECRET` before exposing the app.

The server binds to `HOST` (default `127.100.0.10`) and `PORT` (default `3000`). Set `BETTER_AUTH_URL` to the public URL seen by the browser, especially behind a reverse proxy. Better Auth and Workcore derive their default trusted origins from this URL; override with comma-separated `BETTER_AUTH_TRUSTED_ORIGINS` and `WORKCORE_TRUSTED_ORIGINS` when needed.

For the tracker, environment files are loaded from `examples/tracker/.env` and then the repo-root `.env`; shell-exported values take precedence. Restart the server after changing these settings.

The SQLite database defaults to `examples/tracker/data/workcore.sqlite` and can be relocated with `WORKCORE_DATABASE`. Drizzle migrations are in `examples/tracker/drizzle`; edit the schema and generate a migration with `pnpm --filter @workcore/example db:generate`. Better Auth's native endpoints are mounted by the Hono host under `/api/auth/*`; user registration is blocked in the demo, and the seed accounts are created on startup.

The tracker is a [composed application](/composition): activities and the assistant are independently authored modules, with typed synchronous dependencies and an optional activity-update callback wired in `src/app.ts`. **Workspace overview** shows both modules together. Identity stays a separate admin-only application. Existing local file state receives a backed-up operation-name migration before startup; stop old demo processes first. See [tracker upgrade notes](/composition#upgrading-the-existing-local-tracker-demo).

## Add Workcore to an application

Install only the packages you need:

```sh
pnpm add @workcore/core @workcore/client
```

Follow the [complete minimal integration](/minimal-integration) to define an application catalog, register a context factory, authenticate requests, check workspace access, mount a Request/Response handler, and call it with the typed client. Its source is typechecked and tested in the repository. `defineApplication` is the preferred catalog name; `defineWorkspace` remains a compatible alias. A workspace instance is a scoped `{ applicationId, workspaceId }`, not another catalog.

The [authoring guide](/authoring) explains operation contracts; the [configuration reference](/configuration) lists options/defaults; the [production guide](/production-deployment) covers shared adapters and workers.

The application supplies authentication, repositories, and domain data. Workcore validates and authorizes operations but does not automatically scope an unrestricted database connection—handlers/repositories must use the operation's workspace scope.

See [admin pages and views](/admin-pages) for table-row actions that prefill mutation forms and [authentication](/authentication) for the Better Auth host integration pattern.

## Optional packages

- `@workcore/admin` provides a prebuilt route-mounted console.
- `@workcore/adapters/postgres` and `@workcore/adapters/redis` provide shared deployment adapters. Install `pg` and `redis` in your host application.
- `@workcore/codec-superjson` or `@workcore/codec-devalue` preserve supported rich values across the wire. The default protocol is strict JSON.

See the repository [README](https://github.com/qwacko/workcore#readme) for package details, tests, and the full demo overview.
