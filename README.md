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

Open the local URL printed by Wrangler (normally <http://localhost:8787>). Choose Alice or Bob. Alice is an admin; Bob is a member. Use separate browser profiles to compare their private views.

1. Follow **Start here** on the workspace overview and create a task using the generated form.
2. Open another window and watch its live task list update.
3. Use **Edit task**, **Complete**, or **Schedule** directly on your own task rows—no copying IDs.
4. Use **Assistant** to send a private message, then follow **Inspect run** to its execution timeline.
5. Browse **Schedules**, **History**, **Tables**, or the schema-backed operation explorer.

The overview, tasks, assistant and data pages are declared by the backend, not hardcoded into the frontend. Table/list/JSON modes, local filters and server scope are explicit and URL-backed. See [Admin authoring](docs/admin.md).

The example uses a deterministic assistant when no model is selected. Set `WORKCORE_AGENT_MODEL=openrouter/anthropic/claude-sonnet-4.5` and `OPENROUTER_API_KEY` to use AI SDK; optionally set `WORKCORE_AGENT_FALLBACK_MODEL` to a backup from any supported provider. `WORKCORE_AI_MODE=demo` forces offline responses. No paid model call is needed for tests. See [AI SDK agents](docs/ai.md).

Put model settings and keys in root `.env` or `examples/tracker/.env` (example settings override root settings; exported shell variables win), then restart `pnpm dev`. Use `WORKCORE_AI_MODE=model` to fail explicitly when a primary model is missing. OpenRouter selections must start with `openrouter/` **before** the upstream model ID, for example `openrouter/anthropic/claude-sonnet-4.5`, not just `anthropic/claude-sonnet-4.5`. A configured model/key failure is shown as a failed run, never a demo answer.

**Demo authentication requires the explicit local Wrangler environment and an allowed hostname. Default deployments return 503 until real authentication is installed.**

### Local reverse proxy

`pnpm dev` reads the root `.env`, then `examples/tracker/.env`; exported shell variables take precedence. For example:

```dotenv
HOST=127.100.0.10
PORT=8787
DEMO_ALLOWED_HOSTS=workcore.dev.jmcdowall.com
```

The listener address is also allowed for direct access. Additional demo hostnames are comma-separated exact names, without schemes or ports. The proxy must preserve the browser-facing host and scheme and forward WebSocket upgrades. Do not expose the demo without proxy access controls: anyone reaching it can select the admin identity.

`pnpm dev` builds the deployable console once, then runs SvelteKit with hot module replacement on this public address and proxies API, login and WebSocket requests to Wrangler on an internal loopback port. Production uses only Worker static assets; no SvelteKit server is deployed. `/workspace` redirects to `/admin/demo`, and admin deep links survive refresh.

The launcher forwards only the example's selected agent settings/keys to Wrangler using an owner-only temporary bindings file, cleaned up on exit. Credentials are not passed as command-line variables and unrelated shell secrets are not copied into Worker bindings. Restart the launcher after editing environment settings. For deployment, configure non-secret model settings in Wrangler and use `wrangler secret put` for provider keys; the example still requires real authentication before public deployment.

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

Extend `Workspace` from `@workcore/core/cloudflare` with this definition and route authenticated requests through `routeWorkspace`. See the [complete tracker](examples/tracker/src/app.ts), its [Cloudflare host](examples/tracker/src/worker.ts), and [authoring guide](docs/authoring.md).

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
| `examples/tracker` | Executable Cloudflare application, private/shared data, scheduling and an optional AI agent |
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
