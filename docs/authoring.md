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
      ui: {
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
      ui: { default: 'form', variants: { form: { title: 'Edit activity', renderer: 'form' } } },
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

`admin` on a workspace definition configures the prebuilt admin's navigation and custom dashboard pages. Built-in pages remain enabled by default and can be hidden with `builtins`; their API endpoints still enforce their own capabilities. Custom pages are compositions of existing authorized operations and built-in resources—there is no HTML, script, or arbitrary renderer extension point.

The built-in **Agent runs** page is shown when agent-run storage is configured and the actor has `workcore.agents.runs.read`. By default, actors see only their own runs; workspace-wide filtering requires `workcore.agents.runs.read.all`. Trace content is separately filtered by the messages, tool, tool-payload, and results capabilities.

Queries may opt into the admin's non-streaming chat renderer. Conversation persistence remains application-owned: the query should return `{ conversation: { id }, messages }` (optionally with `activeRuns`), and the send mutation should persist/enqueue the user message and return an identifier for a newly-created conversation. The query stays read-only; sending is a separate mutation. Only the configured message and optional conversation ID inputs are supplied by the composer, so other required mutation inputs are rejected during definition validation.

```ts
ui: {
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

Supported blocks are `query`, `mutation-form`, `task-launcher`, and `resource` (`tasks`, `schedules`, or `history`). Query blocks call the existing query endpoint and validate through its ordinary schema/permission boundary. Mutation and task blocks link to the operation console so they reuse its generated form and task controls. References and variants are checked when defining the workspace. The manifest removes blocks whose referenced operation or system resource is not visible to the current actor; this is navigation filtering, not a replacement for server authorization.

`layout` accepts `stacked`, `two-column`, or `overview` (two-column). Query blocks start from their configured input and expose an editable JSON input; the query schema validates each request on the server. Schema-generated dashboard filters, inline mutation forms, metric cards, and per-workspace page overrides are not yet supported. Use an application query for business calculations and a custom frontend for interfaces beyond these declarative blocks.

See [architecture and security](/architecture) for execution contracts and [production deployment](/production-deployment) for PostgreSQL/Redis composition.

For authentication integrations, see [Better Auth and identity management](/authentication).
