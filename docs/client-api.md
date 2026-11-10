# Browser client reference

Import from `@workcore/client`. This page is lookup reference; start with [client integration](./custom-frontends) and [live semantics](./sync) for lifecycle design. The client is framework-neutral and browser-safe; it never exposes SQL or bypasses the host's authentication.

## Construction and options

```ts
import { createClient } from '@workcore/client';
import type { application } from './app.js';

const client = createClient<typeof application>({
  baseUrl: '/api/workspaces/demo',
  subscriptions: { keepAliveMs: 1000, cacheTimeMs: 30_000, maxCached: 64 },
});
```

| `ClientOptions` field | Default | Meaning |
| --- | --- | --- |
| `baseUrl` | Required | Workspace API prefix, without an endpoint; normally same-origin |
| `fetch` | Bound global `fetch` | Override HTTP transport; does not replace global browser WebSocket or its cookie authentication |
| `subscriptions.keepAliveMs` | 1,000 ms | Retain live server subscription briefly after last consumer leaves |
| `subscriptions.cacheTimeMs` | 30,000 ms | Retain inactive in-memory snapshots, then revalidate on reuse |
| `subscriptions.maxCached` | 64 | Maximum inactive entries; zero disables inactive retention |

Cache options must be nonnegative safe integers. `keepAliveMs: 0` ends server subscriptions immediately; `cacheTimeMs: 0` or `maxCached: 0` disables inactive snapshots. State is client/session-local, not persisted or shared across users. HTTP requests use same-origin credentials; use one client per identity/workspace and create a new one after close.

`createRuntimeClient(options)` has the same methods but discovers operation names/schemas at runtime rather than inferring them from your application definition. It is intended for generic renderers/tooling. Runtime discovery is not authorization.

## Application calls

| Method | Result | Notes |
| --- | --- | --- |
| `query(name, input)` | `Promise<Result<T>>` | One-shot read of a registered **view or query**; does not subscribe |
| `mutate(name, input, requestId?)` | `Promise<Result<T>>` | Registered mutation; default request ID is a new UUID |
| `enqueue(name, input, requestId?)` | `Promise<Result<string>>` | Accepted background job's run ID in `data`; does not wait for completion |
| `subscribe(name, input, listener)` | `Subscription<T>` | Registered **view only**; listener gets initial/current and subsequent live states |

`Result<T>` is `{ data: T, revision: number }`. The workspace revision is not a record version, SQL migration version or protocol version. Concurrent identical one-shot reads share an in-flight request; completed query results are not retained. Writes invalidate that in-flight sharing. A successful mutation does not automatically refetch the UI's completed one-shot queries.

### Request IDs and errors

For an identical retry after an uncertain network result, preserve the same `requestId` and input. Reusing an ID with different input fails. New intentional submissions need new IDs. Deduplication is bounded, not an indefinite exactly-once guarantee. Do not automatically retry stale version conflicts using a newer version.

