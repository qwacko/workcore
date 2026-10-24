# Semantic UI implementation brief

Status: accepted migration direction; implementation in progress. This remains a design/acceptance brief, not API documentation. Updated 16 October 2026.

## Migration direction (decision, 16 October 2026)

Treat the existing admin as a feature and workflow inventory, not as the architecture to preserve. There are no deployed application instances that require the beta UI contract, so compatibility with the legacy page/variant rendering model is not a migration goal. Keep the valuable operation execution, authorization, Standard Schema validation, codecs, typed clients, and demonstrated workflows; replace the parallel legacy UI definition/rendering paths with one canonical semantic model used by both built-in and application-authored pages. Temporary adapters may ease the migration, but should not become a second permanent UI architecture. Prefer a deliberate beta breaking change over indefinitely maintaining two renderers/contracts when that materially simplifies the result.

This supersedes compatibility language below wherever it would require retaining the old UI as a permanent source of truth. Preserve server/API behavior unless the migration demonstrates a specific need to change it. Once migrated, update the compatibility matrix, public authoring docs, and release notes to describe the new canonical contract.

## 1. Purpose and instructions to the implementing agent

Evolve Workcore's existing manifest-driven admin into a typed, renderer-independent description of useful application workflows. Preserve the ability to define an operation once, obtain an automatic UI, and reuse its named views inside custom pages. Improve the supplied admin immediately; keep the door open to alternative admin renderers and simple user-facing starters.

This document records the outcome of a design discussion. Later decisions supersede earlier exploration: **start with larger semantic blocks, not a public low-level component-tree engine**. Borrow concepts from `json-render`, but do not add it as a dependency or adopt its complete language as part of this work.

Implementation instructions:

1. Re-read the current code and any repository instructions before editing. File names and symbols below are a starting map, not a substitute for inspection.
2. Preserve existing operation execution, authorization, codecs, typed clients, named views, and object-style admin configuration.
3. Prove callback inference and the wire contract in small tests before rewriting the renderer.
4. Deliver a vertical slice using the tracker Activity dashboard, then expand incrementally. Do not implement every future possibility in this brief at once.
5. Treat code marked illustrative as API sketches. Exact names may change if the resulting API is coherent, typechecked, documented, and consistent across pages and views.
6. Do not hide inference problems with broad casts, `any`, handwritten copies of the operation catalog, or callbacks whose parameters silently become untyped.
7. Record material departures from the decisions here and their justification. Keep current user documentation accurate about what has actually shipped.

### Intended result

An application describes **intent**: browse these records, edit with this mutation, display this query, or converse through these operations. The supplied Svelte admin implements that intent. Another renderer can choose different presentation and interaction patterns while preserving the declared behaviour.

Success is less application-specific frontend code with dependable data/form lifecycles. Replacing Svelte markup with equally complicated JSON is not success.

## 2. Current implementation: reuse, do not restart

| Location | Relevant existing behaviour |
| --- | --- |
| `packages/core/src/index.ts` | `defineWorkspace`, inferred operations, `OperationViewVariant`/`OperationViews`, semantic `AdminBlock`/`AdminPage`/`AdminConfiguration`, `validateDefinition`, `makeManifest`, permission filtering, HTTP execution and codecs |
| `packages/core/src/index.test.ts` | Runtime, manifest, permission, schema conversion, and definition-validation tests |
| `packages/client/src/index.ts` | `WorkcoreManifest`, fetch transport, typed operation calls, query subscriptions |
| `packages/admin/src/ui/App.svelte` | Navigation, query/form orchestration, page queries, cursors, invalidation, generation guards, task/resource/chat behaviour |
| `packages/admin/src/ui/DashboardBlock.svelte` | Rendering current custom-page blocks |
| `packages/admin/src/ui/DataTable.svelte` | Table presentation and row actions |
| `packages/admin/src/ui/OperationInput.svelte` | Generated operation inputs and fallback editing |
| `packages/admin/src/ui/rich-input.ts` | Rich-value display/editing and runtime-type hydration |
| `examples/tracker/src/app.ts`, `src/modules/activities.ts`, `src/modules/assistant.ts` | Composed application, module-owned operations/views, Activity dashboard, and Milo chat page |
| `examples/tracker/src/type-tests.ts` | Positive inference tests and `@ts-expect-error` negative tests |
| `tests/e2e/admin.spec.ts` | Browser-level admin verification |
| `docs/authoring.md`, `docs/architecture.md` | Current public behaviour and security contracts |

Current facts to retain:

- `GET /manifest?applicationId=…&workspaceId=…` already returns an actor/workspace-filtered operation manifest, pages, and capabilities. Use this boundary; another endpoint is not required initially.
- Operations must explicitly opt into the HTTP API. A UI reference must not implicitly expose an internal operation.
- Standard Schema provides validation. Exposed schemas also provide Standard JSON Schema draft 2020-12. Core is not Zod-dependent; examples happen to use Zod.
- Existing variants include tables, JSON, forms, and several chat presentations. Existing custom-page blocks include queries, mutation forms, task launchers, and platform resources.
- Page mutation/task blocks currently open the console rather than supply a connected inline workflow.
- Table validation already expects `rows[]`, `nextCursor`, a valid row key, and bounded `limit`/string `cursor` inputs. Preserve existing bounds rather than loosening them incidentally.
- Rich values use negotiated codecs. The tracker demonstrates actual `Date` values, not merely date-looking strings.
- The compiled admin is optional. Serving it does not require a consumer frontend build, and the core has no UI-framework dependency.

### Grounding example

The current Activity dashboard is approximately:

```ts
activityDashboard: {
  title: 'Activity dashboard',
  layout: 'two-column',
  blocks: [
    { id: 'recent-activities', type: 'query', operation: 'activities', variant: 'basic', input: { limit: 10 } },
    { id: 'edit-activity', type: 'mutation-form', operation: 'editActivity', title: 'Edit an activity' },
  ],
}
```

The existing operations are:

