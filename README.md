# Workcore

**A Cloudflare-first kit for live workspace applications.**

Define Drizzle SQLite tables, typed actions and authorised read models. Workcore supplies transactional SQLite persistence inside a Durable Object, live client subscriptions, background execution, schedules, and a manifest-driven SvelteKit console.

One workspace has one Durable Object and one database. There is no D1 dependency, database adapter layer, Redis, separate queue server, or portable runtime to assemble.

> This is a fresh, breaking implementation. The previous portable runtime remains in Git history at `7c2c092`. There is no compatibility layer or migration of its data. Packages are private while this new foundation is being exercised.

## Try it

Node.js 22.17+ and pnpm 10:

```sh
pnpm install
pnpm dev
```

Copy `examples/workcore-demo/.env.example` to `examples/workcore-demo/.env` and set `BETTER_AUTH_URL` to the exact browser origin (the example uses `http://127.0.0.1:8787`). Restart `pnpm dev`, open that origin, and create an account. The local demo uses Better Auth and a local D1 database for identities; Workcore data lives in SQLite Durable Objects.

The SvelteKit SPA starts with your tasks. Switch to **Everyone** to see shared tasks, or use the board and list views. Private tasks are filtered on the server. Notes are private and support editing, starring and archiving. Open another tab to see live updates. The **Admin** link opens the default Workcore console for the current workspace, including generated displays, operations and the assistant.

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

See the [authoring guide](docs/authoring.md) for Drizzle schema definition, migration generation/ingestion, and operation examples.

Extend `Workspace` from `@workcore/core/cloudflare` with this definition and route authenticated requests through `routeWorkspace`. See the [complete tracker](examples/workcore-demo/src/app.ts), its [Cloudflare host](examples/workcore-demo/src/worker.ts), and [authoring guide](docs/authoring.md).

```ts
import { createClient } from '@workcore/client';
import type { tracker } from './app';

const client = createClient<typeof tracker>({
  baseUrl: '/api/workspaces/demo',
});

const tasks = client.subscribe('tasks', { projectId: 'inbox' }, state => {
  if (state.status === 'live') render(state.data);
});

const result = await client.mutate('createTask', { title: 'Ship something small' });
await tasks.whenRevision(result.revision);
```

## Repository

| Path | Responsibility |
| --- | --- |
| `packages/core` | Drizzle schema/runtime, transactional operations, runs/schedules, Cloudflare host |
| `packages/client` | Browser-safe inferred API, WebSocket subscriptions, reconnect and revision tracking |
| `packages/admin` | SvelteKit SPA, generated forms, semantic pages and operational inspection; compiled to Worker static assets |
| `packages/ai` | Optional AI SDK integration, model profiles, safe fallback and checked agent tools |
| `examples/workcore-demo` | Executable Cloudflare application, private/shared data, scheduling and an optional AI agent |
| `tests` | Real Workers/SQLite integration tests and compile-time API checks |

## Deliberate boundaries

No offline writes, cross-workspace transactions, arbitrary client query language, automatic incremental SQL views, backend portability, cron/timezones, resumable agents, or raw admin record editing. Chat is persisted messaging with background replies, not token streaming or resumable model execution. Wire values are plain JSON—not JavaScript dates, maps or custom classes.

Large collections use explicit indexes and pages. `all()` is capped at 1,000 records. Array live views default to 500 rows and fail rather than truncate. Both live results and query responses have a 512 KiB data limit.

This is an initial foundation, not a claim of production completeness. In particular, authentication is host-owned, external side effects are not exactly-once, and interrupted runs require inspection and explicit retry. See [security and limits](docs/security.md).

## Verification and documentation

```sh
pnpm typecheck
pnpm test          # Cloudflare Workers runtime and real SQLite
pnpm exec playwright install chromium
pnpm test:e2e      # Actual browser: live updates, privacy, jobs and mobile layout
pnpm build         # TypeScript + Wrangler deployment dry run; does not deploy
pnpm docs:build
pnpm docs:dev
```

- [Architecture](docs/architecture.md)
- [Authoring and migrations](docs/authoring.md)
- [Admin metadata, pages and actions](docs/admin.md)
- [AI SDK agents, model profiles and fallback](docs/ai.md)
- [Live views and large datasets](docs/sync.md)
- [Tasks, schedules and agents](docs/execution.md)
- [Security and actual limits](docs/security.md)