HTTP operation failures reject with `ClientError(code, message, status = 0)`. Transport/JSON parsing failures can be native errors, so handle unknown exceptions too. A live error arrives as state, not as a rejected `subscribe` promise. See [error contract](./security#error-contract).

## Subscription contract

`LiveState<T>` has `status: 'loading' | 'live' | 'reconnecting' | 'error'`, optional `data`, numeric `revision`, and optional `error: { code, message }`.

| Member | Contract |
| --- | --- |
| `subscription.state` | Read-only accessor for the current state; treat returned data as immutable |
| `subscription.unsubscribe()` | Release this consumer; other equivalent consumers remain subscribed |
| `subscription.whenRevision(revision, timeoutMs = 10_000)` | Resolve when state is `live` at or past the revision; reject on subscription error/unsubscribe/close or timeout (`SYNC_TIMEOUT`) |
| `client.refreshSubscriptions()` | Send an explicit full refresh if the WebSocket is currently open; no-op otherwise |
| `client.close()` | Stop sockets/timers, clear snapshots and end consumers; idempotent; further requests fail with `CLIENT_CLOSED` |

Equivalent kind/name/canonical-input resources share one server subscription per client. New consumers receive the current result synchronously. Cached results return as `reconnecting` until confirmed. Network loss may retain stale data; policy errors clear denied data. Replace snapshots instead of merging them as row patches. Reconnects and the 30-second refresh repair missed post-commit delivery. See [live lifecycle](./sync#client-lifecycle).

## Manifest, displays and system resources

| Method | Result | Authorization/lifetime |
| --- | --- | --- |
| `manifest()` | `Promise<Manifest>` | Actor-filtered discovery; validates manifest/protocol schema; not an authority grant |
| `subscribeManifest(listener)` | `Subscription<Manifest>` | Live discovery using shared subscription lifecycle |
| `display(name, input?)` | `Promise<ManifestDocument>` | Resolve registered display; required input inferred for parameterized definitions |
| `subscribeDisplay(name, input, listener)` | `Subscription<ManifestDocument>` | Live authorized display-document resolution; source data has separate subscriptions |
| `subscribeSystem(name, input, listener)` | `Subscription<Json>` | Supported system resources only; current system authorization applies |
| `system(name, input = {})` | `Promise<Json>` | Dispatch registered synthetic system operation; result shapes depend on the operation |
| `inspect(resource, after?)` | `Promise<Json>` | Authorized resource inspection, including `run:<id>` and `schedule:<id>`; cursor where supported |
| `trace(runId, after = 0)` | `Promise<Json>` | Ten-entry trace pages with numeric `nextCursor`; own-run `$runs` or `$admin` |
| `control(resource, id, action)` | `Promise<{ revision, runId? }>` | Run `cancel`/`retry`, schedule `enable`/`disable`; invalid combinations/permissions fail |

`LiveSystemOperation` is the finite set: `health.inspect`, `runs.list`, `runs.inspect`, `runs.trace`, `schedules.list`, `schedules.inspect`, `tables.list`, `tables.read`, `history.list`, `files.list`. Not every system action is subscribable. Use the current manifest's `system` catalog for available operations and schemas.

Retry creates a **new** run, returns its `runId`, and may repeat external effects. Cancel does not roll back prior committed work. See [execution](./execution#persisted-lifecycle), [admin projection](./admin#projection-and-routing) and [diagnostics](./recovery#diagnostics-and-recovery-controls).

## Files

Requires a configured server file capability and file-action authorization:

| Method | Result | Notes |
| --- | --- | --- |
| `files.upload(file, { signal }?)` | `Promise<{ id, status: 'ready' }>` | `Blob` with optional `name`; abort signal optional; bytes streamed outside SQLite |
| `files.list(after?)` | `Promise<{ rows, nextCursor }>` | Authorized metadata rows, cursor is string or null |
| `files.download(id)` | `Promise<Blob>` | Owner/admin access, returns bytes rather than a permanent public URL |
| `files.remove(id)` | `Promise<void>` | Owner/admin access; cleanup can remain pending after storage failure |

Rows contain `id`, `ownerId`, `filename`, `contentType`, `size`, `status`, `createdAt`, `uploadedAt`. See [file storage](./files) for lifecycle and limits. File helper results are not wrapped in `Result<T>`.

## Renderer helpers

These helpers are optional; ordinary application components can use the typed client directly.

### Shared sources

`createSources(runtimeClient)` returns:

- `watch(source, input, listener)`: observe `{ kind, name }` plus JSON input; returns a cleanup function. `SourceReference.kind` is `view`, `display`, `query`, `resource` or `system`.
- `refresh(source?, input?)`: refresh active one-shot sources or request a live transport refresh; without arguments refreshes all active sources. A targeted view/display uses its normal live invalidation lifecycle.
- `close()`: release all source subscriptions/polling; does not close the supplied client.

Views/displays/system sources use client live subscriptions; queries fetch once; legacy inspection `resource` sources poll every three seconds while watched. Equivalent source/input values share observers. The final cleanup releases the entry, and late async responses are ignored. Helpers do not convert queries into continuously maintained server views.

`sourceKey(value)` sorts object keys recursively for stable JSON identity (array order matters). Use JSON-safe values, not cyclic objects or a general serializer for Dates/classes.

### Action submission

`createActionDispatcher(runtimeClient)` returns `execute(scope, operation, input)`, `clear(scope)`, `close()`. Operation is `{ kind: 'mutation' | 'job', name }`. `execute` returns `Promise<Result<Json>>`, retains the ID for an identical failed submission in the same scope, and clears it after success or an explicit clear. Changed operation/input gets a new ID.

Give each mounted action instance a stable unique scope; cleanup submission state on unmount and identity changes. This does not persist retries across reloads or replace server authorization/version checks. `close()` clears dispatcher state, not the underlying client.
