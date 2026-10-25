# Security and actual limits

## Authentication belongs to the host

`routeWorkspace` accepts a server-side session verifier returning `{ actor: { id }, expiresAt }` or null. It replaces incoming session headers before forwarding to the Durable Object. Never derive identity from an unverified browser-supplied actor ID.

The tracker deliberately uses a development demo cookie, not production authentication. `pnpm dev` explicitly selects the local Wrangler environment. The default environment and unlisted hosts fail closed with HTTP 503. For a protected local reverse proxy, set `HOST`, `PORT` and comma-separated `DEMO_ALLOWED_HOSTS` in `.env` (root, then example, with shell variables taking precedence). The dev launcher configures Wrangler's listener and passes the allowed hostnames to the Worker. Preserve the public host/scheme and WebSocket upgrades at the proxy. Anyone who can reach this demo can select its admin identity; use proxy access controls. Install a real verifier and remove the demo login flow before production use.

The host helper requires same-origin browser requests. JSON APIs require `application/json`, and cross-origin browser requests are rejected. It does not trust forwarded host headers or supply a general CORS configuration. Preserve this boundary when placing a Worker behind other routing infrastructure.

Authenticated WebSocket sessions are capped at one hour and closed at expiry using the workspace alarm. The tracker uses five-minute socket sessions; reconnect re-enters the public authentication boundary. External session revocation before expiry requires the host/application to reflect revocation in current authorisation data; the original cookie is not reverified on every socket message.

## Authorisation belongs to the application

Every view, query, mutation, enqueue and job tool invocation checks the definition's current `authorize` callback. Use workspace membership stored in the object's tables, or another synchronous trusted policy. Roles supplied by the client are not authority.

Table access is server-only. View and query handlers must enforce record/field-level permissions. Sharing a workspace does not imply sharing every row. Client filters never hide data already sent to a user.

Permission checks happen on each subscription refresh and commit, including commits unrelated to that view's data dependencies. A denied result clears the client's data. Already downloaded information cannot be retracted from a user.

`$admin` is intentionally powerful: it permits raw **read** inspection of records and all users' execution payloads/traces. Do not grant it just to expose a dashboard. The console does not expose internal KV directly or permit raw record writes.

## JSON and size limits

- Records and KV values: 256 KiB encoded JSON each.
- Query/view/mutation output data: 512 KiB.
- Public HTTP request bodies and WebSocket messages: 64 KiB.
- Live subscriptions: 20 per connection, with 8,000 bytes maximum hibernation metadata.
- Array view results: 500 rows by default; configurable up to 1,000. Oversized views fail, not truncate.
- Database pages: 1–1,000 rows; `all()` fails above 1,000.
- Execution steps/tools: default 20 per attempt, maximum 100.
- Explicit step results: 32 KiB each; traces are paginated.
- Task attempts: default 1, maximum 10.
- Terminal runs, operation history and deduplication responses: 1,000 entries each.

No rich-value codecs are supported. Dates, undefined, non-finite numbers, bigint, cycles, custom object prototypes and lossy JSON representations are rejected. Schemas must have an honest JSON Schema representation.

## Operational limitations

This is an initial implementation. Before production use, account for:

- Cloudflare's storage, CPU, alarm and connection limits; a workspace is one coordination boundary.
- Whole-workspace synchronous record migrations and their startup cost.
- External effects that can be repeated or have uncertain outcomes.
- No offline writes, cross-workspace transactions, arbitrary query language, range/full-text indexes or alternate ordering helpers.
- No durable outbound webhook/email delivery service, managed attachment storage, export/import or configurable retention policies.
- No agent approval/resume protocol, model-provider abstraction, token stream, enforced monetary budget or conversation persistence API.
- No built-in membership provisioning, invitations or production authentication package.

Use provider bindings for secrets. Explicit step results and run inputs/outputs may be sensitive; apply appropriate access, retention and model-provider policies.

Tests exercise the runtime in Cloudflare's local Workers implementation with real SQLite, not a substitute database adapter. Local verification does not replace load tests and deployment-specific security review.
