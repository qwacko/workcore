# Display metadata, documents and actions

Workcore's console is a SvelteKit client-rendered SPA, compiled with the static adapter. A Cloudflare Worker serves its assets under `/admin`; the browser uses the normal HTTP/WebSocket client. No SSR or SvelteKit server is deployed.

The console discovers the current actor's application through manifest protocol 3 and display protocol 3. Applications declare display documents; the frontend owns layout, responsive behaviour and components. Documents have stable node IDs and contain serialisable operation references, never executable functions, templates or HTML. Earlier protocol versions are intentionally unsupported by this in-repository breaking change.

## Field hints on ordinary Zod schemas

```ts
import { field } from '@workcore/core';

const title = field(z.string().min(1).max(200), {
  label: 'Task title',
  description: 'A short description of the work.',
  placeholder: 'Review the proposal',
  control: 'text',
});
```

`field` preserves the schema's inferred input/output and validation. Labels/descriptions/examples become JSON Schema annotations; control hints become `x-workcore` metadata. Controls include text, textarea, email, URL, password, number, checkbox, select and JSON. Ordinary controls are inferred when no hint is given.

Forms handle primitive fields, enums, defaults and nested objects. Arrays and complex unions can use JSON controls; every form has an advanced JSON fallback. Nullable values can be entered through that editor when the ordinary control is insufficient. Browser validation interprets JSON Schema without `eval`; the server still validates Zod refinements and authorises every execution.

`readOnly` and `hidden` are display hints, never access control. A required hidden input must be supplied by a binding/fixed value. Sensitive output fields must be removed by the server, not hidden using metadata.

## Operation descriptions

Views, queries, mutations and jobs accept optional `ui` metadata:

```ts
const createTask = app.mutation({
  input: createTaskSchema,
  output: taskRowSchema,
  ui: {
    label: 'Create task',
    description: 'Create a shared or private task.',
    submitLabel: 'Create task',
  },
  handler: /* synchronous checked mutation */,
});
```

The operation explorer works without custom pages. Read operations may suggest `table`, `list`, `record`, `json` or `markdown` presentation. Schema inspection and JSON fallback remain available.

## Typed collections and actions

```ts
const taskList = ui.collection(tasks, ({ form, command }) => ({
  title: 'Project tasks',
  columns: [
    { path: 'title', label: 'Task' },
    { path: 'done', label: 'Complete', format: 'badge' },
  ],
  search: ['title'],
  filters: [{
    path: 'done', label: 'Completion',
    options: [{ label: 'Open', value: false }, { label: 'Complete', value: true }],
  }],
  actions: [
    form(editTask, {
      label: 'Edit task',
      bind: { id: 'id', expectedVersion: 'version' },
      initial: { title: 'title' },
      visibleWhen: { path: 'ownerId', equals: { actor: true } },
    }),
    command(completeTask, {
      label: 'Complete',
      bind: { id: 'id', expectedVersion: 'version' },
      disabledWhen: { path: 'done', equals: true },
    }),
  ],
}));
```

Source paths and destination input types are checked by TypeScript. All referenced operations must be registered in the application; invalid references and known data paths fail startup. Paths support nested object fields (up to five type-level segments), not an expression language or array-index query syntax.

- **`bind`** supplies input fields from the row and locks them, including in advanced JSON editing.
- **`initial`** prefills editable fields from the row.
- **`values`** supplies fixed input fields.
- **`form`** opens a generated mutation/job form.
- **`command`** executes directly, optionally after `confirm`.
- **`visibleWhen` / `disabledWhen`** control row affordances, not server permissions.

Actions call mutations or enqueue jobs through the shared client. A failed, identical action submission retains its request ID while the component remains mounted so an uncertain response can be retried without duplicating committed work within the server's deduplication window. Successful submissions start a fresh request ID for the next intentional action.

## Static display documents

```ts
displays: {
  title: 'Tracker',
  description: 'Live tasks and background work.',
  displays: {
    overview: ui.display({
      metadata: { title: 'Workspace overview', route: { path: '/', listed: true } },
      document: ui.document({ blocks: [
        ui.markdown(guide, { id: 'getting-started', title: 'Start here' }),
        ui.record(summary, { id: 'summary', title: 'At a glance' }),
        taskList,
        ui.form(createTask, { id: 'create-task', title: 'Add a task', label: 'Create task' }),
      ] }),
    }),
  },
}
```

Available built-in document nodes:

- `ui.collection(source, configure)`: table/list/JSON presentation, columns, local search/filters, sorting and row actions. The source can return an array or `{ rows, nextCursor }`.
- `ui.record(source, options)`: labelled fields and summary values.
- `ui.json(source, options)`: complete technical inspection of the authorised result.
- `ui.markdown(source, options)`: a string result or `path` within an object. HTML is sanitised; scripts, embedded forms, images and unsafe URLs are not enabled.
- `ui.form(operation, options)`: generated mutation or job form.
- `ui.chat(source, sendOperation, options)`: explicit messages/composer/execution semantics.
- `ui.system(options)`: a built-in administrative block; it never grants access itself.
- `ui.custom(name, version, props, options)`: a namespaced custom renderer node whose properties are checked against the app's registered Zod component contract.
- `ui.section`, `ui.columns`, and `ui.dialog`: bounded recursive containers. Layout expresses composition, not styling; the renderer owns visual design.
- `ui.button`: a declared mutation/job action rendered as a button and generated form.