```ts
// Accepted list input; limit has a schema default and bounds.
{ limit?: number; cursor?: string; status?: 'planned' | 'complete'; search?: string }

// List result.
{ rows: Array<{ id: string; title: string; status: 'planned' | 'complete'; updatedAt: Date }>;
  nextCursor: string | null; totalCount: number }

// editActivity accepted input and result.
{ id: string; title: string; status: 'planned' | 'complete' }
// → Activity, including updatedAt: Date
```

There is no individual-activity query and no sorting input at the time of this brief. Do not pretend these exist. Edit from the list row for the first slice; add a detail query only if a real workflow requires it. Adding sorting requires corresponding repository/query implementation, not just UI controls.

The current basic table row action binds only `id`. Binding `title` and `status` as well would improve the old console form, but is not a substitute for the new inline editor.

## 3. Decisions and rationale

| Decision | Reason |
| --- | --- |
| Separate authoring, wire representation, and rendering | Ergonomic TypeScript must not force renderers to execute application callbacks |
| Keep JSON as the declarative wire representation | Fits existing transport, schemas, tooling, and independent clients; XML changes syntax, not lifecycle semantics |
| Start with semantic blocks | More immediately useful and leaves renderers freedom over interaction, not just styling |
| Keep semantic blocks in the manifest | Do not eagerly expand a collection/editor into a prescribed table/form tree |
| Keep operation-owned named views and automatic UI | This is an existing product feature, not something custom pages replace |
| Support callbacks for both pages and operation views | Both need the same typed catalog and composition capabilities |
| Use schema-inferred types and explicit mappings | Avoid duplicate data schemas and magic field-name guesses |
| Use conventions with checked escape hatches | Common cases should be concise; mismatches should be explicit and diagnosable |
| Provide scoped state and typed references | Enables useful coordination without an expression/programming language |
| Share internal query/form controllers | Prevent divergent dirty-state, authorization, and stale-response implementations |
| Retain custom components as an escape hatch | Avoid expanding the framework to accommodate every domain interaction |

### Explicit non-goals for the first release

- A visual builder, arbitrary DOM/CSS vocabulary, unrestricted nested UI templates, or general low-code platform.
- Arbitrary JavaScript, expression strings, remote imports, downloaded component implementations, or `eval` in the manifest.
- Automatic business calculations, transaction semantics, database queries, or authorization derived from UI configuration.
- Generic filter expression builders, unrestricted sort adapters, action workflows with loops/branching, or universal schema-subtyping proofs.
- Implicit persistent global state, cross-workspace state sharing, or every possible nested/union form control.
- Replacing the current admin wholesale or changing chat/task execution while doing collection work.

## 4. Architecture and ownership

```text
Operation schemas and handlers
           ↓ infer catalog
Typed authoring callbacks and helpers
           ↓ compile and validate
Renderer-independent semantic UI definition
           ↓ actor/workspace projection
Versioned UI document in the existing manifest
           ↓ validate and resolve
Renderer controllers + component registry
           ↓
Svelte admin / another admin / custom starter frontend
```

### Three separate types

1. **Authoring types:** schemas, callbacks, typed references, operation handles, and helpers. May contain actual TypeScript functions and Standard Schema objects.
2. **Compiled UI types:** stable descriptors with IDs, schema metadata, operation references, literals, bindings, actions, scopes, and dependencies. No callback bodies, schema implementations, or proxies.
3. **Runtime values/controllers:** actual query results, input state, drafts, errors, and execution state. These are not embedded live in the UI definition.

Do not collapse these types into one enormous interface with `unknown` properties. Keep the serialized contract shared between producer and consumer; `makeManifest` should not independently construct an effectively untyped approximation of a client type.

### Internal separation versus public composition

Separate query, collection, selection, and form behaviour internally from the first slice. Keep the public combined block convenient. Expose more low-level composition when a real screen needs independent pieces: URL-driven editing, multiple detail panes, a custom collection, or one selection feeding several consumers.

Do not wait until collection has dozens of special flags. Equally, do not publish a universal primitive API before there are concrete use cases. Both combined semantic blocks and explicitly linked blocks may eventually exist; the combined block need not lose its semantic wire identity.

## 5. Authoring callbacks and reusable operation views

### Common context

Pages and operation view factories should receive a consistent authoring context:

- `ui`: typed block/layout/reference/action helpers.
- `queries`, `mutations`, and `tasks`: references inferred from the complete operation catalog.
- Operation views additionally receive `self` and their typed instance input/parameter references.
- Nested state-owning containers can provide a child callback with references to the declared scope.

Callbacks are synchronous, configuration-only authoring code. Evaluate/compile them during definition construction, not during request handling, query refresh, or browser rendering. They must not execute operations or depend on an actor, a database read, time, or a per-request mutable global. JavaScript conditions in these callbacks choose configuration at construction time; runtime conditions require declarative descriptors.

A callback producing an event action is also authoring code, not a function transported to the browser. If that style is offered, it receives symbolic typed event references and returns an action descriptor. Do not imply arbitrary runtime event handlers are serializable.

### Reference kinds

- **Operation handle:** names the checked operation and exposes its schema-derived types.
- **Query source:** a particular query instance with input bindings, results, and lifecycle. Creating it describes a call; it does not execute it at authoring time.
- **View instance:** a named presentation instantiated with parameters and local identity.

Two calls to `.view()` create independent instances by default. Share a query source explicitly when several presentations should use one request lifecycle. Never share selection or form drafts merely because the operation names match.

Symbolic `.params` references on a source refer to its current accepted input values. Typed result references point at its decoded query output. A mutation is an action target, never a reactive read dependency.

### Illustrative operation view

```ts
ui: {
  default: 'manage',
  variants: {
    manage: ({ ui, self, input, mutations }) => ui.collection({
      settings: {
        query: self,
        itemKey: 'id',
        columns: [
          { field: 'title', editable: true, filter: { type: 'text', targetParam: 'search' } },
          { field: 'status', display: 'badge', editable: true, filter: { type: 'select' } },
          { field: 'updatedAt', display: 'datetime', editable: false },
        ],
        editor: { mutation: mutations.editActivity, variant: 'basic' },
      },
      params: { input },
    }),
  },
}
```

This view can reference other queries, mutations, tasks, or named views, just like a page. A form may use a lookup query; a query view may contain a related collection. Reuse a mutation's form variant rather than define incompatible duplicate editors.

