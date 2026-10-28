# Live views and large datasets

## Views are the sync boundary

Tables are private server storage. A view chooses the rows and fields a caller can receive. A live subscription reruns that view when its declared dependencies change.

```ts
const myTasks = app.view({
  input: z.object({}),
  output: z.array(taskRowSchema),
  dependsOn: ['tasks', 'members'],
  maxRows: 500,
  handler: ({ db, actor }) => {
    const rows = db.select().from(tasks).where(eq(tasks.ownerId, actor.id))
      .orderBy(asc(tasks.id)).limit(501).all();
    if (rows.length > 500) throw new WorkcoreError('VIEW_TOO_LARGE', 'Narrow the scope');
    return rows;
  },
});
```

`dependsOn` contains configured trigger keys, not table names. Mutations publish their declared `triggers` plus any keys emitted through `ctx.trigger(...)`; Workcore also publishes built-in keys for framework state. Keys publish only after commit. Omitted view dependencies mean wildcard; an empty array means no automatic recomputation. SQL is not parsed, so declarations must be complete. See [authoring and triggers](./authoring#trigger-keys-and-view-invalidation).

Views may return small objects, summaries or scalars as well as arrays. Array outputs enforce `maxRows` (default 500, maximum 1,000). All outputs enforce a 512 KiB data limit. Workcore cannot infer whether a custom object contains a truncated dataset: handlers are responsible for making their completeness contract honest.

## Three ways to read

### Complete live dataset

Use for small, bounded collections such as projects and workspace configuration. The browser has the full authorised result and may derive local filters, joins and counts.

### Scoped live dataset

Use typed inputs such as `{ projectId, status }` to choose a bounded working set. The server validates and authorises the scope. Updates must account for records entering or leaving it; recomputing the whole view handles this directly.

A complete view must fail when it becomes too large, rather than silently returning only its first page. A deliberately named window such as `recentActivity` may return the latest N records if that is its explicit contract, though alternate sort-order storage helpers are not yet built in.

### One-shot paginated query

```ts
const myTaskPage = app.query({
  input: z.object({ after: z.string().optional() }),
  output: taskPageSchema,
  handler: ({ db, actor }, input) => {
    const rows = db.select().from(tasks)
      .where(and(eq(tasks.ownerId, actor.id), ...(input.after ? [gt(tasks.id, input.after)] : [])))
      .orderBy(asc(tasks.id)).limit(51).all();
    return { rows: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49]!.id : null };
  },
});
```

Use for large collections and historical browsing. Queries do not subscribe automatically. The client explicitly requests another page or refreshes. Pages use stable ID ordering, but do not promise a frozen multi-page snapshot while records are concurrently inserted or deleted.

Do not apply a browser filter to one fetched page and present it as a search over the whole table. Server-side selection defines the dataset; local filtering only narrows what is already present.

Continuously maintaining a stack of loaded live pages is not implemented. Start with complete bounded subsets and ordinary pages.

## Client lifecycle

```ts
const subscription = client.subscribe('tasks', { projectId }, state => {
  // status: loading | live | reconnecting | error
  // data: complete authorised result when available
  // revision: state this view has observed
});

const result = await client.mutate('createTask', input);
await subscription.whenRevision(result.revision);
subscription.unsubscribe();
client.close();
```

One client multiplexes subscriptions over one WebSocket. Reconnects use bounded exponential backoff and request fresh snapshots. Connected clients refresh every 30 seconds, recovering a broadcast missed after a successful database commit.

After transient network loss, data may remain available with `reconnecting` status and must be treated as stale. Policy/session errors clear the result; an access-denied subscription is removed on the server. The client reconnects after the connection closes, but a denied individual view must be explicitly subscribed again once access changes.

Workspace revisions advance for background bookkeeping too. Matching views are recomputed; other subscriptions receive revision acknowledgements. Authorisation is rechecked for every subscription regardless of trigger matching. Revision waits reject on subscription errors or a configurable timeout.

## Wire contract

Manifest protocol version 2 includes the actor, permitted operations, annotated input/output schemas and projected admin pages/actions. The client validates this version before using it. The existing live transport uses JSON snapshots. HTTP responses for query/mutation/enqueue are `{ data, revision }`; failures are `{ error: { code, message } }` with an HTTP error status.

WebSocket client messages:

```json
{"type":"subscribe","id":"local-id","name":"tasks","input":{"projectId":"inbox"}}
{"type":"unsubscribe","id":"local-id"}
{"type":"refresh"}
```

Server messages are `snapshot` (`id`, `data`, `revision`), `revision` (`id`, `revision`), and `error` (`id` when known, `error`). Snapshots replace rather than merge previous results.

No row-diff protocol, persistent client cache, offline mutation queue or cross-tab coordinator is required or provided.
