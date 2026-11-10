# Public API index

Use this page to find an exported symbol by package. Use [Getting started](./getting-started) for a complete integration and the [agent map](./coding-agents) for task-oriented reading. This index covers public runtime entry points, with the principal types alongside them; installed declarations provide exact generic signatures for your version. An exported helper is not a license to bypass the application runtime or authorization.

## Package entry points

| Import | Execution boundary | Reference/guide |
| --- | --- | --- |
| `@workcore/core` | Schema/operation definitions and shared metadata helpers; database execution stays server-side | [Core definitions](#core-definitions-and-operations) |
| `@workcore/core/schema` | Drizzle Kit schema generation; export internal tables alongside application tables | [Schema exports](#internal-schema-exports) |
| `@workcore/core/cloudflare` | Cloudflare Worker/Durable Object only | [Host reference](./hosting) |
| `@workcore/core/backup` | Trusted server/operator maintenance only | [Recovery](./recovery) |
| `@workcore/client` | Browser-safe typed/runtime transport; no SQL or Worker implementation imports | [Client reference](./client-api) |
| `@workcore/admin/server` | Worker asset routing | [Admin setup](./admin#install-and-serve-the-optional-console) |
| `@workcore/admin/assets` | Node build tooling only | [Admin assets](#admin-entry-points) |
| `@workcore/files` | Server schema and R2 capability definition | [Files](./files) |
| `@workcore/ai` | Server background model/tool execution | [AI integration](./ai) |

There is no umbrella `workcore` package and no `@workcore/admin` root entry point. Keep all Workcore package versions coordinated. The browser imports application definitions with `import type` only.

## Core definitions and operations

From `@workcore/core`:

| Symbol | Contract | Details |
| --- | --- | --- |
| `defineSchema(tables)` | Combine application Drizzle tables with internal tables; rejects reserved/duplicate table names | [Schema setup](./getting-started#2-define-and-export-the-sql-tables) |
| `idColumn()` | Fresh builder for a string primary key | [Column helpers](./authoring#define-a-drizzle-schema) |
| `timestampColumns()` | Fresh epoch-millisecond `createdAt`/`updatedAt` builders with defaults | [Column helpers](./authoring#define-a-drizzle-schema) |
| `versionColumn()` | Fresh integer optimistic-concurrency field | [Concurrent editing](./multi-user#concurrent-editing) |
| `workspace(tables, migrations, options?)` | Typed operation factory; options are `triggerKeys` and `tableDisplay`; schema is normally from `defineSchema` | [Factory methods below](#workspace-factory-methods) |
| `versionMatch(column, expected)` | SQL equality predicate; rejects non-positive/non-safe-integer versions; combine with row identity and ownership | [Concurrent editing](./multi-user#concurrent-editing) |
| `requireChanged(row)` | Return a present row; otherwise throw `CONFLICT`/409 without disclosing why it is unavailable | [Concurrent editing](./multi-user#concurrent-editing) |
| `builtinTriggers` | Reserved `files`, `runs`, `schedules`, `history`, `kv` keys, whose values are `$workcore:*` labels | [Invalidation](./authoring#trigger-keys-and-view-invalidation) |
| `shouldRefreshView(dependencies, changed)` | Test wildcard or matching invalidation keys; `undefined` dependencies refresh on every commit, `[]` only on a changed wildcard | [Invalidation](./authoring#trigger-keys-and-view-invalidation) |
| `WorkcoreError(code, message, status?)` | Application/runtime error, HTTP status defaults to 400 | [Errors](./security#error-contract) |
| `encodeJson(value, maxBytes?)` | Validate plain acyclic JSON and encode it; default limit 524,288 bytes; rejects lossy/rich values | [JSON and limits](./security#json-and-size-limits) |
| `workcoreSchema` | Internal table map, also exported from the schema entry point; not a browser data API | [Schema exports](#internal-schema-exports) |

### Workspace factory methods

Every operation needs Zod input/output schemas and a handler. Schema-valid inputs still require authorization. Register operations under stable names in `define`; passing an unregistered object to a job is not supported.

| Method | Definition options | Execution/result |
| --- | --- | --- |
| `app.view(...)` | `input`, `output`, `handler`, optional `dependsOn`, `maxRows`, `ui` | Synchronous read-only result; can subscribe live or read once |
| `app.query(...)` | `input`, `output`, `handler`, optional `ui` | Synchronous read-only, one-shot result; application implements pagination |
| `app.mutation(...)` | `input`, `output`, `handler`, optional `triggers`, `ui` | Synchronous transaction; output validation failure rolls back |
| `app.task(...)` | `input`, `output`, async `handler`, optional `maxAttempts`, `retryDelayMs`, `maxSteps`, `timeoutMs`, `ui` | Background run, not a long-running SQLite transaction |
| `app.agent(...)` | Task-like definition with required operation `tools` allowlist; no automatic retry options | Background run under the initiating actor; not an unrestricted service identity |
| `app.display(...)` | `input`, `metadata`, synchronous read-only document `handler` | Parameterized optional admin display, not an application frontend requirement |
| `app.define(...)` | `views`, `queries`, `mutations`, `jobs`, required `authorize`; optional `initialize`, `files`, `displays` | Application definition passed to `Workspace`; schema, migrations and factory options are attached |

`initialize(db)` runs transactionally once after migrations for fixed initial records, not external work. Context field/method contracts are in [Context and identity](./context); lifetime, limits and failure policies are in [authoring](./authoring), [live data](./sync) and [execution](./execution).

Principal types: `Actor`, `Database`, `Tables`, `Definition`, `Operation`, `View`, `Mutation`, `Job`, `ReadContext`, `MutationContext`, `RunContext`, `MigrationBundle`, `TableDisplay`, `Json`, `FileBucket`, `Run`, `Schedule`, `Trigger`, `TriggerKey`, `BuiltinTriggerKey`.

## Internal schema exports

From `@workcore/core/schema`: `workcoreMeta`, `workcoreKv`, `workcoreRuns`, `workcoreSchedules`, `workcoreSteps`, `workcoreHistory`, `workcoreRequests`, and their combined `workcoreSchema` map. `WorkcoreSchema` is its type.

These exports let Drizzle Kit generate the complete initial SQL and later migrations. They are framework-owned storage, not supported direct-write APIs. Do not modify their records to simulate mutations, job control, permissions or request deduplication. Export them alongside application tables in the Drizzle schema file; see [migration setup](./getting-started#3-generate-and-bundle-migrations).

## Cloudflare host and maintenance

| Entry point | Symbol | Contract |
| --- | --- | --- |
| `@workcore/core/cloudflare` | `Workspace` | Base SQLite Durable Object hosting a definition; constructor, Worker hooks and lifetime are in [host reference](./hosting) |
| `@workcore/core/cloudflare` | `routeWorkspace` | Public authenticated Worker router, namespace selection and optional workspace access hook; [options](./hosting#routeworkspace-options) |
| `@workcore/core/backup` | `exportWorkspace(storage, definition, options)` | Synchronous snapshot; explicit maintenance acknowledgment, registered-table/schema checks; [backup procedure](./recovery#backup-procedure) |
| `@workcore/core/backup` | `restoreWorkspace(storage, definition, input, options)` | Destructive registered-table restore with schema/revision/confirmation checks; returns new revision; [restore procedure](./recovery#restore-procedure) |
| `@workcore/core/backup` | `copyBackupFiles(backup, source, destination)` | Copy recorded ready-file bytes between distinct snapshot/live buckets or scoped adapters; not a SQL/R2 transaction |
| `@workcore/core/backup` | `backupSchema` | Versioned snapshot validator, not authorization or executable SQL |

Related types: `Session` (`actor`, `expiresAt`) and `WorkspaceBackup`. Backup options require `maintenance: true`, support `maxBytes` (default 16 MiB), and restore additionally requires `confirm: 'replace-workspace'` and `expectedRevision`. None of these acknowledgments installs a traffic lock; the host must enforce maintenance. Recovery helpers are deliberately absent from the public HTTP/client API.

## Client entry points

All methods and helper lifetimes are listed in [Browser client reference](./client-api):

- `createClient` — inferred application operations, browser HTTP/WebSocket transport.
- `createRuntimeClient` — runtime-discovered operations over the same transport, without application-specific name/input inference.
- `ClientError` — `code`, `message`, numeric `status` (default 0 for non-HTTP failures).
- `createSources` — reference-counted renderer sources over a runtime client; not another server or socket implementation.
- `sourceKey` — canonical object-key-sorted JSON identity for equivalent inputs; validate values as JSON first.
- `createActionDispatcher` — mutation/job submission state retaining request IDs for identical failed retries within a mounted action scope.

Types: `ClientOptions`, `Result`, `LiveState`, `Subscription`, `LiveSystemOperation`, `RuntimeClient`, `SourceReference`, `Sources`.

## Optional admin metadata

These runtime exports are from `@workcore/core` but support the optional console:

| Symbol | Purpose | Details |
| --- | --- | --- |
| `field(schema, metadata)` | Preserve Zod validation/inference and attach field presentation metadata | [Field hints](./admin#field-hints-on-ordinary-zod-schemas) |
| `ui` | Typed document, source, action, layout, state/effect and binding builders | [Helper reference](./admin#ui-helper-reference), [protocol](./display-protocol) |
| `compileDisplays` | Compile/validate registered display references and document contracts; normal runtime setup performs this for the application | [Display contract](./admin#display-contract) |
| `manifestSchema` | Validate supported discovery manifest/protocol; typed client does this when fetching manifests | [Wire contract](./sync#wire-contract) |
| `displayDocumentSchema` | Validate the serialized display-document shape, not authority to invoke referenced operations | [Display protocol](./display-protocol) |
| `MAX_DISPLAY_BYTES`, `MAX_DISPLAY_DEPTH`, `MAX_DISPLAY_NODES` | Current display bounds: 524,288 bytes, 12 levels and 200 nodes | [Protocol bounds](./display-protocol#bounds-and-compatibility) |

Display/UI types (including `Manifest`, `ManifestDocument`, `DisplayDocument`, `DisplaysDefinition`, `DisplayDefinition`, `FieldMetadata`, `OperationUI`, `SuccessEffect` and bindings) describe that same contract; use exported declarations for exact generics. Hiding or disabling a field/action never grants or revokes server permissions.

### Admin entry points

- `serveAdmin(request, assets)` from `@workcore/admin/server`: serve `/admin` paths via an `AssetFetcher`, stripping the prefix and adding security headers. Returns 404 outside that path; **does not authenticate** the request. The host must do that first.
- `adminAssetsDirectory` from `@workcore/admin/assets`: absolute local path to the package's prebuilt SPA directory in Node tooling.
- `copyAdminAssets(destination)` from `@workcore/admin/assets`: asynchronously copy that directory recursively to a path/URL; does not configure Wrangler or authenticate routes.

Follow [admin installation](./admin#install-and-serve-the-optional-console) for asset layout, SPA fallback and same-origin APIs.

## Files entry point

From `@workcore/files`:

- `fileTable`: predefined Drizzle metadata table (`pending`, `ready`, `deleting` lifecycle); include it in both the runtime schema and generated migrations.
- `fileStorage<Env>({ bucket, maxSize? })`: capability definition referencing the `files` table and server bucket resolver. Default maximum is 25 MiB; configuration accepts 1 byte through 5,000,000,000 bytes. Platform/request restrictions still apply. It does not upload bytes itself or grant file permissions.

See [file storage](./files) for required bindings, authorization actions, cleanup and SQLite/R2 consistency. Browser helpers are under [client.files](./client-api#files).

## AI entry point

From `@workcore/ai`:

| Symbol | Input/result and boundary | Guide |
| --- | --- | --- |
| `modelSpec(value)` | Parse `provider/model` at the first slash; throws `AI_CONFIG` for missing provider/model | [Profiles](./ai#model-profiles-and-credentials) |
| `resolveModel(spec, env, configured?)` | Resolve built-in/custom provider with credentials from server bindings; rejects missing key/unknown provider/insecure configured base URL | [Credentials](./ai#model-profiles-and-credentials) |
| `createAI(config, options?)` | Configure named profiles/providers and optional trusted model resolver; returns `run(ctx, input)` | [Loop contract below](#ai-run-contract) |
| `operationTool(ctx, kind, operation, description)` | Checked `read`/`mutate` tool preserving registration, actor authority, schema and agent allowlist | [Checked tools](./ai#checked-mutations-and-read-tools) |
| `externalTool(definition)` | Typed application-owned external tool; does not supply automatic data-access authorization | [AI guide](./ai) |
| `terminatingTool(tool, options?)` | Mark checked/external tool as successful loop completion; optional `text(result)` is application-authored output | [Structured completion](./ai#terminating-tools-and-structured-completion) |

### AI run contract

`ai.run(ctx, input)` accepts required `profile`, `system`, `messages`; optional `tools`, `completion`, `onTextDelta`, `selectProfile`. `completion` defaults to `'text-or-tool'`; `'tool-required'` requires a terminating tool. The initial profile fixes overall budgets even when selecting another profile per turn. Default limits are 8 turns, 32,000 reported total tokens and 120,000 ms; see the [AI guide](./ai) for provider fallback and interruption semantics.

It returns `AgentResult`, discriminated by `finishReason: 'text' | 'tool'`, plus `text`, `turns`, `usage`, `model`, `fallbackAttempts` and, for tool completion, `tool: { name, result }`. Streaming callbacks deliver transient text, not durable conversation history. Model fallback does not replay successful tools; external effects are not exactly-once. Related types: `AIConfig`, `ModelSpec`, `ProviderConfig`, `ModelProfile`, `AgentTool`, `CompletionMode`, `AgentResult`.

## Keeping this index accurate

Runtime exports are checked against the tables/lists here by `pnpm test:docs`. Updating a name here is not sufficient documentation for a feature: update its linked contract, example, permission/failure semantics and relevant tests as required by the [contributor checklist](./contributing#required-feature-change-checklist). Types and behavior changes still require review; the coverage check cannot prove correctness.