Named-view references must resolve lazily/symbolically. Detect recursive *view expansion*. Referencing the same operation as a data source is not itself recursive view expansion.

### Illustrative page reuse

```ts
admin: ({ ui, queries }) => ({
  pages: {
    overview: ui.page({
      settings: { title: 'Overview' },
      children: [
        queries.activities.view('compact', {
          id: 'recent-activities',
          params: { input: { limit: 5 } },
        }),
        queries.assistantConversation.view('chat', {
          id: 'assistant',
          params: { input: {} },
        }),
      ],
    }),
  },
})
```

The current automatic operation UI should still use each operation's default view and offer named alternatives. Preserve existing schema-driven fallbacks. A view requiring extra parameters must declare their defaults or show a parameter/input form in automatic presentation; do not silently substitute fabricated IDs or expose a broken default view.

### Inference implementation challenge

The current one-call workspace definition already uses `NoInfer` to keep handlers consuming inferred operations. Infer schemas and literal view keys first, then contextually type view/page callbacks from that catalog. Avoid circular inference in which callback bodies are needed to infer the catalog they consume.

Prototype query, mutation, and page callbacks together, including cross-references and invalid variants. Preserve inferred public client types and sibling handler calls. If TypeScript cannot reliably provide this in the existing one-call signature, investigate a typed finalization stage internally or a minimal explicit helper before changing the public authoring pattern. Do not quietly require every application to maintain a second operation catalog.

## 6. Standard component envelope

Use a common organization, but **component-specific types** for each section:

| Member | Contract |
| --- | --- |
| `id` | Optional authoring identity; compiled instances require deterministic, scope-qualified IDs |
| `layout` | Presentation/placement hints: fill/constrained width, relative sizing, panel/plain/inset surface |
| `settings` | Fixed structural configuration: operation references, fields, identity, allowed behaviours, presets |
| `params` | Data inputs, each accepting a literal or compatible typed reference |
| `state` | Schema-declared mutable values owned by this component instance |
| `events` | Named, typed component events wired to declarative actions |
| `children` / `slots` | Nested content only on components that declare support for it |
| `visibility` | Additional server-evaluated capability requirements |

`params` is not just a bag of query arguments: a form can accept `recordKey` and `initialValues`; a record editor accepts load input; a custom component has its own props contract. Query input normally remains a structured object under `params.input`.

The renderer may resolve settings/params into local component props. It must not pass an unrestricted object through to native DOM attributes. Keep operation choice and structural settings static initially; do not make every setting dynamically bindable.

Use `events`, not an ambiguous promise of arbitrary runtime hooks. Built-in behaviour such as form submission must work without a user-supplied event action. Additional actions observe the result or perform explicit coordination.

## 7. First semantic blocks and layouts

| Block | First-release responsibility |
| --- | --- |
| Collection | Structured records, fields, filtering, cursor pagination, optional editor; sorting only where the query supports it |
| Form / record editor | Mutation input, defaults or query/selection initialization, validation, dirty state, submission |
| Record / query display | Read-only structured result, field/value presentation, JSON fallback; simple metric presentation can follow |
| Chat | Preserve existing conversations, transcripts, sending, action mappings and invalidation |
| Task launcher | Existing validated launch, run identity, progress and terminal result; reuse form inputs |
| Custom | Registered component name, props/schema contract, bindings/events, unsupported placeholder |

Keep Operations, Task runs, Schedules, History, and Agent runs available as built-in pages. They retain independent endpoint capabilities, but their pages should become preconfigured compositions of reusable semantic blocks, sources and actions, as detailed below.

Layouts initially: page, vertical stack, responsive grid, and labelled section. Existing `stacked`, `two-column`, and `overview` layouts normalize into these. A primary/secondary arrangement is a semantic grid preset. Prefer plain grouping first; collapsible sections and tabs need explicit state and data-activation policies before introducing them.

Do not introduce a generic repeated component-template language initially. Collections, nested form controls, or custom components cover lists. Do not add a metric calculation engine: application queries calculate business data.

### Built-in pages are reproducible configurations, not privileged page components

The default Operations, Task runs, Schedules, History, and Agent runs pages must remain available. Their final representation should be ordinary compiled semantic page configurations assembled from the same capabilities available to application authors. Default page factories may generate these configurations; users should not need to write them manually, but must be able to reuse, reconstruct, or adapt them.

An opaque block such as `type: 'agent-runs-page'` that only the shipped admin knows how to interpret does not satisfy this requirement. Existing `resource` blocks may remain as compatibility shorthands during migration, but should resolve to reproducible configurations rather than be the sole public way to access those workflows. Configuration factories execute during authoring/compilation and emit descriptors, not runtime component implementations.

Expected reusable capabilities include:

| Default page | Reusable composition |
| --- | --- |
| Operations | Authorized operation catalog source, operation/variant selection, query input/result view, mutation form or task launcher, and normal checked execution |
| Task runs | Scoped run source, collection/filter/selection, record/progress/result display |
| Schedules | Scoped schedule source, collection, create/edit form, and explicitly supported management actions |
| History | Scoped history source, collection/filter/selection and record/detail display |
| Agent runs | Authorized run source, collection/filter/selection, run details and trace/event presentation, with payload redaction preserved |

Built-in resources currently use dedicated HTTP endpoints, not application queries/mutations. Provide typed, allow-listed resource source/action adapters with declared input/output contracts and capability requirements; do not fabricate application operation names or require developers to reimplement platform HTTP access. These adapters should participate in the same binding, loading/error, selection, invalidation and projection machinery as application-backed sources. Existing transport capabilities may need extending in a browser-safe way. Do not expose arbitrary URLs or weaken the dedicated endpoints' checks to make composition easier.

This does not require reducing everything to buttons and text nodes. Shared semantic controls such as an operation chooser, progress display, or trace timeline are appropriate when independently useful. The boundary is a reusable responsibility, not an entire hard-coded page with private orchestration. If reproducing a built-in reveals a missing capability, introduce the smallest reusable contract needed rather than a page-specific escape hatch or a general scripting language.

