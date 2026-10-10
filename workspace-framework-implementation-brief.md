# Workcore — workspace application runtime implementation brief

Proposed API and first-release scope · 10 October 2026

## Intent

Build **Workcore**, a small TypeScript library connecting infrastructure to users and, later, agents. Its primary audience is its author's own projects: make it quick to spin up full-stack applications with little application-specific code and clear, executable patterns an AI coding agent can follow. Define an operation once and reuse its validation, permissions, live updates, generated UI and background execution.

The central concept is a **workspace**: a personal or shared scope with an execution context. The framework supplies common services; the application supplies databases, repositories and external functions. It does not own the domain schema or require a particular database.

Distinguish a **workspace definition** (reusable operations and configuration) from a **workspace instance** (a particular personal/shared data and access scope). `applicationId` identifies the registered definition; `workspaceId` identifies an instance under that definition. Framework storage and routing use both IDs. The `tracker` name below is only an exercise-tracker example, not a special framework concept. Cross-definition sharing of workspace identity is not a v1 requirement.

An agent is another authorised caller of operations. Design for that from the start, but deliver a useful runtime and generic UI before implementing agents.

## First-release experience

The developer defines an application, configures adapters and a context factory, mounts an HTTP handler and starts a worker. A generic console then lets an authorised user:

- Select a workspace and browse its queries.
- View a live paginated table or JSON result, with filters and named presentation variants.
- Edit a row through its linked mutation or open a standalone mutation form.
- Launch tasks, inspect progress/results/errors and manage schedules.
- Inspect workspace operation history.

The developer can build a custom frontend using the same typed client. The supplied admin UI (also called the console) is optional, prebuilt and mountable on a route: consumers do not need to build a frontend or adopt its implementation framework. Start with a small Svelte + Vite browser application, without requiring SvelteKit. Keep the runtime, client and demo hosts framework-independent where practical.

## 1. Define the application

Illustrative TypeScript: refine exact syntax with the coding agent, retaining these boundaries. Schema names below represent application-defined validation schemas, with inferred input/output types.

Use a curried builder so the application context type can be supplied while operation definitions remain inferred. Before implementing the runtime, prove handler context types, client inputs/results and checked sibling-operation calls with compile-time tests. Avoid `any`, repeated user-written operation types and unnecessarily complex recursive types. The following syntax is proposed, not an already implemented API.

```ts
type TrackerContext = {
  activities: ActivityRepository;
  garmin: GarminClient;
};

const defineTracker = defineWorkspace<TrackerContext>();

const tracker = defineTracker({
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
      handler: async ({ ctx, operations }) => {
        // Read every page, not just the first 100 rows.
        const activities: Activity[] = [];
        let cursor: string | null = null;
        do {
          const page = await operations.query('activities', {
            limit: 100,
            ...(cursor === null ? {} : { cursor }),
          });
          activities.push(...page.rows);
          cursor = page.nextCursor;
        } while (cursor !== null);
        const summary = summarise(activities);
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
| Task | Background or external work | Enqueues a run; supports progress, results and history |

All operations are internal by default. `api: true` explicitly enables external calls, subject to permission checks. UI metadata does not grant access. Internal `operations.query`, `operations.mutate` and `operations.enqueue` use the same checked execution path; never call another operation's handler directly. Future agent-tool exposure is a separate setting.

Queries must remain read-only, including when rerun automatically. A mutation does not imply a framework-managed transaction. A task changing domain data should call mutations so normal invalidation occurs; successful task completion also invalidates workspace live queries, covering task-written KV data.

### Schema contracts

Core accepts **Standard Schema** for validation and inferred input/output types, rather than depending on a particular validation library. Examples may use Zod. Handle asynchronous validation and preserve the distinction between a schema's accepted input and validated/transformed output.

Generated UI additionally requires a JSON Schema representation, provided through **Standard JSON Schema** or an explicitly supplied conversion. Standard Schema validation alone does not provide form metadata. Choose and document one JSON Schema target for the versioned manifest; distinguish input representations for forms from output representations for results. See [Standard Schema](https://standardschema.dev/) and [Standard JSON Schema](https://standardschema.dev/json-schema).

Initially support object forms with strings, numbers, booleans, enums, optional fields and defaults, plus straightforward arrays/nested objects where practical. Representable but unsupported form shapes fall back to a validated JSON editor. Missing/failed schema conversion is a clear startup error for operations requiring generated UI; do not silently invent an inaccurate schema. Server validation remains authoritative for refinements/transforms and any constraints not faithfully represented in JSON Schema.

## 2. Configure infrastructure and application context

```ts
const platform = createPlatform({
  applications: [{
    definition: tracker,
    createAppContext: async ({ scope, actor }) => ({
      activities: scopedActivityRepository(pool, scope, actor),
      garmin: garminClient,
      // Additional databases, external functions or repositories fit here.
    }),
  }],
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
});

