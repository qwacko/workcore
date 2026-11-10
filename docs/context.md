# Context, identity and application input

“Context” can mean several different things. Workcore does not provide a generic browser-to-handler context bag or automatically forward arbitrary authentication claims. Decide which boundary a value belongs to before passing it.

## Which context is available?

| Boundary | Available values | Trust and lifetime |
| --- | --- | --- |
| Operation input | The operation's validated Zod input, supplied separately from `ctx` | Browser input is untrusted even after shape validation; check access to referenced records/projects |
| Host authentication | The HTTP request and your session provider | The host verifies identity; it may asynchronously consult external auth storage |
| Forwarded session | `{ actor: { id }, expiresAt }` | `routeWorkspace` replaces the internal session header; it does not forward arbitrary roles or claims as context |
| View/query/authorization context | `db`, read-only `kv`, `actor`, `now` | Synchronous, read-only, operation-scoped; do not retain contexts/builders |
| Mutation context | `db`, read/write `kv`, `actor`, `now`, `trigger`, `enqueue`, `schedule`, `cancelSchedule` | Synchronous and transactional; no network calls or other asynchronous external work |
| Task/agent context | `actor`, `env`, `runId`, `signal`, `progress`, `read`, `mutate`, `step` | Asynchronous background execution; access data through checked registered operations rather than a raw job database |

`now` is an epoch-millisecond value for the current synchronous context. `actor` currently contains only `id`. Read/mutation contexts do **not** expose `request`, `headers`, a generic `context`, or `env` properties.

## Identity and request-time policy

The host's `routeWorkspace.authenticate(request)` returns a verified session or `null`. Use your existing session provider; never accept `{ actorId, isAdmin }` from a request body as proof of authority. Only the verified ID and a bounded expiry cross the helper's trusted session boundary.

If access depends on which workspace key is addressed, use the optional `authorizeWorkspace(session, workspaceId, request)` hook. This host hook can perform asynchronous checks before contacting the Durable Object. It is not a substitute for current operation/record permissions inside the workspace, and it is not rerun on every message of an established WebSocket.

Persist current application policy in workspace tables/KV when synchronous `authorize` or view handlers need it. Updating policy must also invalidate any views whose row/field projection changes. External cookie revocation is not automatically checked on every socket message; see [live permissions](./multi-user#permission-changes-and-live-privacy) and [session expiry](./security#authentication-belongs-to-the-host).

## UI scope and domain context

Put domain parameters such as `projectId`, a record ID, a filter or a pagination cursor in the operation's input schema. They are typed arguments, not authority. The handler must check whether `ctx.actor.id` may use the selected scope.

Live subscription inputs identify the resource being observed. When the UI switches projects, unsubscribe from the previous input and subscribe with the new one. Mutable component state is not implicitly transmitted to a handler. One client can share equivalent subscriptions, but there is no arbitrary payload-bearing update-channel API; see [live views](./sync).

Keep sensitive values out of URL parameters and browser state. In particular, never use browser-provided IDs/roles to replace server authorization or pass provider keys as operation input.

## Server configuration and environment bindings

Cloudflare bindings are supplied to the `Workspace` constructor; tasks/agents receive that environment through `ctx.env`. Type the workspace factory's environment generic when defining typed jobs. See the [example application](https://github.com/qwacko/workcore/blob/main/examples/workcore-demo/src/app.ts) for the complete schema/environment declaration.

For trusted configuration needed by a synchronous policy, compose the definition in the Durable Object constructor. The demo wraps `authorize` there to consult its server-configured administrator IDs alongside the existing workspace policy. Such a closure is application code, not a per-request context injector. Do not capture a request, user session or mutable “current actor” in module-global state: a Durable Object serves multiple users.

Environment bindings are not automatically serialized into browser manifests or operation results. Keep secrets server-side and return only explicitly authorized data.

## Background jobs and AI context

A job runs with its initiating actor and validated job input. Put durable domain references in that input; read current authorized data with `ctx.read`, write using `ctx.mutate`, and perform external steps through `ctx.step`. Do not capture a synchronous database context for use after the initiating mutation has returned. Jobs do not inherit a live browser request, its headers, or its component state.

For an AI agent, the application constructs `ai.run(ctx, { system, messages, tools, ... })`. Conversation history, retrieval results and domain instructions are application-owned: Workcore does not automatically assemble every database row or conversation into a prompt. Read bounded authorized data before constructing messages, allowlist checked tools, and keep secrets out of prompts. See [AI agents](./ai#checked-mutations-and-read-tools) and [execution](./execution).

Tool availability and prompt instructions do not grant permissions. Checked tools still run under the actor's current application policy; external tools are trusted application code responsible for their own access checks.
