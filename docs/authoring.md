# Authoring and SQL migrations

## Define a Drizzle schema

Application data is ordinary Drizzle SQLite schema, not a JSON-record abstraction. Use standard SQLite constraints, indexes, relations, and SQL expressions. Workcore adds its own internal tables through `defineSchema`; those framework tables are excluded from the raw application-table inspector.

```ts
import { defineSchema, idColumn, timestampColumns, versionColumn, workspace } from '@workcore/core';
import { integer, index, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import migrations from './migrations.js';

export const tasks = sqliteTable('tasks', {
  ...idColumn(),
  ...timestampColumns(),
  ...versionColumn(),
  title: text('title').notNull(),
  ownerId: text('owner_id').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
}, table => [index('tasks_owner_id').on(table.ownerId, table.id)]);

export const schema = defineSchema({ tasks });
const app = workspace(schema, migrations, { triggerKeys: ['tasks', 'permissions'] as const });
```

`idColumn()` creates a string primary key. `timestampColumns()` provides epoch-millisecond `createdAt` and `updatedAt` fields with defaults. `versionColumn()` provides an integer optimistic-concurrency field; update it in the same SQL `UPDATE` whose `WHERE` checks the prior version.

## Generate and ingest migrations

Configure Drizzle Kit with the combined schema, including the Workcore internal tables:

```ts
// drizzle.config.ts
import { defineConfig } from 'drizzle-kit';
export default defineConfig({ dialect: 'sqlite', schema: './src/schema.ts', out: './drizzle' });
```

Export the framework tables alongside application tables from `src/schema.ts` so Drizzle Kit snapshots the complete database. Generate and ingest SQL into a TypeScript bundle that can be included in the Worker:

```sh
pnpm --filter workcore-demo db:generate
```

The command runs `drizzle-kit generate` and `scripts/ingest-migrations.mjs`. Commit the generated SQL, snapshots, journal, and `src/migrations.ts`. At workspace startup Workcore applies every unapplied bundled migration synchronously in SQLite transactions, before accepting requests. Missing bundle entries or failed SQL stop startup. There is no data-retention compatibility migration from the earlier JSON-record implementation.

For another application, use the same pattern: keep Drizzle Kit schema/config and a migration-ingestion script in the app package, then pass the imported `MigrationBundle` to `workspace(schema, migrations)`.

## Read and write in operations

Each operation receives a transaction-scoped Drizzle database typed to the workspace schema:

```ts
const addTask = app.mutation({
  input: z.object({ title: z.string().min(1) }),
  output: z.string(),
  handler: ({ db, actor }, input) => {
    const id = crypto.randomUUID();
    db.insert(tasks).values({ id, title: input.title, ownerId: actor.id, done: false }).run();
    return id;
  },
});
```

Queries and views are read-only. Their Drizzle context is guarded against writes, and a captured query builder cannot be used after its operation has returned. Mutations, KV changes, enqueue/schedule changes, and request deduplication are committed atomically. KV is server-only and shares the SQL transaction; it is not an encrypted secrets manager.

## Trigger keys and view invalidation

Trigger keys are typed invalidation labels, not events or channels with payloads. Declare application keys in `workspace` and use the same keys in mutation and view declarations:

```ts
const app = workspace(schema, migrations, {
  triggerKeys: ['tasks', 'permissions', 'dashboard'] as const,
});

const createTask = app.mutation({
  input: z.object({ title: z.string() }), output: z.string(),
  triggers: ['tasks'],
  handler: ({ db, actor, trigger }, input) => {
    const id = crypto.randomUUID();
    db.insert(tasks).values({ id, title: input.title, ownerId: actor.id, done: false }).run();
    if (input.title.startsWith('!')) trigger('dashboard');
    return id;
  },
});

const taskList = app.view({
  input: z.object({}), output: z.array(taskRow),
  dependsOn: ['tasks', 'permissions'],
  handler: ({ db, actor }) => db.select().from(tasks).where(eq(tasks.ownerId, actor.id)).all(),
});
```