export const handle = platform.httpHandler({
  apiBasePath: '/workcore/api',
  // Optional mounting configuration supplied by the installed admin package.
  admin: { basePath: '/workcore/admin' },
}); // Request -> Promise<Response>
// Start platform.worker() in the background worker process.
```

Mount the handler in a host such as Hono, SvelteKit or another server with a thin Request/Response integration. The host serves requests and authenticates users; Workcore does not require its own web server. oRPC may be an implementation choice, not the core operation model. Better Auth, Redis and BullMQ integrations are reference implementations, not core dependencies. Associate each registered definition with its own typed context factory so multiple definitions can have differently shaped contexts. Exact registration and admin-mounting syntax must be verified during implementation.

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

### Authentication and authorisation

Keep identity separate from capability resolution. The minimum actor contract is `{ id: string }`; applications can extend it. Authentication resolves an actor from trusted server-side credentials, never from caller-supplied actor fields. Authorisation resolves current capabilities and membership in the selected scope. Do not require a capability snapshot on the actor or store one as the authority for queued work.

Support ergonomic operation policies, with exact callback syntax refined in the prototype:

```ts
permission: 'activities.read'

// All listed capabilities are required; do not leave array semantics ambiguous.
permission: ['activities.read', 'reports.read']

// Illustrative application-specific, asynchronous ownership check.
permission: async ({ actor, scope, input, access }) =>
  await access.has('activities.write') ||
  await access.ownsActivity(input.id, actor.id)
