# Architecture

## One workspace, one durable owner

A public Cloudflare Worker authenticates the request and routes a workspace name to a Durable Object. That object owns its SQLite database, subscriptions, application operations and execution state.

The database stores:

- Application-owned Drizzle SQLite tables, constraints and indexes.
- Internal, server-only KV values.
- Migration journal and the workspace revision.
- Queued/running/terminal task and agent runs.
- One-off and interval schedules.
- Recorded execution steps and metadata-only mutation history.
- Mutation/enqueue deduplication responses.

This is SQLite embedded in the Durable Object, **not D1**. No separate database, Redis, event server, scheduler process or queue worker is required.

Workspace names are routed with `namespace.idFromName`. They are identifiers, not credentials. Each definition's `authorize` callback must check current membership in the selected workspace.

## The local transaction boundary

Mutation handlers are synchronous. Drizzle writes, internal KV changes, job enqueues, schedule changes, output validation, history and the deduplicated response commit within one SQLite transaction.

If validation or the handler fails, those local changes roll back together. Database contexts expire after their callback and reject later use. Queries use read-only database contexts.

External HTTP calls, model requests and notification delivery are not part of a database transaction. Execute external work in a task or agent, not inside a mutation. Workcore cannot prevent application code from starting an unawaited external call; doing so breaks the intended contract.

Every successful write transaction advances the workspace revision. Application tables use ordinary application-defined concurrency fields where needed; the workspace revision is separate from the migration journal and wire protocol version.

## Changes and live delivery

After a transaction commits, its invalidation keys are matched against active view dependencies. Matching views are recomputed per subscriber and sent as full replacement snapshots; unmatched subscriptions receive revision acknowledgements. SQL is not parsed, so mutations declare their keys or retain wildcard behavior. Authorisation is rechecked for every subscription on every commit.

The database commit is authoritative; a failed broadcast does not undo it. Clients resubscribe after reconnect, and request complete refreshes every 30 seconds while connected. This recovers missed publication without keeping an indefinite change log.

There is no offline mutation queue, CRDT, general partial-replication engine or incremental view compiler.

## Background execution

Durable Object alarms drive due schedules and queued runs. Before accepting an HTTP write, the host arms a durable alarm; a committed enqueue cannot be stranded merely because setting a subsequent alarm fails. Run execution also leaves a watchdog alarm before starting external work.

One job executes at a time per workspace. Other requests can interleave while its handler awaits external work; each mutation is still a short, synchronous transaction. A job does not own a long-running database transaction.

On object reconstruction, previously running jobs become `interrupted`. They are not automatically replayed. Known task failures may use explicitly configured retries; agents never automatically retry.

An idle object is not a permanently running server. Authoritative state lives in SQLite. WebSocket attachments retain only the trusted identity, expiry and small subscription descriptions, allowing Cloudflare's hibernation APIs to manage connections.

## Hosting

```ts
import { Workspace, routeWorkspace } from '@workcore/core/cloudflare';

export class NotesWorkspace extends Workspace<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env, notes);
  }
}

export default {
  fetch(request: Request, env: Env) {
    return routeWorkspace(request, {
      namespace: env.WORKSPACES,
      authenticate: verifySession, // returns { actor: { id }, expiresAt } or null
    });
  },
};
```

Bind the class in Wrangler and create its namespace with `new_sqlite_classes`. See the tracker's `wrangler.jsonc` for the executable configuration. Wrangler's namespace migration is distinct from Drizzle application migrations.

The helper serves `/api/workspaces/:workspaceId/:endpoint`, defaults to same-origin access, and replaces caller-supplied session headers with the host-verified identity. No application permission snapshot is trusted from the browser.

For local development, do not run two Wrangler processes against the same persistence directory. Browser tests use a separate temporary persistence directory so they cannot race a developer's running workspace.

## What this architecture trades away

Cross-workspace joins and transactions are not built in. A single unusually busy workspace is a single coordination boundary. Global reporting needs an explicitly designed separate read model, not a pretend cross-object database.

Cloudflare-specific APIs are intentional. A future second backend should be designed around an actual requirement, not speculative adapter contracts.