Keep default enable/disable flags and navigation identities. Apply actor-specific filtering to these configurations just like application pages, including nested actions, source availability, defaults and redacted data. Users composing a schedule form or trace view must not gain capabilities denied on the supplied page. Operations catalog-driven invocation must remain restricted to the authorized catalog and validated selected-operation schemas, not unchecked dynamic operation names.

Implementation can migrate these pages incrementally while retaining existing behaviour; the first collection slice need not rewrite all of them. However, reproducibility of built-in pages is part of the overall completion criteria, not a permanently deferred customization feature. Add at least one application-authored resource-page composition to prove access is not privileged to the default factories.

### Renderer freedom and obligations

A collection/editor may be table + side panel on desktop, cards + full-screen editor on mobile, or a modal in another renderer. The contract fixes identity, mapping, authorization, draft protection, events, and refresh behaviour, not pixel layout.

Renderers must preserve accessible labelling, keyboard interaction, focus after opening/closing an editor, and loading/error announcements. Interaction freedom is not permission to drop behaviour. If navigation/bookmark semantics are explicitly requested, the renderer must honor them or report the unsupported feature.

## 8. Collection conventions and explicit mappings

### Standard page shape

Default to the current convention:

```ts
// Input: schema-bounded limit; optional cursor.
{ limit: number; cursor?: string }

// Output:
{ rows: RecordType[]; nextCursor: string | null; totalCount?: number }
```

Keep existing table definitions working. `pagination: false` can disable paging controls; it must not silently change a paginated query into an unbounded read. Nonstandard pagination adapters can wait for a real use case. Raw JSON remains a fallback for incompatible outputs.

### Fields and display

- Infer value types from the query output schema/type. Columns add labels and display hints, not duplicate validation schemas.
- Initial display hints: text, number, date/datetime, boolean, badge, optionally safe links/currency where fully specified. Currency needs unit/precision semantics; do not silently assume minor versus major units.
- Authoring can accept a convenient top-level field name; typed path tuples/reference helpers handle nested fields. Compile paths to JSON Pointer (RFC 6901), including proper escaping. Do not introduce ambiguous dot-path parsing for new bindings.
- Preserve legacy path conventions through adapters. Existing chat uses dot paths; do not globally reinterpret them as JSON Pointer.
- Missing optional fields have defined empty presentation; a missing field is not a renderer crash.
- Calculated presentation values should come from application queries, a small supported formatter, or a custom component. No arbitrary serialized formatting callbacks.

### Editing

`editable: true` maps a column to a same-named mutation input. An explicit `editable: { targetInput: ... }` handles mismatches. Identity defaults to row `id` → mutation `id`, but both existence and compatibility are checked; never invent a key by guessing among fields.

Only map declared editable fields, identity, explicit hidden/read-only inputs, and allowed defaults. Never submit the whole row. `updatedAt` in the tracker is a display value and is not part of `editActivity` input.

`editable: false` controls UI affordance; it is not a server policy and does not necessarily mean a required unchanged field can be omitted. Explicit bindings must cover required noneditable inputs. A hidden control is not a place to store a secret.

The mutation schema is authoritative for form data/control type. A mutation form variant supplies reusable field presentation; explicit editor configuration overrides that presentation; column metadata supplies defaults where not otherwise configured. Define this precedence in types and tests, rather than perform unrestricted deep merges. Incompatible options are errors. Column configuration must not be the only way to define an independent form.

Permit editor-only fields not displayed in the collection, with a declared source/default/editable control. Required inputs must be supplied by one of these mechanisms; do not demand that user-entered fields already contain valid values before rendering an empty form.

Nested objects remain structured. Primitive arrays can become list controls and object arrays can become repeatable groups once implemented with stable item identity and nested error paths. Unsupported shapes use the existing validated JSON editor. Complex union controls and file uploads are not silently promised by the first slice.

### Filters

Expose schema-compatible presets, not a general predicate language:

- `text`: string input, optionally debounced.
- `select`: enum-backed single choice initially; clear omits the optional parameter.
- `boolean`: all/true/false only if the target accepts optional boolean.
- `number` and `date`: introduce once their runtime representations and validation are specified.

Default the target parameter to the field name. Use `targetParam` for mismatches (`title` → existing `search`). Derive options and constraints from the *target accepted input schema*, not merely the output column. Standalone search/filter controls need not correspond to a visible column.

The preset controls input and binding, not database meaning. `text` does not magically implement SQL contains/equality. The application query decides how `search` behaves. Ranges, multi-select, facet counts, arbitrary operators, and generic filter builders are future work unless a concrete requirement warrants a narrow preset.

### Sorting

Recommended initial input shape, only for operations that declare it:

```ts
sort?: { field: AllowedSortKey; direction: 'asc' | 'desc' }
```

`sortable: true` uses the field's corresponding allowed sort key. An explicit key override supports a displayed nested field sorted by a server alias. Validate keys against the input enum. Do not pass arbitrary client field names into SQL or enable sorting just because a table has a column.

Implement full-result ordering in the query/repository. Never present current-page client sorting as collection sorting. Cursor implementations need deterministic ordering with a stable tie-breaker and cursors compatible with filter/sort changes.

For the tracker slice either omit sorting, or add the schema, repository implementation, and tests together. It currently has no sort support.

### Query parameters and effective input

Expose typed parameter references from query-source handles; derive them from existing schemas rather than a parallel schema catalog. Changing filters/sort/page size atomically clears cursor history and refetches once after applicable debounce. Avoid briefly sending new filters with the previous cursor.

A query may explicitly return normalized/effective input, but this is optional metadata. It must not be blindly written back into the source and create feedback loops. Dynamic lookup/facet data needs a declared result mapping or a separate query; do not treat arbitrary response properties as control configuration.

## 9. Scoped state, bindings, events, and dependencies

### State

Each declaration has a schema, an optional initial value/source, and an owning scope. Pages and containers can own state visible to descendants. Default lifetime is the instance lifetime; actor/application/workspace changes dispose scoped controllers and clear relevant values. No implicit localStorage, cross-page singleton, or cross-tenant persistence.

Illustrative scoped declaration:

