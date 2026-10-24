# Module composition

Use modules to reuse small catalogs inside one application. Keep separate applications when you need separate workspace/access boundaries. Composition is optional: existing `defineApplication`/`defineWorkspace` definitions continue to work unchanged.

Composition adds no new message bus, server, actor ownership, or transaction model. It compiles modules into the existing operation catalog, manifest, typed client, admin UI, and worker runtime.

The main tracker now uses this structure: [`app.ts`](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/app.ts) owns application policy, wiring, and navigation; [`modules/activities.ts`](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/modules/activities.ts) owns activity operations/tasks/views; [`modules/assistant.ts`](https://github.com/qwacko/workcore/blob/main/examples/tracker/src/modules/assistant.ts) owns conversations and Milo. The assistant requires `getActivitySummary`, wired to an internal checked activity query. Activities offers an optional `afterUpdated` callback, wired to an internal assistant mutation that remembers the latest activity update. Identity management remains a separate application and access boundary.

The **Workspace overview** page combines both modules. **Activity search** and **Milo's Campfire** are module-provided pages. Ask Milo “How are my activities looking?” or, after editing an activity, “What changed?” to exercise the same wiring with the offline demo engine.

## Define a local module

```ts
import { defineModule } from '@workcore/core';

type TodoDependencies = {
  getTimezone: () => Promise<string>;
  afterCompleted?: (todo: Todo) => Promise<void>;
};

const todos = defineModule<TodoContext, TodoDependencies>()({
  id: 'todos',
  requires: { getTimezone: true },
  mutations: {
    complete: {
      input: completeInput,
      output: todoSchema,
      permission: 'todos.write',
      api: true,
      handler: async ({ ctx, input, dependencies }) => {
        const todo = await ctx.app.todos.complete(ctx.scope, input.id);
        await dependencies.afterCompleted?.(todo);
        return todo;
      },
    },
  },
});
```

Queries, mutations, tasks, agents, schemas, permissions, versions, and views use the usual contracts. Handlers additionally receive `dependencies`, inferred from the module's explicit contract. Required dependency keys must be declared in `requires`; optional callbacks need not be listed. This small runtime declaration allows missing required wiring to fail at composition time, even for JavaScript consumers. Required resolved values are also checked for presence before the module handler runs. TypeScript checks their types; the runtime does not infer or validate arbitrary function signatures.

Module definitions have no `registerApplication()` method. They must first be mounted into an application. Their `id` describes the reusable catalog; the mount key below determines its operation namespace.

## Wire synchronous capabilities at the application boundary

```ts
import { composeApplication } from '@workcore/core';

const application = composeApplication<AppContext>()({
  id: 'teamspace',
  modules: { todos, calendar, settings },
  dependencies: {
    todos: ({ operations }) => ({
      getTimezone: () => operations.query('settings.timezone', {}),
      afterCompleted: async (todo) => {
        await operations.mutate('calendar.record', {
          title: todo.title,
        });
      },
    }),
  },
});
```

The binding factory receives `{ ctx, operations }` for the **current execution**, not a process-wide captured actor. The global typed caller includes all declared operations, including internal ones. Calls retain the current actor, scope, correlation, cancellation, validation, permission checks, history, and invalidation/trigger behavior. Do not wire raw handlers or repositories when you intend to use this checked boundary.

TypeScript rejects missing required bindings, incorrect callback/result types, unknown target operations, missing target inputs, and a host context that cannot satisfy a module's context requirements. Optional-only dependencies may omit their binding entirely and receive an empty object. Bindings may be async; avoid eager side effects while constructing them. They execute inside the handler deadline. A module agent can resolve bindings separately for its instructions and prompt, so do not assume exactly one resolution per agent run.

For application-specific orchestration, define another small module with explicit capability dependencies and wire them here. This is usually clearer than adding generic lifecycle hooks. Optional callbacks such as `afterCompleted` are ordinary awaited functions invoked by the module at an explicit point, not automatic global hooks.

### Failure and cancellation

The callback above runs **after** the todo write. A callback failure propagates to the containing operation; it does not roll back the todo. Nested operations create their own application contexts, so composition does not automatically share a transaction. A target mutation can succeed and publish its invalidation even if a later step fails. Use a domain transaction/orchestrator with explicit outcomes when stronger coordination is needed. Make retry-sensitive effects idempotent.

If the containing operation fails after writing, it does not emit its own success invalidation; clients recover through normal refresh. If a follow-up is best-effort, explicitly catch/report its failure or return a partial-success result rather than implicitly pretending the write rolled back. Dependency wiring does not automatically detect logical recursion/cycles; return lazy capability functions and keep orchestration finite.

Only awaited work belongs to the operation lifetime. Do not retain dependency functions, request context, or the checked caller for fire-and-forget work. Use tasks for background execution and the existing host event infrastructure for invalidation/asynchronous reactions. Target operations still recheck authorization, including when they are internal and callable only through composition.

## Local names, public names, and services

- Module handlers use **local** calls, such as `operations.query('list', {})` or `operations.enqueueAgent('helper', input)`.
- Application dependency bindings and clients use **qualified** names, such as `todos.list` and `calendar.record`.
- The module mount key supplies the prefix; local operation/module names use letters, digits, `_`, and `-`, starting with a letter. Dots and unsafe prototype names are rejected to avoid ambiguous/colliding namespaces.
- The same module can be mounted more than once under different keys. There are no silent overrides or order-dependent merging rules.
- A host registration supplies one application context type satisfying all modules. This context is still created per execution; modules don't acquire their own in-memory instance lifecycle.
- Scope, actor, abort signal, request metadata, correlation, and progress reporting flow through unchanged.
- KV keys are automatically prefixed with the mount namespace **inside the existing workspace scope**. Two mounts using `'settings'` as a key do not collide. Shared values should have one owner and be accessed through explicit dependencies/queries, not by guessing another module's encoded KV prefix.
- Scoped logs retain the same logger and add authoritative `module` metadata.
- Application-owned repositories are **not** automatically prefixed or isolated. They must still use `ctx.scope` and any domain-specific partition keys. Mount namespaces organise execution and KV; they are not security boundaries.

## Admin, agents, and background work

Modules may contribute local `admin.pages` and operation views. Composition qualifies page IDs, page operation references, row actions, collection editors, chat mutation/query references, mutation triggers, agent tool references, and finish-tool names. Application admin settings own built-in flags and the default page; a module may contribute pages only. Duplicate page contributions are rejected.

```ts
const application = composeApplication<AppContext>()({
  id: 'teamspace',
  modules: { todos, calendar, settings },
  dependencies,
  admin: ({ queries }) => ({
    defaultPage: 'todos.overview',
    pages: {
      home: {
        title: 'Home',
        blocks: [queries['todos.list'].view('json', {
          id: 'todos', input: {},
        })],
      },
    },
  }),
});
```

The admin still consumes the ordinary actor-filtered semantic manifest. Internal operations stay absent from the HTTP client/manifest even when a binding can call them. Module authorization context is not separately configured: supply trusted authorization on the composed application, and retain each operation's own permission policy.

Tasks enqueue qualified operation names and preserve operation versions/codecs. Local trigger input mappers see the original local mutation name while published events/history contain the qualified name. Agents retain local allow-listed tools; cross-module tools can be exposed through a small local mutation/query that calls a declared dependency. Composition does not grant agents unrestricted cross-module access.

Arbitrary domain results are not rewritten. For example, chat message `navigation` or `queryView` parts that reference application pages/operations must contain their composed IDs; supply those through an explicit dependency/configuration contract when reusable modules need them. Custom component identifiers and JSON props remain untouched.

Changing a mount key changes public and persisted operation names. Drain/migrate outstanding tasks/schedules and update client/UI references when renaming a mount; operation `version` alone does not rename queued work. See [upgrade safety](/tasks#persisted-input-versions).

### Upgrading the existing local tracker demo

The tracker intentionally uses new qualified names rather than keeping duplicate unqualified endpoints:

| Previous name | Composed name |
| --- | --- |
| `activities` query | `activities.list` |
| `editActivity` mutation | `activities.edit` |
| `refreshSummary` task | `activities.refreshSummary` |
| `assistantConversation` query | `assistant.conversation` |
| `sendAssistantMessage` mutation | `assistant.sendMessage` |
| `milo` agent | `assistant.milo` |
| `dateRoundTrip`, `dateTimeText`, `richValues` queries | `activities.dateRoundTrip`, `activities.dateTimeText`, `activities.richValues` |

Local task/schedule and agent payload shapes remain compatible. Before creating file adapters or starting the server/worker, the demo applies an idempotent, narrowly scoped migration of known pending tracker task/agent names, active run metadata, schedules, and summary KV. A byte-for-byte `.pre-module-composition-<id>.bak` backup is written before replacement. Run only one demo process and stop old servers/workers first; this is not a cross-process database migration facility. IDs, deduplication markers, reservations, revisions, codecs, inputs, and versions are retained. Terminal run/history/trace records remain unchanged as audit history, and other applications are untouched. The old summary KV key is retained for inspection; an existing new cache is never overwritten.

Unknown/custom operation names are not guessed or migrated. Custom deployments should use their own reviewed drain/migration procedure. SQLite domain/conversation data is unchanged. Existing custom clients must switch to the qualified operation names. Module page IDs are now `activities.search` and `assistant.campfire`; the application-level `activityDashboard`, resource pages, and Operations default remain available.

## Register and call normally

```ts
const registration = application.registerApplication({
  createAppContext: () => ({ todos: todoRepository, calendar: calendarRepository, timezone: 'UTC' }),
  // resolveAuthorization is required if application.authorization is configured.
});
const platform = createPlatform({ applications: [registration], auth, services });

const client = createClient<typeof application>({
  applicationId: application.id, workspaceId: 'one', transport,
});
await client.mutate('todos.complete', { id: 'todo-1' });
```

No HTTP/manifest protocol version change is necessary. The client infers qualified names, schemas, and external exposure from the composed application.

## Complete executable example

This example includes scoped repositories, required settings access, an optional awaited callback, internal calendar mutation authorization, module admin pages, and a real typed HTTP transport. Its execution and negative type cases are verified in the repository.

::: details Full example
<<< ../examples/tracker/src/composed.ts
:::
