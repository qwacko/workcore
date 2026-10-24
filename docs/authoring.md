# Authoring operations

Workcore has three layers:

1. An **application definition** is the reusable operation catalog created with `defineApplication<Context>()({ ... })`. `defineWorkspace` remains a compatible alias.
2. A **registration** binds the definition to trusted host factories with `definition.registerApplication(...)`.
3. A **workspace instance** selects scoped data with `{ applicationId, workspaceId }`. It is not another definition or platform configuration object.

`createPlatform({ applications, auth, services })` combines registrations and infrastructure. The host mounts `platform.httpHandler()`. Start with the [complete minimal integration](/minimal-integration), then use the [configuration reference](/configuration) for every option.

For reusable local catalogs, use [module composition](/composition): `defineModule<Context, Dependencies>()` defines a small module and `composeApplication<Context>()` wires modules through typed, synchronous capabilities and optional callbacks. Existing single-catalog authoring remains unchanged.

## Queries, mutations, and tasks

```ts
import { defineApplication } from '@workcore/core';
import { z } from 'zod';

export const app = defineApplication<{ count: () => number }>()({
  id: 'counter',
  queries: {
    count: {
      input: z.object({}),
      output: z.number(),
      permission: 'counter.read',
      api: true,
      handler: ({ ctx }) => ctx.app.count(),
    },
  },
});
```

- Queries must be read-only: subscriptions can refetch without user action.
- Mutations perform synchronous writes; they are not automatically transactional.
- Tasks use the same `input`, `output`, `permission`, `api`, and `handler` fields, but execute through the worker queue. See [tasks and schedules](/tasks).
- `api: true` opts an operation into HTTP exposure. Typed clients exclude explicitly internal operations; sibling callers retain the entire catalog. If a helper erases `api` to `boolean`, the client cannot prove its exposure statically. Keep literal `api: true`/`false` at the definition boundary for precise typing. Server checks are always authoritative.
- Missing `permission` denies execution. `permission: []` explicitly requires only authenticated workspace access. See [authorization](/authorization).

## Schema transformations

Standard Schema validates both boundaries. Standard JSON Schema is additionally required for exposed operations and agent tools; Zod 4 supplies both. Forms and the manifest use the input schema's **input** JSON Schema and output schema's **output** JSON Schema.

The handler receives the **output** of input validation and returns the **input** of output validation. The client and sibling callers receive the validated output:

```ts
{
  input: z.object({ amount: z.string().transform(Number) }),
  output: z.string().transform(Number).pipe(z.number()),
  handler: ({ input }) => String(input.amount + 1),
}
```

Here the request contains `{ amount: '41' }`, the handler sees `input.amount === 41`, returns `'42'`, and the client receives `42`. The final `.pipe(z.number())` also gives the manifest an explicit numeric output schema rather than an unconstrained transformed shape. Output validation runs once. A mutation that fails output validation may already have changed domain data; failure does not imply rollback. Rich values require a matching [wire codec](/protocol#codecs).

## Context and checked sibling calls

Handlers receive `{ ctx, input, operations }`. `ctx` includes the actor, workspace scope, correlation ID, abort signal, scoped services, and host-created `app` context. Interactive handlers also receive request metadata; never persist or log its credential-bearing headers.

`operations.query`, `mutate`, `enqueue`, and `enqueueAgent` are inferred from the catalog. They reuse validation and authorization rather than bypassing the boundary. Synchronous sibling calls create their own application context; they do not share the caller's transaction automatically. Repositories must scope their own reads/writes using `ctx.scope`.

An application context may implement `dispose(): void | Promise<void>`. Workcore calls it after execution, waits at most five seconds, and logs cleanup failures without replacing the operation result. Timeout abort is cooperative: cleanup can begin while an uncooperative handler is still running. Design resource ownership accordingly. Authentication, authorization, context creation, serialization, and adapter I/O are outside the handler deadline.

## Optional UI and further guides

- [Admin pages, tables, collections, charts, and actions](/admin-pages)
- [Chat contracts and renderers](/chat)
- [Queued agents](/agents)
- [Wire protocol and client diagnostics](/protocol)
- [Production deployment and upgrade safety](/production-deployment)

## Configurable admin pages

The admin guide moved to [Admin pages and views](/admin-pages#configurable-admin-pages). Existing object-style and callback-based configurations remain supported.
