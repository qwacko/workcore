# Authoring operations

Define queries, mutations, and tasks together. Schemas drive inferred handler/client types and server validation; `api: true` opts an operation into external calls. UI metadata is presentation only and never grants access.

```ts
import { defineWorkspace } from '@workcore/core';
import { z } from 'zod';

type AppContext = { activities: {
  list(scope: { applicationId: string; workspaceId: string }, input: { limit: number }): Promise<{ rows: Array<{ id: string; title: string }>; nextCursor: null }>;
} };

export const tracker = defineWorkspace<AppContext>()({
  id: 'tracker',
  queries: {
    activities: {
      input: z.object({ limit: z.number().int().min(1).max(100) }),
      output: z.object({ rows: z.array(z.object({ id: z.string(), title: z.string() })), nextCursor: z.null() }),
      permission: 'activities.read',
      api: true,
      handler: ({ ctx, input }) => ctx.app.activities.list(ctx.scope, input),
    },
  },
});
```

Register the definition with the host's trusted authentication and context factory, then mount `platform.httpHandler()` in the host. The [tracker example](https://github.com/qwacko/workcore/tree/main/examples/tracker/src) contains a complete query/mutation/task catalog, authorization context, and typed client use.

## Prefill a mutation form from a table row

For the prebuilt admin, table variants can declare row actions. `bind` maps mutation input fields to properties returned on the selected row. When the user selects the action, the console opens that mutation's form and fills the bound fields. Here is a complete workspace example:

```ts
type Activity = { id: string; title: string; status: 'planned' | 'complete' };
type ActivityContext = { activities: {
  list(scope: { applicationId: string; workspaceId: string }, input: { limit: number }): Promise<{ rows: Activity[]; nextCursor: string | null }>;
  update(scope: { applicationId: string; workspaceId: string }, input: Activity): Promise<Activity>;
} };
const activitySchema = z.object({ id: z.string(), title: z.string(), status: z.enum(['planned', 'complete']) });

const activitiesWorkspace = defineWorkspace<ActivityContext>()({
  id: 'tracker',
  queries: {
    activities: {
      input: z.object({ limit: z.number().int().min(1).max(100) }),
      output: z.object({
        rows: z.array(activitySchema),
        nextCursor: z.string().nullable(),
      }),
      permission: 'activities.read',
      api: true,
      views: {
        default: 'table',
        variants: {
          table: {
            title: 'Activities',
            renderer: 'table',
            rowKey: 'id',
            columns: ['title', 'status'],
            actions: [{
              label: 'Edit activity',
              mutation: 'updateActivity',
              variant: 'form',
              bind: {
                id: { fromRow: 'id' },
                title: { fromRow: 'title' },
                status: { fromRow: 'status' },
              },
            }],
          },
        },
      },
      handler: ({ ctx, input }) => ctx.app.activities.list(ctx.scope, input),
    },
  },
  mutations: {
    updateActivity: {
      input: activitySchema,
      output: activitySchema,
      permission: 'activities.write',
      api: true,
      views: { default: 'form', variants: { form: { title: 'Edit activity', renderer: 'form' } } },
      handler: ({ ctx, input }) => ctx.app.activities.update(ctx.scope, input),
    },
  },
});
```