Parameterized displays use the same document contract but resolve on the server. Discovery includes their metadata and input schema without invoking the handler; callers resolve them with `client.display(name, input)`. The `display:<name>` authorization check applies to listing and resolution, while every referenced source/action is authorized independently:

```ts
const project = app.display({
  input: z.object({ projectId: z.string() }),
  metadata: { title: 'Project', route: { path: '/projects/:projectId', listed: false } },
  handler: (_ctx, input) => ui.document({ blocks: [
    ui.collection(tasks, () => ({
      id: 'project-tasks', input: { projectId: input.projectId },
      columns: [{ path: 'title' }],
    })),
  ] }),
});
```

Handlers are synchronous read-only display composition, not mutations. Their inputs are parsed on resolution, their output is compiled against registered operations, and the returned document is schema-validated and bounded. A display's visibility/listing metadata never grants permissions.

Column formats are `text`, `badge` and `date`. A collection may declare a `detail` target and row-to-property bindings; the target must have a parameterized route. It can also publish a selected key to another source:

```ts
ui.collection(tasks, () => ({ id: 'task-picker', selection: { key: 'id' } }));
ui.record(taskDetails, {
  id: 'selected-task',
  input: { taskId: ui.bind.selection('task-picker') },
});
```

Selection is local to a mounted display instance and supplies only the selected key. The detail source makes its own authorized request; a selected row is not an authorization grant. Until selection exists, the dependent source stays idle. Node IDs are explicit, stable identifiers and must be unique within a display; array position is not identity. A display is capped at 200 nodes, 12 levels and 512 KiB when compiled. There is no arbitrary layout engine, chart DSL or executable template system.

For common compositions, use a typed `ui.combined` helper. It expands at definition time into ordinary protocol nodes, so no special wire node or renderer is needed:

```ts
ui.combined.masterDetail(tasks, taskDetails, {
  id: 'task-browser',
  title: 'Tasks',
  key: 'id',
  detailInput: 'taskId',
  columns: [{ path: 'title', label: 'Task' }],
  detailFields: [{ path: 'title', label: 'Task' }, { path: 'ownerId', label: 'Owner' }],
});
```

The helper produces a section, responsive columns, a selectable collection and a record node bound to the selected key. Generated IDs are deterministic and count toward the normal document limits. Individual leaf sources still go through normal compilation, schema checks and endpoint authorization. Add these helpers for repeated application patterns; keep the wire protocol focused on simple semantic nodes such as collections, records, sections and columns rather than encoding every convenience API as a new node kind.

Actions may also declare finite success effects with `ui.effect.setState`, `resetState`, `resetForm`, `closeDialog`, `refreshSources`, and `navigate`. State writes are checked against declared state schemas during compilation and at runtime. Effects are data in the protocol, never callbacks; effects run only after a mutation/job is accepted. Prefer one navigation declaration per action.

For applications that want database-backed authoring, `@workcore/saved-displays` is an optional capability, not a core table. Register its exported Drizzle table and operations in the app, then call `configure()` with the app's operation/display/component registries. Pass explicit allowlists for sources, actions, nested displays, and custom components. Omitted capabilities are denied; drafts are owner-private by default, and publishing/cross-user reads remain disabled unless explicit policy callbacks permit them. The save and resolver paths rerun structural, reference, and size checks, while each referenced endpoint still applies its own authorization.

### Custom component contracts and application renderer

Register a namespaced component contract alongside displays. Only JSON properties and a positive contract version cross the wire; no Svelte code, callbacks or packages are downloaded:

```ts
displays: {
  components: {
    'acme.task-board': { version: 1, props: z.object({ groupBy: z.enum(['status', 'owner']) }) },
  },
  displays: {
    board: ui.display({
      metadata: { title: 'Board', route: { path: '/board', listed: true } },
      document: ui.document({ blocks: [ui.custom('acme.task-board', 1, { groupBy: 'status' }, { id: 'board' })] }),
    }),
  },
}
```

The default console has no application-specific renderer, so it reports an unsupported component instead of crashing or dropping the node. An application can provide compiled Svelte implementations through `@workcore/admin/renderer`:

```svelte
<script>
  import { ApplicationDisplay } from '@workcore/admin/renderer';
  import TaskBoard from './TaskBoard.svelte';
</script>
<ApplicationDisplay {client} {manifest} {host} workspace="demo" display="board"
  registry={{ 'acme.task-board': TaskBoard }} />
```

