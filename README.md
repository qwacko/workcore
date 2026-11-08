# Workcore

**A Cloudflare-first kit for live workspace applications.**

Define Drizzle SQLite tables, typed actions and authorised read models. Workcore supplies transactional SQLite persistence inside a Durable Object, live client subscriptions, background execution, schedules, and a manifest-driven SvelteKit console.

One workspace has one Durable Object and one database. There is no D1 dependency, database adapter layer, Redis, separate queue server, or portable runtime to assemble.

> Initial release target: **0.1.0**. Packages are prepared for npm publication, but availability must be confirmed before using the registry installation commands below. They ship ESM JavaScript and TypeScript declarations; 0.x APIs may change. The previous portable implementation remains in Git history at `7c2c092`, without a compatibility layer or data migration.

## Install in another application

Use Node.js 22.17+ and a TypeScript/ESM Cloudflare Workers application. Once 0.1.0 is published:

```sh
pnpm add @workcore/core@0.1.0 @workcore/client@0.1.0 drizzle-orm@^0.45.4 zod@^4.6.7
pnpm add -D wrangler drizzle-kit typescript @cloudflare/workers-types
```

Install optional packages only when needed:

```sh
pnpm add @workcore/admin@0.1.0  # Prebuilt console and asset-copy helper
pnpm add @workcore/files@0.1.0  # R2-backed files
pnpm add @workcore/ai@0.1.0     # AI SDK agents
```

There is no umbrella `workcore` npm package to install. Your app does not need Svelte unless you choose it for your own frontend; the admin SPA is prebuilt. Core data needs SQLite Durable Objects, not D1. The example uses D1 only for Better Auth identities.

Before npm publication, use local tarballs produced by `pnpm pack`; see [packaging and publication](docs/publishing.md). The [getting-started guide](docs/getting-started.md) covers schema setup, migration bundling, the Worker host, client usage, and optional admin assets.

### Coding-agent instructions

A copyable [AGENTS.md example](packages/core/AGENTS.example.md) documents the actual APIs, permissions, migrations, live views and execution rules. It is included in `@workcore/core`:

```sh
# If your app already has AGENTS.md, merge the guidance instead of overwriting it.
cp node_modules/@workcore/core/AGENTS.example.md ./AGENTS.md
```

This guides coding agents developing **your app**. It is separate from runtime AI agents supplied by `@workcore/ai`.

## Run the example app

Node.js 22.17+ and pnpm 10:

```sh
pnpm install
cp examples/workcore-demo/.env.example examples/workcore-demo/.env
# Set BETTER_AUTH_URL in that file to the exact browser origin, then:
pnpm dev
```

Set `BETTER_AUTH_URL` to the exact browser origin (the example uses `http://127.0.0.1:8787`), open that origin, and create an account. The local demo uses Better Auth and a local D1 database for identities; Workcore data lives in SQLite Durable Objects. Do not overwrite an existing `.env` file if you already configured the example.

The shadcn-svelte frontend opens to chat. Ask it to create tasks or notes, or attach live lists. The **Tasks** section provides compact list and board views, with a filter for your own work. Private tasks are filtered on the server. Notes are private and support editing, starring and archiving. Open another tab to see live updates. The **Admin** link opens the default Workcore console for the current workspace, including generated displays, operations and the assistant.

The launcher builds the admin and SPA assets, then runs the SPA with hot module replacement and proxies API, admin and WebSocket requests to a local Wrangler Worker. Production serves both static builds from the Worker. See [the demo README](examples/workcore-demo/README.md) for deployment and configuration.

The optional assistant uses a deterministic response when no model is selected. Configure `WORKCORE_AGENT_MODEL` and the relevant provider key in root `.env` or `examples/workcore-demo/.env`; shell variables take precedence. See [AI SDK agents](docs/ai.md). Secrets are forwarded to Wrangler via a private temporary file, never browser variables.

## The model

- **Tables** are ordinary Drizzle SQLite tables with constraints, indexes, and SQL types.
- **Mutations** synchronously commit SQL, internal KV, queued jobs and schedules together.
- **Views** are read-only, bounded, authorised results. Typed trigger keys selectively invalidate subscribed views, with wildcard-safe defaults.
- **Queries** fetch data once, including application-defined cursor-paginated pages for larger datasets.
- **Tasks and agents** have persisted runs, outcomes, step traces and explicit interruption semantics.
- **Schedules** launch jobs once or on a fixed interval, driven by Durable Object alarms.

The server determines what a user may receive. The browser can filter, group and sort that authorised dataset; browser filtering is never a security boundary.

## Authoring

The basic pattern is schema → operations → authenticated Worker → typed client. See [getting started](docs/getting-started.md) for the complete file/configuration sequence and [authoring](docs/authoring.md) for details.