```ts
ui.section({
  settings: { title: 'Activities' },
  state: {
    status: { schema: z.enum(['planned', 'complete']), initial: 'planned' },
  },
  children: ({ state }) => [
    queries.activities.view('compact', {
      params: { input: { limit: 10, status: state.status.value } },
    }),
  ],
})
```

State is per instance. Compile ancestor references to explicit scope IDs, not nearest-name string searches. Siblings coordinate through parent-owned state or explicit parameters; they cannot reach into each other's private controller state. Updates go through typed actions/writable bindings, not direct object mutation. Reusable children should normally accept parameters and emit events rather than assume a particular ancestor state name.

Each compiled state cell needs an unambiguous identity, for example a scope-instance ID plus a local declaration key. Two instances may both declare `status` without sharing a value. Declaration identity and runtime instance identity are distinct: repeated instances must use stable item/instance keys rather than array positions or one compile-time scope ID reused for every instance. Do not generate fresh identities on each render and accidentally reset state.

This is an important reason for callback-based scope access: `children: ({ state }) => ...` provides typed handles to the correct declarations without asking authors to invent globally unique strings. The compiler resolves those handles into explicit references and the renderer resolves them within the correct runtime instance. Callbacks do not themselves guarantee uniqueness; ID allocation, scope validation, and lifetime rules still do. The same local names in unrelated scopes are valid, while ambiguous or escaping references must be rejected.

Initial means initial, not continuously reset whenever its source changes. Declare any reset behaviour separately. Keep query results read-only and form drafts controller-owned; do not copy all caches/drafts into public state just to make them accessible.

### Binding representation

Keep literals distinct from references; never interpret arbitrary application objects with a `$state` property as executable binding syntax. An authoring reference compiles to a tagged binding in a dedicated binding structure.

Supported sources initially: literal, scoped state, query/source parameters, query result, typed event payload, and limited read-only context/page parameters. Allowed targets are component parameters, writable source parameters, declared state, or action input; a query result is not writable.

A reference can carry an entire object/array or one nested value. Do not flatten values to strings or JSON-clone them. Missing, null, invalid, loading, forbidden, and failed are distinct states. Optional absence must not be represented as an accidental serialized `undefined`; omit an optional key or use the explicitly selected codec representation.

Dependent queries wait when required source values are unavailable. A deliberately invalid input reports validation errors rather than waiting forever. Readiness gating must be explicit in the compiled contract; it cannot merely rely on a non-null TypeScript assertion. Runtime visibility does not imply activation or fetching policy.

### Events and actions

Use a small set of actions: set declared state, update source input, navigate, invoke mutation/task, and explicit refresh if needed. Normal mutations use existing invalidation; do not add duplicated refresh storms. Events have declared payload schemas/types and cannot choose unrestricted server operations by string at runtime.

Specify success/failure semantics, including existing post-commit warning handling: a follow-up delivery warning is not proof that the mutation failed or should be retried. Do not claim UI action sequences are transactions. No general loops/branching/action workflow DSL initially.

Detect cycles in automatically triggered dependencies, not every graph containing a user event. Protect state writes against prototype pollution and unsafe object paths. Use own-property access, bounded traversal, and a documented policy for dangerous path tokens.

## 10. Query, selection, and form lifecycle

Controllers should be framework-neutral where practical, but a new package is not required until reuse justifies it. Extract coherent modules rather than add another large set of unrelated maps to `App.svelte`.

### Query source

- Own input, result, idle/waiting/loading/error/forbidden state and request generation.
- Reuse existing subscribe-before-catch-up, invalidation coalescing and reconnect behaviour.
- Discard stale responses after input/selection/page/workspace changes; abort where supported without depending solely on abort for correctness.
- Do not issue duplicate requests for explicitly shared sources. Independent views may have independent sources.
- Define mount/activation/disposal. A hidden component does not automatically disable a source shared by visible components.
- Bound input/query sizes and avoid uncontrolled dependency-driven request storms.

### Loading and error boundaries

Loading/error **semantics belong to the shared contract**; their visual presentation belongs to the renderer. Do not leave a renderer to guess whether one failing child disables an entire page or whether a refresh destroys an editor. Start with built-in per-block boundaries, not a mandatory new author-facing boundary component.

- Distinguish initial loading, background refresh, empty success, unavailable dependency, request failure, forbidden access, and mutation submission/failure. Expose machine-readable states, not only an error string.
- By default, a collection request failure affects that collection and consumers requiring its result, not an unrelated chat or sibling block. A failed editor submission stays local to the editor and preserves the draft.
- Previously authorized data may remain visible during background refresh for the same source identity/input. Mark it as refreshing/stale as appropriate. Do not show the previous record as the newly selected record, or retain protected data after access revocation.
- A dependent block waiting for an unavailable result must identify that dependency state; it must not spin indefinitely when the source has failed or been removed. Retry a shared query source through its owner, rather than once per dependent view.
- Renderers may choose skeletons, spinners, inline errors, alerts or fallback panels, with accessible status announcements. They must not silently remove errors, discard drafts, or automatically resubmit mutations. Retrying/resetting a boundary is not rollback of an operation that may already have committed.
- Unexpected component-render exceptions are different from normal asynchronous operation errors. Isolate a failing custom component where feasible and provide a safe fallback plus diagnostic context. Framework error boundaries alone do not necessarily catch asynchronous query failures; controllers must expose those explicitly.
- Reserve explicit grouped/all-or-nothing loading and fallback policies for a concrete composed-page requirement. A later boundary descriptor can declare scope and policy while leaving fallback appearance to the renderer; a generic Suspense/error-boundary language is not required for the first slice.

### Selection and draft

