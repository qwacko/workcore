# Workcore

**A Cloudflare-first kit for live workspace applications.**

Define JSON records, typed actions and authorised read models. Workcore supplies SQLite persistence inside a Durable Object, live client subscriptions, background execution, schedules, and a small operational console.

One workspace has one Durable Object and one database. There is no D1 dependency, database adapter layer, Redis, separate queue server, or portable runtime to assemble.

> This is a fresh, breaking implementation. The previous portable runtime remains in Git history at `7c2c092`. There is no compatibility layer or migration of its data. Packages are private while this new foundation is being exercised.

## Try it

Node.js 22+ and pnpm 10:

```sh
pnpm install
pnpm dev
```

Open the local URL printed by Wrangler (normally <http://localhost:8787>). Choose Alice or Bob. Alice is an admin; Bob is a member. Use separate browser profiles to compare their private views.

1. Open **tasks**, leave the input as `{}`, and **Subscribe**.
2. Open another window and run **createTask** with `{"title":"A live update"}`.
3. Watch the subscribed result change without refetch code.
4. Launch **assistant**, then inspect **Runs** and **assistantSummary**.
5. Run **scheduleCompletion** with one of your task IDs and a delay; inspect **Schedules**.

The example uses a deterministic assistant by default. Add a Workers AI binding named `AI` to use its model-backed summariser. No paid model call is needed to run the demo or tests.

**Demo authentication requires the explicit local Wrangler environment and an allowed hostname. Default deployments return 503 until real authentication is installed.**

### Local reverse proxy

`pnpm dev` reads the root `.env`, then `examples/tracker/.env`; exported shell variables take precedence. For example:

```dotenv
HOST=127.100.0.10
PORT=8787
DEMO_ALLOWED_HOSTS=workcore.dev.jmcdowall.com
```

The listener address is also allowed for direct access. Additional demo hostnames are comma-separated exact names, without schemes or ports. The proxy must preserve the browser-facing host and scheme and forward WebSocket upgrades. Do not expose the demo without proxy access controls: anyone reaching it can select the admin identity.

## The model

- **Tables** store validated JSON records with IDs, record revisions and schema versions.
- **Mutations** synchronously commit records, internal KV, queued jobs and schedules together.
- **Views** are read-only, bounded, authorised results. Table changes trigger recomputation and complete replacement snapshots.
- **Queries** fetch data once, including indexed cursor-paginated pages for larger datasets.
- **Tasks and agents** have persisted runs, outcomes, step traces and explicit interruption semantics.
- **Schedules** launch jobs once or on a fixed interval, driven by Durable Object alarms.

The server determines what a user may receive. The browser can filter, group and sort that authorised dataset; browser filtering is never a security boundary.

## Authoring

```ts
import { table, workspace } from '@workcore/core';
import { z } from 'zod';

const tables = {
  notes: table(z.object({ text: z.string(), ownerId: z.string() }), {
    indexes: { owner: 'ownerId' },
  }),
};
const app = workspace(tables);

const addNote = app.mutation({
  input: z.object({ text: z.string().min(1) }),
  output: z.string(),
  handler: ({ db, actor }, input) => {
    const id = crypto.randomUUID();
    db.put('notes', id, { text: input.text, ownerId: actor.id });
    return id;
  },
});

export const notes = app.define({
  views: {}, queries: {}, mutations: { addNote }, jobs: {},
  // Replace this with a current workspace membership check.
  authorize: ({ actor }, action) => actor.id === 'owner',
});
```

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
| `packages/core` | Zod definitions, SQLite records, transactional runtime, runs/schedules, Cloudflare host |
| `packages/client` | Browser-safe inferred API, WebSocket subscriptions, reconnect and revision tracking |
| `packages/admin` | Same-origin operational console; no application frontend build required |
| `examples/tracker` | Executable Cloudflare application, private/shared data, scheduling and an optional AI agent |
| `tests` | Real Workers/SQLite integration tests and compile-time API checks |

## Deliberate boundaries

No offline writes, cross-workspace transactions, arbitrary client query language, automatic incremental SQL views, backend portability, cron/timezones, resumable agents, or raw admin record editing. Records and wire values are plain JSON—not JavaScript dates, maps or custom classes.

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
- [Live views and large datasets](docs/sync.md)
- [Tasks, schedules and agents](docs/execution.md)
- [Security and actual limits](docs/security.md)
