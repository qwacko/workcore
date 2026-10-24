# Tasks, schedules, and upgrade safety

Tasks share operation schemas and permissions but execute asynchronously. `client.enqueue(name, input)` returns `{ runId }` with HTTP 202; it does not return the final task result. Authorized callers inspect task runs through the resource endpoints. A worker needs the same registrations, authorization resolvers, codec allow-list, shared adapters, and `auth.resolveActor`.

```ts
const worker = platform.worker(); // Fails at setup without auth.resolveActor.
worker.start();
// On host shutdown:
await worker.stop();
```

Start a new worker object after shutdown; a stopped worker is not restartable. `backgroundTimeoutMs` controls task/agent handlers, while nested synchronous operations use `interactiveTimeoutMs` and inherit parent cancellation.

## Delivery and retries

Queue claiming/recovery is at-least-once: a crash or uncertain completion can repeat side effects. Use domain idempotency keys, unique constraints, and transactions where appropriate. Workcore does not provide an HTTP idempotency-key/replay store or automatically retry mutations/enqueues. Adapter deduplication applies only to the **same run ID**; every HTTP enqueue generates a fresh run ID. Retrying a request after an uncertain response can create another run. For stronger request guarantees, add a host/domain idempotency boundary backed by your database; do not rely on an arbitrary header being recognized.

Worker infrastructure backoff (`workerRetryDelayMs`) is not a configurable retry policy for failed tasks. Explicit relaunches are new executions. Timeouts and output-validation/encoding failures can occur after domain writes and do not imply rollback.

Task `triggers.mutations` names declared mutations; optional `mapInput(event)` derives task input from provenance, not private mutation input/output. Trigger enqueue follows successful event publication. Publication/trigger delivery is not atomic with domain writes, and lost trigger work is not recovered by client refresh. Use a durable outbox/domain workflow where required.

## Schedules

Schedules select an exposed task and validated input. Supported forms are `{ kind: 'once', runAt, timezone }` and `{ kind: 'recurring', cron, timezone }`; cron supports the documented five-field subset. Missing recurring occurrences are skipped, overlap is tracked per schedule, and disabling after durable dispatch reservation does not cancel an already-reserved run. See the [protocol](/protocol#schedules) and [production guarantees](/production-deployment).

## Persisted input versions

Tasks, agents, and schedules persist **validated handler-facing input**, encoded with a stable codec ID. Workers decode it and authorize it, but must not reapply the original raw-input transformation.

Operations and agents accept `version`, a positive safe integer defaulting to `1`. Enqueue and schedule creation persist it as `operationVersion`; missing legacy payload versions mean `1`. Increment the version whenever the persisted handler-facing input or execution meaning becomes incompatible:

```ts
tasks: {
  rebuild: {
    version: 2,
    input: newInputSchema,
    output: resultSchema,
    permission: 'index.rebuild',
    handler: rebuildHandler,
  },
}
```

A worker fails a mismatched queued task/agent with `OPERATION_VERSION_MISMATCH` **before invoking its handler**. A due mismatched schedule is disabled, records a skip reason/history entry, and does not dispatch. No automatic migration or handler-version routing is implied. Adapters must preserve `operationVersion` unchanged alongside `codecId` and encoded input; the shipped memory/file/PostgreSQL adapters persist these payload fields.

### Safe deployment procedure

1. Stop producers/dispatch and drain old work with old workers, or retain a compatible distinct operation name until it drains. Do not point old and new worker versions at the same unpartitioned queue during an incompatible rollout: either can claim the other's work and fail it.
2. Inventory schedules and queued handler-facing inputs. Migrate using an application-owned, validated migration while workers are stopped, or recreate schedules under the new version. Never merely relabel incompatible data.
3. Deploy matching definitions and codec registrations to HTTP and worker processes together.
4. Verify failed/mismatched runs, disabled schedules, and migration history before resuming producers. Explicitly relaunch only when domain retry safety is known.

Keep old codec registrations until all queued inputs, schedules, and retained results using them are drained/migrated/expired. Operation versions are a fail-closed guard, not transparent rolling-upgrade compatibility or exactly-once execution.