```ts
// src/app.ts — schema.ts and migrations.ts are defined in the getting-started guide.
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { workspace } from '@workcore/core';
import { schema, todos } from './schema.js';
import migrations from './migrations.js';

const app = workspace(schema, migrations, { triggerKeys: ['todos'] as const });
const addTodo = app.mutation({
  input: z.object({ title: z.string().min(1).max(200) }),
  output: z.string(),
  triggers: ['todos'],
  handler: ({ db, actor }, input) => {
    const id = crypto.randomUUID();
    db.insert(todos).values({ id, ownerId: actor.id, title: input.title }).run();
    return id;
  },
});
const myTodos = app.view({
  input: z.object({}),
  output: z.array(z.object({ id: z.string(), title: z.string() })),
  dependsOn: ['todos'],
  handler: ({ db, actor }) => db.select({ id: todos.id, title: todos.title })
    .from(todos).where(eq(todos.ownerId, actor.id)).orderBy(todos.id).limit(501).all(),
});
export const application = app.define({
  mutations: { addTodo }, views: { myTodos }, queries: {}, jobs: {},
  authorize: ({ actor }, action) => !!actor.id &&
    ['$connect', 'mutation:addTodo', 'view:myTodos'].includes(action),
});
```

Extend `Workspace` from `@workcore/core/cloudflare` with this definition and route authenticated requests through `routeWorkspace`. See the [complete tracker](examples/workcore-demo/src/app.ts), its [Cloudflare host](examples/workcore-demo/src/worker.ts), and [authoring guide](docs/authoring.md).

```ts
import { createClient } from '@workcore/client';
import type { application } from './app.js';

const client = createClient<typeof application>({
  baseUrl: '/api/workspaces/demo',
});

const subscription = client.subscribe('myTodos', {}, state => {
  if (state.status === 'live') console.log(state.data);
});

const result = await client.mutate('addTodo', { title: 'Ship something small' });
await subscription.whenRevision(result.revision);
// On component/app teardown:
subscription.unsubscribe();
client.close();
```

Only import the application **type** into browser code. Authenticate in the host, enforce row ownership in operations, and keep SQL mutations synchronous. Workcore does not require a particular permission schema.

## Deploy the example / publish the packages

These are separate actions:

- **Cloudflare application:** configure the example's D1 database, R2 bucket, auth secrets and public origin, then run `pnpm deploy`. See the [example deployment instructions](examples/workcore-demo/README.md#cloudflare-deployment). `pnpm build` only builds and performs a deployment dry run.
- **npm libraries:** publish a versioned GitHub Release to trigger verification, pnpm packing and release-asset upload. npm publication is opt-in via `NPM_PUBLISH_ENABLED=true`, uses OIDC and waits for any `npm-release` environment approval. Keep the root and example private. See the [one-time setup, initial npm bootstrap and release instructions](docs/publishing.md).

`pnpm test:packages` checks the packed artifacts without publishing. It also builds the existing todo/notes example against those artifacts, so a separate new application is not a prerequisite for this release check.

## Repository

| Path | Responsibility |
| --- | --- |
| `packages/core` | Drizzle schema/runtime, transactional operations, runs/schedules, Cloudflare host |
| `packages/client` | Browser-safe inferred API, WebSocket subscriptions, reconnect and revision tracking |
| `packages/admin` | SvelteKit SPA, generated forms, semantic pages and operational inspection; compiled to Worker static assets |
| `packages/ai` | Optional AI SDK integration, model profiles, safe fallback and checked agent tools |
| `packages/files` | Optional R2 file metadata/schema helpers |
| `examples/workcore-demo` | Executable Cloudflare application, private/shared data, scheduling and an optional AI agent |
| `tests` | Real Workers/SQLite integration tests and compile-time API checks |

## Deliberate boundaries

No offline writes, cross-workspace transactions, arbitrary client query language, automatic incremental SQL views, backend portability, cron/timezones, resumable agents, or raw admin record editing. Chat history is persisted; optional inference deltas provide transient progress, without resumable model execution. Wire values are plain JSON—not JavaScript dates, maps or custom classes.

Large collections need explicit indexes, SQL limits and paginated queries; do not rely on `.all()` to impose a SQL limit. Array live views default to 500 rows (configurable up to 1,000) and fail rather than truncate. Both live results and query responses have a 512 KiB data limit.

This is an initial foundation, not a claim of production completeness. In particular, authentication is host-owned, external side effects are not exactly-once, and interrupted runs require inspection and explicit retry. See [security and limits](docs/security.md).

## Verification and documentation

```sh
pnpm typecheck
pnpm test          # Cloudflare Workers runtime and real SQLite
pnpm exec playwright install chromium
pnpm test:e2e      # Actual browser: live updates, privacy, jobs and mobile layout
pnpm build         # TypeScript + Wrangler deployment dry run; does not deploy
pnpm docs:build
pnpm test:packages # Pack all five packages and verify a separate consumer
pnpm docs:dev
```

- [Architecture](docs/architecture.md)
- [Getting started in another app](docs/getting-started.md)
- [Authoring and migrations](docs/authoring.md)
- [Admin metadata, pages and actions](docs/admin.md)
- [AI SDK agents, model profiles and fallback](docs/ai.md)
- [Live views and large datasets](docs/sync.md)
- [Tasks, schedules and agents](docs/execution.md)
- [Security and actual limits](docs/security.md)
- [Application permissions and concurrency](docs/multi-user.md)
- [Backup, restore and operations](docs/recovery.md)
- [Publishing packages](docs/publishing.md)

Custom frontends use the typed client directly. The demo uses shadcn-svelte and application-owned live task/note attachments, with paginated chat history and streaming run progress. See [Custom frontends and chat](docs/custom-frontends.md).
