# Admin metadata, pages and actions

Workcore's console is a SvelteKit client-rendered SPA, compiled with the static adapter. A Cloudflare Worker serves its assets under `/admin`; the browser uses the normal HTTP/WebSocket client. No SSR or SvelteKit server is deployed.

The console discovers the current actor's application through manifest protocol 2. The application declares semantics; the frontend owns layout, responsive behaviour and components. No executable functions, templates or HTML are transmitted in page definitions.

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
    { path: 'data.title', label: 'Task' },
    { path: 'data.done', label: 'Complete', format: 'badge' },
  ],
  search: ['data.title'],
  filters: [{
    path: 'data.done', label: 'Completion',
    options: [{ label: 'Open', value: false }, { label: 'Complete', value: true }],
  }],
  actions: [
    form(editTask, {
      label: 'Edit task',
      bind: { id: 'id', expectedRevision: 'revision' },
      initial: { title: 'data.title' },
      visibleWhen: { path: 'data.ownerId', equals: { actor: true } },
    }),
    command(completeTask, {
      label: 'Complete',
      bind: { id: 'id', expectedRevision: 'revision' },
      disabledWhen: { path: 'data.done', equals: true },
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

## Semantic pages

```ts
admin: {
  title: 'Tracker',
  description: 'Live tasks and background work.',
  pages: {
    overview: ui.page({
      title: 'Workspace overview',
      blocks: [
        ui.markdown(guide, { title: 'Start here' }),
        ui.record(summary, { title: 'At a glance' }),
        taskList,
        ui.form(createTask, { title: 'Add a task', label: 'Create task' }),
      ],
    }),
  },
}
```

Available blocks:

- `ui.collection(source, configure)`: table/list/JSON presentation, columns, local search/filters, sorting and row actions. The source can return an array or `{ rows, nextCursor }`.
- `ui.record(source, options)`: labelled fields and summary values.
- `ui.json(source, options)`: complete technical inspection of the authorised result.
- `ui.markdown(source, options)`: a string result or `path` within an object. HTML is sanitised; scripts, embedded forms, images and unsafe URLs are not enabled.
- `ui.form(operation, options)`: generated mutation or job form.
- `ui.chat(source, sendOperation, options)`: explicit messages/composer/execution semantics.

Column formats are `text`, `badge` and `date`. The layout uses a modest responsive grid; collections and chat span its width. There is no arbitrary layout engine, chart DSL, executable template system or custom-component registry.

## Chat is a data contract

```ts
ui.chat(conversation, sendMessage, {
  title: 'Workspace assistant',
  messages: 'messages',
  message: { id: 'id', role: 'role', content: 'content', at: 'at' },
  promptField: 'message',
  runId: 'runId',
})
```

The source returns an array at `messages`, with explicit ID/role/content paths. The send operation receives the composer text in `promptField`. The optional `runId` points to the latest background execution, whose status is polled and linked to its timeline. Messages update through the normal live view transport. If sending is denied but reading is permitted, the manifest projects a read-only chat.

The tracker stores messages in a per-user indexed table. Sending commits the user message, enqueue and latest-run reference atomically; the agent records its reply via a checked mutation. Its 200-message live set is intentionally bounded. This is not token streaming, an attachment editor, offline messaging, a resumable agent loop or an unbounded conversation-history system.

## Server scope versus local state

Each read block gets its source input schema. **Data scope** submits those server parameters and replaces the source subscription/query. A block's optional `input` supplies initial values.

Collection search, enum filters, sorting and table/list/JSON mode operate only on received rows. Query collections explicitly describe filtering as applying to the loaded page. Cursor pagination follows `nextCursor`; it never infers completion from a short page.

URL query parameters use `scope.<block-id>.<field>` and `filter.<block-id>.<setting>`. State survives refresh and deep links. Do not use these parameters for secrets. Edits and chat drafts are local component state and are not put in the URL.

The Svelte components use a reference-counted source cache around `@workcore/client`: equivalent view inputs share a subscription, unmounting releases it, late query responses are discarded after disposal, and mutations refresh active one-shot queries. Resource inspection uses bounded polling and stops when no component needs it. Workspace-level client state survives navigation within the workspace.

## Projection and routing

The backend resolves operation-object references to serialisable names. It removes denied sources, denied actions and empty pages for each actor. Endpoints independently enforce all permissions; manifest projection is not an alternative security boundary.

Routes include:

```text
/admin/:workspace                         overview / onboarding
/admin/:workspace/pages/:name             declared application page
/admin/:workspace/operations/:kind/:name   operation explorer
/admin/:workspace/resources/:resource     runs, schedules, history, tables
/admin/:workspace/runs/:id                 outcome and execution timeline
```

Build `@workcore/admin` and bind its `build` directory as Worker static assets named `ASSETS`, with `run_worker_first: true` and SPA fallback. After authenticating the request, call `serveAdmin(request, env.ASSETS)` from `@workcore/admin/server`; it strips the `/admin` prefix when fetching compiled assets. The current console expects the same-origin API prefix `/api/workspaces/`.

`pnpm dev` runs SvelteKit HMR on the configured `HOST`/`PORT` and proxies non-admin routes, including WebSockets, to a private Wrangler port. `pnpm build` produces the deployable static assets and performs a Worker dry run. The browser tests exercise the compiled assets behind the Worker, not just the Vite development server.