```

Default deny. Always check workspace access independently of the operation policy. Permission callbacks receive validated, typed input and trusted server-side access dependencies. Authentication and workspace-access checks precede expensive application work; input-dependent authorisation follows input validation and precedes the handler. Do not give permission callbacks unrestricted credentials by accident.

The authorised manifest may advertise an operation whose input-dependent permission must still be evaluated per invocation. It must not imply that every input is authorised. Calls always enforce permissions even if a client ignores the manifest.

Re-resolve the actor and recheck current membership/permissions when queued or scheduled work executes. Recurring schedules execute under the identity that created them in v1; editing a schedule does not silently transfer that identity. If execution access is revoked, do not run the task and record the access failure. Define separate capability checks for listing task/history data, launching tasks and managing schedules, rather than exposing infrastructure management to every workspace member.

Create initial workspaces and memberships through seed scripts or application code. Generic invitations and membership-management UI are outside v1.

## 3. Framework services

Keep these interfaces small and implement only what the first example uses.

| Service | Responsibilities |
| --- | --- |
| Workspaces/access | Resolve workspace identity and lifecycle, discover accessible workspaces, verify membership |
| Events | Scoped typed emit/subscribe, event envelope, unsubscribe and connection lifecycle |
| KV | Scoped JSON get/set/delete; documented limits |
| Tasks | Enqueue registered task, inspect run/history/progress, record results/errors and worker execution |
| Schedules | Scoped one-off/recurring task schedules; create/list/update/remove and enable/disable |
| Logger | Structured diagnostics with scope, actor and correlation |
| Operation history | Store/retrieve safe execution summaries for the console |

Adapters can implement several services, but BullMQ is not implicitly a KV store or history database. Diagnostic logs and queryable execution history remain separate. State each adapter's delivery and durability guarantees; core must not assume all adapters behave identically.

### Tasks and schedules in v1

Defer configurable automatic retries and backoff. A failed run remains inspectable; a user can explicitly launch a new run through normal permission checks. Queue recovery after a crash may still execute work more than once: removing retry configuration does not promise exactly-once execution, and handlers must tolerate repeated side effects where necessary.

Define run states and legal transitions, progress reporting, cancellation/timeouts and worker shutdown behaviour before implementing the task adapter. Queue payloads contain validated serialisable task input and scope/actor/provenance identifiers, never live contexts or credentials.

Schedules support one-off and recurring execution with explicit timezone and skip missed recurring occurrences. **No overlap is per schedule**: if its previous run is queued or running, skip the next occurrence and record the reason. Enforce this across processes through the adapter, not only an in-process flag. This is not a workspace lock and does not prevent manually launched runs or other schedules from executing concurrently.

### Safe history

Operation history defaults to metadata: operation/scope identifiers, execution/provenance IDs, actor ID, timing, status and sanitised errors. Do not store full inputs/results by default or leak stack traces and secrets to the console. Persistent task inputs/results require explicit retention, size and redaction policies; task input storage needed for queue execution is distinct from retaining input in queryable history. Define workspace-scoped access checks for results and history. Diagnostic logs and history storage remain separate.

## 4. Automatic events, live queries and task triggers

The runtime performs a mutation as follows:

1. Authenticate and check workspace access, validate input, then authorise the operation (including input-dependent policies).
2. Construct context and execute the handler.
3. Validate its result.
4. Emit scoped `mutation.succeeded`, record the outcome and return the result.

The event envelope contains an event ID, application/workspace IDs, mutation key, execution ID, actor, correlation and causation. Do not broadcast full inputs/results by default.

**Initially, every successful mutation invalidates all live queries in its workspace.** No manual emit or dependency topics are required. Coalesce bursts and rerun active queries using their existing inputs. Successful tasks also emit `task.succeeded` for workspace invalidation, without making all tasks trigger other tasks automatically.

A task's `triggers.mutations` explicitly selects mutation keys. The runtime listens to those success events and enqueues the task in the same scope. For non-empty task input, require an explicit typed `mapInput(event)` and validate its result; a task with no required input can use `{}`. The initial envelope exposes operation identity/provenance rather than domain payloads, so tasks can query current data. Named domain events and `triggers.events` are later extensions.

Triggered work preserves provenance and rechecks the initiating actor's permissions. A background listener must not receive unrestricted credentials merely because it is internal. Ensure only one logical enqueue per event/task pair across listeners where the adapter supports it; handlers must tolerate queue redelivery/recovery. Carry causation and apply a bounded trigger-depth guard to prevent recursive task/mutation loops.

Live subscriptions return an initial snapshot, update after invalidation and refetch after reconnect. Subscribe before the initial read to avoid missing a change; coalesce events arriving during a read into another read. Prevent stale responses replacing newer ones. Clean up subscriptions on disconnect/logout/workspace switch, and recheck access during refetch. Use a bounded periodic refresh to recover from missed transient events.

In v1, writing domain data and publishing the success event are separate actions. Publication failure must be recorded distinctly from handler failure: do not report that a committed mutation rolled back or automatically rerun it. Surface the delivery problem and let live refresh repair displays. Tasks triggered by a missed event are not guaranteed to execute. Durable write/event coordination is a later extension, not a first-release promise.

### Side effects and failure outcomes

Framework-managed transactions/unit-of-work remain on the roadmap. Applications may use database transactions inside their handlers, but v1 output validation runs after the handler returns and cannot roll back an already committed transaction. Even a handler error does not prove that no side effects occurred.

Define structured outcomes that distinguish handler failure, invalid output after possible side effects, and successful execution with event/history delivery problems. Do not return invalid output, claim rollback, or automatically retry a mutation. Record post-execution failures where possible; if history persistence also fails, emit structured diagnostics rather than treating the domain write as undone. Periodic live refresh can repair display state but cannot recover missed triggered work. A disconnected caller may not know whether a mutation completed; cancellation signals are cooperative and do not imply rollback.

Later, an optional transaction boundary could include output validation before commit for participating repositories. It must not promise atomicity across external APIs, Redis or queues without a separate durable coordination design.

## 5. Typed client and UI metadata

```ts
const client = createClient<typeof tracker>({
  transport,
  applicationId: 'tracker',
  workspaceId,
});

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

