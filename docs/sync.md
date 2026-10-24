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
    const page = db.page('tasks', {
      index: { name: 'owner', value: actor.id }, limit: 500,
    });
    if (page.nextCursor) throw new WorkcoreError('VIEW_TOO_LARGE', 'Narrow the scope');
    return page.rows;
  },
});
```

Dependencies are explicit, not inferred. Include tables that affect the **projection**, not just the main data table. `$kv` is the dependency for internal KV values. Changes to membership always trigger a fresh operation authorisation check, even if membership was omitted from `dependsOn`; include it when membership also changes which fields/rows an otherwise permitted view returns.

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
  handler: ({ db, actor }, input) => db.page('tasks', {
    ...input, limit: 50,
    index: { name: 'owner', value: actor.id },
  }),
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

Workspace revisions advance for background bookkeeping too. Unaffected views receive revision acknowledgements, so `whenRevision` can finish without forcing unrelated recomputation. Revision waits reject on subscription errors or a configurable timeout.

## Wire contract

Protocol version 1 uses JSON. HTTP responses for query/mutation/enqueue are `{ data, revision }`; failures are `{ error: { code, message } }` with an HTTP error status.

WebSocket client messages:

```json
{"type":"subscribe","id":"local-id","name":"tasks","input":{"projectId":"inbox"}}
{"type":"unsubscribe","id":"local-id"}
{"type":"refresh"}
```

Server messages are `snapshot` (`id`, `data`, `revision`), `revision` (`id`, `revision`), and `error` (`id` when known, `error`). Snapshots replace rather than merge previous results.

No row-diff protocol, persistent client cache, offline mutation queue or cross-tab coordinator is required or provided.
