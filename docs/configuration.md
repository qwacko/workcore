# Configuration reference

## Definitions and registration

`defineApplication<Context>()({ id, authorization?, queries?, mutations?, tasks?, agents?, admin? })` defines an application catalog. `defineWorkspace` is a compatible alias. The definition's `id` becomes `applicationId`; `workspaceId` selects an instance provided by the workspace adapter.

Queries, mutations, and tasks declare `input`, `output`, `handler`, optional `permission`, `api` (default false), `version` (default 1), and `views`. Tasks may also declare mutation `triggers`. [Operation authoring](/authoring), [admin views](/admin-pages), and [agents](/agents) describe their nested contracts.

`definition.registerApplication({ createAppContext, resolveAuthorization? })` returns the registration accepted by `createPlatform`:

- `createAppContext({ scope, actor })` is required; its result is inferred from `Context`. It runs per execution, including synchronous sibling calls. Optional `dispose()` is called on the result after execution, with a five-second cleanup deadline.
- `resolveAuthorization({ scope, actor })` is required when the definition declares an authorization context schema. It returns the schema's raw input type; Workcore validates/transforms that result and gives the schema's output to the definition's checker. It can run multiple times per request/manifest; do not assume one resolution or cache across actors/workspaces.

See [authorization](/authorization) for composition and [context lifecycle](/authoring#context-and-checked-sibling-calls).

## Module composition

`defineModule<Context, Dependencies = {}>()({ id, requires?, queries?, mutations?, tasks?, agents?, admin? })` defines a local catalog. `requires` lists every non-optional dependency key as `true`; modules without required dependencies may omit it. Handlers receive typed `dependencies` alongside `ctx`, `input`, and their local checked caller. Modules may contribute admin pages, but application authorization, builtins, default page, and host registration belong to the composition root.

`composeApplication<Context>()({ id, modules, dependencies?, authorization?, admin? })` mounts modules under unique namespace keys. A `dependencies[moduleName]({ ctx, operations })` factory is required for each module with required capabilities; it returns that module's declared dependencies and may be async. `operations` is a fully qualified typed caller for the same actor/workspace execution. Optional-only factories may be omitted. The composed result registers and drives the client exactly like an ordinary application definition. See [composition](/composition) for namespace, lifecycle, KV/logging, callback failure, and deployment semantics.

## Platform options

`createPlatform(options)` returns `{ httpHandler, worker }`. It does not open network listeners or start workers automatically.

| Option | Required/default | Contract |
| --- | --- | --- |
| `applications` | Required | Registrations with unique application IDs |
| `auth` | Required | `authenticate(Request)` returns a trusted actor or null; `resolveActor(id)` is required when creating a worker |
| `services` | Required | See infrastructure below |
| `authorise` | Optional | Global capability gate; combines with workspace authorization using AND, not OR |
| `trustedOrigins` | `[]` | Additional exact HTTP(S) browser origins, no paths/wildcards; same-origin is allowed |
| `wireCodecs` | `[]` | Additional codecs; strict `json` is always available and cannot be replaced |
| `maxRequestBytes` | `1,048,576` | Maximum raw HTTP JSON request body bytes |
| `maxResultBytes` | `2,097,152` | Maximum codec-encoded operation/task/agent result bytes, excluding response envelope; not a universal resource-list limit |
| `operationTimeoutMs` | Unset | Legacy common override for interactive and background handlers |
| `interactiveTimeoutMs` | `30,000` | Interactive/internal handler deadline; takes precedence over `operationTimeoutMs` |
| `backgroundTimeoutMs` | `300,000` | Task/agent handler deadline; takes precedence over `operationTimeoutMs` |
| `shutdownTimeoutMs` | `10,000` | Maximum worker shutdown wait after cooperative abort; zero allowed |
| `liveRefreshMs` | `60,000` | Server SSE access-check/refresh interval; not an independent browser polling interval |
| `workerRetryDelayMs` | `1,000` | Worker-loop infrastructure failure backoff base, capped at 30 seconds; not an operation retry policy |
| `admin` | Optional, legacy | Fallback mount descriptor; prefer `httpHandler({ admin })` |

Numeric options are validated at construction as positive safe integers (shutdown may be zero); millisecond timers must fit a signed 32-bit timer. When the specific deadline is unset, the common `operationTimeoutMs` takes precedence over its default. Synchronous sibling calls use the interactive deadline but also inherit the parent's abort signal. Deadlines bound handlers, not authentication, authorization, context creation, cleanup, serialization, or adapter I/O. Cancellation is cooperative and does not imply rollback.

## Infrastructure services

`services` requires `workspaces`, `events`, `history`, `tasks`, `schedules`, and `kv`, even for an interactive-only platform. Use `createMemoryState()` for a complete local composition or compose the explicit adapters from `@workcore/adapters`. Memory/file adapters are single-process, not a shared production backend.

- `logger` is optional; scoped handler logging falls back to the console.
- `agentRuns` is optional and required for agent enqueue/run inspection.
- `agentEngine` is optional and required to execute queued agents.
- Workcore does not own adapter connections or automatically close database/Redis clients. The host owns them.

`platform.worker()` fails immediately without `auth.resolveActor`. `worker.start()` starts queue execution and schedule polling; `await worker.stop()` aborts active work and waits up to the grace period. Create a new worker after stopping one; stopped workers are not restartable. Start workers only in the intended worker processes.

## HTTP and admin mounting

```ts
const admin = createAdminHandler({ basePath: '/console', apiBasePath: '/api' });
const handle = platform.httpHandler({
  apiBasePath: '/api',
  admin: { basePath: '/console', handle: admin },
});
```

`apiBasePath` defaults to `/workcore/api`. A mount-level `admin` descriptor replaces the entire legacy platform descriptor—path and handler together. A selected admin path without a handler returns 501, never an unrelated fallback handler. Configure `createAdminHandler` with matching paths and `wireCodecId` when using SuperJSON. The core does not authenticate admin assets; protect them at the host if required. API calls always authenticate independently.

## Client and transport

`createClient<typeof definition>({ applicationId, workspaceId, transport })` scopes calls. `query`, `mutate`, and `enqueue` return results; their `*Detailed` equivalents additionally return execution/correlation IDs and delivery warnings when supported by the transport. Calls accept an optional third `{ signal, correlationId }` argument. Custom transports may omit `requestDetailed`; detailed methods then fail explicitly.

`createFetchTransport(options = {})` supports:

| Option | Default | Purpose |
| --- | --- | --- |
| `baseUrl` | `/workcore/api` | API URL/path; use an absolute URL on Node |
| `fetch` | Global `fetch` | HTTP implementation |
| `credentials` | `same-origin` | Fetch credential policy; native SSE enables cross-origin credentials only for `include` |
| `headers` | None | Static headers or async header provider, applied to HTTP requests only |
| `eventSource` | Native browser EventSource | `(url, { withCredentials }) => source`; inject authentication-aware or non-browser SSE implementations |
| `codec` | Strict JSON | Must match a server-registered codec |
| `onWarning` | None | Notification for operation delivery-warning codes |

The injected subscription source implements `onopen`, `onmessage`, `onerror`, and `close`. It must provide EventSource-compatible open/reconnect events and JSON `data` messages. Fetch headers/providers do **not** carry over to native SSE. Use a source factory that implements your authentication/credential policy for bearer auth or Node. Native EventSource cannot omit same-origin cookies, so `credentials: 'omit'` requires an injected source. Hosts enabling cross-origin bearer HTTP must separately allow the `authorization` header in their CORS layer; Workcore's built-in CORS allow-list is deliberately limited.

`WorkcoreClientError` exposes `code`, `status`, optional `correlationId`, and optional validation `issues`. Invalid success bodies/envelopes produce `INVALID_RESPONSE`, not successful empty results. See the [protocol](/protocol) for precise envelopes and retry semantics.