### HTTP and SSE

Start with HTTP operation calls and SSE live subscriptions; other transports are roadmap work. Define the endpoint layout, explicit application/workspace selection, safe structured error codes, protocol version, JSON-compatible wire values, request/result size limits, execution timeouts and reconnect behaviour before implementing transport. Schema transforms must not silently introduce values the wire protocol cannot represent.

Use same-origin cookie authentication for the first browser example and define CSRF/origin handling for state-changing calls. Native browser `EventSource` cannot attach arbitrary authorisation headers; keep the subscription transport replaceable for hosts requiring another authentication mechanism. Recheck access on live reads and bound the lifetime/refresh interval of idle subscriptions so revoked access is not held indefinitely. Serve only authorised result data over SSE, not raw internal event envelopes.

### Optional prebuilt admin UI

Build a small Svelte + Vite client application without requiring SvelteKit. Publish its compiled HTML, JavaScript and CSS in an optional admin package, with a mounting helper for the host's Request/Response handler. Consumers must not need Svelte, frontend compilation or a separate dashboard server just to use the supplied admin. Do not make core depend on the admin package.

The admin uses the same authorised manifest and HTTP/SSE APIs as custom clients. Inject only safe public configuration such as API/base paths; never bundle server handlers, application contexts or secrets. Bundle dependencies locally without requiring a CDN. Support arbitrary mounting paths, base-path-aware asset loading and client navigation, appropriate asset caching and host-compatible content security policy. Authentication remains the host's responsibility.

Svelte is an implementation choice, not a public runtime dependency or architectural constraint. HTMX/Datastar are viable alternatives if server-rendered HTML becomes a deliberate goal, but are not required merely to avoid a consumer build step. Reusable framework-specific components can be a later offering; v1's distribution contract is the prebuilt, route-mounted admin.

## 6. Repository, tooling and distribution

Use a pnpm monorepo with a few meaningful packages rather than one package per service:

```text
packages/
  core/                 # Definitions, checked execution, service interfaces
  client/               # Browser-safe typed client and transport
  admin/                # Admin source, compiled assets and mounting helper
  adapters/             # Separate postgres/redis/bullmq/auth entry points
examples/
  tracker/              # Thin host, domain example and separate worker
  second-app/           # Differently shaped context for the reuse check
tests/
  integration/          # Real PostgreSQL/Redis behaviour
docs/                   # Documentation suitable for a static site
```

Use Workcore as the project/library name; settle exact published package names during scaffolding. Split adapters into separately published packages when dependency isolation or release cycles justify it. Reference infrastructure can use PostgreSQL and Redis/BullMQ, without making them core requirements. Demo hosts should stay thin and framework-neutral where practical, rather than requiring SvelteKit. Local setup must include migrations/seeds, infrastructure startup, app and worker commands.

Prefer TypeScript 7 for core/client and wherever the toolchain supports it. Verify Svelte checking, declaration generation and build compatibility during scaffolding; a compatible separate UI checker is acceptable. Compiler speed must not dictate the UI architecture or block useful implementation. Keep public types straightforward and document/test consumer compiler compatibility.

Establish ESM, explicit package `exports`, declaration output, browser/server import boundaries, a supported Node version and release tooling such as Changesets from the start. Type-only definition imports must not drag server implementations into browser bundles. Consumers of the prebuilt admin do not need its source build dependencies; a future component package would declare appropriate framework peer dependencies.

Publish setup, authoring, adapter, security and actual-reliability documentation, eventually through a static documentation site. Choosing a site generator is not a prerequisite for runtime work. Keep API examples executable/typechecked and favour clear startup errors and concise patterns that an AI coding agent can reliably follow.