The exported renderer is a Svelte component entry, not a console route: the host supplies its own route, URL base, navigation/location adapter, and branding. `ApplicationDisplay` supplies shared client/source context and resolves parameterized displays. A custom implementation receives validated `props` and display `input`. It remains responsible for its own view/action composition; server endpoints still enforce authorization independently.

Custom Svelte renderers can reuse the shared source manager and typed presentation helpers from the same export:

```svelte
<script lang="ts">
  import { LoadBoundary, useRendererSources, useSource } from '@workcore/admin/renderer';
  import { taskRowsSchema } from './schemas.js';

  const sources = useRendererSources();
  const source = { kind: 'view' as const, name: 'tasks' };
  const loader = useSource(
    () => sources,
    () => source,
    () => ({}),
    value => taskRowsSchema.parse(value),
  );
</script>

<LoadBoundary state={loader.state}>
  {#snippet children(rows)}<TaskTable {rows} />{/snippet}
</LoadBoundary>
```

`useSource` registers with the host's reference-counted source manager and cleans up with the component lifecycle; its decoder validates and types the result. `useAsyncResource` exposes the same resource state for one-off promise-backed reads that do not use subscriptions. `LoadBoundary` handles loading, failure and reconnecting states for either adapter. `useTask` provides a small pending/success/error lifecycle for commands and transfers. `DataTable` renders typed rows and columns and is shared by collection, system-resource, and operation-index renderers; `DisplayCard` provides the standard header/frame, and `useCollectionView` derives local filter/sort views. A specialized transport or presentation can plug into these primitives without pretending to be an ordinary query source.

## Chat is a data contract

```ts
ui.chat(conversation, sendMessage, {
  title: 'Workspace assistant',
  messages: 'messages',
  message: { id: 'id', role: 'role', content: 'content', parts: 'parts', at: 'at' },
  promptField: 'message',
  runId: 'runId',
})
```

The source returns an array at `messages`, with explicit ID/role/content or typed-parts paths. Parts are plain text or a display reference with validated input and an explicit `live` or `snapshot` reference mode. A snapshot stores the display name and input, not historical source data or a frozen server document; reopening resolves the current document and re-authorizes every source. The send operation receives composer text in `promptField`. The optional `runId` points to the latest background execution, whose status is polled and linked to its timeline. Messages update through the normal live view transport. If sending is denied but reading is permitted, the manifest projects a read-only chat.

The tracker stores typed message parts in a per-user indexed application table. Sending commits the user message, enqueue and latest-run reference atomically; the agent records its reply via a checked mutation. Its 200-message live set is intentionally bounded. Saved project displays are likewise stored by checked application mutations and resolved dynamically after owner checks; the assistant can call that same checked mutation when explicitly asked to save a display. This is not token streaming, an attachment editor, offline messaging, a resumable agent loop or an unbounded conversation-history system.

## Server scope versus local state

Each read block gets its source input schema. **Data scope** submits those server parameters and replaces the source subscription/query. A block's optional `input` supplies initial values.

Collection search, enum filters, sorting and table/list/JSON mode operate only on received rows. Query collections explicitly describe filtering as applying to the loaded page. Cursor pagination follows `nextCursor`; it never infers completion from a short page.

URL query parameters use `scope.<block-id>.<field>` and `filter.<block-id>.<setting>`. State survives refresh and deep links. Do not use these parameters for secrets. Edits and chat drafts are local component state and are not put in the URL.

The Svelte components use a reference-counted source cache around `@workcore/client`: equivalent view inputs share a subscription, unmounting releases it, late query responses are discarded after disposal, and mutations refresh active one-shot queries. Resource inspection uses bounded polling and stops when no component needs it. Workspace-level client state survives navigation within the workspace.

## Projection and routing

The backend resolves operation-object references to serialisable names and includes an actor-filtered synthetic system-operation catalog for built-in administration. `client.system(name, input)` dispatches through the same resource, trace and checked-control authorization paths as their direct endpoint counterparts. It removes denied sources, denied actions and displays the actor cannot resolve. Endpoints independently enforce all permissions; manifest projection is not an alternative security boundary.

Routes include:

```text
/admin/:workspace                         overview / onboarding display
/admin/:workspace/displays/:name          declared application display
/admin/:workspace/displays/systemOperationIndex  synthetic operation explorer
/admin/:workspace/displays/systemRunDetail       run outcome and execution timeline
```

Build `@workcore/admin` and bind its `build` directory as Worker static assets named `ASSETS`, with `run_worker_first: true` and SPA fallback. After authenticating the request, call `serveAdmin(request, env.ASSETS)` from `@workcore/admin/server`; it strips the `/admin` prefix when fetching compiled assets. The current console expects the same-origin API prefix `/api/workspaces/`.

`pnpm dev` runs SvelteKit HMR on the configured `HOST`/`PORT` and proxies non-admin routes, including WebSockets, to a private Wrangler port. `pnpm build` produces the deployable static assets and performs a Worker dry run. The browser tests exercise the compiled assets behind the Worker, not just the Vite development server.