- Select by stable identity, not row index or object identity. Duplicate/missing keys are diagnosed.
- For the initial row-backed collection editor, clear selection on filter/page changes after dirty-draft confirmation. Missing selected records need an explicit empty/deleted state.
- A later independent-detail-query mode can retain selection beyond the current list page; it is not necessary for the tracker slice.
- Initialize form from explicit mapped values when the record identity changes. Do not accidentally initialize an editor with a previous record's result while a new load is pending.
- Keep query result and draft separate. Refresh pristine drafts from newer data; preserve dirty drafts and show an available-update indication where appropriate. Define dirty comparison for supported rich values rather than relying on raw `JSON.stringify`.
- Confirm discard before switching record, navigating away, or performing another user-driven transition that would lose edits. Security-driven scope/access loss clears old data rather than retaining it indefinitely behind a confirmation.
- Disable duplicate submissions; retain draft and field errors on failure. Do not auto-retry side-effecting calls.
- On success, reconcile the known saved record, mark/reset the draft according to the declared form policy, and use normal invalidation. A stale pre-save query result must not overwrite the successful result or pristine draft.
- Output validation failures/timeouts may follow side effects. Preserve existing warnings and do not pretend rollback occurred.
- Concurrency/lost-update protection requires application revision inputs and server checks. A dirty-state UI is not optimistic locking.

### Query-backed inputs

Lookup controls should become a reusable form capability: search input mapping, items path, label/value paths, pagination, and a selected-value resolution query. An ID absent from the first option page must still get a label. Dependent lookup changes need an explicit reset rule; do not silently retain an invalid child selection. All lookup calls use ordinary checked queries.

Do not implement every lookup feature before the collection slice, but keep its form API possible. Do not build lookups out of user-authored loops and generic event wiring.

## 11. Type safety and data validation

### Authoring checks

Derive types from the finished operation catalog and component registry. Check operation names/kinds, named variants, accepted literal input shapes, result paths, parameter targets, state writes, component event payloads, and custom props.

Use accepted schema **input** types for values being sent; use validated public **output** types for decoded results. A schema accepting a string and transforming it into a `Date` differs from a schema requiring a runtime `Date`. Existing schema defaults and transforms must not be applied twice. Do not widen codec-supported rich values to strings just because JSON Schema has a string format.

Check source-to-target compatibility, including optional/null values. Examples:

```text
row.title: string       → mutation.title: string       valid shape
row.updatedAt: Date     → mutation.title: string       invalid
row.customer: object   → mutation.customerId: string   invalid without mapping
selectedId: string|null→ query.id: string              requires readiness handling
```

Deep path helpers must handle nested objects, arrays, nullable segments, and unions conservatively. Do not promise a path is always present across a union where it is not. Bound recursive type complexity if necessary; preserve safety and diagnostic clarity over clever unbounded conditional types.

Compile-time shape compatibility cannot prove refinements, minimum lengths, server policy, or all JSON Schema implications. Branded types/opaque schemas may need explicit adapters or a conservative unsupported diagnostic. Do not build a general schema-subtyping theorem prover.

### Validation layers

1. **TypeScript:** fast authoring feedback and positive/negative type tests.
2. **Compilation/definition validation:** structural validity, unique IDs, resolved operations/views/paths, supported combinations, literal/default checks where possible, input coverage, dependency/expansion cycles, and serializability.
3. **Actor-specific projection:** capability filtering and dependency closure; no dangling references or unusable defaults after filtering.
4. **Client definition validation:** reject unsupported versions/features and malformed manifests before interpreting them; validate supported component/binding/action structures and event payloads.
5. **Runtime value validation:** parameters, supported state writes and form drafts/submission checks, then authoritative server input/output validation and authorization on every operation.

For static validation, validate supplied complete inputs when safe; a required field intended for user entry is not a definition error merely because its initial draft is empty. Dynamic inputs are checked when resolved. If schema validation is asynchronous, use an explicit async validation stage/CLI/test helper rather than silently skipping it in a synchronous definition function or changing the entire public API accidentally. Report which checks are deferred.

Arbitrary Standard Schema functions cannot run in a generic browser without shipping code. For forms/state, compile a documented supported JSON Schema/runtime-type subset or use an explicitly registered local validator. Do not advertise browser support for arbitrary Zod refinements. The server remains authoritative for operation values; unsupported local validation must be documented, not treated as proof of validity.

Drafts may temporarily be invalid. Preserve field-level validation feedback rather than rejecting every keystroke through a final-input schema. State cells declared as fully validated values can reject invalid writes; make that distinction explicit.

Diagnostics should identify the page/view/block and both sides of a bad mapping, for example: `activityDashboard/manage/status.filter → activities.input.missing: unknown target parameter`.

## 12. Authorization, information exposure, and custom components

### Visibility

Add optional declarative requirements such as `visibility: { allOf: ['activities.write'] }` on supported pages/blocks/actions. Absence means no additional UI restriction. This differs from missing operation permission, which remains deny-by-default.

Requirements are additive and server-evaluated against the existing capability system. A UI rule cannot grant an unavailable operation. Input-dependent callback permissions may remain listed until execution; manifest presence is not a promise every call succeeds.

For collection/editor combinations, a readable query with an unavailable mutation degrades to a read-only collection. Omit protected editor/action metadata, not just its button. If a block requires a removed query source, remove/disable that dependent feature according to a specified policy; never leave an infinite waiting binding to a source the actor can never access.

Remove inaccessible/empty pages and choose an available default. Built-in resources keep their own authorization. Projection happens after compilation for the current actor/workspace; do not cache a projected manifest across users or scopes. Permission revocation and forbidden refetches must clear protected runtime data and refresh the applicable UI capabilities rather than relying on a manifest loaded only at sign-in.

The client controls parameters/state and can tamper with its UI. Never rely on hidden fields, disabled buttons, state validation, or sort-key configuration for server security. Do not include secrets or another user's private data in static settings/defaults. Ordinary authoring callbacks are not per-user policy callbacks.

### Custom components

Describe an allow-listed, namespaced component name and a versioned props/event contract. The renderer registry supplies actual trusted implementation code. Configuration does not ship component code, arbitrary imports, HTML, or executable URLs.

Validate props and declared references/dependencies so custom blocks do not bypass projection. Unknown components render a useful placeholder or declared fallback; unknown required protocol features must not silently execute with guessed semantics. A placeholder should not fetch otherwise unused data merely to populate itself.

The shipped admin is precompiled. A descriptor cannot make it display an arbitrary new Svelte component. Actual custom implementation requires a custom renderer/frontend build or a later separately designed extension mechanism. Support describing a custom component now without implying dynamic code loading.

Escape text, validate link/image schemes and resource policies, and avoid direct raw-HTML rendering. Trusted custom code is not a sandboxed security boundary.