The binding is explicit: the selected row must contain each `fromRow` property, and only listed values are copied into the mutation input. Bind every required field whose current value should be preserved; any unbound required field is initialized from its schema default (or the generated form's fallback). The operation input schema still validates the submitted values, and the mutation's permission is checked normally. Binding keys are type-checked against the declared mutation input; registration validates that each source field exists in the table query's output.

This is an in-console action, not a separate detail-page route or bookmarkable form URL. For custom frontends, use the row data to initialize your own mutation form and call the same typed mutation/API. See the identity example's name and role actions for a runnable case.

## Operation guidance

- Queries should be read-only; live clients may refetch them automatically.
- Mutations are not automatically transactional. A timeout or output-validation error can occur after side effects; it does not mean rollback.
- Tasks are queued and may execute more than once after recovery. Make side effects idempotent where practical.
- Permissions default to deny. Check workspace access independently, and use `api: true` only for intended external operations.
- Generated manifests/forms need Standard JSON Schema in addition to Standard Schema validation. Unsupported shapes use the JSON editor.

## Configurable admin pages

`admin` on a workspace definition configures navigation and pages using the same semantic block contract as built-in pages. Built-in pages remain enabled by default and can be hidden with `builtins`; their API endpoints still enforce their own capabilities. Custom pages are compositions of existing authorized operations and allow-listed built-in resources—there is no HTML, script, or arbitrary renderer extension point.

The built-in **Agent runs** page is shown when agent-run storage is configured and the actor has `workcore.agents.runs.read`. By default, actors see only their own runs; workspace-wide filtering requires `workcore.agents.runs.read.all`. Trace content is separately filtered by the messages, tool, tool-payload, and results capabilities.

Queries may opt into the admin's chat renderer. Conversation persistence remains application-owned: the query returns canonical `{ conversation, items, nextCursor }` results (optionally with `activeRuns`), and the send mutation persists/enqueues the user message and returns an identifier for a newly-created conversation. The query stays read-only; sending is a separate mutation. The composer can bind its message, optional conversation ID, and explicitly configured additional inputs.

```ts
views: {
  default: 'chat',
  variants: {
    chat: {
      title: 'Assistant',
      renderer: 'chat',
      chat: {
        sendMutation: 'sendMessage',
        messageInput: 'message',
        conversationIdInput: 'conversationId',
        conversationQueryInput: 'conversationId',
        conversationIdPath: 'conversation.id',
        conversationIdResultPath: 'conversationId',
      },
    },
  },
}
```

The mutation's authorization is checked normally and its chat metadata is omitted from the manifest when the actor cannot use that mutation; the transcript remains read-only in that case. The admin refreshes the query on normal Workcore invalidations rather than streaming model output.

Chat messages may include `navigation` content parts to open a visible semantic page and set its declared page state. The admin validates the target and select values against the current manifest before applying state and navigating. External links remain URL links and are limited to safe schemes.

```ts
const workspace = defineWorkspace<AppContext>()({
  id: 'tracker',
  admin: {
    defaultPage: 'overview',
    builtins: { schedules: false },
    pages: {
      overview: {
        title: 'Activity overview',
        description: 'A compact view of current activity.',
        layout: 'two-column',
        blocks: [
          { id: 'recent', type: 'query', operation: 'activities', variant: 'basic', input: { limit: 10 } },
          { id: 'create', type: 'mutation-form', operation: 'createActivity', title: 'Add activity' },
        ],
      },
    },
  },
  // Declare queries, mutations and tasks in this same workspace definition.
});
```

Supported blocks are `query`, `mutation-form`, `task-launcher`, `resource` (`tasks`, `schedules`, `history`, or `agents`), versioned `custom` component descriptors, and the paired `operationCatalog`/`operationExecutor` helpers. A custom descriptor names a component such as `tracker/activity-chart`, a positive version, and optional JSON props; the shipped admin renders a safe placeholder because custom implementation code must be supplied by a renderer. It never loads component code from the manifest. Query blocks call the existing query endpoint and validate through its ordinary schema/permission boundary. A page may declare labelled text state or an enum-backed select state, and a query block may bind a string input to that state with `inputBindings`; changing the control reruns only dependent queries. Select options are checked against the target input enum, and an empty option omits an optional input. State belongs to the page instance and is not shared across pages. Resource blocks use fixed task-run, schedule, history, or agent-run adapters. Task, history, and schedule resources use the common resource lifecycle and collection presentation; agent resources also expose run selection and authorized trace details. Schedule blocks expose create/edit/enable/remove actions only when the actor has schedule-management capability, with all actions rechecked by the server. References and operation/resource visibility are checked when building the workspace manifest. A collection remains readable when its editor mutation is hidden, and the editor descriptor itself is removed. This is navigation filtering, not a replacement for server authorization.

Mutation-form blocks render schema-driven inputs and submit through the ordinary authorized mutation endpoint; successful mutations refresh the page's query sources rather than sending the user to the Operations console.

`layout` accepts `stacked`, `two-column`, or `overview` (two-column). The beta admin contract is manifest protocol v2: pages and operation presentations are delivered only through the semantic `interface` document. Protocol-v1 manifest pages and operation `ui` metadata are no longer emitted or accepted by the v2 admin client. Operation execution endpoints, schemas, permission checks, and codecs are unchanged.

For typed cross-operation page composition, `admin` may instead be a synchronous authoring callback. It runs once during `defineWorkspace`, receives catalog-derived query/mutation/task handles plus `ui.page`, and returns the same configuration shape. Query handles create symbolic named-view blocks; they do not execute the query during definition. `ui.operationCatalog` and `ui.operationExecutor` create a checked pair of blocks over the actor-filtered operation catalog; the built-in Operations page is generated from these same blocks. Object-style `admin` remains supported. Queries and mutations declare named renderer variants in `views`; compatible paginated API queries without authored views receive one schema-inferred default table or JSON view. Query charts can declare `renderer: 'chart'` with `chart: { xField, yField, seriesField? }`; the query returns rows, and y values must be numeric. When variants are authored, only those variants are exposed in `interface.operationViews`, and each query variant may own its collection behavior. Operation presentation authoring uses `views`; no legacy `ui` property is accepted or serialized. Literal variant-key inference, typed operation-instance parameters, cross-query view composition, and per-instance scoped references are not yet implemented.

Query views may declare collection behavior on a named operation variant. It provides schema-checked field paths, typed-by-schema filter presets, stable row identity, per-view title/subtitle fields and display hints, an optional mapped editor, and named mutation actions. Column and identity fields accept safe dot-separated object paths and numeric array indices such as `customer.name` or `items.0.sku`. An action opens the mutation's normal generated form. Explicit `bind` mappings win; otherwise matching top-level row fields are prefilled only when their runtime values match the mutation input schema. The mutation schema remains authoritative. For example:

```ts
queries: {
  activities: {
    views: {
      default: 'manage',
      variants: {
        manage: {
          title: 'Activities', renderer: 'table', rowKey: 'id', columns: ['title', 'status', 'updatedAt'],
          collection: {
            itemKey: 'id', titleField: 'title', subtitleField: 'status',
            columns: [
              { field: 'title', editable: true, filter: { type: 'text', targetParam: 'search' } },
              { field: 'status', display: 'badge', editable: true, filter: { type: 'select' } },
              { field: 'updatedAt', display: 'datetime', editable: false },
            ],
            actions: [{ label: 'Edit activity', mutation: 'editActivity', bind: { id: { fromRow: 'id' } } }],
            editor: { mutation: 'editActivity', variant: 'basic', identity: { rowField: 'id', targetInput: 'id' } },
          },
        },
      },
    },
  },
},
// In an admin callback: queries.activities.view('manage', { id: 'activities', input: { limit: 10 } })
```

API queries with either cursor pagination (`limit`/`cursor`, `{ rows, nextCursor }`) or offset pagination (`limit`/`offset`, `{ rows, totalCount }`), bounded limits, and an `id` field on each row receive one inferred table view when `views` is omitted. Primitive row fields and compatible optional same-name text/enum filters are derived from Standard JSON Schema. The inferred collection records its pagination mode so the admin provides cursor history or page-number navigation as appropriate. Other API queries receive one JSON view. Explicit variants replace rather than augment inferred variants.

The `@workcore/schema-zod` package provides one-call `cursorTableZodQuery` and `offsetTableZodQuery` helpers. Define the base filter and row schemas, then the helper adds pagination schemas and contextually types the handler:

```ts
const activityFilters = z.object({ status: z.enum(['open', 'done']).optional() });
const activityRow = z.object({ id: z.string(), title: z.string(), status: z.enum(['open', 'done']) });

const listActivities = offsetTableZodQuery<AppContext, typeof activityFilters.shape, typeof activityRow>({
  input: activityFilters,
  row: activityRow,
  api: true,
  handler: ({ input }) => activities.list({ status: input.status, limit: input.limit, offset: input.offset }),
});
```

The cursor helper returns `limit` and optional `cursor` inputs with `{ rows, nextCursor }`; the offset helper returns `limit` and `offset` inputs with `{ rows, totalCount }`. Both reserve their pagination field names, apply a bounded default limit, and leave filtering and data access to the handler. For non-Zod validators, use the validator-agnostic `cursorTableQuery` / `offsetTableQuery` together with the input and output schemas you provide. The lower-level `cursorTableSchemaHelper` and `offsetTableSchemaHelper` are also available for composing schemas separately.

The admin currently renders query-view collections as tables on wider screens and as labelled, actionable cards on narrow screens. Cards use the declared title/subtitle fields when provided. Both presentations use the same query result, item identity, filter and editor lifecycle; the responsive layout does not introduce a second source or duplicate mutation behavior. Refreshes preserve dirty drafts and mark newer row data as available. Changing a collection filter, page, or navigating away confirms before discarding a dirty draft, while an access-denied query clears its protected result and editor state.

Each custom-page query block has an independent query source. Its lifecycle distinguishes idle, initial loading, background refresh, ready, and error; forbidden failures are identified separately. Results remain available during same-source refreshes and ordinary request failures, but access loss clears protected results. Changing workspace or page disposes sources and clears their data. Page-owned text and enum-select state can bind into query inputs; explicit cross-block source sharing and result-to-input bindings are not supported.

Define the collection directly on a named query view variant, then reference that variant from the page query block:

```ts
queries: {
  activities: {
    // input/output/api/handler omitted
    views: {
      default: 'manage',
      variants: {
        manage: { title: 'Activities', renderer: 'table', rowKey: 'id', columns: ['title'], collection: {
          itemKey: 'id', columns: [{ field: 'title', editable: true }],
          editor: { mutation: 'editActivity' },
        } },
      },
    },
  },
},
// In admin callback: queries.activities.view('manage', { id: 'activities', input: { limit: 10 } })
```

Filter targets, editor input mappings, state declarations, and state-to-query bindings are checked against the corresponding JSON Schemas at definition time. Empty optional filters are omitted and filter changes reset cursor history. The tracker demonstrates page-owned search and enum-select state feeding the activities query on **Activity search**, plus an application-authored history-resource page. The default Operations page is generated from the reusable operation catalog/executor pair; Task runs, Schedules, History, and Agent runs are compiled from resource blocks, which can also be used in application pages under the same capability rules. Still unsupported are sorting, compile-time literal operation-view variant inference, operation-view instance parameters/cross-query composition, nested scoped state, explicitly shared query sources, and custom resource actions beyond the built-in schedule management contract. HTML/template renderers and Alpine-style behavior are future directions, not part of the current view contract.

See [architecture and security](/architecture) for execution contracts and [production deployment](/production-deployment) for PostgreSQL/Redis composition.

For authentication integrations, see [Better Auth and identity management](/authentication).
