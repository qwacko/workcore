# Workspace application runtime — implementation brief

Proposed API and first-release scope · 10 October 2026

## Intent

Build a small TypeScript library connecting infrastructure to users and, later, agents. Define an operation once and reuse its validation, permissions, live updates, generated UI and background execution.

The central concept is a **workspace**: a personal or shared scope with an execution context. The framework supplies common services; the application supplies databases, repositories and external functions. It does not own the domain schema or require a particular database.

An agent is another authorised caller of operations. Design for that from the start, but deliver a useful runtime and generic UI before implementing agents.

## First-release experience

The developer defines an application, configures adapters and a context factory, mounts an HTTP handler and starts a worker. A generic console then lets an authorised user:

- Select a workspace and browse its queries.
- View a live paginated table or JSON result, with filters and named presentation variants.
- Edit a row through its linked mutation or open a standalone mutation form.
- Launch tasks, inspect progress/results/errors and manage schedules.
- Inspect workspace operation history.

The developer can build a custom frontend using the same typed client. Start with one Svelte console; keep the runtime and client framework-independent.

## 1. Define the application

Illustrative TypeScript: refine exact syntax with the coding agent, retaining these boundaries. Schema names below represent application-defined validation schemas, with inferred input/output types.

```ts
type TrackerContext = {
  activities: ActivityRepository;
  garmin: GarminClient;
};

const tracker = defineWorkspace<TrackerContext>({
  id: 'tracker',

  queries: {
    activities: tableQuery({
      input: activityListInput,
      output: activityPageSchema,
      permission: 'activities.read',
      api: true,
      ui: {
        default: 'basic',
        variants: {
          basic: {
            title: 'Activities',
            renderer: 'table',
            rowKey: 'id',
            columns: ['title', 'status'],
            actions: [{
              label: 'Edit',
              mutation: 'editActivity',
              variant: 'basic',
              bind: { id: { fromRow: 'id' } },
            }],
          },
          compact: {
            title: 'Recent activities',
            subtitle: 'Your latest updates',
            renderer: 'table',
            rowKey: 'id',
            columns: ['title'],
          },
          dataOnly: { title: 'Activity data', renderer: 'json' },
        },
      },
      handler: ({ ctx, input }) => ctx.app.activities.list(input),
    }),
  },

  mutations: {
    editActivity: mutation({
      input: editActivitySchema,
      output: activitySchema,
      permission: 'activities.write',
      api: true,
      ui: {
        default: 'basic',
        variants: {
          basic: { title: 'Edit activity', renderer: 'form' },
        },
      },
      handler: ({ ctx, input }) => ctx.app.activities.update(input),
      // Runtime emits mutation.succeeded automatically.
    }),
  },

  tasks: {
    refreshSummary: task({
      input: emptyObjectSchema,
      output: summarySchema,
      permission: 'summary.refresh',
      api: true,
      triggers: {
        mutations: ['editActivity'],
      },
      retry: { attempts: 3 },
      handler: async ({ ctx, operations }) => {
        const activities = await operations.query('activities', { limit: 100 });
        const summary = summarise(activities.rows);
        await ctx.services.kv.set('summary', summary);
        return summary;
      },
    }),
  },
});
```

| Operation | Meaning | Execution |
| --- | --- | --- |
| Query | Read data without changing state | Returns validated data; supports live subscriptions |
| Mutation | Change application state | Returns validated data; runtime emits a success event |
| Task | Background or external work | Enqueues a run; supports retries and history |

All operations are internal by default. `api: true` explicitly enables external calls, subject to permission checks. UI metadata does not grant access. Internal `operations.query`, `operations.mutate` and `operations.enqueue` use the same checked execution path; never call another operation's handler directly. Future agent-tool exposure is a separate setting.

Queries must remain read-only, including when rerun automatically. A mutation does not imply a framework-managed transaction. A task changing domain data should call mutations so normal invalidation occurs; successful task completion also invalidates workspace live queries, covering task-written KV data.

## 2. Configure infrastructure and application context

```ts
const platform = createPlatform({
  applications: [tracker],
  auth: betterAuthAdapter(auth),
  authorise,

  services: {
    workspaces: postgresWorkspaces(pool),
    events: redisEvents(redis),
    kv: postgresKV(pool),
    tasks: bullmqTasks({ queue, runs: postgresTaskRuns(pool) }),
    schedules: bullmqSchedules({ queue, store: postgresSchedules(pool) }),
    logger,
    operationHistory: postgresOperationHistory(pool),
  },

  createAppContext: async ({ scope, actor }) => ({
    activities: scopedActivityRepository(pool, scope, actor),
    garmin: garminClient,
    // Additional databases, external functions or repositories fit here.
  }),
});

export const handle = platform.httpHandler(); // Request -> Promise<Response>
// Start platform.worker() in the background worker process.
```

