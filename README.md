# Workcore

Workcore is a TypeScript workspace application runtime for quickly building full-stack apps. Define validated queries, mutations and tasks once; Workcore supplies checked execution, workspace access, live invalidation, a typed client and an optional prebuilt admin UI.

The application owns its domain data and repositories. Workcore owns the execution boundary and small, replaceable infrastructure interfaces. Its authoring examples are kept executable and typechecked to be easy for developers and AI coding agents to reuse.

## Getting started

Requirements: Node.js 22+ and pnpm 10+.

```sh
pnpm install
pnpm build
pnpm dev
```

Open <http://127.100.0.10:3000>, then choose **Alice** or **Bob**. By default the demo binds to `127.100.0.10:3000`; configure the bind address with `HOST` and port with `PORT` (for example, `HOST=127.0.0.1 PORT=4173 pnpm dev`). For reverse proxies, set `WORKCORE_TRUSTED_ORIGINS` to a comma-separated list of public origins (for example, `https://workcore.dev.jmcdowall.com`). The default includes that demo origin. The demo shows personal and shared workspace isolation, a live activity table, generated edit forms, a task triggered by mutations, schedules, history, and a second application with a differently shaped context.

Browse the [Workcore documentation site](https://qwacko.github.io/workcore/) or run it locally with `pnpm docs:dev`.

The demo's `/login/alice` and `/login/bob` routes and file-backed adapters are for local development only—not production authentication or multi-process infrastructure.

## Packages

| Package | Purpose |
| --- | --- |
| `@workcore/core` | Definitions, checked runtime, HTTP/SSE endpoints and adapter contracts |
| `@workcore/adapters` | Explicit memory and local file implementations for the core adapter contracts |
| `@workcore/client` | Browser-safe typed client and fetch/SSE transport |
| `@workcore/codec-superjson` | Optional SuperJSON wire codec for rich values such as `Date` |
| `@workcore/codec-devalue` | Optional devalue wire codec for its supported rich-value set |
| `@workcore/admin` | Prebuilt Svelte admin assets and host-route handler |
| `examples/tracker` | Hono host, example workspace definitions and local durable adapter composition |

For a shared multi-process deployment, `@workcore/adapters/postgres` provides durable workspace, KV, history, task and schedule state, and `@workcore/adapters/redis` provides scoped transient events. See the [production deployment guide](docs/production-deployment.md) for setup, migrations, retention and delivery guarantees. These entry points use optional peer drivers rather than bundling database clients.

The core has no database, queue, auth-provider or UI framework dependency. The supplied admin is optional; applications can use only the runtime/client or provide their own frontend.

The wire protocol defaults to strict JSON. To preserve rich values, install a codec package, pass the same codec to the typed client and allow-list it on the platform. The tracker example uses `superjsonCodec()` and has a `Date` query to demonstrate that schema types remain `Date` end-to-end; its local JSON database separately stores ISO strings explicitly.

```ts
const codec = superjsonCodec();
const platform = createPlatform({ applications, auth, services, wireCodecs: [codec] });
const client = createClient<typeof app>({
  transport: createFetchTransport({ codec }), applicationId: 'app', workspaceId: 'one',
});
```

Published packages use ESM `exports` maps and include declarations. Changesets manages package versioning and public scoped releases (`pnpm changeset`, `pnpm version-packages`, `pnpm release`). `pnpm version-packages` snapshots docs under the resulting `@workcore/core` version; archived versions stay available in the site navigation.

## Authoring shape

```ts
export const tracker = defineWorkspace<TrackerContext>()({
  id: 'tracker',
  queries: {
    activities: {
      input: activityListSchema,
      output: activityPageSchema,
      permission: 'activities.read',
      api: true,
      ui: {
        default: 'basic',
        variants: {
          basic: { title: 'Activities', renderer: 'table', rowKey: 'id', columns: ['title', 'status'] },
          data: { title: 'Data', renderer: 'json' },
        },
      },
      handler: ({ ctx, input }) => ctx.app.activities.list(ctx.scope, input),
    },
  },
  mutations: {
    editActivity: {
      input: editActivitySchema,
      output: activitySchema,
      permission: 'activities.write',
      api: true,
      ui: { default: 'basic', variants: { basic: { title: 'Edit activity', renderer: 'form' } } },
      handler: ({ ctx, input }) => ctx.app.activities.update(ctx.scope, input),
    },
  },
});
```

Tasks use the same inline shape. Their handlers receive a typed `operations` caller inferred from every query, mutation, and task in this definition, so tasks can safely call peer tasks without a separate operation builder. Task mutation triggers and UI mutation actions are also checked against the declared mutations, including action bindings against mutation input fields.

Core accepts Standard Schema. Generated forms/manifests require schemas to also provide Standard JSON Schema; Zod 4 is used in the example. Browser input is validated again on the server. See the [implementation brief](workspace-framework-implementation-brief.md) and [architecture notes](docs/architecture.md) for contracts, security expectations and limits.

For an existing application, install the packages you need (`@workcore/core`, `@workcore/client`, and optionally `@workcore/admin` or adapters), define a workspace catalog, register its context factory, and mount `platform.httpHandler()` in a host. The full copyable multi-process composition is in [Production deployment](docs/production-deployment.md); the tracker remains a local demo and uses demo-only login routes.

## Admin and host setup

Build the optional admin package as part of the workspace build, then mount its handler alongside the API:

```ts
const admin = createAdminHandler({ basePath: '/workcore/admin', apiBasePath: '/workcore/api' });
const handler = platform.httpHandler({
  apiBasePath: '/workcore/api',
  admin: { basePath: '/workcore/admin', handle: admin },
});
```

The host authenticates requests and mounts this `Request -> Response` handler. The admin's compiled assets are served from the installed package; consumers do not need Svelte/SvelteKit or a frontend build. Custom clients use the same HTTP and SSE contract.

## Verification

```sh
pnpm build
pnpm test
pnpm typecheck
pnpm test:e2e # launches the local demo; requires Playwright Chromium
pnpm test:packages # packs and installs packages in a separate temporary consumer
pnpm --filter @workcore/adapters test:integration # requires PostgreSQL and Redis test URLs
```

## Documentation site

Run `pnpm docs:dev` to edit the VitePress site or `pnpm docs:build` to check it. To publish from GitHub, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**; `.github/workflows/docs.yml` deploys `main` to <https://qwacko.github.io/workcore/>. `pnpm version-packages` snapshots the current Markdown under the resulting `@workcore/core` version, and the site's Versions menu keeps those snapshots available.

TypeScript 7 is used for core/client and the demo. Svelte's current checker requires TypeScript 6 for its ordinary API, so the admin package checks source with TypeScript 6 and runs `svelte-check --tsgo` with TypeScript 7. This is isolated to the UI toolchain.

Framework-managed transactions/outbox, automatic retries, agents, composed views and Better Auth integration remain deferred. PostgreSQL and Redis adapters are available, but Redis events are transient and task delivery is at-least-once. See [actual limitations](docs/architecture.md#current-limitations) and [production deployment](docs/production-deployment.md).
