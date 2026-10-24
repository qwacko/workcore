# HTTP and live protocol

This reference describes the implemented HTTP contract. The default API base is `/workcore/api`; examples below use paths relative to that base. The host supplies authentication; all API endpoints except OPTIONS require a trusted authenticated actor. There is no public actor-ID request field.

## Compatibility

The operation HTTP protocol and the admin manifest version are separate concepts. Manifests currently use `protocolVersion: 2`, `schemaDialect: 'https://json-schema.org/draft/2020-12/schema'`, and semantic `interface.version: 1`. These numbers do not version queued input schemas, codecs, or HTTP endpoint URLs. Clients should ignore unknown optional response fields, reject unsupported required semantic features, and not interpret a visible operation as permission to execute every input.

Breaking manifest changes require a new manifest version; optional additive fields do not. `validateSemanticInterface` checks the supported manifest/interface versions and required features before a renderer interprets them. A custom non-UI client need not render the interface. Package `0.1.0` remains an initial API; pin compatible package versions and run packaged-consumer verification when upgrading.

## Headers and bodies

- Send JSON bodies with `content-type: application/json`.
- `x-workcore-codec` selects a codec, default `json`; see below.
- Optional `x-correlation-id` supplies a diagnostic identifier, truncated to 128 characters. If missing/empty, the server generates one. API responses echo it in a header and errors include it in their body. Query/mutation successes also include it in their envelope. It is **not** an idempotency key or a trusted identity.
- Cross-origin mutations require an exact trusted origin. Built-in credentialed CORS allows `content-type`, `x-correlation-id`, and `x-workcore-codec`, and exposes `x-correlation-id`. Bearer-auth cross-origin hosts must additionally configure their own authorization-header CORS policy.
- OPTIONS returns 204 with permitted CORS headers. Unsupported HTTP verbs return 405; unknown routes generally return 404 after applicable authentication/scope checks.
- Raw requests default to at most 1 MiB. Codec-encoded operation results default to at most 2 MiB, excluding the surrounding envelope. Resource lists/manifests are not bounded by that result limit.

## Discovery and manifests

| Request | Response (200) |
| --- | --- |
| `GET /applications` | `{ applications: [{ id, workspaceCount }] }`, only applications with accessible workspaces |
| `GET /workspaces?applicationId=A` | `{ workspaces: [{ id, name }] }` |
| `GET /manifest?applicationId=A&workspaceId=W` | Manifest below |

```ts
type Manifest = {
  protocolVersion: 2;
  schemaDialect: 'https://json-schema.org/draft/2020-12/schema';
  applicationId: string;
  operations: Array<{
    name: string;
    kind: 'query' | 'mutation' | 'task';
    input: Record<string, unknown>;  // raw-input JSON Schema
    output: Record<string, unknown>; // validated-output JSON Schema
  }>;
  interface: {
    version: 1;
    requiredFeatures: string[];
    defaultPage?: string;
    pages: unknown[];
    operationViews: unknown[];
  };
  capabilities: {
    tasksRead: boolean; schedulesRead: boolean; schedulesManage: boolean; historyRead: boolean;
    agentRunsRead: boolean; agentRunsReadAll: boolean; agentResultsRead: boolean;
    agentMessagesRead: boolean; agentToolsRead: boolean; agentToolPayloadsRead: boolean;
  };
};
```

The nested semantic page/view descriptors are specified in [Admin pages and views](/admin-pages). Required feature identifiers currently supported by the shipped renderer are `operation-views-v1`, `collection-editor-v1`, `operation-catalog-v1`, and `custom-placeholder-v1`. The server projects operations, references, editors, and built-in resources for the current actor/workspace. There is no protocol-v1 `ui` fallback.

## Operation execution

All three endpoints take the same decoded body:

```json
{ "applicationId": "tracker", "workspaceId": "team", "operation": "activities", "input": { "limit": 10 } }
```

| Request | Success |
| --- | --- |
| `POST /query` | 200 `{ result, executionId, correlationId, deliveryWarning?, deliveryWarnings? }` |
| `POST /mutate` | 200, same envelope |
| `POST /enqueue` | 202 `{ runId }` |

`result` is the validated output, including scalar/null values. `executionId` identifies the synchronous execution; `runId` identifies asynchronous work, not its result. Every HTTP enqueue creates a new run ID. No automatic request replay/deduplication is implied. Inputs/outputs are validated server-side even for typed callers; queued/scheduled inputs are validated and transformed before persistence.

Warnings are delivery failures **after handler success**, not rollback:

- `EVENT_DELIVERY_FAILED`: mutation success event could not be published; triggers depending on that publication are not enqueued.
- `TRIGGER_DELIVERY_FAILED`: triggered enqueue failed; earlier trigger enqueues may already have succeeded.
- `HISTORY_PERSISTENCE_FAILED`: operation history could not be persisted.