Mount the handler in SvelteKit; keep mounting thin enough for Hono or other servers. Reuse existing oRPC, Better Auth, Redis and BullMQ integrations where practical. These are reference implementations, not core dependencies.

Every operation receives:

```ts
type ExecutionContext<AppContext> = {
  scope: { applicationId: string; workspaceId: string };
  actor: Actor;
  correlationId: string;
  signal: AbortSignal;
  services: ScopedServices;
  app: AppContext;
};
```

`services` implements framework-defined capabilities; `app` has the application-defined, inferred type. Neither is sent to the browser or stored in queue payloads. Workers reconstruct contexts using scope and actor identifiers.

A workspace is a logical identity, not a permanently running instance or an automatic concurrency lock. Reuse shared pools/clients; create lightweight scoped wrappers per execution. The runtime owns context creation, cleanup and cancellation. Application dependencies must enforce their own workspace scoping; passing a raw database does not automatically isolate it.

## 3. Framework services

Keep these interfaces small and implement only what the first example uses.

| Service | Responsibilities |
| --- | --- |
| Workspaces/access | Resolve workspace identity and lifecycle, discover accessible workspaces, verify membership |
| Events | Scoped typed emit/subscribe, event envelope, unsubscribe and connection lifecycle |
| KV | Scoped JSON get/set/delete; documented limits |
| Tasks | Enqueue registered task, inspect run/history/progress, retries and worker execution |
| Schedules | Scoped one-off/recurring task schedules; create/list/update/remove and enable/disable |
| Logger | Structured diagnostics with scope, actor and correlation |
| Operation history | Store/retrieve safe execution summaries for the console |

Adapters can implement several services, but BullMQ is not implicitly a KV store or history database. Diagnostic logs and queryable execution history remain separate. State each adapter's delivery and durability guarantees; core must not assume all adapters behave identically.

## 4. Automatic events, live queries and task triggers

The runtime performs a mutation as follows:

1. Authenticate/authorise and validate input.
2. Construct context and execute the handler.
3. Validate its result.
4. Emit scoped `mutation.succeeded`, record the outcome and return the result.

The event envelope contains an event ID, application/workspace IDs, mutation key, execution ID, actor, correlation and causation. Do not broadcast full inputs/results by default.

**Initially, every successful mutation invalidates all live queries in its workspace.** No manual emit or dependency topics are required. Coalesce bursts and rerun active queries using their existing inputs. Successful tasks also emit `task.succeeded` for workspace invalidation, without making all tasks trigger other tasks automatically.

A task's `triggers.mutations` explicitly selects mutation keys. The runtime listens to those success events and enqueues the task in the same scope. For non-empty task input, require an explicit typed `mapInput(event)` and validate its result; a task with no required input can use `{}`. The initial envelope exposes operation identity/provenance rather than domain payloads, so tasks can query current data. Named domain events and `triggers.events` are later extensions.

Triggered work preserves provenance and rechecks the initiating actor's permissions. A background listener must not receive unrestricted credentials merely because it is internal. Ensure only one logical enqueue per event/task pair across listeners where the adapter supports it; handlers must tolerate queue retries. Carry causation and apply a bounded trigger-depth guard to prevent recursive task/mutation loops.

Live subscriptions return an initial snapshot, update after invalidation and refetch after reconnect. Subscribe before the initial read to avoid missing a change; coalesce events arriving during a read into another read. Prevent stale responses replacing newer ones. Clean up subscriptions on disconnect/logout/workspace switch, and recheck access during refetch. Use a bounded periodic refresh to recover from missed transient events.

In v1, writing domain data and publishing the success event are separate actions. Publication failure must be recorded distinctly from handler failure: do not report that a committed mutation rolled back or automatically rerun it. Surface the delivery problem and let live refresh repair displays. Tasks triggered by a missed event are not guaranteed to execute. Durable write/event coordination is a later extension, not a first-release promise.

## 5. Typed client and UI metadata

