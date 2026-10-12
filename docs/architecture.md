# Architecture and operational notes

## Core model

- A workspace **definition** is the reusable application and operation catalog. A workspace **instance** is one personal/shared scope under that definition.
- `applicationId` identifies a definition; `workspaceId` selects its scoped data.
- Query, mutation and task handlers receive an actor, scope, correlation ID, abort signal, scoped services and a per-execution application context.
- `api: true` is required to expose an operation to HTTP clients. Internal operation calls use the same input/output validation and permission checks.
- Missing permissions default to deny. Workspace membership is always checked separately. Named string/array capabilities require an affirmative workspace or global authorizer (and all configured gates must allow); an explicit empty array requires no capability. Callback policies are evaluated at execution and use `access.has()` for capability checks, so the manifest includes them without pretending to evaluate input-dependent policy. The manifest hides statically denied operations, but execution checks are authoritative.
- Standard Schema is the validation contract. Standard JSON Schema draft 2020-12 is required for exposed operations so the versioned manifest and generic UI can represent inputs/results.

## HTTP and live queries

`createPlatform(...).httpHandler()` accepts the Web `Request` API. The initial endpoints are:

| Method/path | Purpose |
| --- | --- |
| `GET /workcore/api/workspaces?applicationId=…` | List accessible workspaces |
| `GET /workcore/api/manifest?applicationId=…&workspaceId=…` | Authorised versioned operation manifest |
| `POST /workcore/api/query` | `{applicationId, workspaceId, operation, input}` |
| `POST /workcore/api/mutate` | Same envelope for a mutation |
| `POST /workcore/api/enqueue` | Same envelope; returns a task run ID |
| `GET /workcore/api/events?applicationId=…&workspaceId=…` | SSE workspace invalidations |
| `GET /workcore/api/tasks`, `/history`, `/schedules` | Scoped task/history/schedule inspection |
| `POST /workcore/api/schedules` | Create a one-off or five-field cron schedule |
| `PATCH /workcore/api/schedules/:id`, `DELETE …` | Enable/disable/update or remove a schedule |

SSE sends JSON control invalidations rather than domain payloads. The typed client starts a query immediately and performs a catch-up query when the event stream becomes ready; it coalesces invalidations while a request is pending, rejects stale responses and refreshes after reconnect/periodic recovery. The admin applies the same ready/catch-up and stale-response protections. Access is rechecked during event delivery and refresh.

### Wire codecs

HTTP JSON is the default and accepts only JSON-compatible values; dates, `bigint`, maps/sets, cycles, `undefined` and non-finite numbers fail clearly instead of being silently changed by `JSON.stringify`. Optional `@workcore/codec-superjson` and `@workcore/codec-devalue` packages provide concrete codecs without making either serializer a core dependency. A client can use a custom `WireCodec` per transport connection, for example `createFetchTransport({ codec: superjsonCodec() })`; the server must explicitly allow-list the same codec with `createPlatform({ wireCodecs: [codec] })`. Each JSON request selects its codec with `x-workcore-codec`; unsupported IDs are rejected. Codec IDs must remain stable and compatible for as long as queued work or schedules using that codec can remain outstanding. The prebuilt admin can be configured to use the built-in SuperJSON codec by passing its ID to `createAdminHandler({ wireCodecId: 'superjson-v1' })`.

Codecs preserve representation; Standard Schema still validates decoded inputs and handler outputs, and authorization still sees the validated handler-facing input. Workcore stores already-validated, codec-encoded task/schedule inputs and does not apply input transforms a second time. Task results retain their codec ID and are decoded then re-encoded for the requesting client. The SuperJSON adapter supports its built-ins, including `Date`, `bigint`, `Map`, `Set`, `undefined`, and cycles; it explicitly rejects functions, symbols, accessors, weak collections, and promises rather than silently dropping them. Custom classes need matching serializer registrations on all clients and workers. Devalue supports its documented value set and should only be used for trusted application values; do not use it to render untrusted strings as HTML. Application-owned database persistence remains separate: the tracker demo explicitly converts its `Date` values to ISO strings for its local JSON file and hydrates them on read.

The admin uses `x-workcore-runtimeType: 'date'` JSON Schema metadata only where the runtime value is a JavaScript `Date`. It does not infer runtime types from JSON Schema `format` (for example, `format: 'date-time'` alone remains a string). Rich results use a safe display formatter; rich row-action inputs use an editable SuperJSON envelope, while ordinary inputs remain plain JSON. The prebuilt admin supports `json` and `superjson-v1`; unsupported IDs fail during `createAdminHandler()` setup. Use a custom frontend/client for the devalue codec or a custom SuperJSON registration.

## Admin

`@workcore/admin` contains a Svelte 5 + Vite browser application, already compiled into package assets, and a Node host helper `createAdminHandler`. Mount its handler only for the admin route and delegate API routes to the core handler. Asset URLs are rewritten for arbitrary base paths; the admin uses local bundled assets, not a CDN. The host owns authentication, cookie policy and deployment/content-security policy.

The console consumes the same authorised manifest and API as custom clients. It supports JSON and table query results, pagination, named variants, schema-driven primitive/enum forms, row mutation bindings, task launch/results/progress, schedule management and workspace operation history. Complex input shapes use a JSON editor validated by the server.

## Local demo adapters