## 13. Earlier wire-compatibility proposal (superseded)

The section below records the earlier additive-compatibility exploration only. Decision 16 October 2026 at the top of this brief supersedes it: the beta admin uses manifest protocol v2, and semantic pages plus operation presentations are the only serialized UI contract. There is no legacy `pages`/operation-UI projection or protocol-v1 admin fallback.

Do not silently mutate protocol-v1 legacy UI fields to contain callbacks, new block kinds, or structurally incompatible variants that an older admin will misinterpret.

Recommended additive strategy: retain the existing operation manifest and legacy UI projection, and introduce a separately versioned semantic UI member, conceptually:

```ts
{
  protocolVersion: 1,
  operations: [...], // existing execution/schema catalog
  pages: [...],      // legacy projection where representable
  interface: {
    version: 1,
    requiredFeatures: [...],
    // semantic pages, views, sources, scopes, bindings and component contracts
  },
}
```

`interface` is a proposed member name, not an existing field. Finalize exact shape and downgrade policy before implementing the renderer. A deliberate negotiated/new protocol version is an alternative, but must come with an explicit compatibility test matrix. Do not claim old clients can render unrepresentable new views: supply a safe legacy projection/schema fallback or a clear unsupported-version response. Preserve old definitions unchanged and ensure new clients consume old manifests.

Only one canonical compiled semantic model should drive new rendering and any legacy projection. Avoid two separately maintained business/UI definitions. Project out callback internals and unneeded authoring metadata.

Separate UI structure from runtime data representation. Structural descriptors are strict JSON. Query results, state values and operation inputs preserve supported rich values through the selected codec. If authoring literals/defaults contain rich values, encode them using an explicit portable literal representation/codec rule and validate renderer support; do not accidentally embed raw `Date`, `undefined`, `BigInt`, cyclic values, or schema objects in structural JSON.

Use current runtime-type metadata to distinguish `Date` from a string with `format: 'date-time'`. Do not clone state or drafts with JSON stringify/parse. Preserve rich value behaviour in existing tables, actions, forms and chat. Non-JSON query outputs such as cyclic maps are still permitted where the negotiated codec and existing runtime allow them; a semantic binding path only traverses supported object/array structures, not arbitrary `Map` internals or cycles.

## 14. Migration and implementation phases

### Phase A — contracts and inference proof

- Add authoring/compiled type separation and positive/negative callback inference tests.
- Prove same-definition cross-operation references, literal variant names, accepted input transforms, nested fields, and nullable dependencies.
- Specify versioning, IDs, ownership, validation limits, and capability projection rules.
- Compile one collection descriptor without changing existing admin output. Preserve object-style pages/variants and fallback execution.

Exit: no inferred `any`, unchanged existing type tests, deterministic serializable descriptors, and an agreed compatibility test matrix.

### Phase B — first useful vertical slice

- Implement/reuse query and form controllers; render a collection with an inline editor.
- Migrate Activity dashboard to the callback/named-view approach, retaining existing operations and schemas.
- Support title text filter targeting `search`, schema-derived status filter, existing cursor pagination, and mapped id/title/status editing.
- Keep `updatedAt` a real `Date` and display-only. Preserve viewer read access without editor affordances.
- Demonstrate standalone reuse of the same mutation form and automatic default operation UI.

Exit: the Activity dashboard is materially easier to use, works on mobile and desktop, and passes the lifecycle/permission tests below. Sorting is absent unless implemented end-to-end.

### Phase C — scoped composition and extensions

- Add the minimal scope/parameter/reference/action machinery needed for one parent-owned filter/selection example.
- Demonstrate cross-query usage inside an operation-owned view, not only inside a page.
- Add basic layouts and custom-component description/placeholder.
- Improve record display and one query-backed form lookup as concrete requirements justify them.
- Adapt existing chat/task/resource views without feature regressions; do not rewrite their execution semantics. Introduce typed built-in resource adapters and migrate default Operations, Task runs, Schedules, History and Agent runs pages to reproducible semantic configurations. Demonstrate an application-authored composition using the same resource capabilities.

### Phase D — independence and further presets

- Add a small second renderer/test renderer that consumes the same semantic document and implements a different collection/editor arrangement.
- Extract shared controller code into a separate package only if it demonstrably reduces duplication.
- Add sort/date/range/lookup presets and broader explicit block composition based on actual applications, not anticipated universality.

At every phase, document the shipped API, unsupported cases, changeset/package implications, and any migration required for manifests/renderer consumers. Do not snapshot archived docs manually; use the existing release/versioning workflow.

## 15. Verification and acceptance criteria

### Type tests

Extend existing executable type tests rather than rely on markdown examples. Include negative assertions for:

- Unknown operation/kind/variant, including inside another operation's view callback.
- Wrong literal inputs and invalid state writes.
- Missing result paths and incompatible source/target values.
- Nullable selected identity used without readiness handling.
- Date versus string, enum versus arbitrary string, accepted versus transformed input types.
- Unknown filter target, incompatible preset, unknown sort key.
- Invalid custom props/events and out-of-scope state references.
- Missing required noneditable mutation input with no declared value/default/control.

Also prove autocomplete-facing literal key preservation and unchanged `createClient<typeof tracker>`/handler inference. Measure practical typecheck performance for nested definitions.

### Definition/manifest tests

Test duplicate IDs, unresolved references, recursive view expansion, automatic dependency cycles, invalid defaults, serializer rejection, unknown protocol features, and malformed paths. Assert a compiled document contains no functions, authoring proxies, or schema implementations.

Test viewer/editor/admin and unusual capability combinations, custom-view dependencies, stripped editor metadata, empty-page/default fallback, callback permission visibility, and no actor-cache bleed. Exercise both legacy and new document paths, including unsupported-version handling.

### Controller scenario tests

Use schema-checked fixtures with a fake transport and real controller logic. Do not execute real mutations as a supposed definition validation step.