```ts
const client = createClient<typeof tracker>({ transport, workspaceId });

const page = await client.query('activities', { limit: 25 });
await client.mutate('editActivity', { id: 'a1', title: 'Morning run' });
const { runId } = await client.enqueue('refreshSummary', {});

const unsubscribe = client.subscribe('activities', { limit: 25 }, {
  onData: page => render(page),
  onError: error => showError(error),
});

// Generic renderer configuration:
const presentation = { query: 'activities', variant: 'compact' };
```

Infer client input/output types from definitions without bundling server implementations. Cache by application, workspace, session, operation and input; clear it when identity/scope changes. UI variants share the same data/cache and do not alter operation semantics.

Use these initial result/presentation contracts:

```ts
type Page<Row> = {
  rows: Row[];
  nextCursor: string | null;
  totalCount?: number;
};
```

- `query`: validated JSON result with a structured JSON viewer.
- `tableQuery`: `Page<Row>` with declared row key, columns and optional row actions. Input defines bounded limit, cursor and supported filters/sort.
- Mutation/task forms: generated from input schemas, with validation and pending/result/error states.

Named `ui.variants` can change title, subtitle, renderer, columns, help text and form layout. Omitting a selection uses `ui.default`; an unknown named variant is an error. A row action explicitly references a mutation, optional variant and bindings. Prefill only declared fields; use an explicit detail query when more edit data is needed. Required form fields must be collectable or supplied by validated bindings.

Validate schemas, operation/action references, defaults, variants, renderer compatibility and trigger references at startup. Unsupported form shapes can use a validated JSON editor. Hiding a column or action is cosmetic: enforce data access and permissions server-side. More substantially different data needs another query; composition of several operations belongs in future views.

The authorised manifest contains serialisable schemas, presentation variants and action metadata, with a protocol version. It excludes handlers, secrets and internal-only operations. The console uses it rather than hardcoded application forms. Calls still enforce permissions even if a client ignores the manifest.

## 6. First-pass implementation and completion checks

Build in this order:

1. **Runtime example:** definitions, scoped context factory, auth/access checks, query/mutation execution, typed client and HTTP handler. Prove two isolated workspaces and a shared workspace.
2. **Live/background functionality:** automatic success events, live refetch, task triggers, worker/retries, persistent task history and one-off/recurring schedules. Define timezone, overlap and missed-run behaviour; use explicit timezone, no overlap and skip missed recurring runs initially.
3. **Generic console:** table/JSON viewers, named variants, row edit and standalone forms, task/schedule/history screens. No tracker-specific UI code in the console.
4. **Reuse check:** a second small application with a differently shaped context using the same runtime/client/console. Provide local setup and an executable authoring example.

Done means a user can edit a row, see another connected client update, observe a triggered task, launch/schedule a task and inspect history. Another workspace cannot see or operate on that data. The example survives normal app/worker restarts using the chosen adapters.

Focus verification on isolation/permission checks, context cleanup, invalidation races/reconnect, event publication failure, trigger deduplication/loop protection, worker retries and UI variant selection. Use real infrastructure where its behaviour matters. Document remaining reliability limits rather than building every future extension.

## 7. Roadmap stubs

- **Agents:** named definitions, permitted operation tools, instructions, execution budgets and termination. Reuse checked operation execution.
- **Chat/history:** conversations, messages, streaming and agent/tool traces through a dedicated history adapter.
- **Selective invalidation/domain events:** declared query dependencies and typed task event triggers.
- **Transactions/outbox:** optional coordination of application writes, participating KV/events/task launches; durable delivery and recovery.
- **Views:** compose queries, mutations and named variants; custom components and validated declarative views.
- **Charts/links:** additional presentation contracts and navigation targets.
- **Cross-workspace events:** explicit trusted routing, consumer permissions and provenance.
- **Notifications:** inbox/preferences and delivery adapters.
- **MCP/other clients:** explicitly exposed operations, authenticated scope; additional frontend integrations.
- **Exports/backups/admin:** workspace export/restore, instrumentation and separate platform administration.

Flesh these out with the coding agent after the first useful release. Do not implement placeholder systems for them now.

## Coding-agent handoff

Implement the first-pass scope above. Inspect the existing repository and reuse its infrastructure. Treat examples as proposed public contracts and keep them executable as the API settles. Core depends on service interfaces and a typed application context, not a specific database or queue. The runtime automatically emits success events; handlers should not need invalidation plumbing. Start with a complete example, then the generic console and reuse check. Keep transactions/outbox, agents and custom views as roadmap notes. Deliver setup instructions, focused verification and a concise account of actual limitations.