The reusable `@workcore/adapters` package exposes the local implementations as individual adapters. Applications compose them into `PlatformServices`; the tracker uses a shared file state for KV, tasks, schedules and history, while selecting its event adapter explicitly.

The tracker example intentionally needs no database or Redis to run:

- Domain activities are stored in `data/tracker.json`.
- KV values, task queue/runs, schedules and safe history are stored in `data/workcore-state.json` with serialized local file updates.
- A claimed task left in the processing list is requeued on the next adapter instance start (at-least-once behaviour).
- Task queue and schedule payloads contain JSON-safe encoded handler inputs plus a codec ID; adapters must persist those fields unchanged, and worker processes must register compatible codecs until the work expires.
- Schedule adapters must implement claims, lease renewal/release, `reserveRun`, and claimed updates/removal atomically across worker processes. User updates and claimed bookkeeping compare `revision` (legacy missing revisions mean zero); stale user edits return HTTP 409. User updates preserve current internal claim/dispatch fields, and `clearActiveRun` clears only the matching run rather than replacing a schedule. This prevents a worker snapshot from undoing a concurrent disable, cron or timezone edit.
- `reserveRun` atomically checks the claim, revision and enabled state and persists `pendingRunId` before enqueue. The ID is derived from the schedule and occurrence and is reused on recovery, including after uncertain enqueue acknowledgements or bookkeeping failures. Task adapters must make enqueue idempotent by ID even for already-completed runs, and retain deduplication records for the schedule recovery window. Both local adapters implement this. A pending reserved occurrence is recovered rather than skipped as a missed recurring occurrence. Reservation is the dispatch boundary: edits made before it prevent stale dispatch; disabling/removing a schedule afterwards does not cancel an already-reserved run.
- The worker serializes polling within a process and renews leases during long actor-resolution/authorization calls. Enqueue and schedule bookkeeping still span separate adapter calls, so these guarantees do not make domain side effects exactly-once or replace an outbox.
- SSE events are in-process/transient. Active subscriptions recover through periodic refresh; a mutation event lost between domain write and event publication can still miss a task trigger.
- Workspace membership and demo capability rules are in source. The `/login/:actor` cookie route is an unauthenticated local fixture.

These adapters are single-process local/demo implementations. File serialization is not a cross-process lock, scheduler claim protocol or production database. Do not expose this demo authentication or run multiple workers against the same files. Applications should implement the exported service interfaces using their shared database, queue, authentication and event infrastructure.

## Security and failure semantics

- Never accept an actor ID from an operation request. Resolve the actor from trusted host authentication.
- Behind a reverse proxy whose public origin differs from the internal `Request.url` origin, configure exact `trustedOrigins`; do not trust arbitrary forwarded host/protocol headers. Only configured origins are echoed for credentialed CORS responses.
- Validate before handler execution and recheck workspace/operation access for every HTTP, sibling, queued-task, live-refetch and scheduled invocation.
- Scope application-owned repositories themselves; passing scope alongside an unrestricted database does not isolate it.
- Query handlers must be read-only. Mutations are not automatically transactional. Output validation or wire-encoding failures can occur after application side effects; errors do not mean rollback. Task completion is terminal before schedule/event/history follow-up, so bookkeeping failures do not rewrite a successful run as failed.
- Applications may define an `authorization` context schema and checker on their workspace definition. The host registration resolves the trusted, execution-specific authorization context; the platform validates it and invokes the checker for application operations and built-in capabilities such as history, task inspection and schedule management. The optional platform `authorise` hook can add a global policy gate, but workspace authorization does not depend on it.
- A workspace is authored in one `defineWorkspace<App>()({ ... })` call. Schema maps infer each operation's inputs/results; `NoInfer` makes handlers consume those types, including typed sibling query/mutation/task calls. Task triggers and UI actions are checked against declared mutations, and UI bindings against mutation input fields. Calls still execute through runtime validation and authorization. The typed browser client infers query/mutation/task inputs and outputs from the finished definition.
- Success events contain provenance, not input/output. Event publication failure is recorded separately and surfaced as a response warning. Lost transient trigger events are not recovered.
- History is metadata-first: actor/scope, operation, timing, status and sanitised errors. Task adapters may retain results for authorized task inspection; define retention/size policy for production data.
- Schedule timezone is explicit. Missed recurring executions are skipped; overlap is tracked per schedule, not per workspace. Queue delivery/recovery may repeat work.
- Task automatic retries are not configurable in v1. A failure can be inspected and explicitly launched again.

## Current limitations

- No production PostgreSQL, Redis/BullMQ or Better Auth packages yet. The contracts allow those integrations; only the local file/in-memory event example is supplied.
- No managed transaction/unit of work or outbox. Application handlers can use their own database transaction, but Workcore cannot atomically coordinate it with events, KV or queues.
- Event publication and trigger enqueue are separate from a domain write. Transient event loss can miss live invalidation/trigger work until a client refreshes; refresh cannot restore a missed task trigger.
- The local file adapters assume one process. Durable multi-process enqueue deduplication, scheduling locks and event delivery require shared adapters.
- Schedules accept simple five-field cron numeric, wildcard, list and range forms; names, steps/ranges combinations, DST edge-case guarantees and schedule editing of arbitrary task inputs are not promised.
- No retry policy, task cancellation endpoint, agent runtime, custom composed views, invite/membership UI or external transport.
- The API and packages are an initial `0.1.0` design. Packaged-consumer verification remains part of release hardening.