1. Initial list loads; no selected record means no editor initialization/detail request.
2. Selecting a row maps the expected id/title/status and excludes updatedAt.
3. Editing changes only the draft, not the query result or another instance.
4. Refresh preserves a dirty draft; pristine refresh and discard confirmation follow policy.
5. Rapid selection and out-of-order results cannot initialize the wrong record.
6. Filter/page-size/sort changes clear cursors atomically and coalesce requests.
7. Optional filter clear omits the key; false/zero are not mistaken for absence.
8. Valid submission reaches the exact checked mutation input; invalid input produces useful errors.
9. Failure preserves the draft; success reconciles state; post-commit warnings are not retried as failures.
10. Workspace/actor/page disposal and access revocation prevent stale data resurrection.
11. Reused views are independent; explicitly shared sources do not duplicate subscriptions.
12. A removed dependency reports unavailable rather than hanging; user-hidden and shared-source lifecycles remain distinct.
13. Rich/nested values survive binding, initialization and submission without lossy JSON cloning.
14. Stable identity and selected lookup labels survive pagination where the feature supports it.
15. Identically named state declarations in different scopes/instances do not collide, and stable keyed instances retain the correct state when reordered or rerendered.
16. One source failure does not replace unrelated siblings with an error page; dependent blocks leave loading correctly, refresh retains only valid same-identity data, and a custom rendering exception has a safe fallback.

### Browser and renderer tests

Extend `tests/e2e/admin.spec.ts` for desktop/mobile collection editing, filters, pagination, viewer read-only mode, keyboard/focus, dirty transitions, error states, and existing chat/task/resource flows. Keep rich input tests in `packages/admin/src/ui/rich-input.test.ts` relevant.

### Current-demo approximation is an acceptance baseline

The completed default renderer and its configuration must make a reasonable functional and structural approximation of the existing example demo. This is more than preserving endpoints or rendering one improved dashboard. Before migrating, inventory current pages and important interactions from the running demo, `examples/tracker/src`, and existing browser tests. Use that inventory as a regression checklist; the following is a minimum baseline, not an exhaustive replacement for inspection:

| Area | Preserve or reproduce |
| --- | --- |
| Application shell | Host authentication integration, application/workspace selection, authorized navigation, back/forward navigation and usable mobile page selection |
| Operations | Query/mutation/task discovery, named/default variants, schema-generated inputs and JSON fallback, results, table row actions and checked execution |
| Activity dashboard | Recognizable collection/edit workflow with existing list data, filters/pagination where supported, and improved connected editing rather than a reduced read-only mock |
| Milo chat | Conversation persistence, sending, saved replies, active-run/status display, existing chat presentations/actions and safe navigation during requests |
| Platform pages | Operations, Task runs, Schedules, History and Agent runs, including current creation/management/inspection features and capability restrictions |
| Other applications | Notes' differently shaped context/generic query view and the admin-only identity directory's existing list/edit actions |
| Runtime behaviour | Cross-client live updates, scope isolation, permission filtering, rich-value/Date display and editing, error/loading states, progress and result handling |
| Responsive interaction | Comparable desktop/mobile usability, accessible controls and focus, with renderer freedom over exact layout |

Do not require pixel-identical CSS or preserve implementation-specific DOM selectors as architectural constraints. Layout and interaction may improve, but removing a current workflow is not an acceptable approximation merely because a screenshot looks similar. Where a visual regression test changes, retain an equivalent behavioural assertion. Any intentional omission or material behaviour change must be explicitly documented and agreed rather than silently classified as future work.

Prove that default resource pages are generated configurations and that an application-authored equivalent can use the same blocks/adapters. This is distinct from proving a second renderer can consume the document; both are required to avoid moving today's hard-coded page orchestration into a new opaque component.

### Cross-renderer contract

Use a second small renderer or contract harness to prove the document does not assume Svelte or a fixed table/editor layout. Compare semantic events, mapped inputs and lifecycle outcomes, not pixel snapshots alone. A screenshot cannot prove dirty-state or stale-response correctness.

### Repository checks

Run focused checks during development, then the applicable full suite:

```sh
pnpm build
pnpm test
pnpm typecheck
pnpm test:e2e
pnpm test:packages
pnpm docs:build
```

Some checks launch servers/browser tooling or depend on the environment. Report actual results and blockers; do not claim tests passed because configuration compiled. Keep diagnostics free of private actor/query data.

## 16. Open choices to resolve explicitly

These are implementation choices, not permission to reopen the core direction:

1. Exact callback/helper signatures and reliable inference strategy, including literal variant names.
2. Exact new UI envelope/version/capability negotiation and legacy projection policy.
3. Component/source/scope ID generation and allowable instance overrides. Recommend deterministic scope-qualified IDs, explicit IDs for event/binding targets, and narrow typed overrides rather than deep arbitrary merges.
4. Supported browser validation subset, runtime-type support, async definition validation, and explicit limitations for opaque refinements.
5. Minimal action/condition vocabulary and how state resets/readiness are represented without hidden expression evaluation.
6. Where controller modules live initially. Keep core framework-independent and client browser-safe; do not add a package merely because the diagram has a layer.
7. Timing of detail-query editors, query-backed lookup controls and sorting. The initial tracker collection does not require all of them.

Resolve these through small prototypes and tests before broad renderer changes. Prefer explicit safe limitations over nominally generic APIs that depend on casts or silently lose behaviour.

## 17. Background and lessons borrowed

- [json-render](https://github.com/vercel-labs/json-render): typed catalogs/registries, state references, declarative actions, and authoring/rendering separation. Inspiration, not a selected dependency or compatibility promise.
- [JSON Forms](https://jsonforms.io/docs/architecture): data schemas distinct from presentation hints and replaceable renderers; forms do not by themselves define an application protocol.
- [A2UI](https://a2ui.org/): catalog-based declarative descriptions interpreted by local renderers. Agent streaming is not required for Workcore's deterministic admin definitions.
- [Adaptive Cards](https://learn.microsoft.com/en-us/adaptive-cards/authoring-cards/getting-started): semantic elements, host-controlled presentation and explicit compatibility.
- [JSON Pointer, RFC 6901](https://www.rfc-editor.org/rfc/rfc6901): a standard for compiled data paths rather than inventing another path syntax.

The central lesson is not that every interface should be JSON. It is that a small, validated semantic contract can cover repetitive starter/admin workflows while application code and custom components remain the escape hatch.