`triggers` and `dependsOn` are arrays, and their values are checked against the configured keys and Workcore's exported `builtinTriggers` (`files`, `runs`, `schedules`, `history`, `kv`). `trigger(...keys)` is available only in mutation contexts. Runtime validation remains in place if types are bypassed.

- Omitted mutation `triggers` means wildcard invalidation. `triggers: []` declares no static application keys; dynamic calls and automatic framework keys can still publish.
- Omitted view `dependsOn` means it refreshes after every commit. `dependsOn: []` means no automatic recomputation (initial load, reconnect, heartbeat, and explicit refresh still work).
- `'*'` in either array means wildcard. Matching views rerun once per commit and receive replacement snapshots; unmatched views still receive a revision acknowledgement.
- Dynamic and static keys publish only after the mutation transaction commits. Rollbacks, including output-validation failures, publish nothing. Calls after the mutation context expires fail.
- Workcore emits built-in keys when its own KV, file, run, schedule, or history state changes. A job's `ctx.mutate(...)` emits the called mutation's keys when that mutation executes; merely scheduling future work does not emit the future mutation's keys.
- Authorization is rechecked for every subscription on every commit, even when keys do not match. If permission data affects the rows a still-authorized view returns, that view must also depend on the application's permissions key.

Declarations are promises: Workcore does not inspect SQL to verify that a mutation only changes its declared data. Missing a key may leave a subscription stale until its next full refresh. Use wildcard defaults where the impact is uncertain.

Use normal Drizzle methods (`select`, `insert`, `update`, `delete`, joins, predicates, and ordering). Define explicit, bounded pagination in your query handler with a stable cursor (usually the primary key) and a `limit + 1` fetch. Workcore does not synthesize indexes or query plans from application schemas.

## Mutations and authorization

```ts
const completeTask = app.mutation({
  input: z.object({ id: z.string(), expectedVersion: z.number().int() }),
  output: z.null(),
  handler: ({ db, actor }, input) => {
    const changed = db.update(tasks).set({ done: true, version: input.expectedVersion + 1 })
      .where(and(eq(tasks.id, input.id), eq(tasks.ownerId, actor.id), eq(tasks.version, input.expectedVersion)))
      .returning({ id: tasks.id }).get();
    if (!changed) throw new WorkcoreError('CONFLICT', 'Task has changed or is not yours', 409);
    return null;
  },
});
```

`authorize` is synchronous and every application must supply it. Actions use `view:name`, `query:name`, `mutation:name`, `job:name`, `$connect`, `$runs`, and `$admin`. `$admin` grants sensitive history/schedule/raw-table inspection and management. Operation permission checks do not replace row-level checks inside handlers; views must filter private rows and fields before returning them.

An optional `initialize(db)` runs once after schema migrations, in a transaction. Use it for fixed initial records, not external work.

## Raw-table display

Admins can inspect registered application tables using the bounded raw-table resource. Workcore returns column metadata from SQLite and at most 100 rows / about 400 KB per page; the cursor is a rowid cursor and the inspector is read-only. Add optional presentation-only labels, hidden columns, and simple `text`, `badge`, or `date` formatting with `tableDisplay`:

```ts
workspace(schema, migrations, {
  tableDisplay: { tasks: { label: 'Tasks', columns: { version: { hidden: true } } } },
});
```

Display overrides are not authorization controls. Raw inspection remains admin-only, and hiding a column does not make its contents secret.

## Typed client

```ts
const client = createClient<typeof application>({ baseUrl: '/api/workspaces/my-workspace' });
const result = await client.mutate('completeTask', { id, expectedVersion });
```

Import the application **type** into frontend code. Operation names, accepted inputs and validated outputs are inferred. The SvelteKit console uses the same transport and authorised manifest; it does not bypass mutations to edit records. See [admin authoring](./admin).

Mutations and enqueues automatically generate request IDs. Retain an ID to retry after an uncertain network response; reusing an ID for different input is rejected. This is a bounded deduplication window, not indefinite exactly-once delivery.
