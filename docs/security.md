# Security and actual limits

## Authentication belongs to the host

`routeWorkspace` accepts a server-side session verifier returning `{ actor: { id }, expiresAt }` or null. It replaces incoming session headers before forwarding to the Durable Object. Never derive identity from an unverified browser-supplied actor ID.

The tracker uses Better Auth with D1-backed identities. `pnpm dev` selects the local Wrangler environment; `DEMO_MODE=true` permits a development-only fallback auth secret. Production requires a random `BETTER_AUTH_SECRET` of at least 32 characters and a canonical HTTPS `BETTER_AUTH_URL`. The example allows registration without email verification: harden this according to your application's identity policy. Administrator IDs must be explicitly configured; never authorize an unverified email address. See the demo README for setup.

The example applies permissions to todos and notes: authenticated users can read shared tasks and their own private tasks, edit only their own tasks, and read/edit only their own notes. Trusted administrators have separate inspection access. Workcore does not require teams or a membership schema. See [application permissions](./multi-user). The optional `routeWorkspace.authorizeWorkspace` hook can apply a host-owned routing policy before contacting a namespace; operation and record permissions still belong to the application.

For a local reverse proxy, set `HOST`, `PORT` and comma-separated `DEMO_ALLOWED_HOSTS` in `.env` (root, then example, with shell variables taking precedence). Preserve the public host/scheme and WebSocket upgrades. Do not expose a development deployment with its fallback secret to the public internet.

The host helper requires same-origin browser requests. JSON APIs require `application/json`, and cross-origin browser requests are rejected. It does not trust forwarded host headers or supply a general CORS configuration. Preserve this boundary when placing a Worker behind other routing infrastructure.

Authenticated WebSocket sessions are capped at one hour and closed at expiry using the workspace alarm. The tracker uses five-minute socket sessions; reconnect re-enters the public authentication boundary. External session revocation before expiry requires the host/application to reflect revocation in current authorisation data; the original cookie is not reverified on every socket message.

## Authorisation belongs to the application

Every view, query, mutation, enqueue and job tool invocation checks the definition's current `authorize` callback. Use current synchronous trusted policy data appropriate to your application. Permissions supplied by the client are not authority.

Table access is server-only. View and query handlers must enforce record/field-level permissions. Sharing a workspace does not imply sharing every row. Client filters never hide data already sent to a user.

Permission checks happen on each subscription refresh and every commit, even when invalidation keys do not match. Matching application views are selectively recomputed. System subscriptions always reauthorize and reproject their bounded results, including all-runs versus own-runs scope changes. `$connect` revocation closes the socket. A denied result clears the client's data. Already downloaded information cannot be retracted from a user. Include permission/visibility trigger keys in application views whenever a permission change alters row/field projection without denying the whole view.

`$admin` is intentionally powerful: it permits bounded raw **read** inspection of registered application tables and all users' execution payloads/traces. Do not grant it just to expose a dashboard. The console does not expose internal KV directly or permit raw SQL writes.

## JSON and size limits

- KV values: 256 KiB encoded JSON each.
- Query/view/mutation output data: 512 KiB.
- Public HTTP request bodies and WebSocket messages: 64 KiB.
- Live subscriptions: 20 per connection, with 8,000 bytes maximum hibernation metadata.
- Array view results: 500 rows by default; configurable up to 1,000. Oversized views fail, not truncate.
- Raw-table inspection: at most 100 rows / about 400 KB per page.
- Execution steps/tools: default 20 per attempt, maximum 100.
- Explicit step results: 32 KiB each; traces are paginated.
- Task attempts: default 1, maximum 10.
- Terminal runs, operation history and deduplication responses: 1,000 entries each.

No rich-value codecs are supported. Dates, undefined, non-finite numbers, bigint, cycles, custom object prototypes and lossy JSON representations are rejected. Schemas must have an honest JSON Schema representation.

## Error contract

Application JSON API failures use an HTTP error status and `{ error: { code, message } }`. Throw `WorkcoreError(code, message, status = 400)` for an intentional application error. HTTP client calls translate structured server failures into `ClientError` with a `code`, `message` and numeric `status`; native transport/parsing failures may still be ordinary exceptions. Live subscription failures arrive as `LiveState.error`, not an HTTP exception to catch around `subscribe`.

Important cases include unauthenticated/expired sessions (401), denied operations (403), unavailable/stale owner/version writes (`CONFLICT`, 409), oversized JSON (`TOO_LARGE`, 413), invalid plain JSON (`INVALID_JSON`), attempted asynchronous synchronous handlers (`ASYNC_TRANSACTION`), client teardown (`CLIENT_CLOSED`) and revision waits (`SYNC_TIMEOUT`). Read the returned code/status rather than treating every failure as a retryable network problem.

Host authentication providers have their own response format. For example, Better Auth's sign-out route requires JSON content type/body; it is not a Workcore workspace endpoint. Do not bypass origin or permission checks to resolve a request-format error.

## Operational limitations

This is an initial implementation. Before production use, account for:

- Cloudflare's storage, CPU, alarm and connection limits; a workspace is one coordination boundary.
- Synchronous bundled SQL migrations and their startup cost.
- External effects that can be repeated or have uncertain outcomes.
- No offline writes, cross-workspace transactions, arbitrary query language, range/full-text indexes or alternate ordering helpers.
- No durable outbound webhook/email delivery service or configurable retention policies. Optional R2 files and trusted maintenance [backup/restore helpers](./recovery) are available; database and object storage are not one transaction.
- No agent approval/resume protocol, enforced monetary budget or general conversation persistence API. The optional AI SDK integration supports provider profiles, checked tools and transient inference deltas; external tools remain trusted application code responsible for their own permissions and outbound access policy.
- No prescribed user/role schema or bundled production authentication package; authentication and application permissions are host/application-owned.

Use provider bindings for secrets. Explicit step results and run inputs/outputs may be sensitive; apply appropriate access, retention and model-provider policies.

Read database contexts guard execution as well as query-builder methods. Raw reads accept one SELECT/WITH/EXPLAIN statement; writes detected at execution are rolled back, and contexts expire after the operation. This is application-code safety, not a sandbox for malicious handlers. Do not accept arbitrary SQL from clients. Authorization callbacks always receive their own read-only context, including inside a mutation.

Tests exercise the runtime in Cloudflare's local Workers implementation with real SQLite, not a substitute database adapter. Local verification does not replace load tests and deployment-specific security review.