`deliveryWarnings` is the complete string array; `deliveryWarning` is its legacy first-code alias. Absent warnings mean no delivery failure was reported, not transactional exactly-once delivery. Use the typed `*Detailed` methods to retain execution metadata; ordinary methods return only the result (or `{ runId }`).

## Scoped inspection

All paths below require query parameters `applicationId=A&workspaceId=W`, independently checked workspace access, and the relevant [built-in capabilities](/authorization#built-in-capabilities).

| Request | Response (200) |
| --- | --- |
| `GET /tasks[&limit=N]` | `{ runs: TaskRun[] }`; internal agent queue entries excluded |
| `GET /history[&limit=N]` | `{ entries: HistoryEntry[] }` |
| `GET /schedules` | `{ schedules: PublicSchedule[] }` |
| `GET /agent-runs[&limit=N&cursor=C&agent=NAME&status=STATUS&actorId=ID&conversationId=ID]` | `{ runs: AgentRun[], nextCursor: string | null }` |
| `GET /agent-runs/:id` | `{ run: AgentRun }` |
| `GET /agent-runs/:id/events[&after=N&limit=N]` | `{ events: AgentTraceEvent[], nextCursor: string | null }` |

`limit` defaults to 50 and is clamped to 1–200. General task/history lists are recent bounded lists, not cursor pagination. Agent list cursors are opaque; trace `after` is a numeric sequence and returned `nextCursor` is the last sequence as a string when a full page is returned. IDs/cursors must be URL-encoded. Agent statuses are `queued`, `running`, `succeeded`, `failed`, `interrupted`; unknown status/cursor inputs fail. Without workspace-wide agent access, results are actor-scoped regardless of a requested actor filter. Agent messages/tool payloads/results are independently redacted by capability.

History entries contain `id`, `scope: { applicationId, workspaceId }`, `actorId`, `kind` (`query`, `mutation`, `task`, `schedule`), `operation`, `status` (`succeeded`, `failed`, `delivery_failed`, `queued`, `running`), `startedAt`, and optional `finishedAt`, `durationMs`, `error: { code, message }`, and `runId`. Task runs add `kind: 'task'`, required `runId`, optional numeric `progress`, decoded `result`, and stored `codecId`. Dates/times in metadata are ISO strings.

Agent run records contain `id`, `scope`, `actorId`, `agent`, `status`, `createdAt`, `correlationId`, optional `startedAt`, `finishedAt`, `finishReason`, `conversationId`, `codecId`, authorized decoded `result`, and sanitized `error`. Trace records contain `id`, `runId`, numeric `sequence`, `createdAt`, `type`, and optional authorized JSON `data`. Trace types are `run.started`, `step.started`, `step.completed`, `tool.started`, `tool.completed`, `tool.failed`, `run.completed`, `run.failed`.

## Schedules

Create with `POST /schedules` and a body containing `applicationId`, `workspaceId`, `operation`, `input`, `timezone` (default UTC), plus either:

```json
{ "kind": "once", "runAt": "2030-01-01T09:00:00.000Z" }
```

or:

```json
{ "kind": "recurring", "cron": "0 9 * * *" }
```

The server treats non-`recurring` kinds as once; clients should always send an explicit valid discriminator. One-off dates must be future instants. Cron fields are minute (0–59), hour (0–23), day of month (1–31), month (1–12), and weekday (0–6, Sunday zero). Each accepts numbers, `*`, comma-separated alternatives, inclusive numeric ranges, and `*/N` steps; range/step combinations and names are unsupported. All fields must match (including day of month and weekday), and step matching uses the field value modulo N. The search is minute-granular and bounded to 370 days; do not assume full Unix-cron or DST guarantees. `timezone` must be supported by `Intl.DateTimeFormat`.

- Create: 201 `{ schedule }`.
- `PATCH /schedules/:id?applicationId=A&workspaceId=W`: body `{ enabled?, timezone?, cron? }`; 200 `{ schedule }`. It does not edit arbitrary task inputs or one-off dates. Unsupported patch properties do not update the schedule. Concurrent unresolved updates return 409 `SCHEDULE_CONFLICT`.
- `DELETE /schedules/:id?applicationId=A&workspaceId=W`: 200 `{ ok: true }`.

Public schedules contain `id`, `scope`, `operation`, decoded `input`, `actorId`, `timezone`, `kind`, `enabled`, `createdAt`, optional `operationVersion`, `codecId`, `runAt`, `cron`, `nextRunAt`, `lastSkipReason`, `activeRunId`, and `revision`. Internal claim tokens/leases/pending reservations are not exposed. Disabling/removing after reservation does not cancel already-reserved work. See [upgrade safety](/tasks#persisted-input-versions).

## Codecs

Strict `json` sends the decoded objects above directly. It rejects undefined, rich/non-plain values, sparse arrays, cycles, and non-finite numbers rather than relying on lossy `JSON.stringify` conversion. Application codec implementations must return strict JSON values.

For an allow-listed non-JSON codec, send its ID in `x-workcore-codec` and wrap the **whole body**, not just operation input:

```ts
{ workcoreCodec: codec.id, payload: codec.encode(decodedBody) }
```

Successes and normal errors use the same envelope; decode `payload` with that codec. GET requests need the header but no body. Unsupported codecs return 406 `WIRE_CODEC_UNSUPPORTED` in **plain JSON**; error-encoding failures also fall back to plain JSON with `WIRE_ENCODING_FAILED` (500). Header/body codec disagreement returns 400. SSE always carries plain JSON control messages, never codec-wrapped domain data.

Codecs preserve representation, not validation or authorization. Keep compatible codec IDs/registrations across clients, servers, workers, schedules, outstanding queues, and retained results. Use a new ID for an incompatible serialization format. The prebuilt admin supports strict JSON and `superjson-v1`; other codecs require a compatible custom frontend.

## Errors

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Required",
    "correlationId": "request-123",
    "issues": [{ "message": "Required", "path": ["items", 0, "name"] }]
  }
}
```

`issues` is optional and supplied for schema input/authorization-context validation failures; issue paths contain strings/numbers. Output validation errors deliberately omit handler output and detailed output issues. Generic exceptions are sanitized. Applications control validator messages and should not include secret values in them. Not every operation error proves no side effects occurred.

| Status | Codes |
| --- | --- |
| 400 | `INVALID_JSON`, `INVALID_REQUEST`, `WORKSPACE_REQUIRED`, `VALIDATION_FAILED`, `WIRE_DECODING_FAILED`, `WIRE_CODEC_MISMATCH`, `INVALID_FILTER`, `INVALID_CURSOR`, `INVALID_SCHEDULE`, `INVALID_TIMEZONE` |
| 401 | `UNAUTHENTICATED` |
| 403 | `FORBIDDEN`, `CSRF_REJECTED` |
| 404 | `APPLICATION_NOT_FOUND`, `OPERATION_NOT_FOUND`, `NOT_FOUND` |
| 405 | `METHOD_NOT_ALLOWED` |
| 406 | `WIRE_CODEC_UNSUPPORTED` |
| 409 | `SCHEDULE_CONFLICT`, `TRIGGER_DEPTH_EXCEEDED` |
| 413 | `REQUEST_TOO_LARGE`, `RESULT_TOO_LARGE` |
| 422 | `EXECUTION_FAILED`, `WIRE_ENCODING_FAILED` |
| 499 | `EXECUTION_ABORTED` |
| 500 | `INTERNAL_ERROR`, `OUTPUT_VALIDATION_FAILED`, `SCHEMA_CONVERSION_MISSING`; fallback `WIRE_ENCODING_FAILED` |
| 501 | `ADMIN_ASSETS_NOT_CONFIGURED` on an admin mount without assets |
| 503 | `AGENT_STORAGE_UNAVAILABLE` |
| 504 | `OPERATION_TIMEOUT` |

Worker failures additionally appear in run/history records (not as the enqueue HTTP result), including `ACTOR_UNAVAILABLE`, `ACCESS_REVOKED`, `TASK_FAILED`, `OPERATION_VERSION_MISMATCH`, and agent-specific execution/finish errors. Internal scheduler claim failures are bookkeeping/recovery signals, not request retry instructions.

The fetch client throws `WorkcoreClientError` with `code`, `message`, `status`, optional `correlationId`, and optional `issues`. Invalid successful JSON/envelopes produce client-side `INVALID_RESPONSE`. Codec-response envelope disagreement produces `WIRE_CODEC_MISMATCH`. Network errors/abort exceptions may come from the underlying fetch implementation. Do not automatically retry mutation/enqueue requests after timeout, disconnect, malformed responses, or post-handler failures; see [retry safety](/tasks#delivery-and-retries).

## SSE invalidations

`GET /events?applicationId=A&workspaceId=W` returns 200 `text/event-stream` after authentication/access checks. Each message is an unnamed event:

```text
data: {"type":"ready"}

data: {"type":"invalidate","eventId":"event-123"}

data: {"type":"refresh"}

data: {"type":"heartbeat","at":1790000000000}

```

`ready` is sent on establishment; heartbeats are sent every 20 seconds. `invalidate` means a mutation/task/workspace event occurred, not that any particular query changed. `refresh` is sent after a server-side access recheck every `liveRefreshMs` (default 60 seconds). No domain input/output is included. Access denial closes the stream.

There is no durable replay buffer, SSE `id:` cursor, or Last-Event-ID recovery guarantee. Subscribe first, perform an initial query, then perform a catch-up query on stream open/reconnect. Coalesce invalidations during pending queries and suppress stale responses. The typed client does this automatically. Periodic recovery depends on server refresh messages; there is no independent client polling fallback during a disconnected stream. Reconnect re-authenticates. Native EventSource cannot inherit HTTP fetch/header settings; see [subscription transport configuration](/configuration#client-and-transport).
