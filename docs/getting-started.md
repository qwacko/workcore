# Use Workcore in your application

For the first release, the existing todo/notes example is the runnable reference. You do not need to invent another example app to validate Workcore. Building/deploying that application and publishing the reusable npm packages are separate steps; see [example deployment](https://github.com/qwacko/workcore/tree/main/examples/workcore-demo#cloudflare-deployment) and [package publication](./publishing).

This guide shows how those same APIs fit into a consuming application. Commands using `@workcore/*@0.1.0` apply once that version has been published. Until then, use packed tarballs as described in the publishing guide.

## 1. Install the packages

Use Node.js 22.17+ and an ESM TypeScript project:

```sh
pnpm add @workcore/core@0.1.0 @workcore/client@0.1.0 drizzle-orm@^0.45.4 zod@^4.6.7
pnpm add -D typescript wrangler drizzle-kit @cloudflare/workers-types
```

Set `"type": "module"` in your application's `package.json`. Core uses SQLite Durable Objects; you do not need D1 for Workcore persistence. Authentication is supplied by your host and may have its own storage requirements.

Optional packages are `@workcore/admin` (prebuilt console), `@workcore/files` (R2 files), and `@workcore/ai` (AI SDK integration). Install only what the application uses.

## 2. Define and export the SQL tables

```ts
// src/schema.ts
import { defineSchema, idColumn, versionColumn } from '@workcore/core';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Drizzle Kit must see these top-level internal table exports as well.
export * from '@workcore/core/schema';

export const todos = sqliteTable('todos', {
  ...idColumn(),
  ...versionColumn(),
  ownerId: text('owner_id').notNull(),
  title: text('title').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
}, table => [index('todos_owner_id').on(table.ownerId, table.id)]);

export const schema = defineSchema({ todos });
```

`defineSchema` includes Workcore's private tables in the runtime schema. The explicit exports from `@workcore/core/schema` allow Drizzle Kit to generate their SQL too. Do not point Drizzle Kit at an application module that imports a not-yet-generated migration bundle.

## 3. Generate and bundle migrations

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  dialect: 'sqlite', schema: './src/schema.ts', out: './drizzle',
});
```

Create this application-owned helper:

```js
// scripts/ingest-migrations.mjs
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const journal = JSON.parse(await readFile(new URL('drizzle/meta/_journal.json', root), 'utf8'));
const migrations = {};
for (const entry of journal.entries) {
  migrations[`m${String(entry.idx).padStart(4, '0')}`] =
    await readFile(new URL(`drizzle/${entry.tag}.sql`, root), 'utf8');
}
await writeFile(new URL('src/migrations.ts', root),
  `// Generated; do not edit.\nimport type { MigrationBundle } from '@workcore/core';\nexport default ${JSON.stringify({ journal, migrations }, null, 2)} as MigrationBundle;\n`);
```

Run these after every schema change:

```sh
pnpm exec drizzle-kit generate
node scripts/ingest-migrations.mjs
```

Commit the SQL, snapshots, journal and `src/migrations.ts` together. Workcore applies unapplied SQL migrations transactionally at startup. Do not edit previously applied migrations or reset real data to accommodate a schema change.

## 4. Define operations

Use the `src/app.ts` example in the [repository README](https://github.com/qwacko/workcore#authoring). It defines `addTodo`, an owner-filtered `myTodos` view and an operation allowlist; it imports the `schema.ts` and generated `migrations.ts` from the preceding steps.

An array view defaults to 500 rows. Its SQL query fetches 501 rows so Workcore rejects an oversized live result rather than silently presenting an incomplete collection. Larger datasets need an indexed, cursor-paginated query. SQL `.all()` does not automatically add a LIMIT.

For updates/deletes, combine identity, ownership and `versionMatch(todos.version, expectedVersion)` in the SQL predicate, increment the version on update, then use `requireChanged(returnedRow)` to report conflicts. See [permissions and concurrency](./multi-user).

## 5. Host the definition in a Worker

```ts
// src/worker.ts
import { Workspace, routeWorkspace } from '@workcore/core/cloudflare';
import { application } from './app.js';
import { authenticate } from './auth.js';

type Env = { WORKSPACES: DurableObjectNamespace };
export class AppWorkspace extends Workspace<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, application);
  }
}
export default {
  fetch(request: Request, env: Env) {
    return routeWorkspace(request, { namespace: env.WORKSPACES, authenticate });
  },
} satisfies ExportedHandler<Env>;
```

Implement `authenticate(request)` using your application's session verifier. It returns a verified `{ actor: { id }, expiresAt }` or `null`. Start fail-closed while wiring that integration:

```ts
// src/auth.ts — replace the body with your real server-side session verifier.
import type { Session } from '@workcore/core/cloudflare';
export async function authenticate(_request: Request): Promise<Session | null> {
  return null;
}
```

All API requests intentionally return 401 until a real verifier is installed. Do not replace this with a browser-supplied user ID or a constant signed-in identity. The repo's example demonstrates Better Auth; the library does not require that provider. Add auth routes and frontend/static routing to your existing Worker as appropriate. The minimal Worker above only serves Workcore API routes.

```json
{
  "name": "my-workcore-app",
  "main": "src/worker.ts",
  "compatibility_date": "2026-10-01",
  "durable_objects": {
    "bindings": [{ "name": "WORKSPACES", "class_name": "AppWorkspace" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["AppWorkspace"] }]
}
```

Save this as `wrangler.jsonc`. Its class migrations create SQLite Durable Objects; they are separate from the SQL migrations bundled in `src/migrations.ts`. Preserve deployed migration tags and class names when upgrading.

A minimal `tsconfig.json` is:

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "noEmit": true, "skipLibCheck": true,
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

Check and run locally:

```sh
pnpm exec tsc --noEmit
pnpm exec wrangler dev
pnpm exec wrangler deploy --dry-run
```

The last command does not deploy. Once host authentication, permissions, configuration and backups are ready, `pnpm exec wrangler deploy` is the explicit deployment step.

## 6. Use the client

Use the typed `createClient<typeof application>` example in the README from your browser application. Import `application` with `import type` so the server implementation stays out of the browser bundle. Serve the frontend and API under the same origin; Workcore's host helper rejects cross-origin browser requests.

Call `query` for one-shot reads, `mutate` for writes, and `subscribe` for live view state. Handle error/reconnecting states, release subscriptions and close the client on teardown or sign-in identity changes. Keep a request ID for an identical retry after an uncertain network response. Request deduplication does not replace optimistic concurrency checks.

## Optional admin and coding-agent guidance

Install `@workcore/admin@0.1.0` and use `copyAdminAssets` from `@workcore/admin/assets` during your Node build to copy the prebuilt SPA into your Worker's static assets. Serve `/admin` through `serveAdmin` from `@workcore/admin/server`; the example's `scripts/copy-admin.mjs` and `src/worker.ts` show the complete routing. The SPA is compiled for `/admin`. No Svelte build is required in a consuming app. Page access does not bypass operation permissions or grant `$admin`.

`@workcore/core` includes `AGENTS.example.md` for coding agents working in consuming apps:

```sh
# Merge instead if AGENTS.md already exists.
cp node_modules/@workcore/core/AGENTS.example.md ./AGENTS.md
```

Adapt the paths and verification commands to your app. The template describes the library's real APIs, schema/migration workflow, permission boundaries, live subscriptions, background execution, and release safety; it is not a runtime AI system prompt.