## 7. First-pass implementation and completion checks

Build in this order:

1. **Type-inference prototype:** curried definitions, correctly inferred handler contexts and client inputs/results, checked sibling-operation calls and browser-safe type exports. Use compile-time tests before committing to public syntax.
2. **First end-to-end slice:** scoped context factory, auth/access checks, one query and mutation, typed client, HTTP/SSE, authorised manifest and a minimal prebuilt generic table/edit form. Prove two isolated workspaces and a shared workspace, including a second connected browser updating after an edit. Include this small UI early rather than completing all background infrastructure first.
3. **Background functionality:** task triggers, worker execution/progress, persistent task history and one-off/recurring schedules. Use explicit timezone, per-schedule no-overlap and skip missed recurring runs; defer configurable automatic retries.
4. **Complete generic admin:** table/JSON viewers, named variants, row edit and standalone forms, task/schedule/history screens. No tracker-specific UI code in the admin.
5. **Reuse check:** a second small application with a differently shaped context using the same runtime/client/admin. Provide local setup and an executable authoring example.

Done means a user can edit a row, see another connected client update, observe a triggered task, launch/schedule a task and inspect history. Another workspace cannot see or operate on that data. The example survives normal app/worker restarts using the chosen adapters.

Use runtime unit tests, compile-time API tests, adapter contract tests, real-infrastructure integration tests and a small Playwright end-to-end flow. Focus verification on isolation/permission checks (including revoked queued/scheduled access), context cleanup, invalidation races/reconnect, output/event/history failures after side effects, trigger deduplication/loop protection, worker recovery/redelivery, schedule overlap and UI variant selection.

Test packed packages installed into a separate consumer project, not only workspace imports: verify declarations/exports, browser/server boundaries, admin asset inclusion, arbitrary mounting paths and serving without a frontend build. Use real infrastructure where its behaviour matters. Document remaining reliability limits rather than building every future extension.

## 8. Roadmap stubs

- **Agents:** named definitions, permitted operation tools, instructions, execution budgets and termination. Reuse checked operation execution.
- **Chat/history:** conversations, messages, streaming and agent/tool traces through a dedicated history adapter.
- **Selective invalidation/domain events:** declared query dependencies and typed task event triggers.
- **Transactions/unit-of-work/outbox:** optional transaction boundaries including output validation for participating repositories; durable coordination of application writes, participating KV/events/task launches and recovery.
- **Task retries:** configurable attempts/backoff and explicit repeat-side-effect semantics; v1 provides failure inspection and manual new runs only.
- **Workspace management UI:** invitations, membership and access management beyond seeded/application-managed provisioning.
- **Additional transports/UI integrations:** alternatives to HTTP/SSE and optional framework-specific components; consumers need not adopt the admin's implementation framework.
- **Views:** compose queries, mutations and named variants; custom components and validated declarative views.
- **Charts/links:** additional presentation contracts and navigation targets.
- **Cross-workspace events:** explicit trusted routing, consumer permissions and provenance.
- **Notifications:** inbox/preferences and delivery adapters.
- **MCP/other clients:** explicitly exposed operations, authenticated scope; additional frontend integrations.
- **Exports/backups/admin:** workspace export/restore, instrumentation and separate platform administration.

Flesh these out with the coding agent after the first useful release. Do not implement placeholder systems for them now.

## Coding-agent handoff

Implement the first-pass scope above. At the time of this review, the repository contains this brief and a README only; there is no existing runtime or infrastructure to reuse. Inspect it again before making changes and preserve any subsequent user work. Treat examples as proposed public contracts and keep them executable as the API settles. Core depends on Standard Schema, small service interfaces and a typed application context, not a specific database, queue or UI framework. The runtime automatically emits success events; handlers should not need invalidation plumbing. Prove types first, then one complete query/edit/live-update slice with the optional prebuilt admin, background execution and the reuse check. Keep framework-managed transactions/outbox, configurable retries, agents and custom views on the roadmap. Deliver setup instructions, focused verification, installable packages and a concise account of actual limitations.
