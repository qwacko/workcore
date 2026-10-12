# Production deployment

The `@workcore/adapters/postgres` and `@workcore/adapters/redis` entry points provide a first shared deployment composition. PostgreSQL stores workspace membership, KV, metadata history, task runs/results and schedules. Redis carries transient scoped invalidation events. The core still owns HTTP routing, authorization checks, task execution, trigger/schedule policy and result validation.

These adapters deliberately accept structural client interfaces. Install and manage `pg` and `redis` in the host application; Workcore does not bundle or create database/Redis connections. Provision PostgreSQL and Redis using your platform's security, backup, TLS and availability controls.

## Setup

```sh
pnpm add @workcore/core @workcore/adapters pg redis
```

Run `migratePostgres(pool)` once during deployment (or apply `POSTGRES_SCHEMA_SQL` through your migration tool). It creates Workcore metadata tables. Add workspaces and memberships through your own provisioning flow:

```sql
INSERT INTO workcore_workspaces(application_id, id, name)
VALUES ('tracker', 'team', 'Team');
INSERT INTO workcore_workspace_members(application_id, workspace_id, actor_id)
VALUES ('tracker', 'team', 'user-123');
```

Compose the platform with the same persistent PostgreSQL services in the HTTP and worker processes. Use separate Redis connections for publisher and subscriber:

```ts
import { Pool } from 'pg';
import { createClient } from 'redis';
import { createPlatform } from '@workcore/core';
import { createPostgresState, migratePostgres } from '@workcore/adapters/postgres';
import { createRedisEvents } from '@workcore/adapters/redis';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const publisher = createClient({ url: process.env.REDIS_URL });
const subscriber = publisher.duplicate();
await Promise.all([publisher.connect(), subscriber.connect()]);
await migratePostgres(pool); // Prefer a controlled migration step in production.

const state = createPostgresState({ pool, historyLimit: 10_000, taskRunLimit: 2_000, maxKVValueBytes: 1_048_576 });
const auth = {
  authenticate: async (request: Request) => {
    const session = await identity.api.getSession({ headers: request.headers });
    return session ? { id: session.user.id } : null;
  },
  // Resolve the actor again for queued/scheduled work; do not persist the session or trust request actor IDs.
  resolveActor: async (id: string) => {
    const user = await users.findById(id);
    return user ? { id: user.id, name: user.name } : null;
  },
};
const platform = createPlatform({
  applications,
  auth, // `identity` and `users` are supplied by the host's authentication system.
  services: { ...state, events: createRedisEvents({ publisher, subscriber }) },
});
const handle = platform.httpHandler({ apiBasePath: '/workcore/api' }); // Mount in the authenticated host.
const worker = platform.worker();
worker.start(); // Run this in the separate worker process, not the request server.
```

Mount `platform.httpHandler()` in the host server. Start `platform.worker()` in a separate process using the same application registrations, authorization resolvers, codec allow-list, pool and queue service configuration. The local tracker demo intentionally runs both in one host and its file adapters are not suitable for a multi-process deployment.

## Guarantees and limits

- PostgreSQL task claiming is atomic across workers (`FOR UPDATE SKIP LOCKED`), deduplicates enqueue by run ID, and recovers claims after their lease expires. The worker heartbeats active claims; configure a claim lease of at least 30 seconds. A process crash may still repeat handler side effects; task handlers must be idempotent where practical.
- PostgreSQL schedule claiming, revision checks and dispatch reservations are shared across workers. Schedule/task enqueue is not one transaction; the reserved run ID supports recovery after uncertain enqueue acknowledgements but does not make domain side effects exactly once.
- Redis pub/sub is transient and is not an outbox. The HTTP client refetches on reconnect and periodically; a missed mutation event can still miss task-trigger enqueue. Use a durable event/outbox integration if that guarantee is required.
- History and task run/result retention default to 5,000 and 1,000 rows respectively (per history scope and globally for task runs). Configure `historyLimit` and `taskRunLimit` on `createPostgresState`. Active task rows are not pruned. Task inputs live in the execution queue table until their run row is pruned. Enqueue deduplication markers are retained independently and indefinitely so schedule recovery cannot repeat a completed run after result pruning. Configure database backup, access and encryption policies for this data.
- KV values must be JSON-compatible and are limited to 1 MiB by default. Configure `maxKVValueBytes` on `createPostgresState` or `createFileState`; choose a limit appropriate for your infrastructure.
- History stores metadata and sanitised errors; task results are persisted for inspection. Do not put secrets in task inputs/results. Workcore currently provides no per-field redaction or age-based retention policy; apply additional database retention controls when required.
- Workspace membership is stored as `(applicationId, workspaceId, actorId)`. Your application remains responsible for managing membership changes and authorisation context. `pg` and `redis` are optional peer dependencies: consumers that use these entry points must install their drivers.
- The file adapter's `taskDedupe` IDs are retained indefinitely so pruning old run/result rows cannot re-enable an old enqueue. This local JSON adapter is single-process and its state file can still grow; use the PostgreSQL adapter for shared production state.
- Authentication remains host-owned. This release does not ship a Better Auth integration; adapt your trusted session/auth library to `AuthAdapter` and re-resolve actors for queued work.

The adapter integration suite runs against real services when `WORKCORE_POSTGRES_URL` and `WORKCORE_REDIS_URL` are set. CI supplies PostgreSQL 16 and Redis 7. Locally, point those variables at disposable test instances and run `pnpm --filter @workcore/adapters test:integration`.

## HTTP security and CSP

Use same-origin secure cookies where possible; configure exact `trustedOrigins` only for known reverse-proxy origins. Put the API and admin behind the same host authentication boundary. `createAdminHandler` injects a small inline public-configuration script, so a strict CSP must allow that script using a nonce/hash strategy at the host or replace the admin shell/host integration accordingly. No secrets are injected. The admin's compiled assets are local and fingerprinted.

## Example authoring guide

1. Define schemas and an application context containing scoped repositories/clients.
2. Define a `defineWorkspace<Context>()({ ... })` operation catalog. Keep queries read-only and mutations explicit; set `api: true` only for intended external operations.
3. Register the definition with a context factory and trusted authorization-context resolver.
4. Compose framework adapters and host authentication, then mount the Request/Response handler.
5. Start a worker process for tasks and schedules. Re-register the same app catalog and compatible codecs there.
6. Use the typed client or mount the optional prebuilt admin. Treat task delivery as at-least-once and scope every domain repository operation using `ctx.scope`.

The executable examples under `examples/tracker/src` cover workspace definitions, context registration, typed clients, generated UI metadata and a second differently-shaped application.
