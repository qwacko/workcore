# Worker host reference

Import `Workspace`, `routeWorkspace` and type `Session` from `@workcore/core/cloudflare`. These APIs run on Cloudflare, not in browser bundles. Follow the [complete Worker tutorial](./getting-started#5-host-the-definition-in-a-worker) first; use [deployment](./deployment) for provisioning rather than treating this reference as a deploy command.

## Workspace class

Extend `Workspace<Env>` and call `super(ctx, env, definition)` in your Durable Object constructor. Export that class from the Worker module and bind its exact name in Wrangler's `durable_objects` and `new_sqlite_classes` migration. `Env` represents the Worker's configured bindings; see [context](./context#server-configuration-and-environment-bindings).

The base class handles internal authenticated API requests, WebSocket hibernation hooks and the alarm-driven job/schedule/session/file lifecycle. Keep the public Worker as the authentication boundary; do not publicly forward browser-crafted internal session headers directly to the DO. Do not override transport/alarm hooks casually or create a second scheduler that bypasses runtime invariants.

Application SQL migrations are bundled with the definition and applied at DO startup; Wrangler class/namespace migrations are distinct. Preserve deployed migration history and class bindings. A workspace key selects an instance within a namespace via `idFromName`, not a SQL database shared with other instances.

## routeWorkspace options

`routeWorkspace(request, options): Promise<Response>`:

| Option | Default | Contract |
| --- | --- | --- |
| `namespace` | Required | Primary Durable Object namespace |
| `authenticate(request)` | Required | Sync/async verifier returning `Session` or null; no built-in auth provider |
| `namespaceFor(workspaceId, request)` | Primary namespace | Optional synchronous namespace selector for apps with several definitions |
| `authorizeWorkspace(session, workspaceId, request)` | No extra host routing check | Optional sync/async access check before contacting the DO; false yields 403 |
| `prefix` | `/api/workspaces/` | URL prefix preceding workspace ID and endpoint; custom clients/routing must use a matching URL; prebuilt admin expects the default |

`Session` is `{ actor: { id: string }, expiresAt: number }` with epoch-millisecond expiry. Null, missing identity or expired sessions yield 401. Forwarded expiry is capped to one hour from routing time. Only the verified ID/expiry are forwarded; arbitrary claims, roles, request-context bags and permission snapshots are not.

The router accepts workspace keys of 1–100 ASCII letters/digits/underscores/hyphens. Browser Origin must match the request URL origin; the helper is not a general CORS layer and does not trust forwarded-host headers. JSON endpoints require `application/json`. Caller-supplied internal session headers are replaced. Errors use the [normal error contract](./security#error-contract).

The namespace selector chooses storage, not authority. `authorizeWorkspace` can consult host services asynchronously, but it does not replace the definition's synchronous operation and row/field permission checks. Established sockets carry bounded identity/expiry; the external cookie is not verified on every message.

## Public endpoint map

With the default prefix, prepend `/api/workspaces/:workspaceId/`:

| Endpoint | Purpose | Preferred client method |
| --- | --- | --- |
| `GET manifest` | Authorized discovery | `manifest()` |
| `POST query` | One-shot view/query | `query()` |
| `POST mutate` | Application transaction | `mutate()` |
| `POST enqueue` | Background job submission | `enqueue()` |
| `GET live` with WebSocket upgrade | Multiplexed views/displays/manifest/system resources | Subscription methods |
| `POST display` | Display document resolution | `display()` |
| `POST inspect`, `trace`, `control`, `system` | Checked system inspection/control | Matching client methods |
| `POST/GET files`, `GET/DELETE files/:id` | Optional file storage | `files.*` |

Prefer the [client](./client-api) rather than hand-assembling wire messages. Workspace auth routes such as `/api/auth/sign-in/email` are **host application routes**, not Workcore endpoints. In the example Better Auth handles them, including JSON sign-out requests.

## Static frontends and admin

`routeWorkspace` handles workspace API requests, not the whole website. Route host authentication endpoints separately, route Workcore APIs to the helper, authenticate admin pages before `serveAdmin`, then use the application's asset fallback. Preserve WebSocket upgrades through proxies.

Use [admin installation](./admin#install-and-serve-the-optional-console) when sharing an asset binding. The application and admin SPAs need separate fallback handling; a generic root fallback must not accidentally return the application's HTML for an admin route or API error.
