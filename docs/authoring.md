# Authoring and migrations

## Tables

```ts
const tables = {
  tasks: table(z.object({
    title: z.string().min(1),
    ownerId: z.string(),
    done: z.boolean(),
  }), {
    indexes: { owner: 'ownerId' },
  }),
};
const app = workspace(tables);
```

Table definitions describe JSON record contents. Workcore adds `id`, `revision` and `schemaVersion` outside `data`. The workspace identity is implicit in the Durable Object, not repeated in every row.

Use plain JSON schemas: strings, finite numbers, booleans, null, arrays and plain objects. Store timestamps as epoch milliseconds or ISO strings. Schemas must convert to JSON Schema; unsupported transforms or JavaScript-only output types fail during setup. Zod validation remains authoritative for refinements.

There is no automatic relational schema compiler, foreign-key inference or uniqueness declaration. A synchronous mutation can enforce an application invariant atomically; use primary record IDs for natural unique keys where appropriate.

## Database methods

Read contexts provide:

```ts
db.get('tasks', id); // Row | null
db.page('tasks', { limit: 25, after: cursor });
db.page('tasks', { index: { name: 'owner', value: actor.id }, limit: 100 });
db.all('tasks'); // fails above 1,000 rows; never truncates silently
db.kv.get('integrationCursor');
```

Pages are ordered by record ID, not creation time. `nextCursor` is the last returned ID when another page exists; otherwise null. Pages also stop at a conservative 400 KB payload budget, so they can contain fewer rows than the requested limit. Always follow the cursor, not the returned count. `all()` fails rather than return an incomplete byte-limited result.

Declared indexes support equality on a dotted JSON field path. They use real SQLite expression indexes. Arbitrary predicates, range indexes, full-text search and alternate sort orders are not currently provided.

Mutation contexts additionally provide:

```ts
db.put('tasks', id, data); // upsert, schema validated
db.put('tasks', id, data, { expectedRevision: previousRevision });
db.put('tasks', id, data, { expectedRevision: 0 }); // must not already exist
db.delete('tasks', id, { expectedRevision: previousRevision });
db.kv.set('integrationCursor', jsonValue);
db.kv.delete('integrationCursor');
```

Use record revision checks when an edit must not overwrite another user's intervening change. A conflict returns `CONFLICT` / HTTP 409.

KV is server-only and shares the mutation transaction. Expose a validated projection through a view if the client needs it. KV is not an encrypted secrets manager; use Cloudflare bindings for deployment secrets.

## Mutations and definitions

```ts
const completeTask = app.mutation({
  input: z.object({ id: z.string(), expectedRevision: z.number() }),
  output: z.null(),
  handler: ({ db, actor }, input) => {
    const row = db.get('tasks', input.id);
    if (!row || row.data.ownerId !== actor.id) {
      throw new WorkcoreError('FORBIDDEN', 'Not your task', 403);
    }
    db.put('tasks', input.id, { ...row.data, done: true }, {
      expectedRevision: input.expectedRevision,
    });
    return null;
  },
});

export const application = app.define({
  views: {}, queries: {}, mutations: { completeTask }, jobs: {},
  authorize: ({ db, actor }, action) => {
    // Check trusted identity against current workspace membership.
    return isMember(db, actor.id);
  },
});
```

`authorize` is synchronous and defaults to nothing implicitly: every application must supply it. Actions use `view:name`, `query:name`, `mutation:name`, `job:name`, `$connect`, `$runs`, and `$admin`. `$admin` grants sensitive table/history/schedule inspection and management. `$runs` permits inspection of the caller's own runs; admins may inspect all runs.

Operation permission checks do not replace record-level checks inside handlers. A view must filter private rows and fields before returning them.

An optional `initialize(db)` runs once in the same transaction as workspace initialization. It is useful for fixed initial records, not external work. The tracker uses it for demo members and data; production membership provisioning is an application concern.

## Record migrations

```ts
tasks: table(taskSchemaV2, {
  version: 2,
  migrations: {
    2: previous => ({ ...taskSchemaV1.parse(previous), done: false }),
  },
})
```

The migration key is the version being migrated **to**. To move existing version-1 rows to version 3, supply migrations 2 and 3. Each receives and returns JSON. Validate the final result against the current table schema.

On workspace startup, Workcore migrates all existing rows in one local transaction before serving requests. Failure rolls the migration back and prevents startup; a schema downgrade is refused. New records always use the current version. Empty, newly introduced tables need no historical data transformations.

These migrations apply to this implementation's records only. They do not import the previous Workcore database or adapters. Renames and destructive changes are explicit application decisions, never inferred from schema differences.

Whole-workspace startup migrations are intentionally simple. Very large migrations can exceed runtime limits; online/batched migration machinery is not implemented.

## Typed client

```ts
const client = createClient<typeof application>({
  baseUrl: '/api/workspaces/my-workspace',
});
const result = await client.mutate('completeTask', { id, expectedRevision });
```

Import the application **type** into frontend code. Operation names, accepted inputs and validated outputs are inferred. Server code is not required in the browser bundle.

Mutations and enqueues automatically generate request IDs. To retry after an uncertain network response, retain the ID and pass it explicitly as the third argument. Reusing an ID for different input is rejected. The last 1,000 mutation/enqueue responses per workspace are retained, scoped by actor; this is a bounded deduplication window, not indefinite exactly-once delivery.

The console uses the same API and authorised manifest. It supplies JSON input editors, table/JSON output, live subscriptions, run traces and schedule controls. It does not bypass mutations to edit records.
